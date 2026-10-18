// tests/scripts/cards/visit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cardsForVisit, existingCard, askAgain, importanceOf, IMPORTANCE } from '../../../scripts/cards/visit.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { boardModel } from '../../../scripts/board/model.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { LIFT_STOP } from '../../../scripts/state/card-lines.js';
import { CARD } from '../../../scripts/lib/front-desk.js';
import { tempFolder } from '../../helpers/homes.js';

const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const NOW = new Date('2026-10-19T12:00:00.000Z');
const T = (n) => new Date(Date.UTC(2026, 9, 18, 0, n)).toISOString();

const says = (label) => ({ label, says: `It ${label.toLowerCase()} and goes ahead.` });
const common = {
  why: 'It is yours to decide.', because: 'the checks passed.', meanwhile: 'Nothing is released.', level: 3,
};
// Inputs for the kinds the order tells apart.
const INPUTS = {
  stop: { ...common, kind: 'lift-stop', level: 4, checks: 'No checks change.', what: 'Every agent is stopped.', recommend: 'Lift STOP', options: [says('Lift STOP')], target: {} },
  incident: { ...common, kind: 'lift-incident', level: 3, what: 'Incident bad-total, the wrong totals, has been corrected.', recommend: 'End it', options: [says('End it')], target: { incident: 'bad-total' } },
  approval: { ...common, kind: 'approval', what: 'Pull request #7 changes the sign-in page.', recommend: 'Approve', options: [says('Approve')], target: { pr: 7, sha: FULL } },
  answer: { ...common, level: 2, kind: 'answer', what: 'The export needs a separator.', recommend: 'Comma', options: [says('Comma'), says('Tab')], target: { questionId: 'q-export-csv-1' } },
  question: { ...common, level: 1, kind: 'question', what: 'Which name suits the app?', recommend: 'Plain', options: [says('Plain'), says('Playful')] },
};
// One waiting entry as the waiting view gives it: an id, a time, the card's data and whether it was asked.
function waitingCard(id, n, name, over = {}, asked = null) {
  const input = { ...INPUTS[name], ...over };
  if (input.level === 4 && input.checks === undefined) input.checks = 'The checks stay as they are.';
  return { id, at: T(n), data: composeCard(input).card, asked };
}
const ASKED = { at: T(50), label: 'Not now' };
const mark = (key, id, n, data) => [key, { key, id, at: T(n), data }];
const work = (id, dependsOn = [], lane = 'feature') => mark(id, `w-${id}`, 1, { id, title: id, lane, visible: true, dependsOn });
// The build loop's views: work (id -> { work }), reports, questions and the open incidents.
function loop({ works = [], reports = [], questions = [], incidents = [] } = {}) {
  return {
    work: Object.fromEntries(works.map(([id, entry]) => [id, { work: entry, approved: true }])),
    features: {},
    reports: Object.fromEntries(reports.map(([id, outcome]) => mark(id, `r-${id}`, 2, { work: id, outcome, summary: 's', rulings: [] }))),
    questions: Object.fromEntries(questions.map((q) => [q.data.id, { question: q, answer: null }])),
    incidents: { open: incidents },
  };
}
const views = (waiting, extra = {}) => ({ waiting, ...loop(), ...extra });
const ids = (list) => list.map((c) => c.id);

test('a visit asks at most four cards, most important first', () => {
  const waiting = [
    waitingCard('rest', 1, 'question'),
    waitingCard('l3', 2, 'approval'),
    waitingCard('l4', 3, 'approval', { level: 4 }),
    waitingCard('stop', 4, 'stop'),
    waitingCard('l2', 5, 'answer', { target: { questionId: 'q-other-1' } }),
    waitingCard('incident', 6, 'incident'),
  ];
  const visit = cardsForVisit(views(waiting), { now: NOW });
  assert.deepEqual(visit.ids, ['stop', 'incident', 'l4', 'l3']);
  assert.equal(visit.questions.length, CARD.questions);
  assert.equal(visit.left, 2);
  // Each is the question as composed: AskUserQuestion takes it as it is.
  const l4 = waiting.find((c) => c.id === 'l4');
  assert.deepEqual(visit.questions[2], {
    question: l4.data.question,
    header: l4.data.header,
    options: l4.data.options.map((label, i) => ({ label, description: l4.data.descriptions[i] })),
    multiSelect: false,
  });
  assert.ok(visit.questions[2].options.some((o) => o.description.startsWith('Recommended:')));
});

