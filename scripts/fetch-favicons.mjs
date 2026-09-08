#!/usr/bin/env node
/**
 * Fetches and caches a favicon AND a cover image for every entry in the dataset.
 *
 * Run by deploy.yml before the Astro build, so a freshly-merged entry (e.g. from an issue-form
 * PR, which doesn't cache its own assets at parse time) gets them cached before the site is
 * built. Also safe to run locally at any time - already-cached entries are skipped, so repeat
 * runs only do work for entries that are new since the last run.
 *
 * Never fails the build over a single entry's assets: a dead site, a missing icon/og:image, or a
 * timeout just leaves that entry without a cached file, and Favicon.astro/Cover.astro fall back
 * to a letter initial / nothing. Only a structural problem (can't read the dataset at all) exits
 * non-zero.
 *
 * Usage:
 *   node scripts/fetch-favicons.mjs             fetch anything not already cached
 *   node scripts/fetch-favicons.mjs --force     refetch everything, ignoring the cache
 */

import { loadEntries } from './lib/yaml-io.mjs';
import { fetchFaviconForEntry, fetchCoverForEntry } from './lib/enrich.mjs';

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
  const targets = (await loadEntries()).map((e) => ({
    slug: e.slug,
    url: e.data?.url,
    relPath: e.relPath,
  }));

  console.log(`  Checking favicons and covers for ${targets.length} entries${force ? ' (--force)' : ''}...`);

  const results = await runPool(targets, CONCURRENCY, async (target) => {
    if (typeof target.url !== 'string') {
      return { ...target, favicon: { status: 'failed', reason: 'no URL on this entry' }, cover: { status: 'failed', reason: 'no URL on this entry' } };
    }
    const [favicon, cover] = await Promise.all([
      fetchFaviconForEntry(target.slug, target.url, { force }),
      fetchCoverForEntry(target.slug, target.url, { force }),
    ]);
    return { ...target, favicon, cover };
  });

  const summarize = (key, label) => {
    const saved = results.filter((r) => r[key].status === 'saved');
    const skipped = results.filter((r) => r[key].status === 'skipped');
    const failed = results.filter((r) => r[key].status === 'failed');

    if (saved.length) {
      console.log(`\n  ${label} fetched ${saved.length}:`);
      for (const r of saved) console.log(`    ${r.slug}.${r[key].ext}  <-  ${r.relPath}`);
    }
    if (failed.length) {
      console.log(`\n  No ${label.toLowerCase()} cached for ${failed.length}:`);
      for (const r of failed) console.log(`    ${r.relPath}  -  ${r[key].reason}`);
    }
    console.log(
      `\n  ${label}: ${saved.length} fetched, ${skipped.length} already cached, ${failed.length} unavailable.`,
    );
  };

  summarize('favicon', 'Favicons');
  summarize('cover', 'Covers');
}

main().catch((err) => {
  console.error(`\n  fetch-favicons.mjs failed: ${err.message}`);
  process.exit(1);
});
