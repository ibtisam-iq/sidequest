import test from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory } from './import-heuristics.mjs';

test('a known domain resolves at high confidence with its registered category', () => {
  const result = guessCategory({ title: 'roadmap.sh', excerpt: '', url: 'https://roadmap.sh/' });
  assert.equal(result.categoryPath, 'technology/roadmaps-references');
  assert.equal(result.confidence, 'high');
  assert.equal(result.legalRisk, false);
});

test('a shadow-library domain carries legal_risk regardless of title/excerpt content', () => {
  const result = guessCategory({
    title: 'Totally Normal Bookshop',
    excerpt: 'nothing suspicious here',
    url: 'https://sci-hub.se/',
  });
  assert.equal(result.categoryPath, 'learning/books-academic-papers');
  assert.equal(result.legalRisk, true);
});

test('legal_risk is never set for a domain outside shadow-libraries', () => {
  const result = guessCategory({ title: 'GitLab', excerpt: '', url: 'https://about.gitlab.com' });
  assert.equal(result.legalRisk, false);
});

test('an Islamic lecture is recognised by keyword even off an unlisted YouTube URL', () => {
  const result = guessCategory({
    title: 'Maulana Ishaq - Shahadat e Ali as -FRI-03032006',
    excerpt: '',
    url: 'https://www.youtube.com/watch?v=5PRbRDt1mgM',
  });
  assert.equal(result.categoryPath, 'faith/lectures');
  assert.equal(result.confidence, 'medium');
});

test('keyword matching tolerates inconsistent hyphenation in scraped titles', () => {
  // "Khila-fat" vs the keyword "khilafat" - a real mismatch found during this import.
  const result = guessCategory({
    title: 'Khila-fat Malookiat me Kesay Tabdeel Hui',
    excerpt: '',
    url: 'https://youtube.com/watch?v=O8CaqN1m4IQ',
  });
  assert.equal(result.categoryPath, 'faith/lectures');
});

test('an unrecognised domain with no keyword match reports low confidence and no guess', () => {
  const result = guessCategory({
    title: 'Muslim Matchmaking & Marriage Service',
    excerpt: 'marriage service for single Muslims',
    url: 'https://personalmatchuk.co.uk/',
  });
  assert.equal(result.categoryPath, null);
  assert.equal(result.confidence, 'low');
});

test('a malformed URL never throws - it just fails to match anything', () => {
  const result = guessCategory({ title: 'Broken', excerpt: '', url: 'not a url' });
  assert.equal(result.categoryPath, null);
  assert.equal(result.legalRisk, false);
});