test('the order is STOP or an incident, level 4, a question that holds up all work, level 3, the rest, then oldest first', () => {
  const works = [work('export-csv')];
  const waiting = [
    waitingCard('new-l3', 9, 'approval'),
    waitingCard('old-l3', 3, 'approval', { target: { pr: 8, sha: FULL }, what: 'Pull request #8 changes the footer.' }),
    waitingCard('rest-old', 1, 'question'),
    waitingCard('blocking', 8, 'answer'),
    waitingCard('new-l4', 7, 'approval', { level: 4 }),
    waitingCard('old-l4', 6, 'approval', { level: 4, target: { pr: 9, sha: FULL }, what: 'Pull request #9 changes the footer.' }),
    waitingCard('incident', 10, 'incident'),
    waitingCard('stop', 11, 'stop'),
  ];
  const v = views(waiting, loop({ works, questions: [{ key: 'q-export-csv-1', id: 'e1', at: T(1), data: { id: 'q-export-csv-1', work: 'export-csv' } }] }));
  const first = cardsForVisit(v);
  assert.deepEqual(first.ids, ['incident', 'stop', 'old-l4', 'new-l4']);
  // With the four taken, the next visit's order shows the rest of it.
  const rest = cardsForVisit({ ...v, waiting: waiting.map((c) => (first.ids.includes(c.id) ? { ...c, asked: ASKED } : c)) });
  assert.deepEqual(rest.ids, ['blocking', 'old-l3', 'new-l3', 'rest-old']);
  assert.equal(rest.left, 0);
});

test('importanceOf ranks a card from its kind, its level and what it holds up', () => {
  const works = [work('export-csv'), work('login'), work('billing', ['export-csv'])];
  const q = (id, workId) => ({ key: id, id: `e-${id}`, at: T(1), data: { id, work: workId } });
  const sole = loop({ works: [work('export-csv')], questions: [q('q-export-csv-1', 'export-csv')] });
  const shared = loop({ works, questions: [q('q-export-csv-1', 'export-csv')] });
  const answer = waitingCard('a', 1, 'answer');
  // The only work there is waits on its question: everything is held up.
  assert.equal(importanceOf(answer, views([answer], sole)), IMPORTANCE.HOLDS_UP_ALL);
  // Other work carries on, so the question holds up only its own.
  assert.equal(importanceOf(answer, views([answer], shared)), IMPORTANCE.REST);
  assert.equal(importanceOf(waitingCard('s', 1, 'stop'), views([])), IMPORTANCE.STOP_OR_INCIDENT);
  assert.equal(importanceOf(waitingCard('i', 1, 'incident'), views([])), IMPORTANCE.STOP_OR_INCIDENT);
  assert.equal(importanceOf(waitingCard('f', 1, 'approval', { target: { pr: 7, sha: FULL } }), views([])), IMPORTANCE.LEVEL_3);
  assert.equal(importanceOf(waitingCard('l4', 1, 'approval', { level: 4 }), views([])), IMPORTANCE.LEVEL_4);
  assert.equal(importanceOf(waitingCard('p', 1, 'question'), views([])), IMPORTANCE.REST);
  // The rank rises with importance; the courier reads "above level 3" from it.
  const rank = Object.values(IMPORTANCE).sort((a, b) => a - b);
  assert.deepEqual(rank, [...new Set(rank)]);
  assert.ok(IMPORTANCE.STOP_OR_INCIDENT > IMPORTANCE.LEVEL_4 && IMPORTANCE.LEVEL_4 > IMPORTANCE.HOLDS_UP_ALL
    && IMPORTANCE.HOLDS_UP_ALL > IMPORTANCE.LEVEL_3 && IMPORTANCE.LEVEL_3 > IMPORTANCE.REST);
});

