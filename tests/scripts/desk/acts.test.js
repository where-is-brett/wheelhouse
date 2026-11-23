// tests/scripts/desk/acts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { runAct } from '../../../scripts/desk/acts.js';
import { askToPair, pairClient, pairedClients, unpairClient, fingerprintOf } from '../../../scripts/desk/clients.js';
import { earned } from '../../../scripts/hooks/prompt-record.js';
import { pairLine, unpairLine } from '../../../scripts/state/card-lines.js';
import { checkEvidence } from '../../../scripts/desk/evidence.js';
import { needsEvidence } from '../../../scripts/desk/vocabulary.js';
import { makeEvent, confirmationFor, dataHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { hashOf, cardTextOf } from '../../../scripts/desk/card-text.js';
import { as, shortHome } from '../../helpers/homes.js';
import { CARD, NOW as NOW_ISO, now } from './fixture.js';
import { clearPanels, takeAskHere } from '../../../scripts/desk/panel-live.js';

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
  return { calls, record: note('record'), write: note('write'), setStop: note('setStop'), liftStop: note('liftStop'), chatClick: note('chatClick'), confirm: note('confirm'), panelApprove: note('panelApprove') };
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
  assert.deepEqual(recorder.calls[1][1], { kind: 'card-answer', data: { question: CARD.question, label: 'Approve', where: 'panel' } });
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
  assert.deepEqual(recorder.calls[0], ['write', { kind: 'card-answer', data: { question: CARD.question, label: 'Not now', where: 'panel' } }]);
  await runAct('answer', { card: 'merge-12', option: 'Not now', hash: 'b'.repeat(64) }, { ok: true, records: [], chatClick: true }, { source, recorder, now });
  assert.deepEqual(recorder.calls[1], ['chatClick', { card: 'merge-12', label: 'Not now', hash: 'b'.repeat(64), proof: 'chat-click' }]);
}));

test('a deciding answer from a paired app goes to panelApprove, not to a plain write', () => withKey(async () => {
  const source = memory();
  const recorder = spy();
  const got = await runAct('answer', { card: 'c1', option: 'Approve', hash: HASH, commit: 'a'.repeat(40) }, { ok: true, records: [], client: 'vscode-panel', decides: true }, { source, recorder, now });
  assert.equal(got.ok, true, got.refused);
  assert.deepEqual(recorder.calls, [['panelApprove', { card: 'c1', label: 'Approve', client: 'vscode-panel' }]]);
  assert.ok(got.changed.includes('approval'));
}));

test('a deciding answer the helper refuses is refused, and nothing else is written', () => withKey(async () => {
  const source = memory();
  const recorder = { ...spy(), panelApprove: async () => ({ ok: false, refused: 'This project has real users, so approve it in Wheelhouse\'s window or on the code host.' }) };
  const got = await runAct('answer', { card: 'c1', option: 'Approve', hash: HASH }, { ok: true, records: [], client: 'vscode-panel', decides: true }, { source, recorder, now });
  assert.equal(got.ok, false);
  assert.match(got.refused, /real users/);
  assert.deepEqual(recorder.calls, []);
}));

test('a plain answer from a paired app still goes to write, naming the app and deciding nothing', () => withKey(async () => {
  const recorder = spy();
  await runAct('answer', { card: 'c1', option: 'Not now', hash: HASH }, { ok: true, records: [], client: 'vscode-panel', decides: false }, { source: memory(), recorder, now });
  assert.deepEqual(recorder.calls, [['write', { kind: 'card-answer', data: { question: CARD.question, label: 'Not now', where: 'panel', proof: 'client', by: 'vscode-panel' } }]]);
}));

test('acts: all stop names the helm session it leaves running', () => withKey(async () => {
  const held = { ...memory(), async views() { return { ok: true, views: { waiting: [], helm: { login: { since: 'x', fromStart: false, opened: true }, search: { since: 'y', fromStart: false, opened: false }, build: { since: 'z', fromStart: true, opened: true } } }, names: [] }; } };
  const got = await runAct('all-stop', {}, { ok: true, records: [] }, { source: held, recorder: spy(), now });
  assert.equal(got.ok, true);
  assert.equal(got.says, "The helm session for build is the director's own, so it keeps running. The helm session for login is the director's own, so it keeps running.", 'search was taken but never opened, so it has no session');
  const none = await runAct('all-stop', {}, { ok: true, records: [] }, { source: memory(), recorder: spy(), now });
  assert.equal('says' in none, false, 'nothing held, nothing added');
}));

