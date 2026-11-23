// tests/scripts/desk/core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESK_VERSION, VIEWS, COMMANDS, WATCH_EVENTS, NO_EVIDENCE, needsEvidence } from '../../../scripts/desk/vocabulary.js';
import crypto from 'node:crypto';
import { deskCore, checkVersion } from '../../../scripts/desk/core.js';
import { clearPanels, panelLive } from '../../../scripts/desk/panel-live.js';
import { canonicalJson } from '../../../scripts/lib/canonical.js';

// A recorder that notes every call, so a test can say nothing was written.
function spyRecorder() {
  const calls = [];
  const note = (name) => async (...args) => { calls.push([name, ...args]); return { ok: true }; };
  return { calls, record: note('record'), write: note('write'), setStop: note('setStop'), liftStop: note('liftStop') };
}

const allow = { check: async () => ({ ok: true, records: [] }) };

test('the vocabulary is spec 5.2\'s, in its order', () => {
  assert.equal(DESK_VERSION, 'desk/1');
  assert.deepEqual(VIEWS, ['glance', 'briefing', 'logbook', 'waiting', 'card', 'work', 'settings', 'usage', 'preview', 'why', 'survey']);
  assert.deepEqual(COMMANDS, ['answer', 'suggest', 'not-now', 'request', 'set', 'all-stop', 'lift-all-stop', 'pair', 'safekeeping', 'pull-cards', 'unpair', 'ask-here']);
  assert.deepEqual(WATCH_EVENTS, ['card-added', 'card-closed', 'glance-changed', 'work-changed', 'all-stop', 'notice']);
  assert.deepEqual(NO_EVIDENCE, ['request', 'not-now', 'all-stop', 'pull-cards', 'unpair']);
  assert.ok(Object.isFrozen(VIEWS) && Object.isFrozen(COMMANDS) && Object.isFrozen(WATCH_EVENTS));
});

test('an unknown view is refused in plain words', async () => {
  const core = deskCore({ source: {}, recorder: spyRecorder(), verifier: allow });
  const answer = await core.read('dashboard', {});
  assert.equal(answer.ok, false);
  assert.equal(answer.v, 'desk/1');
  assert.match(answer.refused, /dashboard/);
});

test('an unknown command is refused', async () => {
  const recorder = spyRecorder();
  const core = deskCore({ source: {}, recorder, verifier: allow });
  const answer = await core.act('merge', {}, { form: 'window' });
  assert.equal(answer.ok, false);
  assert.match(answer.refused, /merge/);
  assert.deepEqual(recorder.calls, []);
});

test('checkVersion refuses a message for another version', () => {
  const answer = checkVersion({ v: 'desk/2' });
  assert.equal(answer.ok, false);
  assert.match(answer.refused, /desk\/2/);
  assert.deepEqual(checkVersion({ v: 'desk/1' }), { ok: true });
  assert.equal(checkVersion({}).ok, false);
});

test('an act that needs evidence is refused without it, and nothing is recorded', async () => {
  const recorder = spyRecorder();
  let checked = false;
  const verifier = { check: async () => { checked = true; return { ok: true, records: [] }; } };
  const core = deskCore({ source: {}, recorder, verifier });
  for (const command of ['answer', 'suggest', 'set', 'lift-all-stop']) {
    const answer = await core.act(command, { card: 'c1', option: 'Yes' });
    assert.equal(answer.ok, false, command);
    assert.match(answer.refused, /evidence|director/i, command);
  }
  assert.equal(checked, false);
  assert.deepEqual(recorder.calls, []);
});

test('request, not-now and all-stop need no evidence', () => {
  assert.equal(needsEvidence('request'), false);
  assert.equal(needsEvidence('not-now'), false);
  assert.equal(needsEvidence('all-stop'), false);
  assert.equal(needsEvidence('answer'), true);
  assert.equal(needsEvidence('suggest'), true);
  assert.equal(needsEvidence('set'), true);
  assert.equal(needsEvidence('lift-all-stop'), true);
});

test('a source that throws gives a refusal, never a throw', async () => {
  const source = new Proxy({}, { get: () => async () => { throw new Error('disk gone'); } });
  const core = deskCore({ source, recorder: spyRecorder(), verifier: allow, readers: { glance: async (args, s) => s.board({ offline: true }) } });
  const answer = await core.read('glance', {});
  assert.equal(answer.ok, false);
  assert.equal(answer.v, 'desk/1');
  assert.equal(typeof answer.refused, 'string');
  const watched = await core.watch(null);
  assert.equal(watched.ok, false);
});

