// tests/scripts/host/helper-order.test.js
// The helper starts a run of a work order and keeps the order under the run's id (Archon design, section 7.4): a
// step asks for it by the run's id, and an id the helper didn't start gets nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { fakeEngine, loadRecordings } from '../../../scripts/engine/fake.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const recordings = loadRecordings(path.join(import.meta.dirname, '..', '..', 'fixtures', 'engine'));
const ORDER = workOrder({ work: { id: 'card-12', lane: 'quick', goal: 'Fix the heading', done: [{ test: 'tests/heading.test.js' }] }, routing: { tiers: { medium: 'model-b' } } });

function stubSpawn() {
  return (command, args) => {
    const child = new EventEmitter();
    child.pid = 6000;
    child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    return child;
  };
}

async function setUp() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-proj-'));
  await as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-29T00:00:00.000Z' });
    writeProject('o__p', { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
  });
  return { home, folder, cleanup: () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(folder, { recursive: true, force: true }); } };
}

test('a run started through the helper gets its order back by its id, and an unknown run id gets nothing', async () => {
  const p = await setUp();
  const engine = fakeEngine({ recordings: { 'quick-approved': recordings['quick-approved'] } });
  try {
    await as(p.home, async () => {
      const helper = await startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({}), envFor: async () => ({}),
        spawn: stubSpawn(), engineFor: () => engine,
      });
      try {
        const client = helperClient({ address: testAddress(p.home) });
        const started = await client.engine.start({ project: 'o__p', order: ORDER, branch: 'wh/card-12' });
        assert.equal(started.ok, true, started.refused);
        assert.equal(engine.calls[0].order.work, 'card-12');
        assert.equal(engine.calls[0].order.project, p.folder);
        assert.ok(!JSON.stringify(engine.calls[0].order).includes('Fix the heading'), 'the order\'s words never go to the engine');
        const got = await client.engine.order({ runId: started.runId });
        assert.deepEqual(got, { ok: true, order: ORDER });
        assert.deepEqual(await client.engine.order({ runId: 'fake-99-other' }), { ok: false, refused: 'there is no work order for that run' });
        assert.equal((await client.engine.order({ runId: '../orders' })).ok, false);
        const runs = listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'run');
        assert.deepEqual(runs.map((e) => [e.data.runId, e.data.state, e.data.work, e.data.branch]), [[started.runId, 'started', 'card-12', 'wh/card-12']]);
        // A second order for the same run can't replace the first.
        const again = await client.engine.start({ project: 'o__p', order: { ...ORDER, done: [] } });
        assert.equal(again.ok, false);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('no run starts under All stop', async () => {
  const p = await setUp();
  const engine = fakeEngine({ recordings: { 'quick-approved': recordings['quick-approved'] } });
  try {
    await as(p.home, async () => {
      const helper = await startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({}), envFor: async () => ({}),
        spawn: stubSpawn(), engineFor: () => engine,
      });
      try {
        setStop({ by: 'helper' });
        const started = await helperClient({ address: testAddress(p.home) }).engine.start({ project: 'o__p', order: ORDER });
        assert.equal(started.ok, false);
        assert.match(started.refused, /All stop/);
        assert.equal(engine.calls.filter((c) => c.call === 'start').length, 0);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});
