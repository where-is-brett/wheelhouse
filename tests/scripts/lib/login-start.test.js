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
  loginEntry, installLoginStart, reloadLoginStart, renewedEntry, removeLoginStart, loginStartRecord, needsLoginStart, LAUNCH_AGENT_LABEL, RUN_KEY, RUN_NAME,
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
    assert.deepEqual(reg.calls.map((c) => c.slice(0, 2)), [['launchctl', 'bootout'], ['launchctl', 'bootstrap']], 'no registry call for a launch agent: it is loaded');
    // `made`: the folders the write made, which removing the agent removes too.
    const { made, ...kept } = loginStartRecord();
    assert.deepEqual(kept, { kind: 'launch-agent', path: entry.path, content: entry.content, at: T0.toISOString() });
    assert.ok(made === undefined || made.every((dir) => entry.path.startsWith(dir)));
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

test('a computer needs the sign-in start when any project uses the new engine', () => {
  assert.equal(needsLoginStart({ projects: [{ project: 'a', engine: 'wheelhouse' }, { project: 'b', engine: 'archon' }] }), true);
  assert.equal(needsLoginStart({ projects: [{ project: 'a', engine: 'wheelhouse' }, { project: 'b' }] }), false);
  assert.equal(needsLoginStart({ projects: [] }), false);
  assert.equal(needsLoginStart({}), false);
});

test('removing the launch agent also removes the LaunchAgents and Library folders it made, but never folders already there', onMacPaths, async () => {
  for (const had of [[], ['Library'], ['Library', 'LaunchAgents']]) {
    const userHome = fs.mkdtempSync(path.join(shortHome(), 'user-'));
    if (had.length) fs.mkdirSync(path.join(userHome, ...had), { recursive: true });
    const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
    await as(shortHome(), async () => {
      await installLoginStart({ entry, run: fakeReg().run, now: () => T0 });
      assert.deepEqual(await removeLoginStart({ run: fakeReg().run, platform: 'darwin' }), { removed: true });
      const left = fs.readdirSync(userHome, { recursive: true }).sort();
      assert.deepEqual(left, had.length === 2 ? ['Library', 'Library/LaunchAgents'] : had.length === 1 ? ['Library'] : [], JSON.stringify(had));
    });
  }
});

// The agent as Wheelhouse wrote it before it ran the start command every minute.
const OLD_FORM = (entry) => ({ ...entry, content: entry.content.replace('  <key>StartInterval</key>\n  <integer>60</integer>\n', '') });
const launchctl = (answers = {}) => {
  const calls = [];
  const fake = async (file, args) => {
    calls.push([file, ...args]);
    return { code: answers[args[0]] ?? 0, stdout: '', stderr: answers[args[0]] ? 'launchd said no' : '' };
  };
  return { run: fake, calls };
};

test('the launch agent runs the start command every minute, and the Windows entry stays as it was', onMacPaths, () => {
  const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: shortHome() });
  assert.match(entry.content, /<key>StartInterval<\/key>\n {2}<integer>60<\/integer>/);
  assert.match(entry.content, /<key>RunAtLoad<\/key>/);
  assert.doesNotMatch(loginEntry({ platform: 'win32', node: WIN_NODE, root: WIN_ROOT, script: START_SCRIPT }).content, /StartInterval/);
});

test('an entry this version in this folder would not write is renewed, and one it would asks for nothing', onMacPaths, async () => {
  const userHome = shortHome();
  const here = { platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT };
  await as(shortHome(), async () => {
    assert.equal(renewedEntry(here), null, 'none was made');
    const entry = loginEntry({ ...here, home: userHome });
    await installLoginStart({ entry, run: launchctl().run, now: () => T0 });
    assert.equal(renewedEntry(here), null);
    await installLoginStart({ entry: OLD_FORM(entry), run: launchctl().run, now: () => T0 });
    assert.deepEqual(renewedEntry(here), entry);
    assert.equal(renewedEntry({ ...here, platform: 'win32' }), null, 'made for another system');
    await installLoginStart({ entry, run: launchctl().run, now: () => T0 });
    const moved = renewedEntry({ ...here, root: `${MAC_ROOT}-next` });
    assert.equal(moved.path, entry.path);
    assert.match(moved.content, /v1\.0\.0-next/, 'an update moves the agent to the version running');
  });
});

test('an agent installed now is loaded now, and a refusal stops no install', onMacPaths, async () => {
  const userHome = shortHome();
  await as(shortHome(), async () => {
    const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
    const l = launchctl({ bootstrap: 5 });
    assert.deepEqual(await installLoginStart({ entry, run: l.run, now: () => T0, uid: 501 }), { written: entry.path });
    assert.deepEqual(l.calls, [
      ['launchctl', 'bootout', `gui/501/${LAUNCH_AGENT_LABEL}`],
      ['launchctl', 'bootstrap', 'gui/501', entry.path],
    ]);
    assert.equal(loginStartRecord().content, entry.content);
  });
});

