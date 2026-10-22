// tests/scripts/windows/low.test.js
// Guarded, the low-integrity level for build commands on Windows (design section 12.2): the low
// copy of Node.js, the worktree's labels, the "no read up" route, the runner's command and the
// self-test. Nothing here runs on Windows: every icacls call and the low copy itself go through a
// stand-in `run` that answers as Windows would. The real calls run only in check 52's probe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../../helpers/homes.js';
import {
  lowNode, lowNodePath, lowNodeReady, copyLowNode, labelWorktree, lockReads, LOCK_READS_ROUTE, PLAN_GIT_LOW_LABELS, guardedCommand,
  selfTest, readSelfTest, guardedReady, selfTestFile, needsSelfTest, SELF_TEST_MS,
} from '../../../scripts/windows/low.js';
import { featureAllowRules } from '../../../scripts/protection/settings.js';

const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const at = (ms) => () => new Date(ms);
const ICACLS_OK = { code: 0, stdout: 'processed file: x\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n', stderr: '' };
const nameOf = (file) => path.win32.basename(path.basename(file)).toLowerCase().replace(/\.exe$/, '');

// A stand-in for scripts/lib/run.js: keeps each call and answers icacls as Windows does; `low`
// answers the low copy of Node.js, which is anything that isn't icacls.
function fakeRun({ icacls = () => ICACLS_OK, low = () => ({ code: 0, stdout: '', stderr: '' }) } = {}) {
  const calls = [];
  const run = async (file, args = [], options = {}) => {
    calls.push({ file, args, options });
    return nameOf(file) === 'icacls' ? icacls(args) : low(args, options, file);
  };
  return { run, calls, icacls: () => calls.filter((c) => nameOf(c.file) === 'icacls').map((c) => c.args) };
}

// A stand-in for node.exe of `size` bytes.
function fakeNode(size = 64) {
  const file = path.join(tempFolder('wh-node-'), 'node.exe');
  fs.writeFileSync(file, Buffer.alloc(size, 7));
  return file;
}

// Windows' own folder, where icacls is found.
const WIN = { SystemRoot: 'C:\\Windows' };

test('the low copy is made once, outside any budget, and labelled low', async () => {
  const home = path.join(tempFolder('wh-low-'), 'home');
  const source = fakeNode(64);
  const fake = fakeRun();
  // No copy yet: nothing to label, and nothing is copied here.
  assert.equal(lowNodeReady({ home, execPath: source }), false);
  await assert.rejects(lowNode({ run: fake.run, home, execPath: source, env: WIN }), /no complete copy/);
  assert.equal(fs.existsSync(lowNodePath(home)), false);
  assert.deepEqual(fake.calls, []);

  const copy = copyLowNode({ home, execPath: source, now: at(T0) });
  assert.equal(copy, path.join(home, 'windows', 'low-node', 'node.exe'));
  assert.equal(copy, lowNodePath(home));
  assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(source));
  assert.equal(lowNodeReady({ home, execPath: source }), true);
  assert.equal(await lowNode({ run: fake.run, home, execPath: source, env: WIN }), copy);
  // Only the copy is labelled, never its folder, so a low process can't add files beside it, and
  // icacls is Windows' own, from System32.
  assert.deepEqual(fake.icacls(), [[copy, '/setintegritylevel', 'L']]);
  assert.equal(fake.calls[0].file, 'C:\\Windows\\System32\\icacls.exe');

  // Made once: a copy of the same size is kept.
  fs.writeFileSync(copy, Buffer.alloc(64, 1));
  copyLowNode({ home, execPath: source, now: at(T0) });
  assert.deepEqual(fs.readFileSync(copy), Buffer.alloc(64, 1), 'not copied again');
  // A Node.js of a different size (another version) is copied again, and until it is there the
  // copy isn't ready.
  fs.writeFileSync(source, Buffer.alloc(80, 9));
  assert.equal(lowNodeReady({ home, execPath: source }), false);
  copyLowNode({ home, execPath: source, now: at(T0) });
  assert.deepEqual(fs.readFileSync(copy), Buffer.alloc(80, 9));
  assert.deepEqual(fs.readdirSync(path.dirname(copy)), ['node.exe'], 'no temporary copy left behind');

  // Temporary copies left by a copy that stopped part-way are cleared; a fresh one, which may be
  // another copy still running, is left alone.
  const dir = path.dirname(copy);
  const old = path.join(dir, 'node.exe.0a1b2c.tmp');
  const fresh = path.join(dir, 'node.exe.3d4e5f.tmp');
  fs.writeFileSync(old, 'part');
  fs.writeFileSync(fresh, 'part');
  fs.utimesSync(old, new Date(T0 - HOUR), new Date(T0 - HOUR));
  fs.utimesSync(fresh, new Date(T0), new Date(T0));
  copyLowNode({ home, execPath: source, now: at(T0 + 60 * 1000) });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['node.exe', 'node.exe.3d4e5f.tmp']);

  // A label Windows refuses is no low copy.
  const refused = fakeRun({ icacls: () => ({ code: 5, stdout: '', stderr: 'Access is denied.' }) });
  await assert.rejects(lowNode({ run: refused.run, home, execPath: source, env: WIN }), /icacls/);
  // With no SystemRoot to find icacls by, nothing is run.
  const none = fakeRun();
  for (const env of [{}, { SystemRoot: 'Windows' }, { SystemRoot: '' }]) {
    await assert.rejects(lowNode({ run: none.run, home, execPath: source, env }), /SystemRoot/, JSON.stringify(env));
  }
  assert.deepEqual(none.calls, []);
});

