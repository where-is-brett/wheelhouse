// tests/scripts/engine/dispatch-merged.test.js
// The dispatcher's runner and the merged report (scripts/engine/dispatch-run.js): quick, small and bug work whose run's
// pull request merged gets one `merged` report, which the briefing, the board and dependent work read. An open pull
// request gets none; a closed one isn't asked about again; feature work has its own report; work queued again is judged
// on its new runs alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dispatchRun, MERGED_WORDS } from '../../../scripts/engine/dispatch-run.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { tempFolder } from '../../helpers/homes.js';

const AT = '2026-10-29T08:00:00.000Z';

function setUp({ lane = 'quick', prState } = {}) {
  const dir = tempFolder('wh-dm-');
  const world = { runs: [], states: {}, asked: [], written: [], reports: {}, queued: AT, extra: {} };
  const views = () => ({
    work: {
      'card-1': { work: { id: 'w-1', at: world.queued, data: { id: 'card-1', title: 'The sale banner', lane, visible: false, dependsOn: [] } }, approved: true, since: AT },
      ...world.extra,
    },
    runs: { 'card-1': world.runs.map(({ at = '2026-10-29T09:00:00.000Z', ...data }) => ({ at, data: { work: 'card-1', engine: 'archon', lane, ...data } })) },
    questions: {}, reports: world.reports,
  });
  const d = dispatchRun({
    engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: views,
    settings: () => ({ engineLanes: ['quick', 'small', 'bug', 'feature'] }),
    config: () => ({ routing: {}, testCommand: 'npm test --' }),
    start: async () => ({ ok: true, runId: 'run-x' }),
    write: async (kind, data) => { world.written.push({ kind, data }); },
    prState: prState ?? (async (pr) => { world.asked.push(pr); return world.states[pr] ?? 'open'; }),
    designOf: () => null,
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  return { d, world };
}
const reports = (world) => world.written.filter((w) => w.kind === 'report').map((w) => w.data);

for (const lane of ['quick', 'small', 'bug']) {
  test(`${lane} work whose pull request merged gets one merged report`, async () => {
    const { d, world } = setUp({ lane });
    world.runs.push({ runId: 'run-1', state: 'ended', outcome: 'completed', branch: 'wh/card-1', pr: 41 });
    await d.tick();
    assert.deepEqual(reports(world), [], 'an open pull request has no report yet');
    world.states[41] = 'merged';
    await d.tick();
    assert.deepEqual(reports(world), [{ work: 'card-1', outcome: 'merged', pr: 41, summary: MERGED_WORDS, rulings: [] }]);
    await d.tick();
    assert.equal(reports(world).length, 1, 'written once, before the record is read back');
  });
}

test('a run still going, or one that ended with no pull request, is not asked about', async () => {
  const { d, world } = setUp();
  world.runs.push({ runId: 'run-1', state: 'started', branch: 'wh/card-1' });
  await d.tick();
  world.runs.push({ runId: 'run-2', state: 'ended', outcome: 'cancelled', branch: 'wh/card-1' });
  await d.tick();
  assert.deepEqual(world.asked, []);
  assert.deepEqual(reports(world), []);
});

test('a pull request closed unmerged writes no report and isn\'t asked about again', async () => {
  const { d, world } = setUp();
  world.runs.push({ runId: 'run-1', state: 'ended', outcome: 'completed', branch: 'wh/card-1', pr: 41 });
  world.states[41] = 'closed';
  await d.tick();
  await d.tick();
  assert.deepEqual(world.asked, [41]);
  assert.deepEqual(reports(world), []);
});

test('work with an ending report since it was queued is left alone, and work queued again is judged on its new runs', async () => {
  const { d, world } = setUp();
  world.runs.push({ runId: 'run-1', state: 'ended', outcome: 'completed', branch: 'wh/card-1', pr: 41 });
  world.states[41] = 'merged';
  world.reports['card-1'] = { at: '2026-10-29T09:10:00.000Z', data: { work: 'card-1', outcome: 'merged', pr: 41 } };
  await d.tick();
  assert.deepEqual(world.asked, []);
  // Queued again after the report: run-1's merge is the old queueing's, so no new report until a new run merges.
  world.queued = '2026-10-29T09:30:00.000Z';
  await d.tick();
  assert.deepEqual(reports(world), []);
  world.runs.push({ runId: 'run-2', at: '2026-10-29T09:40:00.000Z', state: 'ended', outcome: 'completed', branch: 'wh/card-1', pr: 42 });
  world.states[42] = 'merged';
  await d.tick();
  assert.deepEqual(reports(world).map((r) => r.pr), [42]);
});

test('feature work gets no report from a slice\'s merge', async () => {
  const { d, world } = setUp({ lane: 'feature' });
  world.runs.push({ runId: 'run-1', state: 'ended', outcome: 'completed', branch: 'wh/card-1', pr: 41, lane: 'slice' });
  world.states[41] = 'merged';
  await d.tick();
  assert.deepEqual(reports(world), []);
});

test('with only prMerged given, a merged pull request still gets its report', async () => {
  const dir = tempFolder('wh-dm-');
  const written = [];
  const d = dispatchRun({
    engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'),
    readViews: () => ({
      work: { 'card-1': { work: { id: 'w-1', at: AT, data: { id: 'card-1', title: 'T', lane: 'quick', dependsOn: [] } }, approved: true } },
      runs: { 'card-1': [{ at: '2026-10-29T09:00:00.000Z', data: { work: 'card-1', runId: 'run-1', lane: 'quick', state: 'ended', outcome: 'completed', pr: 41 } }] },
      reports: {},
    }),
    config: () => ({ routing: {}, testCommand: 'npm test --' }),
    start: async () => ({ ok: true, runId: 'run-x' }),
    write: async (kind, data) => { written.push({ kind, data }); },
    prMerged: async (pr) => pr === 41,
  });
  await d.tick();
  assert.equal(written.filter((w) => w.kind === 'report').length, 1);
});
