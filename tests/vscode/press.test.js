// tests/vscode/press.test.js
// What a message from the panel may do: only the panel's own buttons, with the latest nonce, on a card that is
// still waiting as it was drawn, reach an act.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { require, fakeDesk, waitingView, settle, start } from './helpers.js';

const { press, askToPair } = require('../../vscode/press.cjs');
const { makeNonces } = require('../../vscode/nonce.cjs');

const hashOf = (question) => crypto.createHash('sha256').update(question).digest('hex').slice(0, 12);
const PLAIN = { id: 'ask-colour', data: { kind: 'question', question: 'Which colour?', options: ['Blue', 'Green'] } };
const MERGE = { id: 'merge-7', data: { kind: 'approval', level: 3, question: 'Merge pull request 7?', line: 'Approve pull request #7 at commit 0123456789ab', options: ['Approve', 'Send it back'] } };
const STEP = { id: 'lift-stop-1', data: { kind: 'lift-stop', question: 'Lift All stop?', options: ['Lift All stop'] } };
const DECISION = { id: 'choose-1', data: { kind: 'answer', question: 'Which way?', options: ['Do it', 'Leave it'] } };
const OFFERED = [PLAIN, MERGE, STEP, DECISION].map((c) => ({ id: c.id, at: 'x', data: c.data }));
const APP = { id: 'vscode-panel-12345678', name: 'Wheelhouse for VS Code', publicKey: 'AAAA' };

function setup() {
  const nonces = makeNonces();
  const nonce = nonces.renew();
  const desk = fakeDesk();
  const acts = [];
  desk.act = async (command, args) => { acts.push([command, args]); return { ok: true, changed: ['card-answer'] }; };
  const ctx = (extra = {}) => ({ latestNonce: nonces.latest(), client: desk, waiting: OFFERED, app: APP, ...extra });
  return { nonces, nonce, desk, acts, ctx };
}
const msg = (nonce, card, extra = {}) => ({ type: 'press', nonce, card: card.id, hash: hashOf(card.data.question), ...extra });

test('a press with a stale nonce does nothing', async () => {
  const { nonces, nonce, acts, ctx } = setup();
  nonces.renew();
  const got = await press(msg(nonce, PLAIN, { option: 'Blue' }), ctx());
  assert.equal(got.ok, false);
  assert.deepEqual(acts, []);
});

test('a press with no nonce, a wrong one, or a message that is not an object does nothing', async () => {
  const { nonce, acts, ctx } = setup();
  for (const bad of [null, undefined, 'press', 7, [], { type: 'press', card: PLAIN.id, option: 'Blue', hash: hashOf(PLAIN.data.question) }, msg('ab'.repeat(32), PLAIN, { option: 'Blue' }), msg(nonce.slice(0, -1), PLAIN, { option: 'Blue' }), msg(12, PLAIN, { option: 'Blue' })]) {
    assert.equal((await press(bad, ctx())).ok, false);
  }
  assert.deepEqual(acts, []);
});

test('a press with no draw yet (no latest nonce) does nothing', async () => {
  const { nonce, acts, desk } = setup();
  assert.equal((await press(msg(nonce, PLAIN, { option: 'Blue' }), { latestNonce: null, client: desk, waiting: OFFERED, app: APP })).ok, false);
  assert.deepEqual(acts, []);
});

test('a press naming an act outside the list does nothing', async () => {
  const { nonce, acts, ctx } = setup();
  for (const type of ['lift-all-stop', 'set', 'safekeeping', 'request', 'watch', 'read', '__proto__', 'constructor', 'Answer', '']) {
    assert.equal((await press({ type, nonce, card: PLAIN.id, hash: hashOf(PLAIN.data.question), option: 'Blue' }, ctx())).ok, false, type);
  }
  assert.equal((await press({ nonce, card: PLAIN.id, option: 'Blue' }, ctx())).ok, false);
  assert.deepEqual(acts, []);
});

test('an answer carries the live card, its hash and the option, and nothing the page adds', async () => {
  const { nonce, acts, ctx } = setup();
  const got = await press(msg(nonce, PLAIN, { option: 'Blue', command: 'lift-all-stop', args: { x: 1 }, commit: 'deadbeefdead', project: 'other' }), ctx());
  assert.equal(got.ok, true);
  assert.deepEqual(acts, [['answer', { card: 'ask-colour', hash: hashOf('Which colour?'), option: 'Blue' }]]);
});

test('an answer naming an option the live card does not offer is not sent', async () => {
  const { nonce, acts, ctx } = setup();
  const got = await press(msg(nonce, PLAIN, { option: 'Red' }), ctx());
  assert.equal(got.ok, false);
  assert.match(got.says, /changed/i);
  assert.deepEqual(acts, []);
});

