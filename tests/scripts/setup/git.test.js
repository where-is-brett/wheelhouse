// tests/scripts/setup/git.test.js
// How setup runs git (ruling R109): git's global and system config shut out, hooks pointed at the
// null file and no file-system monitor, by environment; and a hook the repository's own config
// declares refused, by name, before every call. One test for each way a hook could be planted: in
// the global config, in the repository's config (directly or by an include), and in its hooks
// folder. Each first shows the hook runs for plain git, so the test proves something on this git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupGit, setupGitEnv, isolated, refuseConfigHooks, configHookLine, NULL_FILE } from '../../../scripts/setup/git.js';
import { directorGitEnv } from '../../../scripts/setup/host.js';
import { run } from '../../../scripts/lib/run.js';
import { tempFolder } from '../../helpers/homes.js';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// A bare repository with one commit on main, and a mark file a planted hook would write to.
async function repository() {
  const root = fs.realpathSync.native(tempFolder('wh-setup-git-'));
  const bare = path.join(root, 'repo.git');
  const plain = (args, cwd = root, env = {}) => run('git', args, { cwd, env: { GIT_TERMINAL_PROMPT: '0', ...env } });
  await plain(['init', '-q', '--bare', bare]);
  const commit = (await plain(['-c', 'user.name=T', '-c', 'user.email=t@invalid', 'commit-tree', EMPTY_TREE, '-m', 'first'], bare)).stdout.trim();
  await plain(['update-ref', 'refs/heads/main', commit], bare);
  return { root, bare, commit, mark: path.join(root, 'hook-ran'), plain };
}
const hookCommand = (mark) => `echo ran >> "${mark}"`;
const ran = (mark) => fs.existsSync(mark);

test('a hook declared in git\'s global config never runs in setup\'s git, though plain git runs it', async () => {
  const r = await repository();
  const globalFile = path.join(r.root, 'global-config');
  fs.writeFileSync(globalFile, `[hook "planted"]\n\tevent = reference-transaction\n\tcommand = ${hookCommand(r.mark)}\n`);
  // Plain git, reading that global config, runs it.
  await r.plain(['update-ref', 'refs/x/control', r.commit], r.bare, { GIT_CONFIG_GLOBAL: globalFile });
  assert.equal(ran(r.mark), true, 'this git runs config-declared hooks');
  fs.rmSync(r.mark);
  // Setup's git shuts the global config out (and the system's), whatever the home holds.
  const before = process.env.HOME;
  process.env.HOME = r.root;
  fs.copyFileSync(globalFile, path.join(r.root, '.gitconfig'));
  try {
    const git = setupGit({ env: setupGitEnv({ host: 'github' }), cwd: r.bare });
    assert.equal((await git(['update-ref', 'refs/x/setup', r.commit])).code, 0);
    assert.equal((await git(['fetch', '-q', '--no-tags', r.bare, '+refs/heads/main:refs/fetched/profile'])).code, 0);
  } finally {
    process.env.HOME = before;
  }
  assert.equal(ran(r.mark), false, 'the global hook never ran');
});

test('a hook declared in the repository\'s own config, directly or by an include, is refused by name, and never runs', async () => {
  const r = await repository();
  await r.plain(['config', 'hook.planted.event', 'reference-transaction'], r.bare);
  await r.plain(['config', 'hook.planted.command', hookCommand(r.mark)], r.bare);
  const git = setupGit({ env: setupGitEnv({ host: 'github' }), cwd: r.bare });
  await assert.rejects(git(['update-ref', 'refs/x/setup', r.commit]), { message: configHookLine(['hook.planted.event', 'hook.planted.command']) });
  assert.equal(ran(r.mark), false);
  assert.equal((await r.plain(['rev-parse', '-q', '--verify', 'refs/x/setup'], r.bare)).code !== 0, true, 'the call never ran');
  // By an include in the repository's config.
  await r.plain(['config', '--unset-all', 'hook.planted.event'], r.bare);
  await r.plain(['config', '--unset-all', 'hook.planted.command'], r.bare);
  await refuseConfigHooks({ cwd: r.bare });
  const included = path.join(r.root, 'included');
  fs.writeFileSync(included, `[hook "hidden"]\n\tevent = pre-push\n\tcommand = ${hookCommand(r.mark)}\n`);
  await r.plain(['config', 'include.path', included], r.bare);
  await assert.rejects(git(['fetch', '-q', r.bare, '+refs/heads/main:refs/fetched/x']), /declares a hook \(hook\.hidden\.event, hook\.hidden\.command\)/);
  assert.equal(ran(r.mark), false);
  // A config git can't read is refused too, never passed over.
  fs.appendFileSync(path.join(r.bare, 'config'), '[broken\n');
  await assert.rejects(refuseConfigHooks({ cwd: r.bare }), /could not be read/);
});

test('a hook in the repository\'s hooks folder never runs in setup\'s git', async () => {
  const r = await repository();
  const hooks = path.join(r.bare, 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, 'reference-transaction'), `#!/bin/sh\n${hookCommand(r.mark)}\n`, { mode: 0o755 });
  await r.plain(['update-ref', 'refs/x/control', r.commit], r.bare);
  assert.equal(ran(r.mark), true, 'plain git runs it');
  fs.rmSync(r.mark, { force: true });
  const git = setupGit({ env: setupGitEnv({ host: 'gitlab' }), cwd: r.bare });
  assert.equal((await git(['update-ref', 'refs/x/setup', r.commit])).code, 0);
  assert.equal(ran(r.mark), false);
});

test('setup\'s environment passes only the sign-in and the fence, and the director\'s environment is the same one', () => {
  const env = setupGitEnv({ host: 'github', gitPath: '/opt/git/bin/git', env: { PATH: '/usr/bin' }, platform: 'darwin' });
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_CONFIG_GLOBAL, NULL_FILE);
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  const pairs = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
  assert.deepEqual(pairs.slice(0, 2), [['credential.helper', ''], ['credential.helper', pairs[1][1]]]);
  assert.match(pairs[1][1], /^!".*gh" auth git-credential$/);
  assert.deepEqual(pairs.slice(2), [['core.hooksPath', NULL_FILE], ['core.fsmonitor', 'false']]);
  assert.equal(env.PATH, '/opt/git/bin:/usr/bin');
  assert.deepEqual(directorGitEnv({ host: 'github', gitPath: '/opt/git/bin/git', env: { PATH: '/usr/bin' }, platform: 'darwin' }), env);
  // Applied twice it is the same; with no sign-in, only the fence.
  assert.deepEqual(isolated(env), env);
  const bare = setupGitEnv({ env: {}, platform: 'darwin' });
  assert.equal(bare.GIT_CONFIG_COUNT, '2');
  assert.equal(bare.GIT_CONFIG_KEY_0, 'core.hooksPath');
});
