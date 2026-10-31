// tests/scripts/checks/run.test.js
// A check from start to its word. Most cases stand a small script in for sandbox-exec, so they run on any Unix; the tests
// marked `mac` use the real thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkEnv, developerDir, endCheck, hostlessTests, runCheck, secondTryOf, toolHomes } from '../../../scripts/checks/run.js';
import { dueChecks, withCheckTurn } from '../../../scripts/checks/queue.js';
import { commandDigest, writeCheck } from '../../../scripts/checks/record.js';
import { checkPaths } from '../../../scripts/checks/folder.js';
import { safeGit } from '../../../scripts/lib/safe-git.js';
import { makeSigningKey, enrol, verify, readEnrolled } from '../../../scripts/state/signing.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

const mac = { skip: process.platform !== 'darwin' };
const unix = { skip: process.platform === 'win32' };

async function withHome(fn) {
  const home = path.join(tempFolder('wh-run-'), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

async function source() {
  const remote = await makeBareRemote();
  const work = path.join(remote.root, 'work');
  await g(remote.root, 'clone', '-q', remote.url, work);
  await g(work, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-qm', 'one');
  await g(work, 'push', '-q', 'origin', 'main');
  await g(remote.url, 'config', '--unset', 'receive.autogc');
  return { url: remote.url, commit: await g(work, 'rev-parse', 'HEAD') };
}

// Stands in for sandbox-exec: refuses a profile holding "broken", else runs what it was given.
function standIn() {
  const file = path.join(tempFolder('wh-stand-in-'), 'sandbox-exec');
  fs.writeFileSync(file, `#!/bin/sh
case "$2" in *broken*) echo 'sandbox-exec: syntax error in the profile' >&2; exit 65;; esac
shift 2
exec "$@"
`, { mode: 0o755 });
  return file;
}

const settings = (testCommand, extra = {}) => ({ testCommand, prepare: null, minutes: 1, network: false, where: null, ...extra });

async function check(testCommand, { extra = {}, ...options } = {}) {
  const s = await source();
  const out = path.join(tempFolder('wh-marks-'), 'marks');
  const command = testCommand.replaceAll('MARKS', out);
  const given = { ...extra, ...(extra.prepare ? { prepare: extra.prepare.replaceAll('MARKS', out) } : {}) };
  const result = await runCheck({ project: 'p', commit: s.commit, main: false, settings: settings(command, given), source: s.url, platform: 'darwin', sandbox: standIn(), ...options });
  return { ...result, runs: fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).length : 0, marks: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '', digest: commandDigest(command) };
}

test('a pass gives passed, with the commit and the command\'s digest', unix, async () => {
  await withHome(async () => {
    const got = await check('echo hello; echo ran >> MARKS');
    assert.equal(got.result, 'passed');
    assert.match(got.commit, /^[0-9a-f]{40}$/);
    assert.equal(got.command, got.digest);
    assert.match(got.tail, /hello/);
    assert.equal(got.runs, 1);
    assert.ok(typeof got.minutes === 'number' && got.minutes >= 0);
  });
});

test('a red result runs once more and a second red is failed', unix, async () => {
  await withHome(async () => {
    const got = await check('echo ran >> MARKS; exit 3');
    assert.equal(got.result, 'failed');
    assert.equal(got.runs, 2);
  });
});

test('a red then green is passed', unix, async () => {
  await withHome(async () => {
    const got = await check('echo ran >> MARKS; test "$(wc -l < MARKS)" -ge 2');
    assert.equal(got.result, 'passed');
    assert.equal(got.runs, 2);
  });
});

test('a timeout has no second try', unix, async () => {
  await withHome(async () => {
    const got = await check('echo ran >> MARKS; sleep 30', { limitMs: 400 });
    assert.equal(got.result, 'timed-out');
    assert.equal(got.runs, 1);
  });
});

test('a file a test left where the temporary folder goes is put right, and the check still runs', unix, async () => {
  await withHome(async () => {
    const got = await check('echo x > "$HOME/tmp/a" && rm -rf "$HOME/tmp" && : > "$HOME/tmp"');
    assert.equal(got.result, 'passed');
    const again = await check('echo x > "$TMPDIR/a"');
    assert.equal(again.result, 'passed');
  });
});

test('a check keeps a short list of what it was given, so an unnamed secret never reaches it', () => {
  const kept = checkEnv({ PATH: '/bin', LANG: 'en_AU.UTF-8', LC_ALL: 'C', NVM_DIR: '/n', OAUTH_TOKEN: 'a', OPENAI_API_KEY: 'b', AWS_SECRET_ACCESS_KEY: 'c', NPM_TOKEN: 'd', DATABASE_URL: 'e', SSH_AUTH_SOCK: 'f', HOME: '/h' });
  assert.deepEqual(kept, { PATH: '/bin', LANG: 'en_AU.UTF-8', LC_ALL: 'C', NVM_DIR: '/n' });
});

test('a variable holding a secret doesn\'t reach a check\'s command', unix, async () => {
  await withHome(async () => {
    process.env.OAUTH_TOKEN = 'the-token';
    try {
      const got = await check('env >> MARKS');
      assert.equal(got.result, 'passed');
      assert.doesNotMatch(got.marks, /OAUTH_TOKEN|the-token/);
      assert.match(got.marks, /^PATH=/m);
    } finally {
      delete process.env.OAUTH_TOKEN;
    }
  });
});

test('a stall on the run after a red one is timed-out, never red', unix, async () => {
  await withHome(async () => {
    const got = await check('if [ -f MARKS ]; then sleep 30; else echo ran > MARKS; exit 1; fi', { limitMs: 400 });
    assert.equal(got.result, 'timed-out');
  });
});

test('the time limit is kept even when something still holds the output open', unix, async () => {
  await withHome(async () => {
    const started = Date.now();
    const got = await check('(setsid sleep 20 2>/dev/null || perl -e "use POSIX; POSIX::setsid(); sleep 20") & sleep 20', { limitMs: 400, graceMs: 300 });
    assert.equal(got.result, 'timed-out');
    assert.ok(Date.now() - started < 10000, 'it stopped waiting');
  });
});

const LEFT_BEHIND = '(setsid sleep 20 2>/dev/null || perl -e "use POSIX; POSIX::setsid(); sleep 20") &';

test('a job left holding the output doesn\'t turn a finished test into timed-out', unix, async () => {
  await withHome(async () => {
    const started = Date.now();
    const got = await check(`${LEFT_BEHIND} exit 0`, { limitMs: 15000, graceMs: 300 });
    assert.equal(got.result, 'passed', got.tail);
    assert.ok(Date.now() - started < 10000, 'it stopped waiting');
  });
});

test('a red test with a job left holding the output stays red', unix, async () => {
  await withHome(async () => {
    const got = await check(`echo ran >> MARKS; ${LEFT_BEHIND} exit 3`, { limitMs: 15000, graceMs: 300 });
    assert.equal(got.result, 'failed', got.tail);
    assert.equal(got.runs, 2);
  });
});

test('endCheck reaches a check while its folder is being prepared', unix, async () => {
  await withHome(async () => {
    let reached;
    const preparing = new Promise((resolve) => { reached = resolve; });
    let carry;
    const held = new Promise((resolve) => { carry = resolve; });
    const git = (options) => {
      const inner = safeGit(options);
      return async (args, more) => {
        if (args[0] === 'fetch') { reached(); await held; }
        return inner(args, more);
      };
    };
    const running = check('echo ran >> MARKS', { git });
    await preparing;
    assert.equal(endCheck('p'), true);
    carry();
    const got = await running;
    assert.equal(got.result, 'could-not-run');
    assert.equal(got.runs, 0, 'the command never ran');
  });
});

test('output past 64 KB keeps the end', unix, async () => {
  await withHome(async () => {
    const got = await check('i=0; while [ $i -lt 1500 ]; do printf "%0100d\\n" $i; i=$((i+1)); done; echo the end');
    assert.ok(got.tail.length <= 64 * 1024 + 1024);
    assert.ok(got.tail.length > 60 * 1024, String(got.tail.length));
    assert.match(got.tail, /the end\s*$/);
  });
});

test('no sandbox-exec is could-not-run and the command never runs', unix, async () => {
  await withHome(async () => {
    const got = await check('echo ran >> MARKS', { sandbox: '/nowhere/sandbox-exec' });
    assert.equal(got.result, 'could-not-run');
    assert.equal(got.runs, 0);
  });
});

test('a broken profile is could-not-run and the command never runs', unix, async () => {
  await withHome(async () => {
    const got = await check('echo ran >> MARKS', { profile: () => '(broken' });
    assert.equal(got.result, 'could-not-run');
    assert.equal(got.runs, 0);
  });
});

test('Windows and Linux are could-not-run and the command never runs', async () => {
  await withHome(async () => {
    for (const platform of ['win32', 'linux']) {
      const got = await runCheck({ project: 'p', commit: 'a'.repeat(40), main: false, settings: settings('exit 0'), source: '/nowhere', platform });
      assert.equal(got.result, 'could-not-run', platform);
    }
  });
});

test('a commit that can\'t be fetched is could-not-run', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const got = await runCheck({ project: 'p', commit: 'f'.repeat(40), main: false, settings: settings('exit 0'), source: s.url, platform: 'darwin', sandbox: standIn() });
    assert.equal(got.result, 'could-not-run');
  });
});

