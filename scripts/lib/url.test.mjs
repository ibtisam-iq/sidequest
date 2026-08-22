import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, sameUrl } from './url.mjs';

test('forces https and lowercases the host', () => {
  assert.equal(normalizeUrl('HTTP://Example.COM/Path'), 'https://example.com/Path');
});

test('strips a leading www', () => {
  assert.equal(normalizeUrl('https://www.warp.dev'), 'https://warp.dev/');
});

test('strips tracking params but keeps meaningful ones', () => {
  assert.equal(
    normalizeUrl('https://example.com/x?utm_source=a&id=7&fbclid=z'),
    'https://example.com/x?id=7',
  );
});

test('sorts query params so order does not create a false distinction', () => {
  assert.equal(normalizeUrl('https://example.com/?b=2&a=1'), normalizeUrl('https://example.com/?a=1&b=2'));
});

test('drops the fragment', () => {
  assert.equal(normalizeUrl('https://example.com/docs#section-3'), 'https://example.com/docs');
});

test('drops a trailing slash on a path but keeps it on a bare origin', () => {
  assert.equal(normalizeUrl('https://example.com/docs/'), 'https://example.com/docs');
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
});

test('assumes https when no protocol is given', () => {
  assert.equal(normalizeUrl('example.com/x'), 'https://example.com/x');
});

test('paths stay case-sensitive because they can be', () => {
  assert.notEqual(normalizeUrl('https://example.com/A'), normalizeUrl('https://example.com/a'));
});

test('sameUrl matches across all the noisy variations at once', () => {
  assert.ok(sameUrl('http://WWW.Example.com/x/?utm_campaign=q#top', 'https://example.com/x'));
});

test('sameUrl is false rather than throwing on garbage input', () => {
  assert.equal(sameUrl('not a url at all', 'https://example.com'), false);
});

test('rejects empty input', () => {
  assert.throws(() => normalizeUrl(''), TypeError);
});