// A main checkout's .git folder and a linked worktree of it, as git makes them, with the files
// Wheelhouse protects.
function repository({ vscode = true, claude = true, mcp = true } = {}) {
  const root = fs.realpathSync(tempFolder('wh-repo-'));
  const common = path.join(root, 'main', '.git');
  const admin = path.join(common, 'worktrees', 'wt-one');
  for (const dir of [admin, path.join(common, 'objects'), path.join(common, 'hooks'), path.join(common, 'refs', 'heads', 'feature'), path.join(common, 'logs', 'refs', 'heads', 'feature'), path.join(common, 'info')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(common, 'config'), '[core]\n');
  const worktree = path.join(root, 'wt');
  fs.mkdirSync(worktree, { recursive: true });
  if (claude) {
    fs.mkdirSync(path.join(worktree, '.claude'));
    fs.writeFileSync(path.join(worktree, '.claude', 'settings.json'), '{}\n');
  }
  if (mcp) fs.writeFileSync(path.join(worktree, '.mcp.json'), '{}\n');
  if (vscode) fs.mkdirSync(path.join(worktree, '.vscode'));
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${admin}\n`);
  fs.writeFileSync(path.join(admin, 'gitdir'), `${path.join(worktree, '.git')}\n`);
  fs.writeFileSync(path.join(admin, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(admin, 'HEAD'), 'ref: refs/heads/feature/one\n');
  return { root, common, admin, worktree };
}

const labels = (fake) => fake.icacls().filter((a) => a[1] === '/setintegritylevel');
// The folders other agents' control files live in, kept at the normal level beside .claude and .vscode (KEPT_NORMAL).
const AGENT_FOLDERS = ['.agents', '.plugin', 'com.github.copilot', '.codex', '.cursor', '.gemini'];
const keptFolderLabels = (root) => AGENT_FOLDERS.map((name) => [path.join(root, name), '/setintegritylevel', '(OI)(CI)M']);

test('a worktree is labelled low, with its .git file, .claude and .mcp.json put back at the normal level', async () => {
  const { common, worktree } = repository();
  const fake = fakeRun();
  await labelWorktree(worktree, { run: fake.run, commonDir: common, env: WIN });
  // .mcp.json's label is looked at first, then the labels go on.
  assert.deepEqual(fake.icacls()[0], [path.join(worktree, '.mcp.json')]);
  assert.deepEqual(labels(fake), [
    [worktree, '/setintegritylevel', '(OI)(CI)L'],
    [path.join(worktree, '.git'), '/setintegritylevel', 'M'],
    [path.join(worktree, '.mcp.json'), '/setintegritylevel', 'M'],
    [path.join(worktree, '.claude'), '/setintegritylevel', '(OI)(CI)M'],
    [path.join(worktree, '.vscode'), '/setintegritylevel', '(OI)(CI)M'],
    ...keptFolderLabels(worktree),
  ]);

  // A label Windows refuses fails the labelling, so the run gets the Ask rules.
  let n = 0;
  const refused = fakeRun({ icacls: () => { n += 1; return n === 3 ? { code: 5, stdout: '', stderr: 'Access is denied.' } : ICACLS_OK; } });
  await assert.rejects(labelWorktree(worktree, { run: refused.run, commonDir: common, env: WIN }), /icacls/);
  // With no SystemRoot to find icacls by, nothing is labelled.
  const none = fakeRun();
  await assert.rejects(labelWorktree(worktree, { run: none.run, commonDir: common, env: {} }), /SystemRoot/);
  assert.deepEqual(none.calls, []);
});

test('a worktree with no .claude, .vscode or .mcp.json gets the two folders, empty and at the normal level', async () => {
  const { common, worktree } = repository({ vscode: false, claude: false, mcp: false });
  const fake = fakeRun();
  await labelWorktree(worktree, { run: fake.run, commonDir: common, env: WIN });
  for (const name of ['.claude', '.vscode', ...AGENT_FOLDERS]) {
    assert.ok(fs.statSync(path.join(worktree, name)).isDirectory(), name);
    assert.deepEqual(fs.readdirSync(path.join(worktree, name)), [], `${name} is empty`);
  }
  assert.equal(fs.existsSync(path.join(worktree, '.mcp.json')), false, 'no .mcp.json is made');
  assert.deepEqual(fake.icacls(), [
    [worktree, '/setintegritylevel', '(OI)(CI)L'],
    [path.join(worktree, '.git'), '/setintegritylevel', 'M'],
    [path.join(worktree, '.claude'), '/setintegritylevel', '(OI)(CI)M'],
    [path.join(worktree, '.vscode'), '/setintegritylevel', '(OI)(CI)M'],
    ...keptFolderLabels(worktree),
  ]);
});

test('a .mcp.json found labelled low is put back at the normal level, and that run asks', async () => {
  const { common, worktree } = repository();
  const mcp = path.join(worktree, '.mcp.json');
  const shown = (low) => ({
    code: 0,
    stdout: `${mcp} BUILTIN\\Users:(I)(RX)\r\n    Mandatory Label\\${low ? 'Low' : 'Medium'} Mandatory Level:(NW)\r\n\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n`,
    stderr: '',
  });
  const low = fakeRun({ icacls: (args) => (args.length === 1 ? shown(true) : ICACLS_OK) });
  await assert.rejects(labelWorktree(worktree, { run: low.run, commonDir: common, env: WIN }), /\.mcp\.json was labelled low/);
  assert.ok(labels(low).some((a) => a[0] === mcp && a[2] === 'M'), 'put back at the normal level all the same');
  // At the normal level, the labelling goes through.
  const medium = fakeRun({ icacls: (args) => (args.length === 1 ? shown(false) : ICACLS_OK) });
  await labelWorktree(worktree, { run: medium.run, commonDir: common, env: WIN });
  // One whose label can't be read fails the labelling.
  const unread = fakeRun({ icacls: (args) => (args.length === 1 ? { code: 5, stdout: '', stderr: 'Access is denied.' } : ICACLS_OK) });
  await assert.rejects(labelWorktree(worktree, { run: unread.run, commonDir: common, env: WIN }), /icacls/);
  assert.deepEqual(labels(unread), [], 'nothing labelled');
});

test('a worktree whose .git doesn\'t point into the common folder\'s worktrees is never labelled', async () => {
  const { root, common, worktree } = repository();
  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  const cases = [
    ['a .git pointing elsewhere', () => fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${elsewhere}\n`)],
    ['a .git folder', () => { fs.rmSync(path.join(worktree, '.git')); fs.mkdirSync(path.join(worktree, '.git')); }],
    ['no .git', () => fs.rmSync(path.join(worktree, '.git'), { recursive: true })],
  ];
  for (const [name, spoil] of cases) {
    spoil();
    const fake = fakeRun();
    await assert.rejects(labelWorktree(worktree, { run: fake.run, commonDir: common, env: WIN }), /worktree/, name);
    assert.deepEqual(fake.calls, [], name);
  }
  await assert.rejects(labelWorktree('relative/wt', { run: fakeRun().run, commonDir: common, env: WIN }), /worktree/);
});