test('a tool refused by macOS for a sandbox inside a sandbox is could-not-run, not red', unix, async () => {
  await withHome(async () => {
    const got = await check('echo ran >> MARKS; echo "sandbox_apply: Operation not permitted" >&2; exit 1');
    assert.equal(got.result, 'could-not-run');
    assert.equal(got.runs, 1);
  });
});

test('prepare runs before the tests, and a failed prepare could not run, so it isn\'t red', unix, async () => {
  await withHome(async () => {
    const good = await check('echo tests >> MARKS', { extra: { prepare: 'echo prepare >> MARKS' } });
    assert.equal(good.result, 'passed');
    assert.equal(good.marks, 'prepare\ntests\n');
  });
  await withHome(async () => {
    const bad = await check('echo tests >> MARKS', { extra: { prepare: 'exit 4' } });
    assert.equal(bad.result, 'could-not-run');
    assert.equal(bad.runs, 0);
  });
});

test('a prepare that runs out of time could not run, so it isn\'t red', unix, async () => {
  await withHome(async () => {
    const got = await check('echo tests >> MARKS', { extra: { prepare: 'sleep 30' }, limitMs: 300 });
    assert.equal(got.result, 'could-not-run');
    assert.equal(got.runs, 0);
  });
});

test('the check runs in its own home, with a temporary folder of its own and no key in reach', unix, async () => {
  await withHome(async () => {
    const before = process.env.GH_TOKEN;
    process.env.GH_TOKEN = 'a-token';
    try {
      const got = await check('echo "home=$HOME tmp=$TMPDIR token=[$GH_TOKEN] pwd=$(pwd)"; test -d "$TMPDIR"');
      assert.equal(got.result, 'passed', got.tail);
      const { home, tree } = checkPaths('p');
      const real = fs.realpathSync(path.dirname(tree));
      assert.ok(got.tail.includes(`home=${path.join(real, path.basename(home))} `));
      assert.ok(got.tail.includes(`tmp=${path.join(real, path.basename(home), 'tmp')} `));
      assert.ok(got.tail.includes('token=[]'));
      assert.ok(got.tail.includes(`pwd=${path.join(real, 'tree')}`));
    } finally {
      if (before === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = before;
    }
  });
});

test('a main-line check has main-home for its home', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const got = await runCheck({ project: 'p', commit: s.commit, main: true, settings: settings('echo "home=$HOME"'), source: s.url, platform: 'darwin', sandbox: standIn() });
    assert.ok(got.tail.includes(path.join(fs.realpathSync(checkPaths('p').root), 'main-home')));
  });
});

