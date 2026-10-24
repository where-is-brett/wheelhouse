// tests/scripts/foreman/start.test.js
// The foreman's start (build-loop design, section 11). Shape 1 starts the
// watcher, detached and hidden, when it isn't running, and nothing else.
// Shape 2 starts the foreman's long session. No real watcher or claude runs:
// starting is a stand-in that records the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foremanSession, main, startWatcher, stopWatcher, stopForeman, watcherRunning, FOREMAN_PROMPT_LEAD, MONITOR_NOTE } from '../../../scripts/foreman/start.js';
import { foremanTools } from '../../../scripts/foreman/tools.js';
import { FOREMAN_FALLBACK_COMPACT } from '../../../scripts/lib/build-loop.js';
import { healthFile, lockFile } from '../../../scripts/watcher/main.js';
import { watcherDir, runningFile } from '../../../scripts/watcher/waker.js';
import { withHome } from '../../helpers/homes.js';
import { P, config, fakeClient, project } from '../../helpers/foreman.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// A Mac's plugin folder, for the starts written as on a Mac on every system.
const MAC_ROOT = '/plugins/wheelhouse';
const DEAD_PID = 2 ** 22 + 12345; // above any pid the system hands out

// A stand-in spawn: keeps each call; `running` makes the started watcher take its lock.
function fakeSpawn({ running = true } = {}) {
  const calls = [];
  const spawn = (file, args, opts) => {
    calls.push({ file, args, opts });
    if (running) {
      fs.mkdirSync(path.dirname(lockFile(P)), { recursive: true });
      fs.writeFileSync(lockFile(P), `${process.pid}\n`);
    }
    return { pid: process.pid, unref() {}, on() {} };
  };
  return { calls, spawn };
}

async function start(argv, deps) {
  const said = { out: '', err: '' };
  const code = await main(argv, { out: (t) => { said.out += t; }, err: (t) => { said.err += t; }, ...deps });
  return { code, ...said };
}

test('start starts the watcher once', () => withHome(async (home) => {
  await project();
  const { client } = fakeClient({ cfg: config() });
  const fake = fakeSpawn();
  const env = { PATH: '/bin', WHEELHOUSE_ROLE: 'foreman', Wheelhouse_Role: 'x', CLAUDECODE: '1' };
  const first = await start([P], { client, spawn: fake.spawn, pluginRoot: ROOT, env });
  assert.equal(first.code, 0, first.err);
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call.file, process.execPath);
  assert.deepEqual(call.args, [path.join(ROOT, 'scripts', 'watcher', 'main.js'), P]);
  // No role and no host session's variables: the watcher is no one's session.
  assert.deepEqual(call.opts.env, { PATH: '/bin' });
  assert.equal(call.opts.detached, true);
  assert.equal(call.opts.windowsHide, true);
  assert.equal(call.opts.stdio, 'ignore');
  // In a folder the watcher never pins: not the Wheelhouse home, which uninstall removes.
  assert.equal(call.opts.cwd, os.homedir());
  assert.equal(first.out, `Started the watcher for ${P}.\n`);

  // While it runs, a second start starts nothing.
  const second = await start([P], { client, spawn: fake.spawn, pluginRoot: ROOT });
  assert.equal(second.code, 0, second.err);
  assert.equal(fake.calls.length, 1);
  assert.equal(second.out, `The watcher for ${P} is running already.\n`);
}));

test('the watcher counts as running by a live, fresh lock or health record, and not by a dead or old one', () => withHome(async () => {
  await project();
  const t = Date.now();
  const now = () => new Date(t);
  assert.equal(watcherRunning(P, { now }), false);
  fs.mkdirSync(watcherDir(P), { recursive: true });

  fs.writeFileSync(lockFile(P), `${DEAD_PID}\n`);
  assert.equal(watcherRunning(P, { now }), false, 'a lock whose process has gone');
  fs.writeFileSync(lockFile(P), `${process.pid}\n`);
  assert.equal(watcherRunning(P, { now }), true, 'a live, fresh lock');
  const old = new Date(t - 11 * 60 * 1000);
  fs.utimesSync(lockFile(P), old, old);
  assert.equal(watcherRunning(P, { now }), false, 'a lock untouched for over ten minutes');
  fs.rmSync(lockFile(P));

  fs.writeFileSync(healthFile(P), JSON.stringify({ pid: process.pid, at: new Date(t - 30000).toISOString(), shape: 1 }));
  assert.equal(watcherRunning(P, { now }), true, 'a live pid in a fresh health record');
  fs.writeFileSync(healthFile(P), JSON.stringify({ pid: process.pid, at: old.toISOString(), shape: 1 }));
  assert.equal(watcherRunning(P, { now }), false, 'an old health record');
  fs.writeFileSync(healthFile(P), JSON.stringify({ pid: DEAD_PID, at: new Date(t).toISOString(), shape: 1 }));
  assert.equal(watcherRunning(P, { now }), false, 'a health record whose process has gone');
  fs.writeFileSync(healthFile(P), 'not json');
  assert.equal(watcherRunning(P, { now }), false);

  // startWatcher on its own, as the session start uses it.
  const fake = fakeSpawn({ running: false });
  assert.deepEqual(startWatcher(P, { spawn: fake.spawn, pluginRoot: ROOT, now }), { started: true });
  assert.equal(fake.calls.length, 1);
}));