test('only the worktree is labelled: nothing in the common folder, its hooks and config included', async () => {
  const { common, worktree } = repository();
  const fake = fakeRun();
  await labelWorktree(worktree, { run: fake.run, commonDir: common, env: WIN });
  const targets = fake.icacls().map((a) => a[0]);
  assert.ok(targets.every((t) => t === worktree || t.startsWith(`${worktree}${path.sep}`)), targets.join(' '));
  assert.ok(!targets.some((t) => t.startsWith(common)));
  // The plan's git labels are kept, applied nowhere, until check 52 settles them.
  assert.deepEqual(PLAN_GIT_LOW_LABELS.commonFolders, [['objects'], ['refs', 'heads', 'feature'], ['logs', 'refs', 'heads', 'feature']]);
});

test('with no route to a "no read up" label, nothing is locked and nothing is run', async () => {
  assert.equal(LOCK_READS_ROUTE, null, 'check 52 has confirmed no route yet');
  const fake = fakeRun();
  assert.deepEqual(await lockReads(['/home/a/.wheelhouse/keys', '/home/a/.ssh'], { run: fake.run }), { held: false });
  assert.deepEqual(fake.calls, []);
  // Once check 52 names a route, each folder gets its call, and the lock holds only if every one did.
  const route = { file: 'icacls', args: (p) => [p, '/setintegritylevel', '(OI)(CI)M:NWNR'] };
  const ok = fakeRun();
  assert.deepEqual(await lockReads(['/a', '/b'], { run: ok.run, route, env: WIN }), { held: true });
  assert.deepEqual(ok.icacls(), [['/a', '/setintegritylevel', '(OI)(CI)M:NWNR'], ['/b', '/setintegritylevel', '(OI)(CI)M:NWNR']]);
  const one = fakeRun({ icacls: (args) => (args[0] === '/b' ? { code: 5, stdout: '', stderr: 'no' } : ICACLS_OK) });
  assert.deepEqual(await lockReads(['/a', '/b'], { run: one.run, route, env: WIN }), { held: false });
  assert.deepEqual(await lockReads([], { run: ok.run, route, env: WIN }), { held: false });
  // With no SystemRoot to find the program by, nothing is run and nothing is locked.
  const none = fakeRun();
  assert.deepEqual(await lockReads(['/a'], { run: none.run, route, env: {} }), { held: false });
  assert.deepEqual(none.calls, []);
});

