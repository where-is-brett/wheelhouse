// tests/scripts/engine/recovery.test.js
// The rules of recovery (unattended goals design, section 9): pure, and the same with or without a goal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAILURE_KINDS, RESUME_REFUSED, RETRY_MINUTES, SLEEP_GAP_MINUTES, failureKind, resumeRun, resumesOf, retryDue, retryPlan, runLive, sleepGap, sleepWatch, triedList, unsettled } from '../../../scripts/engine/recovery.js';

const T0 = Date.parse('2026-11-01T01:00:00.000Z');
const LIMIT = SLEEP_GAP_MINUTES * 60 * 1000;

test('a beat at three minutes is no sleep, and a millisecond more is', () => {
  assert.equal(sleepGap(T0, T0 + LIMIT), null);
  assert.deepEqual(sleepGap(T0, T0 + LIMIT + 1), { from: '2026-11-01T01:00:00.000Z', to: '2026-11-01T01:03:00.001Z' });
});

test('no earlier beat, or a clock put back, is no sleep', () => {
  assert.equal(sleepGap(null, T0), null);
  assert.equal(sleepGap(T0, T0 - LIMIT * 10), null);
});

function watch({ fails = 0 } = {}) {
  const w = { at: T0, written: [], left: fails };
  w.sleeping = sleepWatch({
    now: () => new Date(w.at),
    write: async (gap) => {
      if (w.left > 0) { w.left -= 1; throw new Error('the record was refused'); }
      w.written.push(gap);
    },
  });
  return w;
}

test('one gap writes one span, and the beat answers once it is written', async () => {
  const w = watch();
  assert.equal(await w.sleeping.beat(), true);
  w.at += 60 * 1000;
  assert.equal(await w.sleeping.beat(), true);
  assert.deepEqual(w.written, []);
  w.at += 6 * 60 * 60 * 1000;
  const first = w.sleeping.beat();
  const second = w.sleeping.beat();
  assert.deepEqual([await first, await second], [true, true]);
  assert.equal(w.written.length, 1);
  assert.equal(w.written[0].from, '2026-11-01T01:01:00.000Z');
});

test('a failed write answers false, and the next beat writes the span from its start', async () => {
  const w = watch({ fails: 1 });
  await w.sleeping.beat();
  w.at += 6 * 60 * 60 * 1000;
  assert.equal(await w.sleeping.beat(), false);
  w.at += 60 * 1000;
  assert.equal(await w.sleeping.beat(), true);
  assert.deepEqual(w.written, [{ from: '2026-11-01T01:00:00.000Z', to: '2026-11-01T07:01:00.000Z' }]);
});

// A run's `run` records, each [state, extra].
const records = (...list) => list.map(([state, extra = {}]) => ({ at: '2026-11-01T01:00:00.000Z', data: { work: 'sale-banner', lane: 'quick', engine: 'fake', runId: 'r1', state, branch: 'wh/x', ...extra } }));
const failed = records(['started'], ['ended', { outcome: 'failed', failure: 'connection' }]);
// An engine whose answer to a resume is `answer`, keeping each call and each record written beside it.
function resuming(answer, status = 'ended') {
  const log = [];
  return {
    log,
    engine: { act: async (runId, action) => { log.push({ act: runId, action }); return answer(); }, inspect: async () => ({ status }) },
    write: async (kind, data) => { log.push({ kind, data }); },
  };
}

