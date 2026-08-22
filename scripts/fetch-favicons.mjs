#!/usr/bin/env node
/**
 * Fetches and caches a favicon for every entry in data/links/** and data/companies/**.
 *
 * Run by deploy.yml before the Astro build, so a freshly-merged entry (e.g. from an issue-form
 * PR, which doesn't cache its own favicon) gets one cached before the site is built. Also safe
 * to run locally at any time - already-cached entries are skipped, so repeat runs only do work
 * for entries that are new since the last run.
 *
 * Never fails the build over a single entry's favicon: a dead site, a missing icon, or a timeout
 * just leaves that entry without a cached file, and Favicon.astro's letter-initial fallback
 * handles that correctly. Only a structural problem (can't read the dataset at all) exits non-zero.
 *
 * Usage:
 *   node scripts/fetch-favicons.mjs             fetch anything not already cached
 *   node scripts/fetch-favicons.mjs --force     refetch everything, ignoring the cache
 */

import { loadCollection } from './lib/yaml-io.mjs';
import { fetchFaviconForEntry } from './lib/favicon.mjs';

const CONCURRENCY = 6;
const force = process.argv.includes('--force');

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runNext() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

async function main() {
  const [links, companies] = await Promise.all([
    loadCollection('links'),
    loadCollection('companies'),
  ]);

  const targets = [
    ...links.map((e) => ({ kind: 'links', slug: e.slug, url: e.data?.url, relPath: e.relPath })),
    ...companies.map((e) => ({
      kind: 'companies',
      slug: e.slug,
      url: e.data?.website,
      relPath: e.relPath,
    })),
  ];

  console.log(`  Checking favicons for ${targets.length} entries${force ? ' (--force)' : ''}...`);

  const results = await runPool(targets, CONCURRENCY, async (target) => {
    if (typeof target.url !== 'string') {
      return { ...target, status: 'failed', reason: 'no URL on this entry' };
    }
    const result = await fetchFaviconForEntry(target.kind, target.slug, target.url, { force });
    return { ...target, ...result };
  });

  const saved = results.filter((r) => r.status === 'saved');
  const skipped = results.filter((r) => r.status === 'skipped');
  const failed = results.filter((r) => r.status === 'failed');

  if (saved.length) {
    console.log(`\n  Fetched ${saved.length}:`);
    for (const r of saved) console.log(`    ${r.kind}/${r.slug}.${r.ext}  <-  ${r.relPath}`);
  }

  if (failed.length) {
    console.log(`\n  No favicon cached for ${failed.length} (falls back to a letter initial):`);
    for (const r of failed) console.log(`    ${r.relPath}  -  ${r.reason}`);
  }

  console.log(
    `\n  Done - ${saved.length} fetched, ${skipped.length} already cached, ${failed.length} unavailable.`,
  );
}

main().catch((err) => {
  console.error(`\n  fetch-favicons.mjs failed: ${err.message}`);
  process.exit(1);
});
