#!/usr/bin/env node
/**
 * Walks import/review.yaml (written by scripts/import-bulk.mjs) and promotes approved entries
 * into data/** - this is the only script that actually writes to the dataset from an
 * import; import-bulk.mjs only ever drafts proposals.
 *
 * Two modes:
 *
 *   npm run import-review
 *     Interactive, one entry at a time: approve, edit (category/tags/priority/title), or
 *     reject. Best for genuinely reviewing a small or unfamiliar batch by hand.
 *
 *   npm run import-review -- --auto --min-confidence=medium
 *     Non-interactive: approves every entry at or above the given confidence whose category is
 *     already set, skipping (never guessing) anything with category: null. Prints what it
 *     skipped so nothing silently vanishes. Use after you've read through review.yaml yourself
 *     and are confident in the guesses at that confidence level - this does not re-guess
 *     anything, it only writes what scripts/import-bulk.mjs already proposed.
 *
 * Either way: every written entry gets its favicon fetched immediately, and the full dataset is
 * validated once at the end - not per entry, since re-validating 200 times is pure waste.
 */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import * as p from '@clack/prompts';
import { load, dump } from 'js-yaml';
import { REPO_ROOT, writeYaml, loadCollection } from './lib/yaml-io.mjs';
import { slugify, slugifyList, isValidSlug } from './lib/slugify.mjs';
import { normalizeUrl } from './lib/url.mjs';
import { fetchFaviconForEntry, fetchCoverForEntry, cacheCoverFromUrl } from './lib/enrich.mjs';
import { pickCategory, resolveEntryPath } from './lib/cli-shared.mjs';

const REVIEW_PATH = path.join(REPO_ROOT, 'import', 'review.yaml');
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const auto = argv.includes('--auto');
  const minFlag = argv.find((a) => a.startsWith('--min-confidence='));
  return { auto, minConfidence: minFlag ? minFlag.split('=')[1] : 'medium' };
}

/** Builds the final YAML-ready entry object from a (possibly edited) review row. */
function toEntry(item) {
  const tags = item.tags?.length ? item.tags : [slugify(item.category.split('/').pop())];
  return {
    url: item.url,
    title: item.title.trim(),
    category: item.category,
    ...(item.description && { description: item.description }),
    ...(item.image && { image: item.image }),
    tags: slugifyList(tags),
    priority: item.priority ?? 'medium',
    ...(item.legal_risk && { legal_risk: true }),
    date_added: item.date_added || todayIso(),
    source: 'local',
  };
}

/**
 * A title in a non-Latin script (Urdu, Arabic, ...) is a perfectly legitimate entry, but
 * slugify() strips everything outside [a-z0-9] and can end up with nothing to build a filename
 * from. Falls back to the URL's hostname in that case - the real title still goes into the YAML
 * unchanged, this only affects the filename.
 */
function titleForFilename(item) {
  if (slugify(item.title)) return item.title;
  try {
    return new URL(item.url).hostname.replace(/^www\./, '');
  } catch {
    return item.title;
  }
}

async function writeApproved(item) {
  const { filePath, slug } = resolveEntryPath('links', item.category, titleForFilename(item));
  const entry = toEntry(item);
  await writeYaml(filePath, entry);

  const favicon = await fetchFaviconForEntry('links', slug, entry.url);
  // A raindrop-sourced cover was captured at the moment the link was originally saved, which is
  // more reliable than fetching a live page that may have changed or gone offline since - prefer
  // it over a fresh og:image fetch whenever the CSV actually had one.
  const cover = entry.image
    ? await cacheCoverFromUrl('links', slug, entry.image)
    : await fetchCoverForEntry('links', slug, entry.url);
  return {
    filePath: path.relative(REPO_ROOT, filePath),
    favicon: favicon.status,
    cover: cover.status,
  };
}

async function runInteractive(items) {
  p.intro(`sidequest - reviewing ${items.length} imported entries`);

  const decisions = { approved: 0, rejected: 0, skipped: 0, alreadyPresent: 0 };
  const remaining = [];

  for (const [i, item] of items.entries()) {
    p.note(
      [
        `URL: ${item.url}`,
        `Category guess: ${item.category ?? '(none - needs one)'} [${item.confidence}]`,
        `Tags: ${item.tags?.join(', ') || '(none)'}`,
        item.description ? `Description: ${item.description}` : null,
        `Reason: ${item.reason}`,
      ]
        .filter(Boolean)
        .join('\n'),
      `${i + 1}/${items.length}  ${item.title}`,
    );

    const action = await p.select({
      message: 'What now?',
      options: [
        { value: 'approve', label: 'Approve as-is' },
        { value: 'edit', label: 'Edit category, then approve' },
        { value: 'reject', label: 'Reject (drop it entirely)' },
        { value: 'skip', label: 'Skip for now (leave in review.yaml)' },
        { value: 'quit', label: 'Stop here - keep the rest in review.yaml' },
      ],
    });

    if (p.isCancel(action) || action === 'quit') {
      remaining.push(item, ...items.slice(i + 1));
      break;
    }

    if (action === 'reject') {
      decisions.rejected++;
      continue;
    }
    if (action === 'skip') {
      decisions.skipped++;
      remaining.push(item);
      continue;
    }
    if (action === 'edit') {
      item.category = await pickCategory('links');
    }
    if (!item.category || !isValidSlug(item.category.split('/')[0])) {
      p.log.error('No valid category set - skipping, still in review.yaml.');
      decisions.skipped++;
      remaining.push(item);
      continue;
    }

    const result = await writeApproved(item);
    p.log.success(`Wrote ${result.filePath} (favicon: ${result.favicon}, cover: ${result.cover})`);
    decisions.approved++;
  }

  return { decisions, remaining };
}

