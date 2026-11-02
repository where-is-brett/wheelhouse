// tests/vscode/press.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { require, model, card, fakeView, fakeVscode } from './helpers.js';
import { pressCard } from '../../scripts/mod/press.js';
import { composeCard } from '../../scripts/cards/compose.js';
import { makeEvent, eventPath } from '../../scripts/state/events.js';
import { makeSigningKey, enrol, verify, readEnrolled } from '../../scripts/state/signing.js';
import { hashOf } from '../../scripts/mod/status.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { withHome } from '../helpers/homes.js';

const { onPaneMessage } = require('../../vscode/press.cjs');
const { makeNonces } = require('../../vscode/nonce.cjs');

const P = 'owner__name';
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const NOW = new Date('2026-11-02T05:00:00.000Z');

// The calls the press makes, in place of the scripts', so what the add-on asks of them can be read.
function stand({ answer = { made: true, says: 'Approved.' } } = {}) {
  const calls = { pressCard: [], whyCard: [], suggestCard: [], pressSetting: [], act: [], notified: [], opened: [], helperSigned: 0 };
  const deps = {
    nonces: makeNonces({ bytes: 32 }),
    project: P,
    cwd: '/work/project',
    model: () => model({ cards: [card()] }),
    press: {
      pressCard: async (a) => { calls.pressCard.push(a); return answer; },
      whyCard: async (a) => { calls.whyCard.push(a); return { made: true }; },
      suggestCard: async (a) => { calls.suggestCard.push(a); return { made: true, says: 'Sent.', submit: ['x'] }; },
      pressSetting: async (a) => { calls.pressSetting.push(a); return { made: true, says: 'Changed.' }; },
      digestText: async () => ({ ok: true, text: 'The briefing.' }),
      settingsGroups: async () => ({ groups: [] }),
    },
    desk: { act: async (...a) => { calls.act.push(a); return { ok: true }; }, read: async () => ({ ok: true }) },
    client: { sign: () => { calls.helperSigned += 1; } },
    notify: async (m) => { calls.notified.push(m); },
    open: async (u) => { calls.opened.push(u); },
    redraw: async () => {},
    show: async () => {},
    stopState: () => ({ on: false }),
    now: () => NOW,
  };
  return { calls, deps };
}

const press = (nonce, over = {}) => ({ nonce, type: 'press', card: 'c1', hash: 'abc123def456', choice: 'Approve', ...over });

test('a press with the pane\'s nonce asks the press for that card, its hash and its choice', async () => {
  const { calls, deps } = stand();
  const nonce = deps.nonces.renew();
  const out = await onPaneMessage(press(nonce), deps);
  assert.equal(out.made, true);
  assert.equal(calls.pressCard.length, 1);
  assert.deepEqual([calls.pressCard[0].card, calls.pressCard[0].hash, calls.pressCard[0].label, calls.pressCard[0].project], ['c1', 'abc123def456', 'Approve', P]);
  assert.equal(calls.pressCard[0].proof, 'add-on');
});

test('a press without the pane\'s nonce records nothing', async () => {
  const { calls, deps } = stand();
  deps.nonces.renew();
  for (const message of [press(undefined), press(''), press(null), press(42), press('b'.repeat(64)), { type: 'press', card: 'c1', hash: 'abc123def456', choice: 'Approve' }]) {
    const out = await onPaneMessage(message, deps);
    assert.equal(out.made, false);
  }
  assert.equal(calls.pressCard.length, 0);
  assert.equal(calls.act.length, 0);
});

test('a press with the last draw\'s nonce records nothing', async () => {
  const { calls, deps } = stand();
  const old = deps.nonces.renew();
  deps.nonces.renew();
  const out = await onPaneMessage(press(old), deps);
  assert.equal(out.made, false);
  assert.equal(calls.pressCard.length, 0);
});

test('a reloaded pane\'s old message records nothing', async () => {
  const { vscode } = { vscode: fakeVscode() };
  const { activate } = require('../../vscode/extension.cjs');
  const calls = [];
  const deps = {
    desk: { read: async () => ({ ok: true, data: { pane: model({ cards: [card()] }) } }), watch: async () => ({ ok: false }), act: async () => ({ ok: true }) },
    ask: async () => true, node: '/n', loop: false, startHelper: async () => {}, versions: async () => {},
    press: { pressCard: async (a) => { calls.push(a); return { made: true, says: 'ok' }; } },
    project: P,
  };
  const context = { subscriptions: [], extensionPath: '/ext', globalState: { get: () => true, update: async () => {} } };
  await activate(context, { vscode, deps });
  const view = fakeView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  const oldNonce = /data-nonce="([0-9a-f]+)"/.exec(view.html)[1];
  // The pane is reloaded: a new draw, a new nonce.
  const again = fakeView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(again);
  const newNonce = /data-nonce="([0-9a-f]+)"/.exec(again.html)[1];
  assert.notEqual(oldNonce, newNonce);
  assert.equal(oldNonce.length, 64);
  await view.send(press(oldNonce));
  assert.equal(calls.length, 0);
  await again.send(press(newNonce));
  assert.equal(calls.length, 1);
});

