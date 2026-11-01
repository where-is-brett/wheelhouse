// tests/scripts/desk/acts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAct } from '../../../scripts/desk/acts.js';
import { checkEvidence } from '../../../scripts/desk/evidence.js';
import { needsEvidence } from '../../../scripts/desk/vocabulary.js';
import { makeEvent, confirmationFor, dataHash } from '../../../scripts/state/events.js';
import { sheetHash } from '../../../scripts/engine/goal.js';
import { startGoalLine } from '../../../scripts/state/card-lines.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { hashOf, cardTextOf } from '../../../scripts/mod/status.js';
import { as, shortHome } from '../../helpers/homes.js';
import { CARD, now } from './fixture.js';

const HASH = hashOf(cardTextOf(CARD));
const cardEvent = { id: 'c1', kind: 'card', at: '2026-10-29T09:00:00.000Z', computer: 'x', data: CARD };

// A source over memory: the waiting cards and the events, as the record would give them.
function memory({ waiting = [{ id: 'c1', at: cardEvent.at, data: CARD }], events = [cardEvent], stop = { on: false } } = {}) {
  return {
    project: 'p',
    async views() { return { ok: true, views: { waiting }, names: [], cards: events.filter((e) => e.kind === 'card') }; },
    events: () => events,
    enrolled: () => readEnrolled(),
    async stop() { return stop; },
  };
}

function spy() {
  const calls = [];
  const note = (name) => async (arg) => { calls.push([name, arg]); return { ok: true }; };
  return { calls, record: note('record'), write: note('write'), setStop: note('setStop'), liftStop: note('liftStop'), chatClick: note('chatClick'), confirm: note('confirm') };
}

function withKey(fn) {
  return as(shortHome(), async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-01T00:00:00.000Z' });
    return fn();
  });
}

const approve = () => makeEvent({ kind: 'action', data: { action: 'approve-work', work: 'export-csv', lane: 'feature', hash: 'a'.repeat(64), shownFirst: false, question: CARD.question, label: 'Approve' }, now });
const signedFor = async (command, args, records, source) => checkEvidence(command, args, { form: 'signed', records }, {
  enrolled: readEnrolled(), views: (await source.views()).views, events: source.events(), now,
});

test('an answer to a card that changed is refused with the line saying which answer counted', () => withKey(async () => {
  const source = memory();
  const recorder = spy();
  const args = { card: 'c1', option: 'Approve', hash: 'stale0000000' };
  const got = await runAct('answer', args, await signedFor('answer', args, [approve()], source), { source, recorder, now });
  assert.equal(got.ok, false);
  assert.match(got.refused, /changed since it was shown/);
  assert.match(got.refused, /no answer to it counted/);
  assert.deepEqual(recorder.calls, []);
}));

test('an answer to a card already decided is refused, and the stale click is not recorded', () => withKey(async () => {
  const decided = makeEvent({ kind: 'card-answer', data: { question: CARD.question, label: 'Not now' }, now });
  const putOff = makeEvent({ kind: 'action', data: { action: 'approve-work', work: 'export-csv', lane: 'feature', hash: 'a'.repeat(64), shownFirst: false, question: CARD.question, label: 'Approve' }, now: () => new Date('2026-10-29T10:00:00.000Z') });
  const source = memory({ waiting: [], events: [cardEvent, decided, putOff] });
  const recorder = spy();
  const got = await runAct('answer', { card: 'c1', option: 'Approve', hash: HASH }, { ok: true, records: [{ event: approve() }] }, { source, recorder, now });
  assert.equal(got.ok, false);
  assert.match(got.refused, /already answered/);
  assert.match(got.refused, /Approve/);
  assert.deepEqual(recorder.calls, []);
}));

test('answer writes the signed record and the card-answer once', () => withKey(async () => {
  const source = memory();
  const recorder = spy();
  const args = { card: 'c1', option: 'Approve', hash: HASH };
  const record = approve();
  const got = await runAct('answer', args, await signedFor('answer', args, [record], source), { source, recorder, now });
  assert.equal(got.ok, true, got.refused);
  assert.deepEqual(recorder.calls.map(([name]) => name), ['record', 'write']);
  assert.equal(recorder.calls[0][1].event.id, record.id);
  assert.deepEqual(recorder.calls[1][1], { kind: 'card-answer', data: { question: CARD.question, label: 'Approve' } });
}));

