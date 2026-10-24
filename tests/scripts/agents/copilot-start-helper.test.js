// tests/scripts/agents/copilot-start-helper.test.js
// The one command the person allows on a computer where Copilot builds (rulings P5-16, P5-29, P5-30): plan prints
// the computer's changes and their hash, install makes them on the card's Approve (the hook file, the sign-in
// start, the project registered and moved into the store, the card's answers), start starts the helper and only
// the watchers an agent's built sessions part needs, and uninstall takes away what no other project needs. No real
// launch agent, registry entry, ~/.wheelhouse or ~/.copilot is touched: every home is temporary, the helper's
// client and every spawn are stand-ins, and `reg` is never run.
import { test as nodeTest, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { as, shortHome } from '../../helpers/homes.js';
import { run, withoutGitVars } from '../../../scripts/lib/run.js';
import { computerId } from '../../../scripts/lib/paths.js';
import { makeEvent, writeEvent } from '../../../scripts/state/events.js';
import { confirmLine } from '../../../scripts/state/card-lines.js';
import { readLeanRecord } from '../../../scripts/state/lean-record.js';
import { briefHash } from '../../../scripts/feature/files.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop, stopState } from '../../../scripts/lib/stop.js';
import { readLean, registerLean } from '../../../scripts/lean/project.js';
import { storeDir } from '../../../scripts/lean/store.js';
import { releaseProject } from '../../../scripts/lean/release.js';
import { loginStartRecord } from '../../../scripts/lib/login-start.js';
import { ownKey, readEnrolled } from '../../../scripts/state/signing.js';
import { projectForFolder } from '../../../scripts/lib/projects.js';
import { registeredLeanProjects, leanState } from '../../../scripts/lean/project.js';
import {
  planInstall, install, startAll, planUninstall, uninstall, main, CHANGED, STOP_ON, STOP_CARRIED, RUNNING, NOT_STARTED,
} from '../../../scripts/agents/copilot/start-helper.js';

// These install the helper as on a Mac (a launch agent, and a Mac's paths for Node.js and the plugin),
// so on Windows they are left to the Mac's run; Windows's Run entry is checked in
// tests/scripts/lib/login-start.test.js.
const test = process.platform === 'win32' ? (name, fn) => nodeTest(name, { skip: 'the helper is installed here as on a Mac' }, fn) : nodeTest;

const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

const T0 = new Date('2026-10-23T01:00:00.000Z');
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com',
};
async function git(cwd, args) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(), env: GIT_ENV });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}

// A computer: Wheelhouse's home, the person's home, and a project folder that is a git repository on main.
async function computer(name = 'Shop Front') {
  const home = shortHome();
  const userHome = fs.realpathSync.native(shortHome());
  const folder = path.join(fs.realpathSync.native(shortHome()), name);
  fs.mkdirSync(folder);
  await git(folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'shop\n');
  await git(folder, ['add', '-A']);
  await git(folder, ['commit', '-q', '-m', 'Start']);
  const regCalls = [];
  const started = [];
  const deps = {
    run: hostGuard,
    regRun: async (...args) => { regCalls.push(args); return { code: 1, stdout: '', stderr: 'no registry in a test' }; },
    userHome,
    platform: 'darwin',
    env: {},
    now: () => T0,
    start: async () => { started.push(true); return { ok: true, line: RUNNING }; },
  };
  return { home, userHome, folder, deps, regCalls, started, as: (fn) => as(home, fn) };
}

const ANSWERS = { workComputer: false, realUsers: true, test: 'npm test' };

