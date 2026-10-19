// tests/scripts/setup/git.test.js
// How setup runs git (rulings R109, R110): git's global and system config shut out, hooks pointed at
// the null file, no file-system monitor and inert core programs, by environment; and any setting
// of the repository's own config that would run a program or send elsewhere refused, by name,
// before every call. One test for each way a program could be planted: a hook in the global config,
// in the repository's config (directly or by an include), or in its hooks folder; a clean or smudge
// filter; a credential helper; a URL rewrite. Each first shows plain git runs it, where it runs a
// program, so the test proves something on this git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupGit, setupGitEnv, isolated, refuseCommandSettings, commandSettingLine, runsOrSends, NULL_FILE } from '../../../scripts/setup/git.js';
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
  await assert.rejects(git(['update-ref', 'refs/x/setup', r.commit]), { message: commandSettingLine(['hook.planted.event', 'hook.planted.command']) });
  assert.equal(ran(r.mark), false);
  assert.equal((await r.plain(['rev-parse', '-q', '--verify', 'refs/x/setup'], r.bare)).code !== 0, true, 'the call never ran');
  // By an include in the repository's config.
  await r.plain(['config', '--unset-all', 'hook.planted.event'], r.bare);
  await r.plain(['config', '--unset-all', 'hook.planted.command'], r.bare);
  await refuseCommandSettings({ cwd: r.bare });
  const included = path.join(r.root, 'included');
  fs.writeFileSync(included, `[hook "hidden"]\n\tevent = pre-push\n\tcommand = ${hookCommand(r.mark)}\n`);
  await r.plain(['config', 'include.path', included], r.bare);
  await assert.rejects(git(['fetch', '-q', r.bare, '+refs/heads/main:refs/fetched/x']), /would run a program or send elsewhere \(hook\.hidden\.event, hook\.hidden\.command\)/);
  assert.equal(ran(r.mark), false);
  // A config git can't read is refused too, never passed over.
  fs.appendFileSync(path.join(r.bare, 'config'), '[broken\n');
  await assert.rejects(refuseCommandSettings({ cwd: r.bare }), /could not be read/);
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
  assert.deepEqual(pairs.slice(2), [
    ['core.hooksPath', NULL_FILE], ['core.fsmonitor', 'false'],
    ['core.sshCommand', 'false'], ['core.askPass', 'false'], ['core.editor', 'false'], ['core.pager', 'cat'],
  ]);
  assert.equal(env.PATH, '/opt/git/bin:/usr/bin');
  assert.deepEqual(directorGitEnv({ host: 'github', gitPath: '/opt/git/bin/git', env: { PATH: '/usr/bin' }, platform: 'darwin' }), env);
  // Applied twice it is the same; with no sign-in, only the fence.
  assert.deepEqual(isolated(env), env);
  const bare = setupGitEnv({ env: {}, platform: 'darwin' });
  assert.equal(bare.GIT_CONFIG_COUNT, '6');
  assert.equal(bare.GIT_CONFIG_KEY_0, 'core.hooksPath');
});

