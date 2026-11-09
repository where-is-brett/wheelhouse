// tests/probes/haiku-trial/stand-in.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { standInAnswers, recommendedIndex, decisionWork, PICKED, openPicker, readyToSubmit, deskBusy } from '../../../probes/haiku-trial/stand-in.js';

const approval = (id, work) => ({
  id, kind: 'card',
  data: {
    kind: 'approve-work',
    question: `Approve this work as written?\nWork ${work}: what it does.\nNothing changes; the build waits for your click.`,
    options: ['Approve', 'Suggest a change…', 'Show me', 'Not now'],
    descriptions: ['Recommended: Wheelhouse builds it.', 'Tell me.', 'I show you.', 'Nothing is built.'],
  },
});
const decision = (id, work, n, title, recommended = 0) => ({
  id, kind: 'card',
  data: {
    kind: 'answer',
    question: `${title}\nWhy it matters.\nAnswer question q-${work}-${n}`,
    options: ['store', 'skip', 'Suggest a change…'],
    descriptions: ['store it', 'skip it', 'Tell me'].map((d, i) => (i === recommended ? `Recommended: ${d}` : d)),
    line: `Answer question q-${work}-${n}`,
  },
});
const picker = (question, labels, at) => [
  ' ☐ Approve work',
  ...question.split('\n').map((l) => `│ ${l}`),
  ...labels.map((l, i) => `${i === at ? '❯' : ' '} ${i + 1}. ${l}`),
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
].join('\n');

test('an approval card the desk shows as a picker gets Enter on its recommended option', () => {
  const card = approval('c1', 'shop-categories');
  const pane = picker(card.data.question, card.data.options, 0);
  assert.deepEqual(standInAnswers({ events: [card], pane }), [{ card: 'c1', label: 'Approve', keys: ['Enter'] }]);
});

test('the cursor is moved to the recommended option first', () => {
  const card = approval('c1', 'w');
  card.data.descriptions = ['a', 'b', 'Recommended: c', 'd'];
  const pane = picker(card.data.question, card.data.options, 0);
  assert.deepEqual(standInAnswers({ events: [card], pane })[0].keys, ['Down', 'Down', 'Enter']);
});

test('a card not on screen, already answered, or already acted on gets nothing', () => {
  const shown = approval('c1', 'a');
  const other = approval('c2', 'b');
  const pane = picker(shown.data.question, shown.data.options, 0);
  // Another approval's picker is on screen: the same first line, a different second line.
  assert.deepEqual(standInAnswers({ events: [other], pane }), []);
  assert.deepEqual(standInAnswers({ events: [shown, { id: 'x', kind: 'card-answer', data: { card: 'c1' } }], pane }), []);
  assert.deepEqual(standInAnswers({ events: [shown], pane, done: new Set(['c1']) }), []);
  assert.deepEqual(standInAnswers({ events: [shown], pane: 'working…' }), []);
});

test('options given as objects with labels are read too', () => {
  const card = { id: 'c1', kind: 'card', data: { kind: 'setup', question: 'Set up?\nStep 2', options: [{ label: 'Go ahead (Recommended)' }, { label: 'Not now' }] } };
  const pane = picker(card.data.question, ['Go ahead (Recommended)', 'Not now'], 0);
  assert.deepEqual(standInAnswers({ events: [card], pane }), [{ card: 'c1', label: 'Go ahead', keys: ['Enter'] }]);
});

test("a build's decision in the chat gets its typed reply, with the number the desk gave it and the recommended letter", () => {
  const one = decision('d1', 'bank-statement-import', 1, 'Repeated lines in one statement');
  const two = decision('d2', 'bank-statement-import', 2, 'A statement with its columns but no rows', 1);
  const pane = [
    'Decision needed (1): Repeated lines in one statement   (holds up: Merging this change, until you answer)',
    'Decision needed (2): A statement with its columns but no rows   (holds up: Merging this change, until you answer)',
    'Reply 2 A, 2 B, "why 2", or "2: your own words".',
  ].join('\n');
  assert.deepEqual(standInAnswers({ events: [one, two], pane }), [
    { card: 'd1', label: 'store', type: '1 A' },
    { card: 'd2', label: 'skip', type: '2 B' },
  ]);
});

