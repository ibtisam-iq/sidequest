import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, slugifyList, isValidSlug } from './slugify.mjs';

test('lowercases and kebab-cases', () => {
  assert.equal(slugify('AI Tools'), 'ai-tools');
  assert.equal(slugify('  Remote   Job Boards  '), 'remote-job-boards');
});

test('strips accents rather than dropping the letters', () => {
  assert.equal(slugify('Café Résumé'), 'cafe-resume');
});

test('keeps apostrophised words readable', () => {
  assert.equal(slugify("Don't Repeat Yourself"), 'dont-repeat-yourself');
});

test('spells out & and + instead of deleting them', () => {
  assert.equal(slugify('Design & Research'), 'design-and-research');
  assert.equal(slugify('C++'), 'c-plus-plus');
});

test('collapses punctuation runs and trims separators', () => {
  assert.equal(slugify('---Hello!!! World???---'), 'hello-world');
});

test('neutralises path traversal - this is the filename safety guarantee', () => {
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('..'), '');
  assert.equal(slugify('/'), '');
});

test('returns empty string for non-strings rather than throwing', () => {
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
});

test('slugifyList normalizes and de-duplicates', () => {
  assert.deepEqual(slugifyList(['AI', 'ai', 'Dev Tools', '']), ['ai', 'dev-tools']);
});

test('isValidSlug accepts kebab-case and rejects everything else', () => {
  assert.ok(isValidSlug('ai-tools'));
  assert.ok(isValidSlug('10pearls'));
  assert.ok(!isValidSlug('AI-Tools'));
  assert.ok(!isValidSlug('-leading'));
  assert.ok(!isValidSlug('trailing-'));
  assert.ok(!isValidSlug('double--dash'));
  assert.ok(!isValidSlug(''));
});
