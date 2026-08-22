#!/usr/bin/env node
/**
 * The gate. Validates the entire dataset.
 *
 * This exact script is what runs locally (`npm run validate`), in the PR gate (validate.yml),
 * and before every deploy (deploy.yml) - CI and local cannot drift because there is only one
 * implementation.
 *
 * Modes:
 *   validate.mjs                          validate everything, exit 1 on any error
 *   validate.mjs --report                 also print per-category entry counts
 *   validate.mjs --check-duplicate-url U  exit 2 if U already exists (used by issue-to-pr.yml)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { PATHS, loadCollection, REPO_ROOT } from './lib/yaml-io.mjs';
import { readTaxonomy } from './lib/taxonomy.mjs';
import { normalizeUrl } from './lib/url.mjs';

const errors = [];
const warnings = [];

const fail = (where, message) => errors.push({ where, message });
const warn = (where, message) => warnings.push({ where, message });

async function buildValidators() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const [link, company] = await Promise.all([
    readFile(path.join(PATHS.schema, 'link.schema.json'), 'utf8').then(JSON.parse),
    readFile(path.join(PATHS.schema, 'company.schema.json'), 'utf8').then(JSON.parse),
  ]);

  return { links: ajv.compile(link), companies: ajv.compile(company) };
}

function checkSchema(entries, validator) {
  for (const entry of entries) {
    if (entry.data === null || typeof entry.data !== 'object' || Array.isArray(entry.data)) {
      fail(entry.relPath, 'file is empty or is not a YAML mapping');
      continue;
    }
    if (validator(entry.data)) continue;

    for (const err of validator.errors) {
      const at = err.instancePath || '(root)';
      const extra = err.params?.additionalProperty
        ? ` ("${err.params.additionalProperty}")`
        : err.params?.allowedValues
          ? ` (allowed: ${err.params.allowedValues.join(', ')})`
          : '';
      fail(entry.relPath, `${at} ${err.message}${extra}`);
    }
  }
}

/** Slugs must be unique WITHIN a collection. A link and a company may share one. */
function checkSlugUniqueness(entries, kind) {
  const seen = new Map();
  for (const entry of entries) {
    const first = seen.get(entry.slug);
    if (first) {
      fail(
        entry.relPath,
        `duplicate ${kind} slug "${entry.slug}" - already defined in ${first}. ` +
          `Slugs must be unique within data/${kind}/ so that alternatives can reference them unambiguously.`,
      );
      continue;
    }
    seen.set(entry.slug, entry.relPath);
  }
}

/** Duplicate URLs are checked across the WHOLE dataset - links and companies together. */
function checkDuplicateUrls(links, companies) {
  const seen = new Map();

  const record = (entry, rawUrl) => {
    if (typeof rawUrl !== 'string') return;
    let canonical;
    try {
      canonical = normalizeUrl(rawUrl);
    } catch {
      return; // schema validation already reported the malformed URL
    }
    const first = seen.get(canonical);
    if (first) {
      fail(
        entry.relPath,
        `duplicate URL - ${canonical} is already catalogued in ${first}`,
      );
      return;
    }
    seen.set(canonical, entry.relPath);
  };

  for (const entry of links) record(entry, entry.data?.url);
  for (const entry of companies) record(entry, entry.data?.website);

  return seen;
}

function checkTaxonomy(entries, kind, taxonomy) {
  const field = kind === 'links' ? 'category' : 'country';
  const registered = new Set(taxonomy.filter((c) => c.type === kind).map((c) => c.slug));

  for (const entry of entries) {
    const value = entry.data?.[field];
    if (typeof value !== 'string') continue; // schema already flagged it

    if (!registered.has(value)) {
      fail(
        entry.relPath,
        `${field} "${value}" is not registered in taxonomy/categories.yaml with type: ${kind}. ` +
          `Add it there (or via npm run add-${kind === 'links' ? 'link' : 'company'}) before using it.`,
      );
    }

    if (entry.folder !== value) {
      fail(
        entry.relPath,
        `${field} is "${value}" but the file sits in folder "${entry.folder}" - they must match`,
      );
    }
  }
}

