// tests/vscode/model.test.js
// The state the panel is drawn from: the desk's views read into what the drawing takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { require, waitingView } from './helpers.js';
import { hashOf, cardTextOf } from '../../scripts/desk/card-text.js';
import { signsOn } from '../../scripts/hooks/prompt-record.js';
import { CONFIRMED_STEPS as CORE_STEPS } from '../../scripts/agents/chat-clicks.js';
import { isOpen as coreIsOpen } from '../../scripts/desk/views.js';
import { isMergeApproval as coreIsMergeApproval } from '../../scripts/desk/evidence.js';

const { readable, stateOf, stepWords, isMergeApproval, isOpen, CONFIRMED_STEPS, SIGNED_LABELS } = require('../../vscode/model.cjs');

const LINE = 'Approve pull request #12 at commit aaaaaaaaaaaa';
const merge = { id: '5b0e6f0a-1b6c-4d7e-9a53-0c2f6a4d8e11', data: { kind: 'approval', level: 3, line: LINE, question: 'Merge pull request 12?', options: ['Approve', 'Not now'], recommend: 'Approve', parts: { what: 'It changes a page.', header: 'Approval' } } };
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

test('a merge approval is read from the live card, never from its id', () => {
  const named = (data, id = 'merge-12') => stateOf({ state: 'live', waiting: waitingView([{ id, data }]) }).cards[0].merge;
  assert.equal(named(merge.data, 'x'), true, 'a plain merge approval under any id');
  assert.equal(named({ ...merge.data, level: 4 }), false, 'a guardrail approval is level 4');
  assert.equal(named({ ...merge.data, kind: 'runbook' }), false);
  assert.equal(named({ ...merge.data, line: 'Do the step' }), false, 'without the approval set line');
  assert.equal(named({ ...merge.data, line: undefined }), false);
  assert.equal(named({ kind: 'approval', question: 'Merge pull request 12?' }), false, 'a name alone decides nothing');
});

test('only the cards waiting are drawn, not every card event', () => {
  const answered = { id: 'gone', data: { kind: 'approval', question: 'Old?' } };
  const got = stateOf({ state: 'live', waiting: waitingView([merge], [answered]) });
  assert.deepEqual(got.cards.map((c) => c.id), [merge.id]);
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

test('the add-on reads a merge approval as core does', () => {
  const cases = [merge.data, { ...merge.data, level: 4 }, { ...merge.data, kind: 'runbook' }, { ...merge.data, line: 'Do the step' }, { ...merge.data, line: undefined }, { ...merge.data, line: 'Approve pull request #0 at commit aaaaaaaaaaaa' }, null, 'x', []];
  for (const data of cases) assert.equal(isMergeApproval(data), coreIsMergeApproval(data), JSON.stringify(data));
});

test('a card is shown without its reply code and set line, and a project by a plain name', () => {
  const question = 'Put pull request #1 live?\nProposed change #1 adds a shout.\nApprove pull request #1 at commit b881b780e107\nReply code: PN78';
  const waiting = { names: ['local__vscode-part9'], views: { waiting: [{ id: 'c1', data: { question, parts: { what: 'Proposed change #1 adds a shout.' } } }] } };
  const out = stateOf({ state: 'live', projectName: 'My shop', waiting });
  assert.equal(out.cards[0].question, 'Put pull request #1 live?\nProposed change #1 adds a shout.');
  assert.equal(out.project, 'My shop');
  assert.equal(stateOf({ state: 'live', waiting }).project, 'vscode-part9');
});

test('the add-on\'s reading of a card matches core\'s chatCopy, including the Lift card', async () => {
  const { chatCopy, replyCode: coreCode, replyCodeLine, LIFT_STOP, LIFT_STOP_EARLIER } = await import('../../scripts/state/card-lines.js');
  const withCode = (body, line) => `${body}\n${line}\n${replyCodeLine(coreCode(line))}`;
  const approve = 'Approve pull request #1 at commit b881b780e107';
  const samples = [
    withCode('Put it live?\nIt adds a shout.', approve),
    withCode('Lift it?', LIFT_STOP),
    withCode('Lift it?', LIFT_STOP_EARLIER),
    'A plain card\nwith two lines',
    'Put it live?\nReply code: ZZZZ',
    `Put it live?\n${approve}\nReply code: ZZZZ`,
    `Reply code: AAAA\nPut it live?\n${approve}`,
    '',
  ];
  for (const card of samples) assert.equal(readable(card), chatCopy(card), JSON.stringify(card));
  assert.equal(readable(samples[0]), 'Put it live?\nIt adds a shout.');
  assert.equal(readable(samples[1]), samples[1]);
});
