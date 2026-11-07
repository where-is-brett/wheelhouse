// tests/scripts/update/finish.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  finish, helperCard, main, realRefreshes, STOP_IT, LEAVE_IT, WAIT_LONGER, ASK_AGAIN_MS,
} from '../../../scripts/update/finish.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { moveOffArchon } from '../../../scripts/update/engine-move.js';
import { RESTART_LINE } from '../../../scripts/update/old-helper.js';
import { readOwnFilesState } from '../../../scripts/health/own-files.js';
import { startRun, markStep, addChanges, applyJsonKey } from '../../../scripts/setup/journal.js';
import { keyEdits } from '../../../scripts/setup/local-refresh.js';
import { localSettings, mergeSettings } from '../../../scripts/protection/settings.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { computerId } from '../../../scripts/lib/paths.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { as, shortHome } from '../../helpers/homes.js';

const temp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const T0 = Date.parse('2026-11-04T10:00:00Z');
const START = '2026-11-04T09:00:00.000Z';
const PROOF = { pid: 4242, startTime: START, command: 'node /cache/wheelhouse/0.2.2/scripts/host/helper-main.js' };

async function withHome(fn) {
  const home = temp('wh-finish-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// A clock that only moves when something sleeps.
function clock() {
  let t = T0;
  return { now: () => t, sleep: async (ms) => { t += ms; }, at: () => t - T0 };
}

// A helper stand-in. `retires` is what its retire answers, in turn (the last repeats); it closes when one says retired, or
// at the retire numbered `closeOn`; the new helper answers once startHelper has run. Nothing here is a real process.
function helper({ version = '0.2.2', retires = [{ ok: false, refused: 'unknown request' }], closeOn = null } = {}) {
  const state = { old: true, started: false, asked: 0, killed: [] };
  const client = {
    async health() {
      if (state.started) return { ok: true, version: '0.2.7', pid: 9 };
      return state.old ? { ok: true, version, pid: PROOF.pid } : { ok: false, refused: 'the host helper could not be reached: is it running?' };
    },
    async retire() {
      state.asked += 1;
      const answer = retires[Math.min(state.asked - 1, retires.length - 1)];
      if (answer.retired === true || state.asked === closeOn) { state.old = false; return { ok: true, retired: true }; }
      return answer;
    },
  };
  return { client, state, startHelper: () => { state.started = true; }, kill: (pid, signal) => { state.killed.push([pid, signal]); state.old = false; } };
}

const oldStandIn = ({ proof = PROOF } = {}) => ({
  proveRecorded: async () => ({ why: 'no record' }),
  findByAddress: async () => proof,
  reprove: async () => proof,
});

const quietRefresh = () => ({ local: async () => null, locked: async () => null, agent: async () => null });

// The job's state when it runs finish: the checks done and the finish step running.
function setUp(name = 'proj') {
  const journal = openJournal(name);
  journal.mark('checks', 'done', { tag: 'v0.2.7' });
  journal.mark('finish', 'running');
  return journal;
}

// The new release's folder in the plugin cache under a Claude folder of the test's own.
function cacheRoot(claudeHome, version = '0.2.7') {
  const root = path.join(claudeHome, 'plugins', 'cache', 'wheelhouse', 'wheelhouse', version);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function deps(h, extra = {}) {
  const c = clock();
  const watcherCalls = [];
  const claudeHome = path.join(process.env.WHEELHOUSE_HOME, 'claude');
  return {
    c,
    watcherCalls,
    options: {
      project: 'proj',
      folder: '/nowhere/proj',
      claudeHome,
      newRoot: cacheRoot(claudeHome),
      to: 'v0.2.7',
      from: 'v0.2.6',
      platform: 'darwin',
      client: h.client,
      refresh: quietRefresh(),
      startHelper: h.startHelper,
      kill: h.kill,
      now: c.now,
      sleep: c.sleep,
      user: 'someone',
      cacheRoot: '/cache',
      old: oldStandIn(),
      heldNow: () => true,
      shape: async () => 1,
      move: async () => null,
      watcher: {
        stopWatcher: async (project) => { watcherCalls.push(['stop', project]); return { stopped: false, why: 'not running' }; },
        startWatcher: (project, o) => { watcherCalls.push(['start', project, o.pluginRoot]); return { started: true }; },
        watcherRunning: () => false,
      },
      ...extra,
    },
  };
}

// A project as step 7 left it on an earlier release, with the director's own entries beside Wheelhouse's.
function localProject() {
  const folder = temp('wh-finish-folder-');
  const claudeHome = path.join(folder, 'claude home');
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.mkdirSync(claudeHome);
  const file = path.join(folder, '.claude', 'settings.local.json');
  const mine = { permissions: { allow: ['Bash(ls:*)', 'Bash(my-own-tool:*)'] }, env: { MINE: '1' }, statusLine: { type: 'command', command: 'my-line' } };
  fs.writeFileSync(file, `${JSON.stringify(mine, null, 2)}\n`);
  const run = startRun({ folder });
  const step7 = localSettings({ address: '/h/old.sock', node: '/usr/bin/node', pluginRoot: '/cache/wheelhouse/0.2.6', platform: 'darwin', ownStatusLine: mine.statusLine });
  for (const { key, value } of keyEdits(mine, mergeSettings(mine, step7))) applyJsonKey({ file, key, value, step: 7, record: (c) => addChanges(run.id, [c]) });
  markStep(run.id, 7, 'doneAt');
  return { folder, claudeHome, file };
}

test('finish: the director\'s own local entries are kept', () => withHome(async () => {
  const p = localProject();
  try {
    const journal = setUp();
    const h = helper({ version: '0.2.7' });
    const { options } = deps(h, { folder: p.folder, claudeHome: p.claudeHome, newRoot: cacheRoot(p.claudeHome) });
    options.refresh = {
      ...realRefreshes({ project: 'proj', folder: p.folder, newRoot: options.newRoot, claudeHome: p.claudeHome, platform: 'darwin', address: '/h/new.sock' }),
      locked: async () => null,
      agent: async () => null,
      engine: async () => null,
    };
    const got = await finish({ ...options, journal });
    assert.equal(got.ok, true, got.line);
    const after = JSON.parse(fs.readFileSync(p.file, 'utf8'));
    assert.ok(after.permissions.allow.includes('Bash(my-own-tool:*)'));
    assert.ok(after.permissions.allow.includes('Bash(ls:*)'));
    assert.deepEqual(after.env, { MINE: '1' });
    assert.deepEqual(after.statusLine, { type: 'command', command: 'my-line' });
    assert.ok(after.permissions.allow.some((r) => r.includes(options.newRoot)), 'the new folder is named');
    assert.ok(!after.permissions.allow.some((r) => r.includes('/0.2.6')), 'the old folder is not');
    // What the update wrote is recorded with its hash.
    const record = readOwnFilesState().updates.at(-1);
    assert.deepEqual([record.from, record.to], ['0.2.6', '0.2.7']);
    assert.deepEqual(record.wrote.map((w) => w.file), [p.file]);
  } finally { fs.rmSync(p.folder, { recursive: true, force: true }); }
}));

test('finish: Locked\'s step runs only with Locked present', () => withHome(async (home) => {
  const calls = [];
  const run = async (file) => { calls.push(file); return { code: 1, stdout: '', stderr: 'nothing' }; };
  const none = temp('wh-finish-nolocked-');
  const withLocked = temp('wh-finish-locked-');
  const folder = temp('wh-finish-lockedproj-');
  try {
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] }));
    writeProject('owner__lk', { folder, remoteUrl: 'https://example.com/owner/lk.git', host: 'github', repo: 'owner/lk', connection: { host: 'github', mode: 'narrow', project: 'owner/lk' } });
    const base = { project: 'owner__lk', folder, newRoot: '/cache/wheelhouse/0.2.7', claudeHome: home, platform: 'darwin', run, address: '/h/new.sock' };
    assert.equal(await realRefreshes({ ...base, lockedDir: none }).locked(), null);
    assert.deepEqual(calls, [], 'no administrator window without Locked');
    fs.mkdirSync(path.join(withLocked, 'wheelhouse'), { recursive: true });
    fs.writeFileSync(path.join(withLocked, 'wheelhouse', 'locked-projects.json'), JSON.stringify([folder]));
    fs.writeFileSync(path.join(withLocked, 'managed-settings.json'), '{}');
    fs.writeFileSync(path.join(withLocked, 'wheelhouse', 'installed.json'), '{}');
    const got = await realRefreshes({ ...base, lockedDir: withLocked }).locked();
    assert.ok(calls.includes('osascript'), 'the administrator step is asked for');
    assert.equal(got.ok, false, 'a refused password leaves it as a refresh to do');
    assert.match(got.line, /Locked/);
    // On Windows there is no Locked at all.
    assert.equal(await realRefreshes({ ...base, platform: 'win32', lockedDir: withLocked }).locked(), null);
  } finally { for (const d of [none, withLocked, folder]) fs.rmSync(d, { recursive: true, force: true }); }
}));

