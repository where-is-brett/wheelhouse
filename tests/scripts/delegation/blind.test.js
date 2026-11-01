// tests/scripts/delegation/blind.test.js
// Blind cards: which cards go blind, what one shows, and what its click does and doesn't do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blindDue, shuffled, rollOf } from '../../../scripts/delegation/blind.js';
import { scoreOf } from '../../../scripts/delegation/seal.js';
import { BLIND_EVERY } from '../../../scripts/delegation/limits.js';

const due = { ask: { id: 'a' }, card: { level: 3 }, day: '2026-11-02', lastDay: '2026-11-01', roll: 0, off: false };

test('never at level 4, an approval or a card holding up all work', () => {
  for (const over of [{ level: 4 }, { approval: {} }, { exempt: true }]) assert.equal(blindDue({ ...due, card: { ...due.card, ...over }, roll: 0 }), false);
});
test('nor on a merge question or a trouble card', () => {
  for (const ask of [{ kind: 'trouble' }, { mergeQuestion: {} }]) assert.equal(blindDue({ ...due, ask }), false);
});
test('at most one a day', () => { assert.equal(blindDue({ ...due, lastDay: due.day, roll: 0 }), false); });
test('the blindCards setting turns them off', () => { assert.equal(blindDue({ ...due, off: true, roll: 0 }), false); });
test('about 1 in 5', () => { assert.equal(blindDue({ ...due, roll: 0.19 }), true); assert.equal(blindDue({ ...due, roll: 0.21 }), false); });

test('rollOf draws about one question in five, and the same each time', () => {
  const drawn = Array.from({ length: 5000 }, (_, i) => rollOf(`q-work-${i}`)).filter((r) => r < 1 / BLIND_EVERY).length;
  assert.ok(drawn > 900 && drawn < 1100, `${drawn} of 5000`);
  assert.equal(rollOf('q-work-1'), rollOf('q-work-1'));
});

test('the order comes from the seed: the same seed reads the same, and no option is lost', () => {
  const options = ['A', 'B', 'C', 'D'];
  assert.deepEqual(shuffled(options, 'q-w-1'), shuffled(options, 'q-w-1'));
  assert.deepEqual([...shuffled(options, 'q-w-1')].sort(), options);
  assert.deepEqual(options, ['A', 'B', 'C', 'D']);
  const orders = new Set(Array.from({ length: 40 }, (_, i) => shuffled(options, `q-w-${i}`).join()));
  assert.ok(orders.size > 5);
});

test('the blind pick is the one scored, whatever the answer after it', () => {
  const seal = { card: 'q-w-1' };
  const reading = { pick: 'Keep' };
  assert.equal(scoreOf({ seal, reading, answer: { label: 'Remove' }, blindPick: 'Keep' }), 'match');
  assert.equal(scoreOf({ seal, reading, answer: { label: 'Keep' }, blindPick: 'Remove' }), 'miss');
  assert.equal(scoreOf({ seal, reading, answer: { label: 'Keep' } }), 'match');
  assert.equal(scoreOf({ seal, reading, answer: { label: 'Remove' }, steered: true, blindPick: 'Keep' }), 'outside');
});