test('the profile names the stage and only prepare has the network', unix, async () => {
  await withHome(async () => {
    const seen = [];
    const got = await check('exit 0', { extra: { prepare: 'exit 0' }, profile: (args) => { seen.push(args); return '(version 1)'; } });
    assert.equal(got.result, 'passed');
    assert.deepEqual(seen.map((a) => a.stage), ['prepare', 'test']);
    assert.equal(seen[1].network, false);
    assert.ok(seen[0].denied.length > 0);
  });
});

test('checks.network reaches the tests\' profile', unix, async () => {
  await withHome(async () => {
    const seen = [];
    await check('exit 0', { extra: { network: true }, profile: (args) => { seen.push(args); return '(version 1)'; } });
    assert.equal(seen[0].network, true);
  });
});

test('endCheck ends a child that started a child, and the result is could-not-run', unix, async () => {
  await withHome(async () => {
    const pidFile = path.join(tempFolder('wh-pid-'), 'pid');
    const running = check(`sh -c 'sleep 30 & echo $! > ${pidFile}; wait' ; sleep 30`);
    for (let i = 0; i < 200 && !fs.existsSync(pidFile); i += 1) await new Promise((r) => { setTimeout(r, 50); });
    const grandchild = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.equal(endCheck('p'), true);
    const got = await running;
    assert.equal(got.result, 'could-not-run');
    await new Promise((r) => { setTimeout(r, 200); });
    assert.throws(() => process.kill(grandchild, 0), { code: 'ESRCH' });
  });
});

