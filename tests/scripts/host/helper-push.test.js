// tests/scripts/host/helper-push.test.js
// The as-is push (design section 4.1): the helper's push runs with the director's own global and system
// git settings, and the rest of the fence stays. Against the stand-in host (tests/helpers/http-host.js),
// with the director's credential helper in a temporary global config. Each refusal the helper had before
// is shown still holding with that config let in.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHelper, PUSH_REFUSALS } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { run } from '../../../scripts/lib/run.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { safeGit, safeGitEnv, pushReachFor, sshRemote, PUSH_REACHES, settingsRefusal, settingsText, confirmComputerSettings } from '../../../scripts/lib/safe-git.js';
import { childEnv } from '../../../scripts/host/connection.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';
import { makeBareRemote, LOOPBACK_HTTP } from '../../helpers/git-fixture.js';
import { hostKeyEnv } from '../../helpers/host-key.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { startHttpHost } from '../../helpers/http-host.js';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';

const unix = process.platform !== 'win32';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const PROJECT = 'o__p';
const TOKEN = 'ghs_ASISTOKEN0123456789abcdefgh';

// No host tool runs for real.
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));
waitLongerOnTheHelper();

const fakeAdapter = () => ({
  defaultBranch: async () => 'main',
  prState: async () => ({ state: 'closed' }),
  ciState: async () => ({ state: 'pending' }),
  merge: async () => ({ merged: false }),
  openPr: async () => ({ number: 1 }),
  updatePr: async () => ({ number: 1 }),
  issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
});

async function g(dir, ...args) {
  const r = await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@invalid', ...args], { cwd: dir, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// A marker: a program that leaves a line in a file when it runs (a shell script, so on Unix only).
function marker(root, name, body = '') {
  const file = path.join(root, name);
  const log = `${file}.ran`;
  fs.writeFileSync(file, `#!/bin/sh\necho "$0 $@" >> "${log}"\n${body}`, { mode: 0o755 });
  return { file, ran: () => fs.existsSync(log), lines: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''), clear: () => fs.rmSync(log, { force: true }) };
}

// The director's global git config, as the process's home for the length of `fn`. It starts by clearing
// the system's own credential helpers, so no test stores anything in the computer's keychain.
async function withDirectorsGit(config, fn) {
  const home = fs.realpathSync.native(tempFolder('wh-dirhome-'));
  fs.writeFileSync(path.join(home, '.gitconfig'), `[credential]\n\thelper =\n${config}\n`);
  const names = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME'];
  const before = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  try { return await fn(home); } finally {
    for (const n of names) if (before[n] === undefined) delete process.env[n]; else process.env[n] = before[n];
  }
}

// A credential helper that answers with the key, and leaves a line when it is asked.
const signIn = (root) => marker(root, 'director-helper', `if [ "$1" = get ]; then\n  echo username=x-access-token\n  echo password=${TOKEN}\nfi\n`);

async function privateRepo() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  // Reads are open and pushes need a key: the host's other reads are a later part's, so only a push signs in here.
  const host = await startHttpHost({ root: remote.root, token: TOKEN, openReads: true });
  return { remote, host, url: `${host.url}/o/p.git`, cleanup: async () => { await host.close(); remote.cleanup(); } };
}

