// tests/scripts/engine/stop.test.js
// All stop over the fake engine (spec 12.3, check 78): the process listing, the folders processes work in, `kill`
// and the wait are all stand-ins, so nothing is listed, ended or waited on for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fakeEngine, loadRecordings } from '../../../scripts/engine/fake.js';
import { stopEngine, endRun, parsePs, parseLsof, stopWords, STOP_WAIT_MS } from '../../../scripts/engine/stop.js';

const recordings = loadRecordings(path.join(import.meta.dirname, '..', '..', 'fixtures', 'engine'));
const SELF = 900;

// A computer's processes: `rows` [pid, ppid, pgid, command]; `kill` takes away what it ends, unless `stubborn`
// names it (that one goes only on SIGKILL) or `undying` does (it never goes).
function computer(rows, { stubborn = [], undying = [], cwds = {} } = {}) {
  let table = rows.map(([pid, ppid, pgid, command]) => ({ pid, ppid, pgid, command }));
  const kills = [];
  const waits = [];
  // What the cancel itself ends, as Archon's cancel ends the steps it knows.
  const cancelEnds = (pids) => { table = table.filter((p) => !pids.includes(p.pid)); };
  const kill = (pid, signal) => {
    kills.push([pid, signal]);
    const gone = (p) => (pid < 0 ? p.pgid === -pid : p.pid === pid);
    table = table.filter((p) => !gone(p) || undying.includes(p.pid) || (stubborn.includes(p.pid) && signal !== 'SIGKILL'));
  };
  return {
    kills, waits, cancelEnds,
    list: async () => table.map((p) => ({ ...p })),
    cwds: async () => new Map(Object.entries(cwds).map(([pid, cwd]) => [Number(pid), cwd])),
    kill,
    sleep: async (ms) => { waits.push(ms); },
  };
}

const base = [[1, 0, 1, '/sbin/launchd'], [SELF, 1, SELF, 'node helper-main.js']];

test('All stop cancels every run, a paused one among them', async () => {
  const engine = fakeEngine({ recordings });
  const a = engine.start({ recording: 'quick-approved', running: true }).runId;
  const b = engine.start({ recording: 'quick-blocked', running: true }).runId;
  const c = engine.start({ recording: 'merge-hold' }).runId;
  const pc = computer(base);
  const got = await stopEngine({ engine, ...pc, self: SELF });
  assert.deepEqual(got.cancelled, [a, b, c]);
  assert.deepEqual(got.paused, []);
  assert.deepEqual(got.survivors, []);
  assert.deepEqual(got.ended, []);
  assert.deepEqual(pc.kills, []);
  assert.deepEqual(pc.waits, [], 'with no process to look at again, there is nothing to wait for');
  assert.equal(engine.inspect(a).status, 'ended');
  assert.equal(engine.inspect(c).status, 'ended');
  assert.deepEqual(engine.calls.filter((x) => x.call === 'stopAll').length, 1);
});

test('All stop hands the engine the runs it is told of, for one the engine may not list yet', async () => {
  const engine = fakeEngine({ recordings });
  let given = null;
  const stopAll = engine.stopAll.bind(engine);
  engine.stopAll = async (reason, options) => { given = options.known; return stopAll(reason, options); };
  await stopEngine({ engine, ...computer(base), self: SELF, known: ['run-1', 'run-2'] });
  assert.deepEqual(given, ['run-1', 'run-2']);
});

test('a process left after ten seconds is ended and named; the tree is taken before the cancel', async () => {
  const engine = fakeEngine({ recordings });
  const runId = engine.start({ recording: 'quick-approved', running: true, ownerPid: 100 }).runId;
  const pc = computer([
    ...base,
    [100, 1, 100, 'fake-engine workflow run'],
    [101, 100, 100, '/bin/sh -c step'],
    [102, 101, 102, 'sleep 747'], // moved itself into its own session (setsid)
    [103, 101, 100, 'sleep 731'],
  ]);
  // The cancel ends the owner and the steps it knows, but not the one in its own session.
  const stopAll = engine.stopAll.bind(engine);
  engine.stopAll = async (reason, options) => { const got = await stopAll(reason, options); pc.cancelEnds([100, 101, 103]); return got; };
  const got = await stopEngine({ engine, ...pc, self: SELF });
  assert.deepEqual(got.cancelled, [runId]);
  assert.equal(pc.waits[0], STOP_WAIT_MS);
  // Its own group's leader, so the group is ended, by pid; nothing else is touched.
  assert.deepEqual(pc.kills, [[-102, 'SIGTERM']]);
  assert.deepEqual(got.ended, ['"sleep 747" (process 102)']);
  assert.deepEqual(got.survivors, []);
  assert.match(stopWords(got), /ended 1 process the engine left running: "sleep 747" \(process 102\)/);
});