test('a job a test leaves running ends with the check', unix, async () => {
  await withHome(async () => {
    const pidFile = path.join(tempFolder('wh-pid-'), 'pid');
    const got = await check(`nohup sleep 30 >/dev/null 2>&1 &\necho $! > ${pidFile}\nexit 0`);
    assert.equal(got.result, 'passed', got.tail);
    await new Promise((r) => { setTimeout(r, 200); });
    assert.throws(() => process.kill(Number(fs.readFileSync(pidFile, 'utf8').trim()), 0), { code: 'ESRCH' });
  });
});

test('endCheck with nothing running says so', () => {
  assert.equal(endCheck('nothing-running'), false);
});

test('a signal stops a check as endCheck does', unix, async () => {
  await withHome(async () => {
    const stop = new AbortController();
    const running = check('sleep 30', { signal: stop.signal });
    setTimeout(() => stop.abort(), 300);
    assert.equal((await running).result, 'could-not-run');
  });
});

// --- not counting ---

test('a failing command gives not-counted, with no second try', unix, async () => {
  await withHome(async () => {
    const marks = path.join(tempFolder('wh-marks-'), 'marks');
    const got = await check(`echo ran >> '${marks}'; exit 1`, { extra: { notCounting: true } });
    assert.equal(got.result, 'not-counted');
    assert.equal(fs.readFileSync(marks, 'utf8'), 'ran\n');
  });
});

test('a head that passes while tests aren\'t counting gives not-counted, and the main line keeps its pass', unix, async () => {
  await withHome(async () => {
    assert.equal((await check('exit 0', { extra: { notCounting: true } })).result, 'not-counted');
    const s = await source();
    const got = await runCheck({ project: 'p', commit: s.commit, main: true, settings: settings('exit 0', { notCounting: true }), source: s.url, platform: 'darwin', sandbox: standIn() });
    assert.equal(got.result, 'passed');
    assert.equal(got.clean, true);
  });
});

test('a check that couldn\'t run while tests aren\'t counting holds nothing up, unless All stop ended it', unix, async () => {
  await withHome(async () => {
    assert.equal((await check('exit 0', { extra: { notCounting: true }, sandbox: '/no/such/sandbox' })).result, 'not-counted');
    const controller = new AbortController();
    controller.abort();
    const s = await source();
    const got = await runCheck({ project: 'p', commit: s.commit, main: false, settings: settings('exit 0', { notCounting: true }), source: s.url, platform: 'darwin', sandbox: standIn(), signal: controller.signal });
    assert.equal(got.result, 'could-not-run');
  });
});