test('the runner\'s command is the low copy and the runner, each in an allow rule\'s form', () => {
  const command = guardedCommand({ home: 'C:\\Users\\a b\\.wheelhouse', pluginRoot: 'C:\\plugins\\wheelhouse', platform: 'win32' });
  assert.equal(command, "'C:/Users/a b/.wheelhouse/windows/low-node/node.exe' 'C:/plugins/wheelhouse/scripts/windows/guarded.js'");
  // It is the one allow rule at Guarded.
  const rules = featureAllowRules({ buildCommands: ['npm test'] }, { platform: 'win32', level: 'guarded', guardedCommand: command });
  assert.deepEqual(rules, [`Bash(${command}:*)`]);
  assert.throws(() => guardedCommand({ home: 'C:\\Users\\a%b%\\.wheelhouse', pluginRoot: 'C:\\plugins\\wheelhouse', platform: 'win32' }), /allow rule/);
});

// The self-test's scene: a home, a stand-in node.exe, and a stand-in for the low copy that
// answers the runner's self-test as `seen` says.
function selfTestScene(seen) {
  const home = path.join(tempFolder('wh-self-'), 'home');
  const execPath = fakeNode();
  copyLowNode({ home, execPath });
  const fake = fakeRun({ low: (args) => seen(args) });
  const go = (over = {}) => selfTest({
    run: fake.run, home, worktree: home, now: at(T0), pluginRoot: '/plugins/wheelhouse', execPath, env: WIN, homeDir: home, ...over,
  });
  return { home, fake, go };
}
const said = (value) => ({ code: 0, stdout: `npm says nothing here\n${JSON.stringify(value)}\n`, stderr: '' });