test('reloadLoginStart writes the new entry, loads it, and only then records it', onMacPaths, async () => {
  const userHome = shortHome();
  await as(shortHome(), async () => {
    const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
    await installLoginStart({ entry: OLD_FORM(entry), run: launchctl().run, now: () => T0 });
    const l = launchctl();
    assert.deepEqual(await reloadLoginStart({ run: l.run, entry, uid: 501 }), { reloaded: true });
    assert.deepEqual(l.calls, [
      ['launchctl', 'bootout', `gui/501/${LAUNCH_AGENT_LABEL}`],
      ['launchctl', 'bootstrap', 'gui/501', entry.path],
    ]);
    assert.equal(fs.readFileSync(entry.path, 'utf8'), entry.content);
    assert.equal(loginStartRecord().content, entry.content);
    assert.equal(loginStartRecord().next, undefined, 'nothing is left to do at the next start');
  });
});

test('an agent not loaded yet still gets its new entry', onMacPaths, async () => {
  const userHome = shortHome();
  await as(shortHome(), async () => {
    const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
    await installLoginStart({ entry: OLD_FORM(entry), run: launchctl().run, now: () => T0 });
    assert.deepEqual(await reloadLoginStart({ run: launchctl({ bootout: 3 }).run, entry, uid: 501 }), { reloaded: true });
  });
});

test('a reload launchd refuses says so, tries again at the next start, and uninstall still knows the entry', onMacPaths, async () => {
  const userHome = shortHome();
  await as(shortHome(), async () => {
    const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
    await installLoginStart({ entry: OLD_FORM(entry), run: launchctl().run, now: () => T0 });
    const got = await reloadLoginStart({ run: launchctl({ bootstrap: 5 }).run, entry, uid: 501 });
    assert.equal(got.reloaded, false);
    assert.match(got.why, /launchd said no/);
    assert.equal(loginStartRecord().next, entry.content);
    assert.notEqual(loginStartRecord().content, entry.content, 'so the next start tries again');
    assert.deepEqual(await reloadLoginStart({ run: launchctl().run, entry, uid: 501 }), { reloaded: true }, 'the file already new is no one else\'s change');
    await installLoginStart({ entry: OLD_FORM(entry), run: launchctl().run, now: () => T0 });
    await reloadLoginStart({ run: launchctl({ bootstrap: 5 }).run, entry, uid: 501 });
    assert.deepEqual(await removeLoginStart({ run: launchctl().run, platform: 'darwin', uid: 501 }), { removed: true });
    assert.equal(fs.existsSync(entry.path), false);
  });
});

test('an entry changed by someone else is left and said, and one taken away is not put back', onMacPaths, async () => {
  const userHome = shortHome();
  await as(shortHome(), async () => {
    const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
    await installLoginStart({ entry: OLD_FORM(entry), run: launchctl().run, now: () => T0 });
    fs.writeFileSync(entry.path, `${OLD_FORM(entry).content}<!-- changed -->\n`);
    const l = launchctl();
    const got = await reloadLoginStart({ run: l.run, entry, uid: 501 });
    assert.equal(got.reloaded, false);
    assert.match(got.why, /changed since/);
    assert.deepEqual(l.calls, []);
    assert.match(fs.readFileSync(entry.path, 'utf8'), /changed/);
    fs.rmSync(entry.path);
    assert.equal((await reloadLoginStart({ run: l.run, entry, uid: 501 })).reloaded, false);
    assert.equal(fs.existsSync(entry.path), false);
    assert.deepEqual(l.calls, []);
  });
});

test('a removed agent is unloaded, so nothing starts the helper again', onMacPaths, async () => {
  const userHome = shortHome();
  await as(shortHome(), async () => {
    const entry = loginEntry({ platform: 'darwin', node: MAC_NODE, root: MAC_ROOT, script: START_SCRIPT, home: userHome });
    for (const form of [entry, OLD_FORM(entry)]) {
      await installLoginStart({ entry: form, run: launchctl().run, now: () => T0 });
      const seen = [];
      const run = async (file, args) => {
        seen.push({ call: [file, ...args], there: fs.existsSync(entry.path) });
        return { code: 0, stdout: '', stderr: '' };
      };
      assert.deepEqual(await removeLoginStart({ run, platform: 'darwin', uid: 501 }), { removed: true });
      assert.deepEqual(seen, [{ call: ['launchctl', 'bootout', `gui/501/${LAUNCH_AGENT_LABEL}`], there: true }], 'unloaded while the file is still there');
      assert.equal(fs.existsSync(entry.path), false);
    }
    // A file taken away by hand leaves launchd holding the agent.
    await installLoginStart({ entry, run: launchctl().run, now: () => T0 });
    fs.rmSync(entry.path);
    const gone = launchctl();
    assert.equal((await removeLoginStart({ run: gone.run, platform: 'darwin', uid: 501 })).why, 'it was gone already');
    assert.deepEqual(gone.calls, [['launchctl', 'bootout', `gui/501/${LAUNCH_AGENT_LABEL}`]]);
    // Not loaded, or a launchctl that can't run, stops no uninstall; a changed entry isn't touched.
    await installLoginStart({ entry, run: launchctl().run, now: () => T0 });
    assert.deepEqual(await removeLoginStart({ run: async () => { throw new Error('no launchctl'); }, platform: 'darwin', uid: 501 }), { removed: true });
    await installLoginStart({ entry, run: launchctl().run, now: () => T0 });
    fs.writeFileSync(entry.path, `${entry.content}<!-- changed -->\n`);
    const l = launchctl();
    assert.equal((await removeLoginStart({ run: l.run, platform: 'darwin', uid: 501 })).removed, false);
    assert.deepEqual(l.calls, []);
  });
});