test('Shape 2: the foreman\'s long session compacts at 100,000, runs as the foreman, and is told it is the foreman', () => withHome(async () => {
  const checkout = await project();
  const { client } = fakeClient({ cfg: config({ watcherShape: 2, sessionMode: 'acceptEdits' }) });
  const watcher = fakeSpawn();
  const launched = [];
  const launch = async (file, args, opts) => { launched.push({ file, args, opts }); return 0; };
  const r = await start([P], {
    client, spawn: watcher.spawn, launch, pluginRoot: MAC_ROOT, platform: 'darwin', claude: { kind: 'direct', file: 'claude' },
    env: { PATH: '/bin', CLAUDECODE: '1', wheelhouse_role: 'front-desk' },
  });
  assert.equal(r.code, 0, r.err);
  assert.equal(watcher.calls.length, 0, 'Shape 2 starts no watcher process of its own');
  assert.equal(launched.length, 1);
  const [{ file, args, opts }] = launched;
  assert.equal(file, 'claude');

  // Its own settings file, under the watcher's folder, compacting at 100,000.
  const settings = args[args.indexOf('--settings') + 1];
  assert.equal(path.dirname(settings), watcherDir(P));
  assert.equal(FOREMAN_FALLBACK_COMPACT, 100000);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { autoCompactWindow: 100000 });

  // The prompt first, so --allowedTools can't take it; then the mode, the model and the tools.
  assert.ok(args[0].startsWith('Wheelhouse foreman:'), args[0]);
  assert.ok(args[0].startsWith(FOREMAN_PROMPT_LEAD));
  assert.deepEqual(args.slice(1), [
    '--settings', settings, '--permission-mode', 'acceptEdits', '--model', 'model-a', '--effort', 'medium', '--allowedTools', ...foremanTools(MAC_ROOT, { platform: 'darwin' }),
  ]);
  assert.equal(opts.env.WHEELHOUSE_ROLE, 'foreman');
  assert.equal(opts.env.wheelhouse_role, undefined, 'no other spelling of the role is passed on');
  assert.equal(opts.env.CLAUDECODE, undefined, 'the host session\'s variables are left out');
  assert.equal(opts.env.PATH, '/bin');
  assert.equal(opts.cwd, checkout);
  assert.equal(opts.stdio, 'inherit');
}));

test('the foreman\'s long session takes the foreman\'s model, effort and fallback from the column in force when it starts', () => withHome(async () => {
  await project();
  const pins = { mostCapable: 'model-top', midSized: 'model-mid' };
  const said = [];
  const at = (column) => foremanSession({
    project: P, config: config({ watcherShape: 2, tiers: { pins } }), pluginRoot: MAC_ROOT, platform: 'darwin', env: {}, claude: { kind: 'direct', file: 'claude' },
    routing: () => column, say: (line) => said.push(line),
  }).args;
  const flags = (args) => args.slice(args.indexOf('--model'), args.indexOf('--allowedTools'));
  assert.deepEqual(flags(at({ roles: { foreman: { model: 'model-mid', effort: 'low', fallback: 'model-top' } }, lines: ['a line'] })), ['--model', 'model-mid', '--effort', 'low', '--fallback-model', 'model-top']);
  assert.deepEqual(said, ['a line']);
  // Read from the state when not given: nothing set is Balanced on the pins.
  const read = foremanSession({ project: P, config: config({ watcherShape: 2, tiers: { pins } }), pluginRoot: MAC_ROOT, platform: 'darwin', env: {}, claude: { kind: 'direct', file: 'claude' } }).args;
  assert.deepEqual(flags(read), ['--model', 'model-mid', '--effort', 'medium', '--fallback-model', 'model-top']);
  // A column that can't be read leaves the flat table's model, as before.
  assert.deepEqual(flags(at(undefined)), ['--model', 'model-a']);
  const broken = foremanSession({
    project: P, config: config({ watcherShape: 2 }), pluginRoot: MAC_ROOT, platform: 'darwin', env: {}, claude: { kind: 'direct', file: 'claude' }, routing: () => { throw new Error('no'); },
  }).args;
  assert.deepEqual(flags(broken), ['--model', 'model-a']);
}));

test('the Shape 2 start says the mod hands on the wakes', () => withHome(async () => {
  await project();
  const { client } = fakeClient({ cfg: config({ watcherShape: 2 }) });
  const r = await start([P], {
    client, launch: async () => 0, pluginRoot: MAC_ROOT, platform: 'darwin', claude: { kind: 'direct', file: 'claude' }, env: {},
  });
  assert.equal(r.code, 0, r.err);
  assert.equal(MONITOR_NOTE, 'The mod in this session hands it the watcher\'s wakes.');
  assert.equal(r.err, `${MONITOR_NOTE}\n`);
  assert.doesNotMatch(r.err, /check 26|nothing wakes/i);
}));

