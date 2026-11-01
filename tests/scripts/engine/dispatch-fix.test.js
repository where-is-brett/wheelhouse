// tests/scripts/engine/dispatch-fix.test.js
// The dispatcher's runner and a red main line (Archon design, section 7.7): an open red-main incident starts one
// fix-main run and holds other work; the main line read green closes the incident, and held work starts again; a fix
// that didn't make it green brings one level-3 card, whose answer starts the next attempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dispatchRun } from '../../../scripts/engine/dispatch-run.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { tempFolder } from '../../helpers/homes.js';

const INCIDENT = { id: 'red-main-0123456789', what: 'The main line\'s checks are red.', kind: 'red-main', suspect: 12, work: 'fix-main-red-main-0123456789', at: '2026-10-30T09:00:00.000Z', fixes: [] };
const record = (runId, state, extra = {}) => ({ at: '2026-10-30T10:00:00.000Z', data: { work: INCIDENT.work, lane: 'fix-main', engine: 'fake', runId, state, ...extra } });

function setUp({ green = false, stop = false, refuse = () => null } = {}) {
  const dir = tempFolder('wh-df-');
  const starts = [];
  const written = [];
  const world = {
    green, stop, stopped: [], merged: [],
    views: {
      work: { 'card-1': { work: { id: 'w-1', at: '2026-10-29T08:00:00.000Z', data: { id: 'card-1', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] } }, approved: false, since: '2026-10-29T08:00:00.000Z' } },
      runs: {}, questions: {}, incidents: { open: [INCIDENT] },
    },
  };
  const engine = fakeEngine();
  const d = dispatchRun({
    engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => world.views,
    config: () => ({ testCommand: 'npm test', routing: {} }),
    stopped: () => world.stop,
    start: async (args) => { starts.push(args); const refused = refuse(starts.length); return refused ? { ok: false, refused } : { ok: true, runId: `run-${starts.length}` }; },
    write: async (kind, data) => { written.push({ kind, data }); },
    now: () => new Date('2026-10-30T10:00:00.000Z'),
    mainGreen: async () => world.green,
    stoppedRuns: () => world.stopped,
    fixedRuns: () => world.merged,
  });
  // What the record holds once a start was written: the helper's own start writes the run's record.
  const ran = (runId, state, extra) => { (world.views.runs[INCIDENT.work] ??= []).push(record(runId, state, extra)); };
  const answer = (label) => {
    const q = written.filter((w) => w.kind === 'question').at(-1).data;
    world.views.questions[q.id] = { question: { data: q }, answer: { label, at: '2026-10-30T10:05:00.000Z' } };
    return q;
  };
  return { d, starts, written, world, ran, answer, engine, acts: [] };
}
const fixStarts = (t) => t.starts.filter((s) => s.order?.lane === 'fix-main');
const notes = (t) => t.written.filter((w) => w.kind === 'note').map((w) => w.data.words);

test('a red-main incident starts one fix-main run and holds other work', async () => {
  const t = setUp();
  const got = await t.d.tick();
  assert.equal(fixStarts(t).length, 1);
  const { order } = fixStarts(t)[0];
  assert.equal(order.work, INCIDENT.work);
  assert.equal(order.incident, INCIDENT.id);
  assert.equal(order.level, 1);
  assert.equal(t.starts.length, 1, 'nothing else starts');
  assert.deepEqual(got.hold, [{ work: 'card-1', why: 'incident' }]);
  assert.ok(notes(t).some((w) => /main line is red, so Wheelhouse started fixing it/.test(w)));
});

test('a fix during a goal carries the goal\'s check files, and no may', async () => {
  const t = setUp();
  t.world.views.goals = { 'g-1': { sheet: { checkFiles: ['tests/check.test.js'], until: '2026-10-30T20:00:00.000Z' }, hash: 'h', startedAt: '2026-10-30T08:00:00.000Z', ended: null, endAsked: null } };
  await t.d.tick();
  assert.deepEqual(t.starts[0].order.areas, { goal: 'g-1', wontTouch: ['tests/check.test.js'] });
});

test('a second tick starts no second fix run', async () => {
  const t = setUp();
  await t.d.tick();
  t.ran('run-1', 'started', { branch: 'wh/fix' });
  await t.d.tick();
  await t.d.tick();
  assert.equal(fixStarts(t).length, 1);
});

test('a fix the helper didn\'t hear start isn\'t started twice in one moment', async () => {
  const t = setUp();
  await Promise.all([t.d.tick(), t.d.tick()]);
  assert.equal(fixStarts(t).length, 1);
});

