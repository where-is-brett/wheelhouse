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
  return { d, starts, written, world, ran, answer };
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
