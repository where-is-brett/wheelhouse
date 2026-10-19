// tests/scripts/windows/guarded.test.js
// The Guarded runner (design section 12.2): build commands go through it, run by the low copy of
// Node.js in the feature's worktree. Nothing here runs on Windows: whoami and taskkill go through
// a stand-in `run` that answers as Windows would, and the command itself through a stand-in
// `start`. The real calls run only in check 52's probe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../../helpers/homes.js';
import {
  guarded, isLowToken, fetchesCode, NOT_LOW, ASK_INSTEAD, GUARDED_TIMEOUT_MS, EXIT,
} from '../../../scripts/windows/guarded.js';

const unix = process.platform !== 'win32';

// What `whoami /groups` prints, with the process's own Mandatory Label row.
const groups = (sid, name) => [
  '', 'GROUP INFORMATION', '-----------------', '',
  'Group Name                             Type             SID          Attributes',
  '====================================== ================ ============ ==================================================',
  'Everyone                               Well-known group S-1-1-0      Mandatory group, Enabled by default, Enabled group',
  'BUILTIN\\Users                          Alias            S-1-5-32-545 Mandatory group, Enabled by default, Enabled group',
  `Mandatory Label\\${name} Mandatory Level Label            ${sid}`, '',
].join('\r\n');
const LOW = groups('S-1-16-4096', 'Low');
const MEDIUM = groups('S-1-16-8192', 'Medium');
const WIN_ENV = { PATH: '/bin', SystemRoot: 'C:\\Windows' };
const nameOf = (file) => path.win32.basename(path.basename(file)).toLowerCase().replace(/\.exe$/, '');

// A stand-in for scripts/lib/run.js answering whoami and taskkill, and one for starting the
// command: a process that ends when told to, or with `code` at once.
function scene({ whoami = () => ({ code: 0, stdout: LOW, stderr: '' }), code = 0 } = {}) {
  const calls = [];
  const started = [];
  const said = [];
  const run = async (file, args = [], options = {}) => {
    calls.push({ file, args, options });
    if (nameOf(file) === 'whoami') return whoami();
    if (nameOf(file) === 'taskkill') {
      for (const child of started) if (String(child.pid) === args[1]) setImmediate(() => child.emit('exit', 1, null));
      return { code: 0, stdout: 'SUCCESS', stderr: '' };
    }
    throw new Error(`not expected: ${file}`);
  };
  const start = (file, args, options) => {
    const child = new EventEmitter();
    child.pid = 4100 + started.length;
    child.file = file;
    child.args = args;
    child.options = options;
    started.push(child);
    if (code !== null) setImmediate(() => child.emit('exit', code, null));
    return child;
  };
  const worktree = fs.realpathSync(tempFolder('wh-wt-'));
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: elsewhere\n');
  const go = (words, over = {}) => guarded(words, { run, start, cwd: worktree, env: WIN_ENV, platform: 'darwin', say: (line) => said.push(line), ...over });
  return { calls, started, said, worktree, go };
}

test('the runner refuses to run when its token is not low', async () => {
  for (const [name, whoami] of [
    ['medium', () => ({ code: 0, stdout: MEDIUM, stderr: '' })],
    ['no label row', () => ({ code: 0, stdout: 'GROUP INFORMATION\r\n', stderr: '' })],
    ['low and medium both', () => ({ code: 0, stdout: `${LOW}\r\n${MEDIUM}`, stderr: '' })],
    ['whoami failing', () => ({ code: 1, stdout: LOW, stderr: 'ERROR' })],
    ['whoami missing', () => { throw new Error('spawn whoami ENOENT'); }],
  ]) {
    const s = scene({ whoami });
    assert.equal(await s.go(['npm', 'test']), EXIT.notLow, name);
    assert.deepEqual(s.said, [NOT_LOW], name);
    assert.deepEqual(s.started, [], `${name}: nothing started`);
  }
  assert.equal(NOT_LOW, 'This runner isn\'t at low integrity, so it won\'t run anything.');
  assert.equal(EXIT.notLow, 3);
  // The check comes before anything else, a fetching command's refusal included.
  const s = scene({ whoami: () => ({ code: 0, stdout: MEDIUM, stderr: '' }) });
  assert.equal(await s.go(['npm', 'install']), 3);
  assert.equal(nameOf(s.calls[0].file), 'whoami');
  assert.deepEqual(s.calls[0].args, ['/groups']);
  // whoami is Windows' own, from System32.
  const sys = scene();
  await sys.go(['npm', 'test']);
  assert.equal(sys.calls[0].file, 'C:\\Windows\\System32\\whoami.exe');
  // With no SystemRoot, or one that isn't a full path from a drive letter, whoami is never looked
  // for by a search: the runner refuses, as it does when not low.
  for (const env of [{ PATH: '/bin' }, { PATH: '/bin', SystemRoot: '' }, { PATH: '/bin', SystemRoot: 'Windows' }, { PATH: '/bin', SystemRoot: '\\\\server\\share' }, { PATH: '/bin', SystemRoot: '%WINDIR%' }]) {
    const none = scene();
    assert.equal(await none.go(['npm', 'test'], { env }), EXIT.notLow, JSON.stringify(env));
    assert.deepEqual(none.said, [NOT_LOW]);
    assert.deepEqual(none.calls, [], 'nothing is run');
    assert.deepEqual(none.started, []);
  }
  // Its name in any case, as Windows keeps it.
  const lower = scene();
  await lower.go(['npm', 'test'], { env: { PATH: '/bin', SYSTEMROOT: 'D:\\Win' } });
  assert.equal(lower.calls[0].file, 'D:\\Win\\System32\\whoami.exe');

  assert.equal(isLowToken(LOW), true);
  for (const other of [MEDIUM, '', null, 'S-1-16-40960', groups('S-1-16-12288', 'High')]) assert.equal(isLowToken(other), false, String(other));
});

