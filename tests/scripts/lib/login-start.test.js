// tests/scripts/lib/login-start.test.js
// The sign-in start (design section 8.5): a launch agent on macOS, a per-user start-up entry on Windows, written
// by the install of Wheelhouse's helper and removed by uninstall, and none on a work computer. No real launch agent
// or registry entry is ever made: the user's home is a temporary folder and `run` is a stand-in that records what
// it was asked.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { as, shortHome } from '../../helpers/homes.js';
import { run, withoutGitVars } from '../../../scripts/lib/run.js';
import {
  loginEntry, installLoginStart, removeLoginStart, loginStartRecord, LAUNCH_AGENT_LABEL, RUN_KEY, RUN_NAME,
} from '../../../scripts/lib/login-start.js';
import { uninstallPlan } from '../../../scripts/setup/uninstall.js';
import { applyUninstall } from '../../../scripts/setup/uninstall-run.js';
import { START_SCRIPT, startCommand, planInstall, install } from '../../../scripts/agents/copilot/start-helper.js';
import { readLean } from '../../../scripts/lean/project.js';

const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

const T0 = new Date('2026-10-23T01:00:00.000Z');
const MAC_NODE = '/Users/Ann O\'Neil/.local/node/bin/node';
const MAC_ROOT = '/Users/Ann O\'Neil/.copilot/wheelhouse/v1.0.0';
// A Mac's sign-in start written into a real folder needs a Mac's paths for it, so on Windows those
// tests are left to the Mac's run.
const onMacPaths = { skip: process.platform === 'win32' ? 'a Mac\'s launch agent is written into a real folder here' : false };
const WIN_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const WIN_ROOT = 'C:\\Users\\Ann O\'Neil\\.copilot\\wheelhouse\\v1.0.0';

// A stand-in for `run` that answers `reg` as a registry holding `values` would, and records every call; nothing
// real runs.
function fakeReg(values = new Map()) {
  const calls = [];
  const fake = async (file, args) => {
    calls.push([file, ...args]);
    if (file !== 'reg') return { code: 1, stdout: '', stderr: 'not a registry call' };
    const [verb, key, , name] = args;
    if (key !== RUN_KEY) return { code: 1, stdout: '', stderr: 'another key' };
    if (verb === 'add') {
      values.set(name, args[args.indexOf('/d') + 1]);
      return { code: 0, stdout: 'The operation completed successfully.\r\n', stderr: '' };
    }
    if (verb === 'query') {
      if (!values.has(name)) return { code: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.' };
      return { code: 0, stdout: `\r\n${RUN_KEY}\r\n    ${name}    REG_SZ    ${values.get(name)}\r\n\r\n`, stderr: '' };
    }
    if (verb === 'delete') {
      values.delete(name);
      return { code: 0, stdout: 'The operation completed successfully.\r\n', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
  return { run: fake, calls, values };
}

test('the plist runs start-helper with full paths', onMacPaths, async () => {
  const userHome = shortHome();
  const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
  assert.equal(entry.kind, 'launch-agent');
  assert.equal(entry.path, path.join(userHome, 'Library', 'LaunchAgents', 'dev.wheelhouse.helper.plist'));
  assert.equal(LAUNCH_AGENT_LABEL, 'dev.wheelhouse.helper');
  // The program and its arguments, each a full path in a string of its own: no shell reads them, so the space and
  // the apostrophe stay as they are.
  const strings = [...entry.content.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1].replaceAll('&apos;', '\'').replaceAll('&amp;', '&'));
  assert.deepEqual(strings.slice(0, 4), ['dev.wheelhouse.helper', MAC_NODE, `${MAC_ROOT}/scripts/agents/copilot/start-helper.js`, 'start']);
  assert.match(entry.content, /<key>RunAtLoad<\/key>\s*<true\/>/);
  // The helper it starts outlives the start command, so launchd must not end it when the command exits.
  assert.match(entry.content, /<key>AbandonProcessGroup<\/key>\s*<true\/>/);
  assert.doesNotMatch(entry.content, /KeepAlive/);
  // Paths that aren't full paths are refused, and so is a script that isn't named.
  assert.throws(() => loginEntry({ platform: 'darwin', node: 'node', root: MAC_ROOT, script: START_SCRIPT, home: userHome }), /full path/);
  assert.throws(() => loginEntry({ platform: 'darwin', node: MAC_NODE, root: 'wheelhouse', script: START_SCRIPT, home: userHome }), /full path/);
  assert.throws(() => loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, home: userHome }), /script/);
  // No sign-in start is known on another system.
  assert.equal(loginEntry({ platform: 'linux', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome }), null);

  // Installed: the file is written whole, in the user's own LaunchAgents folder, and recorded in Wheelhouse's home.
  const home = shortHome();
  await as(home, async () => {
    const reg = fakeReg();
    await installLoginStart({ entry, run: reg.run, now: () => T0 });
    assert.equal(fs.readFileSync(entry.path, 'utf8'), entry.content);
    assert.deepEqual(reg.calls, [], 'nothing is run to write a launch agent: it loads at the next sign-in');
    assert.deepEqual(loginStartRecord(), { kind: 'launch-agent', path: entry.path, content: entry.content, at: T0.toISOString() });
  });
  // The start command the playbook gives is the same pair the plist runs.
  assert.equal(startCommand({ node: MAC_NODE, root: MAC_ROOT, platform: 'darwin' }), `"${MAC_NODE}" "${MAC_ROOT}/scripts/agents/copilot/start-helper.js"`);
});

test('the Windows entry quotes a path with spaces', async () => {
  const entry = loginEntry({ platform: 'win32', node: WIN_NODE, root: WIN_ROOT, script: START_SCRIPT });
  assert.equal(entry.kind, 'run-entry');
  assert.equal(RUN_KEY, 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run');
  assert.equal(RUN_NAME, 'Wheelhouse helper');
  assert.equal(entry.path, `${RUN_KEY}\\${RUN_NAME}`);
  assert.equal(entry.content, `"${WIN_NODE}" "${WIN_ROOT}\\scripts\\agents\\copilot\\start-helper.js" start`);
  // A path a quote can't keep whole is refused.
  assert.throws(() => loginEntry({ platform: 'win32', node: 'C:\\odd"name\\node.exe', root: WIN_ROOT, script: START_SCRIPT }), /safely/);
  assert.throws(() => loginEntry({ platform: 'win32', node: WIN_NODE, root: 'C:\\two\nlines', script: START_SCRIPT }), /safely/);
  assert.throws(() => loginEntry({ platform: 'win32', node: 'node.exe', root: WIN_ROOT, script: START_SCRIPT }), /full path/);

  // Added for this person only, with `reg add` under HKCU (no admin), the line as one argument.
  const home = shortHome();
  await as(home, async () => {
    const reg = fakeReg();
    await installLoginStart({ entry, run: reg.run, now: () => T0 });
    assert.deepEqual(reg.calls, [['reg', 'add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', entry.content, '/f']]);
    assert.equal(reg.values.get(RUN_NAME), entry.content);
    assert.equal(loginStartRecord().kind, 'run-entry');
    // A `reg add` that fails is said, and nothing is claimed.
    const failing = async () => ({ code: 1, stdout: '', stderr: 'ERROR: Access is denied.' });
    await assert.rejects(installLoginStart({ entry, run: failing, now: () => T0 }), /start-up entry could not be added/);
  });
});

// A git repository on main with one commit, in a folder of its own: a project folder for install.
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com',
};
async function git(cwd, args) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(), env: GIT_ENV });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}
async function projectFolder(parent) {
  const folder = path.join(fs.realpathSync.native(parent), 'shop');
  fs.mkdirSync(folder);
  await git(folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'shop\n');
  await git(folder, ['add', '-A']);
  await git(folder, ['commit', '-q', '-m', 'Start']);
  return folder;
}

