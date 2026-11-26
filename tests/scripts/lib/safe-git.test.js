// tests/scripts/lib/safe-git.test.js
// The shared fenced route for git, against a real git in temporary repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  reachFor, safeGitEnv, safeGit, directorSignIn, lookRefusalLine, safeKeyName, LookRefusal,
} from '../../../scripts/lib/safe-git.js';
import { unlistedSettingsLine, NULL_FILE } from '../../../scripts/setup/git.js';
import { run } from '../../../scripts/lib/run.js';
import { tempFolder } from '../../helpers/homes.js';

const LOOK = 'config --includes --name-only --list -z';
const plain = (args, cwd, env = {}) => run('git', args, { cwd, env: { GIT_TERMINAL_PROMPT: '0', ...env } });
const pairsOf = (env) => Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);

async function repo() {
  const root = fs.realpathSync.native(tempFolder('wh-safe-git-'));
  await plain(['init', '-q', root], root);
  return { root, mark: path.join(root, '..', `${path.basename(root)}-ran`) };
}

test('reachFor: paths and file:// are local, on both systems; https, ssh and scp forms are not', () => {
  for (const url of ['/srv/x.git', './x', 'file:///srv/x', 'C:\\x\\y.git', 'C:/x', '\\\\server\\x']) assert.equal(reachFor(url, { platform: 'win32' }), 'local', url);
  for (const url of ['/srv/x.git', './x', 'file:///srv/x']) assert.equal(reachFor(url, { platform: 'darwin' }), 'local', url);
  for (const url of ['https://github.com/o/p.git', 'ssh://git@github.com/o/p', 'git@github.com:o/p.git']) assert.equal(reachFor(url), 'https', url);
});

test('reachFor: plain http on loopback only is loopback, and maps to https:http', () => {
  for (const url of ['http://127.0.0.1:8080/x', 'http://localhost/x', 'http://[::1]:9/x']) assert.equal(reachFor(url), 'loopback', url);
  for (const url of ['http://example.com/x', 'http://127.0.0.1.example.com/x', 'http://localhost.evil.com/x']) assert.equal(reachFor(url), 'https', url);
  assert.equal(safeGitEnv({}, { reach: 'loopback' }).GIT_ALLOW_PROTOCOL, 'https:http');
});

test('safeGitEnv carries the whole fence, and the transport its reach names, replacing any given', () => {
  const env = safeGitEnv({});
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_CONFIG_GLOBAL, NULL_FILE);
  assert.ok(pairsOf(env).some(([k, v]) => k === 'core.hooksPath' && v === NULL_FILE));
  assert.equal(env.GIT_ALLOW_PROTOCOL, 'https');
  assert.equal(safeGitEnv({}, { reach: 'local' }).GIT_ALLOW_PROTOCOL, 'https:file');
  assert.equal(safeGitEnv({}, { reach: 'ssh' }).GIT_ALLOW_PROTOCOL, 'https:ssh');
  assert.equal(safeGitEnv({ GIT_ALLOW_PROTOCOL: 'ext' }).GIT_ALLOW_PROTOCOL, 'https');
  assert.equal(safeGitEnv({ GIT_ALLOW_PROTOCOL: 'https:file' }).GIT_ALLOW_PROTOCOL, 'https');
  const twice = safeGitEnv(safeGitEnv({}, { reach: 'ssh' }), { reach: 'ssh' });
  assert.deepEqual(twice, safeGitEnv({}, { reach: 'ssh' }));
});

test('directorSignIn is the fenced sign-in as the only credential helper', () => {
  const env = directorSignIn('github', { platform: 'darwin' });
  assert.equal(env.GIT_CONFIG_GLOBAL, NULL_FILE);
  const pairs = pairsOf(env);
  assert.deepEqual(pairs.filter(([k]) => k === 'credential.helper').length, 2);
  assert.ok(pairs.some(([k, v]) => k === 'credential.helper' && v.includes('auth git-credential')));
});

test('safeGit refuses, naming it, a key off the allowed list before git runs, and runs nothing it names', async () => {
  const r = await repo();
  const script = path.join(r.root, 'mon.sh');
  fs.writeFileSync(script, `#!/bin/sh\necho ran >> "${r.mark}"\n`, { mode: 0o755 });
  await plain(['config', 'core.fsmonitor', script], r.root);
  await assert.rejects(safeGit({ cwd: r.root })(['status']), (e) => e.message === unlistedSettingsLine(['core.fsmonitor']));
  assert.equal(fs.existsSync(r.mark), false);
});

test('safeGit runs git in a clean repository', async () => {
  const r = await repo();
  const got = await safeGit({ cwd: r.root })(['status', '--porcelain']);
  assert.equal(got.code, 0);
});

test('look once looks only before the first call, and a refusal stands for every later call', async () => {
  const r = await repo();
  const calls = [];
  const counting = (file, args, options) => { calls.push(args.join(' ')); return run(file, args, options); };
  const git = safeGit({ cwd: r.root, run: counting, look: 'once' });
  for (let i = 0; i < 3; i += 1) await git(['status', '--porcelain']);
  assert.equal(calls.filter((c) => c === LOOK).length, 1);
  assert.equal(calls.length, 4);
  const each = [];
  const e = safeGit({ cwd: r.root, run: (f, a, o) => { each.push(a.join(' ')); return run(f, a, o); } });
  await e(['status']); await e(['status']);
  assert.equal(each.filter((c) => c === LOOK).length, 2);

  await plain(['config', 'core.fsmonitor', 'x'], r.root);
  const bad = safeGit({ cwd: r.root, look: 'once' });
  for (let i = 0; i < 2; i += 1) await assert.rejects(bad(['status']), (err) => err.message === unlistedSettingsLine(['core.fsmonitor']));
});