// One computer: its own home, a project record whose connection is as-is, and a helper.
async function computer(repo) {
  const home = shortHome();
  const folder = path.join(home, 'work');
  fs.mkdirSync(folder, { recursive: true });
  const record = (remoteUrl) => ({ folder, remoteUrl, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'as-is', project: 'o/p' } });
  await as(home, async () => {
    writeProject(PROJECT, record(repo.url));
    const { computer: id, publicKey } = makeSigningKey();
    enrol({ computer: id, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ project: PROJECT });
    // The lock is taken once with the key in the environment, as the parts that give an as-is project its reads will.
    const env = { ...hostKeyEnv(repo.host.url, TOKEN), ...LOOPBACK_HTTP };
    const keyedPush = async (dir, branch) => {
      const r = await run('git', ['push', 'origin', branch], { cwd: dir, env: { ...env, GIT_TERMINAL_PROMPT: '0' } });
      return r.code === 0 ? { ok: true } : { ok: false, rejected: 'other' };
    };
    assert.equal((await takeLock({ env, project: PROJECT, push: keyedPush })).taken, true);
  });
  const helper = await as(home, () => startHelper({
    run: hostGuard,
    address: testAddress(home),
    adapterFor: async () => fakeAdapter(),
    envFor: async () => ({ mode: 'as-is', env: {} }),
  }));
  const client = helperClient({ address: helper.address });
  // A working folder inside the project, on `feature`, with one commit.
  const dir = path.join(folder, 'code');
  fs.mkdirSync(dir);
  await g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  await g(dir, 'add', '-A');
  await g(dir, 'commit', '-q', '-m', 'One');
  await g(dir, 'branch', 'feature');
  return {
    home, dir, client, folder,
    push: (args) => as(home, () => client.push(args)),
    as: (fn) => as(home, fn),
    record: () => as_(home, () => stateDir(PROJECT)),
    mirror: () => path.join(as_(home, () => stateDir(PROJECT)), '..', 'mirror.git'),
    close: async () => { await as(home, () => helper.close()); fs.rmSync(home, { recursive: true, force: true }); },
  };
}
const as_ = (home, fn) => {
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return fn(); } finally { if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before; }
};

const heads = async (url) => (await run('git', ['ls-remote', '--heads', url])).stdout;

// --- The environment of a push ---

test('a push reach lets the computer\'s own settings in, keeps the rest of the fence, and never prompts', () => {
  for (const reach of PUSH_REACHES) {
    const env = safeGitEnv({}, { reach });
    assert.equal('GIT_CONFIG_GLOBAL' in env, false, reach);
    assert.equal('GIT_CONFIG_NOSYSTEM' in env, false, reach);
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.GCM_INTERACTIVE, 'never');
    const pairs = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
    const has = (k, v) => pairs.some(([key, value]) => key === k && value === v);
    assert.ok(has('core.hooksPath', '/dev/null'));
    assert.ok(has('http.sslVerify', 'true'));
    assert.ok(has('commit.gpgSign', 'false') && has('push.gpgSign', 'false') && has('tag.gpgSign', 'false'));
    assert.ok(has('core.askPass', 'false'));
    // The director's own credential helper is the only one: nothing clears it.
    assert.equal(pairs.some(([k]) => k === 'credential.helper'), false, reach);
  }
  assert.equal(safeGitEnv({}, { reach: 'push' }).GIT_ALLOW_PROTOCOL, 'https');
  assert.equal(safeGitEnv({}, { reach: 'push-ssh' }).GIT_ALLOW_PROTOCOL, 'https:ssh');
  assert.equal(safeGitEnv({}, { reach: 'push-loopback' }).GIT_ALLOW_PROTOCOL, 'https:http');
  assert.equal(safeGitEnv({ GIT_ALLOW_PROTOCOL: 'ext' }, { reach: 'push' }).GIT_ALLOW_PROTOCOL, 'https');
  // Every other reach still shuts the files out, and still clears the helpers.
  for (const reach of ['https', 'local', 'ssh', 'loopback']) {
    const env = safeGitEnv({}, { reach });
    assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null', reach);
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1', reach);
    assert.equal(env.GIT_CONFIG_KEY_0, 'credential.helper', reach);
    assert.equal(env.GCM_INTERACTIVE, undefined, reach);
  }
  // Applying twice changes nothing.
  assert.deepEqual(safeGitEnv(safeGitEnv({}, { reach: 'push-ssh' }), { reach: 'push-ssh' }), safeGitEnv({}, { reach: 'push-ssh' }));
});