test('no entry on a work computer', onMacPaths, async () => {
  const home = shortHome();
  const userHome = shortHome();
  const folder = await projectFolder(shortHome());
  await as(home, async () => {
    const reg = fakeReg();
    const started = [];
    const deps = {
      run: hostGuard, regRun: reg.run, userHome, platform: 'darwin', env: { COPILOT_HOME: path.join(userHome, '.copilot') }, now: () => T0,
      start: async () => { started.push(true); return { ok: true, line: 'Wheelhouse\'s helper is running' }; },
    };
    const answers = { workComputer: true, realUsers: false, test: null };
    const plan = await planInstall({ folder, ...answers }, deps);
    assert.ok(plan.lines.some((l) => /No start-up entry/.test(l) && /work computer/.test(l)), plan.lines.join('\n'));
    assert.ok(!plan.lines.some((l) => /LaunchAgents/.test(l)));
    const done = await install({ folder, hash: plan.hash, ...answers }, deps);
    assert.equal(done.ok, true, done.lines.join('\n'));
    assert.deepEqual(started, [true], 'the helper is started by the command itself');
    assert.equal(fs.existsSync(path.join(userHome, 'Library', 'LaunchAgents')), false, 'no launch agent');
    assert.deepEqual(reg.calls, [], 'no registry call');
    assert.equal(loginStartRecord(), null, 'no sign-in start recorded');
    // The hook file and the project are still installed.
    assert.equal(fs.existsSync(path.join(userHome, '.copilot', 'hooks', 'wheelhouse.json')), true);
    assert.equal(readLean('shop').agent, 'copilot');

    // Not a work computer on Windows: the start-up entry is added, through `reg` alone.
    const plan2 = await planInstall({ folder, workComputer: false, realUsers: false, test: null }, { ...deps, platform: 'win32', node: WIN_NODE, root: WIN_ROOT });
    assert.notEqual(plan2.hash, plan.hash, 'the answer is in the hash');
    assert.ok(plan2.lines.some((l) => /start-up entry named Wheelhouse helper/.test(l)), plan2.lines.join('\n'));
  });
});

