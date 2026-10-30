// tests/scripts/engine/fake.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fakeEngine, loadRecordings, readRecording } from '../../../scripts/engine/fake.js';
import { checkEvent } from '../../../scripts/engine/contract.js';

const recordings = loadRecordings(path.join(import.meta.dirname, '..', '..', 'fixtures', 'engine'));
const now = () => '2026-10-29T09:00:00.000Z';
const types = (events) => events.map((e) => e.type);

test('the fixtures are well-formed, and each is listed', () => {
  assert.deepEqual(Object.keys(recordings), ['bug-lane', 'merge-hold', 'quick-approved', 'quick-blocked', 'quick-lane', 'small-lane']);
  for (const events of Object.values(recordings)) for (const e of events) assert.equal(checkEvent(e), null);
});

test("the fake plays a recording's events in order, holding at an ask", () => {
  const engine = fakeEngine({ recordings, now });
  const { runId } = engine.start({ recording: 'quick-approved' });
  const first = engine.watch(null);
  assert.deepEqual(types(first.events), ['run-started', 'step-finished', 'step-finished', 'ask']);
  assert.ok(first.events.every((e) => e.runId === runId));
  assert.equal(engine.inspect(runId).status, 'paused');
  const ask = first.events.at(-1);
  assert.deepEqual(engine.act(runId, { answer: { ask: ask.id, choice: 'approve' } }), { ok: true });
  const rest = engine.watch(first.cursor);
  assert.deepEqual(types(rest.events), ['ask-resolved', 'step-finished', 'run-ended']);
  assert.equal(rest.events[0].choice, 'approve');
  const seen = engine.inspect(runId);
  assert.equal(seen.status, 'ended');
  assert.equal(seen.pr, 'https://example.test/pull/12');
  assert.equal(engine.calls.length, 2);
});

test('the fake refuses a second answer to the same ask', () => {
  const engine = fakeEngine({ recordings, now });
  const { runId } = engine.start({ recording: 'quick-blocked' });
  const ask = engine.watch().events.find((e) => e.type === 'ask');
  assert.equal(engine.act(runId, { answer: { ask: ask.id, choice: 'stop' } }).ok, true);
  const again = engine.act(runId, { answer: { ask: ask.id, choice: 'retry' } });
  assert.equal(again.ok, false);
  assert.match(again.refused, /already been answered/);
  assert.equal(engine.watch().events.filter((e) => e.type === 'ask-resolved').length, 1);
});

test('the fake refuses an answer to an ask that is not waiting, or an option that is not offered', () => {
  const engine = fakeEngine({ recordings, now });
  const { runId } = engine.start({ recording: 'merge-hold' });
  assert.equal(engine.act(runId, { answer: { ask: 'other', choice: 'approve' } }).ok, false);
  const ask = engine.watch().events.find((e) => e.type === 'ask');
  assert.match(engine.act(runId, { answer: { ask: ask.id, choice: 'burn' } }).refused, /not one of the options/);
  assert.equal(engine.act(runId, { answer: { ask: ask.id, choice: 'hold' } }).ok, true);
  assert.equal(engine.inspect(runId).digest, '1 step finished; ended: held');
});

test("the fake's watch resumes from a cursor", () => {
  const engine = fakeEngine({ recordings, now });
  engine.start({ recording: 'quick-approved' });
  const one = engine.watch(null);
  assert.equal(engine.watch(one.cursor).events.length, 0);
  engine.start({ recording: 'merge-hold' });
  const two = engine.watch(one.cursor);
  assert.equal(two.events.length, 3);
  assert.ok(two.events.every((e) => e.runId.endsWith('merge-hold')));
});

test('follow yields what is waiting after a cursor', async () => {
  const engine = fakeEngine({ recordings, now });
  engine.start({ recording: 'merge-hold' });
  const got = [];
  const cursors = [];
  for await (const event of engine.follow('2', { onCursor: (c) => cursors.push(c) })) got.push(event.type);
  assert.deepEqual(got, ['ask']);
  assert.deepEqual(cursors, ['3']);
});