function runAuto(items, minConfidence) {
  const threshold = CONFIDENCE_RANK[minConfidence] ?? CONFIDENCE_RANK.medium;
  const decisions = { approved: 0, rejected: 0, skipped: 0, alreadyPresent: 0 };
  const remaining = [];
  const writes = [];

  for (const item of items) {
    const meetsBar = (CONFIDENCE_RANK[item.confidence] ?? 0) >= threshold;
    if (!item.category) {
      decisions.skipped++;
      remaining.push(item);
      console.log(`  skip (no category)   ${item.title}`);
      continue;
    }
    if (!meetsBar) {
      decisions.skipped++;
      remaining.push(item);
      console.log(`  skip (below bar)     ${item.title} [${item.confidence}]`);
      continue;
    }
    writes.push(item);
  }

  return { decisions, remaining, writes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let raw;
  try {
    raw = await readFile(REVIEW_PATH, 'utf8');
  } catch {
    console.error(`No review file at ${path.relative(REPO_ROOT, REVIEW_PATH)}. Run npm run import-bulk first.`);
    process.exit(1);
  }

  const items = load(raw);
  if (!Array.isArray(items) || !items.length) {
    console.log('review.yaml has nothing left to review.');
    return;
  }

  // Re-derived fresh every run (never trusted from a prior pass) so re-running after a partial
  // failure - or just running twice - can never write the same URL under two different
  // filenames: resolveEntryPath only avoids colliding on an identical slug, not on the URL.
  const known = new Map();
  for (const e of await loadCollection('links')) {
    try {
      known.set(normalizeUrl(e.data.url), e.relPath);
    } catch {}
  }

  let decisions, remaining;

  // A `finally` around the actual writing, not just a try, because losing track of what has
  // and hasn't been written is worse than the failure itself: it is exactly what happened the
  // first time this ran into a title that wouldn't slugify - the process died mid-batch and
  // review.yaml still listed 203 pending items over entries that had, in fact, already landed.
  try {
    if (args.auto) {
      const result = runAuto(items, args.minConfidence);
      decisions = result.decisions;
      remaining = result.remaining;

      console.log(`\n  Writing ${result.writes.length} approved entries...`);
      for (const item of result.writes) {
        let canonical;
        try {
          canonical = normalizeUrl(item.url);
        } catch {
          console.log(`  skip (bad url)       ${item.title}`);
          decisions.skipped++;
          remaining.push(item);
          continue;
        }
        if (known.has(canonical)) {
          // Already written - by an earlier, interrupted run of this exact command, most
          // likely. Not pushed to `remaining`: it isn't pending, it's done. Counted separately
          // from `skipped` so the final summary can't conflate the two the way it used to.
          console.log(`  skip (already have)  ${item.title}`);
          decisions.alreadyPresent++;
          continue;
        }

        try {
          const written = await writeApproved(item);
          console.log(`  wrote  ${written.filePath}  (favicon: ${written.favicon}, cover: ${written.cover})`);
          known.set(canonical, written.filePath);
          decisions.approved++;
        } catch (err) {
          console.log(`  FAILED               ${item.title} - ${err.message}`);
          decisions.skipped++;
          remaining.push(item);
        }
      }
    } else {
      ({ decisions, remaining } = await runInteractive(items));
    }
  } finally {
    const toPersist = remaining ?? items;
    if (toPersist.length) {
      const header = `# Bulk-import review file - ${toPersist.length} entries still pending.
# Regenerate from scratch with npm run import-bulk, or keep reviewing with npm run import-review.
`;
      await writeFile(REVIEW_PATH, header + dump(toPersist, { lineWidth: 100, noRefs: true }), 'utf8');
    } else {
      await unlink(REVIEW_PATH).catch(() => {});
    }
  }

  console.log(
    `\n  ${decisions.approved} approved, ${decisions.rejected} rejected, ` +
      `${decisions.alreadyPresent} already had, ${remaining?.length ?? 0} left pending in review.yaml.`,
  );

  if (decisions.approved > 0) {
    console.log('\n  Validating the dataset...');
    const result = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'validate.mjs')], {
      encoding: 'utf8',
      stdio: 'inherit',
    });
    process.exitCode = result.status ?? 0;
  }
}

main().catch((err) => {
  console.error(`\n  import-review.mjs failed: ${err.message}`);
  console.error(err.stack?.split('\n').slice(1, 4).join('\n') ?? '');
  process.exit(1);
});