test('a push over https keeps the fence\'s core.sshCommand; one over SSH keeps the director\'s own, and GIT_SSH_COMMAND', () => {
  const pairsOf = (env) => Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
  const directorEnv = { GIT_SSH_COMMAND: 'ssh -i /home/d/key', PATH: '/bin' };
  const https = safeGitEnv({}, { reach: 'push', directorEnv });
  assert.ok(pairsOf(https).some(([k, v]) => k === 'core.sshCommand' && v === 'false'));
  assert.equal(https.GIT_SSH_COMMAND, undefined);
  const ssh = safeGitEnv({}, { reach: 'push-ssh', directorEnv });
  assert.equal(pairsOf(ssh).some(([k]) => k.toLowerCase() === 'core.sshcommand'), false);
  assert.equal(ssh.GIT_SSH_COMMAND, 'ssh -i /home/d/key');
  assert.equal(ssh.SSH_ASKPASS_REQUIRE, 'never');
  // The other fence settings stay for an SSH push.
  assert.ok(pairsOf(ssh).some(([k, v]) => k === 'core.hooksPath' && v === '/dev/null'));
  assert.ok(pairsOf(ssh).some(([k, v]) => k === 'http.sslVerify' && v === 'true'));
  // A caller's GIT_SSH_COMMAND does nothing: only the director's own environment gives one.
  assert.equal(safeGitEnv({ GIT_SSH_COMMAND: 'evil' }, { reach: 'push-ssh', directorEnv: {} }).GIT_SSH_COMMAND, undefined);
  // The SSH reaches that are not pushes keep the fence's core.sshCommand.
  assert.ok(pairsOf(safeGitEnv({}, { reach: 'ssh', directorEnv })).some(([k, v]) => k === 'core.sshCommand' && v === 'false'));
});

test('a push takes no credential helper from its caller, by pair, -c or --config-env', async () => {
  assert.throws(() => safeGitEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '!evil' }, { reach: 'push' }), /credential helper/);
  assert.throws(() => safeGitEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.https://x.example.org.helper', GIT_CONFIG_VALUE_0: '!evil' }, { reach: 'push' }), /credential helper/);
  const git = safeGit({ cwd: tempFolder('wh-pa-'), reach: 'push', run: async () => ({ code: 0, stdout: '', stderr: '' }) });
  await assert.rejects(git(['push', '-c', 'credential.helper=!evil']), /may not set credential\.helper/);
  await assert.rejects(git(['-c', 'credential.helper=!evil', 'push']), /may not set credential\.helper/);
  await assert.rejects(git(['push', '--config-env=credential.helper=X']), /may not set credential\.helper/);
});

test('a push reach always looks at the repository\'s own settings, by the own list', () => {
  const cwd = tempFolder('wh-pa-');
  assert.throws(() => safeGit({ cwd, reach: 'push', look: 'never' }), /always looks/);
  assert.throws(() => safeGit({ cwd, reach: 'push', list: 'project' }), /own list/);
  assert.throws(() => safeGit({ cwd, reach: 'push-nowhere' }), /unknown reach/);
});

test('the push reach is chosen by the remote\'s address', () => {
  assert.equal(pushReachFor('https://gitlab.example.org/o/p.git'), 'push');
  assert.equal(pushReachFor('ssh://git@gitlab.example.org/o/p.git'), 'push-ssh');
  assert.equal(pushReachFor('git@gitlab.example.org:o/p.git'), 'push-ssh');
  assert.equal(pushReachFor('http://127.0.0.1:8080/o/p.git'), 'push-loopback');
  assert.equal(pushReachFor('/srv/x.git', { platform: 'darwin' }), 'push-local');
  assert.equal(pushReachFor('C:\\x\\y.git', { platform: 'win32' }), 'push-local');
  assert.equal(pushReachFor('http://example.com/x'), 'push', 'plain http beyond this computer stays refused by the transport');
  for (const url of ['C:\\x', 'C:/x', 'https://a.example.org/o/p', '/srv/x', './x', 'file:///srv/x', 'ext::sh -c evil']) assert.equal(sshRemote(url), false, url);
});

test('the as-is connection is accepted, holds no key, and cannot be Locked', async () => {
  const connection = { host: 'gitlab', mode: 'as-is', project: 'o/p' };
  assert.deepEqual(await childEnv(connection), {});
  await assert.rejects(childEnv({ ...connection, locked: true }), /Locked needs the narrow/);
  await assert.rejects(childEnv({ ...connection, mode: 'sideways' }), /quick, narrow or as-is/);
});

// --- Only a push gets the director's settings: every route and its reach ---

