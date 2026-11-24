// tests/scripts/decisions/signed.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signedDecisionFor, signedLine } from '../../../scripts/decisions/signed.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { inHome, keep, P, raiseBuildQuestion, typedAnswer } from '../../helpers/decisions-world.js';

const ASK = 'Should the harbour map show tide times?';
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const at = (iso) => () => new Date(iso);
const workEvent = (iso, { id = 'w-tide', hash = H1, lane = 'feature' } = {}) => keep(makeEvent({
  kind: 'work', data: { id, title: 'Tide times', lane, doc: { path: 'd.md', hash }, visible: true, dependsOn: [] }, now: at(iso),
}));
const approveClick = (iso, { work = 'w-tide', hash = H1, lane = 'feature' } = {}) => keep(makeEvent({
  kind: 'action', data: { action: 'approve-work', work, lane, hash, shownFirst: false, question: 'Approve the tide times plan?', label: 'Approve' }, now: at(iso),
}));

test('an answer signed for the same work and question is found, with its time and the option picked', async () => {
  await inHome(() => {
    const card = raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T01:00:00.000Z');
    typedAnswer(card, { n: 1, label: 'A' }, '2026-11-08T02:00:00.000Z');
    const signed = signedDecisionFor(P, 'w-tide-1', ASK);
    assert.deepEqual(signed, { kind: 'answer', at: '2026-11-08T02:00:00.000Z', answer: 'Show them' });
    assert.equal(signedLine(signed), 'Already answered on 8 November 2026: Show them');
  });
});

test('no signed answer, another work or another question gives null', async () => {
  await inHome(() => {
    const card = raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T01:00:00.000Z');
    assert.equal(signedDecisionFor(P, 'w-tide-1', ASK), null, 'asked but not answered');
    typedAnswer(card, { n: 1, label: 'A' }, '2026-11-08T02:00:00.000Z');
    assert.equal(signedDecisionFor(P, 'w-other-2', ASK), null);
    assert.equal(signedDecisionFor(P, 'w-tide-1', 'Which colour is the header?'), null);
    assert.equal(signedDecisionFor(P, 'w-tide-1', ''), null);
    assert.equal(signedDecisionFor(P, '', ASK), null);
  });
});

test('the same question on a work whose id another work\'s id starts with is not taken for it', async () => {
  await inHome(() => {
    const card = raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T01:00:00.000Z');
    typedAnswer(card, { n: 1, label: 'A' }, '2026-11-08T02:00:00.000Z');
    assert.equal(signedDecisionFor(P, 'w-tide', ASK), null, 'w-tide is not w-tide-1');
    assert.equal(signedDecisionFor(P, 'tide-1', ASK), null);
  });
});

test('a card that holds no question does not hide another card\'s signed answer', async () => {
  await inHome(() => {
    // An old record's card, kept as it was written, with a set line and no question.
    const old = raiseBuildQuestion('q-w-tide-1-9', '2026-11-08T00:30:00.000Z', { project: 'owner__elsewhere' });
    const { question: _gone, parts: _also, ...bare } = old.data;
    keep({ ...old, data: bare });
    const card = raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T01:00:00.000Z');
    typedAnswer(card, { n: 1, label: 'A' }, '2026-11-08T02:00:00.000Z');
    assert.equal(signedDecisionFor(P, 'w-tide-1', ASK)?.at, '2026-11-08T02:00:00.000Z');
  });
});

test('approved work is found by its signed click, and its line says so', async () => {
  await inHome(() => {
    workEvent('2026-11-08T01:00:00.000Z');
    assert.equal(signedDecisionFor(P, 'w-tide', 'Approve the tide times plan?'), null, 'recorded but not approved');
    approveClick('2026-11-08T03:00:00.000Z');
    const signed = signedDecisionFor(P, 'w-tide', 'Approve the tide times plan?');
    assert.deepEqual(signed, { kind: 'approval', at: '2026-11-08T03:00:00.000Z' });
    assert.equal(signedLine(signed), 'Already approved on 8 November 2026');
    // A fresh chat that words the card differently finds the same approval.
    assert.equal(signedDecisionFor(P, 'w-tide', 'Shall we build tide times as written?')?.kind, 'approval');
    assert.equal(signedDecisionFor(P, 'w-tide-1', 'Approve the tide times plan?'), null, 'another work');
  });
});

test('an approval of an older document, another lane or an unsigned click is not found', async () => {
  await inHome(() => {
    workEvent('2026-11-08T01:00:00.000Z');
    approveClick('2026-11-08T02:00:00.000Z');
    workEvent('2026-11-08T04:00:00.000Z', { hash: H2 });
    assert.equal(signedDecisionFor(P, 'w-tide', 'Approve the tide times plan?'), null, 'the document changed since');
  });
  await inHome(() => {
    workEvent('2026-11-08T01:00:00.000Z');
    approveClick('2026-11-08T02:00:00.000Z', { lane: 'small' });
    assert.equal(signedDecisionFor(P, 'w-tide', 'Approve the tide times plan?'), null, 'another lane');
  });
  await inHome(() => {
    workEvent('2026-11-08T01:00:00.000Z');
    const { sig, ...unsigned } = makeEvent({ kind: 'action', data: { action: 'approve-work', work: 'w-tide', lane: 'feature', hash: H1, shownFirst: false, question: 'q', label: 'Approve' }, now: at('2026-11-08T02:00:00.000Z') });
    keep(unsigned);
    assert.equal(signedDecisionFor(P, 'w-tide', 'Approve the tide times plan?'), null, 'unsigned');
  });
});

test('an unanswered question on approved work is asked, never passed as approved', async () => {
  await inHome(() => {
    workEvent('2026-11-08T01:00:00.000Z', { id: 'w-tide-1' });
    approveClick('2026-11-08T02:00:00.000Z', { work: 'w-tide-1' });
    raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T03:00:00.000Z');
    assert.equal(signedDecisionFor(P, 'w-tide-1', ASK), null);
  });
});

test('an unreadable record gives null, so the card is asked as usual', async () => {
  await inHome(() => {
    assert.equal(signedDecisionFor('no__such-project', 'w-tide-1', ASK), null);
  });
});