// A signed watch marks the panel live, per project (Task 1.3).
const NOW = new Date('2026-11-23T01:00:00.000Z');
const nowAt = () => NOW;
const panelApp = (id = 'vscode-panel') => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const entry = { id, name: 'The panel', publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const signs = (cursor, at = NOW.toISOString(), project = 'o__p') => ({ form: 'client', client: id, at, sig: crypto.sign(null, Buffer.from(canonicalJson({ command: 'watch', args: { cursor }, at, project })), privateKey).toString('base64') });
  return { entry, signs };
};
const watching = (project, entry) => {
  clearPanels();
  return deskCore({ source: { project }, recorder: spyRecorder(), verifier: allow, now: nowAt, clients: () => [entry], watcher: async () => ({ ok: true, events: [], cursor: 'next' }) });
};

test('a watch with a paired app\'s signature marks the panel live, for that project only', async () => {
  const app = panelApp();
  const core = watching('o__p', app.entry);
  assert.equal(panelLive('o__p', NOW.getTime()), false);
  const got = await core.watch('cur-1', app.signs('cur-1'));
  assert.equal(got.ok, true);
  assert.equal(panelLive('o__p', NOW.getTime()), true);
  assert.equal(panelLive('o__other', NOW.getTime()), false, 'a mark is per project');
  const nullCursor = watching('o__p', app.entry);
  await nullCursor.watch(null, app.signs(null));
  assert.equal(panelLive('o__p', NOW.getTime()), true, 'a first watch has no cursor, and signs null');
});

test('an unsigned watch is answered and marks nothing', async () => {
  const app = panelApp();
  const core = watching('o__p', app.entry);
  const got = await core.watch('cur-1');
  assert.equal(got.ok, true);
  assert.equal(panelLive('o__p', NOW.getTime()), false);
  for (const evidence of [{}, { form: 'window' }, { form: 'chat-click', proof: 'chat-click' }, { form: 'signed', records: [] }, { form: 'client' }, 'client', 7, []]) {
    assert.equal((await core.watch('cur-1', evidence)).ok, true);
    assert.equal(panelLive('o__p', NOW.getTime()), false, JSON.stringify(evidence));
  }
});

test('a watch signed by a key that isn\'t paired marks nothing', async () => {
  const paired = panelApp();
  const stranger = panelApp();
  const core = watching('o__p', paired.entry);
  assert.equal((await core.watch('cur-1', stranger.signs('cur-1'))).ok, true);
  assert.equal(panelLive('o__p', NOW.getTime()), false, 'the stranger claims the paired id and signs with its own key');
  const named = panelApp('never-paired');
  await core.watch('cur-1', named.signs('cur-1'));
  assert.equal(panelLive('o__p', NOW.getTime()), false, 'an id that was never paired');
});

test('a watch whose time is six minutes old, or ahead by six, marks nothing', async () => {
  const app = panelApp();
  const core = watching('o__p', app.entry);
  for (const minutes of [-6, 6]) {
    const at = new Date(NOW.getTime() + minutes * 60 * 1000).toISOString();
    await core.watch('cur-1', app.signs('cur-1', at));
    assert.equal(panelLive('o__p', NOW.getTime()), false, `${minutes} minutes`);
  }
  await core.watch('cur-1', app.signs('cur-1', new Date(NOW.getTime() - 4 * 60 * 1000).toISOString()));
  assert.equal(panelLive('o__p', NOW.getTime()), true, 'four minutes old is within the window');
});

test('a watch signed for another project marks nothing, and the answer says whether the evidence checked', async () => {
  const app = panelApp();
  const core = watching('o__p', app.entry);
  const wrong = await core.watch('cur-1', app.signs('cur-1', NOW.toISOString(), 'o__other'));
  assert.equal(wrong.ok, true);
  assert.equal(wrong.paired, false);
  assert.equal(panelLive('o__p', NOW.getTime()), false);
  assert.equal(panelLive('o__other', NOW.getTime()), false);
  const good = await core.watch('cur-1', app.signs('cur-1'));
  assert.equal(good.paired, true);
  assert.equal((await core.watch('cur-1')).paired, undefined, 'a watch with no evidence says nothing about pairing');
  const stranger = panelApp();
  assert.equal((await core.watch('cur-1', stranger.signs('cur-1'))).paired, false, 'a key that is no longer paired');
});

test('a watch whose signature is over another cursor marks nothing', async () => {
  const app = panelApp();
  const core = watching('o__p', app.entry);
  await core.watch('cur-2', app.signs('cur-1'));
  assert.equal(panelLive('o__p', NOW.getTime()), false);
  const other = app.signs('cur-1');
  await core.watch('cur-1', { ...other, at: new Date(NOW.getTime() + 1000).toISOString() });
  assert.equal(panelLive('o__p', NOW.getTime()), false, 'nor a signature carried to another time');
});