test('no command gives a record with command null, and runs nothing', async () => {
  const commit = 'a'.repeat(40);
  const got = await runCheck({ project: 'p', commit, main: true, settings: settings(null, { notCounting: true }), platform: 'linux' });
  assert.deepEqual(got, { commit, command: null, result: 'not-counted', minutes: 0, tail: '', clean: true });
});

// --- tools, and what a red result can say ---

test('a tool that isn\'t found is could-not-run, never red, with no second try, and says so', unix, async () => {
  await withHome(async () => {
    const marks = path.join(tempFolder('wh-marks-'), 'marks');
    const got = await check(`echo ran >> '${marks}'; no-such-tool-here --version`);
    assert.equal(got.result, 'could-not-run');
    assert.equal(fs.readFileSync(marks, 'utf8'), 'ran\n');
    assert.match(got.tail, /tool this project needs/);
  });
});

test('a tool the sandbox refuses to start is could-not-run too', unix, async () => {
  await withHome(async () => {
    assert.equal((await check('exit 126')).result, 'could-not-run');
  });
});

test('a test server on the engine room\'s port reads red, and says why', unix, async () => {
  await withHome(async () => {
    const got = await check('echo "connect EPERM 127.0.0.1:3090"; exit 1');
    assert.equal(got.result, 'failed');
    assert.match(got.tail, /3090 is kept for Wheelhouse/);
  });
});

test('a red result with no port in it has no such line', unix, async () => {
  await withHome(async () => {
    assert.doesNotMatch((await check('echo "3 tests failed"; exit 1')).tail, /kept for Wheelhouse/);
  });
});

test('where a version manager keeps its tools is kept, and what could break prepare or send a key elsewhere isn\'t', () => {
  const kept = checkEnv({
    SWIFTLY_HOME_DIR: '/a', SWIFTLY_BIN_DIR: '/a/bin', SWIFTLY_TOOLCHAINS_DIR: '/t', ASDF_DATA_DIR: '/b', ASDF_DIR: '/b2', MISE_DATA_DIR: '/c', PNPM_HOME: '/d', BUN_INSTALL: '/e', DENO_INSTALL: '/f', FNM_DIR: '/g', FNM_MULTISHELL_PATH: '/h',
    RUSTUP_HOME: '/r', CARGO_HOME: '/x', HTTP_PROXY: 'http://u:p@proxy', https_proxy: 'http://u:p@proxy', ALL_PROXY: 'socks://proxy', NO_PROXY: 'x',
  });
  for (const name of ['SWIFTLY_HOME_DIR', 'SWIFTLY_BIN_DIR', 'SWIFTLY_TOOLCHAINS_DIR', 'ASDF_DATA_DIR', 'ASDF_DIR', 'MISE_DATA_DIR', 'PNPM_HOME', 'BUN_INSTALL', 'DENO_INSTALL', 'FNM_DIR', 'FNM_MULTISHELL_PATH', 'RUSTUP_HOME']) assert.ok(name in kept, name);
  for (const name of ['CARGO_HOME', 'HTTP_PROXY', 'https_proxy', 'ALL_PROXY', 'NO_PROXY']) assert.ok(!(name in kept), name);
});

test('a version manager\'s home is named where the check\'s own HOME would hide it', () => {
  const got = toolHomes({ env: { VOLTA_HOME: '/mine' }, userHome: '/Users/d', exists: (p) => ['/Users/d/.rustup', '/Users/d/.asdf', '/Users/d/.volta'].includes(p) });
  assert.deepEqual(got, { RUSTUP_HOME: '/Users/d/.rustup', ASDF_DATA_DIR: '/Users/d/.asdf' });
});

// --- a job a test leaves behind, in a session of its own, which the end of the process group misses ---