test('a question holds up all work when every other unfinished work depends on its work', () => {
  const q = { key: 'q-export-csv-1', id: 'e1', at: T(1), data: { id: 'q-export-csv-1', work: 'export-csv' } };
  const answer = waitingCard('a', 1, 'answer');
  const rank = (extra) => importanceOf(answer, views([answer], loop({ questions: [q], ...extra })));
  // billing depends on login, which depends on export-csv: all of it waits.
  const chain = [work('export-csv'), work('login', ['export-csv']), work('billing', ['login'])];
  assert.equal(rank({ works: chain }), IMPORTANCE.HOLDS_UP_ALL);
  // One piece of work that doesn't depend on it carries on.
  assert.equal(rank({ works: [...chain, work('help-page')] }), IMPORTANCE.REST);
  // Finished work (merged or closed) holds nothing up, but one that ended blocked is still unfinished.
  assert.equal(rank({ works: [...chain, work('help-page')], reports: [['help-page', 'merged']] }), IMPORTANCE.HOLDS_UP_ALL);
  assert.equal(rank({ works: [...chain, work('help-page')], reports: [['help-page', 'closed']] }), IMPORTANCE.HOLDS_UP_ALL);
  assert.equal(rank({ works: [...chain, work('help-page')], reports: [['help-page', 'blocked']] }), IMPORTANCE.REST);
  // A circle of dependencies ends; a question whose work is finished or unknown holds nothing up.
  assert.equal(rank({ works: [work('export-csv', ['login']), work('login', ['export-csv'])] }), IMPORTANCE.HOLDS_UP_ALL);
  assert.equal(rank({ works: chain, reports: [['export-csv', 'merged']] }), IMPORTANCE.REST);
  assert.equal(rank({ works: [work('login')] }), IMPORTANCE.REST);
  // A plan to approve or change names its work on its set line.
  const plan = waitingCard('p', 1, 'answer', {
    kind: 'approve-work', what: 'The plan for exporting (export-csv).', recommend: 'Approve', options: [says('Approve')],
    target: { work: 'export-csv', lane: 'feature', hash: 'f'.repeat(64) },
  });
  assert.equal(importanceOf(plan, views([plan], loop({ works: chain }))), IMPORTANCE.HOLDS_UP_ALL);
  assert.equal(importanceOf(plan, views([plan], loop({ works: [...chain, work('help-page')] }))), IMPORTANCE.REST);
});

test('an open incident named on a card puts it with STOP and incidents', () => {
  const named = waitingCard('n', 1, 'approval', { what: 'Pull request #7 changes the totals after incident bad-total.' });
  const plain = waitingCard('p', 1, 'approval');
  const open = loop({ incidents: [{ id: 'bad-total', what: 'Wrong totals', at: T(1), fixes: [] }] });
  assert.equal(importanceOf(named, views([named], open)), IMPORTANCE.STOP_OR_INCIDENT);
  assert.equal(importanceOf(plain, views([plain], open)), IMPORTANCE.LEVEL_3);
  assert.equal(importanceOf(named, views([named])), IMPORTANCE.LEVEL_3);
});