test('a process that ignores the first ending gets the second, and one that outlives both is named as left', async () => {
  const engine = fakeEngine({ recordings });
  engine.start({ recording: 'quick-approved', running: true, ownerPid: 200 });
  const pc = computer([...base, [200, 1, 200, 'fake-engine owner'], [201, 200, 200, 'stubborn script'], [202, 200, 200, 'undying script']], { stubborn: [201], undying: [202] });
  const got = await stopEngine({ engine, ...pc, self: SELF });
  assert.deepEqual(pc.kills, [[-200, 'SIGTERM'], [201, 'SIGTERM'], [202, 'SIGTERM'], [201, 'SIGKILL'], [202, 'SIGKILL']]);
  assert.deepEqual(got.survivors, ['"undying script" (process 202)']);
  assert.ok(got.ended.includes('"stubborn script" (process 201)'));
  assert.match(stopWords(got), /still running after All stop: "undying script" \(process 202\)/);
});

test("every process the host started is ended too, with its tree; the helper's own never is", async () => {
  const engine = fakeEngine({ recordings });
  const pc = computer([...base, [300, SELF, SELF, 'archon workflow wake --watch'], [301, 300, SELF, 'bun wake step'], [SELF + 1, SELF, SELF, 'git status']]);
  const got = await stopEngine({ engine, ...pc, self: SELF, processes: [{ pid: 300, name: "the engine's continuation process" }] });
  // In the helper's own group: ended one by one, by pid, never by the group.
  assert.deepEqual(pc.kills.filter(([, s]) => s === 'SIGTERM').map(([pid]) => pid).sort(), [300, 301]);
  assert.ok(pc.kills.every(([pid]) => pid > 0 && pid !== SELF && pid !== SELF + 1));
  assert.ok(got.ended.includes("the engine's continuation process (process 300)"));
});

test("a process already moved to the system, working in a run's folder, is found by its folder; the director's own is left", async () => {
  const engine = fakeEngine({ recordings });
  const folder = path.join(path.sep, 'p', '.worktrees', 'wh', 'card-12');
  engine.start({ recording: 'quick-approved', running: true, folder });
  // The director's terminal (77) has a shell (401) in the folder: not moved to the system, so not a step's daemon.
  const pc = computer([...base, [77, 1, 77, 'Terminal'], [400, 1, 400, 'node dev-server.js'], [401, 77, 401, '-zsh'], [402, 401, 401, 'vim notes.md']], {
    cwds: { 400: path.join(folder, 'site'), 401: folder, 402: folder, 77: path.sep },
  });
  const got = await stopEngine({ engine, ...pc, self: SELF });
  assert.deepEqual(pc.kills, [[-400, 'SIGTERM']]);
  assert.deepEqual(got.ended, ['"node dev-server.js" (process 400, in the work\'s folder)']);
});