/** `alternatives` may only reference real link slugs, and never itself. */
function checkAlternatives(links) {
  const known = new Set(links.map((e) => e.slug));

  for (const entry of links) {
    const alts = entry.data?.alternatives;
    if (!Array.isArray(alts)) continue;

    for (const alt of alts) {
      if (alt === entry.slug) {
        fail(entry.relPath, `alternatives lists itself ("${alt}")`);
      } else if (!known.has(alt)) {
        fail(
          entry.relPath,
          `alternatives references "${alt}", which is not an existing link entry slug`,
        );
      }
    }
  }
}

/** Registered categories with no entries are fine, but worth surfacing. */
function checkEmptyCategories(taxonomy, counts) {
  for (const category of taxonomy) {
    if (!counts.get(category.type)?.get(category.slug)) {
      warn(
        'taxonomy/categories.yaml',
        `category "${category.slug}" (${category.type}) has no entries yet`,
      );
    }
  }
}

function countByGroup(entries, field) {
  const counts = new Map();
  for (const entry of entries) {
    const key = entry.data?.[field];
    if (typeof key === 'string') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function printReport(taxonomy, counts) {
  console.log('\n  Entry counts (computed, never stored)\n');
  for (const type of ['links', 'companies']) {
    const group = counts.get(type);
    const registered = taxonomy.filter((c) => c.type === type);
    const total = [...group.values()].reduce((a, b) => a + b, 0);

    console.log(`  ${type} - ${total} entries across ${registered.length} registered`);
    for (const category of registered) {
      const n = group.get(category.slug) ?? 0;
      console.log(`    ${String(n).padStart(4)}  ${category.slug}`);
    }
    console.log('');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const wantsReport = args.includes('--report');
  const dupFlag = args.indexOf('--check-duplicate-url');

  const [validators, taxonomy, links, companies] = await Promise.all([
    buildValidators(),
    readTaxonomy(),
    loadCollection('links'),
    loadCollection('companies'),
  ]);

  checkSchema(links, validators.links);
  checkSchema(companies, validators.companies);
  checkSlugUniqueness(links, 'links');
  checkSlugUniqueness(companies, 'companies');
  const urlIndex = checkDuplicateUrls(links, companies);
  checkTaxonomy(links, 'links', taxonomy);
  checkTaxonomy(companies, 'companies', taxonomy);
  checkAlternatives(links);

  const counts = new Map([
    ['links', countByGroup(links, 'category')],
    ['companies', countByGroup(companies, 'country')],
  ]);
  checkEmptyCategories(taxonomy, counts);

  // --check-duplicate-url: a question, not a validation. Answer it and exit.
  if (dupFlag !== -1) {
    const candidate = args[dupFlag + 1];
    if (!candidate) {
      console.error('--check-duplicate-url requires a URL argument');
      process.exit(1);
    }
    let canonical;
    try {
      canonical = normalizeUrl(candidate);
    } catch (err) {
      console.error(`Invalid URL: ${err.message}`);
      process.exit(1);
    }
    const existing = urlIndex.get(canonical);
    if (existing) {
      console.log(`DUPLICATE\t${canonical}\t${existing}`);
      process.exit(2);
    }
    console.log(`OK\t${canonical}`);
    process.exit(0);
  }

  const total = links.length + companies.length;

  for (const { where, message } of warnings) {
    console.warn(`  warn  ${where}\n        ${message}`);
  }

  if (errors.length) {
    console.error(`\n  ${errors.length} error(s) in ${total} entries:\n`);
    for (const { where, message } of errors) {
      console.error(`  error  ${where}\n         ${message}\n`);
    }
    process.exit(1);
  }

  console.log(
    `\n  OK - ${total} entries valid (${links.length} links, ${companies.length} companies)` +
      `${warnings.length ? `, ${warnings.length} warning(s)` : ''}`,
  );

  if (wantsReport) printReport(taxonomy, counts);
}

main().catch((err) => {
  console.error(`\n  validate.mjs failed: ${err.message}`);
  console.error(err.stack?.split('\n').slice(1, 4).join('\n') ?? '');
  process.exit(1);
});