test('set writes the setting and its confirmation', () => withKey(async () => {
  const source = memory();
  const recorder = spy();
  const setting = makeEvent({ kind: 'setting', data: { key: 'briefing', value: 'short', words: 'Briefing: short' }, now });
  const confirmation = makeEvent({ ...confirmationFor(setting), now });
  const args = { setting: 'briefing', value: 'short' };
  const checked = await signedFor('set', args, [{ event: confirmation, target: setting }], source);
  assert.equal(checked.ok, true, checked.refused);
  const got = await runAct('set', args, checked, { source, recorder, now });
  assert.equal(got.ok, true);
  assert.deepEqual(recorder.calls, [['record', { event: confirmation, target: setting, profile: false }]]);
}));

test('pull-cards names every card held back, and asks no evidence', () => withKey(async () => {
  const source = memory();
  source.views = async () => ({ ok: true, views: { waiting: [], cardsWaiting: { count: 2, ids: ['q-a-1', 'q-b-2'], pulled: [] } }, names: [], cards: [] });
  const recorder = spy();
  const got = await runAct('pull-cards', {}, { ok: true, records: [] }, { source, recorder, now });
  assert.equal(got.ok, true);
  assert.deepEqual(recorder.calls, [['write', { kind: 'note', data: { about: 'cards-pulled', ids: ['q-a-1', 'q-b-2'] } }]]);
  assert.equal(needsEvidence('pull-cards'), false);
}));

test('pull-cards with nothing held back writes nothing', () => withKey(async () => {
  const recorder = spy();
  const got = await runAct('pull-cards', {}, { ok: true, records: [] }, { source: memory(), recorder, now });
  assert.equal(got.ok, true);
  assert.deepEqual(recorder.calls, []);
}));

test('request is written and shows in waiting', () => withKey(async () => {
  const source = memory();
  const recorder = spy();
  const got = await runAct('request', { words: 'Add a dark mode', via: 'app' }, { ok: true, records: [] }, { source, recorder, now });
  assert.equal(got.ok, true);
  assert.deepEqual(recorder.calls, [['write', { kind: 'request', data: { words: 'Add a dark mode', via: 'app' } }]]);
  const made = makeEvent({ kind: 'request', data: { words: 'Add a dark mode', via: 'app' }, now });
  assert.equal(made.kind, 'request');
}));

test('lift-all-stop without a signed lift-stop action leaves STOP on', () => withKey(async () => {
  const source = memory({ stop: { on: true } });
  const recorder = spy();
  const checked = await signedFor('lift-all-stop', {}, [approve()], source);
  assert.equal(checked.ok, false);
  const got = await runAct('lift-all-stop', {}, { ok: true, records: [] }, { source, recorder, now });
  assert.equal(got.ok, false);
  assert.deepEqual(recorder.calls, []);
}));

test('all-stop sets STOP with who set it', () => withKey(async () => {
  const recorder = spy();
  const got = await runAct('all-stop', { by: 'mod' }, { ok: true, records: [] }, { source: memory(), recorder, now });
  assert.equal(got.ok, true);
  assert.deepEqual(recorder.calls, [['setStop', { by: 'mod' }]]);
}));

test('not-now writes the plain card-answer, and a chat click goes the helper\'s chat route', () => withKey(async () => {
  const source = memory();
  const recorder = spy();
  assert.equal((await runAct('not-now', { card: 'c1' }, { ok: true, records: [] }, { source, recorder, now })).ok, true);
  assert.deepEqual(recorder.calls[0], ['write', { kind: 'card-answer', data: { question: CARD.question, label: 'Not now' } }]);
  await runAct('answer', { card: 'merge-12', option: 'Not now', hash: 'b'.repeat(64) }, { ok: true, records: [], chatClick: true }, { source, recorder, now });
  assert.deepEqual(recorder.calls[1], ['chatClick', { card: 'merge-12', label: 'Not now', hash: 'b'.repeat(64), proof: 'chat-click' }]);
}));

