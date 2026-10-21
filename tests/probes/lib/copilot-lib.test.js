// tests/probes/lib/copilot-lib.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import {
  COPILOT_VERSION, LOGIN_HOME, copilotBin, copilotEnv, defaultPrefix, installCopilot, jsonEvents, loginHome, runCopilot, scratchCopilotHome, signedIn,
} from '../../../probes/lib/copilot.js';
import * as numbers from '../../../scripts/lib/copilot-numbers.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;

// A program on the PATH (or at a path), written as a shell script.
function script(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

function withPath(dir, fn) {
  const before = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${before}`;
  return Promise.resolve(fn()).finally(() => { process.env.PATH = before; });
}

t('installCopilot installs under the probes folder, never with -g', async () => {
  const bin = tempFolder('wh-npm-');
  const log = path.join(bin, 'npm.log');
  script(bin, 'npm', [
    `printf '%s\\n' "$*" >> '${log}'`,
    // npm install --prefix <dir> <spec>: make the program npm would link.
    'mkdir -p "$3/node_modules/.bin" && printf "#!/bin/sh\\n" > "$3/node_modules/.bin/copilot" && chmod +x "$3/node_modules/.bin/copilot"',
  ].join('\n'));
  const home = tempFolder('wh-probe-home-');
  const prefix = defaultPrefix('9.9.9', home);
  assert.equal(prefix, path.join(home, '.wheelhouse-probes', 'copilot', '9.9.9'));
  const result = await withPath(bin, () => installCopilot({ version: '9.9.9', prefix }));
  assert.equal(result.bin, copilotBin(prefix));
  assert.ok(fs.existsSync(result.bin));
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(calls, [`install --prefix ${prefix} @github/copilot@9.9.9`]);
  assert.ok(!calls[0].split(' ').some((arg) => arg === '-g' || arg === '--global'));
});

t('installCopilot refuses a version that is not exact, and says so when npm fails', async () => {
  await assert.rejects(() => installCopilot({ version: 'latest', prefix: tempFolder('wh-x-') }), /Not a Copilot version/);
  await assert.rejects(() => installCopilot({ version: '../1.0.0', prefix: tempFolder('wh-x-') }), /Not a Copilot version/);
  const bin = tempFolder('wh-npm-');
  script(bin, 'npm', 'echo "registry says no" >&2; exit 1');
  await withPath(bin, () => assert.rejects(() => installCopilot({ version: '1.2.3', prefix: tempFolder('wh-x-') }), /could not install Copilot CLI 1\.2\.3: registry says no/));
});

t('runCopilot passes COPILOT_HOME, drops inherited host tokens and keeps a token the caller passes on purpose', async () => {
  const bin = tempFolder('wh-copilot-');
  const copilot = script(bin, 'copilot', 'printf "home=%s\\ntoken=%s\\ngh=%s\\ncopilot=%s\\nmine=%s\\n" "$COPILOT_HOME" "$GITHUB_TOKEN" "$GH_TOKEN" "$COPILOT_GITHUB_TOKEN" "$MINE"');
  const home = scratchCopilotHome();
  const names = ['GITHUB_TOKEN', 'GH_TOKEN', 'COPILOT_GITHUB_TOKEN'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = `inherited-${name}`;
  try {
    // Nothing passed: none of the inherited tokens reaches the child.
    const bare = await runCopilot({ args: [], home: home.dir, bin: copilot, env: { MINE: 'yes' } });
    assert.equal(bare.code, 0);
    assert.equal(bare.stdout, `home=${home.dir}\ntoken=\ngh=\ncopilot=\nmine=yes\n`);
    // A token passed in `env` is the caller's choice and does reach the child; the inherited ones still do not.
    const given = await runCopilot({ args: [], home: home.dir, bin: copilot, env: { COPILOT_GITHUB_TOKEN: 'passed-on-purpose' } });
    assert.equal(given.stdout, `home=${home.dir}\ntoken=\ngh=\ncopilot=passed-on-purpose\nmine=\n`);
    assert.ok(!(given.stdout + bare.stdout).includes('inherited-'));
    // The environment builder alone.
    assert.ok(!copilotEnv({ home: home.dir, baseEnv: { GITHUB_TOKEN: 'x', PATH: '/bin' } }).GITHUB_TOKEN);
    assert.equal(copilotEnv({ home: home.dir, baseEnv: { PATH: '/bin' } }).PATH, '/bin');
    assert.equal(copilotEnv({ home: home.dir, baseEnv: { GH_TOKEN: 'x' }, env: { GH_TOKEN: 'y' } }).GH_TOKEN, 'y');
    await assert.rejects(() => runCopilot({ args: [], bin: copilot }), /home of its own/);
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
    home.remove();
  }
  assert.ok(!fs.existsSync(home.dir));
});

t('runCopilot parses JSON lines into events and leaves plain text as stdout', async () => {
  const bin = tempFolder('wh-copilot-');
  const home = scratchCopilotHome();
  try {
    const json = script(bin, 'json', `printf '{"type":"a"}\\n{"type":"b","n":2}\\n'`);
    const parsed = await runCopilot({ args: [], home: home.dir, bin: json });
    assert.deepEqual(parsed.events, [{ type: 'a' }, { type: 'b', n: 2 }]);
    const plain = script(bin, 'plain', 'echo "Hello there"');
    const text = await runCopilot({ args: [], home: home.dir, bin: plain });
    assert.deepEqual(text.events, []);
    assert.equal(text.stdout, 'Hello there\n');
    const mixed = script(bin, 'mixed', `printf '{"type":"a"}\\nnot json\\n'`);
    assert.deepEqual((await runCopilot({ args: [], home: home.dir, bin: mixed })).events, []);
    assert.deepEqual(jsonEvents(''), []);
    assert.deepEqual(jsonEvents('42\n'), []);
  } finally {
    home.remove();
  }
});

t('runCopilot stops the child at timeoutMs and says so', async () => {
  const bin = tempFolder('wh-copilot-');
  const slow = script(bin, 'slow', 'exec sleep 30');
  const home = scratchCopilotHome();
  try {
    const started = Date.now();
    const result = await runCopilot({ args: [], home: home.dir, bin: slow, timeoutMs: 200 });
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 10000);
    const quick = script(bin, 'quick', 'echo ok');
    assert.equal((await runCopilot({ args: [], home: home.dir, bin: quick, timeoutMs: 5000 })).timedOut, false);
  } finally {
    home.remove();
  }
});

t('signedIn is true when Copilot answers, false when it asks to sign in', async () => {
  const bin = tempFolder('wh-copilot-');
  const home = scratchCopilotHome();
  try {
    assert.equal(await signedIn({ home: home.dir, bin: script(bin, 'yes', 'echo ok') }), true);
    assert.equal(await signedIn({ home: home.dir, bin: script(bin, 'no', 'echo "Please log in with /login" >&2; exit 1') }), false);
    assert.equal(await signedIn({ home: home.dir, bin: script(bin, 'asks', 'echo "You are not authenticated"') }), false);
  } finally {
    home.remove();
  }
});

t('scratchCopilotHome is an empty folder under the temporary folder, and remove deletes it', () => {
  const home = scratchCopilotHome();
  assert.ok(path.resolve(home.dir).startsWith(fs.realpathSync(os.tmpdir())) || path.resolve(home.dir).startsWith(path.resolve(os.tmpdir())));
  assert.deepEqual(fs.readdirSync(home.dir), []);
  home.remove();
  assert.ok(!fs.existsSync(home.dir));
});

t('the login home is ~/.wheelhouse-probes/login-home', () => {
  assert.equal(loginHome('/h'), path.join('/h', '.wheelhouse-probes', 'login-home'));
  assert.equal(LOGIN_HOME, path.join(os.homedir(), '.wheelhouse-probes', 'login-home'));
});

t('scratchCopilotHome with signedInFrom copies config.json only, with mode 0600', () => {
  const source = tempFolder('wh-login-');
  const config = '// a comment\n// another\n{"loggedInUsers":[{"login":"someone"}],"lastLoggedInUser":{"login":"someone"}}\n';
  fs.writeFileSync(path.join(source, 'config.json'), config);
  fs.writeFileSync(path.join(source, 'other.json'), '{}');
  fs.mkdirSync(path.join(source, 'session-state'));
  const home = scratchCopilotHome({ signedInFrom: source });
  try {
    assert.deepEqual(fs.readdirSync(home.dir), ['config.json']);
    assert.equal(fs.readFileSync(path.join(home.dir, 'config.json'), 'utf8'), config);
    assert.equal(fs.statSync(path.join(home.dir, 'config.json')).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(source).sort(), ['config.json', 'other.json', 'session-state']);
  } finally {
    home.remove();
  }
  assert.ok(!fs.existsSync(home.dir));
});

t('scratchCopilotHome with a missing sign-in says the sign-in has not been done and leaves no folder', () => {
  // Its own temporary folder, so other tests making homes at the same time cannot show up in the listing.
  const own = tempFolder('wh-tmp-');
  const empty = tempFolder('wh-login-');
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = own;
  try {
    assert.equal(path.resolve(os.tmpdir()), path.resolve(own));
    assert.throws(() => scratchCopilotHome({ signedInFrom: path.join(empty, 'nope') }), /sign-in has not been done/);
    assert.throws(() => scratchCopilotHome({ signedInFrom: empty }), /sign-in has not been done/);
    assert.deepEqual(fs.readdirSync(own), []);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
});

t('scratchCopilotHome with no signedInFrom stays an empty folder even when a login home exists', () => {
  const home = scratchCopilotHome({});
  try {
    assert.deepEqual(fs.readdirSync(home.dir), []);
  } finally {
    home.remove();
  }
});

t('the copilot stand-in is first on the PATH in every test home', async () => {
  const shims = standInTools();
  const home = scratchCopilotHome();
  try {
    const found = spawnSync('sh', ['-c', 'command -v copilot'], { encoding: 'utf8', env: process.env });
    assert.equal(found.stdout.trim(), path.join(shims.dir, 'copilot'));
    // The default `copilot` is the stand-in: it notes the call and refuses, so no real one ran.
    const result = await runCopilot({ args: ['--version'], home: home.dir });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /copilot is not run in this test/);
    assert.deepEqual(shims.calls(), ['copilot --version']);
  } finally {
    home.remove();
    shims.restore();
  }
});

test('the numbers are the design\'s, exactly', () => {
  assert.equal(numbers.GUARD_TIMEOUT_SEC, 120);
  assert.equal(numbers.GUARD_DEADLINE_MS, 30000);
  assert.deepEqual(numbers.TIERS, ['lean', 'middle', 'full']);
  assert.deepEqual(numbers.LEVELS, ['sandbox', 'guarded', 'ask', 'unattended']);
  assert.deepEqual(numbers.PROOFS, ['chat-click', 'hook-click', 'policy-hook', 'window', 'add-on', 'host', 'signed-hook']);
  assert.deepEqual(numbers.REVIEW_KINDS, ['chat-review', 'clean-session', 'subagent']);
  assert.equal(numbers.ACTIVITY_DAYS, 30);
  assert.deepEqual(numbers.CONFIRMED_STEPS, ['lift-stop', 'guardrail-change', 'unattended', 'runbook-step', 'ci-push']);
  assert.equal(numbers.LEAN_RECORD_DIR, '.wheelhouse/record');
  assert.equal(numbers.BOARD_FILE, 'wheelhouse/board.md');
  assert.equal(numbers.HOOK_FILE, 'wheelhouse.json');
  assert.equal(COPILOT_VERSION, '1.0.101');
});
