#!/usr/bin/env node
/**
 * Reads a raindrop.io-style CSV export and/or a plain URL list, and drafts proposed link
 * entries into import/review.yaml for a human to approve, edit, or reject - it never writes
 * directly into data/**.
 *
 * Usage:
 *   node scripts/import-bulk.mjs --csv path/to/export.csv
 *   node scripts/import-bulk.mjs --urls import/sources/urls.txt
 *   node scripts/import-bulk.mjs --csv export.csv --urls urls.txt   (both, in one review file)
 *
 * For each row: normalize the URL, skip anything already in the dataset,
 * skip anything on the personal-profile/ephemera exclusion list, guess a category/tags/legal_risk
 * via scripts/lib/import-heuristics.mjs, and write the result - never straight into the dataset.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { dump } from 'js-yaml';
import { parseCsvRecords } from './lib/csv.mjs';
import { normalizeUrl } from './lib/url.mjs';
import { slugify } from './lib/slugify.mjs';
import { loadCollection, REPO_ROOT } from './lib/yaml-io.mjs';
import { guessCategory } from './lib/import-heuristics.mjs';
import { isExcluded } from './lib/import-exclusions.mjs';

const REVIEW_PATH = path.join(REPO_ROOT, 'import', 'review.yaml');

function parseArgs(argv) {
  const args = { csv: null, urls: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--csv') args.csv = argv[++i];
    else if (argv[i] === '--urls') args.urls = argv[++i];
  }
  return args;
}

const SCHEMA_TITLE_MAX = 120;

/**
 * Raw scraped titles are often "Meaningful part - SEO tail - Brand - more SEO", long enough to
 * fail the schema's 120-char limit outright. Keeps the first segment (or the first two, if the
 * first alone is too short to be useful), then hard-truncates as an absolute safety net - the
 * schema limit must never be the thing that fails an import that otherwise looked fine.
 */
function cleanTitle(raw) {
  let title = raw.trim();
  const parts = title
    .split(/\s+[|–—-]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    title = parts[0].length < 20 ? `${parts[0]} - ${parts[1]}` : parts[0];
  }

  if (title.length > SCHEMA_TITLE_MAX - 3) {
    title = `${title.slice(0, SCHEMA_TITLE_MAX - 3).trimEnd()}...`;
  }
  return title;
}