test('a card answered Not now is not asked on the next visit, and stays on the board', () => {
  const home = tempFolder('wh-visit-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = path.join(home, 'home');
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const at = (n) => () => new Date(T(n));
    const approval = makeEvent({ kind: 'card', data: composeCard(INPUTS.approval).card, now: at(1) });
    const second = makeEvent({ kind: 'card', data: composeCard({ ...INPUTS.question }).card, now: at(2) });
    const build = (events) => buildViews(events, readEnrolled(), { now: () => NOW });
    const firstVisit = cardsForVisit(build([approval, second]));
    assert.deepEqual(firstVisit.ids, [approval.id, second.id]);
    const notNow = makeEvent({ kind: 'card-answer', data: { card: approval.id, label: 'Not now' }, now: at(3) });
    const events = [approval, second, notNow];
    const next = build(events);
    assert.deepEqual(next.waiting.map((c) => c.id), [approval.id, second.id], 'still waiting');
    const visit = cardsForVisit(next);
    assert.deepEqual(visit.ids, [second.id]);
    assert.equal(visit.left, 0);
    // The board still lists it, and the director can ask for it by its number.
    const model = boardModel({ views: next, events, now: NOW });
    assert.equal(model.director.waiting.length, 2);
    const n = model.director.waiting.findIndex((w) => w.since === approval.at) + 1;
    assert.equal(askAgain(next, n, { events }).question, approval.data.question);
    // Composing it again gives the same card back.
    assert.equal(existingCard(next, approval.data.line), approval.id);
    // A card put off is asked once; when everything is asked, a visit has nothing to ask.
    const allAsked = build([...events, makeEvent({ kind: 'card-answer', data: { card: second.id, label: 'Explain more' }, now: at(4) })]);
    assert.deepEqual(cardsForVisit(allAsked), { questions: [], ids: [], left: 0 });
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
});

test('composing a card already waiting gives the waiting card back', () => {
  const a = waitingCard('a', 1, 'approval');
  const b = waitingCard('b', 2, 'approval', { target: { pr: 8, sha: FULL }, what: 'Pull request #8 changes the footer.' }, ASKED);
  const stop = waitingCard('stop', 3, 'stop');
  const copy = waitingCard('copy', 4, 'approval');
  const v = views([a, b, stop, copy]);
  assert.equal(existingCard(v, a.data.line), 'a', 'the oldest of two cards with one line');
  assert.equal(existingCard(v, b.data.line), 'b', 'a card put off with Not now is still waiting');
  assert.equal(existingCard(v, LIFT_STOP), 'stop');
  assert.equal(existingCard(v, composeCard({ ...INPUTS.approval, target: { pr: 9, sha: FULL }, what: 'Pull request #9 changes it.' }).card.line), null);
  // A card with no set line (a product question) has none to match.
  assert.equal(existingCard(views([waitingCard('q', 1, 'question')]), null), null);
  assert.equal(existingCard(views([waitingCard('q', 1, 'question')]), undefined), null);
  assert.equal(existingCard(views([]), a.data.line), null);
  assert.equal(existingCard({}, a.data.line), null);
});

test('the director can ask for card 3 again by its number', () => {
  const old = waitingCard('old', 1, 'approval', {}, ASKED);
  const mid = waitingCard('mid', 5, 'question');
  const last = waitingCard('last', 7, 'stop');
  const q = { key: 'q-export-csv-1', id: 'e1', at: T(3), data: { id: 'q-export-csv-1', work: 'export-csv', what: 'Which separator?', why: '', options: [], recommendation: '', level: 2 } };
  const v = { ...views([last, old, mid], loop({ works: [work('export-csv')], questions: [q] })) };
  // The board numbers by time: old (1), the build's question (2), mid (3), last (4).
  const model = boardModel({ views: v, events: [], now: NOW });
  assert.deepEqual(model.director.waiting.map((w) => [w.n, w.since]), [[1, T(1)], [2, T(3)], [3, T(5)], [4, T(7)]]);
  const third = askAgain(v, 3);
  assert.equal(third.question, mid.data.question);
  assert.equal(third.header, mid.data.header);
  assert.deepEqual(third.options.map((o) => o.label), mid.data.options);
  assert.equal(third.multiSelect, false);
  assert.equal(askAgain(v, 1).question, old.data.question, 'a card asked before can be asked again');
  assert.equal(askAgain(v, 4).question, last.data.question);
  // The build's own question has no card yet: the front desk composes one.
  assert.equal(askAgain(v, 2), null);
  for (const n of [0, 5, -1, 1.5, '3', NaN, undefined]) assert.equal(askAgain(v, n), null, String(n));
  assert.equal(askAgain({}, 1), null);
  assert.equal(askAgain(null, 1), null);
});

test('askAgain counts a build-loop question that a card has already named once, as the board does', () => {
  const q = { key: 'q-export-csv-1', id: 'e1', at: T(2), data: { id: 'q-export-csv-1', work: 'export-csv', what: 'Which separator?', why: '', options: [], recommendation: '', level: 2 } };
  const answered = { id: 'c-old', at: T(1), kind: 'card', data: { question: 'What this is: x\nAnswer question q-export-csv-1\nReply code: ABCD' } };
  const card = waitingCard('c-new', 5, 'question');
  const v = views([card], loop({ works: [work('export-csv')], questions: [q] }));
  const events = [answered];
  const model = boardModel({ views: v, events, now: NOW });
  assert.deepEqual(model.director.waiting.map((w) => w.n), [1]);
  assert.equal(askAgain(v, 1, { events }).question, card.data.question);
  assert.equal(askAgain(v, 2, { events }), null);
});

test('a card written before cards carried their button words is asked again with its labels', () => {
  const { descriptions: _gone, ...old } = waitingCard('old', 1, 'approval').data;
  const v = views([{ id: 'old', at: T(1), data: old, asked: null }]);
  const [question] = cardsForVisit(v).questions;
  assert.deepEqual(question.options.map((o) => o.description), old.options);
});