test("the decisions of work the run answers itself are left alone, and a decision not yet in the chat waits", () => {
  const p4 = decision('d1', 'month-edit', 1, 'Which month');
  const pane = 'Decision needed (1): Which month';
  assert.deepEqual(standInAnswers({ events: [p4], pane, skipWork: new Set(['month-edit']) }), []);
  assert.deepEqual(standInAnswers({ events: [p4], pane: 'nothing yet' }), []);
});

test('the recommended option and the work of a decision are read from the card', () => {
  assert.equal(recommendedIndex({ options: ['a', 'b'], descriptions: ['x', 'Recommended: y'] }), 1);
  assert.equal(recommendedIndex({ options: [{ label: 'a' }, { label: 'b (Recommended)' }] }), 1);
  assert.equal(recommendedIndex({ options: ['a', 'b'] }), 0);
  assert.equal(decisionWork({ line: 'Answer question q-bank-statement-import-12' }), 'bank-statement-import');
  assert.ok(PICKED.includes('approve-work') && !PICKED.includes('answer'));
});

test("only the picker open at the foot of the pane counts, not earlier ones in the pane's history", () => {
  const first = approval('c1', 'bank-statement-import');
  const second = approval('c2', 'transaction-categories');
  const older = picker(first.data.question, first.data.options, 0);
  const chat = ['Done. The plan:', '  1. Approve the import', '  2. Then the categories'].join('\n');
  // The first card was answered; its picker is still in the history, and the second one is open now with its cursor moved.
  const pane = [older, chat, picker(second.data.question, second.data.options, 2)].join('\n');
  const answered = { id: 'a', kind: 'card-answer', data: { card: 'c1' } };
  assert.deepEqual(standInAnswers({ events: [first, second, answered], pane }), [{ card: 'c2', label: 'Approve', keys: ['Up', 'Up', 'Enter'] }]);
  assert.equal(openPicker(chat), null);
});

test('a picker of several questions with every one answered is submitted', () => {
  const pane = [
    '   → Approve',
    'Ready to submit your answers?',
    '❯ 1. Submit answers',
    '  2. Cancel',
  ].join('\n');
  assert.equal(readyToSubmit(pane), true);
  assert.deepEqual(standInAnswers({ events: [approval('c1', 'a')], pane }), [{ card: null, label: 'Submit answers', keys: ['Enter'] }]);
  assert.equal(readyToSubmit('Ready to submit your answers?\n  1. Submit answers\n❯ 2. Cancel'), false);
});

test('a decision already answered in the chat is not answered again', () => {
  const one = decision('d1', 'bank-statement-import', 1, 'Repeated lines in one statement');
  const done = { id: 'x', kind: 'action', data: { action: 'answer', questionId: 'q-bank-statement-import-1' } };
  assert.deepEqual(standInAnswers({ events: [one, done], pane: 'Decision needed (1): Repeated lines in one statement' }), []);
});

const SPINNER = '✻ Pondering… (12s · ↓ 340 tokens · esc to interrupt)';

test('deskBusy sees a working desk by its spinner or its interrupt hint, and an idle desk by neither', () => {
  assert.equal(deskBusy(`Some reply\n${SPINNER}\n> `), true);
  assert.equal(deskBusy('Some reply\n  esc to interrupt\n'), true);
  assert.equal(deskBusy('Some reply\n\n> \n? for shortcuts'), false);
  assert.equal(deskBusy(''), false);
  // An old spinner far up the history does not count.
  assert.equal(deskBusy([SPINNER, ...Array.from({ length: 40 }, (_, i) => `line ${i}`)].join('\n')), false);
});

test('a typed decision reply waits for a busy desk and for another picker', () => {
  const one = decision('d1', 'bank-statement-import', 1, 'Repeated lines in one statement');
  const chat = 'Decision needed (1): Repeated lines in one statement   (holds up: Merging this change)';
  assert.deepEqual(standInAnswers({ events: [one], pane: `${chat}\n${SPINNER}` }), [], 'the desk is working');
  const other = approval('c9', 'something-else');
  const open = picker(other.data.question, other.data.options, 0);
  assert.deepEqual(standInAnswers({ events: [one], pane: `${chat}\n${open}` }), [], 'a picker is open: the text would go into it');
  assert.equal(standInAnswers({ events: [one], pane: chat }).length, 1);
});