/** A short, human-readable description from whatever text is available - never invents one. */
function deriveDescription({ excerpt, note }) {
  const text = (note || excerpt || '').trim().replace(/\s+/g, ' ');
  if (!text) return undefined;
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

/** A reasonable title from a bare URL's hostname, for the plain-URL-list rows with no title. */
function titleFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

async function readCsvRows(csvPath) {
  const text = await readFile(csvPath, 'utf8');
  const records = parseCsvRecords(text);
  return records.map((r) => {
    const rawTitle = r.title?.trim() || titleFromUrl(r.url);
    return {
      // Categorization runs on rawTitle - cleanTitle's job is trimming a noisy display title,
      // and it routinely cuts the exact segment (a lecturer's name, a keyword) that the
      // heuristic needs, so guessing must happen before that trim, not after it.
      title: cleanTitle(rawTitle),
      rawTitle,
      url: r.url?.trim(),
      excerpt: r.excerpt,
      note: r.note,
      tagsHint: r.tags,
      createdAt: r.created,
      // Raindrop's own cover, captured at the moment the link was originally saved - preferred
      // over a fresh live fetch, which may hit a page that's since changed or gone offline.
      coverUrl: r.cover?.trim(),
      source: 'csv',
    };
  });
}

async function readUrlListRows(urlsPath) {
  const text = await readFile(urlsPath, 'utf8');
  const rows = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const [maybeTitle, maybeUrl] = line.split('\t');
    const url = (maybeUrl ?? maybeTitle).trim();
    const explicitTitle = maybeUrl ? maybeTitle.trim() : null;

    const rawTitle = explicitTitle || titleFromUrl(url);
    rows.push({
      title: rawTitle,
      rawTitle,
      url,
      excerpt: '',
      note: '',
      tagsHint: '',
      createdAt: null,
      source: 'url-list',
    });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csv && !args.urls) {
    console.error('usage: node scripts/import-bulk.mjs [--csv <path>] [--urls <path>]');
    process.exit(1);
  }

  const [csvRows, urlRows, existingLinks, existingCompanies] = await Promise.all([
    args.csv ? readCsvRows(args.csv) : [],
    args.urls ? readUrlListRows(args.urls) : [],
    loadCollection('links'),
    loadCollection('companies'),
  ]);

  const known = new Map();
  for (const e of existingLinks) {
    try {
      known.set(normalizeUrl(e.data.url), e.relPath);
    } catch {}
  }
  for (const e of existingCompanies) {
    try {
      known.set(normalizeUrl(e.data.website), e.relPath);
    } catch {}
  }

  const allRows = [...csvRows, ...urlRows];
  const proposals = [];
  const skipped = { excluded: 0, duplicateExisting: 0, duplicateInBatch: 0, noUrl: 0 };
  const seenInBatch = new Map();

  for (const row of allRows) {
    if (!row.url) {
      skipped.noUrl++;
      continue;
    }
    if (isExcluded(row.url)) {
      skipped.excluded++;
      continue;
    }

    let canonical;
    try {
      canonical = normalizeUrl(row.url);
    } catch {
      proposals.push({
        title: row.title,
        url: row.url,
        category: null,
        tags: [],
        priority: 'medium',
        legal_risk: false,
        description: deriveDescription(row),
        confidence: 'low',
        reason: 'URL did not normalize - fix it by hand before approving',
        source_kind: row.source,
      });
      continue;
    }

    if (known.has(canonical)) {
      skipped.duplicateExisting++;
      continue;
    }
    if (seenInBatch.has(canonical)) {
      skipped.duplicateInBatch++;
      continue;
    }
    seenInBatch.set(canonical, row.title);

    const guess = guessCategory({
      title: row.rawTitle,
      excerpt: [row.excerpt, row.note, row.tagsHint].filter(Boolean).join(' '),
      url: canonical,
    });
    const hintTags = (row.tagsHint || '')
      .split(',')
      .map((t) => slugify(t))
      .filter(Boolean);

    const image = row.coverUrl && /^https?:\/\//.test(row.coverUrl) ? row.coverUrl : undefined;

    proposals.push({
      title: row.title,
      url: canonical,
      category: guess.categoryPath,
      tags: [...new Set([...guess.tags, ...hintTags])],
      priority: 'medium',
      ...(guess.legalRisk && { legal_risk: true }),
      description: deriveDescription(row),
      ...(image && { image }),
      date_added: row.createdAt ? row.createdAt.slice(0, 10) : undefined,
      confidence: guess.confidence,
      reason: guess.reason,
      source_kind: row.source,
    });
  }

  await mkdir(path.dirname(REVIEW_PATH), { recursive: true });

  const header = `# Bulk-import review file - generated by scripts/import-bulk.mjs, NOT final data.
#
# Each entry below is a best guess: category/tags come from scripts/lib/import-heuristics.mjs,
# confidence is "high" (matched a known domain), "medium" (a generic keyword rule fired), or
# "low" (no match at all - category is null and MUST be filled in by hand).
#
# Go through this file, fix anything wrong, delete anything you don't want, then run
# npm run import-review to write the approved entries into data/** and validate them.
# This file is gitignored - it is scratch, never committed as data.
#
# Generated ${new Date().toISOString().slice(0, 10)}: ${proposals.length} proposed, ${skipped.excluded} excluded (personal/ephemera), ${skipped.duplicateExisting} already in the dataset, ${skipped.duplicateInBatch} duplicated within this batch.
`;

  await writeFile(REVIEW_PATH, header + dump(proposals, { lineWidth: 100, noRefs: true }), 'utf8');

  console.log(`  Read ${allRows.length} rows (${csvRows.length} from CSV, ${urlRows.length} from URL list).`);
  console.log(`  Excluded ${skipped.excluded} (personal profile / ephemera).`);
  console.log(`  Skipped ${skipped.duplicateExisting} already in the dataset.`);
  console.log(`  Skipped ${skipped.duplicateInBatch} duplicated within this batch.`);
  console.log(`  Wrote ${proposals.length} proposals to import/review.yaml.`);

  const byConfidence = { high: 0, medium: 0, low: 0 };
  for (const p of proposals) byConfidence[p.confidence]++;
  console.log(`  Confidence: ${byConfidence.high} high, ${byConfidence.medium} medium, ${byConfidence.low} low.`);
}

main().catch((err) => {
  console.error(`\n  import-bulk.mjs failed: ${err.message}`);
  console.error(err.stack?.split('\n').slice(1, 4).join('\n') ?? '');
  process.exit(1);
});