// --- goals ---

const GOAL_NOW = now();
const hoursAfter = (h) => new Date(GOAL_NOW.getTime() + h * 3600000).toISOString();
const PIECE = { title: 'Export a report as a spreadsheet file', lane: 'feature' };
const sheetOf = (over = {}) => ({
  title: 'Customers can export their orders',
  done: [{ command: 'node check.js', expect: 0 }],
  checksSay: ['The checking script passes.'],
  pieces: [{ work: 'export-page', hash: dataHash(PIECE) }],
  areas: { may: ['src/**'], wontTouch: ['billing/**'] },
  spend: { tokens: 1000000 },
  until: hoursAfter(8),
  ...over,
});
const goalEvent = (sheet, id = 'orders-export') => ({ id: `g-${id}`, kind: 'goal', at: '2026-10-29T11:00:00.000Z', computer: 'x', data: { id, sheet } });
const startOf = (sheet, goal = 'orders-export', hash = sheetHash(sheet)) => makeEvent({
  kind: 'action', data: { action: 'start-goal', goal, hash, label: 'Start', question: `Start this goal?\n${startGoalLine(goal, hash)}` }, now,
});
const runningEntry = (sheet) => ({ sheet, hash: sheetHash(sheet), startedAt: '2026-10-29T11:30:00.000Z', ended: null, endAsked: null });

// A source over memory whose views hold the work and the goals given.
function goalMemory({ events = [], goals = {}, work = { 'export-page': { work: { data: PIECE } } } } = {}) {
  return {
    project: 'p',
    async views() { return { ok: true, views: { waiting: [], goals, work }, names: [], cards: [] }; },
    events: () => events,
    enrolled: () => readEnrolled(),
    async stop() { return { on: false }; },
  };
}
const startArgs = (sheet) => ({ goal: 'orders-export', hash: sheetHash(sheet) });
const startGoal = async (source, recorder, args, record) => runAct('start-goal', args, await signedFor('start-goal', args, record === undefined ? [] : [record], source), { source, recorder, now });

test('start-goal records the signed action and names the goal', () => withKey(async () => {
  const sheet = sheetOf();
  const source = goalMemory({ events: [goalEvent(sheet)] });
  const recorder = spy();
  const record = startOf(sheet);
  const got = await runAct('start-goal', startArgs(sheet), await signedFor('start-goal', startArgs(sheet), [record], source), { source, recorder, now });
  assert.deepEqual(got, { ok: true, changed: ['goal'], goal: 'orders-export' });
  assert.deepEqual(recorder.calls.map(([name]) => name), ['record']);
  assert.equal(recorder.calls[0][1].event.id, record.id);
}));

test('start-goal needs the director\'s signed Start, so a paired app\'s own signature starts nothing', () => withKey(async () => {
  const sheet = sheetOf();
  const source = goalMemory({ events: [goalEvent(sheet)] });
  const recorder = spy();
  const got = await runAct('start-goal', startArgs(sheet), { ok: true, records: [], client: 'phone-app' }, { source, recorder, now });
  assert.equal(got.ok, false);
  assert.match(got.refused, /signed Start/);
  assert.deepEqual(recorder.calls, []);
}));

test('start-goal with a changed work record, a wrong hash or a past until records nothing', () => withKey(async () => {
  const sheet = sheetOf();
  const refusals = [
    // The work record changed since the sheet was made.
    [goalMemory({ events: [goalEvent(sheet)], work: { 'export-page': { work: { data: { ...PIECE, title: 'Something else' } } } } }), startArgs(sheet), sheet, /export-page/],
    // A piece with no work record at all.
    [goalMemory({ events: [goalEvent(sheet)], work: {} }), startArgs(sheet), sheet, /export-page/],
    // No sheet of that goal has the hash.
    [goalMemory({ events: [goalEvent(sheet)] }), { goal: 'orders-export', hash: 'f'.repeat(64) }, sheet, /hash/],
    [goalMemory({ events: [] }), startArgs(sheet), sheet, /hash/],
    // The until has passed.
    (() => {
      const late = sheetOf({ until: hoursAfter(-1) });
      return [goalMemory({ events: [goalEvent(late)] }), startArgs(late), late, /later than now/];
    })(),
  ];
  for (const [source, args, signed, pattern] of refusals) {
    const recorder = spy();
    const got = await startGoal(source, recorder, args, startOf(signed, args.goal, args.hash));
    assert.equal(got.ok, false, String(pattern));
    assert.match(got.refused, pattern);
    assert.deepEqual(recorder.calls, [], String(pattern));
  }
}));