test('a list of every route and its reach: only the helper\'s push route takes a push reach', () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs')) {
        const text = fs.readFileSync(full, 'utf8');
        if (/pushReachFor|PUSH_REACHES|reach:\s*['"`]push|isPushReach/.test(text)) found.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(ROOT, 'scripts'));
  assert.deepEqual(found.sort(), ['scripts/host/helper.js', 'scripts/lib/safe-git.js']);
  // In the helper, the reach is made in one place, and what runs under it must be a `git push`.
  const text = fs.readFileSync(path.join(ROOT, 'scripts/host/helper.js'), 'utf8');
  assert.equal((text.match(/pushReachFor\(/g) ?? []).length, 1);
  assert.match(text, /subcommandOf\(args\) !== 'push'\) throw/);
});

// --- Real git, against the stand-in host ---

test('a push uses the director\'s global credential helper, and the host sees the key from it', { skip: !unix && 'the credential helper is a shell script' }, async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const root = tempFolder('wh-helperbin-');
  const helperProgram = signIn(root);
  try {
    await withDirectorsGit(`[credential]\n\thelper = !${helperProgram.file}\n`, async () => {
      const answer = await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature' });
      assert.deepEqual(answer, { ok: true });
      assert.equal(JSON.stringify(answer).includes(TOKEN), false);
    });
    assert.match(await heads(repo.remote.url), /refs\/heads\/feature/, 'the branch is on the host');
    assert.equal(helperProgram.ran(), true, 'the director\'s helper was asked');
  } finally { await c.close(); await repo.cleanup(); }
});

test('a push that needs a sign-in fails at once with a plain line, and opens no prompt', { skip: !unix && 'the credential helper is a shell script' }, async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await withDirectorsGit('', async () => {
      const answer = await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature' });
      assert.deepEqual(answer, { ok: false, refused: PUSH_REFUSALS.asIsSignIn });
    });
    assert.equal(repo.host.refusedCount() > 0, true, 'the host refused the unsigned push');
    assert.doesNotMatch(await heads(repo.remote.url), /refs\/heads\/feature/);
  } finally { await c.close(); await repo.cleanup(); }
});