// The scratch folder the runner was given, and what was in it when it was started.
const KEPT = ['.claude', '.vscode', ...AGENT_FOLDERS, '.git', '.mcp.json', 'plugin.json', '.gitattributes'];
function scratchSeen() {
  const seen = { scratch: null, entries: null };
  const answer = (value) => (args) => {
    seen.scratch = args.at(-1);
    seen.entries = fs.existsSync(seen.scratch) ? fs.readdirSync(seen.scratch).sort() : null;
    return said(value);
  };
  return { seen, answer };
}

test('the self-test is ready only when low starts and the write is held, and for a day', async () => {
  const cases = [
    ['low, write, kept entries and read held', said({ low: true, writeHeld: true, readHeld: true, keptHeld: true }), { lowStarts: true, writeHeld: true, keysReadHeld: true }, true],
    ['low, write and kept entries held, keys readable', said({ low: true, writeHeld: true, readHeld: false, keptHeld: true }), { lowStarts: true, writeHeld: true, keysReadHeld: false }, true],
    ['low, write allowed', said({ low: true, writeHeld: false, readHeld: true, keptHeld: true }), { lowStarts: true, writeHeld: false, keysReadHeld: true }, false],
    // A computer where a build can rename or remove .claude, .git or .mcp.json, or write into one,
    // though the write outside is refused: not ready.
    ['low, write held, a kept entry renamed away', said({ low: true, writeHeld: true, readHeld: true, keptHeld: false }), { lowStarts: true, writeHeld: false, keysReadHeld: true }, false],
    ['low, write held, kept entries not said', said({ low: true, writeHeld: true, readHeld: true }), { lowStarts: true, writeHeld: false, keysReadHeld: true }, false],
    ['not low', { code: 3, stdout: '', stderr: 'This runner isn\'t at low integrity, so it won\'t run anything.\n' }, { lowStarts: false, writeHeld: false, keysReadHeld: false }, false],
    ['says nothing', { code: 0, stdout: 'hello\n', stderr: '' }, { lowStarts: false, writeHeld: false, keysReadHeld: false }, false],
  ];
  for (const [name, answer, expected, ready] of cases) {
    const { home, fake, go } = selfTestScene(() => answer);
    const result = await go();
    assert.deepEqual(result, { at: new Date(T0).toISOString(), ...expected }, name);
    assert.deepEqual(JSON.parse(fs.readFileSync(selfTestFile(home), 'utf8')), result, `${name}: written to the home`);
    assert.equal(guardedReady({ home, now: at(T0 + HOUR), platform: 'win32' }), ready, name);

    // The runner was started from the low copy, in self-test mode, asked to write in the home, to
    // read a marker placed beside the helper's keys, and to try the kept entries of a scratch folder.
    const started = fake.calls.find((c) => nameOf(c.file) !== 'icacls');
    assert.equal(started.file, lowNodePath(home), name);
    const [runner, flag, where, marker, scratch] = started.args;
    assert.equal(started.args.length, 5, name);
    assert.equal(path.dirname(scratch), path.join(home, 'windows'), name);
    assert.equal(runner, path.join('/plugins/wheelhouse', 'scripts', 'windows', 'guarded.js'));
    assert.equal(flag, '--self-test');
    assert.equal(where, home);
    assert.equal(path.dirname(marker), path.join(home, 'keys'));
    assert.ok(fs.existsSync(marker), 'the marker is there to be read');
    assert.ok(started.options.timeoutMs <= SELF_TEST_MS, name);
  }

  // Ready for a day, no longer, and never from a time to come; only on Windows.
  const { home, go } = selfTestScene(() => said({ low: true, writeHeld: true, readHeld: false, keptHeld: true }));
  await go();
  assert.equal(guardedReady({ home, now: at(T0 + 23 * HOUR), platform: 'win32' }), true);
  assert.equal(guardedReady({ home, now: at(T0 + 24 * HOUR), platform: 'win32' }), false);
  assert.equal(guardedReady({ home, now: at(T0 - HOUR), platform: 'win32' }), false);
  assert.equal(guardedReady({ home, now: at(T0), platform: 'darwin' }), false);
  assert.equal(readSelfTest({ home, now: at(T0), platform: 'win32' }).keysReadHeld, false);
  assert.equal(needsSelfTest({ home, now: at(T0 + HOUR) }), false);
  assert.equal(needsSelfTest({ home, now: at(T0 + 25 * HOUR) }), true);

  // Anything missing or unreadable is not ready.
  for (const text of [null, 'not json', '[]', '{"at":"yesterday","lowStarts":true,"writeHeld":true}', JSON.stringify({ at: new Date(T0).toISOString(), lowStarts: 'yes', writeHeld: true })]) {
    if (text === null) fs.rmSync(selfTestFile(home));
    else fs.writeFileSync(selfTestFile(home), text);
    assert.equal(guardedReady({ home, now: at(T0 + HOUR), platform: 'win32' }), false, String(text));
  }
  fs.writeFileSync(selfTestFile(home), 'not json');
  assert.equal(needsSelfTest({ home, now: at(T0 + HOUR) }), true, 'an unreadable result is run again');
  assert.equal(guardedReady({ home: path.join(home, 'nowhere'), now: at(T0), platform: 'win32' }), false);
});