test('the runner refuses the fetching forms and says to ask', async () => {
  const forms = [
    ['npm', 'install'], ['npm', 'i'], ['npm', 'ci'], ['npm', 'add', 'left-pad'], ['npm', 'update'], ['npm', 'exec', 'x'], ['npx', 'cowsay'],
    ['pnpm', 'add', 'x'], ['pnpm', 'install'], ['pnpm', 'dlx', 'x'], ['yarn', 'add', 'x'], ['yarn', 'install'], ['yarn', 'dlx', 'x'],
    // The same by other spellings: a flag first, a shim's name, a path, and npm's own short forms.
    ['npm', '--silent', 'install'], ['npm.cmd', 'ci'], ['C:/Program Files/nodejs/npm', 'install'], ['NPM', 'Install'],
    ['npm', 'clean-install'], ['npm', 'x', 'y'], ['npx.cmd', 'y'], ['yarn'], ['pnpx', 'y'], ['bunx', 'y'],
  ];
  for (const words of forms) {
    const s = scene();
    assert.equal(fetchesCode(words), true, words.join(' '));
    assert.equal(await s.go(words), EXIT.fetches, words.join(' '));
    assert.equal(s.said.length, 1);
    assert.ok(s.said[0].endsWith(ASK_INSTEAD), s.said[0]);
    assert.deepEqual(s.started, [], words.join(' '));
  }
  assert.equal(ASK_INSTEAD, 'Ask for this with ask --kind build-command.');
  assert.equal(EXIT.fetches, 4);
  // The usual build commands are run.
  for (const words of [['npm', 'test'], ['npm', 'run', 'build'], ['npm', 'run', 'install-check'], ['node', 'x.js'], ['git', 'add', '.'], ['git', 'commit', '-m', 'npm install'], ['pnpm', 'test'], ['yarn', 'test']]) {
    assert.equal(fetchesCode(words), false, words.join(' '));
  }
});

test('the runner leaves local git to run at the normal level, and says to ask for it', async () => {
  for (const words of [['git', 'commit', '-m', 'x'], ['git', 'status'], ['git.exe', 'add', '.'], ['C:/Program Files/Git/cmd/git', 'diff']]) {
    const s = scene();
    assert.equal(await s.go(words), EXIT.fetches, words.join(' '));
    assert.ok(s.said[0].endsWith(ASK_INSTEAD), s.said[0]);
    assert.match(s.said[0], /git/);
    assert.deepEqual(s.started, []);
  }
});

test('the runner points npm\'s cache and the temporary folders inside the worktree', async () => {
  const s = scene({ code: 7 });
  const sub = path.join(s.worktree, 'packages', 'a');
  fs.mkdirSync(sub, { recursive: true });
  // Run from a folder inside the worktree: the folder is the worktree's own, found by its .git.
  assert.equal(await s.go(['npm', 'test'], { cwd: sub }), 7, 'exits with the command\'s code');
  const [child] = s.started;
  const tmp = path.join(s.worktree, '.wheelhouse', 'tmp');
  assert.equal(child.options.env.npm_config_cache, tmp);
  assert.equal(child.options.env.TEMP, tmp);
  assert.equal(child.options.env.TMP, tmp);
  assert.equal(child.options.env.PATH, '/bin', 'the rest of the environment is kept');
  assert.equal(child.options.cwd, sub);
  assert.ok(fs.statSync(tmp).isDirectory());
  assert.equal(child.file, 'npm');
  assert.deepEqual(child.args, ['test']);
  // Nothing to run is a mistake, said plainly.
  const none = scene();
  assert.equal(await none.go([]), EXIT.usage);
  assert.deepEqual(none.started, []);
});