test("an engine that can't list its runs still has the host's processes ended, and says so", async () => {
  const engine = fakeEngine({ recordings });
  engine.stopAll = async () => ({ cancelled: [], survivors: [], paused: [], trouble: "The engine couldn't list its runs, so none was cancelled" });
  const pc = computer([...base, [500, 1, 500, 'archon workflow wake --watch']]);
  const got = await stopEngine({ engine, ...pc, self: SELF, processes: [{ pid: 500, name: "the engine's continuation process" }] });
  assert.deepEqual(pc.kills, [[-500, 'SIGTERM']]);
  assert.equal(got.trouble, "The engine couldn't list its runs, so none was cancelled");
  assert.match(stopWords(got), /couldn't list its runs/);
});

test('a process whose pid was taken by another program meanwhile is left alone', async () => {
  const engine = fakeEngine({ recordings });
  engine.start({ recording: 'quick-approved', running: true, ownerPid: 600 });
  const pc = computer([...base, [600, 1, 600, 'fake-engine owner']]);
  const stopAll = engine.stopAll.bind(engine);
  engine.stopAll = async (reason, options) => {
    const got = await stopAll(reason, options);
    pc.cancelEnds([600]);
    return got;
  };
  const list = pc.list;
  let calls = 0;
  // After the wait, pid 600 is some other program.
  const got = await stopEngine({ engine, ...pc, list: async () => { calls += 1; return calls === 1 ? list() : [...(await list()), { pid: 600, ppid: 1, pgid: 600, command: 'other program' }]; }, self: SELF });
  assert.deepEqual(pc.kills, []);
  assert.deepEqual(got.ended, []);
});

test("an owner pid whose process isn't the engine's is left alone and reported, with its tree", async () => {
  const engine = fakeEngine({ recordings });
  // The run's owner died and its pid was taken by the director's editor; the run is still recorded as running.
  engine.start({ recording: 'quick-approved', running: true, ownerPid: 650 });
  const pc = computer([...base, [650, 1, 650, '/Applications/Editor.app/Contents/MacOS/Editor'], [651, 650, 650, 'editor helper']]);
  const got = await stopEngine({ engine, ...pc, self: SELF });
  assert.deepEqual(pc.kills, []);
  assert.deepEqual(got.ended, []);
  assert.deepEqual(got.leftAlone, ['"/Applications/Editor.app/Contents/MacOS/Editor" (process 650)']);
  assert.match(stopWords(got), /left 1 process alone.*isn't the engine's: "\/Applications\/Editor\.app\/Contents\/MacOS\/Editor" \(process 650\)/);
});

test('afterSnapshot is told once the processes are taken and before any run is cancelled, so a process it ends is still in the snapshot', async () => {
  const engine = fakeEngine({ recordings });
  engine.start({ recording: 'quick-approved', running: true });
  // The wake (300) has carried a run on; its step (301) is in its own session. Ending the wake hands the step to the system.
  const pc = computer([...base, [300, SELF, 300, 'fake-engine wake'], [301, 300, 301, 'bun resumed step']]);
  const order = [];
  const stopAll = engine.stopAll.bind(engine);
  engine.stopAll = async (reason, options) => stopAll(reason, { beforeCancel: async (runs) => { await options.beforeCancel(runs); order.push('cancel'); } });
  const list = pc.list;
  const afterSnapshot = async () => {
    order.push('after snapshot');
    pc.kill(300, 'SIGTERM');
    pc.kills.length = 0;
  };
  const got = await stopEngine({ engine, ...pc, list: async () => { order.push('list'); return list(); }, afterSnapshot, self: SELF, processes: [{ pid: 300, name: "the engine's continuation process" }] });
  assert.deepEqual(order.slice(0, 3), ['list', 'after snapshot', 'cancel']);
  assert.deepEqual(pc.kills, [[-301, 'SIGTERM']]);
  assert.deepEqual(got.ended, ['"bun resumed step" (process 301)']);
});

test('afterSnapshot is told even when the engine refuses before it lists its runs', async () => {
  const engine = fakeEngine({ recordings });
  engine.stopAll = async () => { throw new Error('no engine'); };
  let told = 0;
  const pc = computer(base);
  const got = await stopEngine({ engine, ...pc, self: SELF, afterSnapshot: () => { told += 1; } });
  assert.equal(told, 1);
  assert.match(got.trouble, /no engine/);
});

test('parsePs and parseLsof read the listings', () => {
  assert.deepEqual(parsePs('  1     0     1 /sbin/launchd\n 812   1 812 sleep 747\nnoise\n'), [
    { pid: 1, ppid: 0, pgid: 1, command: '/sbin/launchd' }, { pid: 812, ppid: 1, pgid: 812, command: 'sleep 747' },
  ]);
  assert.deepEqual([...parseLsof('p12\nfcwd\nn/a/b\np13\nfcwd\nn/c d\n')], [[12, '/a/b'], [13, '/c d']]);
});

test('one run\'s process tree is ended by pid, as All stop ends every run\'s, and another run\'s is left alone', async () => {
  const engine = fakeEngine({ recordings });
  const a = engine.start({ recording: 'quick-approved', running: true, ownerPid: 100 }).runId;
  engine.start({ recording: 'quick-blocked', running: true, ownerPid: 200 });
  const pc = computer([
    ...base,
    [100, 1, 100, 'fake-engine workflow run'],
    [101, 100, 100, '/bin/sh -c step'],
    [200, 1, 200, 'fake-engine workflow run'],
  ]);
  const got = await endRun({ engine, run: { id: a }, ...pc, self: SELF });
  assert.deepEqual(pc.kills, [[-100, 'SIGTERM'], [101, 'SIGTERM']], 'its group by its leader, the rest by pid; never 200');
  assert.deepEqual(got.ended.sort(), ['"/bin/sh -c step" (process 101)', '"fake-engine workflow run" (process 100)']);
  assert.deepEqual(got.survivors, []);
  assert.ok((await pc.list()).some((p) => p.pid === 200), 'the other run goes on');
  assert.equal(engine.calls.filter((c) => c.call === 'stopAll').length, 0, 'no other run is cancelled');
});

test('endRun with a folder and no id takes what was left in the folder, and no owner on record', async () => {
  const engine = fakeEngine({ recordings });
  engine.start({ recording: 'quick-approved', running: true, ownerPid: 700 });
  const pc = computer([...base, [700, 1, 700, 'fake-engine owner of another run'], [701, 1, 701, 'a step left behind']], { cwds: { 701: '/work/a/src' } });
  const got = await endRun({ engine, run: { folder: '/work/a' }, ...pc, self: SELF, grace: 0 });
  assert.equal(got.ended.length, 1);
  assert.match(got.ended[0], /a step left behind/);
  assert.equal(got.survivors.length, 0);
  assert.ok((await pc.list()).some((p) => p.pid === 700), 'an owner it wasn\'t asked about stays');
});