test('a step with unknown spend has source unknown and null dollars', () => {
  const engine = fakeEngine({ recordings, now });
  const { runId } = engine.start({ recording: 'quick-approved' });
  const ask = engine.watch().events.find((e) => e.type === 'ask');
  engine.act(runId, { answer: { ask: ask.id, choice: 'approve' } });
  const merge = engine.inspect(runId).steps.find((s) => s.id === 'merge');
  assert.equal(merge.source, 'unknown');
  assert.equal(merge.dollars, null);
  assert.equal(merge.tokens, null);
});

test('cancel and stopAll end runs and list them; stopAll leaves a paused run paused, as Archon does', async () => {
  const engine = fakeEngine({ recordings, now });
  const a = engine.start({ recording: 'quick-approved' }).runId;
  const b = engine.start({ recording: 'quick-blocked', running: true, ownerPid: 321 }).runId;
  const c = engine.start({ recording: 'merge-hold' }).runId;
  assert.equal(engine.inspect(b).status, 'running');
  assert.equal(engine.inspect(b).ownerPid, 321);
  assert.deepEqual(engine.act(a, { cancel: { reason: 'director said stop' } }), { ok: true });
  assert.equal(engine.act(a, { cancel: { reason: 'again' } }).ok, false);
  const before = [];
  assert.deepEqual(await engine.stopAll('All stop', { beforeCancel: (runs) => before.push(...runs.map((r) => r.id)) }), { cancelled: [b, c], survivors: [], paused: [] });
  assert.deepEqual(before, [b, c]);
  assert.equal(engine.inspect(b).status, 'ended');
  assert.equal(engine.inspect(c).status, 'ended');
  assert.equal(engine.watch().events.filter((e) => e.outcome === 'cancelled').length, 3);
});

test('start refuses a recording it does not have; readRecording names a bad line', () => {
  const engine = fakeEngine({ recordings, now });
  assert.equal(engine.start({ recording: 'nope' }).ok, false);
  assert.equal(engine.start({}).ok, false);
  assert.throws(() => readRecording('{"type":"run-started"}'), /line 1/);
  assert.throws(() => readRecording('not json'), /line 1 isn't JSON/);
});

test('the fake keeps step outputs, hands work to a merge queue and has an artefacts folder for each run', () => {
  const engine = fakeEngine({ recordings, artefacts: '/artefacts', source: '/frozen' });
  const { runId } = engine.start({ recording: 'quick-lane' });
  const before = engine.outputs(runId);
  assert.equal(JSON.parse(before['review-spec']).verdict, 'CLEAN');
  assert.equal(before.lesson, undefined, 'a step after the open ask has not run yet');
  engine.setOutput(runId, 'open-pr', '{"pr":1}');
  assert.equal(engine.outputs(runId)['open-pr'], '{"pr":1}');
  assert.equal(engine.inspect(runId).source, '/frozen');
  assert.equal(engine.artefactsOf(runId), path.join('/artefacts', runId));
  assert.equal(engine.artefactsOf('no-such-run'), null);
  assert.deepEqual(engine.handOver({ pr: 1 }), { ok: true });
  assert.deepEqual(engine.calls.at(-1), { call: 'handOver', item: { pr: 1 } });
  assert.deepEqual(engine.outputs('no-such-run'), {});
});

test('a recording of several runs plays them in turn, one a start, the last again after that', () => {
  const run = (work, step) => [
    { type: 'run-started', at: now(), work, lane: 'small', branch: `wh/${work}` },
    { type: 'step-finished', at: now(), step, role: 'implementer', provider: 'claude', model: 'mid', minutes: 1, spend: { tokens: 1, dollars: 0, source: 'reported' } },
    { type: 'run-ended', at: now(), outcome: 'completed', pr: null },
  ];
  const engine = fakeEngine({ recordings: { 'card-1': [run('card-1', 'first'), run('card-1', 'second')] }, now });
  const steps = () => engine.watch('0').events.filter((e) => e.type === 'step-finished').map((e) => e.step);
  for (let i = 0; i < 3; i += 1) assert.equal(engine.start({ work: 'card-1', lane: 'small' }).ok, true);
  assert.deepEqual(steps(), ['first', 'second', 'second']);
});