// A command that starts a job in its own session, which tries to write `target` for as long as it lives, and leaves.
const leavesJob = (target, mark) => `perl -e 'use POSIX; exit 0 if fork; POSIX::setsid(); exit 0 if fork; open(STDIN, "<", "/dev/null"); open(STDOUT, ">", "/dev/null"); open(STDERR, ">", "/dev/null"); for (1..400) { for my $f (glob("${target}")) { if (open(O, ">>", $f)) { print O "planted\\n"; close(O); } } select(undef, undef, undef, 0.05); }' ; echo left > '${mark}' 2>/dev/null; exit 0`;

test('a job one work left can\'t write another work\'s tree during its check, though it can name the file', mac, async () => {
  await withHome(async () => {
    const s = await source();
    fs.mkdirSync(checkPaths('p').root, { recursive: true });
    const root = fs.realpathSync(checkPaths('p').root);
    const named = checkPaths('p', { work: 'b' }).tree.replace(checkPaths('p').root, root);
    const left = await runCheck({ project: 'p', commit: s.commit, main: false, work: 'a', settings: settings(leavesJob(`${named}/a.txt`, '/private/tmp/wh-left')), source: s.url });
    assert.equal(left.result, 'passed', left.tail);
    const got = await runCheck({ project: 'p', commit: s.commit, main: false, work: 'b', settings: settings('sleep 3; ! grep -q planted a.txt'), source: s.url });
    assert.equal(got.result, 'passed', got.tail);
  });
});

test('a job a head left does write its own work\'s tree, which is why only the main line\'s clean check stands', mac, async () => {
  await withHome(async () => {
    const s = await source();
    fs.mkdirSync(checkPaths('p').root, { recursive: true });
    const root = fs.realpathSync(checkPaths('p').root);
    const named = checkPaths('p', { work: 'a' }).tree.replace(checkPaths('p').root, root);
    await runCheck({ project: 'p', commit: s.commit, main: false, work: 'a', settings: settings(leavesJob(`${named}/a.txt`, '/private/tmp/wh-left')), source: s.url });
    const got = await runCheck({ project: 'p', commit: s.commit, main: false, work: 'a', settings: settings('sleep 3; grep -q planted a.txt'), source: s.url });
    assert.equal(got.result, 'passed', got.tail);
  });
});

// --- hosted Xcode tests ---

const XCODE = "xcodebuild test -scheme App -destination 'platform=macOS' -derivedDataPath .build/checks -IDEPackageSupportDisableManifestSandbox=YES CODE_SIGNING_ALLOWED=NO";

test('secondTryOf builds for testing with no test host, then runs each test bundle itself', () => {
  const second = secondTryOf(XCODE);
  assert.match(second, /xcodebuild build-for-testing -scheme App/);
  assert.doesNotMatch(second, /xcodebuild test/);
  assert.match(second, / TEST_HOST= BUNDLE_LOADER= /);
  assert.match(second, /\.build\/checks\/Build\/Products/);
  assert.match(second, /xcrun xctest/);
  assert.match(second, /CODE_SIGNING_ALLOWED=NO/);
});

test('secondTryOf has nothing for a command that isn\'t xcodebuild test', () => {
  assert.equal(secondTryOf('swift test --disable-sandbox'), null);
  assert.equal(secondTryOf('npm test'), null);
  assert.equal(secondTryOf('xcodebuild build -scheme App'), null);
  assert.equal(secondTryOf('xcodebuild test -scheme App; rm -rf x'), null);
});