test('finish: a refresh that fails is left, the others stand, and a second run does only that one', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.7' });
  const ran = [];
  const refresh = {
    local: async () => { ran.push('local'); return { ok: true, wrote: [] }; },
    locked: async () => { ran.push('locked'); return ran.filter((r) => r === 'locked').length === 1 ? { ok: false, line: 'Locked\'s password was refused.' } : { ok: true, wrote: [] }; },
    agent: async () => { ran.push('agent'); return null; },
  };
  const { options } = deps(h, { refresh });
  const first = await finish({ ...options, journal });
  assert.equal(first.ok, false);
  assert.match(first.line, /password was refused/);
  assert.deepEqual(ran, ['local', 'locked', 'agent']);
  const second = await finish({ ...options, journal });
  assert.equal(second.ok, true, second.line);
  assert.deepEqual(ran.slice(3), ['locked'], 'only the refresh left ran again');
}));

test('finish: a current helper is not asked to retire, and the watcher is restarted from the new folder', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.7' });
  const { options, watcherCalls } = deps(h);
  const got = await finish({ ...options, journal });
  assert.equal(got.ok, true);
  assert.equal(h.state.asked, 0);
  assert.match(got.line, /v0\.2\.7 is installed/);
  assert.deepEqual(watcherCalls, [['stop', 'proj'], ['start', 'proj', options.newRoot]]);
}));

