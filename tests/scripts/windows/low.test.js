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
  lowNode, lowNodePath, labelWorktree, lockReads, LOCK_READS_ROUTE, guardedCommand, selfTest, readSelfTest, guardedReady,
  selfTestFile, needsSelfTest, SELF_TEST_MS,
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

test('the low copy is made once and labelled low', async () => {
  const home = path.join(tempFolder('wh-low-'), 'home');
  const source = fakeNode(64);
  const fake = fakeRun();
  const copy = await lowNode({ run: fake.run, home, execPath: source, env: {} });
  assert.equal(copy, path.join(home, 'windows', 'low-node', 'node.exe'));
  assert.equal(copy, lowNodePath(home));
  assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(source));
  // Only the copy is labelled, never its folder, so a low process can't add files beside it.
  assert.deepEqual(fake.icacls(), [[copy, '/setintegritylevel', 'L']]);

  // Made once: a copy of the same size is kept, and labelled again.
  fs.writeFileSync(copy, Buffer.alloc(64, 1));
  await lowNode({ run: fake.run, home, execPath: source, env: {} });
  assert.deepEqual(fs.readFileSync(copy), Buffer.alloc(64, 1), 'not copied again');
  assert.equal(fake.icacls().length, 2);
  // A Node.js of a different size (another version) is copied again.
  fs.writeFileSync(source, Buffer.alloc(80, 9));
  await lowNode({ run: fake.run, home, execPath: source, env: {} });
  assert.deepEqual(fs.readFileSync(copy), Buffer.alloc(80, 9));
  assert.deepEqual(fs.readdirSync(path.dirname(copy)), ['node.exe'], 'no temporary copy left behind');

  // icacls is Windows' own, from System32, where Windows says it is.
  const sys = fakeRun();
  await lowNode({ run: sys.run, home, execPath: source, env: { SystemRoot: 'C:\\Windows' } });
  assert.equal(sys.calls[0].file, 'C:\\Windows\\System32\\icacls.exe');

  // A label Windows refuses is no low copy.
  const refused = fakeRun({ icacls: () => ({ code: 5, stdout: '', stderr: 'Access is denied.' }) });
  await assert.rejects(lowNode({ run: refused.run, home, execPath: source, env: {} }), /icacls/);
});