test('the self-test labels a scratch folder in the home as a worktree is, for the runner to try, and removes it', async () => {
  const { seen, answer } = scratchSeen();
  const { home, fake, go } = selfTestScene(answer({ low: true, writeHeld: true, readHeld: true, keptHeld: true }));
  // Scratch folders left by a self-test that stopped part-way: an old one is removed, a recent one
  // (perhaps another session start's) is left.
  const windows = path.join(home, 'windows');
  const old = path.join(windows, 'guarded-scratch-0123456789ab');
  const recent = path.join(windows, 'guarded-scratch-ba9876543210');
  for (const [folder, ms] of [[old, T0 - HOUR], [recent, T0 - 60 * 1000]]) {
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    fs.utimesSync(folder, new Date(ms), new Date(ms));
  }
  const result = await go();
  assert.equal(result.writeHeld, true);

  const { scratch } = seen;
  assert.match(path.basename(scratch), /^guarded-scratch-[0-9a-f]{12}$/);
  assert.equal(path.dirname(scratch), windows, 'in the home, never the project');
  assert.deepEqual(seen.entries, [...KEPT].sort(), 'each kept entry was there for the runner');
  // Labelled as labelWorktree labels a worktree: the folder low, each kept entry at the normal level.
  const labels = fake.icacls().filter((a) => a[0] === scratch || a[0].startsWith(`${scratch}${path.sep}`));
  assert.deepEqual(labels, [
    [scratch, '/setintegritylevel', '(OI)(CI)L'],
    [path.join(scratch, '.git'), '/setintegritylevel', 'M'],
    [path.join(scratch, '.mcp.json'), '/setintegritylevel', 'M'],
    [path.join(scratch, 'plugin.json'), '/setintegritylevel', 'M'],
    [path.join(scratch, '.gitattributes'), '/setintegritylevel', 'M'],
    [path.join(scratch, '.claude'), '/setintegritylevel', '(OI)(CI)M'],
    [path.join(scratch, '.vscode'), '/setintegritylevel', '(OI)(CI)M'],
    ...keptFolderLabels(scratch),
  ]);
  // Labelled before the runner started.
  const runnerAt = fake.calls.findIndex((c) => nameOf(c.file) !== 'icacls');
  assert.ok(fake.calls.findIndex((c) => c.args[0] === scratch) < runnerAt);
  assert.equal(fs.existsSync(scratch), false, 'removed afterwards');
  assert.equal(fs.existsSync(old), false, 'an old leftover is removed');
  assert.equal(fs.existsSync(recent), true, 'a recent one is left');

  // A scratch label refused: not ready, the runner never started, and the scratch folder removed.
  const refusing = selfTestScene(() => said({ low: true, writeHeld: true, readHeld: true, keptHeld: true }));
  const scratchRefused = fakeRun({ icacls: (args) => (path.basename(args[0]).startsWith('guarded-scratch-') ? { code: 5, stdout: '', stderr: 'Access is denied.' } : ICACLS_OK) });
  const refusedResult = await selfTest({
    run: scratchRefused.run, home: refusing.home, worktree: refusing.home, now: at(T0), pluginRoot: '/p', execPath: fakeNode(), env: WIN, homeDir: refusing.home,
  });
  assert.equal(refusedResult.writeHeld, false);
  assert.ok(scratchRefused.calls.every((c) => nameOf(c.file) === 'icacls'), 'the runner never started');
  assert.deepEqual(fs.readdirSync(path.join(refusing.home, 'windows')).filter((n) => n.startsWith('guarded-scratch-')), []);
});