test('a failure keeps the kind U4 found for it', () => {
  const kinds = [
    [{ errorClass: 'transient' }, 'connection'],
    [{ errorClass: 'timeout' }, 'connection'],
    [{ errorClass: 'overloaded' }, 'provider'],
    [{ errorClass: 'rate_limited' }, 'provider'],
    [{ errorClass: 'fatal', providerClass: 'quota_exhausted' }, 'limit'],
    [{ errorClass: 'fatal', providerClass: 'auth' }, 'other'],
    [{ errorClass: 'fatal', providerClass: 'budget_exceeded' }, 'other'],
    [{ errorClass: 'fatal' }, 'other'],
    [{ errorClass: null, stopReason: 'process_terminated' }, 'host'],
    [{ errorClass: null, stopReason: 'not_finalized' }, 'host'],
    [{ errorClass: null, stopReason: 'unhandled_error' }, 'host'],
    [{ errorClass: null, stopReason: 'node_error' }, 'other'],
    [{ errorClass: null }, 'other'],
    [{ errorClass: 'unknown' }, 'other'],
    [{ errorClass: 'exec_failed' }, 'other'],
    [{ errorClass: 'output_contract' }, 'other'],
    [{ errorClass: 'max_iterations' }, 'other'],
    [{ errorClass: 'child_failed' }, 'other'],
    [{ errorClass: 'config' }, 'other'],
    [null, 'other'],
  ];
  for (const [event, kind] of kinds) {
    assert.equal(failureKind(event), kind, JSON.stringify(event));
    assert.ok(FAILURE_KINDS.includes(kind));
  }
});

test('an ended run stands until a started with resume follows it', () => {
  assert.equal(runLive(records(['started'])), true);
  assert.equal(runLive(records(['started'], ['paused'])), true);
  assert.equal(runLive(failed), false);
  assert.equal(runLive([...failed, ...records(['started'])]), false, 'a late ask-resolved brings nothing back');
  assert.equal(runLive([...failed, ...records(['paused'])]), false);
  assert.equal(runLive([...failed, ...records(['started', { resume: 1 }])]), true);
  assert.equal(runLive([...failed, ...records(['started', { resume: 1 }], ['paused'], ['started'])]), true);
  assert.equal(runLive([...failed, ...records(['started', { resume: 1 }], ['ended', { resume: 1, outcome: 'completed' }])]), false);
  assert.equal(runLive([]), false);
});

test('the resumes of a run are the highest number on its records', () => {
  assert.equal(resumesOf(failed), 0);
  assert.equal(resumesOf(records(['started', { resume: 1 }], ['ended', { resume: 1 }], ['started', { resume: 2 }], ['paused'])), 2);
  assert.equal(resumesOf(undefined), 0);
});

test('a resume writes its started, then acts', async () => {
  const t = resuming(() => ({ ok: true }));
  assert.deepEqual(await resumeRun({ engine: t.engine, runId: 'r1', write: t.write, records: failed }), { ok: true });
  assert.deepEqual(t.log, [
    { kind: 'run', data: { work: 'sale-banner', lane: 'quick', engine: 'fake', runId: 'r1', state: 'started', resume: 1, branch: 'wh/x' } },
    { act: 'r1', action: { resume: {} } },
  ]);
});

test('a refused resume leaves the run ended, numbered, since no terminal line will come', async () => {
  const t = resuming(() => ({ ok: false, refused: 'no' }));
  const got = await resumeRun({ engine: t.engine, runId: 'r1', write: t.write, records: failed });
  assert.deepEqual(got, { ok: false, refused: 'no' });
  assert.deepEqual(t.log.at(-1), { kind: 'run', data: { work: 'sale-banner', lane: 'quick', engine: 'fake', runId: 'r1', state: 'ended', resume: 1, outcome: 'failed', failure: 'resume-refused', branch: 'wh/x' } });
});

test('a resume the engine gave no reply to writes no ending: it may have landed, and the tick looks', async () => {
  for (const answer of [() => ({ ok: false, unreachable: true, refused: 'silence' }), () => { throw new Error('gone'); }]) {
    const t = resuming(answer);
    const got = await resumeRun({ engine: t.engine, runId: 'r1', write: t.write, records: failed });
    assert.equal(got.ok, false);
    assert.equal(got.unreachable, true);
    assert.equal(t.log.filter((e) => e.data?.state === 'ended').length, 0);
  }
});

test('a resume cut short by a crash takes up its own number, and acts on nothing that is already going', async () => {
  const cut = [...failed, ...records(['started', { resume: 1 }])];
  const waiting = resuming(() => ({ ok: true }));
  const later = () => new Date('2026-11-01T02:00:00.000Z');
  await resumeRun({ engine: waiting.engine, runId: 'r1', write: waiting.write, records: cut, now: later });
  assert.deepEqual(waiting.log, [{ act: 'r1', action: { resume: {} } }], 'one started for one resume');
  const going = resuming(() => assert.fail('a run that is going is not resumed'), 'running');
  assert.deepEqual(await resumeRun({ engine: going.engine, runId: 'r1', write: going.write, records: cut, now: later }), { ok: true });
  assert.deepEqual(going.log, []);
});