test('a press with a stale hash records nothing and says why', async () => {
  const answer = { made: false, says: 'That card changed: look at it again' };
  const { calls, deps } = stand({ answer });
  const nonce = deps.nonces.renew();
  const out = await onPaneMessage(press(nonce, { hash: 'old' }), deps);
  assert.equal(out.made, false);
  assert.equal(out.says, 'That card changed: look at it again');
  assert.deepEqual(calls.notified, ['That card changed: look at it again']);
});

test('a message that names anything but text for its fields records nothing', async () => {
  const { calls, deps } = stand();
  const nonce = deps.nonces.renew();
  for (const bad of [{ card: { id: 'c1' } }, { hash: 7 }, { choice: ['Approve'] }, { type: 'press-all' }, { type: 'constructor' }, { type: '__proto__' }]) {
    const out = await onPaneMessage(press(nonce, bad), deps);
    assert.equal(out.made, false);
  }
  assert.equal(calls.pressCard.length, 0);
});

test('STOP is set at once', async () => {
  const { calls, deps } = stand();
  const nonce = deps.nonces.renew();
  const order = [];
  deps.setStop = () => { order.push('set'); };
  deps.desk.act = async (...a) => { order.push('act'); calls.act.push(a); return { ok: true }; };
  const out = await onPaneMessage({ nonce, type: 'stop' }, deps);
  assert.equal(out.made, true);
  assert.deepEqual(order, ['set', 'act']);
  assert.deepEqual(calls.act[0].slice(0, 2), ['all-stop', { by: 'mod' }]);
  assert.equal(calls.pressCard.length, 0);
});

test('STOP is set even when the desk can\'t be reached', async () => {
  const { deps } = stand();
  const nonce = deps.nonces.renew();
  let set = false;
  deps.setStop = () => { set = true; };
  deps.desk.act = async () => { throw new Error('away'); };
  const out = await onPaneMessage({ nonce, type: 'stop' }, deps);
  assert.equal(set, true);
  assert.equal(out.made, true);
});

test('Lift STOP is a binding press: it signs here, for the STOP the pane drew, with the proof add-on', async () => {
  const { calls, deps } = stand();
  const nonce = deps.nonces.renew();
  deps.stopState = () => ({ on: true, at: '2026-11-02T04:00:00.000Z' });
  deps.liftQuestion = 'Lift All stop and let the agents carry on';
  const kept = [];
  deps.liftStop = () => {};
  deps.press.keepEarned = (project, got, options) => { kept.push({ project, got, options }); return { file: '/f', body: { event: { id: 'e1' } }, route: 'record' }; };
  deps.press.signedRecords = (record) => [{ event: record.body.event }];
  deps.press.sendKept = async () => { throw new Error('the add-on never sends a record on its own path when the desk took it'); };
  // The STOP the pane drew is not the STOP in force: nothing is signed.
  assert.equal((await onPaneMessage({ nonce, type: 'lift', since: '2026-11-02T03:00:00.000Z' }, deps)).made, false);
  assert.equal(kept.length, 0);
  assert.equal((await onPaneMessage({ nonce, type: 'lift', since: '' }, deps)).made, false);
  assert.equal(kept.length, 0);
  assert.equal((await onPaneMessage({ nonce, type: 'lift', since: '2026-11-02T04:00:00.000Z' }, deps)).made, true);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].options.proof, 'add-on');
  assert.equal(kept[0].got.lift, true);
  assert.equal(kept[0].got.made.data.action, 'lift-stop');
  assert.deepEqual(calls.act[0].slice(0, 2), ['lift-all-stop', {}]);
  assert.equal(calls.act[0][2].form, 'signed');
  assert.equal(calls.pressCard.length, 0);
  assert.equal(calls.helperSigned, 0);
});

test('a setting is pressed as the mod\'s settings pane presses it', async () => {
  const { calls, deps } = stand();
  const nonce = deps.nonces.renew();
  const out = await onPaneMessage({ nonce, type: 'setting', key: 'briefing', choice: 'off' }, deps);
  assert.equal(out.made, true);
  assert.equal(calls.pressSetting[0].key, 'briefing');
  assert.equal(calls.pressSetting[0].choice, 'off');
  assert.equal(calls.pressSetting[0].project, P);
});