// A working repository with one commit, a mark file, and plain git in it.
async function workTree() {
  const root = fs.realpathSync.native(tempFolder('wh-setup-work-'));
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  const plain = (args, env = {}) => run('git', ['-c', 'user.name=T', '-c', 'user.email=t@invalid', ...args], { cwd: work, env: { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE, ...env } });
  await plain(['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  await plain(['add', 'a.txt']);
  await plain(['commit', '-q', '-m', 'first']);
  return { root, work, plain, mark: path.join(root, 'program-ran') };
}
const sayRan = (mark) => `sh -c 'echo ran >> "${mark}"; cat'`;

test('a clean filter in the repository\'s config is refused by name before git add, though plain git runs it (ruling R110)', async () => {
  const t = await workTree();
  fs.writeFileSync(path.join(t.work, '.gitattributes'), '*.txt filter=planted\n');
  await t.plain(['config', 'filter.planted.clean', sayRan(t.mark)]);
  fs.writeFileSync(path.join(t.work, 'a.txt'), 'two\n');
  // Plain git, with every outside config shut out as setup's is, runs it on add.
  await t.plain(['add', 'a.txt']);
  assert.equal(ran(t.mark), true, 'this git runs a repository\'s clean filter');
  await t.plain(['reset', '-q']);
  fs.rmSync(t.mark);
  const git = setupGit({ env: setupGitEnv({ host: 'github' }), cwd: t.work });
  await assert.rejects(git(['add', 'a.txt']), { message: commandSettingLine(['filter.planted.clean']) });
  assert.equal(ran(t.mark), false);
  assert.match(commandSettingLine(['filter.planted.clean']), /setup can't go on here with your sign-in/);
});

test('a smudge filter in the repository\'s config is refused by name before a checkout (ruling R110)', async () => {
  const t = await workTree();
  fs.writeFileSync(path.join(t.work, '.gitattributes'), '*.txt filter=planted\n');
  await t.plain(['add', '.gitattributes']);
  await t.plain(['commit', '-q', '-m', 'attributes']);
  await t.plain(['config', 'filter.planted.smudge', sayRan(t.mark)]);
  fs.rmSync(path.join(t.work, 'a.txt'));
  await t.plain(['checkout', '-q', '--', 'a.txt']);
  assert.equal(ran(t.mark), true, 'this git runs a repository\'s smudge filter');
  fs.rmSync(t.mark);
  fs.rmSync(path.join(t.work, 'a.txt'));
  const git = setupGit({ env: setupGitEnv({ host: 'github' }), cwd: t.work });
  await assert.rejects(git(['checkout', '-q', '-f', '--', 'a.txt']), { message: commandSettingLine(['filter.planted.smudge']) });
  assert.equal(ran(t.mark), false);
  assert.equal(fs.existsSync(path.join(t.work, 'a.txt')), false, 'nothing was checked out');
});

test('a credential helper and a URL rewrite in the repository\'s config are refused by name before anything runs (ruling R110)', async () => {
  for (const [key, value] of [['credential.helper', 'store'], ['credential.https://github.com.helper', 'store'], ['url.https://elsewhere.invalid/.insteadOf', 'https://github.com/'], ['url.https://elsewhere.invalid/.pushInsteadOf', 'https://github.com/']]) {
    const t = await workTree();
    await t.plain(['config', key, value]);
    const name = (await t.plain(['config', '--name-only', '--list'])).stdout.split('\n').find((k) => k.startsWith(key.split('.')[0]) && !k.startsWith('core.'));
    let calls = 0;
    const counted = async (file, args, options) => { calls += 1; return run(file, args, options); };
    const git = setupGit({ run: counted, env: setupGitEnv({ host: 'github' }), cwd: t.work });
    await assert.rejects(git(['ls-remote', 'https://github.com/where-is-brett/nothing.git']), { message: commandSettingLine([name]) }, key);
    assert.equal(calls, 1, `${key}: only the look ran`);
  }
});

test('the settings refused are exactly the ones that run a program or send elsewhere (ruling R110)', () => {
  const refused = [
    'hook.x.event', 'filter.lfs.clean', 'filter.x.smudge', 'filter.x.process', 'diff.external', 'diff.x.command', 'diff.x.textconv', 'merge.x.driver',
    'core.sshcommand', 'core.fsmonitor', 'core.editor', 'core.pager', 'core.askpass', 'core.gitproxy', 'credential.helper', 'credential.https://h.helper',
    'gpg.program', 'gpg.ssh.program', 'sequence.editor', 'url.https://x/.insteadof', 'url.https://x/.pushinsteadof',
    'remote.origin.uploadpack', 'remote.origin.receivepack', 'remote.origin.proxy', 'remote.origin.vcs', 'http.proxy', 'http.https://h.proxy',
  ];
  const kept = [
    'core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.precomposeunicode', 'core.autocrlf',
    'remote.origin.url', 'remote.origin.fetch', 'branch.main.remote', 'branch.main.merge', 'user.name', 'diff.renames', 'merge.ff', 'http.postbuffer',
    'extensions.worktreeconfig', 'include.path',
  ];
  for (const key of refused) assert.equal(runsOrSends(key), true, key);
  for (const key of kept) assert.equal(runsOrSends(key), false, key);
});