test('look never fences but does not look', async () => {
  const r = await repo();
  const calls = [];
  const git = safeGit({ cwd: r.root, look: 'never', run: (f, a, o) => { calls.push({ a, o }); return run(f, a, o); } });
  await git(['status']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].o.env.GIT_CONFIG_GLOBAL, NULL_FILE);
  assert.equal(calls[0].o.env.GIT_ALLOW_PROTOCOL, 'https');
  assert.throws(() => safeGit({ cwd: r.root, look: 'sometimes' }), /unknown look/);
});

test('a caller\'s options.env cannot lift the fence', async () => {
  const seen = [];
  const git = safeGit({ cwd: process.cwd(), look: 'never', env: { GIT_ALLOW_PROTOCOL: 'ext' }, run: async (f, a, o) => { seen.push(o.env); return { code: 0, stdout: '', stderr: '' }; } });
  await git(['status'], { env: { GIT_CONFIG_GLOBAL: '/x', GIT_ALLOW_PROTOCOL: 'ext', KEEP: 'me' } });
  assert.equal(seen[0].GIT_CONFIG_GLOBAL, NULL_FILE);
  assert.equal(seen[0].GIT_ALLOW_PROTOCOL, 'https');
  assert.equal(seen[0].KEEP, 'me');

  // With real git: what git ends up with for core.hooksPath, whatever the caller passes.
  const r = await repo();
  const git2 = safeGit({ cwd: r.root, look: 'never' });
  const hooksPath = async (env) => (await git2(['config', '--get', 'core.hooksPath'], { env })).stdout.trim();
  assert.equal(await hooksPath({}), NULL_FILE);
  assert.equal(await hooksPath({ GIT_CONFIG_PARAMETERS: "'core.hooksPath=/evil'" }), NULL_FILE);
  assert.equal(await hooksPath({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: NULL_FILE, GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/evil' }), NULL_FILE);
  assert.equal(await hooksPath({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'CORE.hookspath', GIT_CONFIG_VALUE_0: '/evil' }), NULL_FILE);
  const other = fs.realpathSync.native(tempFolder('wh-safe-git-other-'));
  await plain(['init', '-q', other], other);
  // git on Windows answers with "/"; resolved, it is spelt as the folder is.
  const top = async (env, options) => path.resolve((await git2(['rev-parse', '--show-toplevel'], { env, ...options })).stdout.trim());
  assert.equal(await top({ GIT_DIR: path.join(other, '.git') }), r.root);
  assert.equal(await top({ GIT_WORK_TREE: other }), r.root);
  // A caller's own settings are kept.
  const own = (await git2(['config', '--get', 'x.y'], { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'x.y', GIT_CONFIG_VALUE_0: 'kept' } })).stdout.trim();
  assert.equal(own, 'kept');
  // cwd and baseEnv are the factory's, never a call's.
  await assert.rejects(git2(['status'], { cwd: other }), /given once/);
  await assert.rejects(git2(['status'], { baseEnv: {} }), /given once/);
  // The look and the run use the same cwd.
  const cwds = [];
  const g3 = safeGit({ cwd: r.root, run: (f, a, o) => { cwds.push(o.cwd); return run(f, a, o); } });
  await g3(['status']);
  assert.deepEqual(cwds, [r.root, r.root]);
});

test('GIT_ variables off the allowed list from a caller do nothing; the allowed ones, and ssh only for reach ssh, survive', async () => {
  const r = await repo();
  const git = safeGit({ cwd: r.root, look: 'never' });
  const bad = { GIT_EDITOR: 'evil-editor', GIT_PAGER: 'evil-pager', GIT_SSH_COMMAND: 'evil-ssh', GIT_SSL_NO_VERIFY: '1', GIT_ASKPASS: 'evil', GIT_SSH: 'evil', GIT_PROXY_COMMAND: 'evil', git_pager: 'lower-evil' };
  assert.equal((await git(['var', 'GIT_EDITOR'], { env: bad })).stdout.trim(), 'false');
  assert.equal((await git(['var', 'GIT_PAGER'], { env: bad })).stdout.trim(), 'cat');
  const seen = (reach, env) => {
    let got;
    return safeGit({ cwd: r.root, look: 'never', reach, run: async (f, a, o) => { got = o.env; return { code: 0, stdout: '', stderr: '' }; } })(['status'], { env }).then(() => got);
  };
  const https = await seen('https', bad);
  for (const name of ['GIT_EDITOR', 'GIT_PAGER', 'GIT_SSH_COMMAND', 'GIT_SSL_NO_VERIFY', 'GIT_ASKPASS', 'GIT_SSH', 'GIT_PROXY_COMMAND', 'git_pager']) assert.equal(https[name], undefined, name);
  assert.equal((await seen('ssh', { GIT_SSH_COMMAND: 'my-ssh', GIT_INDEX_FILE: '/idx', GIT_AUTHOR_NAME: 'A' })).GIT_SSH_COMMAND, 'my-ssh');
  const kept = await seen('https', { GIT_INDEX_FILE: '/idx', GIT_AUTHOR_NAME: 'A', GIT_NO_REPLACE_OBJECTS: '1' });
  assert.equal(kept.GIT_INDEX_FILE, '/idx');
  assert.equal(kept.GIT_AUTHOR_NAME, 'A');
  assert.equal(kept.GIT_NO_REPLACE_OBJECTS, '1');
  // Another repository's config is not read by naming its common dir.
  const other = fs.realpathSync.native(tempFolder('wh-safe-git-other-'));
  await plain(['init', '-q', other], other);
  await plain(['config', 'user.name', 'Other'], other);
  await plain(['config', 'user.name', 'Mine'], r.root);
  const name = async (env) => (await git(['config', '--get', 'user.name'], { env })).stdout.trim();
  assert.equal(await name({ GIT_COMMON_DIR: path.join(other, '.git'), GIT_OBJECT_DIRECTORY: path.join(other, '.git/objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: other }), 'Mine');
  // Odd inputs: a null options, and a count larger than the settings given.
  await git(['status'], null);
  await assert.rejects(git(['status'], { env: { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'x.y', GIT_CONFIG_VALUE_0: 'z' } }), /GIT_CONFIG_COUNT is 2/);
});

test('workTree is git\'s working tree, except for init', async () => {
  const seen = [];
  const git = safeGit({ cwd: process.cwd(), look: 'never', workTree: '/w', run: async (f, a, o) => { seen.push(o.env); return { code: 0, stdout: '', stderr: '' }; } });
  await git(['status']); await git(['init']);
  assert.equal(seen[0].GIT_WORK_TREE, '/w');
  assert.equal(seen[1].GIT_WORK_TREE, undefined);
});

test('a hook named in config and a url.insteadOf are refused by name, and an ext:: remote does nothing under the fence alone', async () => {
  const r = await repo();
  await plain(['config', 'hook.planted.event', 'reference-transaction'], r.root);
  await plain(['config', 'hook.planted.command', `echo ran >> "${r.mark}"`], r.root);
  await assert.rejects(safeGit({ cwd: r.root })(['update-ref', 'refs/x/y', 'HEAD']), (e) => e.message === unlistedSettingsLine(['hook.planted.event', 'hook.planted.command']));
  await plain(['config', '--unset-all', 'hook.planted.event'], r.root);
  await plain(['config', '--unset-all', 'hook.planted.command'], r.root);
  await plain(['config', 'url./nowhere/.insteadOf', 'https://example.invalid/'], r.root);
  await assert.rejects(safeGit({ cwd: r.root })(['fetch', 'https://example.invalid/x']), (e) => e.message === unlistedSettingsLine(['url./nowhere/.insteadof']));
  await plain(['config', '--unset-all', 'url./nowhere/.insteadOf'], r.root);
  // The fence alone (look never): the ext transport is not allowed, so nothing runs.
  const got = await safeGit({ cwd: r.root, look: 'never' })(['-c', 'protocol.ext.allow=always', 'fetch', `ext::sh -c 'echo ran >> "${r.mark}"'`, 'main']);
  assert.notEqual(got.code, 0);
  assert.equal(fs.existsSync(r.mark), false);
});

test('with a caller, a refused look is a LookRefusal worded for that caller, and never setup\'s line', async () => {
  const r = await repo();
  await plain(['config', 'core.fsmonitor', 'false'], r.root);
  const lines = {};
  for (const caller of ['helper', 'foreman', 'survey', 'feature', 'reinstall']) {
    await assert.rejects(safeGit({ cwd: r.root, caller })(['status']), (e) => {
      lines[caller] = e.message;
      return e instanceof LookRefusal && e.message.includes('core.fsmonitor');
    }, caller);
  }
  assert.equal(new Set(Object.values(lines)).size, 5, 'each caller has its own line');
  for (const line of Object.values(lines)) {
    assert.doesNotMatch(line, /setup|Go ahead/i);
    // The helper reads these phrases as a failure to sign in; no caller's line may hold them.
    assert.doesNotMatch(line, /authentication|could not read username|permission denied|\b40[13]\b|not logged in|auth login|sign in/i);
  }
  assert.match(lines.foreman, /No worktree was made/);
  assert.throws(() => safeGit({ cwd: r.root, caller: 'nobody' }), /unknown caller/);
});

test('a caller\'s line keeps its echoed names short, few and plain, and lets no token through', () => {
  const token = `ghp_${'a1B2c3D4'.repeat(5)}`;
  const keys = [`branch.${token}.remote`, `url.https://user:${token}@host/.insteadof`, `x.${'y'.repeat(300)}.z`, 'a.b', 'c.d', 'e.f', 'g.h'];
  const line = lookRefusalLine('survey', { keys });
  assert.equal(line.includes(token), false);
  assert.equal(line.includes('a1B2c3D4a1B2'), false);
  assert.match(line, /and 2 more/);
  assert.ok(line.length < 700, String(line.length));
  assert.equal(safeKeyName('core.\u001b[31mx\n'), 'core.31mx');
  assert.ok(safeKeyName(`k.${'z'.repeat(200)}`.replace(/z{24,}/, 'z-z-z-z-')).length <= 83);
  assert.match(lookRefusalLine('helper', { unread: true }), /could not be read/);
});

test('an argument may not lift the fence with -c, bar the named exception', async () => {
  const r = await repo();
  const git = safeGit({ cwd: r.root, look: 'never' });
  for (const args of [['-c', 'core.hooksPath=/x', 'status'], ['-c', 'core.fsmonitor=/x', 'status'], ['-c', 'CORE.HOOKSPATH=/x', 'status'], ['--config-env=core.sshCommand=VAR', 'status'], ['--config-env', 'core.pager=VAR', 'status'], ['--config-env', 'CORE.HOOKSPATH=VAR', 'status']]) {
    await assert.rejects(git(args), /may not set/, args.join(' '));
  }
  assert.equal((await git(['-c', 'core.editor=true', 'status', '--porcelain'])).code, 0);
  assert.equal((await git(['-c', 'core.quotepath=off', 'status', '--porcelain'])).code, 0);
});

// A push in a folder, with the director's own settings (a HOME of its own) including a file for that folder alone (includeIf gitdir:).
async function includedPush({ before, after, confirmed = true, record, asOld = false, when = (folder) => `gitdir:${folder}/`, remote, seen = {}, second = false, mirror = true }) {
  const { confirmComputerSettings, safeGit } = await import('../../../scripts/lib/safe-git.js');
  const { as, shortHome } = await import('../../helpers/homes.js');
  const { spawnSync } = await import('node:child_process');
  // The trust record's home; with `mirror` the folder is the mirror of a registered as-is project, the one folder an old record serves.
  const wh = shortHome();
  const made = mirror && asOld === true ? path.join(wh, 'projects', 'p', 'mirror.git') : tempFolder('wh-inc-repo-');
  fs.mkdirSync(made, { recursive: true });
  const folder = fs.realpathSync(made);
  spawnSync('git', ['init', '-q'], { cwd: folder });
  if (remote !== undefined) spawnSync('git', ['config', 'remote.origin.url', remote], { cwd: folder });
  const home = fs.realpathSync(tempFolder('wh-inc-home-'));
  const work = path.join(home, 'work.cfg');
  fs.writeFileSync(path.join(home, '.gitconfig'), `[includeIf "${when(folder)}"]\n\tpath = ${work}\n`);
  fs.writeFileSync(work, `[credential]\n\thelper = !${before}\n`);
  const names = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GIT_CONFIG_NOSYSTEM'];
  const kept = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1' });
  const url = 'https://github.com/o/p.git';
  const fake = (file, args, options) => (args[0] === 'config' ? run(file, args, options) : (args[0] === 'push' && (seen.copy = fs.readFileSync(options.env.GIT_CONFIG_GLOBAL, 'utf8')), Promise.resolve({ code: 0, stdout: args[0] === 'remote' ? `${url}\n` : '', stderr: '' })));
  const trustFile = path.join(wh, 'host', 'git-settings.json');
  try {
    return await as(path.dirname(path.dirname(trustFile)), async () => {
      if (asOld === true && mirror) {
        const { writeProject } = await import('../../../scripts/lib/projects.js');
        writeProject('p', { folder: path.join(wh, 'work'), remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'as-is', project: 'o/p' } });
      }
      if (record !== undefined) {
        fs.mkdirSync(path.dirname(trustFile), { recursive: true });
        fs.writeFileSync(trustFile, JSON.stringify(record));
      }
      if (confirmed) await confirmComputerSettings({ file: trustFile, run: fake, cwd: folder });
      if (asOld) {
        // A record as the earlier fingerprint made it: one value for all (true), or one for the folder ('folders').
        const { readSettingsFor, legacySettingsFingerprint } = await import('../../../scripts/lib/safe-git.js');
        const old = legacySettingsFingerprint(await readSettingsFor({ cwd: folder }));
        fs.writeFileSync(trustFile, JSON.stringify(asOld === 'folders' ? { folders: { [folder]: old } } : { fingerprint: old }));
      }
      if (second) {
        const other = fs.realpathSync(tempFolder('wh-inc-repo2-'));
        spawnSync('git', ['init', '-q'], { cwd: other });
        await confirmComputerSettings({ file: trustFile, run: fake, cwd: other });
      }
      fs.writeFileSync(work, `[credential]\n\thelper = !${after}\n`);
      const push = safeGit({ cwd: folder, reach: 'push', run: fake, pushTo: { remote: 'origin', url }, trust: { file: trustFile } });
      const out = await push(['push', '--no-verify', 'origin', 'main']).then((got) => ({ ok: got.code === 0 }), (error) => ({ code: error.code, message: error.message }));
      if (asOld || second) out.record = JSON.parse(fs.readFileSync(trustFile, 'utf8'));
      return out;
    });
  } finally {
    for (const n of names) if (kept[n] === undefined) delete process.env[n]; else process.env[n] = kept[n];
  }
}

test('a setting a push folder alone includes (includeIf gitdir) is part of what is checked: changing its credential helper after the confirmation refuses the push', async () => {
  assert.deepEqual(await includedPush({ before: '/a/helper', after: '/a/helper' }), { ok: true }, 'unchanged, it passes');
  const changed = await includedPush({ before: '/a/helper', after: '/b/other-helper' });
  assert.equal(changed.code, 'git-settings-changed');
});

test('a record from before the settings were kept per folder migrates when the settings are as they were, and the old value stays for other projects', async () => {
  const got = await includedPush({ before: '/a/helper', after: '/a/helper', confirmed: true, asOld: true });
  assert.equal(got.ok, true);
  assert.match(got.record.legacy, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(got.record.folders).length, 1);
  assert.match(Object.values(got.record.folders)[0], /^v2:[0-9a-f]{64}$/, 'the entry is in the present form');
});

test('a folder that is no registered project\'s mirror is not accepted on the old fingerprint alone', async () => {
  const got = await includedPush({ before: '/a/helper', after: '/a/helper', confirmed: true, asOld: true, mirror: false });
  assert.equal(got.code, 'git-settings-changed');
});

test('a folder entry made with the earlier fingerprint is kept when the settings are as they were, and rewritten in the present form', async () => {
  const got = await includedPush({ before: '/a/helper', after: '/a/helper', confirmed: true, asOld: 'folders' });
  assert.equal(got.ok, true);
  assert.match(Object.values(got.record.folders)[0], /^v2:[0-9a-f]{64}$/);
});

test('a folder entry made with the earlier fingerprint is refused when the settings changed', async () => {
  const got = await includedPush({ before: '/a/helper', after: '/b/other', confirmed: true, asOld: 'folders' });
  assert.equal(got.code, 'git-settings-changed');
});

test('a record from before the settings were kept per folder is refused when the settings changed, with a line that says how to confirm', async () => {
  const { SETTINGS_CHANGED_LINE } = await import('../../../scripts/lib/safe-git.js');
  const old = await includedPush({ before: '/a/helper', after: '/b/other', confirmed: true, asOld: true });
  assert.equal(old.code, 'git-settings-changed');
  assert.match(SETTINGS_CHANGED_LINE, /Wheelhouse shows a card asking you to confirm the new settings here in the chat/);
  assert.doesNotMatch(SETTINGS_CHANGED_LINE, /run setup again/);
  assert.match(SETTINGS_CHANGED_LINE, /^Nothing was pushed/);
});

test('confirming a second folder keeps the first entry and the old value', async () => {
  const got = await includedPush({ before: '/a/helper', after: '/a/helper', confirmed: true, asOld: true, second: true });
  assert.equal(got.ok, true);
  assert.equal(Object.keys(got.record.folders).length, 2);
  assert.ok(got.record.legacy);
});

test('an include that depends on the remote address (hasconfig) is part of what is checked, in the folder git runs in', async () => {
  const when = () => 'hasconfig:remote.*.url:https://github.com/**';
  const remote = 'https://github.com/o/p.git';
  assert.deepEqual(await includedPush({ before: '/a/helper', after: '/a/helper', when, remote }), { ok: true });
  const changed = await includedPush({ before: '/a/helper', after: '/b/other', when, remote });
  assert.equal(changed.code, 'git-settings-changed');
});

test('the private copy a push reads holds no include of its own, only the settings already resolved', async () => {
  const seen = {};
  const got = await includedPush({ before: '/a/helper', after: '/a/helper', seen });
  assert.equal(got.ok, true);
  assert.match(seen.copy, /helper/);
  assert.doesNotMatch(seen.copy, /\[include/i);
  assert.doesNotMatch(seen.copy, /work\.cfg/);
});

test('the fingerprint covers every certificate and ssh setting, and not the environment or the proxy values', async () => {
  const { settingsFingerprint } = await import('../../../scripts/lib/safe-git.js');
  const base = [{ key: 'credential.helper', value: 'a' }];
  const same = settingsFingerprint(base);
  assert.match(same, /^v2:[0-9a-f]{64}$/);
  for (const key of ['http.sslcapath', 'http.sslbackend', 'http.sslcert', 'http.sslkey', 'http.pinnedpubkey', 'http.proxysslcainfo', 'http.extraheader', 'http.https://x.example.org.sslcainfo', 'ssh.variant', 'credential.https://x.example.org.username']) {
    assert.notEqual(settingsFingerprint([...base, { key, value: 'v' }]), same, key);
  }
  // The sign-in, rewrite, header, certificate and include settings, and names that only look like a proxy's, all count.
  assert.notEqual(settingsFingerprint([{ key: 'credential.helper', value: 'b' }]), same, 'credential.helper, another value');
  for (const key of ['url.https://evil.example.org/.insteadof', 'url.https://evil.example.org/.pushinsteadof', 'http.sslverify', 'http.sslcainfo', 'http.https://x.example.org/.extraheader', 'http.https://x.example.org/.sslverify', 'include.path', 'includeif.gitdir:/x/.path', 'remote.origin.url', 'remote.origin.pushurl', 'core.sshcommand', 'http.proxysslcert', 'http.proxy.sslverify', 'http.https://x.example.org/proxy.extraheader', 'remote.proxy.url']) {
    assert.notEqual(settingsFingerprint([...base, { key, value: 'v' }]), same, key);
  }
  assert.equal(settingsFingerprint([...base, { key: 'user.name', value: 'v' }]), same, 'an unrelated setting changes nothing');
  // The proxy values follow the network the computer is on, so they are no part of it, however they are named.
  for (const key of ['http.proxy', 'http.https://corp.example.org/.proxy', 'http.proxyauthmethod', 'http.noproxy', 'remote.origin.proxy', 'remote.origin.proxyauthmethod']) {
    assert.equal(settingsFingerprint([...base, { key, value: 'v' }]), same, key);
    assert.equal(settingsFingerprint([...base, { key, value: 'w' }]), same, `${key}, another value`);
  }
});

test('a proxy-only change does not bring the card back, a record made with the proxy in it is still read, and the record holds no proxy value', async () => {
  const { confirmComputerSettings, lookAtTrusted, proxiedSettingsFingerprint } = await import('../../../scripts/lib/safe-git.js');
  await inFolderWith('[credential]\n\thelper = !/a/helper\n[http]\n\tproxy = http://ada:s3cretpass@p.example.org:8080\n', async ({ folder, file, change }) => {
    await confirmComputerSettings({ file, cwd: folder });
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /s3cretpass|p\.example/);
    assert.equal((await lookAtTrusted({ file, cwd: folder })).same, true);
    // Another network: another proxy, then none.
    change('[credential]\n\thelper = !/a/helper\n[http]\n\tproxy = http://grace:an0therpass@q.example.org:3128\n');
    const moved = await lookAtTrusted({ file, cwd: folder });
    assert.equal(moved.same, true);
    assert.deepEqual(moved.changed, []);
    assert.doesNotMatch(JSON.stringify(moved), /an0therpass|q\.example/);
    change('[credential]\n\thelper = !/a/helper\n');
    assert.equal((await lookAtTrusted({ file, cwd: folder })).same, true);
    // A setting that matters to safety still brings it back.
    change('[credential]\n\thelper = !/a/helper\n[http]\n\tsslCAInfo = /x/ca.pem\n');
    assert.equal((await lookAtTrusted({ file, cwd: folder })).same, false);
  });
  // A record made before the proxy was left out still matches while the proxy is as it was, and not once other settings differ.
  await inFolderWith('[credential]\n\thelper = !/a/helper\n[http]\n\tproxy = http://p.example.org:8080\n', async ({ folder, file, change }) => {
    const { readSettingsFor } = await import('../../../scripts/lib/safe-git.js');
    await confirmComputerSettings({ file, cwd: folder });
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const [folderKey] = Object.keys(record.folders);
    record.folders[folderKey] = proxiedSettingsFingerprint(await readSettingsFor({ cwd: folder }));
    fs.writeFileSync(file, JSON.stringify(record));
    assert.equal((await lookAtTrusted({ file, cwd: folder })).same, true);
    change('[credential]\n\thelper = !/b/other\n[http]\n\tproxy = http://p.example.org:8080\n');
    assert.equal((await lookAtTrusted({ file, cwd: folder })).same, false);
  });
  // A record made with the proxy in it, whose proxy is since taken away (or changed, or its names written in capitals): only the proxy
  // differs, so it is the same settings, and the record is rewritten in the present form. Another difference still brings the card.
  const PROXIES = '[http]\n\tproxy = http://ada:s3cretpass@p.example.org:8080\n\tproxyAuthMethod = basic\n[http "https://other.example.org/"]\n\tProxy = http://q.example.org:3128\n';
  const BASE = '[credential]\n\thelper = !/a/helper\n[http]\n\tsslCAInfo = /x/ca.pem\n';
  for (const [name, now, same] of [
    ['both proxy keys taken away', BASE, true],
    ['the proxy changed', `${BASE}[http]\n\tproxy = http://other.example.org:1\n`, true],
    ['the proxy kept', `${BASE}${PROXIES}`, true],
    ['the proxy taken away and a certificate file changed', BASE.replace('/x/ca.pem', '/y/ca.pem'), false],
    ['the proxy taken away and a helper added', `${BASE}[credential]\n\thelper = !/b/other\n`, false],
    ['the proxy taken away and a rewrite added', `${BASE}[url "ssh://git@o.example.org/"]\n\tinsteadOf = https://o.example.org/\n`, false],
  ]) {
    await inFolderWith(`${BASE}${PROXIES}`, async ({ folder, file, change }) => {
      const { readSettingsFor, settingsFingerprint } = await import('../../../scripts/lib/safe-git.js');
      const { settingName } = await import('../../../scripts/lib/settings-card.js');
      const crypto = await import('node:crypto');
      await confirmComputerSettings({ file, cwd: folder });
      // Make the record as the earlier form did: the proxy keys in the fingerprint, the names and the marks.
      const entries = await readSettingsFor({ cwd: folder });
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      const [folderKey] = Object.keys(record.folders);
      const secret = fs.readFileSync(path.join(path.dirname(file), 'git-settings.key'));
      const lowered = entries.map(({ key, value }) => [key.toLowerCase(), value])
        .filter(([key]) => /^(?:credential\..+|core\.sshcommand|url\..+|http\..+|remote\..+|ssh\..+|include\.path|includeif\..+\.path)$/.test(key));
      const grouped = new Map();
      for (const [key, value] of lowered) grouped.set(settingName(key), [...(grouped.get(settingName(key)) ?? []), [key, value]]);
      record.folders[folderKey] = proxiedSettingsFingerprint(entries);
      record.names[folderKey] = [...grouped.keys()].sort();
      record.marks[folderKey] = Object.fromEntries([...grouped].map(([n, pairs]) => [n, crypto.createHmac('sha256', secret).update(JSON.stringify(pairs)).digest('hex').slice(0, 16)]));
      assert.ok(record.names[folderKey].includes('http.proxy'), 'the old record names the proxy');
      assert.notEqual(record.folders[folderKey], settingsFingerprint(entries));
      fs.writeFileSync(file, JSON.stringify(record));
      change(now);
      assert.equal((await lookAtTrusted({ file, cwd: folder })).same, same, name);
    });
  }
  const entries = [{ key: 'credential.helper', value: 'a' }, { key: 'http.proxy', value: 'p' }];
  assert.match(proxiedSettingsFingerprint(entries), /^v2:[0-9a-f]{64}$/);
  assert.notEqual(proxiedSettingsFingerprint(entries), proxiedSettingsFingerprint([entries[0]]));
});

test('a folder setup never confirmed is refused where a record exists, even one that names other folders', async () => {
  const other = await includedPush({ before: '/a/helper', after: '/a/helper', confirmed: false, record: { folders: { '/somewhere/else': 'a'.repeat(64) } } });
  assert.equal(other.code, 'git-settings-changed');
});

// The names of the settings kept at confirmation, so a later refusal and its card can say which were added or taken away.
async function inFolderWith(config, fn) {
  const { as, shortHome } = await import('../../helpers/homes.js');
  const { spawnSync } = await import('node:child_process');
  const wh = shortHome();
  const folder = fs.realpathSync(tempFolder('wh-names-repo-'));
  spawnSync('git', ['init', '-q'], { cwd: folder });
  const home = fs.realpathSync(tempFolder('wh-names-home-'));
  const names = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GIT_CONFIG_NOSYSTEM'];
  const kept = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1' });
  const change = (text) => fs.writeFileSync(path.join(home, '.gitconfig'), text);
  change(config);
  try {
    return await as(wh, () => fn({ folder, file: path.join(wh, 'host', 'git-settings.json'), change }));
  } finally {
    for (const n of names) if (kept[n] === undefined) delete process.env[n]; else process.env[n] = kept[n];
  }
}

test('confirming keeps the names of the settings, names only, and lookAtTrusted says what changed since', async () => {
  const { confirmComputerSettings, lookAtTrusted } = await import('../../../scripts/lib/safe-git.js');
  const { settingsChange } = await import('../../../scripts/lib/settings-card.js');
  await inFolderWith('[credential]\n\thelper = !/a/helper\n[http "https://corp.example.org/"]\n\tproxy = http://ada:s3cretpass@p.example.org:8080\n', async ({ folder, file, change }) => {
    assert.equal((await lookAtTrusted({ file, cwd: folder })).was, null, 'nothing is recorded yet');
    await confirmComputerSettings({ file, cwd: folder });
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /s3cretpass|corp\.example|p\.example/, 'the record holds names, never an address or a value');
    assert.deepEqual(Object.values(JSON.parse(text).names), [['credential.helper']]);
    const same = await lookAtTrusted({ file, cwd: folder });
    assert.equal(same.same, true);
    // A setting added, one taken away, and a value changed on a name that stays.
    change('[credential]\n\thelper = !/b/other\n[http]\n\tsslCAInfo = /x/ca.pem\n');
    const moved = await lookAtTrusted({ file, cwd: folder });
    assert.equal(moved.same, false);
    assert.deepEqual(settingsChange(moved), { added: ['http.sslcainfo'], removed: [], changed: ['credential.helper'] });
    change('[credential]\n\thelper = !/b/other\n[http "https://corp.example.org/"]\n\tproxy = http://ada:s3cretpass@p.example.org:8080\n');
    const valueOnly = await lookAtTrusted({ file, cwd: folder });
    assert.deepEqual(settingsChange(valueOnly), { added: [], removed: [], changed: ['credential.helper'] }, 'a changed value is named, by name only');
    assert.doesNotMatch(JSON.stringify(valueOnly), /\/b\/other|s3cretpass|corp\.example/, 'no value is in what is read back');
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\/a\/helper|\/b\/other/, 'the record holds marks, never a value');
    // Confirming only what the card named: other settings now are not confirmed.
    await assert.rejects(confirmComputerSettings({ file, cwd: folder, expect: moved.hash.slice(0, 12) }), /changed while the card was open/);
    const now = await lookAtTrusted({ file, cwd: folder });
    await confirmComputerSettings({ file, cwd: folder, expect: now.hash.slice(0, 12) });
    assert.equal((await lookAtTrusted({ file, cwd: folder })).same, true);
  });
});

test('the value marks are keyed with a random key kept in a file of its own, so the record alone can\'t be used to guess a value', async () => {
  const { confirmComputerSettings, lookAtTrusted } = await import('../../../scripts/lib/safe-git.js');
  const crypto = await import('node:crypto');
  await inFolderWith('[credential]\n\thelper = !/a/helper\n', async ({ folder, file, change }) => {
    await confirmComputerSettings({ file, cwd: folder });
    const keyFile = path.join(path.dirname(file), 'git-settings.key');
    assert.equal(fs.readFileSync(keyFile).length, 32, 'the key is 32 random bytes');
    if (process.platform !== 'win32') assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(record.digests, undefined, 'no unkeyed digests are kept');
    const [mark] = Object.values(record.marks);
    // The unkeyed hash of the very value it stands for is not what is kept.
    const pairs = [['credential.helper', '!/a/helper']];
    const plain = crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex').slice(0, 16);
    assert.match(mark['credential.helper'], /^[0-9a-f]{16}$/);
    assert.notEqual(mark['credential.helper'], plain);
    // Without the key (removed, or a new one made), nothing is named: a mark made with another key says nothing about the value.
    change('[credential]\n\thelper = !/b/other\n');
    assert.deepEqual((await lookAtTrusted({ file, cwd: folder })).changed, ['credential.helper']);
    fs.writeFileSync(keyFile, crypto.randomBytes(32));
    assert.deepEqual((await lookAtTrusted({ file, cwd: folder })).changed, [], 'a key that is not the one the marks were made with names nothing');
    fs.rmSync(keyFile);
    assert.deepEqual((await lookAtTrusted({ file, cwd: folder })).changed, [], 'no key names nothing');
    assert.equal(fs.existsSync(keyFile), false, 'a look makes no key');
    // Confirming again makes a new key and marks made with it; the other folders' marks, made with the old key, are let go.
    fs.writeFileSync(file, JSON.stringify({ ...record, marks: { ...record.marks, '/elsewhere': { 'http.proxy': 'a'.repeat(16) } }, digests: { '/old': { 'http.proxy': 'b'.repeat(16) } } }));
    await confirmComputerSettings({ file, cwd: folder });
    const again = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(again.marks).length, 1, 'only the folder confirmed with the new key keeps marks');
    assert.equal(again.digests, undefined, 'unkeyed digests from before are dropped when the record is written');
    change('[credential]\n\thelper = !/c/third\n');
    assert.deepEqual((await lookAtTrusted({ file, cwd: folder })).changed, ['credential.helper']);
  });
});

test('confirming keeps which git program read the settings, and a look by another program says so, with no path', async () => {
  const { confirmComputerSettings, lookAtTrusted } = await import('../../../scripts/lib/safe-git.js');
  const { settingsChange } = await import('../../../scripts/lib/settings-card.js');
  await inFolderWith('[credential]\n\thelper = !/a/helper\n', async ({ folder, file }) => {
    let program = '/opt/one/libexec/git-core';
    const asked = [];
    const stand = (file_, args, options) => {
      if (args[0] === '--exec-path') {
        asked.push(options?.baseEnv !== undefined && !('GIT_EXEC_PATH' in options.baseEnv));
        return Promise.resolve({ code: 0, stdout: `${program}\n`, stderr: '' });
      }
      return run(file_, args, options);
    };
    await confirmComputerSettings({ file, run: stand, cwd: folder });
    assert.equal(fs.readFileSync(file, 'utf8').includes('/opt/one'), true, 'the program is kept in the private record');
    assert.deepEqual(asked, [true], 'GIT_EXEC_PATH is not let in, so it is the program\'s own folder');
    const same = await lookAtTrusted({ file, run: stand, cwd: folder });
    assert.equal(same.otherGit, false);
    program = '/opt/two/libexec/git-core';
    const other = await lookAtTrusted({ file, run: stand, cwd: folder });
    assert.equal(other.otherGit, true);
    assert.equal(settingsChange(other).otherGit, true);
    assert.doesNotMatch(JSON.stringify(other), /\/opt\//, 'no path is in what is read back');
    // A program that can't be told (an old git, a failed call) says nothing either way.
    const unknown = (file_, args, options) => (args[0] === '--exec-path' ? Promise.resolve({ code: 1, stdout: '', stderr: '' }) : run(file_, args, options));
    assert.equal((await lookAtTrusted({ file, run: unknown, cwd: folder })).otherGit, false);
    // Confirming with the other program keeps it in place of the first.
    await confirmComputerSettings({ file, run: stand, cwd: folder });
    assert.equal((await lookAtTrusted({ file, run: stand, cwd: folder })).otherGit, false);
    assert.equal(fs.readFileSync(file, 'utf8').includes('/opt/one'), false);
  });
});

test('a record kept before names were recorded is read as it was, and confirming adds the names beside it', async () => {
  const { confirmComputerSettings, lookAtTrusted } = await import('../../../scripts/lib/safe-git.js');
  const { settingsChange } = await import('../../../scripts/lib/settings-card.js');
  await inFolderWith('[credential]\n\thelper = !/a/helper\n', async ({ folder, file }) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ folders: { '/elsewhere': `v2:${'a'.repeat(64)}` }, legacy: 'b'.repeat(64) }));
    const before = await lookAtTrusted({ file, cwd: folder });
    assert.deepEqual([before.same, before.was, before.changed, settingsChange(before)], [false, null, [], null]);
    await confirmComputerSettings({ file, cwd: folder });
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(record.legacy, 'b'.repeat(64));
    assert.equal(record.folders['/elsewhere'], `v2:${'a'.repeat(64)}`);
    assert.deepEqual(Object.values(record.names), [['credential.helper']]);
    // A record whose names are not lists of text counts for none.
    fs.writeFileSync(file, JSON.stringify({ folders: record.folders, names: { x: 'nope', y: [1] } }));
    assert.equal((await lookAtTrusted({ file, cwd: folder })).was, null);
  });
});
