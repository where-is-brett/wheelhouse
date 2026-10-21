// tests/scripts/lib/safe-git.test.js
// The shared fenced route for git, against a real git in temporary repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  reachFor, safeGitEnv, safeGit, directorSignIn,
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
  const top = async (env, options) => (await git2(['rev-parse', '--show-toplevel'], { env, ...options })).stdout.trim();
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
