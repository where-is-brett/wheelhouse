// tests/scripts/checks/data-run.test.js
// A data run holds the check turn, keeps its folder while it runs and is ended by All stop (scripts/checks/data-run.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataWorksInUse, stopDataRuns, withDataRun } from '../../../scripts/checks/data-run.js';

const turnLog = () => {
  const log = [];
  return { log, turn: async (fn) => { log.push('turn taken'); try { return await fn(); } finally { log.push('turn given back'); } } };
};

test('a data run takes the check turn, and its work is in use only while it runs', async () => {
  const { log, turn } = turnLog();
  assert.deepEqual(dataWorksInUse('p'), []);
  const got = await withDataRun({ project: 'p', work: 'data-feature/x', turn }, async () => {
    log.push('run');
    assert.deepEqual(dataWorksInUse('p'), ['data-feature/x']);
    assert.deepEqual(dataWorksInUse('other'), []);
    return 'done';
  });
  assert.equal(got, 'done');
  assert.deepEqual(log, ['turn taken', 'run', 'turn given back']);
  assert.deepEqual(dataWorksInUse('p'), []);
});

test('a data run waiting for its turn already has its folder named, and gives it up when it fails', async () => {
  let open;
  const waiting = new Promise((resolve) => { open = resolve; });
  const turn = async (fn) => { await waiting; return fn(); };
  const run = withDataRun({ project: 'p', work: 'data-feature/y', turn }, async () => { throw new Error('it failed'); });
  assert.deepEqual(dataWorksInUse('p'), ['data-feature/y']);
  open();
  await assert.rejects(run, /it failed/);
  assert.deepEqual(dataWorksInUse('p'), []);
});

test('All stop ends a data run\'s signal, and a run stopped before its turn never starts', async () => {
  let release;
  const { turn } = turnLog();
  let seen;
  const run = withDataRun({ project: 'p', work: 'data-feature/z', turn }, ({ signal }) => new Promise((resolve) => {
    seen = signal;
    release = resolve;
  }));
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(seen.aborted, false);
  stopDataRuns('other');
  assert.equal(seen.aborted, false, 'another project\'s stop does not reach it');
  stopDataRuns('p');
  assert.equal(seen.aborted, true);
  release('ended');
  assert.equal(await run, 'ended');

  let started = false;
  assert.equal(await withDataRun({ project: 'p', work: 'data-feature/z', stopped: () => true, turn }, () => { started = true; }), null);
  assert.equal(started, false);
  // Stopped while waiting for the turn: the signal is already aborted when the turn comes.
  let open;
  const waiting = new Promise((resolve) => { open = resolve; });
  const late = withDataRun({ project: 'p', work: 'data-feature/z', turn: async (fn) => { await waiting; return fn(); } }, () => { started = true; });
  stopDataRuns();
  open();
  assert.equal(await late, null);
  assert.equal(started, false);
});
