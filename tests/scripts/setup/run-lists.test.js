// tests/scripts/setup/run-lists.test.js
// Each setup run's own list of steps (ruling R74): every step, or for a computer joining a project
// set up on another (step 3's `answer` change { joined }), steps 1, 2, 3, 6, 7, 8 and 9. A joining
// run is finished once those are done, with no green mark and no ending; the engine neither plans
// nor applies a step not on the run's list, status names only its steps, and a step waiting for one
// the run doesn't have goes ahead. A run of a project of its own still needs the green mark (R67).
// The journals are made by hand here: step 3's joining record is Task 14b's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stepsFor, stepDone, firstUnfinished, joinedRepo, onRunList, SETUP_STEPS, JOINING_STEPS,
} from '../../../scripts/lib/setup-run.js';
import { setupRoutes, notOnList } from '../../../scripts/setup/engine.js';
import { startRun, markStep, addChanges, newId, readJournal, closeRun } from '../../../scripts/setup/journal.js';
import { beingSetUp } from '../../../scripts/hooks/kit.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const TEST_STEPS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'helpers', 'setup-steps.js');
const NOW = new Date('2026-10-20T03:00:00.000Z');
const JOINED = { step: 3, kind: 'answer', target: 'step 3', before: null, after: { joined: 'o/Cafe-Menu' } };
const GREEN = { step: 10, kind: 'answer', target: 'step 10', before: null, after: { green: '2026-10-20T04:00:00.000Z' } };
const doneAll = (ns) => Object.fromEntries(ns.map((n) => [n, { doneAt: 'x' }]));

// ---- Where a run stands, read by the hooks too ----

test('a run has every step, and a joining computer\'s run steps 1, 2, 3, 6, 7, 8 and 9', () => {
  assert.equal(stepsFor(null), SETUP_STEPS);
  assert.equal(stepsFor({ steps: {}, changes: [] }), SETUP_STEPS);
  assert.deepEqual(JOINING_STEPS.map((s) => s.n), [1, 2, 3, 6, 7, 8, 9]);
  assert.deepEqual(JOINING_STEPS.map((s) => s.title), SETUP_STEPS.filter((s) => JOINING_STEPS.some((j) => j.n === s.n)).map((s) => s.title));
  const joining = { steps: {}, changes: [JOINED] };
  assert.equal(joinedRepo(joining), 'o/Cafe-Menu');
  assert.equal(stepsFor(joining), JOINING_STEPS);
  for (const n of [4, 5, 10]) assert.equal(onRunList(joining, n), false);
  // Only step 3's `answer` change naming the repository makes a run a joining one.
  for (const other of [{ ...JOINED, step: 4 }, { ...JOINED, kind: 'host' }, { ...JOINED, after: { joined: '' } }, { ...JOINED, after: { pushArrived: true } }]) {
    assert.equal(stepsFor({ steps: {}, changes: [other] }), SETUP_STEPS, JSON.stringify(other));
  }
});

test('a joining run is finished once its own steps are done, with no green mark; its first unfinished step skips 4, 5 and 10', () => {
  const run = { steps: {}, changes: [JOINED] };
  assert.equal(firstUnfinished(run), 1);
  run.steps = doneAll([1, 2, 3]);
  assert.equal(firstUnfinished(run), 6, 'steps 4 and 5 are not this run\'s');
  run.steps = doneAll([1, 2, 3, 6, 7, 8]);
  assert.equal(firstUnfinished(run), 9);
  run.steps = doneAll([1, 2, 3, 6, 7, 8, 9]);
  assert.equal(firstUnfinished(run), null, 'finished, with no green mark');
  // Given every step to look at, the steps the run doesn't have still never hold it up.
  assert.equal(firstUnfinished(run, SETUP_STEPS), null);
  for (const n of [4, 5, 10]) assert.equal(stepDone(run, n), true, `step ${n} is never one it waits for`);
});

test('a run of a project of its own still needs the green mark to finish (ruling R67)', () => {
  const all = doneAll(SETUP_STEPS.map((s) => s.n));
  assert.equal(firstUnfinished({ steps: all, changes: [] }), 10);
  assert.equal(stepDone({ steps: all, changes: [] }, 10), false);
  assert.equal(firstUnfinished({ steps: all, changes: [GREEN] }), null);
  // Steps 4, 5 and 10 count for it as for any run.
  assert.equal(firstUnfinished({ steps: doneAll([1, 2, 3, 6, 7, 8, 9]), changes: [] }), 4);
});