test('finish: an old helper that makes way is replaced by the new one without a card', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.6', retires: [{ ok: true, retired: true }] });
  const { options } = deps(h);
  const got = await finish({ ...options, journal });
  assert.equal(got.ok, true, got.line);
  assert.equal(got.asks, undefined);
  assert.equal(h.state.started, true);
  assert.deepEqual(h.state.killed, []);
}));

test('finish: with a v0.2.2 helper stand-in, the card is asked and nothing is stopped before its answer', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.2' });
  const { options } = deps(h);
  const first = await finish({ ...options, journal });
  assert.equal(first.ok, false);
  assert.equal(first.asks.length, 1);
  assert.deepEqual(first.asks[0].options, [STOP_IT, LEAVE_IT]);
  assert.equal(first.asks[0].recommended, STOP_IT);
  assert.deepEqual(h.state.killed, []);
  assert.equal(h.state.started, false);
  // Asked again with no answer: the same card, still nothing stopped.
  const again = await finish({ ...options, journal });
  assert.deepEqual(again.asks, first.asks);
  assert.deepEqual(h.state.killed, []);
  // The answer: the proved process is stopped by its number, politely, and the new helper starts.
  const done = await finish({ ...options, journal, answer: STOP_IT });
  assert.equal(done.ok, true, done.line);
  assert.deepEqual(h.state.killed, [[PROOF.pid, 'SIGTERM']]);
  assert.equal(h.state.started, true);
}));

