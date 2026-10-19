// tests/scripts/setup/git.test.js
// How setup runs git (rulings R109, R110, R111): git's global and system config shut out, hooks
// pointed at the null file, no file-system monitor, no automatic maintenance, no going into
// submodules, inert core programs and https the only transport, by environment; and any setting of
// the repository's own config on the refusal list refused, by name, before every call. One test for
// each way a program could be planted: a hook in the global config, in the repository's config
// (directly or by an include), or in its hooks folder; a clean or smudge filter; a credential
// helper; a URL rewrite; an ext:: transport; an alternate's refs command; a garbage-collection hook;
// a bundle address; a hook in a submodule's own config. Each first shows plain git runs it, where it
// runs a program, so the test proves something on this git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  setupGit, setupGitEnv, isolated, reaching, localPath, refuseCommandSettings, commandSettingLine, runsOrSends, NULL_FILE,
} from '../../../scripts/setup/git.js';
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
    // The fetch reaches a path setup named, so a local path is allowed for it (ruling R111).
    const git = setupGit({ env: reaching(setupGitEnv({ host: 'github' }), r.bare), cwd: r.bare });
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
  assert.equal(env.GIT_ALLOW_PROTOCOL, 'https');
  const pairs = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
  assert.deepEqual(pairs.slice(0, 2), [['credential.helper', ''], ['credential.helper', pairs[1][1]]]);
  assert.match(pairs[1][1], /^!".*gh" auth git-credential$/);
  assert.deepEqual(pairs.slice(2), [
    ['core.hooksPath', NULL_FILE], ['core.fsmonitor', 'false'], ['maintenance.auto', 'false'],
    ['submodule.recurse', 'false'], ['fetch.recurseSubmodules', 'false'], ['push.recurseSubmodules', 'no'],
    ['core.sshCommand', 'false'], ['core.askPass', 'false'], ['core.editor', 'false'], ['core.pager', 'cat'],
  ]);
  assert.equal(env.PATH, '/opt/git/bin:/usr/bin');
  assert.deepEqual(directorGitEnv({ host: 'github', gitPath: '/opt/git/bin/git', env: { PATH: '/usr/bin' }, platform: 'darwin' }), env);
  // Applied twice it is the same; with no sign-in, only the fence.
  assert.deepEqual(isolated(env), env);
  const bare = setupGitEnv({ env: {}, platform: 'darwin' });
  assert.equal(bare.GIT_CONFIG_COUNT, '10');
  assert.equal(bare.GIT_CONFIG_KEY_0, 'core.hooksPath');
  // A local path is allowed only for a call reaching a path setup named, and survives the fence;
  // anything else setup passes is put back to https.
  assert.equal(isolated(reaching(env, '/stand-in/host/o/r.git')).GIT_ALLOW_PROTOCOL, 'https:file');
  assert.equal(isolated(reaching(env, 'C:\\stand-in\\o\\r.git')).GIT_ALLOW_PROTOCOL, 'https:file');
  for (const url of ['https://github.com/o/r.git', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r.git', 'file:///stand-in/o/r.git', 'ext::sh -c x', '/x::y', null]) {
    assert.equal(localPath(url), false, String(url));
    assert.equal(isolated(reaching(env, url)).GIT_ALLOW_PROTOCOL, 'https', String(url));
  }
  assert.equal(isolated({ GIT_ALLOW_PROTOCOL: 'https:file:ext' }).GIT_ALLOW_PROTOCOL, 'https');
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

test('the settings refused are exactly the ones that run a program or send elsewhere (rulings R110, R111)', () => {
  const refused = [
    'hook.x.event', 'filter.lfs.clean', 'filter.x.smudge', 'filter.x.process', 'diff.external', 'diff.x.command', 'diff.x.textconv', 'merge.x.driver',
    'core.sshcommand', 'core.fsmonitor', 'core.editor', 'core.pager', 'core.askpass', 'core.gitproxy', 'credential.helper', 'credential.https://h.helper',
    'gpg.program', 'gpg.ssh.program', 'gpg.ssh.defaultkeycommand', 'sequence.editor', 'url.https://x/.insteadof', 'url.https://x/.pushinsteadof',
    'remote.origin.uploadpack', 'remote.origin.receivepack', 'remote.origin.proxy', 'remote.origin.vcs', 'http.proxy', 'http.https://h.proxy',
    // Ruling R111's sweep.
    'core.alternaterefscommand', 'core.alternaterefsprefixes', 'gc.recentobjectshook', 'fetch.bundleuri', 'bundle.version', 'bundle.b1.uri',
    'protocol.allow', 'protocol.ext.allow', 'protocol.file.allow',
  ];
  const kept = [
    'core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.precomposeunicode', 'core.autocrlf',
    'remote.origin.url', 'remote.origin.fetch', 'branch.main.remote', 'branch.main.merge', 'user.name', 'diff.renames', 'merge.ff', 'http.postbuffer',
    'extensions.worktreeconfig', 'include.path',
    // Settings of commands setup never runs, or that run no program.
    'protocol.version', 'gc.auto', 'gc.pruneexpire', 'fetch.prune', 'fetch.bundlecreationtoken', 'submodule.m.url', 'submodule.m.update',
    'core.hookspath', 'maintenance.auto', 'pager.log', 'mergetool.x.cmd', 'difftool.x.cmd', 'interactive.difffilter', 'alias.co',
  ];
  for (const key of refused) assert.equal(runsOrSends(key), true, key);
  for (const key of kept) assert.equal(runsOrSends(key), false, key);
});

test('an ext:: origin allowed by an included config runs for plain git, and in setup\'s git is refused by name and can\'t run (ruling R111)', async () => {
  const t = await workTree();
  const included = path.join(t.root, 'included');
  fs.writeFileSync(included, `[protocol "ext"]\n\tallow = always\n[remote "origin"]\n\turl = "ext::sh -c touch% ${t.mark}"\n`);
  // The include comes before origin's own https address, so git's first address for origin is ext::.
  await t.plain(['config', 'include.path', included]);
  await t.plain(['remote', 'add', 'origin', 'https://github.com/where-is-brett/nothing.git']);
  await t.plain(['fetch', '-q', 'origin', 'main']);
  assert.equal(ran(t.mark), true, 'plain git runs the ext:: command');
  fs.rmSync(t.mark);
  const git = setupGit({ env: setupGitEnv({ host: 'github' }), cwd: t.work });
  await assert.rejects(git(['fetch', '-q', 'origin', 'main']), { message: commandSettingLine(['protocol.ext.allow']) });
  assert.equal(ran(t.mark), false);
  // The transports alone stop it too, with the look left out: https only, or https and a local path.
  for (const env of [setupGitEnv({ host: 'github' }), reaching(setupGitEnv({ host: 'github' }), t.root)]) {
    const got = await run('git', ['fetch', '-q', 'origin', 'main'], { cwd: t.work, env: isolated(env), baseEnv: {} });
    assert.notEqual(got.code, 0);
    assert.match(got.stderr, /transport 'ext' not allowed/);
    assert.equal(ran(t.mark), false, env.GIT_ALLOW_PROTOCOL ?? 'https');
  }
});

test('an alternate\'s refs command runs on a plain fetch, and is refused by name in setup\'s git (ruling R111)', async () => {
  const r = await repository();
  const t = await workTree();
  fs.writeFileSync(path.join(t.work, '.git', 'objects', 'info', 'alternates'), `${path.join(r.bare, 'objects')}\n`);
  await t.plain(['config', 'core.alternateRefsCommand', `echo ran >> "${t.mark}"; true`]);
  await t.plain(['config', 'core.alternateRefsPrefixes', 'refs/heads/']);
  await t.plain(['fetch', '-q', r.bare, '+refs/heads/main:refs/remotes/x/main']);
  assert.equal(ran(t.mark), true, 'plain git runs the alternate\'s refs command on fetch');
  fs.rmSync(t.mark);
  const git = setupGit({ env: reaching(setupGitEnv({ host: 'github' }), r.bare), cwd: t.work });
  await assert.rejects(git(['fetch', '-q', r.bare, '+refs/heads/main:refs/remotes/y/main']),
    { message: commandSettingLine(['core.alternaterefscommand', 'core.alternaterefsprefixes']) });
  assert.equal(ran(t.mark), false);
});

// Writes two loose objects into objects/17/, the folder git counts to decide on automatic
// maintenance (more than one there passes `gc.auto = 1`), aged past `gc.pruneExpire`, so the next
// commit's maintenance considers removing them.
async function oldLooseObjects(t, seed) {
  const old = new Date('2020-01-01T00:00:00Z');
  for (let i = 0, written = 0; written < 2; i += 1) {
    const text = `${seed} ${i}\n`;
    if (!crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex').startsWith('17')) continue;
    const oid = (await run('git', ['hash-object', '-w', '--stdin'], { cwd: t.work, input: text })).stdout.trim();
    fs.utimesSync(path.join(t.work, '.git', 'objects', oid.slice(0, 2), oid.slice(2)), old, old);
    written += 1;
  }
}

test('a garbage-collection hook runs in a plain commit\'s automatic maintenance, and is refused by name in setup\'s git, whose maintenance is off (ruling R111)', async () => {
  const t = await workTree();
  for (const [key, value] of [['gc.auto', '1'], ['gc.pruneExpire', '1.hour.ago'], ['gc.autoDetach', 'false'], ['maintenance.autoDetach', 'false']]) await t.plain(['config', key, value]);
  await t.plain(['config', 'gc.recentObjectsHook', `echo ran >> "${t.mark}"`]);
  await oldLooseObjects(t, 'control');
  await t.plain(['commit', '-q', '--allow-empty', '-m', 'control']);
  assert.equal(ran(t.mark), true, 'plain git runs the hook in a commit\'s automatic maintenance');
  fs.rmSync(t.mark);
  await oldLooseObjects(t, 'setup');
  const identity = ['-c', 'user.name=T', '-c', 'user.email=t@invalid'];
  const git = setupGit({ env: setupGitEnv({ host: 'github' }), cwd: t.work });
  await assert.rejects(git([...identity, 'commit', '-q', '--allow-empty', '-m', 'setup']), { message: commandSettingLine(['gc.recentobjectshook']) });
  // The fence alone, with the look left out: no automatic maintenance, so the hook never runs.
  const got = await run('git', [...identity, 'commit', '-q', '--allow-empty', '-m', 'fenced'], { cwd: t.work, env: isolated(setupGitEnv({ host: 'github' })), baseEnv: {} });
  assert.equal(got.code, 0);
  assert.equal(ran(t.mark), false);
});

test('a bundle address is fetched from by a plain fetch, and is refused by name in setup\'s git (ruling R111)', async () => {
  const r = await repository();
  const t = await workTree();
  // A local port that refuses at once: nothing leaves this computer.
  await t.plain(['config', 'fetch.bundleURI', 'https://127.0.0.1:9/bundles']);
  await t.plain(['config', 'fetch.bundleCreationToken', '1']);
  const trace = path.join(t.root, 'trace');
  await t.plain(['fetch', '-q', r.bare, '+refs/heads/main:refs/remotes/x/main'], { GIT_TRACE: trace });
  assert.match(fs.readFileSync(trace, 'utf8'), /git-remote-https https:\/\/127\.0\.0\.1:9\/bundles/, 'plain git goes to the bundle address');
  let calls = 0;
  const counted = async (file, args, options) => { calls += 1; return run(file, args, options); };
  const git = setupGit({ run: counted, env: reaching(setupGitEnv({ host: 'github' }), r.bare), cwd: t.work });
  await assert.rejects(git(['fetch', '-q', r.bare, '+refs/heads/main:refs/remotes/y/main']), { message: commandSettingLine(['fetch.bundleuri']) });
  assert.equal(calls, 1, 'only the look ran');
});

// A project folder with a submodule, whose superproject's main, on its bare remote, has moved the
// submodule on since: a fetch of main then goes into the submodule. The submodule's own config
// (never the project's) declares a hook.
async function withSubmodule() {
  const root = fs.realpathSync.native(tempFolder('wh-setup-sub-'));
  const mark = path.join(root, 'hook-ran');
  const env = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE };
  const plain = (cwd, ...args) => run('git', ['-c', 'user.name=T', '-c', 'user.email=t@invalid', '-c', 'protocol.file.allow=always', ...args], { cwd, env });
  const subBare = path.join(root, 'sub.git');
  const superBare = path.join(root, 'super.git');
  const subWork = path.join(root, 'sub');
  const project = path.join(root, 'project');
  const other = path.join(root, 'other');
  for (const dir of [subWork, project]) fs.mkdirSync(dir);
  await plain(root, 'init', '-q', '--bare', '-b', 'main', subBare);
  await plain(root, 'init', '-q', '--bare', '-b', 'main', superBare);
  await plain(subWork, 'init', '-q', '-b', 'main');
  await plain(subWork, 'commit', '-q', '--allow-empty', '-m', 'one');
  await plain(subWork, 'push', '-q', subBare, 'main');
  await plain(project, 'init', '-q', '-b', 'main');
  await plain(project, 'submodule', 'add', '-q', subBare, 'm');
  await plain(project, 'commit', '-q', '-m', 'submodule');
  await plain(project, 'push', '-q', superBare, 'main');
  await plain(subWork, 'commit', '-q', '--allow-empty', '-m', 'two');
  await plain(subWork, 'push', '-q', subBare, 'main');
  await plain(root, 'clone', '-q', '--recurse-submodules', superBare, other);
  await plain(path.join(other, 'm'), 'pull', '-q', 'origin', 'main');
  await plain(other, 'commit', '-q', '-am', 'move the submodule on');
  await plain(other, 'push', '-q', superBare, 'main');
  await plain(path.join(project, 'm'), 'config', 'hook.planted.event', 'reference-transaction');
  await plain(path.join(project, 'm'), 'config', 'hook.planted.command', `echo ran >> "${mark}"`);
  return { project, superBare, mark };
}

test('a hook in a submodule\'s own config runs when a fetch goes into the submodule, and setup\'s git never goes there (ruling R111)', async () => {
  // Plain git, with every outside config shut out and hooks and the monitor off as before R111.
  const control = await withSubmodule();
  const before = {
    GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE, GIT_ALLOW_PROTOCOL: 'https:file',
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: NULL_FILE, GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false',
  };
  await run('git', ['fetch', '-q', control.superBare, '+refs/heads/main:refs/remotes/origin/main'], { cwd: control.project, env: before, baseEnv: {} });
  assert.equal(ran(control.mark), true, 'git ran the submodule\'s hook: its own git there carries none of the parent\'s settings');
  const s = await withSubmodule();
  const git = setupGit({ env: reaching(setupGitEnv({ host: 'github' }), s.superBare), cwd: s.project });
  assert.equal((await git(['fetch', '-q', s.superBare, '+refs/heads/main:refs/remotes/origin/main'])).code, 0);
  assert.equal((await git(['checkout', '-q', '-f', '-B', 'main', 'refs/remotes/origin/main'])).code, 0);
  assert.equal(ran(s.mark), false);
});