test('ask-here on a card that isn\'t waiting is refused, and marks nothing', () => withKey(async () => {
  clearPanels();
  const source = memory();
  const got = await runAct('ask-here', { card: 'gone' }, { ok: true, records: [], client: 'vscode-panel' }, { source, recorder: spy(), now });
  assert.equal(got.ok, false);
  assert.match(got.refused, /isn't waiting/);
  assert.equal((await runAct('ask-here', {}, { ok: true, records: [], client: 'vscode-panel' }, { source, recorder: spy(), now })).ok, false);
  assert.deepEqual(takeAskHere('p', Date.parse(NOW_ISO)), []);
}));

test('ask-here needs a paired app\'s signature: no signed record, window or chat click carries it', () => withKey(async () => {
  assert.equal(needsEvidence('ask-here'), true, 'it is not among the acts that need no evidence');
  const source = memory();
  const views = (await source.views()).views;
  const args = { card: 'c1' };
  const context = { enrolled: readEnrolled(), views, events: source.events(), now, clients: [] };
  for (const evidence of [{ form: 'window' }, { form: 'chat-click', proof: 'chat-click' }, { form: 'signed', records: [approve()] }, { form: 'client', client: 'vscode-panel', at: NOW_ISO, sig: 'AAAA' }]) {
    const got = checkEvidence('ask-here', args, evidence, context);
    assert.equal(got.ok, false, JSON.stringify(evidence));
  }
}));

// Unpair: the card the panel's Unpair button and the front desk's `unpair` raise.
const phone = () => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  return { id: 'phone-app', name: 'The phone app', publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
};
async function pairedPhone() {
  const app = phone();
  askToPair(app, { now });
  const record = await earned({ project: 'p', question: pairLine(app.id, fingerprintOf(app.publicKey)), label: 'Pair it', now });
  assert.equal(pairClient({ id: app.id }, makeEvent({ ...record.made, now }), { now }).ok, true);
  return app;
}

test('unpair raises one level-4 card naming the app and its key, and removes nothing itself', () => withKey(async () => {
  const app = await pairedPhone();
  const recorder = spy();
  const got = await runAct('unpair', { client: app.id }, { ok: true, records: [] }, { source: memory(), recorder, now });
  assert.equal(got.ok, true, got.refused);
  assert.equal(got.fingerprint, fingerprintOf(app.publicKey));
  assert.equal(recorder.calls.length, 1);
  const [name, written] = recorder.calls[0];
  assert.equal(name, 'write');
  assert.equal(written.kind, 'card');
  assert.equal(written.data.kind, 'unpair');
  assert.equal(written.data.level, 4);
  assert.equal(written.data.line, unpairLine(app.id, fingerprintOf(app.publicKey)));
  assert.deepEqual(written.data.options, ['Unpair it', 'Not now']);
  assert.equal(pairedClients().length, 1, 'asking unpairs nothing');
  // The director's click on it, signed as the prompt record signs it, removes the key.
  const click = await earned({ project: 'p', question: written.data.question, label: 'Unpair it', now });
  assert.equal(unpairClient(app.id, makeEvent({ ...click.made, now })).ok, true);
  assert.deepEqual(pairedClients(), []);
}));

test('unpair skips a repeat while an Unpair card for the app already waits', () => withKey(async () => {
  const app = await pairedPhone();
  const line = unpairLine(app.id, fingerprintOf(app.publicKey));
  const source = memory({ waiting: [{ id: 'u-1', at: cardEvent.at, data: { ...CARD, kind: 'unpair', line } }] });
  const recorder = spy();
  const got = await runAct('unpair', { client: app.id }, { ok: true, records: [] }, { source, recorder, now });
  assert.deepEqual([got.ok, got.card, got.changed], [true, 'u-1', []]);
  assert.deepEqual(recorder.calls, [], 'no second card');
}));

test('unpair for an app that isn\'t paired is refused, raising nothing', () => withKey(async () => {
  const recorder = spy();
  const got = await runAct('unpair', { client: 'never-paired' }, { ok: true, records: [] }, { source: memory(), recorder, now });
  assert.equal(got.ok, false);
  assert.match(got.refused, /never-paired/);
  assert.deepEqual(recorder.calls, []);
  assert.equal((await runAct('unpair', {}, { ok: true, records: [] }, { source: memory(), recorder, now })).ok, false);
}));
