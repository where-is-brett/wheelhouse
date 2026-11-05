// tests/scripts/lib/by-hand-tie.test.js
// A tie counts only when it is signed, names a work, and is for that change at that commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tieNamesWork } from '../../../scripts/lib/by-hand-tie.js';

const HEAD = 'a'.repeat(40);
const tie = (extra = {}, data = {}) => ({ kind: 'by-hand', data: { question: 'q-by-hand-1', n: 3, head: HEAD, work: 'carry-on-3', doc: '1'.repeat(64), ...data }, ...extra });

test('a signed tie that names a work for the change at that commit counts', () => {
  assert.equal(tieNamesWork([tie()], 3, HEAD, () => true), true);
});

test('an unsigned tie never counts', () => {
  assert.equal(tieNamesWork([tie()], 3, HEAD, () => false), false);
});

test('a tie for another change or commit, or naming no work, does not count', () => {
  assert.equal(tieNamesWork([tie({}, { n: 4 })], 3, HEAD, () => true), false);
  assert.equal(tieNamesWork([tie({}, { head: 'b'.repeat(40) })], 3, HEAD, () => true), false);
  assert.equal(tieNamesWork([{ kind: 'by-hand', data: { question: 'q-by-hand-1', n: 3, head: HEAD } }], 3, HEAD, () => true), false);
});
