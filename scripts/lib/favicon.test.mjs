import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';

/**
 * cachedFaviconExt and fetchFaviconForEntry both resolve the favicon directory from REPO_ROOT
 * (via yaml-io.mjs), so REPO_ROOT is mocked to a scratch directory here rather than touching the
 * real site/public/favicons/ - these tests must never depend on network access or leave files in
 * the real repo.
 */

let scratch;

test.before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'sidequest-favicon-test-'));
  mock.module('./yaml-io.mjs', {
    namedExports: { REPO_ROOT: `${scratch}/` },
  });
});

test.after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

test('cachedFaviconExt finds an exact slug match and ignores near-miss filenames', async () => {
  const { cachedFaviconExt } = await import('./favicon.mjs');
  const dir = path.join(scratch, 'site', 'public', 'favicons', 'links');
  await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }));
  await writeFile(path.join(dir, 'warp.png'), Buffer.from([0]));
  await writeFile(path.join(dir, 'warp-2.ico'), Buffer.from([0]));

  assert.equal(await cachedFaviconExt('links', 'warp'), 'png');
  assert.equal(await cachedFaviconExt('links', 'warp-2'), 'ico');
  assert.equal(await cachedFaviconExt('links', 'warp-3'), null, 'must not prefix-match');
});

test('cachedFaviconExt returns null when the collection has no favicons yet', async () => {
  const { cachedFaviconExt } = await import('./favicon.mjs');
  assert.equal(await cachedFaviconExt('companies', 'nobody-yet'), null);
});

test('fetchFaviconForEntry rejects a non-URL without making any network call', async () => {
  const { fetchFaviconForEntry } = await import('./favicon.mjs');
  const result = await fetchFaviconForEntry('links', 'bad', 'not a url');
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /not a valid absolute URL/);
});

test('fetchFaviconForEntry skips a slug that already has a cached file', async () => {
  const { fetchFaviconForEntry } = await import('./favicon.mjs');
  const dir = path.join(scratch, 'site', 'public', 'favicons', 'companies');
  await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }));
  await writeFile(path.join(dir, 'already-cached.svg'), Buffer.from([0]));

  const result = await fetchFaviconForEntry('companies', 'already-cached', 'https://example.com');
  assert.deepEqual(result, { status: 'skipped', ext: 'svg' });
});

test('fetchFaviconForEntry reports failure rather than throwing for an unreachable host', async () => {
  const { fetchFaviconForEntry } = await import('./favicon.mjs');
  const result = await fetchFaviconForEntry(
    'links',
    'unreachable',
    'https://this-host-does-not-exist.sidequest-test.invalid',
  );
  assert.equal(result.status, 'failed');
});
