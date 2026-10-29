// tests/scripts/desk/acts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAct } from '../../../scripts/desk/acts.js';
import { checkEvidence } from '../../../scripts/desk/evidence.js';
import { makeEvent, confirmationFor } from '../../../scripts/state/events.js';
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
