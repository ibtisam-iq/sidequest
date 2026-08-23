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
import {
  readTaxonomy,
  resolveCategoryPath,
  LEGAL_RISK_REQUIRED_CATEGORIES,
} from './lib/taxonomy.mjs';
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

/**
 * Companies stay flat: `country` must be a registered top-level companies slug, and the file
 * must sit directly in `data/career/companies/<country>/`.
 */
function checkCompanyTaxonomy(entries, taxonomy) {
  const registered = new Set(
    taxonomy.filter((c) => c.type === 'companies' && !c.parent).map((c) => c.slug),
  );

  for (const entry of entries) {
    const value = entry.data?.country;
    if (typeof value !== 'string') continue; // schema already flagged it

    if (!registered.has(value)) {
      fail(
        entry.relPath,
        `country "${value}" is not registered in taxonomy/categories.yaml with type: companies. ` +
          `Add it there (or via npm run add-company) before using it.`,
      );
    }

    if (entry.categoryPath !== value) {
      fail(
        entry.relPath,
        `country is "${value}" but the file sits at "data/career/companies/${entry.categoryPath}" - they must match`,
      );
    }
  }
}

/**
 * Links are an arbitrary-depth tree: `category` must resolve to a chain of registered
 * categories starting at one of the six roots, to any depth, and the file must sit at the
 * matching folder path.
 */
async function checkLinkTaxonomy(entries) {
  for (const entry of entries) {
    const value = entry.data?.category;
    if (typeof value !== 'string') continue; // schema already flagged it

    const resolved = await resolveCategoryPath('links', value);
    if (!resolved.valid) {
      fail(
        entry.relPath,
        `category "${value}" does not resolve against taxonomy/categories.yaml: ${resolved.reason}. ` +
          `Add it there (or via npm run add-link) before using it.`,
      );
      continue;
    }

    if (entry.categoryPath !== value) {
      fail(
        entry.relPath,
        `category is "${value}" but the file sits at "data/${entry.categoryPath}" - they must match`,
      );
    }
  }
}

/**
 * Content-integrity rule, not a suggestion: every entry filed under one of the shadow-library
 * leaf categories must disclose legal_risk: true, regardless of what the schema alone would
 * allow - and nothing outside those categories may set it, so the badge stays meaningful rather
 * than becoming generic "be careful" noise. A mismatch here is a data problem, not a style nit,
 * so it fails the build like anything else.
 */
function checkLegalRisk(entries) {
  for (const entry of entries) {
    const category = entry.data?.category;
    if (typeof category !== 'string') continue;

    const requiresDisclosure = LEGAL_RISK_REQUIRED_CATEGORIES.includes(category);

    if (requiresDisclosure && entry.data?.legal_risk !== true) {
      fail(
        entry.relPath,
        `category "${category}" requires legal_risk: true - every entry under ` +
          `${LEGAL_RISK_REQUIRED_CATEGORIES.join(', ')} must disclose this, it is not optional.`,
      );
    }

    if (!requiresDisclosure && entry.data?.legal_risk === true) {
      fail(
        entry.relPath,
        `legal_risk: true is only valid under ${LEGAL_RISK_REQUIRED_CATEGORIES.join(', ')} - ` +
          `"${category}" is not one of them.`,
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
    const group = counts.get(category.type);
    const path = category.parent ? `${category.parent}/${category.slug}` : category.slug;
    const hasChildren =
      !category.parent && taxonomy.some((c) => c.type === category.type && c.parent === category.slug);

    const n = reportCountFor(group ?? new Map(), path, hasChildren);
    if (!n) {
      warn(
        'taxonomy/categories.yaml',
        `category "${path}" (${category.type}) has no entries yet`,
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

/** Direct count for an exact path, plus (for a parent) every entry filed under its children too. */
function reportCountFor(counts, slug, isParentWithChildren) {
  let n = counts.get(slug) ?? 0;
  if (isParentWithChildren) {
    for (const [key, value] of counts) {
      if (key.startsWith(`${slug}/`)) n += value;
    }
  }
  return n;
}

function printReport(taxonomy, counts) {
  console.log('\n  Entry counts (computed, never stored)\n');

  for (const type of ['links', 'companies']) {
    const group = counts.get(type);
    const registered = taxonomy.filter((c) => c.type === type);
    const topLevel = registered.filter((c) => !c.parent);
    const total = [...group.values()].reduce((a, b) => a + b, 0);

    console.log(`  ${type} - ${total} entries across ${topLevel.length} top-level`);
    for (const parent of topLevel) {
      const children = registered.filter((c) => c.parent === parent.slug);
      const n = reportCountFor(group, parent.slug, children.length > 0);
      console.log(`    ${String(n).padStart(4)}  ${parent.slug}`);
      for (const child of children) {
        const childCount = reportCountFor(group, `${parent.slug}/${child.slug}`, false);
        console.log(`    ${String(childCount).padStart(4)}    - ${child.slug}`);
      }
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
  await checkLinkTaxonomy(links);
  checkCompanyTaxonomy(companies, taxonomy);
  checkAlternatives(links);
  checkLegalRisk(links);

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
