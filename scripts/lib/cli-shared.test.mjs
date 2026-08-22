/**
 * Exercises the interactive category picker without a TTY by mocking the prompt layer.
 *
 * The fuzzy "did you mean" warning is the whole reason the taxonomy doesn't fragment into
 * ai-tool / ai-tools / ai_tools, so it is worth testing the real code path rather than only
 * the distance function underneath it.
 *
 * Registering a genuinely-new category really does write to taxonomy/categories.yaml, so the
 * file is snapshotted and restored around the suite - a test must never leave the repo dirty.
 *
 * Run via `npm test` (the module-mocks flag is set in package.json).
 */

import test, { mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TAXONOMY = path.join(REPO_ROOT, 'taxonomy', 'categories.yaml');
// Every slug any test registers - addCategory creates the folder as well as the registry row,
// and git won't flag a leaked empty directory, so they have to be listed explicitly.
const CREATED_DIRS = ['podcasts', 'ai-tool'].map((slug) =>
  path.join(REPO_ROOT, 'data', 'links', slug),
);

let taxonomySnapshot;

/** Mutable script the single mocked prompt module reads from. */
const scripted = { select: [], text: [], warnings: [], selectCalls: 0, textCalls: 0 };

function setScript({ select = [], text = [] }) {
  scripted.select = select;
  scripted.text = text;
  scripted.warnings = [];
  scripted.selectCalls = 0;
  scripted.textCalls = 0;
}

const clackMock = {
  isCancel: () => false,
  cancel() {},
  intro() {},
  outro() {},
  spinner: () => ({ start() {}, stop() {} }),
  log: {
    warn: (m) => scripted.warnings.push(m),
    info() {},
    error() {},
    success() {},
  },
  select: async ({ options }) => {
    const answer = scripted.select[scripted.selectCalls++];
    // Guard the test itself: a scripted answer that isn't actually offered would make any
    // assertion downstream meaningless.
    assert.ok(
      options.some((o) => o.value === answer),
      `scripted answer "${answer}" was not offered; options were: ${options.map((o) => o.value).join(', ')}`,
    );
    return answer;
  },
  text: async () => scripted.text[scripted.textCalls++],
  confirm: async () => false,
  multiselect: async () => [],
};

let pickCategory;

before(async () => {
  taxonomySnapshot = await readFile(TAXONOMY, 'utf8');
  mock.module('@clack/prompts', { namedExports: clackMock });
  ({ pickCategory } = await import('./cli-shared.mjs'));
});

after(async () => {
  await writeFile(TAXONOMY, taxonomySnapshot, 'utf8');
  for (const dir of CREATED_DIRS) await rm(dir, { recursive: true, force: true });
});

test('warns when a new category is a near-duplicate of an existing one', async () => {
  setScript({ select: ['__new__', 'ai-tools'], text: ['AI Tool'] });

  const result = await pickCategory('links');

  assert.equal(result, 'ai-tools', 'accepting the suggestion should return the existing slug');
  assert.equal(scripted.warnings.length, 1, 'exactly one near-duplicate warning should be shown');
  assert.match(scripted.warnings[0], /you typed "ai-tool"/i);
  assert.match(scripted.warnings[0], /ai-tools/);
});

test('lets the user override the suggestion when the category is genuinely different', async () => {
  setScript({ select: ['__new__', '__keep__'], text: ['AI Tool', 'AI Tool'] });

  const result = await pickCategory('links');

  assert.equal(result, 'ai-tool', 'overriding should keep the slug the user typed');
  assert.equal(scripted.warnings.length, 1, 'the warning should still have been shown first');
});

test('no warning for a genuinely new category', async () => {
  setScript({ select: ['__new__'], text: ['Podcasts', 'Podcasts'] });

  const result = await pickCategory('links');

  assert.equal(result, 'podcasts');
  assert.deepEqual(scripted.warnings, [], 'a distinct category must not be flagged as a typo');

  // It should really have been registered - that is the other half of the contract.
  assert.match(await readFile(TAXONOMY, 'utf8'), /slug: podcasts/);
});

test('selecting an existing category skips the new-category flow entirely', async () => {
  setScript({ select: ['dev-tools'], text: [] });

  assert.equal(await pickCategory('links'), 'dev-tools');
  assert.equal(scripted.selectCalls, 1, 'should not have prompted a second time');
  assert.deepEqual(scripted.warnings, []);
});

test('company countries are fuzzy-checked against the companies registry, not links', async () => {
  setScript({ select: ['__new__', 'pakistan'], text: ['Pakistn'] });

  assert.equal(await pickCategory('companies'), 'pakistan');
  assert.match(scripted.warnings[0], /pakistan/);
});
