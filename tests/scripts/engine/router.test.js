// tests/scripts/engine/router.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeAsk, cardBudget, bundleApprovals, answerFor, dayOf, SUGGEST_LABEL } from '../../../scripts/engine/router.js';

const HEAD = 'a'.repeat(40);
const ask = (over = {}) => ({
  type: 'ask', runId: 'run-1', at: '2026-10-29T02:00:00.000Z', id: 'run-1:ask:1', kind: 'question', level: 3, topic: null, recommend: 'b',
  options: [{ id: 'a', label: 'Keep it small' }, { id: 'b', label: 'Do the whole page' }], context: { question: 'How much of the page should change?' }, card: true, ...over,
});

test('hold on a red main line is answered with no card', () => {
  const got = routeAsk(ask({ kind: 'question', level: 1, recommend: 'hold', answer: 'hold', card: false, line: 'The main line is red, so merges wait.', options: [{ id: 'hold', label: 'Hold' }] }));
  assert.deepEqual(got.answer, { choice: 'hold' });
  assert.equal(got.line, 'The main line is red, so merges wait.');
  assert.equal(got.card, undefined);
});

test('a usage limit is a Logbook line only', () => {
  const got = routeAsk(ask({ kind: 'usage-limit', level: 1, recommend: null, card: false, line: 'The usage limit was reached.' }));
  assert.deepEqual(got, { line: 'The usage limit was reached.' });
});

test('a level-3 ask lowered by a delegation is answered by its recommendation', () => {
  const got = routeAsk(ask({ topic: 'page-wording' }), { levels: { 'page-wording': { value: 2 } } });
  assert.deepEqual(got.answer, { choice: 'b' });
  assert.equal(got.level, 2);
  assert.equal(routeAsk(ask({ topic: 'page-wording' }), { levels: { 'page-wording': { value: 3 } } }).answer, undefined);
});

test('a level-4 ask becomes a card with the recommendation first', () => {
  const got = routeAsk(ask({ level: 4 }));
  assert.equal(got.importance, 1);
  assert.deepEqual(got.card.question.options.map((o) => o.label), ['Do the whole page', 'Keep it small']);
  assert.equal(got.card.question.recommendation, 'Do the whole page');
  assert.equal(got.card.question.level, 4);
  assert.deepEqual(got.card.question.engine, { runId: 'run-1', ask: 'run-1:ask:1', options: { 'Keep it small': 'a', 'Do the whole page': 'b' } });
});

test('an ask with a level the table gives no answer for is never answered by silence', () => {
  const got = routeAsk(ask({ level: 2, recommend: null, answer: undefined }));
  assert.ok(got.card, 'it waits for the director');
});

test('an approval with its pull request and head is an approval card', () => {
  const got = routeAsk(ask({ kind: 'approval', recommend: 'approve', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Not this' }], setLine: { pr: 9, head: HEAD } }));
  assert.equal(got.card.approval.pr, 9);
  assert.equal(got.card.approval.sha, HEAD);
  assert.equal(got.card.approval.engine.approve, 'approve');
});

test('the fourth level-3 card waits for tomorrow and the briefing counts it', () => {
  const cards = [1, 2, 3, 4].map((n) => ({ importance: 3, n }));
  const got = cardBudget({ cards, cardsPerDay: 3, shownToday: 0 });
  assert.deepEqual(got.show.map((c) => c.n), [1, 2, 3]);
  assert.equal(got.wait, 1);
  assert.deepEqual(cardBudget({ cards: [{ importance: 3, n: 4 }], cardsPerDay: 3, shownToday: 3 }).wait, 1);
});

test('a card that holds up all work ignores the budget', () => {
  const got = cardBudget({ cards: [{ importance: 3, n: 1 }, { importance: 2, n: 2 }, { importance: 0, n: 3 }], cardsPerDay: 3, shownToday: 3 });
  assert.deepEqual(got.show.map((c) => c.n), [3, 2]);
  assert.equal(got.wait, 1);
});

test('the order of importance is All stop, level 4, holds up all work, level 3, the rest', () => {
  const got = cardBudget({ cards: [{ importance: 4, n: 'rest' }, { importance: 3, n: 'l3' }, { importance: 1, n: 'l4' }], cardsPerDay: 2 });
  assert.deepEqual(got.show.map((c) => c.n), ['l4', 'l3']);
  assert.equal(routeAsk(ask({ holdsAll: true })).importance, 2);
});

test('two waiting approvals become one bundled card when the setting is on', () => {
  const approval = (pr) => ({ importance: 3, card: { approval: { pr, sha: HEAD } } });
  const got = bundleApprovals([approval(1), { importance: 3, card: { question: {} } }, approval(2)]);
  assert.equal(got.length, 2);
  assert.deepEqual(got[0].card.bundle.map((a) => a.pr), [1, 2]);
  assert.equal(bundleApprovals([approval(1)]).length, 1);
});

test('a label answers with its option, Suggest a change with the director\'s words, Not now with nothing', () => {
  const engine = { ask: 'run-1:ask:1', options: { 'Keep it small': 'a' } };
  assert.deepEqual(answerFor(engine, 'Keep it small'), { ask: 'run-1:ask:1', choice: 'a' });
  assert.deepEqual(answerFor(engine, SUGGEST_LABEL, ' Only the header '), { ask: 'run-1:ask:1', words: 'Only the header' });
  assert.equal(answerFor(engine, 'Not now'), null);
});

test('the card budget\'s day is the director\'s own, on this computer\'s clock', () => {
  const before = process.env.TZ;
  process.env.TZ = 'Australia/Sydney';
  try {
    assert.equal(dayOf('2026-10-29T12:00:00.000Z'), '2026-10-29', '11pm in Sydney');
    assert.equal(dayOf('2026-10-29T14:00:00.000Z'), '2026-10-30', '1am the next morning in Sydney');
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});