test('on Windows the runner starts an .exe itself and a .cmd through cmd.exe, quoting each word', async () => {
  const bin = fs.realpathSync(tempFolder('wh-bin-'));
  fs.writeFileSync(path.join(bin, 'node.exe'), '');
  fs.writeFileSync(path.join(bin, 'npm.cmd'), '');
  const env = { Path: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD', SystemRoot: 'C:\\Windows' };
  const exists = (file) => fs.existsSync(file);
  const s = scene();
  assert.equal(await s.go(['node', '-e', 'console.log("a %quoted% word")'], { platform: 'win32', env, exists }), 0);
  assert.equal(s.started[0].file, path.join(bin, 'node.exe'));
  assert.deepEqual(s.started[0].args, ['-e', 'console.log("a %quoted% word")'], 'an .exe gets its words as they are');
  assert.equal(await s.go(['npm', 'run', 'build', 'a b&c'], { platform: 'win32', env, exists }), 0);
  const viaCmd = s.started[1];
  assert.equal(viaCmd.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(viaCmd.args, ['/d', '/s', '/c', `"${path.join(bin, 'npm.cmd')} run build "a b&c""`]);
  assert.equal(viaCmd.options.windowsVerbatimArguments, true);
  // A word cmd.exe would expand, even in quotes, is refused rather than passed.
  for (const word of ['%PATH%', 'a"b', 'a\nb']) {
    const r = scene();
    assert.equal(await r.go(['npm', 'run', word], { platform: 'win32', env, exists }), EXIT.usage, word);
    assert.deepEqual(r.started, []);
  }
  // A program that isn't there says so.
  const missing = scene();
  assert.equal(await missing.go(['cargo', 'test'], { platform: 'win32', env, exists }), EXIT.notFound);
  assert.match(missing.said[0], /cargo/);
});

test('a run past the time limit has its whole tree killed', async () => {
  assert.equal(GUARDED_TIMEOUT_MS, 30 * 60 * 1000);
  const s = scene({ code: null });
  const code = await s.go(['npm', 'test'], { timeoutMs: 20 });
  assert.equal(code, EXIT.timedOut);
  const kill = s.calls.find((c) => nameOf(c.file) === 'taskkill');
  assert.deepEqual(kill.args, ['/pid', String(s.started[0].pid), '/T', '/F']);
  assert.match(s.said.at(-1), /30 minutes|time/);
  // A command that ends in time is never killed.
  const quick = scene({ code: 0 });
  assert.equal(await quick.go(['npm', 'test'], { timeoutMs: 1000 }), 0);
  assert.ok(!quick.calls.some((c) => nameOf(c.file) === 'taskkill'));
});

test('in self-test mode the runner tries a write in the home and a read of the marker, and says what Windows did', async () => {
  const home = fs.realpathSync(tempFolder('wh-selfhome-'));
  const marker = path.join(home, 'keys', 'marker.txt');
  fs.mkdirSync(path.dirname(marker));
  fs.writeFileSync(marker, 'marker\n');
  const lines = [];
  const s = scene();
  const out = (line) => lines.push(line);
  assert.equal(await s.go(['--self-test', home, marker], { out }), 0);
  assert.deepEqual(JSON.parse(lines.at(-1)), { low: true, writeHeld: false, readHeld: false });
  assert.deepEqual(fs.readdirSync(home), ['keys'], 'a write that got through is removed');
  assert.deepEqual(s.started, [], 'nothing else is run');

  if (unix && process.getuid?.() !== 0) {
    // Refusals, as a low process meets them, stood in for by the file modes.
    fs.chmodSync(marker, 0o000);
    fs.chmodSync(home, 0o500);
    try {
      lines.length = 0;
      assert.equal(await scene().go(['--self-test', home, marker], { out }), 0);
      assert.deepEqual(JSON.parse(lines.at(-1)), { low: true, writeHeld: true, readHeld: true });
    } finally {
      fs.chmodSync(home, 0o700);
      fs.chmodSync(marker, 0o600);
    }
  }
  // Not low: refused as any command is.
  const medium = scene({ whoami: () => ({ code: 0, stdout: MEDIUM, stderr: '' }) });
  assert.equal(await medium.go(['--self-test', home, marker], { out }), EXIT.notLow);
});