test('Shape 2 through claude.cmd puts the prompt on the command line, quoted', () => withHome(async () => {
  await project();
  const { client } = fakeClient({ cfg: config({ watcherShape: 2 }) });
  const launched = [];
  const r = await start([P], {
    client, launch: async (file, args, opts) => { launched.push({ file, args, opts }); return 0; }, pluginRoot: 'C:\\plugins\\wheelhouse', platform: 'win32',
    claude: { kind: 'cmd', file: 'C:\\npm\\claude.cmd' }, env: {},
  });
  assert.equal(r.code, 0, r.err);
  const [{ file, args, opts }] = launched;
  assert.equal(file, 'cmd.exe');
  assert.equal(opts.windowsVerbatimArguments, true);
  assert.match(args.at(-1), /^"C:\\npm\\claude\.cmd "Wheelhouse foreman: /);
}));

test('start refuses in one line when the project or its configuration can\'t be read', () => withHome(async () => {
  await project();
  const { client } = fakeClient({ cfg: null });
  for (const argv of [[], ['../x'], ['nobody__here'], [P]]) {
    const r = await start(argv, { client, spawn: fakeSpawn().spawn, pluginRoot: ROOT });
    assert.equal(r.code, 1, argv.join(' '));
    assert.equal(r.err.trim().split('\n').length, 1, r.err);
  }
}));

test('stopWatcher stops the watcher its fresh lock names, while it is still that process, and nothing when none runs', async () => {
  await withHome(async () => {
    const killed = [];
    const kill = (pid, signal) => { killed.push([pid, signal]); };
    const alive = (pid) => pid === 4242;
    const before = (ms) => async () => new Date(fs.statSync(lockFile(P)).mtimeMs - ms).toISOString();
    assert.deepEqual(await stopWatcher(P, { kill }), { stopped: false, why: 'not running' });
    fs.mkdirSync(path.dirname(lockFile(P)), { recursive: true });
    fs.writeFileSync(lockFile(P), '4242\n');
    assert.deepEqual(await stopWatcher(P, { kill, alive, startTime: before(60 * 1000) }), { stopped: true });
    assert.deepEqual(killed, [[4242, 'SIGTERM']]);
    // A process that started after the lock was last touched has the pid of a watcher gone; a
    // start time not to be had stops nothing either.
    for (const startTime of [before(-60 * 1000), async () => null]) {
      const got = await stopWatcher(P, { kill, alive, startTime });
      assert.equal(got.stopped, false);
      assert.match(got.why, /could not be told apart/);
    }
    // A lock too old, or a pid gone, names no running watcher.
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(lockFile(P), old, old);
    assert.deepEqual(await stopWatcher(P, { kill, alive: () => true, startTime: before(0) }), { stopped: false, why: 'not running' });
    // A watcher gone by the time it is stopped is stopped.
    fs.utimesSync(lockFile(P), new Date(), new Date());
    const gone = () => { throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); };
    assert.deepEqual(await stopWatcher(P, { kill: gone, alive: () => true, startTime: before(1000) }), { stopped: true });
    assert.equal(killed.length, 1);
    await assert.rejects(stopWatcher('../x', { kill }));
  });
});

test('stopForeman stops only the foreman process the watcher recorded, while it is still that process', async () => {
  await withHome(async () => {
    const killed = [];
    const kill = (pid) => { killed.push(pid); };
    const alive = (pid) => pid === 5151;
    assert.deepEqual(await stopForeman(P, { kill, alive }), { stopped: false, why: 'not running' });
    fs.mkdirSync(path.dirname(runningFile(P, 'foreman')), { recursive: true });
    const write = (r) => fs.writeFileSync(runningFile(P, 'foreman'), JSON.stringify({ at: new Date().toISOString(), ...r }));
    write({ state: 'running', pid: 5151, startTime: 'Mon Oct 20 03:00:00 2026' });
    assert.deepEqual(await stopForeman(P, { kill, alive, startTime: async () => 'Mon Oct 20 03:00:00 2026' }), { stopped: true });
    assert.deepEqual(killed, [5151]);
    // Its pid since reused by another process, or a start time not to be had: left running.
    for (const startTime of [async () => 'Mon Oct 20 04:00:00 2026', async () => null]) {
      const got = await stopForeman(P, { kill, alive, startTime });
      assert.equal(got.stopped, false);
      assert.match(got.why, /could not be told apart/);
    }
    // Still starting, or recorded with no start time: nothing is stopped.
    write({ state: 'starting' });
    assert.deepEqual(await stopForeman(P, { kill, alive }), { stopped: false, why: 'not running' });
    write({ state: 'running', pid: 5151 });
    assert.equal((await stopForeman(P, { kill, alive, startTime: async () => 'x' })).stopped, false);
    assert.deepEqual(killed, [5151]);
  });
});