// A main checkout's .git folder and a linked worktree of it, as git makes them, with the files
// Wheelhouse protects.
function repository({ vscode = true } = {}) {
  const root = fs.realpathSync(tempFolder('wh-repo-'));
  const common = path.join(root, 'main', '.git');
  const admin = path.join(common, 'worktrees', 'wt-one');
  for (const dir of [admin, path.join(common, 'objects'), path.join(common, 'hooks'), path.join(common, 'refs', 'heads', 'feature'), path.join(common, 'logs', 'refs', 'heads', 'feature'), path.join(common, 'info')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(common, 'config'), '[core]\n');
  const worktree = path.join(root, 'wt');
  fs.mkdirSync(path.join(worktree, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.claude', 'settings.json'), '{}\n');
  fs.writeFileSync(path.join(worktree, '.mcp.json'), '{}\n');
  if (vscode) fs.mkdirSync(path.join(worktree, '.vscode'));
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${admin}\n`);
  fs.writeFileSync(path.join(admin, 'gitdir'), `${path.join(worktree, '.git')}\n`);
  fs.writeFileSync(path.join(admin, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(admin, 'HEAD'), 'ref: refs/heads/feature/one\n');
  return { root, common, admin, worktree };
}

test('a worktree is labelled low, with its .git file, .claude and .mcp.json put back at the normal level', async () => {
  const { common, admin, worktree } = repository();
  const fake = fakeRun();
  await labelWorktree(worktree, { run: fake.run, commonDir: common, env: {} });
  assert.deepEqual(fake.icacls(), [
    [worktree, '/setintegritylevel', '(OI)(CI)L'],
    [path.join(worktree, '.git'), '/setintegritylevel', 'M'],
    [path.join(worktree, '.claude'), '/setintegritylevel', '(OI)(CI)M'],
    [path.join(worktree, '.mcp.json'), '/setintegritylevel', 'M'],
    [path.join(worktree, '.vscode'), '/setintegritylevel', '(OI)(CI)M'],
    // So local git works at low: the worktree's own admin folder, with the files that say where
    // the repository is kept at the normal level, the objects and the feature branches' refs.
    [admin, '/setintegritylevel', '(OI)(CI)L'],
    [path.join(admin, 'commondir'), '/setintegritylevel', 'M'],
    [path.join(admin, 'gitdir'), '/setintegritylevel', 'M'],
    [path.join(common, 'objects'), '/setintegritylevel', '(OI)(CI)L'],
    [path.join(common, 'refs', 'heads', 'feature'), '/setintegritylevel', '(OI)(CI)L'],
    [path.join(common, 'logs', 'refs', 'heads', 'feature'), '/setintegritylevel', '(OI)(CI)L'],
  ]);

  // Only those that exist are put back.
  const bare = repository({ vscode: false });
  fs.rmSync(path.join(bare.worktree, '.mcp.json'));
  const second = fakeRun();
  await labelWorktree(bare.worktree, { run: second.run, commonDir: bare.common, env: {} });
  const targets = second.icacls().map((a) => a[0]);
  assert.ok(!targets.includes(path.join(bare.worktree, '.vscode')));
  assert.ok(!targets.includes(path.join(bare.worktree, '.mcp.json')));
  assert.ok(targets.includes(path.join(bare.worktree, '.claude')));

  // A label Windows refuses fails the labelling, so the run gets the Ask rules.
  let n = 0;
  const refused = fakeRun({ icacls: () => { n += 1; return n === 2 ? { code: 5, stdout: '', stderr: 'Access is denied.' } : ICACLS_OK; } });
  await assert.rejects(labelWorktree(worktree, { run: refused.run, commonDir: common, env: {} }), /icacls/);
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
    await assert.rejects(labelWorktree(worktree, { run: fake.run, commonDir: common, env: {} }), /worktree/, name);
    assert.deepEqual(fake.calls, [], name);
  }
  await assert.rejects(labelWorktree('relative/wt', { run: fakeRun().run, commonDir: common, env: {} }), /worktree/);
});

test('the common folder\'s hooks and config are never labelled', async () => {
  const { common, admin, worktree } = repository();
  // Even a hooks folder and a config inside the worktree's own admin folder stay as they are.
  fs.mkdirSync(path.join(admin, 'hooks'));
  fs.writeFileSync(path.join(admin, 'config.worktree'), '[core]\n');
  const fake = fakeRun();
  await labelWorktree(worktree, { run: fake.run, commonDir: common, env: {} });
  const targets = fake.icacls().map((a) => a[0]);
  for (const kept of [path.join(common, 'hooks'), path.join(common, 'config'), common]) {
    assert.ok(!targets.some((t) => t === kept || t.startsWith(`${path.join(common, 'hooks')}${path.sep}`)), kept);
  }
  // A config.worktree, which git would read, goes back to the normal level with the rest.
  assert.ok(fake.icacls().some((a) => a[0] === path.join(admin, 'config.worktree') && a[2] === 'M'));
  // Nothing is labelled low but the worktree and the folders git writes to.
  const low = fake.icacls().filter((a) => a[2].endsWith('L')).map((a) => a[0]);
  assert.deepEqual(low, [worktree, admin, path.join(common, 'objects'), path.join(common, 'refs', 'heads', 'feature'), path.join(common, 'logs', 'refs', 'heads', 'feature')]);
});

test('with no route to a "no read up" label, nothing is locked and nothing is run', async () => {
  assert.equal(LOCK_READS_ROUTE, null, 'check 52 has confirmed no route yet');
  const fake = fakeRun();
  assert.deepEqual(await lockReads(['/home/a/.wheelhouse/keys', '/home/a/.ssh'], { run: fake.run }), { held: false });
  assert.deepEqual(fake.calls, []);
  // Once check 52 names a route, each folder gets its call, and the lock holds only if every one did.
  const route = { file: 'icacls', args: (p) => [p, '/setintegritylevel', '(OI)(CI)M:NWNR'] };
  const ok = fakeRun();
  assert.deepEqual(await lockReads(['/a', '/b'], { run: ok.run, route, env: {} }), { held: true });
  assert.deepEqual(ok.icacls(), [['/a', '/setintegritylevel', '(OI)(CI)M:NWNR'], ['/b', '/setintegritylevel', '(OI)(CI)M:NWNR']]);
  const one = fakeRun({ icacls: (args) => (args[0] === '/b' ? { code: 5, stdout: '', stderr: 'no' } : ICACLS_OK) });
  assert.deepEqual(await lockReads(['/a', '/b'], { run: one.run, route, env: {} }), { held: false });
  assert.deepEqual(await lockReads([], { run: ok.run, route, env: {} }), { held: false });
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
  const fake = fakeRun({ low: (args) => seen(args) });
  const go = (over = {}) => selfTest({
    run: fake.run, home, worktree: home, now: at(T0), pluginRoot: '/plugins/wheelhouse', execPath, env: {}, homeDir: home, ...over,
  });
  return { home, fake, go };
}
const said = (value) => ({ code: 0, stdout: `npm says nothing here\n${JSON.stringify(value)}\n`, stderr: '' });

test('the self-test is ready only when low starts and the write is held, and for a day', async () => {
  const cases = [
    ['low, write and read held', said({ low: true, writeHeld: true, readHeld: true }), { lowStarts: true, writeHeld: true, keysReadHeld: true }, true],
    ['low, write held, keys readable', said({ low: true, writeHeld: true, readHeld: false }), { lowStarts: true, writeHeld: true, keysReadHeld: false }, true],
    ['low, write allowed', said({ low: true, writeHeld: false, readHeld: true }), { lowStarts: true, writeHeld: false, keysReadHeld: true }, false],
    ['not low', { code: 3, stdout: '', stderr: 'This runner isn\'t at low integrity, so it won\'t run anything.\n' }, { lowStarts: false, writeHeld: false, keysReadHeld: false }, false],
    ['says nothing', { code: 0, stdout: 'hello\n', stderr: '' }, { lowStarts: false, writeHeld: false, keysReadHeld: false }, false],
  ];
  for (const [name, answer, expected, ready] of cases) {
    const { home, fake, go } = selfTestScene(() => answer);
    const result = await go();
    assert.deepEqual(result, { at: new Date(T0).toISOString(), ...expected }, name);
    assert.deepEqual(JSON.parse(fs.readFileSync(selfTestFile(home), 'utf8')), result, `${name}: written to the home`);
    assert.equal(guardedReady({ home, now: at(T0 + HOUR), platform: 'win32' }), ready, name);

    // The runner was started from the low copy, in self-test mode, asked to write in the home and to
    // read a marker placed beside the helper's keys.
    const started = fake.calls.find((c) => nameOf(c.file) !== 'icacls');
    assert.equal(started.file, lowNodePath(home), name);
    const [runner, flag, where, marker] = started.args;
    assert.equal(runner, path.join('/plugins/wheelhouse', 'scripts', 'windows', 'guarded.js'));
    assert.equal(flag, '--self-test');
    assert.equal(where, home);
    assert.equal(path.dirname(marker), path.join(home, 'keys'));
    assert.ok(fs.existsSync(marker), 'the marker is there to be read');
    assert.ok(started.options.timeoutMs <= SELF_TEST_MS, name);
  }

  // Ready for a day, no longer, and never from a time to come; only on Windows.
  const { home, go } = selfTestScene(() => said({ low: true, writeHeld: true, readHeld: false }));
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

test('a self-test that can\'t finish in its time, or whose low copy can\'t be made, is not ready', async () => {
  // Never answers: counted as not ready once its time is up, and tried again at the next start.
  const slow = selfTestScene(() => new Promise(() => {}));
  const late = await slow.go({ timeoutMs: 20 });
  assert.deepEqual(late, { at: new Date(T0).toISOString(), lowStarts: false, writeHeld: false, keysReadHeld: false, timedOut: true });
  assert.equal(guardedReady({ home: slow.home, now: at(T0 + HOUR), platform: 'win32' }), false);
  assert.equal(needsSelfTest({ home: slow.home, now: at(T0 + HOUR) }), true);

  // A label refused (policy, or icacls missing) is not ready, and nothing is started.
  const home = path.join(tempFolder('wh-self-'), 'home');
  const refused = fakeRun({ icacls: () => ({ code: 5, stdout: '', stderr: 'Access is denied.' }) });
  const result = await selfTest({ run: refused.run, home, worktree: home, now: at(T0), pluginRoot: '/p', execPath: fakeNode(), env: {}, homeDir: home });
  assert.equal(result.lowStarts, false);
  assert.ok(refused.calls.every((c) => nameOf(c.file) === 'icacls'));
  assert.equal(guardedReady({ home, now: at(T0 + HOUR), platform: 'win32' }), false);
});