test('green checks close the incident, and held work starts on the next tick', async () => {
  const t = setUp();
  await t.d.tick();
  t.ran('run-1', 'started');
  t.world.green = true;
  await t.d.tick();
  const closed = t.written.filter((w) => w.kind === 'incident-closed');
  assert.deepEqual(closed.map((w) => w.data), [{ incident: INCIDENT.id, why: 'the main line\'s checks are green' }]);
  assert.ok(notes(t).some((w) => /main line is green again, so held work goes on/.test(w)));
  t.world.views.incidents.open = [];
  await t.d.tick();
  assert.deepEqual(t.starts.at(-1).order.work, 'card-1');
});

test('unknown checks keep the incident open, and say nothing new', async () => {
  const t = setUp({ green: null });
  await t.d.tick();
  t.ran('run-1', 'started');
  const said = t.written.length;
  await t.d.tick();
  assert.equal(t.written.filter((w) => w.kind === 'incident-closed').length, 0);
  assert.equal(t.written.length, said);
});

test('a fix run that failed brings one level-3 card recommending Undo #12', async () => {
  const t = setUp();
  await t.d.tick();
  t.ran('run-1', 'started');
  t.ran('run-1', 'ended', { outcome: 'failed' });
  await t.d.tick();
  await t.d.tick();
  const cards = t.written.filter((w) => w.kind === 'question');
  assert.equal(cards.length, 1);
  const q = cards[0].data;
  assert.equal(q.level, 3);
  assert.equal(q.work, INCIDENT.work);
  assert.match(q.id, new RegExp(`^q-${INCIDENT.work}-\\d+$`));
  assert.deepEqual(q.options.map((o) => o.label), ['Undo #12', 'Fix it forward', 'Leave it']);
  assert.equal(q.recommendation, 'Undo #12');
  assert.match(q.what, /main line/);
});

test('with no suspect, the card recommends fixing forward and offers no undo', async () => {
  const t = setUp();
  t.world.views.incidents.open = [{ ...INCIDENT, suspect: null }];
  await t.d.tick();
  t.ran('run-1', 'ended', { outcome: 'failed' });
  await t.d.tick();
  const q = t.written.find((w) => w.kind === 'question').data;
  assert.deepEqual(q.options.map((o) => o.label), ['Fix it forward', 'Leave it']);
  assert.equal(q.recommendation, 'Fix it forward');
});