test('a resume cut short a moment ago is left alone, since the engine may not have moved yet', async () => {
  const t = resuming(() => assert.fail('a second resume could be refused over a live run'));
  const cut = [...failed, ...records(['started', { resume: 1 }])];
  const got = await resumeRun({ engine: t.engine, runId: 'r1', write: t.write, records: cut, now: () => new Date('2026-11-01T01:01:00.000Z') });
  assert.equal(got.ok, false);
  assert.equal(got.unreachable, true);
  assert.deepEqual(t.log, []);
});

test("a refused resume's ending keeps the run's pull request", async () => {
  const t = resuming(() => ({ ok: false, refused: 'no' }));
  await resumeRun({ engine: t.engine, runId: 'r1', write: t.write, records: records(['started'], ['ended', { outcome: 'failed', pr: 7 }]) });
  assert.equal(t.log.at(-1).data.pr, 7);
});

test('the next resume after one refused takes the next number', async () => {
  const t = resuming(() => ({ ok: true }));
  const refused = [...failed, ...records(['started', { resume: 1 }], ['ended', { resume: 1, outcome: 'failed', failure: 'resume-refused' }])];
  await resumeRun({ engine: t.engine, runId: 'r1', write: t.write, records: refused });
  assert.equal(t.log[0].data.resume, 2);
});

test('a run with no records is not resumed', async () => {
  const t = resuming(() => assert.fail('nothing to resume'));
  assert.equal((await resumeRun({ engine: t.engine, runId: 'r1', write: t.write, records: [] })).ok, false);
  assert.deepEqual(t.log, []);
});

test('a failed run is unsettled while a cap card on it waits, and a run ended any other way never is', () => {
  const noTry = records(['started'], ['ended', { outcome: 'failed', failure: 'other' }]);
  assert.equal(unsettled({ records: noTry, capped: false }), false);
  assert.equal(unsettled({ records: noTry, capped: true }), true);
  assert.equal(unsettled({ records: records(['started']), capped: true }), false);
  assert.equal(unsettled({ records: records(['started'], ['ended', { outcome: 'cancelled' }]), capped: true }), false);
  assert.equal(unsettled({ records: records(['started'], ['ended', { outcome: 'completed' }]), capped: true }), false);
  assert.equal(unsettled({ records: [], capped: true }), false);
});

test('retryPlan: each kind it allows is tried at 5, 15 and 30 minutes, then no more', () => {
  assert.deepEqual(RETRY_MINUTES, [5, 15, 30]);
  for (const failure of ['connection', 'provider', 'host', 'limit']) {
    assert.deepEqual(retryPlan({ failure, tries: 0 }), { retry: true, afterMinutes: 5 });
    assert.deepEqual(retryPlan({ failure, tries: 1 }), { retry: true, afterMinutes: 15 });
    assert.deepEqual(retryPlan({ failure, tries: 2 }), { retry: true, afterMinutes: 30 });
    assert.deepEqual(retryPlan({ failure, tries: 3 }), { retry: false });
  }
});

test('retryPlan: anything else, a refused resume among them, says no', () => {
  for (const failure of ['other', RESUME_REFUSED, undefined, null, 'something new']) assert.deepEqual(retryPlan({ failure, tries: 0 }), { retry: false });
});