test('the briefing is shown with no Copilot turn', async () => {
  const { calls, deps } = stand();
  const nonce = deps.nonces.renew();
  const shown = [];
  deps.show = async (view, data) => { shown.push([view, data]); };
  await onPaneMessage({ nonce, type: 'view', view: 'briefing' }, deps);
  assert.deepEqual(shown, [['briefing', { briefing: 'The briefing.' }]]);
  assert.equal(calls.pressCard.length, 0);
});

test('Why? and Suggest a change… go through their own commands, and neither presses a card', async () => {
  const { calls, deps } = stand();
  const nonce = deps.nonces.renew();
  await onPaneMessage({ nonce, type: 'why', card: 'c1', hash: 'abc123def456' }, deps);
  await onPaneMessage({ nonce, type: 'suggest', card: 'c1', hash: 'abc123def456', words: 'Make it blue' }, deps);
  assert.equal(calls.whyCard.length, 1);
  assert.equal(calls.suggestCard[0].words, 'Make it blue');
  assert.equal(calls.pressCard.length, 0);
});

test('a preview is opened from the address the pane\'s card carries, never from the message', async () => {
  const { calls, deps } = stand();
  const nonce = deps.nonces.renew();
  await onPaneMessage({ nonce, type: 'open', card: 'c1', href: 'https://evil.example.test/' }, deps);
  assert.deepEqual(calls.opened, ['https://preview.example.test/13']);
  await onPaneMessage({ nonce, type: 'open', card: 'missing' }, deps);
  assert.equal(calls.opened.length, 1);
});

test('the add-on never calls the helper to sign', () => {
  const sources = ['press.cjs', 'extension.cjs', 'desk.cjs'].map((f) => fs.readFileSync(new URL(`../../vscode/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const word of [/state\.record/, /profile\.record/, /chatClick/, /chat-click/, /(?<![\w.])sign\(/, /\.sign\(/]) {
    assert.ok(!word.test(sources), String(word));
  }
  // The only sending the press does of its own is sendKept, of a record it signed itself, and only when the desk didn't take it.
  assert.equal((fs.readFileSync(new URL('../../vscode/press.cjs', import.meta.url), 'utf8').match(/sendKept/g) ?? []).length, 1);
});

// The real press, on a real home: what the record names, and what an existing call writes as before.
const cardData = () => composeCard({
  why: 'It changes what users see, which is yours to decide at level 3.', because: 'the checks passed and the change is small.',
  meanwhile: 'Nothing is released and the agents carry on with other work.', level: 3, kind: 'approval', recommend: 'Approve',
  what: 'Pull request #13 changes the wording on the sign-in page.', options: [{ label: 'Approve', says: 'It approves and goes ahead.' }], target: { pr: 13, sha: FULL },
}).card;

function keepCard(data) {
  const event = makeEvent({ kind: 'card', data, now: () => NOW });
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
  return { id: event.id, hash: hashOf(data.question) };
}

const helper = () => {
  const recorded = [];
  return {
    recorded,
    prState: async () => ({ ok: true, result: { headSha: FULL, state: 'open' } }),
    goalRecheck: async () => ({ ok: true, refused: [] }),
    state: { write: async () => ({ ok: true }), record: async (b) => { recorded.push(b.event); return { ok: true }; } },
    profile: { record: async () => ({ ok: true }) },
  };
};

test('a press\'s record names the proof add-on, and the signature covers it', () => withHome(async () => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
  const c = keepCard(cardData());
  const client = helper();
  const out = await pressCard({ project: P, card: c.id, hash: c.hash, label: 'Approve', client, desk: { act: async () => ({ ok: false, refused: 'the host helper could not be reached', away: true }) }, now: () => NOW, liftStop: () => {}, proof: 'add-on' });
  assert.equal(out.made, true);
  const [event] = client.recorded;
  assert.equal(event.kind, 'approval');
  assert.equal(event.data.proof, 'add-on');
  assert.equal(verify(event, readEnrolled()), true);
  assert.equal(verify({ ...event, data: { ...event.data, proof: 'host' } }, readEnrolled()), false);
}));

test('a press with no proof writes what it wrote before', () => withHome(async () => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
  const c = keepCard(cardData());
  const client = helper();
  await pressCard({ project: P, card: c.id, hash: c.hash, label: 'Approve', client, desk: { act: async () => ({ ok: false, refused: 'the host helper could not be reached', away: true }) }, now: () => NOW, liftStop: () => {} });
  const [event] = client.recorded;
  assert.deepEqual(Object.keys(event.data).sort(), ['commit', 'pr', 'question', 'words']);
}));