test('uninstall removes the entry it made and nothing else', onMacPaths, async () => {
  // macOS: another launch agent in the folder stays, and so does ours once it was changed by someone else.
  const userHome = shortHome();
  const home = shortHome();
  await as(home, async () => {
    const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
    const other = path.join(path.dirname(entry.path), 'com.example.other.plist');
    fs.mkdirSync(path.dirname(entry.path), { recursive: true });
    fs.writeFileSync(other, '<plist/>\n');
    const reg = fakeReg();
    assert.deepEqual(await removeLoginStart({ run: reg.run, platform: 'darwin' }), { removed: false, why: 'none was made' });
    await installLoginStart({ entry, run: reg.run, now: () => T0 });
    assert.deepEqual(await removeLoginStart({ run: reg.run, platform: 'darwin' }), { removed: true });
    assert.equal(fs.existsSync(entry.path), false);
    assert.equal(fs.readFileSync(other, 'utf8'), '<plist/>\n', 'another launch agent is left alone');
    assert.equal(loginStartRecord(), null);
    // Changed since it was made: left, and said.
    await installLoginStart({ entry, run: reg.run, now: () => T0 });
    fs.writeFileSync(entry.path, `${entry.content}<!-- changed -->\n`);
    const left = await removeLoginStart({ run: reg.run, platform: 'darwin' });
    assert.equal(left.removed, false);
    assert.match(left.why, /changed since/);
    assert.equal(fs.existsSync(entry.path), true);
    fs.rmSync(entry.path);
    // A record that names another file is never followed.
    fs.writeFileSync(path.join(home, 'login-start.json'), JSON.stringify({ kind: 'launch-agent', path: other, content: '<plist/>\n', at: T0.toISOString() }));
    assert.equal(loginStartRecord(), null);
    assert.equal((await removeLoginStart({ run: reg.run, platform: 'darwin' })).removed, false);
    assert.equal(fs.existsSync(other), true);
    fs.rmSync(path.join(home, 'login-start.json'));
  });

  // Windows: only the value named Wheelhouse helper, and only while it holds what was written.
  const home2 = shortHome();
  await as(home2, async () => {
    const entry = loginEntry({ platform: 'win32', node: WIN_NODE, root: WIN_ROOT, script: START_SCRIPT });
    const reg = fakeReg(new Map([['OneDrive', '"C:\\OneDrive.exe" /background']]));
    await installLoginStart({ entry, run: reg.run, now: () => T0 });
    reg.calls.length = 0;
    assert.deepEqual(await removeLoginStart({ run: reg.run, platform: 'win32' }), { removed: true });
    assert.deepEqual(reg.calls, [
      ['reg', 'query', RUN_KEY, '/v', RUN_NAME],
      ['reg', 'delete', RUN_KEY, '/v', RUN_NAME, '/f'],
    ]);
    assert.deepEqual([...reg.values.keys()], ['OneDrive'], 'the person\'s other start-up entries stay');
    // Changed by someone else: left.
    await installLoginStart({ entry, run: reg.run, now: () => T0 });
    reg.values.set(RUN_NAME, '"C:\\elsewhere.exe"');
    reg.calls.length = 0;
    const left = await removeLoginStart({ run: reg.run, platform: 'win32' });
    assert.equal(left.removed, false);
    assert.match(left.why, /changed since/);
    assert.deepEqual(reg.calls, [['reg', 'query', RUN_KEY, '/v', RUN_NAME]]);
  });

  // Setup's uninstall of the last project lists the sign-in start when there is one, and only then, and its run
  // removes it.
  const home3 = shortHome();
  const folder = fs.realpathSync.native(shortHome());
  await as(home3, async () => {
    const without = await uninstallPlan({ folder, userHome, platform: 'darwin', run: hostGuard });
    assert.equal(without.changes.some((c) => c.put === 'remove-login-start'), false, 'nothing changes where there is no sign-in start');
    const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
    const reg = fakeReg();
    await installLoginStart({ entry, run: reg.run, now: () => T0 });
    const plan = await uninstallPlan({ folder, userHome, platform: 'darwin', run: hostGuard });
    assert.equal(plan.last, true);
    const listed = plan.changes.filter((c) => c.put === 'remove-login-start');
    assert.deepEqual(listed, [{ phase: 'computer', put: 'remove-login-start', kind: 'launch-agent', target: entry.path }]);
    assert.notEqual(plan.hash, without.hash);
    const done = await applyUninstall({
      folder, plan, now: () => T0, userHome, platform: 'darwin', run: reg.run,
      ops: { stopReceiver: async () => ({ put: true }), stopWatcher: async () => ({ put: true }), stopForeman: async () => ({ put: true }) },
    });
    assert.ok(done.lines.some((l) => /when you sign in/.test(l) && /removed/.test(l)), done.lines.join('\n'));
    assert.equal(fs.existsSync(entry.path), false);
  });
});