test('finish: Leave it finishes with the restart line and stops nothing', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.2' });
  const { options } = deps(h);
  await finish({ ...options, journal });
  const done = await finish({ ...options, journal, answer: LEAVE_IT });
  assert.equal(done.ok, true);
  assert.ok(done.line.includes(RESTART_LINE));
  assert.deepEqual(h.state.killed, []);
  assert.equal(h.state.started, false);
}));

test('finish: a helper that can\'t be proved is left alone with no card', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.2' });
  const { options } = deps(h, { old: { ...oldStandIn(), findByAddress: async () => ({ why: 'not told' }) } });
  const got = await finish({ ...options, journal });
  assert.equal(got.ok, true);
  assert.equal(got.asks, undefined);
  assert.ok(got.line.includes(RESTART_LINE));
  assert.deepEqual(h.state.killed, []);
}));

test('finish: a stop whose proof no longer holds stops nothing', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.2' });
  const old = { ...oldStandIn(), reprove: async () => ({ ...PROOF, pid: 5555 }) };
  const { options } = deps(h, { old });
  await finish({ ...options, journal });
  const done = await finish({ ...options, journal, answer: STOP_IT });
  assert.deepEqual(h.state.killed, []);
  assert.match(done.line, /was not stopped/);
}));

test('finish: a v0.2.5 helper that is busy is asked again every ten seconds for two minutes, then the card offers waiting', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.5', retires: [{ ok: true, retired: false, busy: 'a push' }] });
  const { options, c } = deps(h);
  const first = await finish({ ...options, journal });
  assert.equal(h.state.asked, 1 + 120000 / ASK_AGAIN_MS);
  assert.equal(c.at(), 120000);
  assert.equal(first.asks[0].kind, 'busy');
  assert.deepEqual(first.asks[0].options, [WAIT_LONGER, STOP_IT, LEAVE_IT]);
  assert.equal(first.asks[0].recommended, WAIT_LONGER);
  assert.deepEqual(h.state.killed, []);
}));

test('finish: a busy helper that finishes while it waits is replaced with no card', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.5', retires: [{ ok: true, retired: false, busy: 'a push' }], closeOn: 4 });
  const { options } = deps(h);
  const got = await finish({ ...options, journal });
  assert.equal(got.ok, true, got.line);
  assert.equal(h.state.started, true);
  assert.equal(h.state.asked, 4);
}));

test('finish: Wait longer asks again for another two minutes', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.5', retires: [{ ok: true, retired: false, busy: 'a push' }] });
  const { options } = deps(h);
  await finish({ ...options, journal });
  const asked = h.state.asked;
  const again = await finish({ ...options, journal, answer: WAIT_LONGER });
  assert.equal(h.state.asked - asked, 1 + 120000 / ASK_AGAIN_MS);
  assert.equal(again.asks[0].kind, 'busy');
}));

test('finish: a helper that was asked and does not close gets the Stop it card, and the wait says so after twenty seconds', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.6' });
  h.client.retire = async () => ({ ok: true, retired: true }); // accepted, but it keeps answering
  const said = [];
  const { options, c } = deps(h, { say: (l) => said.push(l) });
  const got = await finish({ ...options, journal });
  assert.deepEqual(said, ['Waiting for the old helper to finish what it\'s doing']);
  assert.ok(c.at() >= 120000);
  assert.equal(got.asks[0].kind, 'hung');
  assert.deepEqual(h.state.killed, []);
}));

test('finish: the watcher is stopped only through stopWatcher, and started only when it is gone', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.7' });
  const order = [];
  let running = true;
  const watcher = {
    stopWatcher: async (project) => { order.push(`stop ${project}`); running = false; return { stopped: true }; },
    startWatcher: (project, o) => { order.push(`start ${project} ${o.pluginRoot}`); return { started: true }; },
    watcherRunning: () => running,
  };
  const killed = [];
  const { options } = deps(h, { watcher, kill: (...a) => killed.push(a) });
  const got = await finish({ ...options, journal });
  assert.equal(got.ok, true);
  assert.deepEqual(order, ['stop proj', `start proj ${options.newRoot}`]);
  assert.deepEqual(killed, [], 'finish itself ends no process');
}));

