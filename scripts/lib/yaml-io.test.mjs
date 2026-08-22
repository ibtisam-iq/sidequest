import test from 'node:test';
import assert from 'node:assert/strict';
import { load, dump } from 'js-yaml';

/**
 * The date invariant the whole schema depends on.
 *
 * js-yaml 5 defaults to the YAML 1.2 CORE schema, which does not coerce timestamps - but an
 * unquoted date would still be ambiguous to other YAML tooling, and JSON Schema declares
 * date_added as `type: string`. So: dates must survive a write/read round-trip as strings.
 * If a future js-yaml upgrade changes that, this test fails loudly instead of silently turning
 * every date into a Date object.
 */

test('a quoted date round-trips as a string', () => {
  const round = load(dump({ date_added: '2026-08-22' }));
  assert.equal(typeof round.date_added, 'string');
  assert.equal(round.date_added, '2026-08-22');
});

test('dump quotes date-shaped strings so they cannot be re-read as timestamps', () => {
  assert.match(dump({ date_added: '2026-08-22' }), /date_added: ['"]2026-08-22['"]/);
});

test('an unquoted date in hand-written YAML still loads as a string', () => {
  // Guards the hand-edited-file path: seeds and issue-form output should be quoted, but a
  // contributor writing it bare must not silently produce a Date.
  assert.equal(typeof load('date_added: 2026-08-22\n').date_added, 'string');
});
