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
  const got = await safeGit({ cwd: r.root, look: 'never' })(['fetch', `ext::sh -c 'echo ran >> "${r.mark}"'`, 'main']);
  assert.notEqual(got.code, 0);
  assert.equal(fs.existsSync(r.mark), false);
});
