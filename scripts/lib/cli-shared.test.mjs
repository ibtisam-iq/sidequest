/**
 * Exercises the interactive category picker without a TTY by mocking the prompt layer.
 *
 * Links are now a two-level pick (one of the six life-domain roots, then optionally one of its
 * subcategories), and the fuzzy "did you mean" check must be scoped to siblings at whichever
 * level is being picked - that scoping is the whole reason "AI Chat Assistant" (singular) never
 * gets compared against a subcategory of a different root just because both happen to be
 * subcategories of something. That guarantee is worth testing directly, not just the distance
 * function underneath it.
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

// Every folder any test's addCategory call creates - git won't flag a leaked empty directory,
// so they have to be listed explicitly for cleanup. These are all TOP-LEVEL test folders; none
// collide with the real career/job-boards or technology/ai-chat-assistants subcategories.
const CREATED_DIRS = [
  ['careers'],
  ['podcasts'],
  ['job-boards'],
  ['sandbox-flat-test'],
  ['technology', 'ai-benchmarks'],
].map((segments) => path.join(REPO_ROOT, 'data', 'links', ...segments));

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
let addCategory;

before(async () => {
  taxonomySnapshot = await readFile(TAXONOMY, 'utf8');
  mock.module('@clack/prompts', { namedExports: clackMock });
  ({ pickCategory } = await import('./cli-shared.mjs'));
  ({ addCategory } = await import('./taxonomy.mjs'));

  // Seed one genuinely flat top-level category (no subcategories) directly through the
  // taxonomy lib, bypassing the mocked picker - all six real roots (career, faith, finance,
  // learning, lifestyle, technology) now have subcategories, so there is no longer a naturally
  // flat existing top-level to exercise the "choosing none" path against.
  await addCategory({ slug: 'sandbox-flat-test', name: 'Sandbox Flat Test', type: 'links' });
});

after(async () => {
  await writeFile(TAXONOMY, taxonomySnapshot, 'utf8');
  for (const dir of CREATED_DIRS) await rm(dir, { recursive: true, force: true });
});

test('an existing top-level category with an existing subcategory resolves to the full path', async () => {
  setScript({ select: ['technology', 'ai-coding-agents'] });
  assert.equal(await pickCategory('links'), 'technology/ai-coding-agents');
  assert.equal(scripted.textCalls, 0, 'picking two existing entries needs no free text at all');
});

test('choosing "none" under an existing flat category returns just the parent slug', async () => {
  setScript({ select: ['sandbox-flat-test', '__none__'] });
  assert.equal(await pickCategory('links'), 'sandbox-flat-test');
});

test('warns when a new top-level category is a near-duplicate of an existing one', async () => {
  setScript({ select: ['__new__', 'career', '__none__'], text: ['Careers'] });

  const result = await pickCategory('links');

  assert.equal(result, 'career', 'accepting the suggestion should return the existing slug');
  assert.equal(scripted.warnings.length, 1, 'exactly one near-duplicate warning should be shown');
  assert.match(scripted.warnings[0], /you typed "careers"/i);
  assert.match(scripted.warnings[0], /career/);
});

test('lets the user override the suggestion when the top-level category is genuinely different', async () => {
  setScript({
    select: ['__new__', '__keep__', '__none__'],
    text: ['Careers', 'Careers'],
  });

  const result = await pickCategory('links');

  assert.equal(result, 'careers', 'overriding should keep the slug the user typed');
  assert.equal(scripted.warnings.length, 1, 'the warning should still have been shown first');
});

test('no warning for a genuinely new top-level category', async () => {
  setScript({ select: ['__new__', '__none__'], text: ['Podcasts', 'Podcasts'] });

  const result = await pickCategory('links');

  assert.equal(result, 'podcasts');
  assert.deepEqual(scripted.warnings, [], 'a distinct category must not be flagged as a typo');
  assert.match(await readFile(TAXONOMY, 'utf8'), /slug: podcasts/);
});

test('a new subcategory is fuzzy-checked only against siblings of the same parent', async () => {
  // "AI Chat Assistant" (singular) is a near-duplicate of the existing "ai-chat-assistants" -
  // but only because they are both children of technology. Accepting the suggestion must
  // resolve to the existing sibling without creating anything new.
  setScript({
    select: ['technology', '__new__', 'ai-chat-assistants'],
    text: ['AI Chat Assistant'],
  });

  const result = await pickCategory('links');

  assert.equal(result, 'technology/ai-chat-assistants');
  assert.equal(scripted.warnings.length, 1);
  assert.match(scripted.warnings[0], /ai-chat-assistants/);
});

test('creating a new subcategory registers it and creates the nested folder', async () => {
  setScript({
    select: ['technology', '__new__', '__keep__'],
    text: ['AI Benchmarks', 'AI Benchmarks'],
  });

  const result = await pickCategory('links');

  assert.equal(result, 'technology/ai-benchmarks');
  const written = await readFile(TAXONOMY, 'utf8');
  assert.match(written, /slug: ai-benchmarks/);
  assert.match(written, /parent: technology/);
});

test('a new top-level category is never fuzzy-matched against an unrelated subcategory slug', async () => {
  // "job-boards" already exists in the registry, but only as a subcategory of career. A
  // brand-new TOP-LEVEL category with that exact name must not be flagged as a near-duplicate -
  // it is being compared against other top-level categories, not the whole registry, and no
  // top-level category is textually close to "job-boards".
  setScript({ select: ['__new__', '__none__'], text: ['Job Boards', 'Job Boards'] });

  const result = await pickCategory('links');

  assert.equal(result, 'job-boards', 'a distinct top-level category, not the existing subcategory path');
  assert.deepEqual(
    scripted.warnings,
    [],
    'the existing career/job-boards subcategory must not leak into this scope',
  );
});

test('selecting two existing entries skips the new-category flow entirely', async () => {
  setScript({ select: ['technology', 'cli-terminal'] });

  assert.equal(await pickCategory('links'), 'technology/cli-terminal');
  assert.equal(scripted.selectCalls, 2, 'top-level pick + subcategory pick, nothing else');
  assert.deepEqual(scripted.warnings, []);
});

test('company countries stay a single flat pick, fuzzy-checked against the companies registry', async () => {
  setScript({ select: ['__new__', 'pakistan'], text: ['Pakistn'] });

  assert.equal(await pickCategory('companies'), 'pakistan');
  assert.match(scripted.warnings[0], /pakistan/);
});
