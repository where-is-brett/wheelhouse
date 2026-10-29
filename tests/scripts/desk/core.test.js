// tests/scripts/desk/core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESK_VERSION, VIEWS, COMMANDS, WATCH_EVENTS, NO_EVIDENCE, needsEvidence } from '../../../scripts/desk/vocabulary.js';
import { deskCore, checkVersion } from '../../../scripts/desk/core.js';

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
  assert.deepEqual(COMMANDS, ['answer', 'suggest', 'not-now', 'request', 'set', 'all-stop', 'lift-all-stop', 'pair']);
  assert.deepEqual(WATCH_EVENTS, ['card-added', 'card-closed', 'glance-changed', 'work-changed', 'all-stop', 'notice']);
  assert.deepEqual(NO_EVIDENCE, ['request', 'not-now', 'all-stop']);
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