test('finish: the last line adds the add-on and the Shape 2 foreman when they apply', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.7' });
  const { options } = deps(h, { addonNewer: async () => true, shape: async () => 2 });
  const got = await finish({ ...options, journal });
  assert.match(got.line, /VS Code add-on/);
  assert.match(got.line, /Restart the foreman/);
}));

test('finish: refuses to run unless the job holds the lock and has its finish step running, and never takes the lock', () => withHome(async () => {
  const h = helper({ version: '0.2.7' });
  const journal = setUp();
  const { options } = deps(h);
  const none = await finish({ ...options, journal, heldNow: () => false });
  assert.equal(none.ok, false);
  assert.equal(openJournal('other').lock() !== null, true, 'the lock was not taken by finish');
  const idle = openJournal('quiet');
  idle.mark('checks', 'done', { tag: 'v0.2.7' });
  const notRunning = await finish({ ...options, journal: idle });
  assert.equal(notRunning.ok, false);
  assert.deepEqual(h.state.killed, []);
}));

test('finish: refuses to run from any folder but the plugin cache folder of the journal\'s tag', () => withHome(async () => {
  const h = helper({ version: '0.2.7' });
  const journal = setUp();
  const { options } = deps(h);
  const elsewhere = temp('wh-finish-elsewhere-');
  const wrongVersion = cacheRoot(options.claudeHome, '0.2.9');
  try {
    for (const newRoot of [elsewhere, wrongVersion, path.join(options.claudeHome, 'missing')]) {
      const got = await finish({ ...options, journal, newRoot });
      assert.equal(got.ok, false, newRoot);
      assert.match(got.line, /plugin cache/);
    }
    assert.equal(h.state.asked, 0);
    // A link to the right folder is the right folder, by real paths.
    const link = path.join(elsewhere, 'link');
    fs.symlinkSync(options.newRoot, link);
    assert.equal((await finish({ ...options, journal, newRoot: link })).ok, true);
  } finally { fs.rmSync(elsewhere, { recursive: true, force: true }); }
}));

