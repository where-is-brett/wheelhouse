// tests/scripts/agents/copilot-start-helper.test.js
// The one command the person allows on a computer where Copilot builds (rulings P5-16, P5-29, P5-30): plan prints
// the computer's changes and their hash, install makes them on the card's Approve (the hook file, the sign-in
// start, the project registered and moved into the store, the card's answers), start starts the helper and only
// the watchers an agent's built sessions part needs, and uninstall takes away what no other project needs. No real
// launch agent, registry entry, ~/.wheelhouse or ~/.copilot is touched: every home is temporary, the helper's
// client and every spawn are stand-ins, and `reg` is never run.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { as, shortHome } from '../../helpers/homes.js';
import { run, withoutGitVars } from '../../../scripts/lib/run.js';
import { computerId } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { readLean, registerLean } from '../../../scripts/lean/project.js';
import { storeDir } from '../../../scripts/lean/store.js';
import { loginStartRecord } from '../../../scripts/lib/login-start.js';
import { ownKey, readEnrolled } from '../../../scripts/state/signing.js';
import {
  planInstall, install, startAll, uninstall, main, CHANGED, STOP_ON, RUNNING, NOT_STARTED,
} from '../../../scripts/agents/copilot/start-helper.js';

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
    assert.equal(record.helper, true);
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

test('uninstall keeps what another project needs, removes the rest, and leaves the store and the state', async () => {
  const c = await computer();
  const second = path.join(fs.realpathSync.native(shortHome()), 'books');
  fs.mkdirSync(second);
  await git(second, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(second, 'README.md'), 'books\n');
  await git(second, ['add', '-A']);
  await git(second, ['commit', '-q', '-m', 'Start']);
  await c.as(async () => {
    for (const folder of [c.folder, second]) {
      const plan = await planInstall({ folder, ...ANSWERS }, c.deps);
      assert.equal((await install({ folder, ...ANSWERS, hash: plan.hash }, c.deps)).ok, true);
    }
    const hooks = path.join(c.userHome, '.copilot', 'hooks', 'wheelhouse.json');
    const plist = loginStartRecord().path;
    // Under STOP nothing is removed: the guards are what hold it.
    setStop({ by: 'helper', now: () => T0 });
    await assert.rejects(uninstall({ folder: c.folder }, c.deps), (e) => e.message === STOP_ON);
    liftStop();

    const first = await uninstall({ folder: c.folder }, c.deps);
    assert.match(first.lines[0], /stay registered with Copilot, and its sign-in start stays: 1 other project on this computer uses them/);
    assert.equal(fs.existsSync(hooks), true);
    assert.equal(fs.existsSync(plist), true);
    assert.equal(readLean('shop-front').helper, false);
    // The store and the state stay, and the folder still reads its history from the store.
    assert.equal(fs.existsSync(storeDir('shop-front')), true);
    assert.match(first.lines.at(-1), /history and record stay in Wheelhouse's own folder/);
    assert.match(await git(c.folder, ['log', '--oneline', '-1', 'main']), /Start/);

    const last = await uninstall({ folder: second }, c.deps);
    assert.deepEqual(last.lines.slice(0, 2), [
      `Wheelhouse's guards are no longer registered with Copilot: ${hooks} is removed`,
      'What starts Wheelhouse\'s helper when you sign in is removed',
    ]);
    assert.equal(fs.existsSync(hooks), false);
    assert.equal(fs.existsSync(plist), false);
    assert.equal(loginStartRecord(), null);
    assert.equal(fs.existsSync(storeDir('books')), true);
    // A folder that isn't a Lean project has nothing to remove.
    await assert.rejects(uninstall({ folder: c.userHome }, c.deps), /isn't a Lean project/);
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
  });
});