test('a press on a card that is not waiting, or whose hash differs, is not sent', async () => {
  const { nonce, acts, ctx } = setup();
  assert.equal((await press({ type: 'press', nonce, card: 'gone', hash: 'abc', option: 'Blue' }, ctx())).ok, false);
  assert.equal((await press({ type: 'press', nonce, card: PLAIN.id, hash: 'wrong', option: 'Blue' }, ctx())).ok, false);
  assert.equal((await press({ type: 'press', nonce, card: PLAIN.id, option: 'Blue' }, ctx())).ok, false);
  assert.deepEqual(acts, []);
});

test('an Approve on a merge card carries the commit from the card', async () => {
  const { nonce, acts, ctx } = setup();
  const got = await press(msg(nonce, MERGE, { option: 'Approve', commit: 'ffffffffffff' }), ctx());
  assert.equal(got.ok, true);
  assert.deepEqual(acts, [['answer', { card: 'merge-7', hash: hashOf('Merge pull request 7?'), option: 'Approve', commit: '0123456789ab' }]]);
});

test('a confirmed step, a decision, or a deciding option off a merge card is not sent, and says where to answer', async () => {
  const { nonce, acts, ctx } = setup();
  for (const [card, option] of [[STEP, 'Lift All stop'], [DECISION, 'Do it']]) {
    const got = await press(msg(nonce, card, { option }), ctx());
    assert.equal(got.ok, false);
    assert.match(got.says, /window/);
  }
  const lone = { id: 'ask-ship', data: { kind: 'question', question: 'Ship it?', options: ['Do it', 'Wait'] } };
  const got = await press(msg(nonce, lone, { option: 'Do it' }), ctx({ waiting: [{ id: lone.id, at: 'x', data: lone.data }] }));
  assert.equal(got.ok, false);
  assert.deepEqual(acts, []);
});

test('Not now, Ask me here and a suggestion are built from the live card', async () => {
  const { nonce, acts, ctx } = setup();
  await press({ ...msg(nonce, PLAIN), type: 'not-now' }, ctx());
  await press({ ...msg(nonce, PLAIN), type: 'ask-here' }, ctx());
  await press({ ...msg(nonce, PLAIN), type: 'suggest', words: 'Try teal' }, ctx());
  assert.deepEqual(acts, [
    ['not-now', { card: 'ask-colour', hash: hashOf('Which colour?') }],
    ['ask-here', { card: 'ask-colour' }],
    ['suggest', { card: 'ask-colour', hash: hashOf('Which colour?'), words: 'Try teal' }],
  ]);
  assert.equal((await press({ ...msg(nonce, PLAIN), type: 'suggest', words: '   ' }, ctx())).ok, false);
  assert.equal(acts.length, 3);
});

test('a suggestion is cut to the longest the desk takes', async () => {
  const { nonce, acts, ctx } = setup();
  await press({ ...msg(nonce, PLAIN), type: 'suggest', words: 'x'.repeat(9000) }, ctx());
  assert.equal(acts[0][1].words.length, 4000);
});

test('All stop, Pull cards, Pair and Unpair carry only what the add-on knows', async () => {
  const { nonce, acts, ctx } = setup();
  const extra = { card: PLAIN.id, option: 'Blue', client: 'someone-else', args: { y: 2 } };
  await press({ type: 'all-stop', nonce, ...extra }, ctx());
  await press({ type: 'pull-cards', nonce, ...extra }, ctx());
  await press({ type: 'pair', nonce, ...extra }, ctx());
  await press({ type: 'unpair', nonce, ...extra }, ctx());
  assert.deepEqual(acts, [
    ['all-stop', { by: 'panel' }],
    ['pull-cards', {}],
    ['pair', { client: { id: APP.id, name: APP.name, publicKey: APP.publicKey } }],
    ['unpair', { client: APP.id }],
  ]);
});

test('a refusal is shown in the helper\'s words', async () => {
  const { nonce, desk, ctx } = setup();
  desk.act = async () => ({ ok: false, refused: 'This project has real users, so approve in the window or on the code host' });
  const got = await press(msg(nonce, MERGE, { option: 'Approve' }), ctx());
  assert.equal(got.ok, false);
  assert.equal(got.says, 'This project has real users, so approve in the window or on the code host');
});