// A computer with a signing key, and a signed answer to a card.
async function withKey(fn) {
  const home = shortHome();
  try {
    return await as(home, async () => {
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-11-04T00:00:00.000Z' });
      return fn({ enrolled: readEnrolled() });
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
const signedClick = (card, label) => makeEvent({ kind: 'action', data: { action: 'update-helper-answer', card, label, question: `Stop the old helper?\n${card}` }, now: () => new Date('2026-11-04T10:05:00Z') });

test('finish: only a signed answer for the waiting card\'s own id stops the helper', () => withKey(async ({ enrolled }) => {
  {
    {
      const journal = setUp();
      const h = helper({ version: '0.2.2' });
      const { options } = deps(h);
      delete options.answer;
      const first = await finish({ ...options, journal, enrolled, events: [] });
      const card = first.asks[0];
      assert.match(card.id, /^update-helper-4242-2026-11-04T09-00-00\.000Z$/);
      const good = signedClick(card.id, STOP_IT);
      const forged = { ...good, sig: undefined };
      delete forged.sig;
      const other = signedClick('update-helper-9999-other', STOP_IT);
      const altered = { ...good, data: { ...good.data, label: LEAVE_IT } };
      const wrongKind = { ...signedClick(card.id, STOP_IT), kind: 'card-answer' };
      for (const events of [[forged], [other], [altered], [wrongKind], []]) {
        const got = await finish({ ...options, journal, enrolled, events });
        assert.equal(got.ok, false);
        assert.deepEqual(h.state.killed, [], 'nothing is stopped');
      }
      // A signed answer for the card counts; its signature is checked against the enrolled keys.
      const unenrolled = await finish({ ...options, journal, enrolled: [], events: [good] });
      assert.equal(unenrolled.ok, false);
      assert.deepEqual(h.state.killed, []);
      const done = await finish({ ...options, journal, enrolled, events: [good] });
      assert.equal(done.ok, true, done.line);
      assert.deepEqual(h.state.killed, [[PROOF.pid, 'SIGTERM']]);
    }
  }
}));

test('finish: the command takes no answer on its line', async () => {
  const errs = [];
  assert.equal(await main(['p', '--answer', 'Stop it'], { err: (t) => errs.push(t) }), 1);
  assert.equal(errs.length, 1);
});

test('helperCard: plain data with the options and a recommendation', () => {
  const card = helperCard({ kind: 'unknown', version: '0.2.2', canStop: true });
  assert.deepEqual(card.options, [STOP_IT, LEAVE_IT]);
  assert.equal(typeof card.question, 'string');
  assert.deepEqual(helperCard({ kind: 'busy', canStop: false }).options, [WAIT_LONGER, LEAVE_IT]);
});

test('main: refuses bad arguments', async () => {
  const errs = [];
  assert.equal(await main([], { err: (t) => errs.push(t) }), 1);
  assert.equal(await main(['p', '--answer'], { err: (t) => errs.push(t) }), 1);
  assert.equal(errs.length, 2);
});

test('finish: the files written in Copilot\'s clean home are recorded with their hashes', () => withHome(async (home) => {
  const folder = temp('wh-finish-copilot-');
  try {
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1, agents: { [computerId()]: 'copilot' } }));
    fs.mkdirSync(path.join(home, 'engine'), { recursive: true });
    const clean = path.join(home, 'engine', 'copilot-home');
    const written = [path.join(clean, 'config.json'), path.join(clean, 'hooks', 'wheelhouse.json')];
    const writeHome = () => {
      for (const f of written) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `{"at":"${f}"}\n`); }
      return clean;
    };
    const journal = setUp();
    const h = helper({ version: '0.2.7' });
    const { options } = deps(h, { folder });
    options.refresh = { ...quietRefresh(), agent: realRefreshes({ project: 'proj', folder, newRoot: options.newRoot, claudeHome: options.claudeHome, platform: 'darwin', writeHome }).agent };
    const got = await finish({ ...options, journal });
    assert.equal(got.ok, true, got.line);
    const record = readOwnFilesState().updates.at(-1);
    assert.deepEqual(record.wrote.map((w) => w.file).sort(), [...written].sort());
    assert.ok(record.wrote.every((w) => typeof w.hash === 'string' && w.hash !== ''));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}));

test('finish: a project on Archon moves to the own engine after the hand-over, and a second run cancels and queues nothing again', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.7' });
  const cancels = [];
  const writes = [];
  const connector = { inspect: async () => ({ status: 'running', branch: 'feature/x' }), act: async (runId, how) => { cancels.push([runId, how]); return { ok: true }; } };
  const views = async () => ({ runs: { x: [{ kind: 'run', data: { runId: 'r1', state: 'running', work: 'x', engine: 'archon' } }] }, asks: {}, questions: {} });
  const client = { state: { write: async (body) => { writes.push(body); return { ok: true }; } } };
  const move = (args) => moveOffArchon({ ...args, client, stored: () => 'archon', views, connector, othersOnArchon: () => true });
  const { options } = deps(h, { move });
  const first = await finish({ ...options, journal });
  assert.equal(first.ok, true, first.line);
  assert.match(first.line, /own engine/);
  assert.deepEqual(cancels, [['r1', { cancel: true }]]);
  assert.equal(writes.filter((w) => w.kind === 'card').length, 1);
  await finish({ ...options, journal });
  assert.equal(cancels.length, 1, 'not cancelled twice');
  assert.equal(writes.filter((w) => w.kind === 'card').length, 1, 'one removal card');
}));

test('finish: a move Archon does not answer holds the update until it runs again', () => withHome(async () => {
  const journal = setUp();
  const h = helper({ version: '0.2.7' });
  const move = async () => ({ done: false, lines: ['Archon did not answer about run r1, so the move waits: run the update again.'] });
  const { options } = deps(h, { move });
  const got = await finish({ ...options, journal });
  assert.equal(got.ok, false);
  assert.match(got.line, /did not answer/);
}));