test('retryDue goes by the latest ending\'s time, so a long sleep brings one try, not three', () => {
  const at = (iso, data) => ({ at: iso, data });
  const once = [at('2026-11-01T01:00:00.000Z', { state: 'started' }), at('2026-11-01T02:00:00.000Z', { state: 'ended', outcome: 'failed', failure: 'connection' })];
  assert.deepEqual(retryDue({ records: once, now: new Date('2026-11-01T02:04:59.000Z') }), { tries: 0, due: false });
  assert.deepEqual(retryDue({ records: once, now: new Date('2026-11-01T02:05:00.000Z') }), { tries: 0, due: true });
  const again = [...once, at('2026-11-01T02:05:00.000Z', { state: 'started', resume: 1 }), at('2026-11-01T02:06:00.000Z', { state: 'ended', resume: 1, outcome: 'failed', failure: 'connection' })];
  assert.deepEqual(retryDue({ records: again, now: new Date('2026-11-01T02:20:59.000Z') }), { tries: 1, due: false });
  assert.deepEqual(retryDue({ records: again, now: new Date('2026-11-01T09:00:00.000Z') }), { tries: 1, due: true });
  assert.equal(retryDue({ records: [at('2026-11-01T02:00:00.000Z', { state: 'ended', outcome: 'failed', failure: 'other' })], now: new Date('2026-11-02T00:00:00.000Z') }), null);
  assert.equal(retryDue({ records: [at('2026-11-01T02:00:00.000Z', { state: 'ended', outcome: 'cancelled' })], now: new Date('2026-11-02T00:00:00.000Z') }), null);
});

test('unsettled: a try allowed holds the run, until nothing will try it', () => {
  const failed = [{ at: '2026-11-01T02:00:00.000Z', data: { state: 'ended', outcome: 'failed', failure: 'connection' } }];
  assert.equal(unsettled({ records: failed, capped: false }), true);
  assert.equal(unsettled({ records: failed, capped: false, retrying: false }), false, 'its work ended, or a newer run took over');
  assert.equal(unsettled({ records: failed, capped: true, retrying: false }), true, 'a cap card still waits');
  const tried = [...failed, { at: '2026-11-01T02:06:00.000Z', data: { state: 'started', resume: 3 } }, { at: '2026-11-01T02:07:00.000Z', data: { state: 'ended', resume: 3, outcome: 'failed', failure: 'connection' } }];
  assert.equal(unsettled({ records: tried, capped: false }), false, 'the third retry failed');
});

test('triedList names each earlier failed run\'s step and kind, and the done checks of a step that runs them', () => {
  const rec = (runId, data) => ({ at: '2026-11-01T02:00:00.000Z', data: { runId, ...data } });
  const runs = [
    rec('r1', { state: 'started' }), rec('r1', { state: 'ended', outcome: 'failed', failure: 'other', step: 'implement' }),
    rec('r2', { state: 'started' }), rec('r2', { state: 'ended', outcome: 'failed', failure: 'connection', step: 'review-spec' }),
    rec('r3', { state: 'started' }), rec('r3', { state: 'ended', outcome: 'completed' }),
    rec('r4', { state: 'started' }), rec('r4', { state: 'ended', outcome: 'failed', failure: 'host' }),
  ];
  const orderOf = () => ({ done: [{ test: 'the banner shows' }, { command: 'npm run lint', expect: 0 }, { page: '/sale', shows: 'Sale' }] });
  assert.deepEqual(triedList({ runs, orderOf }), [
    { run: 'r1', step: 'implement', failure: 'other', checks: ['the banner shows', 'npm run lint', '/sale'] },
    { run: 'r2', step: 'review-spec', failure: 'connection', checks: [] },
    { run: 'r4', step: null, failure: 'host', checks: [] },
  ]);
  assert.deepEqual(triedList({ runs: [], orderOf }), []);
});

test('triedList keeps the latest few, and a resumed run counts once', () => {
  const rec = (runId, data) => ({ at: '2026-11-01T02:00:00.000Z', data: { runId, ...data } });
  const many = Array.from({ length: 8 }, (_, n) => rec(`r${n}`, { state: 'ended', outcome: 'failed', failure: 'other', step: 'tests' }));
  const list = triedList({ runs: many, orderOf: () => null });
  assert.equal(list.length, 5);
  assert.equal(list.at(-1).run, 'r7');
  const resumed = [rec('r1', { state: 'ended', outcome: 'failed', failure: 'connection', step: 'tests' }), rec('r1', { state: 'started', resume: 1 }), rec('r1', { state: 'ended', resume: 1, outcome: 'failed', failure: 'host', step: 'lenses' })];
  assert.deepEqual(triedList({ runs: resumed, orderOf: () => null }), [{ run: 'r1', step: 'lenses', failure: 'host', checks: [] }]);
});