test('a registered project whose joining run is finished is out of setup mode, so the session start starts its watcher', () => {
  withHome(() => {
    const folder = fs.realpathSync.native(tempFolder('wh-join Zoë '));
    writeProject('o__Cafe-Menu', { folder, remoteUrl: 'https://github.com/o/Cafe-Menu.git', host: 'github', repo: 'o/Cafe-Menu', connection: {} });
    const run = startRun({ folder, now: () => NOW });
    addChanges(run.id, [{ ...JOINED, id: newId('chg') }]);
    for (const n of [1, 2, 3, 6, 7, 8]) markStep(run.id, n, 'doneAt', { now: () => NOW });
    assert.equal(beingSetUp(folder)?.run?.id, run.id, 'step 9 is not done yet');
    markStep(run.id, 9, 'doneAt', { now: () => NOW });
    assert.equal(beingSetUp(folder), null);
    assert.equal(readJournal().runs[0].changes.some((c) => c.step === 10), false, 'no green mark');
  });
});

// ---- The engine (with the test steps) ----

// A joining run in a folder under the user's Projects, with `done` steps done; `world` is the test
// steps' world (tests/helpers/setup-steps.js).
async function withJoining(fn, { done = [], joining = true, world = {} } = {}) {
  await withHome(async (home) => {
    const user = fs.realpathSync.native(tempFolder('wh-user zoë '));
    const folder = path.join(user, 'Projects', 'Café Menu');
    fs.mkdirSync(folder, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'test-world.json'), JSON.stringify(world));
    const run = startRun({ folder, now: () => NOW });
    if (joining) addChanges(run.id, [{ ...JOINED, id: newId('chg') }]);
    for (const n of done) markStep(run.id, n, 'doneAt', { now: () => NOW });
    const finished = [];
    const copied = [];
    const made = readJournal().runs.find((r) => r.id === run.id);
    const routes = setupRoutes({
      now: () => NOW, stepsModule: TEST_STEPS, userHome: user,
      health: async () => ({ green: true, lines: [], board: null, trials: null, project: 'o__Cafe-Menu' }),
      finish: async (args) => { finished.push(args); return { started: 'started' }; },
      closeTrial: async () => {}, copy: async (runId, at) => { copied.push([runId, at]); return null; },
    });
    await fn({ folder, run: made, routes, finished, copied });
  });
}