test('the card\'s Undo starts an attempt that undoes the suspect, and Fix it forward a fresh one', async () => {
  for (const [label, goal] of [['Undo #12', /Undo pull request #12/], ['Fix it forward', /pass again\.$/]]) {
    const t = setUp();
    await t.d.tick();
    t.ran('run-1', 'ended', { outcome: 'failed' });
    await t.d.tick();
    t.answer(label);
    await t.d.tick();
    assert.equal(fixStarts(t).length, 2, label);
    assert.match(fixStarts(t)[1].order.goal, goal);
    t.ran('run-2', 'started');
    await t.d.tick();
    assert.equal(fixStarts(t).length, 2, `${label}: once`);
  }
});

test('a first fix whose start is refused is tried again, and the Logbook says why, once', async () => {
  const t = setUp({ refuse: (n) => (n <= 2 ? "the broker's launcher names a program that is gone" : null) });
  await t.d.tick();
  await t.d.tick();
  assert.equal(notes(t).filter((w) => /didn't start/.test(w)).length, 1);
  assert.match(notes(t).find((w) => /didn't start/.test(w)), /launcher/);
  await t.d.tick();
  assert.equal(fixStarts(t).length, 3, 'started on the third try');
});

test("an answer whose start is refused is kept and tried again, and the Logbook says why, once", async () => {
  let refusing = true;
  const t = setUp({ refuse: (n) => (n >= 2 && refusing ? "the engine's copy of the project couldn't be brought up to date" : null) });
  await t.d.tick();
  t.ran('run-1', 'ended', { outcome: 'failed' });
  await t.d.tick();
  t.answer('Fix it forward');
  await t.d.tick();
  assert.equal(fixStarts(t).length, 2, 'tried');
  const said = notes(t).filter((w) => /didn't start/.test(w));
  assert.equal(said.length, 1);
  assert.match(said[0], /Fix it forward/);
  assert.match(said[0], /brought up to date/);
  await t.d.tick();
  assert.equal(fixStarts(t).length, 3, 'the answer is kept, and tried again');
  assert.equal(notes(t).filter((w) => /didn't start/.test(w)).length, 1, 'said once');
  refusing = false;
  await t.d.tick();
  assert.equal(fixStarts(t).length, 4);
  assert.match(fixStarts(t)[3].order.goal, /pass again\.$/);
  t.ran('run-4', 'started');
  await t.d.tick();
  assert.equal(fixStarts(t).length, 4, 'once it started, not again');
});

test('the card\'s Leave it starts nothing, and work stays held', async () => {
  const t = setUp();
  await t.d.tick();
  t.ran('run-1', 'ended', { outcome: 'failed' });
  await t.d.tick();
  t.answer('Leave it');
  const got = await t.d.tick();
  assert.equal(fixStarts(t).length, 1);
  assert.deepEqual(got.hold, [{ work: 'card-1', why: 'incident' }]);
});

test('All stop then lift carries the cancelled fix on, on its branch', async () => {
  const t = setUp();
  await t.d.tick();
  t.ran('run-1', 'started', { branch: 'wh/fix' });
  t.world.stop = true;
  t.ran('run-1', 'ended', { outcome: 'cancelled' });
  t.world.stopped = ['run-1'];
  await t.d.tick();
  assert.equal(fixStarts(t).length, 1, 'nothing under All stop');
  t.world.stop = false;
  await t.d.tick();
  assert.equal(fixStarts(t).length, 2);
  assert.equal(fixStarts(t)[1].carryOn, true);
  assert.equal(fixStarts(t)[1].branch, 'wh/fix');
  assert.equal(t.written.filter((w) => w.kind === 'question').length, 0);
});

test('a fix still running when the main line turns green by itself is stopped, and the Logbook says so', async () => {
  const t = setUp();
  await t.d.tick();
  t.ran('run-1', 'started');
  t.world.green = true;
  t.engine.act = async (runId, action) => { t.acts.push({ runId, action }); return { ok: true }; };
  await t.d.tick();
  assert.ok(t.written.some((w) => w.kind === 'incident-closed'));
  assert.deepEqual(t.acts.map((a) => [a.runId, Object.keys(a.action)[0]]), [['run-1', 'cancel']]);
  assert.ok(notes(t).some((w) => /green by itself/.test(w) && /stopped/.test(w)));
});

test('a fix that ended with its pull request still open when the main line turns green gets a Logbook line naming it', async () => {
  const t = setUp();
  await t.d.tick();
  t.ran('run-1', 'started');
  t.ran('run-1', 'ended', { outcome: 'completed', pr: 31 });
  t.world.green = true;
  t.engine.act = async (runId, action) => { t.acts.push({ runId, action }); return { ok: true }; };
  await t.d.tick();
  assert.deepEqual(t.acts, [], 'nothing running to stop');
  assert.ok(notes(t).some((w) => /#31/.test(w) && /isn't needed/.test(w)));
});

test('a merged fix waits for the main line to read green', async () => {
  const t = setUp({ green: null });
  await t.d.tick();
  t.ran('run-1', 'ended', { outcome: 'completed' });
  t.world.merged = ['run-1'];
  await t.d.tick();
  assert.equal(t.written.filter((w) => w.kind === 'question').length, 0);
  t.world.green = true;
  await t.d.tick();
  assert.equal(t.written.filter((w) => w.kind === 'incident-closed').length, 1);
});

test('the merge queue doesn\'t start while the incident is open', async () => {
  const t = setUp();
  const got = await t.d.tick();
  assert.equal(got.startMergeQueue, false);
});

test('while the director\'s own incident is open too, no fix run starts', async () => {
  const t = setUp();
  t.world.views.incidents.open = [{ id: 'bad-total', what: 'Totals are wrong', at: '2026-10-30T08:00:00.000Z', fixes: [] }, INCIDENT];
  await t.d.tick();
  assert.equal(fixStarts(t).length, 0);
  t.world.views.incidents.open = [INCIDENT];
  await t.d.tick();
  assert.equal(fixStarts(t).length, 1, 'it starts once the director\'s incident is closed');
});

test('a failed fix is retried under its incident, with no place asked for, then fixDecision\'s card after the last try', async () => {
  const t = setUp();
  await t.d.tick();
  const acts = [];
  t.engine.act = (runId, action) => { acts.push({ runId, action }); return { ok: true }; };
  t.engine.inspect = () => ({ status: 'ended', outcome: 'failed' });
  t.ran('run-1', 'started');
  t.ran('run-1', 'ended', { outcome: 'failed', failure: 'connection' });
  await t.d.tick();
  assert.equal(acts.length, 0, 'it waits its five minutes');
  assert.equal(t.written.filter((w) => w.kind === 'question').length, 0, 'no card while a try is left');
  t.world.views.runs[INCIDENT.work].at(-1).at = '2026-10-30T09:50:00.000Z';
  await t.d.tick();
  assert.deepEqual(acts, [{ runId: 'run-1', action: { resume: {} } }]);
  assert.deepEqual(t.written.filter((w) => w.kind === 'run').map((w) => [w.data.state, w.data.resume]), [['started', 1]]);
  assert.equal(fixStarts(t).length, 1, 'the same run, no second start');
  // Each leg's ending, past its wait.
  for (const resume of [1, 2, 3]) {
    t.world.views.runs[INCIDENT.work].push(record('run-1', 'started', { resume }), { ...record('run-1', 'ended', { outcome: 'failed', failure: 'connection', resume }), at: '2026-10-30T09:00:00.000Z' });
    await t.d.tick();
  }
  assert.equal(acts.length, 3, 'the third failure brings no fourth try');
  const cards = t.written.filter((w) => w.kind === 'question');
  assert.equal(cards.length, 1);
  assert.match(cards[0].data.what, /main line/);
});

test('a failed fix waits out All stop, and a refused resume goes to its card', async () => {
  const t = setUp();
  await t.d.tick();
  t.ran('run-1', 'started');
  t.world.views.runs[INCIDENT.work].push({ ...record('run-1', 'ended', { outcome: 'failed', failure: 'connection' }), at: '2026-10-30T09:00:00.000Z' });
  t.world.stop = true;
  await t.d.tick();
  assert.equal(t.engine.calls.filter((c) => c.call === 'act').length, 0);
  t.world.stop = false;
  await t.d.tick();
  assert.equal(t.engine.calls.filter((c) => c.call === 'act').length, 1, 'the engine has no such run, so it refuses');
  assert.equal(t.written.filter((w) => w.kind === 'run').at(-1).data.failure, 'resume-refused');
});

test('a fix\'s resume looks at the run first: one going is left alone, one that ended otherwise is put right', async () => {
  const t = setUp();
  await t.d.tick();
  t.ran('run-1', 'started');
  t.world.views.runs[INCIDENT.work].push({ ...record('run-1', 'ended', { outcome: 'failed', failure: 'connection' }), at: '2026-10-30T09:00:00.000Z' });
  t.engine.inspect = () => ({ status: 'running' });
  await t.d.tick();
  assert.equal(t.engine.calls.filter((c) => c.call === 'act').length, 0);
  t.engine.inspect = () => ({ status: 'ended', outcome: 'cancelled' });
  await t.d.tick();
  assert.equal(t.engine.calls.filter((c) => c.call === 'act').length, 0);
  const put = t.written.filter((w) => w.kind === 'run').at(-1).data;
  assert.equal(put.outcome, 'cancelled');
  assert.equal(put.failure, undefined);
});

test('a limit holds no fix: an incident\'s fix starts with a run parked at a limit', async () => {
  const t = setUp();
  t.world.views.runs['card-1'] = [{ at: '2026-10-30T09:30:00.000Z', data: { work: 'card-1', lane: 'quick', engine: 'fake', runId: 'run-parked', state: 'paused' } }];
  t.world.views.asks = { 'card-1': [{ at: '2026-10-30T09:30:00.000Z', data: { id: 'lim', runId: 'run-parked', work: 'card-1', kind: 'usage-limit', level: 1, options: [] } }] };
  await t.d.tick();
  assert.equal(fixStarts(t).length, 1);
});

test('a lost fix is carried on under its incident, once, and waits until the runner has done with it', async () => {
  const t = setUp();
  let lost = { clearing: ['run-1'], carried: [] };
  t.d.onLost(() => lost);
  await t.d.tick();
  t.ran('run-1', 'started', { branch: 'wh/fix' });
  t.ran('run-1', 'ended', { outcome: 'cancelled', branch: 'wh/fix' });
  await t.d.tick();
  assert.equal(fixStarts(t).length, 1, 'not while the runner has it');
  assert.equal(t.written.filter((w) => w.kind === 'question').length, 0, 'and no card for its cancel');
  lost = { clearing: [], carried: ['run-1'] };
  await t.d.tick();
  assert.equal(fixStarts(t).length, 2);
  assert.equal(fixStarts(t)[1].carryOn, true);
  assert.equal(fixStarts(t)[1].branch, 'wh/fix');
  t.ran('run-2', 'started', { branch: 'wh/fix' });
  t.ran('run-2', 'ended', { outcome: 'cancelled', branch: 'wh/fix' });
  await t.d.tick();
  assert.equal(fixStarts(t).length, 2, 'once');
  assert.equal(t.written.filter((w) => w.kind === 'question').length, 1, 'then the fix\'s own card');
});

test('a fix on the lost card has no card of its own beside it, and Carry on starts it', async () => {
  const t = setUp();
  let lost = { clearing: ['run-1'], carried: [] };
  t.d.onLost(() => lost);
  await t.d.tick();
  t.ran('run-1', 'started', { branch: 'wh/fix' });
  t.ran('run-1', 'ended', { outcome: 'cancelled', branch: 'wh/fix' });
  await t.d.tick();
  await t.d.tick();
  assert.equal(t.written.filter((w) => w.kind === 'question').length, 0);
  lost = { clearing: [], carried: ['run-1'] };
  await t.d.tick();
  assert.equal(fixStarts(t).length, 2);
});