// A stand-in `xcodebuild` and `xcrun`: `test` is refused as the sandbox refuses it, and the rest answers as told.
function fakeXcode(xctestExit, marks) {
  const bin = tempFolder('wh-fake-xcode-');
  fs.writeFileSync(path.join(bin, 'xcodebuild'), `#!/bin/sh
echo "xcodebuild $1" >> '${marks}'
case "$1" in
  test) echo 'xcodebuild: error: Failed to prevent system sleep during UI testing.' >&2; exit 70;;
esac
mkdir -p .build/checks/Build/Products/Debug/One.xctest
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'xcrun'), `#!/bin/sh\necho "xcrun $*" >> '${marks}'\nexit ${xctestExit}\n`, { mode: 0o755 });
  return bin;
}

async function xcodeCheck(xctestExit) {
  const marks = path.join(tempFolder('wh-marks-'), 'marks');
  const before = process.env.PATH;
  process.env.PATH = `${fakeXcode(xctestExit, marks)}:${before}`;
  try {
    const s = await source();
    const got = await runCheck({ project: 'p', commit: s.commit, main: false, settings: settings(XCODE), source: s.url, platform: 'darwin', sandbox: standIn() });
    return { ...got, marks: fs.readFileSync(marks, 'utf8') };
  } finally {
    process.env.PATH = before;
  }
}

test('hosted tests the sandbox refuses get the second try, and its pass counts', unix, async () => {
  await withHome(async () => {
    const got = await xcodeCheck(0);
    assert.equal(got.result, 'passed');
    assert.match(got.marks, /xcodebuild test\nxcodebuild build-for-testing\nxcrun xctest/);
  });
});

test('hosted tests that fail on the second try are could-not-run, never red', unix, async () => {
  await withHome(async () => {
    const got = await xcodeCheck(1);
    assert.equal(got.result, 'could-not-run');
    assert.equal(got.marks.match(/xcodebuild test/g).length, 1, 'no red second try on top');
  });
});

const DIRECT = hostlessTests("xcodebuild build-for-testing -scheme App -derivedDataPath .build/checks CODE_SIGNING_ALLOWED=NO", '.build/checks');

async function directCheck(xctestExit) {
  const marks = path.join(tempFolder('wh-marks-'), 'marks');
  const before = process.env.PATH;
  process.env.PATH = `${fakeXcode(xctestExit, marks)}:${before}`;
  try {
    const s = await source();
    const got = await runCheck({ project: 'p', commit: s.commit, main: false, settings: settings(DIRECT), source: s.url, platform: 'darwin', sandbox: standIn() });
    return { ...got, marks: fs.readFileSync(marks, 'utf8') };
  } finally {
    process.env.PATH = before;
  }
}

test('the finder\'s Xcode command goes straight to tests with no host, and its pass counts', unix, async () => {
  await withHome(async () => {
    const got = await directCheck(0);
    assert.equal(got.result, 'passed');
    assert.doesNotMatch(got.marks, /xcodebuild test/);
    assert.match(got.marks, /xcodebuild build-for-testing\nxcrun xctest/);
  });
});

test('anything but a pass from the finder\'s Xcode command is could-not-run, tried once', unix, async () => {
  await withHome(async () => {
    const got = await directCheck(1);
    assert.equal(got.result, 'could-not-run');
    assert.equal(got.marks.match(/xcodebuild build-for-testing/g).length, 1);
  });
});

test('an ordinary failure of a command with xcodebuild in it stays red', unix, async () => {
  await withHome(async () => {
    const got = await check('echo "** TEST FAILED **"; exit 65 # xcodebuild test');
    assert.equal(got.result, 'failed');
  });
});

test('developerDir keeps the one given, and otherwise names a full Xcode', () => {
  assert.equal(developerDir({ env: { DEVELOPER_DIR: '/given' } }), '/given');
  const seen = (real, there) => developerDir({ env: {}, real: () => real, exists: (p) => p === there });
  assert.equal(seen('/Applications/Xcode-27.app/Contents/Developer', null), '/Applications/Xcode-27.app/Contents/Developer');
  assert.equal(seen('/Library/Developer/CommandLineTools', '/Applications/Xcode.app/Contents/Developer'), '/Applications/Xcode.app/Contents/Developer');
  assert.equal(seen('/Library/Developer/CommandLineTools', null), null);
});

// --- the queue ---

const result = (commit, word, command = 'd') => ({ commit, command, result: word });

test('dueChecks puts the main line first', () => {
  assert.deepEqual(dueChecks({ main: 'm', heads: ['a', 'b'], results: [], digest: 'd' }), [{ commit: 'm', main: true }, { commit: 'a', main: false }, { commit: 'b', main: false }]);
});

test('dueChecks leaves out a commit with a result for this digest', () => {
  assert.deepEqual(dueChecks({ main: 'm', heads: ['a', 'b'], results: [{ ...result('m', 'passed'), clean: true }, result('a', 'failed')], digest: 'd' }), [{ commit: 'b', main: false }]);
});

test('a changed command makes a commit due again', () => {
  assert.deepEqual(dueChecks({ main: null, heads: ['a'], results: [result('a', 'passed', 'old')], digest: 'd' }), [{ commit: 'a', main: false }]);
});

test('a check that could not run is due again', () => {
  assert.deepEqual(dueChecks({ main: null, heads: ['a'], results: [result('a', 'could-not-run')], digest: 'd' }), [{ commit: 'a', main: false }]);
});

test('a not-counted result stands only while tests aren\'t counting', () => {
  const results = [result('a', 'not-counted')];
  assert.deepEqual(dueChecks({ main: null, heads: ['a'], results, digest: 'd', notCounting: true }), []);
  assert.deepEqual(dueChecks({ main: null, heads: ['a'], results, digest: 'd' }), [{ commit: 'a', main: false }]);
});

test('a head that is the main line is checked once, as the main line', () => {
  assert.deepEqual(dueChecks({ main: 'm', heads: ['m', 'a', 'a'], results: [], digest: 'd' }), [{ commit: 'm', main: true }, { commit: 'a', main: false }]);
});

test('a head\'s pass doesn\'t stand for the main line, and a main-line pass does', () => {
  const pass = { commit: 'a', command: 'd', result: 'passed' };
  assert.deepEqual(dueChecks({ main: 'a', heads: [], results: [pass], digest: 'd' }), [{ commit: 'a', main: true }]);
  assert.deepEqual(dueChecks({ main: 'a', heads: [], results: [{ ...pass, clean: true }], digest: 'd' }), []);
  assert.deepEqual(dueChecks({ main: null, heads: ['a'], results: [pass], digest: 'd' }), []);
});

test('two projects\' checks never overlap', async () => {
  await withHome(async () => {
    let running = 0;
    let most = 0;
    const turn = async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => { setTimeout(r, 40); });
      running -= 1;
    };
    await Promise.all([withCheckTurn(turn), withCheckTurn(turn), withCheckTurn(turn)]);
    assert.equal(most, 1);
  });
});