test('a self-test that can\'t finish in its time, or whose low copy can\'t be made, is not ready', async () => {
  // Never answers: counted as not ready once its time is up, and tried again at the next start.
  const slow = selfTestScene(() => new Promise(() => {}));
  const late = await slow.go({ timeoutMs: 20 });
  assert.deepEqual(late, { at: new Date(T0).toISOString(), lowStarts: false, writeHeld: false, keysReadHeld: false, timedOut: true });
  assert.equal(guardedReady({ home: slow.home, now: at(T0 + HOUR), platform: 'win32' }), false);
  assert.equal(needsSelfTest({ home: slow.home, now: at(T0 + HOUR) }), true);

  // Labelling the scratch folder never finishes: not ready either, and the runner never started.
  const hung = selfTestScene(() => said({ low: true, writeHeld: true, readHeld: true, keptHeld: true }));
  const hangs = fakeRun({ icacls: (args) => (path.basename(args[0]).startsWith('guarded-scratch-') ? new Promise(() => {}) : ICACLS_OK) });
  const stuck = await selfTest({
    run: hangs.run, home: hung.home, worktree: hung.home, now: at(T0), pluginRoot: '/p', execPath: fakeNode(), env: WIN, homeDir: hung.home, timeoutMs: 20,
  });
  assert.deepEqual(stuck, { at: new Date(T0).toISOString(), lowStarts: false, writeHeld: false, keysReadHeld: false, timedOut: true });
  assert.ok(hangs.icacls().some((a) => path.basename(a[0]).startsWith('guarded-scratch-')), 'it reached the scratch folder');
  assert.ok(hangs.calls.every((c) => nameOf(c.file) === 'icacls'), 'the runner never started');
  assert.equal(guardedReady({ home: hung.home, now: at(T0 + HOUR), platform: 'win32' }), false);

  // A label refused (policy, or icacls missing) is not ready, and nothing is started.
  const home = path.join(tempFolder('wh-self-'), 'home');
  const refused = fakeRun({ icacls: () => ({ code: 5, stdout: '', stderr: 'Access is denied.' }) });
  const execPath = fakeNode();
  copyLowNode({ home, execPath });
  const result = await selfTest({ run: refused.run, home, worktree: home, now: at(T0), pluginRoot: '/p', execPath, env: WIN, homeDir: home });
  assert.equal(result.lowStarts, false);
  assert.ok(refused.calls.every((c) => nameOf(c.file) === 'icacls'));
  assert.equal(guardedReady({ home, now: at(T0 + HOUR), platform: 'win32' }), false);
  // No complete copy yet: not ready, and nothing is run.
  const bare = path.join(tempFolder('wh-self-'), 'home');
  const nothing = fakeRun();
  const early = await selfTest({ run: nothing.run, home: bare, worktree: bare, now: at(T0), pluginRoot: '/p', execPath, env: WIN, homeDir: bare });
  assert.equal(early.lowStarts, false);
  assert.deepEqual(nothing.calls, []);
});
