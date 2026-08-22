import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvRecords } from './csv.mjs';

test('splits simple unquoted rows on commas and newlines', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('a quoted field may contain a comma', () => {
  assert.deepEqual(parseCsv('title,url\n"Hello, world",https://example.com\n'), [
    ['title', 'url'],
    ['Hello, world', 'https://example.com'],
  ]);
});

test('a quoted field may contain an embedded newline - the whole point of not line-splitting', () => {
  const csv = 'title,note\n"Line one\nLine two",fine\n';
  assert.deepEqual(parseCsv(csv), [
    ['title', 'note'],
    ['Line one\nLine two', 'fine'],
  ]);
});

test('a doubled quote inside a quoted field is an escaped literal quote', () => {
  assert.deepEqual(parseCsv('note\n"She said ""hi"" to me"\n'), [['note'], ['She said "hi" to me']]);
});

test('CRLF line endings are normalized rather than left embedded in fields', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('a trailing row with no final newline is still captured', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('parseCsvRecords keys each row by the header and skips fully-blank rows', () => {
  const csv = 'title,url\nGhostty,https://ghostty.org\n\n';
  assert.deepEqual(parseCsvRecords(csv), [{ title: 'Ghostty', url: 'https://ghostty.org' }]);
});

test('a short row still gets every header key, missing values as empty strings', () => {
  const csv = 'title,url,tags\nGhostty,https://ghostty.org\n';
  assert.deepEqual(parseCsvRecords(csv), [
    { title: 'Ghostty', url: 'https://ghostty.org', tags: '' },
  ]);
});