// Every file under `dir`, but for git's own, with its content.
function filesUnder(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.set(path.relative(dir, p), fs.readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

test('plan lists the computer\'s changes and the card\'s answers, and its hash covers them', async () => {
  const c = await computer();
  await c.as(async () => {
    const plan = await planInstall({ folder: c.folder, ...ANSWERS }, c.deps);
    assert.equal(plan.project, 'shop-front');
    assert.deepEqual(plan.lines, [
      `Wheelhouse's guards are registered with Copilot in ${path.join(c.userHome, '.copilot', 'hooks', 'wheelhouse.json')}, for every project on this computer`,
      `Wheelhouse's helper starts when you sign in to this computer, for you only: ${path.join(c.userHome, 'Library', 'LaunchAgents', 'dev.wheelhouse.helper.plist')}`,
      'A signing key for this computer, so what you confirm in Wheelhouse\'s own window is signed',
      `This folder, ${c.folder}, is registered as the Lean project shop-front`,
      `Its git moves into Wheelhouse's own folder, ${storeDir('shop-front')}, and this folder becomes a worktree of it, so only the helper moves the main version`,
      'It has real users, so a merge is approved only in Wheelhouse\'s own window',
      'Before each merge the helper runs `npm test` on the approved commit',
    ]);
    // Each answer changes the hash; the same answers give the same one.
    assert.equal((await planInstall({ folder: c.folder, ...ANSWERS }, c.deps)).hash, plan.hash);
    for (const other of [{ realUsers: false }, { test: null }, { test: 'npm run check' }, { workComputer: true }]) {
      assert.notEqual((await planInstall({ folder: c.folder, ...ANSWERS, ...other }, c.deps)).hash, plan.hash, JSON.stringify(other));
    }
    const none = await planInstall({ folder: c.folder, ...ANSWERS, realUsers: false, test: null }, c.deps);
    assert.ok(none.lines.includes('It has no real users yet, so a click in the chat approves a merge'));
    assert.ok(none.lines.includes('No test command is set, so merges go ahead with no tests run, and the record says so'));
    // The answers must be given, and the plan is for the project's own folder.
    await assert.rejects(planInstall({ folder: c.folder, realUsers: true }, c.deps), /work computer/);
    await assert.rejects(planInstall({ folder: c.folder, workComputer: false }, c.deps), /real users/);
    fs.mkdirSync(path.join(c.folder, 'src'));
    await assert.rejects(planInstall({ folder: path.join(c.folder, 'src'), ...ANSWERS }, c.deps), /project's own folder/);
    // Nothing was written by planning.
    assert.equal(readLean('shop-front'), null);
    assert.equal(fs.existsSync(path.join(c.userHome, '.copilot')), false);
  });
});

test('install registers the project, moves its git into the store and writes nothing in the project folder', async () => {
  const c = await computer();
  await c.as(async () => {
    const before = filesUnder(c.folder);
    const plan = await planInstall({ folder: c.folder, ...ANSWERS }, c.deps);
    // A hash that isn't the card's changes nothing, and nor does STOP.
    await assert.rejects(install({ folder: c.folder, ...ANSWERS, hash: '0'.repeat(64) }, c.deps), (e) => e.message === CHANGED);
    setStop({ by: 'helper', now: () => T0 });
    await assert.rejects(install({ folder: c.folder, ...ANSWERS, hash: plan.hash }, c.deps), (e) => e.message === STOP_ON);
    liftStop();
    assert.equal(readLean('shop-front'), null);

    const done = await install({ folder: c.folder, ...ANSWERS, hash: plan.hash }, c.deps);
    assert.deepEqual(done, { ok: true, lines: ['Wheelhouse\'s helper is installed for shop-front', RUNNING] });
    assert.deepEqual(c.started, [true]);
    const record = readLean('shop-front');
    assert.equal(record.folder, c.folder);
    assert.equal(record.store, storeDir('shop-front'));
    assert.equal(record.realUsers, true);
    assert.equal(record.test, 'npm test');
    assert.equal(record.agent, 'copilot');
    assert.equal(Object.hasOwn(record, 'helper'), false, 'no helper flag is kept');
    assert.match(record.main, /^[0-9a-f]{40}$/);
    // The folder's .git is a pointer into the store.
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isFile(), true);
    // This computer has a signing key now, and trusts it.
    const own = ownKey();
    assert.ok(own !== null);
    assert.ok(readEnrolled().some((e) => e.computer === own.computer && e.publicKey === own.publicKey));

    // P5-45: the files install writes are the hook file in the person's Copilot folder, the launch agent and
    // Wheelhouse's own; none is under the project folder.
    assert.deepEqual(filesUnder(c.folder), before, 'nothing in the project folder changed');
    for (const name of ['.github/hooks', '.github/copilot/settings.json', '.claude/settings.json']) {
      assert.equal(fs.existsSync(path.join(c.folder, name)), false, name);
    }
    const hooks = path.join(c.userHome, '.copilot', 'hooks', 'wheelhouse.json');
    const registration = JSON.parse(fs.readFileSync(hooks, 'utf8'));
    assert.deepEqual(Object.keys(registration.hooks), ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'preCompact']);
    assert.equal(loginStartRecord().path, path.join(c.userHome, 'Library', 'LaunchAgents', 'dev.wheelhouse.helper.plist'));
    assert.equal(fs.existsSync(loginStartRecord().path), true);
    assert.deepEqual(c.regCalls, [], 'no registry call on a Mac');

    // Installing again with a fresh plan changes nothing but what the answers say.
    const again = await planInstall({ folder: c.folder, ...ANSWERS, test: 'npm run check' }, c.deps);
    assert.equal(again.needsKey, false);
    assert.equal((await install({ folder: c.folder, ...ANSWERS, test: 'npm run check', hash: again.hash }, c.deps)).ok, true);
    assert.equal(readLean('shop-front').test, 'npm run check');
    assert.equal(readLean('shop-front').main, record.main);
  });
});

test('two installs at once register once, one after the other', async () => {
  const c = await computer();
  await c.as(async () => {
    const plan = await planInstall({ folder: c.folder, ...ANSWERS }, c.deps);
    const [a, b] = await Promise.all([
      install({ folder: c.folder, ...ANSWERS, hash: plan.hash }, c.deps),
      install({ folder: c.folder, ...ANSWERS, hash: plan.hash }, c.deps),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    // Both found the same project, adopted once: the store is a repository, and the folder points into it.
    assert.equal(readLean('shop-front').store, storeDir('shop-front'));
    assert.equal(fs.readFileSync(path.join(c.folder, '.git'), 'utf8').includes(storeDir('shop-front')), true);
    assert.equal(fs.existsSync(path.join(storeDir('shop-front'), '..', 'lean.lock')), false, 'the lock is freed');
    assert.equal(fs.readdirSync(path.join(c.home, 'projects')).length, 1, 'one project');
  });
});

test('the signing key is made while the project\'s lock is held', async () => {
  const c = await computer();
  await c.as(async () => {
    const lock = path.join(c.home, 'projects', 'shop-front', 'lean.lock');
    const seen = [];
    const deps = { ...c.deps, makeKey: (make) => { seen.push(fs.existsSync(lock)); return make(); } };
    const plan = await planInstall({ folder: c.folder, ...ANSWERS }, deps);
    assert.equal((await install({ folder: c.folder, ...ANSWERS, hash: plan.hash }, deps)).ok, true);
    assert.deepEqual(seen, [true], 'made once, inside the lock');
    assert.ok(ownKey() !== null);
  });
});

test('start starts the helper, and a watcher only for a project whose agent has its sessions part built', async () => {
  const c = await computer();
  await c.as(async () => {
    // A Lean project, a host project on Copilot (sessions not built yet) and one on Claude Code.
    registerLean({ project: 'shop', folder: c.folder, now: () => T0 });
    const id = computerId();
    const hosted = (name) => {
      const folder = path.join(c.home, name);
      fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
      writeProject(name, { folder, remoteUrl: `https://github.com/o/${name}.git`, host: 'github', repo: `o/${name}`, connection: { host: 'github', mode: 'quick', project: `o/${name}` } });
    };
    hosted('on-copilot');
    hosted('on-claude');
    const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
    const configs = { 'on-copilot': { ...base, agents: { [id]: 'copilot' } }, 'on-claude': base };
    let up = false;
    const asked = [];
    const client = {
      health: async () => ({ ok: up }),
      config: async ({ project }) => { asked.push(project); return { ok: true, config: configs[project] }; },
    };
    const spawned = [];
    const spawn = (file, args) => {
      spawned.push(path.relative(path.resolve('.'), args[0]).replaceAll('\\', '/'));
      if (args[0].endsWith('helper-main.js')) up = true;
      return { on() {}, unref() {} };
    };
    const got = await startAll({ client, spawn, pause: async () => {}, receiverUp: async () => false });
    assert.equal(got.ok, true);
    assert.equal(got.line, RUNNING);
    assert.deepEqual(got.watchers, ['on-claude']);
    assert.deepEqual(asked.sort(), ['on-claude', 'on-copilot'], 'a Lean project has no configuration to ask for');
    assert.deepEqual(spawned, ['scripts/host/helper-main.js', 'scripts/watcher/main.js', 'scripts/telemetry/main.js']);

    // Running already: nothing is started, and at Lean alone no watcher or receiver either.
    for (const name of ['on-copilot', 'on-claude']) fs.rmSync(path.join(c.home, 'projects', name), { recursive: true, force: true });
    spawned.length = 0;
    const lean = await startAll({ client, spawn, pause: async () => {}, receiverUp: async () => false });
    assert.deepEqual(lean, { ok: true, line: RUNNING, watchers: [] });
    assert.deepEqual(spawned, []);

    // A helper that never answers: why not, in one line.
    up = false;
    const never = { health: async () => ({ ok: false }), config: async () => ({ ok: false }) };
    const failed = await startAll({ client: never, spawn: () => ({ on() {}, unref() {} }), waitMs: 50, pause: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    assert.deepEqual(failed, { ok: false, line: NOT_STARTED, watchers: [] });
  });
});

// A second project folder, a git repository on main, with a record file of the chat's own.
async function secondFolder(name) {
  const folder = path.join(fs.realpathSync.native(shortHome()), name);
  fs.mkdirSync(folder);
  await git(folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(folder, 'README.md'), `${name}\n`);
  await git(folder, ['add', '-A']);
  await git(folder, ['commit', '-q', '-m', 'Start']);
  return folder;
}
async function installed(c, folder) {
  const plan = await planInstall({ folder, ...ANSWERS }, c.deps);
  assert.equal((await install({ folder, ...ANSWERS, hash: plan.hash }, c.deps)).ok, true);
}

test('uninstall-plan lists what leaving the helper does, and uninstall takes only that card\'s hash', async () => {
  const c = await computer();
  await c.as(async () => {
    await installed(c, c.folder);
    const hooks = path.join(c.userHome, '.copilot', 'hooks', 'wheelhouse.json');
    const keep = await planUninstall({ folder: c.folder, removeState: false }, c.deps);
    assert.deepEqual(keep.lines, [
      'This project, shop-front, leaves Wheelhouse\'s helper: its guards, its record and its merges by the helper stop for it',
      'Nothing decided through the helper needs writing into this folder\'s record files: it holds no ideas, rulings or designs the record files don\'t',
      `Its git moves back into this folder, ${c.folder}, with the main version checked out, so you work with git alone, as Lean does without the helper`,
      `Wheelhouse's guards are no longer registered with Copilot: ${hooks} is removed`,
      `What starts Wheelhouse's helper when you sign in is removed: ${path.join(c.userHome, 'Library', 'LaunchAgents', 'dev.wheelhouse.helper.plist')}`,
      `Its Wheelhouse state stays in ${path.join(c.home, 'projects', 'shop-front')}`,
    ]);
    const drop = await planUninstall({ folder: c.folder, removeState: true }, c.deps);
    assert.notEqual(drop.hash, keep.hash, 'the answer is in the hash');
    assert.match(drop.lines.at(-1), /^Its Wheelhouse state, .+, is removed: what the helper recorded there goes, and the record files in the project stay, with what was written into them$/);
    await assert.rejects(planUninstall({ folder: c.folder }, c.deps), /--remove-state/);
    // Planning changed nothing.
    assert.ok(readLean('shop-front') !== null);
    assert.equal(fs.existsSync(hooks), true);
    // A hash that isn't the card's changes nothing, and nor does STOP.
    await assert.rejects(uninstall({ folder: c.folder, removeState: false, hash: drop.hash }, c.deps), (e) => e.message === CHANGED);
    await assert.rejects(uninstall({ folder: c.folder, removeState: false }, c.deps), (e) => e.message === CHANGED);
    setStop({ by: 'helper', now: () => T0 });
    await assert.rejects(uninstall({ folder: c.folder, removeState: false, hash: keep.hash }, c.deps), (e) => e.message === STOP_ON);
    liftStop();
    assert.ok(readLean('shop-front') !== null);
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isFile(), true, 'still in the store');
    // A folder that isn't a Lean project has nothing to plan.
    await assert.rejects(planUninstall({ folder: c.userHome, removeState: false }, c.deps), /isn't a Lean project/);
  });
});

test('uninstall gives the project\'s git back to its folder and removes its Lean registration', async () => {
  const c = await computer();
  await c.as(async () => {
    await installed(c, c.folder);
    const record = path.join(c.folder, '.wheelhouse', 'record');
    fs.mkdirSync(record, { recursive: true });
    fs.writeFileSync(path.join(record, '2026-10-22.jsonl'), '{"kind":"stop"}\n');
    const main = readLean('shop-front').main;
    const store = storeDir('shop-front');
    await leanState('shop-front', { run: hostGuard });
    const plan = await planUninstall({ folder: c.folder, removeState: false }, c.deps);
    const done = await uninstall({ folder: c.folder, removeState: false, hash: plan.hash }, c.deps);
    assert.deepEqual(done, { ok: true, lines: plan.lines });
    // A .git folder again, on main, at the same commit, nothing changed in the files; the store is gone.
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isDirectory(), true);
    assert.equal(await git(c.folder, ['symbolic-ref', 'HEAD']), 'refs/heads/main');
    assert.equal(await git(c.folder, ['rev-parse', 'HEAD']), main);
    assert.equal(await git(c.folder, ['status', '--porcelain', '--untracked-files=no']), '');
    assert.equal(await git(c.folder, ['rev-parse', '--is-bare-repository']), 'false');
    assert.equal(await git(c.folder, ['worktree', 'list', '--porcelain']).then((t) => t.split('\n').filter((l) => l.startsWith('worktree ')).length), 1);
    assert.equal(fs.existsSync(store), false);
    // No Lean registration is left for the session start, the board or the guards to read.
    assert.equal(readLean('shop-front'), null);
    assert.equal(projectForFolder(c.folder), null);
    assert.deepEqual(registeredLeanProjects(), []);
    // The hook file and the sign-in start are gone; the state and the record files stay.
    assert.equal(fs.existsSync(path.join(c.userHome, '.copilot', 'hooks', 'wheelhouse.json')), false);
    assert.equal(loginStartRecord(), null);
    assert.equal(fs.existsSync(path.join(c.home, 'projects', 'shop-front', 'state')), true);
    assert.equal(fs.readFileSync(path.join(record, '2026-10-22.jsonl'), 'utf8'), '{"kind":"stop"}\n');
    // Installing again works from here.
    await installed(c, c.folder);
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isFile(), true);
    // And removing the state, when the director chose it, takes Wheelhouse's folder for the project away.
    const drop = await planUninstall({ folder: c.folder, removeState: true }, c.deps);
    assert.equal((await uninstall({ folder: c.folder, removeState: true, hash: drop.hash }, c.deps)).ok, true);
    assert.equal(fs.existsSync(path.join(c.home, 'projects', 'shop-front')), false);
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isDirectory(), true);
    assert.equal(await git(c.folder, ['rev-parse', 'HEAD']), main);
  });
});

test('uninstall refuses a folder with uncommitted changes or off the main version, and changes nothing', async () => {
  const c = await computer();
  await c.as(async () => {
    await installed(c, c.folder);
    const plan = await planUninstall({ folder: c.folder, removeState: false }, c.deps);
    fs.writeFileSync(path.join(c.folder, 'README.md'), 'changed\n');
    await assert.rejects(uninstall({ folder: c.folder, removeState: false, hash: plan.hash }, c.deps), /changes that aren't committed/);
    await git(c.folder, ['checkout', '--', 'README.md']);
    await git(c.folder, ['switch', '-q', '-c', 'feature/x']);
    await assert.rejects(uninstall({ folder: c.folder, removeState: false, hash: plan.hash }, c.deps), /isn't on the main version/);
    // Still in the store, still registered, the guards still registered.
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isFile(), true);
    assert.equal(fs.existsSync(storeDir('shop-front')), true);
    assert.ok(readLean('shop-front') !== null);
    assert.equal(fs.existsSync(path.join(c.userHome, '.copilot', 'hooks', 'wheelhouse.json')), true);
    // Back at the main version, detached as the helper leaves it: it goes ahead.
    await git(c.folder, ['switch', '-q', '--detach', 'main']);
    assert.equal((await uninstall({ folder: c.folder, removeState: false, hash: plan.hash }, c.deps)).ok, true);
    assert.equal(await git(c.folder, ['symbolic-ref', 'HEAD']), 'refs/heads/main');
    assert.match(await git(c.folder, ['branch', '--list', 'feature/x']), /feature\/x/, 'the feature\'s branch is kept');
  });
});

test('uninstall keeps the guards and the sign-in start while another project uses them', async () => {
  const c = await computer();
  const second = await secondFolder('books');
  await c.as(async () => {
    await installed(c, c.folder);
    await installed(c, second);
    const hooks = path.join(c.userHome, '.copilot', 'hooks', 'wheelhouse.json');
    const plist = loginStartRecord().path;
    const first = await planUninstall({ folder: c.folder, removeState: false }, c.deps);
    assert.ok(first.lines.includes('Wheelhouse\'s guards stay registered with Copilot, and its sign-in start stays: 1 other project on this computer uses them'), first.lines.join('\n'));
    assert.equal((await uninstall({ folder: c.folder, removeState: false, hash: first.hash }, c.deps)).ok, true);
    assert.equal(fs.existsSync(hooks), true);
    assert.equal(fs.existsSync(plist), true);
    const last = await planUninstall({ folder: second, removeState: false }, c.deps);
    assert.equal((await uninstall({ folder: second, removeState: false, hash: last.hash }, c.deps)).ok, true);
    assert.equal(fs.existsSync(hooks), false);
    assert.equal(fs.existsSync(plist), false);
  });
});

test('the command line prints the plan with its hash, and install takes the same answers', async () => {
  const c = await computer('shop');
  await c.as(async () => {
    const out = [];
    const stdout = { write: (t) => out.push(t) };
    const argv = ['--work-computer', 'yes', '--real-users', 'no', '--test', 'npm test'];
    assert.equal(await main(['plan', ...argv], { stdout, cwd: c.folder, deps: c.deps }), 0);
    const text = out.join('');
    assert.match(text, /^- Wheelhouse's guards are registered with Copilot/m);
    assert.match(text, /^- No start-up entry, as this is a work computer/m);
    const hash = /^Hash: ([0-9a-f]{64})$/m.exec(text)[1];
    out.length = 0;
    assert.equal(await main(['install', '--hash', hash, ...argv], { stdout, cwd: c.folder, deps: c.deps }), 0, out.join(''));
    assert.equal(out.join(''), `Wheelhouse's helper is installed for shop\n${RUNNING}\n`);
    assert.equal(readLean('shop').realUsers, false);
    assert.equal(loginStartRecord(), null);
    out.length = 0;
    assert.equal(await main(['install', '--hash', hash, '--work-computer', 'maybe'], { stdout, cwd: c.folder, deps: c.deps }), 1);
    assert.match(out.join(''), /work computer/);
    out.length = 0;
    assert.equal(await main(['launch'], { stdout, cwd: c.folder, deps: c.deps }), 1);
    assert.match(out.join(''), /^Usage/);
    out.length = 0;
    assert.equal(await main(['uninstall-plan', '--remove-state', 'no'], { stdout, cwd: c.folder, deps: c.deps }), 0);
    const off = /^Hash: ([0-9a-f]{64})$/m.exec(out.join(''))[1];
    assert.match(out.join(''), /^- This project, shop, leaves Wheelhouse's helper/m);
    out.length = 0;
    assert.equal(await main(['uninstall', '--hash', off, '--remove-state', 'no'], { stdout, cwd: c.folder, deps: c.deps }), 0, out.join(''));
    assert.equal(readLean('shop'), null);
  });
});

// ---- Giving the git back when something fails (re-review of P5-51) ----

// Everything a failed give-back must leave as it was: the pointer file, the store and its worktree entry, its
// settings and HEAD, and the folder reading its history through the store.
async function storeState(c, project = 'shop-front') {
  const store = storeDir(project);
  return {
    pointer: fs.readFileSync(path.join(c.folder, '.git'), 'utf8'),
    entries: fs.readdirSync(path.join(store, 'worktrees')).sort(),
    head: fs.readFileSync(path.join(store, 'HEAD'), 'utf8'),
    bare: await git(store, ['config', '--bool', 'core.bare']),
    log: await git(c.folder, ['log', '--format=%H', 'main']),
    files: [...filesUnder(c.folder).keys()].sort(),
  };
}

test('a give-back that fails after the move is put back as it was, and says the git is still in the store', async () => {
  const c = await computer();
  await c.as(async () => {
    await installed(c, c.folder);
    for (const failing of ['reset', 'symbolic-ref']) {
      const before = await storeState(c);
      const run2 = async (file, args, options) => (file === 'git' && args.includes(failing) && !args.includes('-q')
        ? { code: 1, stdout: '', stderr: `${failing} failed in a test` }
        : hostGuard(file, args, options));
      await assert.rejects(releaseProject({ project: 'shop-front', folder: c.folder, run: run2 }), (e) => {
        assert.match(e.message, /everything was put back/, e.message);
        assert.ok(e.message.includes(storeDir('shop-front')), e.message);
        return true;
      });
      assert.deepEqual(await storeState(c), before, failing);
      assert.ok(readLean('shop-front') !== null);
    }
  });
});

test('a put-back that itself fails says where the project\'s git is now and what failed, and deletes nothing', async () => {
  const c = await computer();
  await c.as(async () => {
    await installed(c, c.folder);
    const run2 = async (file, args, options) => (file === 'git' && args[0] === 'reset' ? { code: 1, stdout: '', stderr: 'no' } : hostGuard(file, args, options));
    // The rename that would move the git back into the store fails.
    const rename = (from, to) => {
      if (to === storeDir('shop-front')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      fs.renameSync(from, to);
    };
    await assert.rejects(releaseProject({ project: 'shop-front', folder: c.folder, run: run2, rename }), (e) => {
      assert.match(e.message, /could not be put back/, e.message);
      assert.ok(e.message.includes(path.join(c.folder, '.git')), `names where the git is: ${e.message}`);
      assert.match(e.message, /EBUSY/);
      assert.match(e.message, /nothing was deleted/i);
      return true;
    });
    // The git is whole where the message says.
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isDirectory(), true);
    assert.equal(fs.existsSync(path.join(c.folder, '.git', 'objects')), true);
  });
});

test('giving the git back is refused while the store has other worktrees, or the folder points elsewhere', async () => {
  const c = await computer();
  await c.as(async () => {
    await installed(c, c.folder);
    const other = path.join(fs.realpathSync.native(shortHome()), 'other-tree');
    await git(storeDir('shop-front'), ['worktree', 'add', '--detach', '-q', other, 'main']);
    const before = await storeState(c);
    await assert.rejects(releaseProject({ project: 'shop-front', folder: c.folder, run: hostGuard }), /other than this folder/);
    assert.deepEqual(await storeState(c), before);
    await git(storeDir('shop-front'), ['worktree', 'remove', '--force', other]);
    // A pointer rewritten to lead outside the store's worktrees is not followed.
    const pointer = fs.readFileSync(path.join(c.folder, '.git'), 'utf8');
    const elsewhere = path.join(storeDir('shop-front'), 'elsewhere');
    fs.cpSync(path.join(storeDir('shop-front'), 'worktrees', fs.readdirSync(path.join(storeDir('shop-front'), 'worktrees'))[0]), elsewhere, { recursive: true });
    // Still a worktree of the store to git, so only the check of where the entry lies refuses it.
    fs.writeFileSync(path.join(elsewhere, 'commondir'), `${storeDir('shop-front')}\n`);
    fs.writeFileSync(path.join(c.folder, '.git'), `gitdir: ${elsewhere}\n`);
    await assert.rejects(releaseProject({ project: 'shop-front', folder: c.folder, run: hostGuard }), /points to another repository/);
    assert.equal(fs.existsSync(storeDir('shop-front')), true);
    fs.writeFileSync(path.join(c.folder, '.git'), pointer);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
});

test('a sign-in start that can\'t be removed says the state was left in place too', async () => {
  const c = await computer();
  await c.as(async () => {
    await installed(c, c.folder);
    const plist = loginStartRecord().path;
    fs.appendFileSync(plist, '<!-- changed -->\n');
    const plan = await planUninstall({ folder: c.folder, removeState: true }, c.deps);
    await assert.rejects(uninstall({ folder: c.folder, removeState: true, hash: plan.hash }, c.deps), (e) => {
      assert.match(e.message, /git is back in its folder/);
      assert.match(e.message, /Wheelhouse state was left in place/);
      return true;
    });
    assert.equal(fs.existsSync(path.join(c.home, 'projects', 'shop-front')), true);
  });
});

// ---- Moving onto the helper and off it (ruling P5-58) ----

test('plan runs adoption\'s own checks and refuses before any card, registering nothing', async () => {
  const c = await computer();
  await c.as(async () => {
    fs.writeFileSync(path.join(c.folder, 'README.md'), 'changed\n');
    await assert.rejects(planInstall({ folder: c.folder, ...ANSWERS }, c.deps), /changes that aren't committed/);
    await git(c.folder, ['checkout', '--', 'README.md']);
    await git(c.folder, ['switch', '-q', '-c', 'feature/x']);
    await assert.rejects(planInstall({ folder: c.folder, ...ANSWERS }, c.deps), /isn't on the main version/);
    await git(c.folder, ['switch', '-q', 'main']);
    await git(c.folder, ['config', 'core.hooksPath', '.husky']);
    await assert.rejects(planInstall({ folder: c.folder, ...ANSWERS }, c.deps), /could make git run a program/);
    await git(c.folder, ['config', '--unset', 'core.hooksPath']);
    await git(c.folder, ['worktree', 'add', '-q', '--detach', path.join(path.dirname(c.folder), 'other-tree')]);
    await assert.rejects(planInstall({ folder: c.folder, ...ANSWERS }, c.deps), /worktrees of its own/);
    // Nothing was registered or written, and the folder's git is its own.
    assert.equal(readLean('shop-front'), null);
    assert.equal(fs.existsSync(path.join(c.userHome, '.copilot')), false);
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isDirectory(), true);
  });
});

test('an install whose adoption is refused or fails leaves nothing registered, and the next one goes ahead', async () => {
  const c = await computer();
  await c.as(async () => {
    const plan = await planInstall({ folder: c.folder, ...ANSWERS }, c.deps);
    // Refused by adoption's checks after the card: the folder went off the main version.
    await git(c.folder, ['switch', '-q', '-c', 'feature/x']);
    await assert.rejects(install({ folder: c.folder, ...ANSWERS, hash: plan.hash }, c.deps), /isn't on the main version/);
    assert.equal(readLean('shop-front'), null);
    assert.equal(projectForFolder(c.folder), null);
    await git(c.folder, ['switch', '-q', 'main']);
    // Failing during the move itself: the git is put back and nothing is registered.
    const failing = async (file, args, options) => (args.includes('reset') ? { code: 1, stdout: '', stderr: 'no', timedOut: false } : hostGuard(file, args, options));
    await assert.rejects(install({ folder: c.folder, ...ANSWERS, hash: plan.hash }, { ...c.deps, run: failing }), /could not be matched/);
    assert.equal(readLean('shop-front'), null);
    assert.equal(projectForFolder(c.folder), null);
    assert.deepEqual(registeredLeanProjects(), []);
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isDirectory(), true, 'the git is back in the folder');
    assert.deepEqual(c.started, [], 'the helper was not started');
    // Then an install goes ahead, and registers the project with the card's answers and the store.
    assert.equal((await install({ folder: c.folder, ...ANSWERS, hash: plan.hash }, c.deps)).ok, true);
    const record = readLean('shop-front');
    assert.deepEqual([record.store, record.test, record.realUsers, record.agent], [storeDir('shop-front'), 'npm test', true, 'copilot']);
    assert.match(record.main, /^[0-9a-f]{40}$/);
  });
});

const recordLine = (fields) => `${JSON.stringify({ card: null, choice: null, commit: null, proof: 'chat-click', by: 'chat', tier: 'lean', ...fields })}\n`;

test('a STOP the folder\'s record leaves on is STOP once the helper is installed', async () => {
  const c = await computer();
  await c.as(async () => {
    const record = path.join(c.folder, '.wheelhouse', 'record');
    fs.mkdirSync(record, { recursive: true });
    fs.writeFileSync(path.join(record, '2026-10-22.jsonl'), recordLine({ at: '2026-10-22T03:00:00Z', kind: 'stop' }));
    await git(c.folder, ['add', '-A']);
    await git(c.folder, ['commit', '-q', '-m', 'Record: stop']);
    const plan = await planInstall({ folder: c.folder, ...ANSWERS }, c.deps);
    assert.equal(plan.lines.at(-1), STOP_CARRIED);
    assert.equal(stopState().on, false, 'planning changes nothing');
    const done = await install({ folder: c.folder, ...ANSWERS, hash: plan.hash }, c.deps);
    assert.deepEqual(done.lines, ['Wheelhouse\'s helper is installed for shop-front', STOP_CARRIED, RUNNING]);
    assert.deepEqual([stopState().on, stopState().by], [true, 'prompt']);
    liftStop();
  });
  // A record whose last line lifts it leaves STOP off, and the plan says nothing of it.
  const d = await computer();
  await d.as(async () => {
    const record = path.join(d.folder, '.wheelhouse', 'record');
    fs.mkdirSync(record, { recursive: true });
    fs.writeFileSync(path.join(record, '2026-10-22.jsonl'), recordLine({ at: '2026-10-22T03:00:00Z', kind: 'stop' })
      + recordLine({ at: '2026-10-22T03:05:00Z', kind: 'lift-stop', card: 'lift-stop', choice: 'Lift STOP' }));
    await git(d.folder, ['add', '-A']);
    await git(d.folder, ['commit', '-q', '-m', 'Record: stop and lift']);
    const plan = await planInstall({ folder: d.folder, ...ANSWERS }, d.deps);
    assert.equal(plan.lines.includes(STOP_CARRIED), false);
    assert.equal((await install({ folder: d.folder, ...ANSWERS, hash: plan.hash }, d.deps)).ok, true);
    assert.equal(stopState().on, false);
  });
});

test('leaving the helper writes the ideas, rulings and designs decided through it into the record, in one commit on main', async () => {
  const c = await computer();
  await c.as(async () => {
    // A design file on main, and a ruling and an idea the record held before the helper.
    const designPath = '.wheelhouse/record/designs/export-orders.md';
    const record = path.join(c.folder, '.wheelhouse', 'record');
    fs.mkdirSync(path.join(record, 'designs'), { recursive: true });
    fs.writeFileSync(path.join(c.folder, ...designPath.split('/')), '# Export orders\nA CSV of the week\'s orders.\n');
    fs.writeFileSync(path.join(record, '2026-10-22.jsonl'), recordLine({ at: '2026-10-22T02:00:00Z', kind: 'idea', card: 'old-idea', text: 'From before the helper' }));
    await git(c.folder, ['add', '-A']);
    await git(c.folder, ['commit', '-q', '-m', 'Record: design and idea']);
    await installed(c, c.folder);
    const before = readLean('shop-front').main;

    // Through the helper: an idea, a ruling confirmed by the chat click, a ruling only proposed, and the design
    // approved in the window.
    let tick = 0;
    const at = () => new Date(Date.parse('2026-10-24T01:00:00.000Z') + 60000 * (tick += 1));
    const put = async (kind, data) => {
      await leanState('shop-front', { run: hostGuard });
      const event = makeEvent({ kind, data, now: at });
      await writeEvent({ project: 'shop-front', event, push: async () => ({ ok: false }), env: {}, now: at });
      return event;
    };
    await put('idea', { key: 'dark-mode', text: 'A darker theme for the evening' });
    const ruling = await put('ruling', { words: 'Every export is a CSV file, never Excel.', card: 'exports-are-csv' });
    const question = `Confirm this ruling?\n${confirmLine(ruling)}`;
    const card = await put('card', { question, header: 'Ruling', options: ['Confirm', 'Not now'], kind: 'confirm', level: 3, line: confirmLine(ruling) });
    await put('card-answer', { card: card.id, label: 'Confirm', hash: crypto.createHash('sha256').update(question).digest('hex'), proof: 'chat-click', tier: 'lean' });
    await put('ruling', { words: 'Only proposed, never confirmed.', card: 'not-confirmed' });
    const docHash = briefHash(fs.readFileSync(path.join(c.folder, ...designPath.split('/')), 'utf8'));
    await put('work', { id: 'export-orders', title: 'Export orders', lane: 'feature', visible: true, dependsOn: [], doc: { path: designPath, hash: docHash } });
    await put('action', { action: 'approve-work', work: 'export-orders', lane: 'feature', hash: docHash, shownFirst: false, question: 'Build export orders?', label: 'Approve', proof: 'window' });

    const plan = await planUninstall({ folder: c.folder, removeState: true }, c.deps);
    assert.equal(plan.lines[1], 'What you decided through the helper, 1 idea, 1 ruling and 1 design, is written into this folder\'s record files in .wheelhouse/record/, in one commit of its own on the main version, so working with git alone still follows it');
    assert.equal((await uninstall({ folder: c.folder, removeState: true, hash: plan.hash }, c.deps)).ok, true);

    // One commit on main after the helper's, holding only the record's day file, and the folder on it with git alone.
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isDirectory(), true);
    assert.equal(await git(c.folder, ['symbolic-ref', 'HEAD']), 'refs/heads/main');
    assert.equal(await git(c.folder, ['rev-parse', 'HEAD~1']), before);
    assert.equal(await git(c.folder, ['diff', '--name-only', before, 'HEAD']), '.wheelhouse/record/2026-10-24.jsonl');
    assert.equal(await git(c.folder, ['status', '--porcelain', '--untracked-files=no']), '');
    // Every line reads as a good Lean line, and keeps the proof the helper's record named.
    const { entries, problems } = readLeanRecord(c.folder);
    assert.deepEqual(problems, []);
    const written = entries.filter((e) => e.file === '.wheelhouse/record/2026-10-24.jsonl').map(({ file, line, at: _at, ...rest }) => rest);
    const blob = await git(c.folder, ['rev-parse', `HEAD:${designPath}`]);
    assert.deepEqual(written, [
      { kind: 'idea', card: 'dark-mode', choice: null, commit: null, proof: 'chat-click', by: 'chat', tier: 'lean', text: 'A darker theme for the evening' },
      { kind: 'ruling', card: 'exports-are-csv', choice: 'Confirm', commit: null, proof: 'chat-click', by: 'chat', tier: 'lean', text: 'Every export is a CSV file, never Excel.' },
      { kind: 'design', card: 'design-export-orders', choice: 'Build it', commit: null, proof: 'window', by: 'chat', tier: 'lean', text: `${designPath} ${blob}` },
    ]);
    // The line the record held before is not written again, and the state went as the director chose.
    assert.equal(entries.filter((e) => e.card === 'old-idea').length, 1);
    assert.equal(fs.existsSync(path.join(c.home, 'projects', 'shop-front')), false);
    // The git-alone playbook's grep for rulings finds the ruling confirmed through the helper.
    assert.match(await git(c.folder, ['grep', '-h', '-e', '"kind":"ruling"', 'main', '--', ':(glob).wheelhouse/record/*.jsonl']), /Every export is a CSV file/);
  });
});

test('with nothing decided through the helper the card says so and no commit is made', async () => {
  const c = await computer();
  await c.as(async () => {
    await installed(c, c.folder);
    const before = readLean('shop-front').main;
    const plan = await planUninstall({ folder: c.folder, removeState: false }, c.deps);
    assert.equal(plan.lines[1], 'Nothing decided through the helper needs writing into this folder\'s record files: it holds no ideas, rulings or designs the record files don\'t');
    assert.equal((await uninstall({ folder: c.folder, removeState: false, hash: plan.hash }, c.deps)).ok, true);
    assert.equal(await git(c.folder, ['rev-parse', 'HEAD']), before);
  });
});

test('a write-back blocked by a record file not committed in the folder changes nothing', async () => {
  const c = await computer();
  await c.as(async () => {
    await installed(c, c.folder);
    const before = readLean('shop-front').main;
    const now = () => new Date('2026-10-24T01:00:00.000Z');
    await leanState('shop-front', { run: hostGuard });
    await writeEvent({ project: 'shop-front', event: makeEvent({ kind: 'idea', data: { key: 'dark-mode', text: 'Darker' }, now }), push: async () => ({ ok: false }), env: {}, now });
    const record = path.join(c.folder, '.wheelhouse', 'record');
    fs.mkdirSync(record, { recursive: true });
    fs.writeFileSync(path.join(record, '2026-10-24.jsonl'), recordLine({ at: '2026-10-24T00:00:00Z', kind: 'stop' }));
    const plan = await planUninstall({ folder: c.folder, removeState: false }, c.deps);
    await assert.rejects(uninstall({ folder: c.folder, removeState: false, hash: plan.hash }, c.deps), /aren't committed, so nothing was written/);
    assert.equal(readLean('shop-front').main, before);
    assert.equal(await git(storeDir('shop-front'), ['rev-parse', 'refs/heads/main']), before);
    assert.equal(fs.lstatSync(path.join(c.folder, '.git')).isFile(), true, 'still in the store');
    assert.equal(fs.readFileSync(path.join(record, '2026-10-24.jsonl'), 'utf8'), recordLine({ at: '2026-10-24T00:00:00Z', kind: 'stop' }));
  });
});