test('a helper that is down or needs an update says so, in words', async () => {
  const { nonce, desk, ctx } = setup();
  desk.act = async () => ({ ok: false, update: true, refused: 'Wheelhouse can\'t answer' });
  assert.match((await press(msg(nonce, PLAIN, { option: 'Blue' }), ctx())).says, /Update Wheelhouse/);
  desk.act = async () => ({ ok: false, down: true });
  assert.match((await press(msg(nonce, PLAIN, { option: 'Blue' }), ctx())).says, /isn't running/);
});

test('an act that throws is refused, never thrown', async () => {
  const { nonce, desk, ctx } = setup();
  desk.act = async () => { throw new Error('boom'); };
  const got = await press(msg(nonce, PLAIN, { option: 'Blue' }), ctx());
  assert.equal(got.ok, false);
  assert.ok(got.says);
});

test('askToPair asks the helper to raise the Pair card for this app and nothing else', async () => {
  const { acts, desk } = setup();
  await askToPair(desk, APP);
  assert.deepEqual(acts, [['pair', { client: { id: APP.id, name: APP.name, publicKey: APP.publicKey } }]]);
});

test('the nonce is new for each draw, in memory only, and compared exactly', () => {
  const nonces = makeNonces();
  assert.equal(nonces.latest(), null);
  assert.equal(nonces.matches(null), false);
  const first = nonces.renew();
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(nonces.matches(first), true);
  assert.equal(nonces.matches(first.toUpperCase()), false);
  const second = nonces.renew();
  assert.notEqual(first, second);
  assert.equal(nonces.matches(first), false);
  nonces.clear();
  assert.equal(nonces.matches(second), false);
});

// The wiring: the panel's message handler is the only door in.
async function wired({ paired = true } = {}) {
  const desk = fakeDesk({ paired });
  const acts = [];
  desk.act = async (command, args) => { acts.push([command, args]); return command === 'pair' ? { ok: true, fingerprint: 'abc123abc123' } : { ok: true }; };
  desk.state.views.waiting = waitingView([PLAIN, MERGE]);
  const box = { messages: [], received: null, shown: [] };
  const render = (state, { nonce }) => { box.last = { state, nonce }; return `<p>${nonce}</p>`; };
  const ran = await start({ desk, render });
  return { ...ran, box, desk, acts };
}

test('the add-on hands every message of the panel to the press, with the nonce of the latest draw', async () => {
  const ran = await wired();
  const { view, acts } = ran;
  const handlers = [];
  view.webview.onDidReceiveMessage = (fn) => { handlers.push(fn); return { dispose() {} }; };
  const ext = require('../../vscode/extension.cjs');
  const vscode = ran.vscode;
  // A second resolve of the view registers the panel's handler on this view.
  vscode.seen.providers.get(ext.PANEL_ID).resolveWebviewView(view);
  await settle();
  assert.equal(handlers.length, 1);
  const nonce = /<p>([0-9a-f]+)<\/p>/.exec(view.html)[1];
  await handlers[0]({ type: 'press', nonce: 'wrong', card: PLAIN.id, hash: hashOf(PLAIN.data.question), option: 'Blue' });
  await settle();
  assert.deepEqual(acts, []);
  await handlers[0]({ type: 'press', nonce, card: PLAIN.id, hash: hashOf(PLAIN.data.question), option: 'Blue' });
  await settle();
  assert.deepEqual(acts, [['answer', { card: 'ask-colour', hash: hashOf('Which colour?'), option: 'Blue' }]]);
  // Drawing again renews the nonce: the old one no longer counts.
  view.show(false);
  view.show(true);
  await settle();
  const again = /<p>([0-9a-f]+)<\/p>/.exec(view.html)[1];
  assert.notEqual(again, nonce);
  await handlers[0]({ type: 'press', nonce, card: PLAIN.id, hash: hashOf(PLAIN.data.question), option: 'Blue' });
  await settle();
  assert.equal(acts.length, 1);
});

test('a refusal from the helper is shown to the director in its own words', async () => {
  const ran = await wired();
  const { view, desk, vscode } = ran;
  const shown = [];
  vscode.window.showInformationMessage = async (words) => { shown.push(words); };
  const handlers = [];
  view.webview.onDidReceiveMessage = (fn) => { handlers.push(fn); return { dispose() {} }; };
  desk.act = async () => ({ ok: false, refused: 'This project has real users, so approve in the window' });
  vscode.seen.providers.get(require('../../vscode/extension.cjs').PANEL_ID).resolveWebviewView(view);
  await settle();
  const nonce = /<p>([0-9a-f]+)<\/p>/.exec(view.html)[1];
  await handlers[0]({ type: 'press', nonce, card: MERGE.id, hash: hashOf(MERGE.data.question), option: 'Approve' });
  await settle();
  assert.deepEqual(shown, ['This project has real users, so approve in the window']);
});