test('a hostile global config does not undo the fence: hooks, signing and certificate checks hold', { skip: !unix && 'the programs are shell scripts' }, async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const root = fs.realpathSync.native(tempFolder('wh-hostile-'));
  const sign = signIn(root);
  const hooksDir = path.join(root, 'hooks');
  fs.mkdirSync(hooksDir);
  const prePush = marker(hooksDir, 'pre-push');
  const configHook = marker(root, 'config-hook');
  const gpg = marker(root, 'gpg-program');
  const alias = marker(root, 'alias-program');
  const config = [
    `[credential]\n\thelper = !${sign.file}`,
    `[core]\n\thooksPath = ${hooksDir}\n\tfsmonitor = ${root}/fsmonitor\n\taskPass = ${root}/askpass\n\teditor = ${root}/editor`,
    `[hook "audit"]\n\tevent = pre-push\n\tcommand = ${configHook.file}`,
    `[hook "audit2"]\n\tevent = reference-transaction\n\tcommand = ${configHook.file}`,
    `[push]\n\tgpgSign = true`,
    `[commit]\n\tgpgSign = true`,
    `[gpg]\n\tprogram = ${gpg.file}`,
    `[http]\n\tsslVerify = false`,
    `[alias]\n\tpush = !${alias.file}`,
  ].join('\n');
  try {
    await withDirectorsGit(config, async (home) => {
      // The settings git ends with for a push: the fence's, whatever the global files say.
      const cwd = c.dir;
      const git = safeGit({ cwd, reach: 'push', caller: 'helper' });
      const get = async (key) => (await git(['config', '--get', key])).stdout.trim();
      assert.equal(await get('core.hooksPath'), '/dev/null');
      assert.equal(await get('http.sslVerify'), 'true');
      assert.equal(await get('push.gpgSign'), 'false');
      assert.equal(await get('commit.gpgSign'), 'false');
      assert.equal(await get('core.askPass'), 'false');
      assert.equal(await get('core.fsmonitor'), 'false');
      assert.equal(await get('core.editor'), 'false');
      // The director's own files are read: their credential helper is in the list.
      assert.match((await git(['config', '--get-all', 'credential.helper'])).stdout, new RegExp(sign.file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
      assert.ok(home);
      // The markers work: git without the fence, under the same global config, reaches both hooks.
      const target = await makeBareRemote();
      try {
        await run('git', ['-c', 'push.gpgSign=false', 'push', '-q', target.url, 'feature:refs/heads/control'], { cwd: c.dir, env: { GIT_TERMINAL_PROMPT: '0' } });
      } finally { target.cleanup(); }
      assert.equal(prePush.ran(), true, 'control: the global hooks folder');
      assert.equal(configHook.ran(), true, 'control: the config-defined hook');
      prePush.clear();
      configHook.clear();
      const answer = await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature' });
      assert.deepEqual(answer, { ok: true });
    });
    assert.match(await heads(repo.remote.url), /refs\/heads\/feature/);
    for (const [name, program] of [['pre-push hook', prePush], ['config-defined hooks', configHook], ['signing program', gpg], ['push alias', alias]]) {
      assert.equal(program.ran(), false, `${name} ran`);
    }
  } finally { await c.close(); await repo.cleanup(); }
});

test('the computer\'s own credential helper reaches a push, and no other call', { skip: !unix && 'the credential helper is a shell script' }, async () => {
  const root = fs.realpathSync.native(tempFolder('wh-rewrite-'));
  const sign = signIn(root);
  const dir = path.join(root, 'repo');
  fs.mkdirSync(dir);
  await run('git', ['init', '-q', '-b', 'main', dir]);
  await run('git', ['remote', 'add', 'origin', 'http://127.0.0.1:1/o/p.git'], { cwd: dir });
  await withDirectorsGit(`[credential]\n\thelper = !${sign.file}\n`, async () => {
    const helpers = async (reach) => (await safeGit({ cwd: dir, reach })(['config', '--get-all', 'credential.helper'])).stdout;
    assert.match(await helpers('push-loopback'), /director-helper/);
    assert.doesNotMatch(await helpers('loopback'), /director-helper/);
    assert.doesNotMatch(await helpers('https'), /director-helper/);
  });
});

test('the computer\'s own protocol settings cannot widen a push to another transport', { skip: !unix && 'a local path' }, async () => {
  const target = await makeBareRemote();
  const root = fs.realpathSync.native(tempFolder('wh-proto-'));
  const dir = path.join(root, 'repo');
  fs.mkdirSync(dir);
  await run('git', ['init', '-q', '-b', 'main', dir]);
  await g(dir, 'commit', '-q', '--allow-empty', '-m', 'One');
  try {
    await withDirectorsGit('[protocol "file"]\n\tallow = always\n[protocol]\n\tallow = always\n', async () => {
      await run('git', ['remote', 'add', 'origin', target.url], { cwd: dir });
      const git = safeGit({ cwd: dir, reach: 'push', pushTo: { remote: 'origin', url: target.url } });
      const got = await git(['push', '--no-verify', 'origin', 'main:refs/heads/x']);
      assert.notEqual(got.code, 0, 'a local path is not an https remote');
      assert.equal((await heads(target.url)).trim(), '');
    });
  } finally { target.cleanup(); }
});

// A push whose address the director's settings change goes nowhere: the sign-in would reach another repository.
const REDIRECTS = {
  'a global url.pushInsteadOf': (url) => `[url "http://127.0.0.1:9/elsewhere/"]\n\tpushInsteadOf = ${url}\n`,
  'a global url.insteadOf': (url) => `[url "http://127.0.0.1:9/elsewhere/"]\n\tinsteadOf = ${url}\n`,
  'a global remote.origin.pushurl': () => '[remote "origin"]\n\tpushurl = http://127.0.0.1:9/elsewhere/o/p.git\n',
  'a second global pushurl after the recorded one': (url) => `[remote "origin"]\n\tpushurl = ${url}\n\tpushurl = http://127.0.0.1:9/elsewhere/o/p.git\n`,
  'a second global url for the remote': () => '[remote "origin"]\n\turl = http://127.0.0.1:9/elsewhere/o/p.git\n',
  'a global pushInsteadOf to an address that is not this computer\'s': (url) => `[url "https://example.org/o/p.git"]\n\tpushInsteadOf = ${url}\n`,
};
for (const [name, config] of Object.entries(REDIRECTS)) {
  test(`${name} that changes the recorded address stops the push, and the sign-in is never asked`, { skip: !unix && 'the credential helper is a shell script' }, async () => {
    const repo = await privateRepo();
    const c = await computer(repo);
    const root = tempFolder('wh-helperbin-');
    const helperProgram = signIn(root);
    try {
      await withDirectorsGit(`[credential]\n\thelper = !${helperProgram.file}\n${config(repo.url)}`, async () => {
        const answer = await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature' });
        assert.equal(answer.ok, false);
        assert.match(answer.refused, /send pushes for this project to another address/);
      });
      assert.equal(helperProgram.ran(), false, 'the director\'s helper was never asked');
      assert.doesNotMatch(await heads(repo.remote.url), /refs\/heads\/feature/);
    } finally { await c.close(); await repo.cleanup(); }
  });
}

test('a rewrite that does not touch the recorded address does not stop a push', { skip: !unix && 'the credential helper is a shell script' }, async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const root = tempFolder('wh-helperbin-');
  const helperProgram = signIn(root);
  try {
    await withDirectorsGit(`[credential]\n\thelper = !${helperProgram.file}\n[url "ssh://git@other.example.org/"]\n\tinsteadOf = https://other.example.org/\n`, async () => {
      assert.deepEqual(await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature' }), { ok: true });
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('a URL-scoped http.sslVerify=false, or a resolver override, in the computer\'s settings stops a push; its company certificate and proxy are let in', { skip: !unix && 'a shell script' }, async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const root = tempFolder('wh-helperbin-');
  const helperProgram = signIn(root);
  try {
    for (const [name, config] of [
      ['the recorded address', `[http "${repo.url}"]\n\tsslVerify = false\n`],
      ['the host', `[http "${repo.host.url}/"]\n\tsslVerify = off\n`],
      ['a resolver override', '[http]\n\tcurloptResolve = gitlab.example.org:443:127.0.0.1\n'],
    ]) {
      await withDirectorsGit(`[credential]\n\thelper = !${helperProgram.file}\n${config}`, async () => {
        const answer = await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature' });
        assert.equal(answer.ok, false, name);
        assert.match(answer.refused, /does not allow for a push/, name);
      });
    }
    assert.equal(helperProgram.ran(), false);
    // The company's certificate and proxy are the director's own, and pass.
    assert.equal(settingsRefusal([{ key: 'http.sslcainfo', value: '/c/ca.pem' }, { key: 'http.proxy', value: 'http://proxy.example.org:8080' }, { key: 'http.https://gitlab.example.org/.sslverify', value: 'true' }]), null);
    // With a setting for a wider address, the recorded address's own check is on all the same.
    await withDirectorsGit('[http "https://gitlab.example.org/"]\n\tsslCAInfo = /c/ca.pem\n', async () => {
      const mirror = c.mirror();
      const git = safeGit({ cwd: mirror, reach: 'push', caller: 'helper', pushTo: { remote: 'origin', url: 'https://gitlab.example.org/o/p.git' } });
      const got = await git(['config', '--get-urlmatch', 'http.sslVerify', 'https://gitlab.example.org/o/p.git']);
      assert.equal(got.stdout.trim(), 'true');
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('what was checked is what the push uses: a hook added to the computer\'s files after the check does not run, and the copy is removed', { skip: !unix && 'the programs are shell scripts' }, async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const root = fs.realpathSync.native(tempFolder('wh-late-'));
  const sign = signIn(root);
  const late = marker(root, 'late-hook');
  const copiesDir = path.join(c.home, 'settings-copies');
  const copies = () => (fs.existsSync(copiesDir) ? fs.readdirSync(copiesDir).sort() : []);
  const seen = [];
  try {
    await withDirectorsGit(`[credential]\n\thelper = !${sign.file}\n`, async (home) => {
      assert.deepEqual(await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature' }), { ok: true }); // makes the mirror
      const before = copies();
      const sneaky = (file, args, options) => {
        // Between the check and the push, the computer's files change.
        if (args[0] === 'remote' && args[1] === 'get-url') {
          seen.push(options.env.GIT_CONFIG_GLOBAL);
          fs.appendFileSync(path.join(home, '.gitconfig'), `[hook "late"]\n\tevent = pre-push\n\tcommand = ${late.file}\n`);
        }
        return run(file, args, options);
      };
      const git = safeGit({ run: sneaky, cwd: c.mirror(), reach: 'push-loopback', caller: 'helper', pushTo: { remote: 'origin', url: repo.url } });
      const sha = /^(\w+)\trefs\/heads\/feature$/m.exec(await heads(repo.remote.url))[1];
      await run('git', ['update-ref', 'refs/heads/second', sha], { cwd: c.mirror() });
      const got = await as(c.home, () => git(['push', '--no-verify', 'origin', 'refs/heads/second:refs/heads/second']));
      assert.equal(got.code, 0, String(got.stderr));
      // The copy was made under the Wheelhouse home, which agents can't write, and not in a temporary folder.
      assert.equal(seen.length, 1);
      assert.equal(path.dirname(path.dirname(seen[0])), copiesDir);
      assert.equal(late.ran(), false, 'the hook added after the check did not run');
      assert.deepEqual(copies(), before, 'the private copy of the settings is gone');
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('a change to the computer\'s sign-in settings since the first push is refused with a code until the director confirms it', { skip: !unix && 'the credential helper is a shell script' }, async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const root = tempFolder('wh-helperbin-');
  const first = signIn(root);
  const second = marker(root, 'other-helper', `if [ "$1" = get ]; then\n  echo username=x-access-token\n  echo password=${TOKEN}\nfi\n`);
  const file = path.join(c.home, 'host', 'git-settings.json');
  const push = (branch = 'feature') => c.push({ project: PROJECT, dir: c.dir, refspec: branch });
  try {
    await withDirectorsGit(`[credential]\n\thelper = !${first.file}\n`, async () => {
      assert.deepEqual(await push(), { ok: true });
      assert.equal(fs.existsSync(file), true, 'the first push recorded the settings');
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).fingerprint.length, 64);
    });
    // Settings that are not the sign-in, proxy, certificate or rewrites change nothing; the same ones again pass.
    await withDirectorsGit(`[credential]\n\thelper = !${first.file}\n[user]\n\tname = Someone\n[alias]\n\tst = status\n`, async () => {
      assert.deepEqual(await push(), { ok: true });
    });
    for (const [name, config] of [
      ['another helper', `[credential]\n\thelper = !${second.file}\n`],
      ['an added helper', `[credential]\n\thelper = !${first.file}\n\thelper = !${second.file}\n`],
      ['a proxy', `[credential]\n\thelper = !${first.file}\n[http]\n\tproxy = http://proxy.example.org:8080\n`],
      ['a sshCommand', `[credential]\n\thelper = !${first.file}\n[core]\n\tsshCommand = ssh -i /x\n`],
      ['an included file', `[credential]\n\thelper = !${first.file}\n[include]\n\tpath = /nowhere/more.config\n`],
      ['a rewrite for another address', `[credential]\n\thelper = !${first.file}\n[url "ssh://git@other.example.org/"]\n\tinsteadOf = https://other.example.org/\n`],
    ]) {
      await withDirectorsGit(config, async () => {
        const answer = await push();
        assert.equal(answer.ok, false, name);
        assert.equal(answer.code, 'git-settings-changed', name);
        assert.match(answer.refused, /changed since setup/, name);
        assert.match(answer.refused, /director needs to confirm/, name);
      });
    }
    first.clear();
    second.clear();
    // The director's confirmation records the settings as they are; the push then goes.
    await withDirectorsGit(`[credential]\n\thelper = !${second.file}\n`, async () => {
      await as(c.home, () => confirmComputerSettings({ file, cwd: c.mirror() }));
      assert.deepEqual(await push(), { ok: true });
    });
    assert.equal(first.ran(), false, 'the refused pushes never asked the old helper');
  } finally { await c.close(); await repo.cleanup(); }
});

test('a push to a local path is refused outside the tests of a stand-in host', () => {
  const cwd = tempFolder('wh-pa-');
  assert.throws(() => safeGit({ cwd, reach: 'push-local' }), /local path is refused/);
  assert.doesNotThrow(() => safeGit({ cwd, reach: 'push-local', allowLocal: true }));
});

test('a push names the address it goes to', async () => {
  const git = safeGit({ cwd: tempFolder('wh-pa-'), reach: 'push', run: async () => ({ code: 0, stdout: '', stderr: '' }) });
  await assert.rejects(git(['push', 'origin', 'x']), /names the remote and the address/);
});

test('the settings copy keeps every key, value and subsection as written', () => {
  const entries = [
    { key: 'credential.helper', value: '' }, { key: 'credential.helper', value: '!f() { echo "a\\b"; }; f' },
    { key: 'url.https://a.example.org/x y/.insteadof', value: 'https://b/' }, { key: 'alias.q', value: null }, { key: 'core.note', value: 'two\nlines\tand tab' },
  ];
  const file = path.join(tempFolder('wh-copy-'), 'config');
  fs.writeFileSync(file, settingsText(entries));
  const read = spawnSync('git', ['config', '--file', file, '--list', '-z'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
    .map((r) => { const i = r.indexOf('\n'); return { key: i < 0 ? r : r.slice(0, i), value: i < 0 ? null : r.slice(i + 1) }; });
  assert.deepEqual(read, entries);
});

test('the repository\'s own config is still checked before a push: an unlisted setting stops it, and the helper never runs', { skip: !unix && 'the credential helper is a shell script' }, async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const root = tempFolder('wh-helperbin-');
  const helperProgram = signIn(root);
  try {
    await withDirectorsGit(`[credential]\n\thelper = !${helperProgram.file}\n`, async () => {
      assert.deepEqual(await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature' }), { ok: true });
      helperProgram.clear();
      for (const [key, value] of [
        ['credential.helper', '!echo planted'], ['url.http://evil.example.org/.insteadOf', repo.url], ['core.sshCommand', 'evil'], ['hook.x.command', 'evil'], ['http.sslVerify', 'false'],
      ]) {
        const mirror = c.mirror();
        await run('git', ['config', key, value], { cwd: mirror });
        const answer = await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature' });
        assert.equal(answer.ok, false, key);
        assert.match(answer.refused, /Git's settings in the project's mirror repository include/, key);
        assert.equal(helperProgram.ran(), false, `${key}: git ran`);
        await run('git', ['config', '--unset-all', key], { cwd: mirror });
      }
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('with the director\'s settings let in, a push to the default branch, a force-push and a push of the records are still refused', { skip: !unix && 'the credential helper is a shell script' }, async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const root = tempFolder('wh-helperbin-');
  const helperProgram = signIn(root);
  try {
    await withDirectorsGit(`[credential]\n\thelper = !${helperProgram.file}\n[push]\n\tdefault = matching\n[alias]\n\tforce = push --force\n`, async () => {
      assert.deepEqual(await c.push({ project: PROJECT, dir: c.dir, refspec: 'main' }), { ok: false, refused: PUSH_REFUSALS.defaultBranch });
      assert.deepEqual(await c.push({ project: PROJECT, dir: c.dir, refspec: '+feature' }), { ok: false, refused: PUSH_REFUSALS.force });
      assert.deepEqual(await c.push({ project: PROJECT, dir: c.dir, refspec: ':feature' }), { ok: false, refused: PUSH_REFUSALS.remove });
      assert.deepEqual(await c.push({ project: PROJECT, dir: c.dir, refspec: 'feature:main' }), { ok: false, refused: PUSH_REFUSALS.same });
      // The records: a branch holding the private record's history.
      await g(c.dir, 'fetch', '-q', c.record(), 'HEAD:refs/heads/record');
      assert.deepEqual(await c.push({ project: PROJECT, dir: c.dir, refspec: 'record' }), { ok: false, refused: PUSH_REFUSALS.ownHistory });
    });
    assert.equal(helperProgram.ran(), false, 'no refused push got as far as git');
    // Only the lock branch the test took is on the host.
    assert.deepEqual((await heads(repo.remote.url)).trim().split('\n').map((l) => l.split('\t')[1]), ['refs/heads/wheelhouse-lock']);
  } finally { await c.close(); await repo.cleanup(); }
});