test('a turn is let go when the check throws', async () => {
  await withHome(async () => {
    await assert.rejects(withCheckTurn(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await withCheckTurn(async () => 'next'), 'next');
  });
});

// --- on the Mac: the real sandbox ---

test('a real run under sandbox-exec passes, writes in its folder, and can\'t reach the record', mac, async () => {
  await withHome(async () => {
    const s = await source();
    const got = await runCheck({ project: 'p', commit: s.commit, main: false, settings: settings(`echo built > out.txt; cat a.txt; ls '${process.env.WHEELHOUSE_HOME}' && exit 9; exit 0`), source: s.url });
    assert.equal(got.result, 'passed', got.tail);
    assert.match(got.tail, /one/);
  });
});

test('a real broken profile is could-not-run', mac, async () => {
  await withHome(async () => {
    const s = await source();
    const got = await runCheck({ project: 'p', commit: s.commit, main: false, settings: settings('exit 0'), source: s.url, profile: () => '(this is not a profile' });
    assert.equal(got.result, 'could-not-run');
  });
});

test('runCheck on a small project gives a signed check event', mac, async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-31T00:00:00.000Z' });
    const s = await source();
    const got = await runCheck({ project: 'p', commit: s.commit, main: true, settings: settings('test -f a.txt'), source: s.url });
    const event = await writeCheck('p', got, { write: async () => {} });
    assert.equal(event.data.result, 'passed');
    assert.equal(event.data.commit, s.commit);
    assert.ok(verify(event, readEnrolled()));
  });
});
