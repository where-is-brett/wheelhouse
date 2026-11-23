// tests/vscode/model.test.js
// The state the panel is drawn from: the desk's views read into what the drawing takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { require } from './helpers.js';
import { hashOf, cardTextOf } from '../../scripts/desk/card-text.js';
import { signsOn } from '../../scripts/hooks/prompt-record.js';
import { CONFIRMED_STEPS as CORE_STEPS } from '../../scripts/agents/chat-clicks.js';

const { stateOf, CONFIRMED_STEPS, SIGNED_LABELS } = require('../../vscode/model.cjs');

const card = (id, data) => ({ id, at: 'x', data });
const waiting = { cards: [
  card('merge-12', { kind: 'approval', question: 'Merge pull request 12?', options: ['Approve', 'Not now'], recommend: 'Approve', parts: { what: 'It changes a page.', header: 'Approval' } }),
  card('lift-stop-3', { kind: 'approval', question: 'Lift STOP?', options: ['Lift STOP'] }),
  card('d1', { kind: 'answer', question: 'Which way?', options: ['Left', 'Right'] }),
] };

test('a card carries its hash, its flags and each option\'s signing', () => {
  const got = stateOf({ state: 'live', fingerprint: 'f', glance: { glance: 'Hi' }, waiting, work: null });
  assert.equal(got.state, 'live');
  assert.equal(got.glance, 'Hi');
  const [merge, lift, decision] = got.cards;
  assert.equal(merge.hash, hashOf(cardTextOf({ question: 'Merge pull request 12?' })));
  assert.deepEqual([merge.merge, merge.confirmed, merge.decision], [true, false, false]);
  assert.deepEqual(merge.options.map((o) => [o.label, o.signs, o.recommended]), [['Approve', true, true], ['Not now', false, false]]);
  assert.deepEqual([lift.merge, lift.confirmed, lift.decision], [false, true, false]);
  assert.deepEqual([decision.merge, decision.confirmed, decision.decision], [false, false, true]);
  assert.equal(merge.header, 'Approval');
});

test('the copied lists match core\'s', () => {
  assert.deepEqual(CONFIRMED_STEPS.filter((s) => s !== 'pairing'), [...CORE_STEPS]);
  for (const label of SIGNED_LABELS) assert.equal(signsOn(label), true, label);
});

test('a state with no views draws as little as possible', () => {
  const got = stateOf({ state: 'no-helper', says: 'x', fingerprint: 'f', glance: null, waiting: null, work: null });
  assert.deepEqual([got.cards, got.work, got.glance, got.notice], [[], [], '', 'x']);
});