test('a second goal in a project is refused while one is in force, and one started before is not started again', () => withKey(async () => {
  const sheet = sheetOf();
  const other = sheetOf({ title: 'Another goal' });
  const running = goalMemory({ events: [goalEvent(sheet), goalEvent(other, 'another-goal')], goals: { 'orders-export': runningEntry(sheet) } });
  const recorder = spy();
  const got = await startGoal(running, recorder, { goal: 'another-goal', hash: sheetHash(other) }, startOf(other, 'another-goal'));
  assert.equal(got.ok, false);
  assert.match(got.refused, /orders-export/);
  assert.match(got.refused, /one goal runs at a time/);
  // The same goal, ended, is not started a second time either.
  const ended = goalMemory({ events: [goalEvent(sheet)], goals: { 'orders-export': { ...runningEntry(sheet), ended: { ending: 'done', at: '2026-10-29T11:45:00.000Z', spent: {} } } } });
  const again = await startGoal(ended, recorder, startArgs(sheet), startOf(sheet));
  assert.equal(again.ok, false);
  assert.match(again.refused, /started before/);
  assert.deepEqual(recorder.calls, []);
}));

test('end-goal needs no evidence, and records whether it means now', async () => {
  assert.equal(needsEvidence('end-goal'), false);
  assert.equal(needsEvidence('narrow-goal'), false);
  const sheet = sheetOf();
  const source = goalMemory({ goals: { 'orders-export': runningEntry(sheet) } });
  for (const [args, now_] of [[{}, false], [{ now: true }, true], [{ now: 'yes' }, false]]) {
    const recorder = spy();
    const got = await runAct('end-goal', args, { ok: true, records: [] }, { source, recorder, now });
    assert.deepEqual(got, { ok: true, changed: ['goal'] });
    assert.deepEqual(recorder.calls, [['write', { kind: 'note', data: { about: 'end-goal', goal: 'orders-export', now: now_ } }]]);
  }
  const none = spy();
  const refused = await runAct('end-goal', {}, { ok: true, records: [] }, { source: goalMemory(), recorder: none, now });
  assert.deepEqual(refused, { ok: false, refused: 'No goal is running' });
  assert.deepEqual(none.calls, []);
});

test('a narrowing that widens anything is refused', async () => {
  const sheet = sheetOf();
  const source = goalMemory({ goals: { 'orders-export': runningEntry(sheet) } });
  const narrows = { until: hoursAfter(4), spend: { tokens: 500000 } };
  const recorder = spy();
  const got = await runAct('narrow-goal', { change: narrows }, { ok: true, records: [] }, { source, recorder, now });
  assert.deepEqual(got, { ok: true, changed: ['goal'] });
  assert.deepEqual(recorder.calls, [['write', { kind: 'note', data: { about: 'narrow-goal', goal: 'orders-export', change: narrows } }]]);

  const refusing = spy();
  for (const change of [{ until: hoursAfter(9) }, { spend: { tokens: 2000000 } }, { areas: { may: ['src/**', 'docs/**'] } }, { title: 'Bigger' }, undefined]) {
    const widened = await runAct('narrow-goal', { change }, { ok: true, records: [] }, { source, recorder: refusing, now });
    assert.equal(widened.ok, false);
    assert.match(widened.refused, /widens a goal needs a new sheet/);
  }
  const none = await runAct('narrow-goal', { change: narrows }, { ok: true, records: [] }, { source: goalMemory(), recorder: refusing, now });
  assert.equal(none.ok, false);
  assert.deepEqual(refusing.calls, []);
});