test('on a joining run, steps 4, 5 and 10 are neither planned nor applied', async () => {
  await withJoining(async ({ folder, run, routes }) => {
    for (const n of [4, 5, 10]) {
      await assert.rejects(routes['/setup/plan']({ folder, step: n }), (e) => e.message === notOnList(run, n), `plan of step ${n}`);
      await assert.rejects(routes['/setup/apply']({ folder, step: n, hash: 'a'.repeat(64) }), (e) => e.message === notOnList(run, n), `apply of step ${n}`);
    }
    assert.equal(notOnList(run, 10), 'step 10, Health check is not one of this run\'s steps: a computer joining a project set up on another runs only steps 1, 2, 3, 6, 7, 8, 9');
    // A run of another kind is not called a joining computer.
    assert.equal(notOnList({ steps: {}, changes: [] }, 4), 'step 4, Three questions is not one of this run\'s steps: this run has only steps 1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
    assert.equal(readJournal().runs[0].steps[10], undefined, 'nothing shown');
    // Its own steps are planned as usual.
    const card = await routes['/setup/plan']({ folder, step: 6 });
    assert.equal(card.ok, true, card.refused);
    assert.match(card.hash, /^[0-9a-f]{64}$/);
  }, { done: [1, 2, 3] });
});

test('a step waiting for steps a joining run doesn\'t have goes ahead; on a full run it waits', async () => {
  const world = { after: { 9: [5, 8] } };
  await withJoining(async ({ folder, routes }) => {
    const got = await routes['/setup/plan']({ folder, step: 9 });
    assert.equal(got.wait, undefined, got.why);
    assert.match(got.hash, /^[0-9a-f]{64}$/);
  }, { done: [1, 2, 3, 6, 7, 8], world });
  await withJoining(async ({ folder, routes }) => {
    const got = await routes['/setup/plan']({ folder, step: 9 });
    assert.equal(got.waitsFor, 5);
  }, { done: [1, 2, 3, 6, 7, 8], world, joining: false });
  // Still waits for a step on the joining run's list.
  await withJoining(async ({ folder, routes }) => {
    assert.equal((await routes['/setup/plan']({ folder, step: 9 })).waitsFor, 8);
  }, { done: [1, 2, 3, 6, 7], world });
});

test('status names only a joining run\'s steps, and says every step is done once they are', async () => {
  await withJoining(async ({ folder, routes }) => {
    const { lines, next, ask } = await routes['/setup/status']({ folder });
    const named = lines.filter((l) => /^Step \d+,/.test(l)).map((l) => Number(/^Step (\d+),/.exec(l)[1]));
    assert.deepEqual(named, [1, 2, 3, 6, 7, 8, 9]);
    assert.equal(next, 9);
    assert.equal(ask, 9);
  }, { done: [1, 2, 3, 6, 7, 8] });
  await withJoining(async ({ folder, routes }) => {
    const { lines, next, ask } = await routes['/setup/status']({ folder });
    assert.equal(next, null);
    assert.equal(ask, null);
    assert.equal(lines.at(-1), 'Every step is done.');
  }, { done: [1, 2, 3, 6, 7, 8, 9] });
});

test('a joining run has no health check: the health route refuses it, with no green mark and no ending', async () => {
  await withJoining(async ({ folder, run, routes, finished }) => {
    const kept = JSON.stringify(readJournal());
    await assert.rejects(routes['/setup/health']({ folder, lines: [] }), (e) => e.message === notOnList(run, 10));
    assert.deepEqual(finished, []);
    assert.equal(JSON.stringify(readJournal()), kept);
  }, { done: [1, 2, 3, 6, 7, 8, 9] });
  // A run of its own with every other step done still ends on a green board, once.
  await withJoining(async ({ folder, routes, finished }) => {
    const got = await routes['/setup/health']({ folder, lines: [] });
    assert.equal(got.green, true);
    assert.equal(finished.length, 1);
    assert.equal(firstUnfinished(readJournal().runs[0]), null);
  }, { done: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], joining: false });
  // With step 4 not done, it is the one named.
  await withJoining(async ({ folder, routes, finished }) => {
    const got = await routes['/setup/health']({ folder, lines: [] });
    assert.equal(got.green, false);
    assert.match(got.lines[0], /^Not yet: step 4 \(/);
    assert.deepEqual(finished, []);
  }, { done: [1, 2, 3, 5, 6, 7, 8, 9, 10], joining: false });
});

// A joining run ends on a settling, with no health check after it, so that settling copies the
// run's last clicks and answers into the project's state (ruling R45), once; a settling that
// doesn't finish the run, or a run of its own (whose health check copies), copies nothing.
test('the settling that finishes a joining run copies its records into the project\'s state, once', async () => {
  const world = { settle: [6, 9], record: { 6: { nothing: true }, 9: { pushArrived: true } } };
  await withJoining(async ({ folder, run, routes, copied }) => {
    assert.deepEqual(await routes['/setup/plan']({ folder, step: 6 }), { ok: true, done: true });
    assert.deepEqual(copied, [], 'step 6 doesn\'t finish the run');
    for (const n of [7, 8]) markStep(run.id, n, 'doneAt', { now: () => NOW });
    assert.deepEqual(await routes['/setup/plan']({ folder, step: 9 }), { ok: true, done: true });
    assert.deepEqual(copied, [[run.id, folder]]);
    assert.equal(firstUnfinished(readJournal().runs[0]), null);
    await assert.rejects(routes['/setup/plan']({ folder, step: 9 }), /already done/);
    assert.equal(copied.length, 1);
  }, { done: [1, 2, 3], world });
  await withJoining(async ({ folder, routes, copied }) => {
    assert.deepEqual(await routes['/setup/plan']({ folder, step: 9 }), { ok: true, done: true });
    assert.deepEqual(copied, [], 'step 10 is still to come');
  }, { done: [1, 2, 3, 4, 5, 6, 7, 8], world, joining: false });
});

test('a run uninstall closed is never carried on: status says setup hasn\'t started, and a plan starts a new run (ruling R89)', async () => {
  await withJoining(async ({ folder, run, routes }) => {
    closeRun(run.id, { at: () => NOW, by: 'uninstall' });
    const status = await routes['/setup/status']({ folder });
    assert.deepEqual(status.lines, ['Setup has not started in this folder.']);
    assert.equal(status.next, 1);
    assert.equal(beingSetUp(folder), null, 'the folder isn\'t being set up');
    // Set up again: a plan starts a run of its own, and that run is the folder's.
    const card = await routes['/setup/plan']({ folder, step: 1 });
    assert.equal(card.ok, true, card.refused);
    const runs = readJournal().runs;
    assert.equal(runs.length, 2);
    assert.equal(runs[0].closedBy, 'uninstall');
    assert.equal(runs[1].closedAt, undefined);
    assert.equal(beingSetUp(folder)?.run?.id, runs[1].id);
    assert.match((await routes['/setup/status']({ folder })).lines.join('\n'), /card shown at/);
  }, { done: [1, 2, 3], joining: false });
});
