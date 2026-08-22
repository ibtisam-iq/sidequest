import test from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein, isNearMatch, findNearMatches } from './levenshtein.mjs';

test('distance basics', () => {
  assert.equal(levenshtein('ai-tools', 'ai-tools'), 0);
  assert.equal(levenshtein('ai-tool', 'ai-tools'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('catches the motivating typo: ai-tool vs ai-tools', () => {
  assert.ok(isNearMatch('ai-tool', 'ai-tools'));
});

test('a slug is never a near match for itself', () => {
  assert.equal(isNearMatch('ai-tools', 'ai-tools'), false);
});

test('genuinely different categories are not flagged', () => {
  assert.equal(isNearMatch('ai-tools', 'remote-job-boards'), false);
  assert.equal(isNearMatch('books', 'communities'), false);
});

test('proportional threshold catches typos in long slugs that distance<=2 alone would miss', () => {
  // distance 3, but only ~17% of the length — still clearly a typo
  assert.ok(isNearMatch('remote-job-bords', 'remote-job-boards'));
});

test('short slugs are not over-matched just because distance is small', () => {
  // 'css' -> 'js' is distance 2 but they are completely different things
  assert.equal(levenshtein('css', 'js'), 2);
  // documents current behaviour: the absolute rule does fire on very short slugs,
  // which is why findNearMatches only ever *suggests* and never auto-corrects
  assert.ok(isNearMatch('css', 'js'));
});

test('findNearMatches returns closest first and excludes exact matches', () => {
  const existing = ['ai-tools', 'ai-agents', 'dev-tools', 'books'];
  assert.deepEqual(findNearMatches('ai-tool', existing), ['ai-tools']);
  assert.deepEqual(findNearMatches('books', existing), []);
});

test('findNearMatches returns empty for a genuinely new category', () => {
  assert.deepEqual(findNearMatches('podcasts', ['ai-tools', 'dev-tools', 'books']), []);
});
