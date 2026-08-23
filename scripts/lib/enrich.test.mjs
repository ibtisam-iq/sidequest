import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';

/**
 * cachedFaviconExt/cachedCoverExt and fetchFaviconForEntry both resolve their asset directory
 * from REPO_ROOT (via yaml-io.mjs), so REPO_ROOT is mocked to a scratch directory here rather
 * than touching the real site/public/{favicons,covers}/ - these tests must never depend on
 * network access or leave files in the real repo.
 */

let scratch;

test.before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'sidequest-enrich-test-'));
  mock.module('./yaml-io.mjs', {
    namedExports: { REPO_ROOT: `${scratch}/` },
  });
});

test.after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

test('cachedFaviconExt finds an exact slug match and ignores near-miss filenames', async () => {
  const { cachedFaviconExt } = await import('./enrich.mjs');
  const dir = path.join(scratch, 'site', 'public', 'favicons', 'links');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'warp.png'), Buffer.from([0]));
  await writeFile(path.join(dir, 'warp-2.ico'), Buffer.from([0]));

  assert.equal(await cachedFaviconExt('links', 'warp'), 'png');
  assert.equal(await cachedFaviconExt('links', 'warp-2'), 'ico');
  assert.equal(await cachedFaviconExt('links', 'warp-3'), null, 'must not prefix-match');
});

test('cachedFaviconExt returns null when the collection has no favicons yet', async () => {
  const { cachedFaviconExt } = await import('./enrich.mjs');
  assert.equal(await cachedFaviconExt('companies', 'nobody-yet'), null);
});

test('cachedCoverExt finds an exact slug match, namespaced separately from favicons', async () => {
  const { cachedCoverExt } = await import('./enrich.mjs');
  const dir = path.join(scratch, 'site', 'public', 'covers', 'links');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'ghostty.jpg'), Buffer.from([0]));

  assert.equal(await cachedCoverExt('links', 'ghostty'), 'jpg');
  assert.equal(await cachedCoverExt('links', 'warp'), null, 'a cached favicon must not count as a cover');
});

test('fetchFaviconForEntry rejects a non-URL without making any network call', async () => {
  const { fetchFaviconForEntry } = await import('./enrich.mjs');
  const result = await fetchFaviconForEntry('links', 'bad', 'not a url');
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /not a valid absolute URL/);
});

test('fetchFaviconForEntry skips a slug that already has a cached file', async () => {
  const { fetchFaviconForEntry } = await import('./enrich.mjs');
  const dir = path.join(scratch, 'site', 'public', 'favicons', 'companies');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'already-cached.svg'), Buffer.from([0]));

  const result = await fetchFaviconForEntry('companies', 'already-cached', 'https://example.com');
  assert.deepEqual(result, { status: 'skipped', ext: 'svg' });
});

test('fetchFaviconForEntry reports failure rather than throwing for an unreachable host', async () => {
  const { fetchFaviconForEntry } = await import('./enrich.mjs');
  const result = await fetchFaviconForEntry(
    'links',
    'unreachable',
    'https://this-host-does-not-exist.sidequest-test.invalid',
  );
  assert.equal(result.status, 'failed');
});

test('fetchCoverForEntry skips a slug that already has a cached cover', async () => {
  const { fetchCoverForEntry } = await import('./enrich.mjs');
  const dir = path.join(scratch, 'site', 'public', 'covers', 'companies');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'already-covered.png'), Buffer.from([0]));

  const result = await fetchCoverForEntry('companies', 'already-covered', 'https://example.com');
  assert.deepEqual(result, { status: 'skipped', ext: 'png' });
});

test('enrichEntry reports failure for both assets rather than throwing on a bad URL', async () => {
  const { enrichEntry } = await import('./enrich.mjs');
  const result = await enrichEntry('links', 'bad', 'not a url');
  assert.equal(result.favicon.status, 'failed');
  assert.equal(result.cover.status, 'failed');
  assert.equal(result.title, undefined);
});

test('fetchPageDetails never throws on an unreachable host and returns no candidates', async () => {
  const { fetchPageDetails } = await import('./enrich.mjs');
  const result = await fetchPageDetails('https://this-host-does-not-exist.sidequest-test.invalid');
  assert.equal(result.favicon, null);
  assert.equal(result.cover, null);
  assert.equal(result.title, undefined);
});

test('cacheCandidate skips when the slug already has a cached favicon', async () => {
  const { cacheCandidate } = await import('./enrich.mjs');
  const dir = path.join(scratch, 'site', 'public', 'favicons', 'links');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'precached.png'), Buffer.from([0]));

  const result = await cacheCandidate('links', 'precached', { buf: Buffer.from([1]), ext: 'jpg' });
  assert.deepEqual(result, { status: 'skipped', ext: 'png' });
});

test('cacheCandidate reports failure when there is no candidate and nothing cached', async () => {
  const { cacheCandidate } = await import('./enrich.mjs');
  const result = await cacheCandidate('links', 'nothing-found', null, { root: 'cover' });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /og:image/);
});

test('extractMeta does not truncate a description at an apostrophe inside a double-quoted attribute', async () => {
  // Regression: a naive [^"']* capture stops at the FIRST apostrophe, which is common enough in
  // real og:description text ("a workspace that doesn't...") to silently corrupt every such entry.
  const { extractMeta } = await import('./enrich.mjs');
  const html = `<html><head>
    <meta property="og:title" content="Zellij">
    <meta property="og:description" content="A terminal workspace that doesn't sacrifice simplicity for power.">
    <meta property="og:image" content="/img/preview.png">
  </head></html>`;

  const meta = extractMeta(html, 'https://zellij.dev/');
  assert.equal(meta.title, 'Zellij');
  assert.equal(meta.description, "A terminal workspace that doesn't sacrifice simplicity for power.");
  assert.equal(meta.imageUrl, 'https://zellij.dev/img/preview.png');
});

test('extractMeta falls back to the <title> tag and meta description when there is no og: variant', async () => {
  const { extractMeta } = await import('./enrich.mjs');
  const html = `<html><head>
    <title>Plain Page</title>
    <meta name="description" content="A page with no Open Graph tags at all.">
  </head></html>`;

  const meta = extractMeta(html, 'https://example.com/');
  assert.equal(meta.title, 'Plain Page');
  assert.equal(meta.description, 'A page with no Open Graph tags at all.');
  assert.equal(meta.imageUrl, undefined);
});
