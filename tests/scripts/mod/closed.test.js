// tests/scripts/mod/closed.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedQuestions } from '../../../scripts/mod/closed.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { LIFT_STOP, LIFT_STOP_EARLIER, chatCopy } from '../../../scripts/state/card-lines.js';

const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const common = {
  why: 'It changes what users see, which is yours to decide at level 3.',
  because: 'the checks passed and the change is small.',
  meanwhile: 'Nothing is released and the agents carry on with other work.',
  level: 3,
};
const says = (label) => ({ label, says: `It ${label.toLowerCase()} and goes ahead.` });
const approval = composeCard({ ...common, kind: 'approval', recommend: 'Approve', what: 'Pull request #13 changes the wording on the sign-in page.', options: [says('Approve')], target: { pr: 13, sha: FULL } });
const lift = composeCard({ ...common, kind: 'lift-stop', recommend: 'Lift All stop', what: 'Every agent is stopped, and nothing moves until you say.', options: [says('Lift All stop')], target: {} });
// The front desk asks the chat's copy: the card without its set line and reply code.
const text = chatCopy(approval.question.question);
const stored = approval.question.question;
const outcome = (decided, signed) => ({ card: { id: 'c-1', data: approval.card }, decided, signed });
const DECIDED = { at: '2026-11-05T01:00:00.000Z', label: 'Approve', where: 'panel' };
const SIGNED = { at: '2026-11-05T01:00:00.000Z', label: null };
const ask = (questions, over = {}) => closedQuestions({ project: 'p', questions, stop: () => ({ on: true }), ...over });

test('a card decided by a signed record is closed', () => {
  assert.deepEqual(ask([text], { outcomes: [outcome(DECIDED, SIGNED)] }), { cards: 1, closed: 1 });
});

test('the stored text, with its set line and reply code, matches its card too', () => {
  assert.notEqual(text, stored);
  assert.ok(stored.includes('Reply code:'));
  assert.ok(!text.includes('Reply code:'));
  assert.deepEqual(ask([stored], { outcomes: [outcome(DECIDED, SIGNED)] }), { cards: 1, closed: 1 });
});

test('a card decided by a plain answer closes only for a pane press this session counted', () => {
  assert.deepEqual(ask([text], { outcomes: [outcome(DECIDED, null)], pressed: ['c-1'] }), { cards: 1, closed: 1 });
  assert.deepEqual(ask([text], { outcomes: [outcome(DECIDED, null)], pressed: ['c-2'] }), { cards: 1, closed: 0 });
  // A press does not close a card that is still waiting.
  assert.deepEqual(ask([text], { outcomes: [outcome(null, null)], pressed: ['c-1'] }), { cards: 1, closed: 0 });
});

test('a card decided only by a plain answer is not closed: anything reaching the helper can write one', () => {
  assert.deepEqual(ask([text], { outcomes: [outcome(DECIDED, null)] }), { cards: 1, closed: 0 });
});

test('a card still waiting is not closed, even when an older one with the same words was signed', () => {
  assert.deepEqual(ask([text], { outcomes: [outcome(null, null)] }), { cards: 1, closed: 0 });
  const older = { ...outcome(DECIDED, SIGNED), card: { id: 'c-0', data: approval.card } };
  assert.deepEqual(ask([text], { outcomes: [older, outcome(null, null)] }), { cards: 1, closed: 0 });
});

test('a question that is no card in the state, or has no set line, is not counted', () => {
  assert.deepEqual(ask([text], { outcomes: [] }), { cards: 0, closed: 0 });
  assert.deepEqual(ask(['Which folder should the report go in?'], { outcomes: [outcome(DECIDED, SIGNED)] }), { cards: 0, closed: 0 });
  assert.deepEqual(ask([42, null], { outcomes: [] }), { cards: 0, closed: 0 });
});

test('the Lift All stop question is closed once STOP is off, in either wording', () => {
  const words = lift.question.question;
  const earlier = words.replace(LIFT_STOP, LIFT_STOP_EARLIER);
  assert.deepEqual(ask([words], { outcomes: [] }), { cards: 1, closed: 0 });
  assert.deepEqual(ask([words], { outcomes: [], stop: () => ({ on: false }) }), { cards: 1, closed: 1 });
  assert.deepEqual(ask([earlier], { outcomes: [], stop: () => ({ on: false }) }), { cards: 1, closed: 1 });
});

test('a call of several questions reports each, so the mod closes only when all are closed', () => {
  const words = lift.question.question;
  const got = ask([text, words, 'Plain question?'], { outcomes: [outcome(DECIDED, SIGNED)], stop: () => ({ on: false }) });
  assert.deepEqual(got, { cards: 2, closed: 2 });
});
