// tests/vscode/model.test.js
// The state the panel is drawn from: the desk's views read into what the drawing takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { require, waitingView } from './helpers.js';
import { hashOf, cardTextOf } from '../../scripts/desk/card-text.js';
import { signsOn } from '../../scripts/hooks/prompt-record.js';
import { CONFIRMED_STEPS as CORE_STEPS } from '../../scripts/agents/chat-clicks.js';
import { isOpen as coreIsOpen } from '../../scripts/desk/views.js';

const { stateOf, stepWords, isOpen, CONFIRMED_STEPS, SIGNED_LABELS } = require('../../vscode/model.cjs');

const merge = { id: 'merge-12', data: { kind: 'approval', question: 'Merge pull request 12?', options: ['Approve', 'Not now'], recommend: 'Approve', parts: { what: 'It changes a page.', header: 'Approval' } } };
const lift = { id: 'lift-stop-3', data: { kind: 'approval', question: 'Lift STOP?', options: ['Lift STOP'] } };
const decision = { id: 'd1', data: { kind: 'answer', question: 'Which way?', options: ['Left', 'Right'] } };

test('a card carries its hash, its flags and each option\'s signing', () => {
  const got = stateOf({ state: 'live', fingerprint: 'f', glance: { glance: 'Hi' }, waiting: waitingView([merge, lift, decision]), work: null });
  assert.equal(got.state, 'live');
  assert.equal(got.glance, 'Hi');
  const [m, l, d] = got.cards;
  assert.equal(m.hash, hashOf(cardTextOf({ question: 'Merge pull request 12?' })));
  assert.deepEqual([m.merge, m.confirmed, m.decision], [true, false, false]);
  assert.deepEqual(m.options.map((o) => [o.label, o.signs, o.recommended]), [['Approve', true, true], ['Not now', false, false]]);
  assert.deepEqual([l.merge, l.confirmed, l.decision], [false, true, false]);
  assert.deepEqual([d.merge, d.confirmed, d.decision], [false, false, true]);
  assert.equal(m.header, 'Approval');
});

test('only the cards waiting are drawn, not every card event', () => {
  const answered = { id: 'gone', data: { kind: 'approval', question: 'Old?' } };
  const got = stateOf({ state: 'live', waiting: waitingView([merge], [answered]) });
  assert.deepEqual(got.cards.map((c) => c.id), ['merge-12']);
});

test('the copied lists match core\'s', () => {
  assert.deepEqual([...CONFIRMED_STEPS], [...CORE_STEPS]);
  for (const label of SIGNED_LABELS) assert.equal(signsOn(label), true, label);
});

test('open work is told as core tells it, and in the director\'s words', () => {
  const t = (n) => `2026-11-23T0${n}:00:00.000Z`;
  const views = {
    work: {
      a: { work: { at: t(1), data: { title: 'A', lane: 'feature' } } },
      b: { work: { at: t(1), data: { title: 'B', lane: 'quick' } } },
      c: { work: { at: t(1), data: { title: 'C', lane: 'feature' } } },
      d: { work: { at: t(1), data: { title: 'D', lane: 'feature' } } },
      e: { work: { at: t(5), data: { title: 'E', lane: 'feature' } } },
    },
    features: { a: { at: t(2), data: { step: 'planned' } }, b: { at: t(2), data: { step: 'started' } }, c: { at: t(2), data: { step: 'closed' } }, e: { at: t(2), data: { step: 'closed' } } },
    reports: { d: { at: t(3), data: { outcome: 'merged' } } },
  };
  for (const id of Object.keys(views.work)) assert.equal(isOpen(views, id), coreIsOpen(views, id), id);
  assert.deepEqual(Object.keys(views.work).filter((id) => isOpen(views, id)), ['a', 'b', 'e']);
  const got = stateOf({ state: 'live', work: { views } }).work;
  assert.deepEqual(got.map((w) => [w.title, w.state]), [['A', 'planned, waiting for the go-ahead to build'], ['B', 'building'], ['E', 'waiting for the director\'s approval']]);
  assert.equal(stepWords({ work: { data: { lane: 'feature' } } }, { data: { step: 'started' } }), 'writing its plan');
  assert.equal(stepWords({ work: { data: { lane: 'quick' } }, approved: true }, undefined), 'queued, not started yet');
});

test('the project name comes from the views, and notices are drawn', () => {
  const got = stateOf({ state: 'live', waiting: waitingView([]), notices: [{ id: 'n', lines: ['One.', 'Two.'] }] });
  assert.equal(got.project, 'name');
  assert.deepEqual(got.notices, ['One.', 'Two.']);
  assert.equal(got.notice, 'One. Two.');
});

test('a state with no views draws as little as possible', () => {
  const got = stateOf({ state: 'no-helper', says: 'x', fingerprint: 'f', glance: null, waiting: null, work: null });
  assert.deepEqual([got.cards, got.work, got.glance, got.notice], [[], [], '', 'x']);
});
