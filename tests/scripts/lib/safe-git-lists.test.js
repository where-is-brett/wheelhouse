// tests/scripts/lib/safe-git-lists.test.js
// The two allowed lists behind the fenced git route (the own list and the project list), the fence's
// signing and credential rules, and the scans that the project list's conditional rows rest on.
// Each test makes throwaway repositories with git's global and system config shut out, plants a
// setting, and runs the route. A "marker" is a Node script that writes a file; a test asserts the
// file is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  safeGit, safeGitEnv, directorSignIn, lookAtSettings, lookRefusalLine, LookRefusal, allowedProjectSetting,
  PROJECT_OVERRIDDEN, PROJECT_WHOLE_SECTIONS, PROJECT_CONDITIONS,
} from '../../../scripts/lib/safe-git.js';
import { allowedSetting, FENCE, NULL_FILE } from '../../../scripts/setup/git.js';
import { git as stateGit } from '../../../scripts/state/git.js';
import { fetchedPath } from '../../../scripts/lib/host-tools.js';
import { surveyProject, repositoryOf } from '../../../scripts/install/survey.js';
import { run } from '../../../scripts/lib/run.js';
import { tempFolder } from '../../helpers/homes.js';
import { startHttpHost } from '../../helpers/http-host.js';
import { LOOPBACK_HTTP } from '../../helpers/git-fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const unix = process.platform !== 'win32';

// --- Fixtures ---

// git with the global and system config shut out, for building and probing throwaway repositories.
// A variable of the test machine's own (an editor, a pager, an ssh command) would outrank the settings these tests plant.
const SHUT = {
  GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE,
  GIT_EDITOR: undefined, GIT_PAGER: undefined, GIT_SSH_COMMAND: undefined, GIT_SSH: undefined, GIT_ASKPASS: undefined, SSH_ASKPASS: undefined,
  EDITOR: undefined, VISUAL: undefined, PAGER: undefined,
};
const plain = (args, cwd, env = {}) => run('git', args, { cwd, env: { ...SHUT, ...env } });
async function must(args, cwd, env) {
  const got = await plain(args, cwd, env);
  assert.equal(got.code, 0, `git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}
const NAME = ['-c', 'user.name=T', '-c', 'user.email=t@invalid'];
// For plain git; the fenced route refuses a `-c` that sets a key of the fence, commit.gpgSign among them.
const ID = [...NAME, '-c', 'commit.gpgSign=false'];
const commitIn = (cwd, message = 'x') => must([...ID, 'commit', '--allow-empty', '-q', '-m', message], cwd);
const setting = (cwd, key, value) => must(['config', key, value], cwd);

async function newRepo(prefix = 'wh-lists-') {
  const root = fs.realpathSync.native(tempFolder(prefix));
  const dir = path.join(root, 'repo');
  await must(['init', '-q', '-b', 'main', dir], root);
  return { root, dir };
}

// A project with an origin (a bare repository beside it) and one commit pushed on main.
async function projectWithOrigin() {
  const { root, dir } = await newRepo();
  await commitIn(dir, 'one');
  const origin = path.join(root, 'origin.git');
  await must(['init', '-q', '--bare', origin], root);
  await must(['remote', 'add', 'origin', origin], dir);
  await must(['push', '-q', '-u', 'origin', 'main'], dir);
  await must(['remote', 'set-head', 'origin', 'main'], dir);
  return { root, dir, origin };
}

// A program that writes `<name>.ran` in `folder`. `cmd` is the command line to plant as a setting.
function marker(folder, name) {
  const script = path.join(folder, `${name}.cjs`);
  const mark = path.join(folder, `${name}.ran`);
  fs.writeFileSync(script, `require('node:fs').appendFileSync(${JSON.stringify(mark)}, 'ran\\n');\nprocess.exit(1);\n`);
  const q = (p) => `"${p.replaceAll('\\', '/')}"`;
  return { cmd: `${q(process.execPath)} ${q(script)}`, mark };
}
// As `marker`, but a single executable file (a shell script), for the settings git starts as a program
// without a shell (the signing programs). Unix only.
function programMarker(folder, name) {
  const file = path.join(folder, `${name}.sh`);
  const mark = path.join(folder, `${name}.ran`);
  fs.writeFileSync(file, `#!/bin/sh\necho ran >> "${mark}"\nexit 1\n`, { mode: 0o755 });
  return { cmd: file, mark };
}
const ran = (m) => fs.existsSync(m.mark);
const clear = (m) => fs.rmSync(m.mark, { force: true });

// --- Test 1: two lists ---

test('1: a project-list key passes the project look and is refused by the own look', async () => {
  const { dir } = await newRepo();
  await setting(dir, 'core.longpaths', 'true');
  assert.deepEqual(await lookAtSettings({ cwd: dir, list: 'project' }), { keys: [] });
  assert.deepEqual(await lookAtSettings({ cwd: dir, list: 'own' }), { keys: ['core.longpaths'] });
  assert.deepEqual(await lookAtSettings({ cwd: dir }), { keys: ['core.longpaths'] }, 'the default list is the own list');
  for (const caller of ['foreman', 'survey', 'feature']) {
    const got = await safeGit({ cwd: dir, caller, list: 'project', look: 'each' })(['status', '--porcelain']);
    assert.equal(got.code, 0, caller);
  }
  for (const caller of ['helper', 'reinstall']) {
    await assert.rejects(safeGit({ cwd: dir, caller, look: 'each' })(['status']), LookRefusal, caller);
    await assert.rejects(safeGit({ cwd: dir, caller, list: 'own', look: 'once' })(['status']), /core\.longpaths/, caller);
  }
  // Without a caller, setup's own wording is used on either list.
  await assert.rejects(safeGit({ cwd: dir })(['status']), /core\.longpaths/);
  assert.equal((await safeGit({ cwd: dir, list: 'project' })(['status', '--porcelain'])).code, 0);
});

test('1: an unknown list throws, and the default fails closed', async () => {
  assert.throws(() => safeGit({ cwd: process.cwd(), list: 'wide' }), /unknown list/);
  await assert.rejects(lookAtSettings({ cwd: process.cwd(), list: 'wide' }), /unknown list/);
});

test('1: the survey takes the project list in a real run, and the callers are the ones the list is meant for', async () => {
  const { dir } = await projectWithOrigin();
  await setting(dir, 'core.longpaths', 'true');
  await setting(dir, 'core.fscache', 'true');
  const survey = await surveyProject({
    folder: dir, manifest: { upstreams: [] }, host: 'github', claudeHome: tempFolder('wh-claude-'),
    run: async (file, args, options) => (file === 'gh' ? { code: 0, stdout: '[]', stderr: '' } : run(file, args, options)),
  });
  assert.ok(Array.isArray(survey.skills) && survey.inFlight.behind === 0, 'the survey went through');
  // Which route takes which list is written where the route is made.
  const text = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const file of ['scripts/foreman/act.js', 'scripts/feature/cli.js', 'scripts/install/survey.js']) assert.match(text(file), /list: 'project'/, file);
  assert.doesNotMatch(text('scripts/lineage/release.js'), /list: 'project'/);
  assert.doesNotMatch(text('scripts/state/git.js'), /list: 'project'/);
  const helper = text('scripts/host/helper.js');
  const looks = [...helper.matchAll(/lookOnce\(([^\n]*)\)/g)].map((m) => m[1]);
  const wide = looks.filter((l) => /'project'/.test(l));
  assert.equal(wide.length, 1, 'only one look in the helper takes the project list');
  assert.match(wide[0], /folder being copied from/);
});

// --- Test 2: every family ---

const ALLOWED_PROJECT = [
  // core: storage, speed, line handling
  'core.longpaths', 'core.fscache', 'core.untrackedcache', 'core.splitindex', 'core.commitgraph', 'core.multipackindex',
  'core.preloadindex', 'core.checkstat', 'core.trustctime', 'core.whitespace', 'core.abbrev', 'core.compression',
  'core.sparsecheckout', 'core.sparsecheckoutcone',
  // core: overridden
  'core.fsmonitor', 'core.fsmonitorhookversion', 'core.sshcommand', 'core.askpass', 'core.editor', 'core.pager',
  // identity
  'user.name', 'user.email', 'user.signingkey', 'user.useconfigonly', 'author.name', 'committer.email',
  // signing, overridden
  'commit.gpgsign', 'tag.gpgsign', 'push.gpgsign', 'log.showsignature', 'merge.verifysignatures', 'gpg.format',
  // credentials
  'credential.helper', 'credential.https://example.com.helper', 'credential.username', 'credential.https://example.com.username',
  'credential.usehttppath', 'credential.https://example.com.usehttppath',
  // tools' own keys
  'branch.main.vscode-merge-base', 'branch.main.github-pr-owner-number', 'branch.feature/x.gk-merge-base', 'branch.main.pushremote',
  // remotes
  'remote.origin.tagopt', 'remote.origin.prune', 'remote.origin.prunetags', 'remote.origin.push', 'remote.origin.partialclonefilter',
  'remote.origin.promisor', 'remote.origin.followremotehead', 'remote.origin.skipdefaultupdate', 'remote.origin.skipfetchall',
  'remote.origin.pushurl', 'remote.pushdefault',
  // http: plain transfer sizes, and the plain sslverify
  'http.postbuffer', 'http.version', 'http.lowspeedlimit', 'http.lowspeedtime', 'http.maxrequests', 'http.sslverify',
  'protocol.version',
  // submodules
  'submodule.sub.url', 'submodule.sub.path', 'submodule.sub.active', 'submodule.sub.branch', 'submodule.sub.ignore', 'submodule.sub.shallow',
  'submodule.active', 'submodule.recurse', 'submodule.sub.fetchrecursesubmodules',
  'lfs.repositoryformatversion', 'lfs.url', 'lfs.customtransfer.x.path',
  'merge.conflictstyle', 'rebase.autostash', 'rebase.autosquash', 'rebase.updaterefs',
  'alias.co',
  'fetch.prune', 'fetch.prunetags', 'fetch.writecommitgraph', 'fetch.parallel', 'fetch.showforcedupdates', 'fetch.unpacklimit',
  'fetch.negotiationalgorithm', 'fetch.output', 'fetch.recursesubmodules', 'push.recursesubmodules',
  'push.default', 'push.autosetupremote', 'push.followtags', 'push.useforceifincludes',
  'maintenance.auto', 'maintenance.strategy', 'maintenance.gc.enabled',
  'gc.auto', 'gc.autodetach', 'gc.autopacklimit', 'gc.writecommitgraph', 'gc.cruftpacks', 'gc.reflogexpire', 'gc.reflogexpireunreachable', 'gc.pruneexpire',
  'pack.threads', 'index.version', 'feature.manyfiles', 'commitgraph.generationversion', 'status.showuntrackedfiles', 'log.date',
  'column.ui', 'gui.encoding', 'rerere.enabled', 'blame.ignorerevsfile',
  'checkout.defaultremote', 'checkout.workers', 'checkout.thresholdforparallelism', 'worktree.guessremote', 'worktree.userelativepaths',
  'extensions.partialclone', 'extensions.preciousobjects', 'init.defaultbranch',
];
const REFUSED = [
  // core: moves where git writes, runs a program, or reads files
  'core.worktree', 'core.gitproxy', 'core.alternaterefscommand', 'core.attributesfile', 'core.excludesfile', 'core.sharedrepository', 'core.somethingelse',
  // gpg programs
  'gpg.program', 'gpg.ssh.program', 'gpg.openpgp.program', 'gpg.ssh.defaultkeycommand', 'gpg.ssh.allowedsignersfile',
  // other credential keys
  'credential.validate', 'credential.https://example.com.useless',
  'branch.main.mergeoptions',
  // remote: proxy, serving, helper, mirror, serveroption
  'remote.origin.proxy', 'remote.origin.uploadpack', 'remote.origin.receivepack', 'remote.origin.vcs', 'remote.origin.mirror', 'remote.origin.serveroption',
  'url.https://x.insteadof', 'url.https://x.pushinsteadof',
  // http beyond the plain few
  'http.https://example.com.sslverify', 'http.https://example.com.proxy', 'http.proxy', 'http.sslcainfo', 'http.sslcapath', 'http.sslbackend',
  'http.sslcert', 'http.extraheader', 'http.cookiefile', 'http.something',
  'protocol.allow', 'protocol.file.allow',
  'submodule.sub.update',
  'filter.lfs.clean', 'filter.lfs.process', 'filter.x.smudge',
  'diff.external', 'diff.x.textconv', 'difftool.x.cmd', 'merge.x.driver', 'mergetool.x.cmd', 'sequence.editor', 'trailer.x.command', 'sendemail.smtpserver', 'pager.log',
  'hook.x.command', 'hook.x.event',
  'fetch.bundleuri', 'fetch.fsckobjects', 'fetch.fsck.x', 'transfer.fsckobjects', 'fsck.x', 'receive.fsckobjects', 'uploadpack.packobjectshook', 'uploadarchive.x',
  'gc.recentobjectshook',
  'init.templatedir', 'safe.directory',
  'something.else', 'alias.x.y',
];

test('2: one key from each allowed row passes the project list; own-list keys are unchanged', () => {
  for (const key of ALLOWED_PROJECT) {
    assert.equal(allowedProjectSetting(key), true, key);
  }
  // R112's own list is unchanged and narrower.
  for (const key of ['core.longpaths', 'core.fsmonitor', 'commit.gpgsign', 'credential.helper', 'remote.origin.pushurl', 'gc.auto', 'lfs.url']) assert.equal(allowedSetting(key), false, key);
  for (const key of ['core.filemode', 'remote.origin.url', 'branch.main.merge', 'pull.rebase', 'color.ui', 'advice.x', 'include.path']) {
    assert.equal(allowedSetting(key), true, key);
    assert.equal(allowedProjectSetting(key), true, key);
  }
});

test('2: one key from each refused row is refused by the project list, and by the own list', () => {
  for (const key of REFUSED) {
    assert.equal(allowedProjectSetting(key), false, key);
    assert.equal(allowedSetting(key), false, key);
  }
});

test('2: sections and keys match in any case, subsections as written; remote names keep R113', () => {
  assert.equal(allowedProjectSetting('CORE.LongPaths'), true);
  assert.equal(allowedProjectSetting('Branch.Main.VSCode-Merge-Base'), true);
  assert.equal(allowedProjectSetting('remote.a/b.prune'), false);
  assert.equal(allowedProjectSetting('remote.a\\b.pushurl'), false);
  assert.equal(allowedProjectSetting('remote.a:b.tagopt'), false);
  assert.equal(allowedProjectSetting('remote.a/b.gh-resolved'), false);
  assert.equal(allowedProjectSetting('remote..prune'), false);
  assert.equal(allowedProjectSetting('branch..vscode-merge-base'), false);
  assert.equal(allowedProjectSetting('core.'), false);
  assert.equal(allowedProjectSetting('core'), false);
  assert.equal(allowedProjectSetting(undefined), false);
  assert.equal(allowedProjectSetting('x-y.longpaths'), false);
});

test('2: the conditional rows follow the scans (tests 9 and 10)', () => {
  assert.equal(allowedProjectSetting('remote.origin.gh-resolved'), PROJECT_CONDITIONS.ghNamesRepository);
  assert.equal(allowedProjectSetting('remote.origin.some-tool-key'), PROJECT_CONDITIONS.ghNamesRepository);
  for (const key of ['remote.origin.pushurl', 'remote.pushdefault', 'branch.main.pushremote']) assert.equal(allowedProjectSetting(key), PROJECT_CONDITIONS.noPushFromProject, key);
  // A hyphenated key under branch. does not wait for the gh scan.
  assert.equal(allowedProjectSetting('branch.main.some-tool-key'), true);
});

// --- Test 3: overridden keys are in the fence ---

test('3: every key the project list allows as overridden is in the fence (or is the credential reset)', () => {
  const fence = new Map(FENCE.map(([key, value]) => [key.toLowerCase(), value]));
  assert.ok(PROJECT_OVERRIDDEN.length >= 15);
  for (const [listed, by] of PROJECT_OVERRIDDEN) {
    assert.equal(allowedProjectSetting(listed.replace('<name>', 'sub').replace('<url>', 'https://example.com')), true, listed);
    if (by === 'credential.helper') continue;
    assert.ok(fence.has(by), `${listed} is overridden by ${by}, which the fence does not set`);
  }
  // The five signing keys are in the fence, switched off.
  for (const key of ['commit.gpgsign', 'tag.gpgsign', 'push.gpgsign', 'log.showsignature', 'merge.verifysignatures']) assert.equal(fence.get(key), 'false', key);
  assert.equal(fence.get('maintenance.auto'), 'false');
  assert.equal(fence.get('http.sslverify'), 'true');
  // The credential reset: first of every call's own pairs.
  const pairs = Array.from({ length: Number(safeGitEnv({}).GIT_CONFIG_COUNT) }, (_, i) => [safeGitEnv({})[`GIT_CONFIG_KEY_${i}`], safeGitEnv({})[`GIT_CONFIG_VALUE_${i}`]]);
  assert.deepEqual(pairs[0], ['credential.helper', '']);
  assert.ok(PROJECT_OVERRIDDEN.some(([, by]) => by === 'credential.helper'));
});

// --- Test 4: the fence's override holds at run time ---

test('4: core.fsmonitor, pager, editor, sshCommand and askPass set to programs run nothing on any route', async () => {
  const { root, dir } = await projectWithOrigin();
  // A commit ahead of origin, for the feature's pull, made before any marker is planted.
  await commitIn(dir, 'two');
  const sha = await must(['rev-parse', 'HEAD'], dir);
  await must(['update-ref', 'refs/wheelhouse/pulled', sha], dir);
  const marks = {
    fsmonitor: marker(root, 'fsmonitor'), pager: marker(root, 'pager'), editor: marker(root, 'editor'), ssh: marker(root, 'ssh'), ask: marker(root, 'ask'),
  };
  await setting(dir, 'core.fsmonitor', marks.fsmonitor.cmd);
  await setting(dir, 'core.pager', marks.pager.cmd);
  await setting(dir, 'core.editor', marks.editor.cmd);
  await setting(dir, 'core.sshCommand', marks.ssh.cmd);
  await setting(dir, 'core.askPass', marks.ask.cmd);

  // The markers work: git run without the fence runs the ones these calls reach.
  await plain(['status', '--porcelain'], dir);
  await plain([...ID, 'commit', '--allow-empty', '-e', '-m', 'x'], dir);
  await plain(['fetch', 'ssh://127.0.0.1:1/none'], dir);
  for (const name of ['fsmonitor', 'editor', 'ssh']) assert.equal(ran(marks[name]), true, `control: ${name}`);
  // A pager starts only on a terminal, which a test has not got, so what git would start is read instead.
  const startsWith = async (git, name) => (await git(['var', name])).stdout.trim();
  assert.equal(await startsWith((a) => plain(a, dir), 'GIT_PAGER'), marks.pager.cmd, 'control: pager');
  assert.equal(await startsWith((a) => plain(a, dir), 'GIT_EDITOR'), marks.editor.cmd, 'control: editor');
  Object.values(marks).forEach(clear);

  // The survey's calls.
  const survey = safeGit({ cwd: dir, reach: 'local', list: 'project', caller: 'survey', env: { GIT_OPTIONAL_LOCKS: '0' } });
  for (const args of [
    ['status', '--porcelain'], ['log', '-1'], ['fetch', '--quiet', 'origin'], ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
    ['rev-list', '--count', 'HEAD..origin/main'], ['worktree', 'list', '--porcelain'], ['remote', 'get-url', 'origin'],
  ]) assert.equal((await survey(args)).code, 0, args.join(' '));
  assert.equal(await startsWith((a) => survey(a), 'GIT_PAGER'), 'cat');
  assert.equal(await startsWith((a) => survey(a), 'GIT_EDITOR'), 'false');
  // A commit with an editor, and a fetch over ssh, are not calls the routes make, but the fence holds there too.
  assert.notEqual((await survey([...NAME, 'commit', '--allow-empty', '-e', '-m', 'x'])).code, 0);
  assert.notEqual((await safeGit({ cwd: dir, reach: 'ssh', list: 'project', look: 'each' })(['fetch', 'ssh://127.0.0.1:1/none'])).code, 0);

  // The foreman's calls.
  const foreman = safeGit({ cwd: dir, list: 'project', caller: 'foreman' });
  const tree = path.join(root, 'tree');
  const env = { GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' };
  assert.equal((await foreman(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { env })).code, 0);
  assert.equal((await foreman(['rev-parse', '--verify', '--quiet', 'refs/heads/feature/x'], { env })).code, 1);
  assert.equal((await foreman(['worktree', 'add', '--quiet', '--no-track', '-b', 'feature/x', tree, 'origin/main'], { env })).code, 0);

  // The feature's pull, in the worktree.
  const feature = safeGit({ cwd: tree, reach: 'local', list: 'project', caller: 'feature' });
  assert.equal((await feature(['fetch', '-q', '--no-tags', dir, 'refs/wheelhouse/pulled'])).code, 0);
  assert.equal((await feature(['merge', '-q', '--ff-only', sha])).code, 0);

  for (const [name, m] of Object.entries(marks)) assert.equal(ran(m), false, name);
});

// --- Test 5: signing is off ---

test('5: signing switched on in the repository signs and verifies nothing on the survey, feature and state routes', { skip: !unix && 'a signing program is started without a shell, so its stand-in is a shell script' }, async () => {
  const { root, dir } = await projectWithOrigin();
  const gpg = programMarker(root, 'gpg');
  const gpgSsh = programMarker(root, 'gpgssh');
  for (const [key, value] of [
    ['commit.gpgSign', 'true'], ['tag.gpgSign', 'true'], ['push.gpgSign', 'true'], ['log.showSignature', 'true'],
    ['merge.verifySignatures', 'true'], ['gpg.format', 'ssh'], ['user.signingKey', path.join(root, 'no-such-key')],
    ['gpg.program', gpg.cmd], ['gpg.ssh.program', gpgSsh.cmd],
  ]) await setting(dir, key, value);

  // A commit that carries a signature header, so a git that verifies would start the signing program.
  const head = await must(['rev-parse', 'HEAD'], dir);
  const tree = await must(['rev-parse', 'HEAD^{tree}'], dir);
  const body = `tree ${tree}\nparent ${head}\nauthor T <t@invalid> 1700000000 +0000\ncommitter T <t@invalid> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n abc\n -----END PGP SIGNATURE-----\n\nsigned\n`;
  const made = await run('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: dir, env: SHUT, input: body });
  const sha = made.stdout.trim();
  assert.match(sha, /^[0-9a-f]{40}/);
  await must(['update-ref', 'refs/heads/ahead', sha], dir);
  const tree2 = path.join(root, 'tree');
  await must(['worktree', 'add', '-q', '--no-track', '-b', 'feature/s', tree2, 'HEAD'], dir);
  const either = () => ran(gpg) || ran(gpgSsh);

  // The markers work: git unfenced reaches the signing program on a commit, on showing a signed commit,
  // on a signed tag, on verifying a merge; and a signed push is refused before it starts.
  await plain([...NAME, 'commit', '--allow-empty', '-q', '-m', 'signed'], dir);
  assert.equal(either(), true, 'control: commit');
  clear(gpg); clear(gpgSsh);
  await plain(['log', '-1', 'ahead'], dir);
  assert.equal(either(), true, 'control: log.showSignature');
  clear(gpg); clear(gpgSsh);
  await plain(['fetch', '-q', '--no-tags', dir, 'ahead'], tree2);
  const unverified = await plain(['merge', '-q', '--ff-only', sha], tree2);
  assert.notEqual(unverified.code, 0);
  assert.equal(either(), true, 'control: merge.verifySignatures');
  clear(gpg); clear(gpgSsh);
  const unsigned = await plain(['push', '-q', 'origin', 'ahead'], dir);
  assert.notEqual(unsigned.code, 0, 'control: push.gpgSign makes an ordinary push fail');

  // The look is skipped here: gpg.program is refused by the look, and the fence is what is tested.
  const survey = safeGit({ cwd: dir, look: 'never' });
  const shown = await survey(['log', '-1', 'ahead']);
  assert.equal(shown.code, 0, shown.stderr);
  assert.ok(shown.stdout.includes(sha));
  assert.equal((await survey(['log', '--all', '--format=%H', '--', 'x'])).code, 0);
  assert.equal((await survey(['config', '--get', 'push.gpgSign'])).stdout.trim(), 'false');
  assert.equal(either(), false, 'survey');

  // The feature's merge --ff-only of the signed commit.
  const feature = safeGit({ cwd: tree2, reach: 'local', look: 'never' });
  assert.equal((await feature(['fetch', '-q', '--no-tags', dir, 'ahead'])).code, 0);
  const merged = await feature(['merge', '-q', '--ff-only', sha]);
  assert.equal(merged.code, 0, merged.stderr);
  assert.equal(either(), false, 'feature');

  // A push with push.gpgSign on in the repository.
  const pushed = await safeGit({ cwd: dir, reach: 'local', look: 'never' })(['push', '-q', 'origin', 'ahead']);
  assert.equal(pushed.code, 0, pushed.stderr);
  assert.equal(either(), false, 'push');

  // The helper's state commit and signed tag.
  const state = path.join(root, 'state');
  await must(['init', '-q', '-b', 'main', state], root);
  for (const [key, value] of [['commit.gpgSign', 'true'], ['tag.gpgSign', 'true'], ['gpg.format', 'ssh'], ['gpg.program', gpg.cmd], ['gpg.ssh.program', gpgSsh.cmd], ['user.signingKey', path.join(root, 'no-such-key')]]) await setting(state, key, value);
  await plain([...ID, 'commit', '--allow-empty', '-q', '-m', 'first'], state);
  clear(gpg); clear(gpgSsh);
  await plain([...NAME, 'tag', '-m', 'note', 'control'], state);
  assert.equal(either(), true, 'control: tag.gpgSign');
  clear(gpg); clear(gpgSsh);
  const committed = await stateGit(state, ['commit', '--allow-empty', '-q', '-m', 'state']);
  assert.equal(committed.code, 0, committed.stderr);
  const tagged = await stateGit(state, ['tag', '-m', 'note', 't1']);
  assert.equal(tagged.code, 0, tagged.stderr);
  assert.equal(either(), false, 'state');
});

// --- Test 6: the credential reset ---

test('6: a repository\'s credential helpers run on no fenced call, and the director\'s sign-in is the only one asked', async () => {
  const root = fs.realpathSync.native(tempFolder('wh-cred-'));
  const served = path.join(root, 'served');
  fs.mkdirSync(served);
  const seed = path.join(root, 'seed');
  await must(['init', '-q', '-b', 'main', seed], root);
  await commitIn(seed, 'one');
  await must(['clone', '-q', '--bare', seed, path.join(served, 'proj.git')], root);
  const token = 'tok-' + 'a1b2c3d4e5f6';
  const host = await startHttpHost({ root: served, token });
  try {
    const dir = path.join(root, 'project');
    await must(['init', '-q', '-b', 'main', dir], root);
    await must(['remote', 'add', 'origin', `${host.url}/proj.git`], dir);
    const general = marker(root, 'helper-general');
    const scoped = marker(root, 'helper-scoped');
    // git starts the askpass program without a shell, so it must be one executable file (unix only).
    const ask = unix ? programMarker(root, 'askpass') : marker(root, 'askpass');
    await setting(dir, 'credential.helper', `!${general.cmd}`);
    await setting(dir, `credential.${host.url}.helper`, `!${scoped.cmd}`);
    await setting(dir, 'core.askPass', ask.cmd);

    // The markers work: an unfenced fetch that gets a 401 asks both helpers.
    const control = await plain(['fetch', '-q', 'origin'], dir, LOOPBACK_HTTP);
    assert.notEqual(control.code, 0);
    assert.equal(ran(general), true, 'control: the general helper');
    assert.equal(ran(scoped), true, 'control: the URL-scoped helper');
    if (unix) assert.equal(ran(ask), true, 'control: the askpass program, asked once the helpers gave nothing');
    clear(general); clear(scoped); clear(ask);

    // The project look lets both helpers be; the fence makes them inert.
    const fenced = safeGit({ cwd: dir, reach: 'loopback', list: 'project', look: 'each' });
    const refused = await fenced(['fetch', '-q', 'origin']);
    assert.notEqual(refused.code, 0);
    assert.equal(host.refusedCount() > 0, true);
    assert.equal(ran(general), false);
    assert.equal(ran(scoped), false);
    assert.equal(ran(ask), false);

    // With the director's sign-in, only the host tool is asked, and the fetch succeeds.
    if (!unix) return; // the stand-in tool is a shell script; Windows runs gh.exe, which a test does not fake
    const tool = fetchedPath('gh');
    fs.mkdirSync(path.dirname(tool), { recursive: true });
    const asked = path.join(root, 'tool.ran');
    fs.writeFileSync(tool, `#!/bin/sh\nif [ "$1" = auth ] && [ "$2" = git-credential ] && [ "$3" = get ]; then\n  echo asked >> "${asked}"\n  echo username=x-access-token\n  echo password=${token}\nfi\n`, { mode: 0o755 });
    try {
      const signedIn = safeGit({ cwd: dir, reach: 'loopback', list: 'project', look: 'each', env: directorSignIn('github') });
      const got = await signedIn(['fetch', '-q', 'origin']);
      assert.equal(got.code, 0, got.stderr);
      assert.equal(fs.existsSync(asked), true, 'the host tool was asked');
      assert.equal(ran(general), false);
      assert.equal(ran(scoped), false);
      assert.equal(ran(ask), false);
    } finally {
      fs.rmSync(path.join(path.dirname(tool), '..'), { recursive: true, force: true });
    }
  } finally {
    await host.close();
  }
});

test('6: the reset begins every call\'s pairs, the director\'s sign-in follows it once, and applying twice changes nothing', () => {
  const pairs = (env) => Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
  const plainPairs = pairs(safeGitEnv({}));
  assert.deepEqual(plainPairs[0], ['credential.helper', '']);
  assert.equal(plainPairs.filter(([k]) => k === 'credential.helper').length, 1);
  const signed = safeGitEnv(directorSignIn('github', { platform: 'darwin' }));
  const helpers = pairs(signed).filter(([k]) => k === 'credential.helper');
  assert.equal(helpers.length, 2, 'one reset, then the director\'s helper');
  assert.equal(helpers[0][1], '');
  assert.match(helpers[1][1], /auth git-credential/);
  assert.deepEqual(pairs(signed)[0], ['credential.helper', '']);
  // The helper is not cleared again by the fence appended last: nothing after it names credential.helper.
  const at = pairs(signed).findIndex(([k, v]) => k === 'credential.helper' && v !== '');
  assert.equal(pairs(signed).slice(at + 1).some(([k]) => k === 'credential.helper'), false);
  assert.deepEqual(safeGitEnv(signed), signed);
  // A caller's own pairs come after the reset.
  const own = pairs(safeGitEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'x.y', GIT_CONFIG_VALUE_0: 'z' }));
  assert.deepEqual(own[0], ['credential.helper', '']);
  assert.deepEqual(own[1], ['x.y', 'z']);
});

test('6: an argument may not set a credential helper, which would come after the reset', async () => {
  const git = safeGit({ cwd: process.cwd(), look: 'never', run: async () => ({ code: 0, stdout: '', stderr: '' }) });
  await assert.rejects(git(['-c', 'credential.helper=!x', 'fetch']), /credential\.helper/);
  await assert.rejects(git(['-c', 'credential.https://example.com.helper=!x', 'fetch']), /helper/);
  await assert.rejects(git(['--config-env=credential.helper=X', 'fetch']), /credential\.helper/);
});

// --- Test 7: URL-scoped http ---

test('7: URL-scoped http keys are refused, named, on both lists', async () => {
  const { dir } = await newRepo();
  await setting(dir, 'http.https://example.com.sslVerify', 'false');
  await setting(dir, 'http.https://example.com.proxy', 'http://elsewhere.invalid:8080');
  for (const list of ['own', 'project']) {
    const found = await lookAtSettings({ cwd: dir, list });
    assert.deepEqual([...found.keys].sort(), ['http.https://example.com.proxy', 'http.https://example.com.sslverify'], list);
    const line = lookRefusalLine('survey', found);
    assert.match(line, /sslverify/);
    assert.match(line, /proxy/);
  }
  await assert.rejects(safeGit({ cwd: dir, list: 'project', caller: 'survey' })(['status']), (e) => e instanceof LookRefusal && /sslverify/.test(e.message));
});

// --- Test 8: config hooks ---

test('8: config-defined hooks are refused on both lists', async () => {
  const { dir, root } = await newRepo();
  const hook = marker(root, 'hook');
  await setting(dir, 'hook.x.command', hook.cmd);
  await setting(dir, 'hook.x.event', 'pre-commit');
  for (const list of ['own', 'project']) {
    const found = await lookAtSettings({ cwd: dir, list });
    assert.deepEqual([...found.keys].sort(), ['hook.x.command', 'hook.x.event'], list);
    await assert.rejects(safeGit({ cwd: dir, list, caller: 'helper' })(['commit', '--allow-empty', '-m', 'x']), LookRefusal, list);
  }
  assert.equal(ran(hook), false);
});

// --- Source scans (tests 9, 10 and 12) ---

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : jsFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}
const relative = (root, full) => path.relative(root, full).split(path.sep).join('/');
// The text with its comments blanked, line for line.
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');

// The text of the bracketed array that opens at `start` (the index of its `[`), or null.
function arrayAt(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== null) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// --- Test 9: gh and glab name their repository ---

// The commands of gh and glab that find their repository from the working folder's git remotes when
// no repository is named.
const REPO_COMMANDS = ['pr', 'mr', 'issue', 'repo', 'release', 'run', 'workflow', 'label', 'secret', 'variable', 'cache', 'ruleset', 'browse', 'ci', 'pipeline', 'job'];
// Every array that is a gh or glab command line in the files that run those tools, with whether it
// names its repository: `--repo`, `-R` (written out, or as `...R`, an array of the two), a full API
// path (`repos/...`, `projects/...`, `orgs/...`, `apps/...`, `user...`, `graphql`), or a repository
// given to `repo view`.
function ghCallsIn(root) {
  const found = [];
  for (const full of jsFiles(path.join(root, 'scripts'))) {
    const rel = relative(root, full);
    const text = withoutComments(fs.readFileSync(full, 'utf8'));
    if (!/toolPath\(|['"`](?:gh|glab)['"`]/.test(text) && !/^scripts\/host\/(?:github|gitlab)\.js$/.test(rel)) continue;
    const words = REPO_COMMANDS.map((w) => `'${w}'`).join('|');
    for (const m of text.matchAll(new RegExp(`\\[\\s*(?:${words}|'api')\\s*,`, 'g'))) {
      const arrayText = arrayAt(text, m.index);
      if (arrayText === null) continue;
      const first = /^\[\s*'([a-z]+)'/.exec(arrayText)[1];
      const line = text.slice(0, m.index).split('\n').length;
      let named;
      if (first === 'api') {
        // The path is the first element after `api` (and `--method X`): a literal or template that starts with a
        // repository, project, organisation or user path, or a name the file sets to one (`const project = \`projects/...\``).
        const path2 = /^\[\s*'api'\s*,\s*(?:'--method'\s*,\s*'[A-Z]+'\s*,\s*)?(`[^`]*`|'[^']*'|[A-Za-z_$][\w$.]*)/.exec(arrayText)?.[1] ?? '';
        const literal = path2.replace(/^[`']|[`']$/g, '');
        const nameSet = /^[A-Za-z_$][\w$]*$/.test(path2) && new RegExp(`const ${path2.replace('$', '\\$')} = \`projects/`).test(text);
        named = /^(?:repos\/|projects\b|orgs\/|apps\/|user\b|graphql|\$\{project\}|contents$)/.test(literal) || nameSet
          || (/^[A-Za-z_$]/.test(path2) && /\bgh\('(?:GET|POST|PUT|PATCH|DELETE)',\s*(?:`(?:repos\/|orgs\/)|'(?:user|graphql)'|`projects)/.test(text));
        // gh fills these placeholders in from the working folder's remotes.
        if (/(?<!\$)\{(?:owner|repo|branch)\}|:owner\b|:repo\b/.test(arrayText)) named = false;
      } else {
        // `repo view|create|clone <name>` carries its repository as a positional.
        named = /'--repo'|'-R'|[`'"]--repo=|\.\.\.R\b/.test(arrayText) || (first === 'repo' && /^\[\s*'repo'\s*,\s*'(?:view|create|clone)'\s*,\s*[A-Za-z_$]/.test(arrayText));
      }
      found.push({ file: rel, line, call: arrayText.replace(/\s+/g, ' ').slice(0, 90), named });
    }
  }
  return found;
}

// gh calls that are about the signed-in account, not a repository, so there is none to name. Each row is one call: its
// file and its api path.
const ACCOUNT_CALLS = Object.freeze([
  { file: 'scripts/engine/archon/copilot-meter.js', path: '/copilot_internal/user', reason: 'the account\'s Copilot premium-request figure, read once a day by the helper (never in the engine\'s environment) with the director\'s own gh sign-in; it is per user, so no repository applies' },
]);
const accountCall = (c) => ACCOUNT_CALLS.some((a) => a.file === c.file && c.call.includes(`'api', '${a.path}'`));

test('9: every account call is still in its file, with a reason', () => {
  for (const a of ACCOUNT_CALLS) {
    assert.ok(a.reason.length > 0);
    assert.ok(ghCallsIn(ROOT).some((c) => c.file === a.file && accountCall(c)), `${a.file} still calls ${a.path}, or its row goes`);
  }
});

test('9: scan - every gh and glab call in scripts/ names its repository', () => {
  assert.equal(PROJECT_CONDITIONS.ghNamesRepository, true);
  const calls = ghCallsIn(ROOT).filter((c) => !accountCall(c));
  assert.ok(calls.length > 30, 'the scan sees the adapter\'s command lines');
  assert.ok(calls.some((c) => c.file === 'scripts/host/github.js' && c.named));
  assert.ok(calls.some((c) => c.file === 'scripts/host/gitlab.js' && c.named));
  const unnamed = calls.filter((c) => !c.named);
  // The conditional row stands or falls with this scan: remote.<name>.gh-resolved and the other
  // hyphenated remote keys are on the project list only while no call is left unnamed.
  assert.equal(PROJECT_CONDITIONS.ghNamesRepository, unnamed.length === 0,
    `PROJECT_CONDITIONS.ghNamesRepository must match the scan; unnamed calls: ${JSON.stringify(unnamed)}`);
});

test('9: the scan finds a call that names no repository, and passes ones that do', () => {
  const root = tempFolder('wh-gh-scan-');
  fs.mkdirSync(path.join(root, 'scripts/x'), { recursive: true });
  const put = (name, body) => fs.writeFileSync(path.join(root, 'scripts/x', name), body);
  put('bad.js', "await run(toolPath('gh'), ['pr', 'list', '--state', 'open']);\n");
  put('badapi.js', "await run('glab', ['api', 'projects/:id/merge_requests']);\nawait run('gh', ['api', 'repos/{owner}/{repo}/pulls']);\n");
  put('good.js', "const R = ['--repo', repo];\nawait run(toolPath('gh'), ['pr', 'list', ...R]);\nawait run(toolPath('gh'), ['api', `repos/${repo}/pulls`]);\nawait run(toolPath('gh'), ['pr', 'view', '1', '-R', repo]);\n");
  const calls = ghCallsIn(root);
  assert.deepEqual(calls.filter((c) => c.file.endsWith('bad.js')).map((c) => c.named), [false]);
  assert.deepEqual(calls.filter((c) => c.file.endsWith('badapi.js')).map((c) => c.named), [true, false]);
  assert.deepEqual(calls.filter((c) => c.file.endsWith('good.js')).map((c) => c.named), [true, true, true]);
});

// --- Test 10: nothing pushes from a project ---

const NO_PROJECT_WRITES = ['push', 'commit', 'tag', 'rebase', 'am'];
// The git subcommand of every literal argument list a file passes to a git call: the first word that is not an
// option or the value of `-c`/`-C`.
function subcommandsIn(text) {
  const out = [];
  for (const m of text.matchAll(/(?:\b\w*[gG]it\w*|\bfenced|\bkeyed|\bunkeyed|\bmust|\bcall|\bok|\bg|\bgitIn\([^)]*\)|\brun)\(\s*(?:'git',\s*|[\w.]+,\s*)?\[/g)) {
    const array = arrayAt(text, m.index + m[0].length - 1);
    if (array === null) continue;
    const words = [...array.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map((w) => w[1] ?? w[2] ?? w[3]);
    for (let i = 0; i < words.length; i += 1) {
      if (words[i] === '-c' || words[i] === '-C') i += 1;
      else if (!words[i].startsWith('-')) { out.push(words[i]); break; }
    }
  }
  return out;
}

test('10: scan - no route whose look is the project list pushes, commits, tags, rebases or applies', () => {
  const read = (file) => withoutComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  // The Lean store's every call takes the project list too (ruling P5-25), so it is scanned with them (ruling P5-50).
  const routes = ['scripts/foreman/act.js', 'scripts/feature/cli.js', 'scripts/install/survey.js', 'scripts/lean/store.js'];
  const subs = routes.flatMap((file) => subcommandsIn(read(file)).map((s) => [file, s]));
  assert.ok(subs.length >= 10, 'the scan sees the routes\' calls');
  for (const [, s] of subs) assert.ok(s !== '', 'every call has a subcommand the scan can read');
  const seen = new Set(subs.map(([, s]) => s));
  for (const word of ['symbolic-ref', 'rev-parse', 'worktree', 'fetch', 'merge', 'status', 'remote', 'rev-list']) assert.ok(seen.has(word), word);
  const bad = subs.filter(([, s]) => NO_PROJECT_WRITES.includes(s));
  // The folder the helper copies from is only fetched from: copyIn runs git in the mirror.
  const helper = read('scripts/host/helper.js');
  const start = helper.indexOf('async function copyIn(');
  const copyIn = helper.slice(start, helper.indexOf('async function pushToHost(', start));
  assert.ok(start > 0 && copyIn.length > 100);
  const inCopy = subcommandsIn(copyIn).filter((s) => NO_PROJECT_WRITES.includes(s));
  // The row stands or falls with this scan.
  assert.equal(PROJECT_CONDITIONS.noPushFromProject, bad.length === 0 && inCopy.length === 0,
    `PROJECT_CONDITIONS.noPushFromProject must match the scan; found ${JSON.stringify([...bad, ...inCopy])}`);
});

test('10: the Lean store sends nothing out: its copy fetches from it, naming the store by its path', () => {
  const store = withoutComments(fs.readFileSync(path.join(ROOT, 'scripts/lean/store.js'), 'utf8'));
  const subs = subcommandsIn(store);
  assert.ok(subs.includes('fetch'), 'the scan sees the copy\'s fetch');
  assert.deepEqual(subs.filter((s) => s === 'push'), [], 'no push from the store');
  // Each fetch names where it fetches from by a path, never by a remote's name, so no remote's settings are read.
  const fetches = [...store.matchAll(/\[\s*'fetch',([^\]]*)\]/g)].map((m) => m[1]);
  assert.ok(fetches.length > 0);
  for (const args of fetches) {
    const plain = [...args.matchAll(/'([^']*)'/g)].map((w) => w[1]).filter((w) => !w.startsWith('-'));
    assert.deepEqual(plain, [], `a fetch names no remote: ${args}`);
    assert.match(args, /\bfrom\b|storeDir\(|stateDir\(/, `a fetch names a path: ${args}`);
  }
});

test('10: the scan finds a push in a route', () => {
  assert.deepEqual(subcommandsIn("await git(['-c', 'x=y', 'push', 'origin']);\nawait fenced(['status']);\nawait run('git', ['commit', '-m', 'x']);"), ['push', 'status', 'commit']);
});

// --- Test 11: submodule recursion stays off ---

async function projectWithSubmodule() {
  const { root, dir, origin } = await projectWithOrigin();
  const sub = path.join(root, 'sub-source');
  await must(['init', '-q', '-b', 'main', sub], root);
  fs.writeFileSync(path.join(sub, 'a.txt'), 'one\n');
  await must(['add', 'a.txt'], sub);
  await plain([...ID, 'commit', '-q', '-m', 'sub one'], sub);
  await must(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor'], dir);
  await plain([...ID, 'commit', '-q', '-m', 'add sub'], dir);
  await must(['push', '-q', 'origin', 'main'], dir);
  const vendor = path.join(dir, 'vendor');
  // Where the submodule's own copy of the source's branch stands: it moves only if a fetch went into the submodule.
  const seen = () => must(['rev-parse', 'refs/remotes/origin/main'], vendor);
  // The source gains a commit, so a fetch into the submodule would move that ref.
  const moreInSource = () => commitIn(sub, `sub ${Math.random()}`);
  await moreInSource();
  return { root, dir, origin, vendor, seen, moreInSource };
}

test('11: a populated submodule is not fetched into, by the survey\'s and the feature\'s fetch', async () => {
  const { dir, seen, moreInSource } = await projectWithSubmodule();
  const start = await seen();
  const moved = async () => (await seen()) !== start;

  // The control: git unfenced, with the submodule's own setting on, fetches into it.
  await setting(dir, 'submodule.vendor.fetchRecurseSubmodules', 'true');
  await plain(['-c', 'protocol.file.allow=always', 'fetch', '-q', 'origin'], dir, { GIT_ALLOW_PROTOCOL: 'file' });
  assert.equal(await moved(), true, 'control: in .git/config');

  await moreInSource();
  const before = await seen();
  const survey = safeGit({ cwd: dir, reach: 'local', list: 'project', caller: 'survey' });
  assert.equal((await survey(['fetch', '--quiet', 'origin'])).code, 0);
  assert.equal(await seen(), before, 'survey, .git/config');
  const feature = safeGit({ cwd: dir, reach: 'local', list: 'project', caller: 'feature' });
  assert.equal((await feature(['fetch', '-q', '--no-tags', dir, 'refs/heads/main'])).code, 0);
  assert.equal(await seen(), before, 'feature, .git/config');

  // The same in .gitmodules, with the repository's own config silent.
  await must(['config', '--unset', 'submodule.vendor.fetchRecurseSubmodules'], dir);
  await must(['config', '-f', '.gitmodules', 'submodule.vendor.fetchRecurseSubmodules', 'true'], dir);
  await plain(['-c', 'protocol.file.allow=always', 'fetch', '-q', 'origin'], dir, { GIT_ALLOW_PROTOCOL: 'file' });
  assert.notEqual(await seen(), before, 'control: in .gitmodules');
  await moreInSource();
  const again = await seen();
  assert.equal((await survey(['fetch', '--quiet', 'origin'])).code, 0);
  assert.equal((await feature(['fetch', '-q', '--no-tags', dir, 'refs/heads/main'])).code, 0);
  assert.equal(await seen(), again, '.gitmodules');
});

// --- The survey with markers planted: the project's, and a submodule's own filter ---

test('survey: fsmonitor, sshCommand, pager and a submodule\'s planted filter run nothing in a real survey', async () => {
  const { root, dir, vendor } = await projectWithSubmodule();
  const marks = {
    fsmonitor: marker(root, 'fsm'), ssh: marker(root, 'ssh'), pager: marker(root, 'pgr'), filter: marker(root, 'filter'),
  };
  await setting(dir, 'core.fsmonitor', marks.fsmonitor.cmd);
  await setting(dir, 'core.sshCommand', marks.ssh.cmd);
  await setting(dir, 'core.pager', marks.pager.cmd);
  // The submodule's own config, which no look reads, holds a filter that its attributes switch on for a changed file.
  await setting(vendor, 'filter.x.clean', marks.filter.cmd);
  fs.writeFileSync(path.join(vendor, '.gitattributes'), '* filter=x\n');
  // A new modification time makes git read the file's content to compare it, which runs the filter.
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(path.join(vendor, 'a.txt'), later, later);

  // The control: git's own status in the project enters the submodule and runs the filter.
  await plain(['status', '--porcelain'], dir);
  assert.equal(ran(marks.filter), true, 'control: status reaches the submodule\'s filter');
  assert.equal(ran(marks.fsmonitor), true, 'control: fsmonitor');
  Object.values(marks).forEach(clear);

  const survey = await surveyProject({
    folder: dir, manifest: { upstreams: [] }, host: 'github', claudeHome: tempFolder('wh-claude-'),
    run: async (file, args, options) => (file === 'gh' ? { code: 0, stdout: '[]', stderr: '' } : run(file, args, options)),
  });
  assert.equal(survey.inFlight.behind >= 0, true);
  for (const [name, m] of Object.entries(marks)) assert.equal(ran(m), false, name);
});

test('survey: the open-request list names its repository with --repo= and runs outside the project', async () => {
  assert.equal(repositoryOf('https://github.com/o/p.git', 'github'), 'o/p');
  assert.equal(repositoryOf('git@github.com:o/p.git', 'github'), 'o/p');
  assert.equal(repositoryOf('https://gitlab.com/g/s/p.git', 'gitlab'), 'g/s/p');
  assert.equal(repositoryOf('git@git.corp.example:g/s/p.git', 'gitlab'), 'git.corp.example/g/s/p');
  assert.equal(repositoryOf('https://ghe.corp.example/o/p', 'github'), 'ghe.corp.example/o/p');
  assert.equal(repositoryOf('/srv/x/p.git', 'github'), 'x/p');
  assert.equal(repositoryOf('p', 'github'), null);
  // Addresses that are not repositories, or that hold what an option would take, name none.
  for (const bad of ['https://[::1]/o/p', 'user:a/b@host', '-oProxyCommand=x:a/b', 'https://-oProxyCommand=x/o/p', 'ext::sh -c x', 'https://h/o/p q', 'https://h/o/$(x)']) assert.equal(repositoryOf(bad, 'github'), null, bad);
  // A path that reads like an option's value is only ever the value of the one --repo= argument.
  assert.equal(repositoryOf('evil/x', 'github'), 'evil/x');
  const { dir } = await projectWithOrigin();
  const calls = [];
  await surveyProject({
    folder: dir, manifest: { upstreams: [] }, host: 'github', claudeHome: tempFolder('wh-claude-'),
    run: async (file, args, options) => {
      if (file !== 'gh') return run(file, args, options);
      calls.push({ args, cwd: options.cwd });
      return { code: 0, stdout: '[]', stderr: '' };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.filter((a) => a.startsWith('--repo=')).length, 1);
  assert.ok(calls[0].args.includes(`--repo=${repositoryOf(path.join(dir, '..', 'origin.git'), 'github')}`));
  assert.equal(calls[0].args.includes('-R'), false);
  assert.equal(path.resolve(calls[0].cwd).startsWith(fs.realpathSync.native(dir)), false);
  assert.equal(fs.existsSync(calls[0].cwd), false, 'the scratch folder is removed');
});

async function surveyWith(origin, host, ghLike, env = {}) {
  const { dir } = await projectWithOrigin();
  await must(['remote', 'set-url', 'origin', origin], dir);
  const calls = [];
  const survey = () => surveyProject({
    folder: dir, manifest: { upstreams: [] }, host, claudeHome: tempFolder('wh-claude-'),
    run: async (file, args, options) => {
      if (file === 'gh' || file === 'glab') { calls.push({ file, args, env: options.env, cwd: options.cwd }); return ghLike(file, args); }
      // The fetch from a made-up address cannot succeed; the survey only needs the remote to read.
      if (file === 'git' && args.includes('fetch')) return { code: 0, stdout: '', stderr: '' };
      return run(file, args, options);
    },
  });
  return { survey, calls, dir };
}

test('survey: a planted foreign host is named only when the director is signed in to it, and the token variables are cleared', async () => {
  // Refused: auth status fails, so no list call is made and the survey says so.
  const refusing = await surveyWith('https://evil.example/o/p.git', 'github', (file, args) => (args[0] === 'auth' ? { code: 1, stdout: '', stderr: 'not logged in' } : { code: 0, stdout: '[]', stderr: '' }));
  await assert.rejects(refusing.survey(), /not signed in to evil\.example/);
  assert.deepEqual(refusing.calls.map((c) => c.args.slice(0, 2).join(' ')), ['auth status']);
  assert.deepEqual(refusing.calls[0].args.slice(2), ['--hostname=evil.example']);
  // Signed in: auth status first, then the list, both with the token variables cleared and outside the project.
  const signed = await surveyWith('https://ghe.corp.example/o/p.git', 'github', () => ({ code: 0, stdout: '[]', stderr: '' }));
  await signed.survey();
  assert.deepEqual(signed.calls.map((c) => c.args[0]), ['auth', 'pr']);
  assert.ok(signed.calls[1].args.includes('--repo=ghe.corp.example/o/p'));
  for (const call of signed.calls) {
    for (const name of ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'GITLAB_HOST']) {
      assert.ok(name in call.env && call.env[name] === undefined, `${name} is cleared`);
    }
    assert.equal(call.cwd.startsWith(signed.dir), false);
  }
  // glab likewise.
  const lab = await surveyWith('git@git.corp.example:g/s/p.git', 'gitlab', () => ({ code: 0, stdout: '[]', stderr: '' }));
  await lab.survey();
  assert.deepEqual(lab.calls.map((c) => c.args[0]), ['auth', 'mr']);
  assert.ok(lab.calls[1].args.includes('--repo=git.corp.example/g/s/p'));
  // The tool's own host needs no auth check.
  const own = await surveyWith('https://github.com/o/p.git', 'github', () => ({ code: 0, stdout: '[]', stderr: '' }));
  await own.survey();
  assert.deepEqual(own.calls.map((c) => c.args[0]), ['pr']);
  // and keeps the token variables, since a director may sign in to it by one alone.
  assert.equal('GITLAB_TOKEN' in own.calls[0].env || 'GH_ENTERPRISE_TOKEN' in own.calls[0].env, false);
});

// --- Test 12: built-ins only ---

test('12: scan - every git subcommand the routes run is a built-in, so an alias cannot shadow one', async (t) => {
  const listed = await run('git', ['--list-cmds=builtins']);
  if (listed.code !== 0 || listed.stdout.trim() === '') return t.skip('this git cannot list its built-in commands');
  const builtins = new Set(listed.stdout.split(/\s+/).filter(Boolean));
  const files = jsFiles(path.join(ROOT, 'scripts')).map((f) => relative(ROOT, f))
    // The route's own files, the host adapters (whose argument lists are gh's and glab's) and the process killer are not git calls.
    .filter((rel) => !['scripts/lib/safe-git.js', 'scripts/setup/git.js', 'scripts/host/github.js', 'scripts/host/gitlab.js', 'scripts/windows/guarded.js'].includes(rel));
  const offenders = [];
  let count = 0;
  for (const rel of files) {
    const text = withoutComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const sub of subcommandsIn(text)) {
      // Only words that read as a git subcommand: the scan also sees other programs' argument lists.
      if (!/^[a-z][a-z-]*$/.test(sub)) continue;
      count += 1;
      // The survey's `gh auth status` / `glab auth status` is a host tool's command line, not git's.
      if (rel === 'scripts/install/survey.js' && sub === 'auth') continue;
      if (!builtins.has(sub)) offenders.push(`${rel}: ${sub}`);
    }
  }
  assert.ok(count > 40, 'the scan sees the calls');
  assert.deepEqual([...new Set(offenders)].sort(), [], 'a git call whose subcommand is not a built-in');
});

test('12: a planted alias named after a built-in runs nothing in the survey\'s calls', async () => {
  const { root, dir } = await projectWithOrigin();
  const m = marker(root, 'alias');
  await setting(dir, 'alias.status', `!${m.cmd}`);
  await setting(dir, 'alias.fetch', `!${m.cmd}`);
  await setting(dir, 'alias.worktree', `!${m.cmd}`);
  const survey = safeGit({ cwd: dir, reach: 'local', list: 'project', caller: 'survey' });
  assert.equal((await survey(['status', '--porcelain'])).code, 0);
  assert.equal((await survey(['fetch', '--quiet', 'origin'])).code, 0);
  assert.equal((await survey(['worktree', 'list', '--porcelain'])).code, 0);
  assert.equal(ran(m), false);
  // The marker works: an alias with another name runs it.
  await setting(dir, 'alias.go', `!${m.cmd}`);
  await plain(['go'], dir);
  assert.equal(ran(m), true, 'control');
});

// --- Test 13: ordinary projects pass ---

async function shaped(settings) {
  const { dir } = await newRepo('wh-shape-');
  for (const [key, value] of settings) await setting(dir, key, value);
  return dir;
}
const SHAPES = {
  'a VS Code checkout': [
    ['remote.origin.url', 'https://github.com/o/p.git'], ['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
    ['branch.main.remote', 'origin'], ['branch.main.merge', 'refs/heads/main'], ['branch.main.vscode-merge-base', 'origin/main'],
    ['branch.feature/x.vscode-merge-base', 'origin/main'], ['branch.feature/x.github-pr-owner-number', 'o#p#12'],
  ],
  'a signed-commits repository': [
    ['commit.gpgsign', 'true'], ['user.signingkey', '~/.ssh/id_ed25519.pub'], ['gpg.format', 'ssh'], ['user.name', 'A'], ['user.email', 'a@invalid'], ['tag.gpgsign', 'true'],
  ],
  'an LFS repository installed globally': [['lfs.repositoryformatversion', '0'], ['lfs.url', 'https://lfs.example.com/o/p.git/info/lfs']],
  'a Scalar clone': [
    ['core.fsmonitor', 'true'], ['core.untrackedcache', 'true'], ['core.multipackindex', 'true'], ['core.commitgraph', 'true'], ['core.preloadindex', 'true'],
    ['maintenance.auto', 'false'], ['maintenance.strategy', 'incremental'], ['feature.manyfiles', 'true'], ['feature.experimental', 'false'],
    ['index.version', '4'], ['index.skiphash', 'true'], ['fetch.writecommitgraph', 'true'], ['gc.auto', '0'], ['status.aheadbehind', 'false'],
    ['log.excludedecoration', 'refs/prefetch/*'], ['pack.usebitmaps', 'false'],
  ],
  'a partial clone': [
    ['core.repositoryformatversion', '1'], ['remote.origin.url', 'https://github.com/o/p.git'], ['remote.origin.promisor', 'true'],
    ['remote.origin.partialclonefilter', 'blob:none'], ['extensions.partialclone', 'origin'],
  ],
  'a Windows clone': [
    ['core.symlinks', 'false'], ['core.autocrlf', 'true'], ['core.longpaths', 'true'], ['core.fscache', 'true'], ['core.ignorecase', 'true'],
    ['core.filemode', 'false'], ['credential.helper', 'manager'],
  ],
  'a work clone with a per-repository ssh command': [['core.sshCommand', 'ssh -i ~/.ssh/work'], ['user.useConfigOnly', 'true'], ['credential.https://git.work.example.username', 'a']],
  'a clone with a pull request tool': [['remote.origin.pushurl', 'git@github.com:o/p.git'], ['branch.main.pushRemote', 'origin'], ['remote.pushDefault', 'origin']],
};

test('13: ordinary projects of real-world shape pass the project look, and are refused by the own look where they hold more than R112\'s', async () => {
  for (const [name, settings] of Object.entries(SHAPES)) {
    const dir = await shaped(settings);
    const found = await lookAtSettings({ cwd: dir, list: 'project' });
    if (name === 'a clone with a pull request tool' && !PROJECT_CONDITIONS.noPushFromProject) assert.ok(found.keys.length > 0, name);
    else assert.deepEqual(found, { keys: [] }, name);
  }
  const own = await lookAtSettings({ cwd: await shaped(SHAPES['a Windows clone']), list: 'own' });
  assert.ok(own.keys.includes('core.longpaths'));
});

test('13: a gh repo clone passes, remote.<name>.gh-resolved included', async () => {
  const base = [['remote.origin.url', 'https://github.com/o/p.git'], ['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], ['branch.main.remote', 'origin'], ['branch.main.merge', 'refs/heads/main']];
  assert.deepEqual(await lookAtSettings({ cwd: await shaped(base), list: 'project' }), { keys: [] });
  const resolved = await lookAtSettings({ cwd: await shaped([...base, ['remote.origin.gh-resolved', 'base']]), list: 'project' });
  assert.deepEqual(resolved, { keys: [] });
});

// --- Test 14: new keys in whole sections ---

test('14: a git upgrade adds no key to a whole-section entry without a look', async (t) => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/git-config-keys.json'), 'utf8'));
  assert.match(snapshot.gitVersion, /^git version \d+\.\d+/);
  const listed = await run('git', ['help', '--config'], { env: { ...SHUT, GIT_PAGER: 'cat', PAGER: 'cat', MANPAGER: 'cat' } });
  if (listed.code !== 0 || listed.stdout.trim() === '') return t.skip('`git help --config` is not available here, so the snapshot cannot be compared');
  const sections = new Set([...PROJECT_WHOLE_SECTIONS, 'pull', 'color', 'advice']);
  assert.deepEqual([...Object.keys(snapshot.sections)].sort(), [...sections].sort(), 'the snapshot covers every whole section');
  const now = {};
  for (const line of listed.stdout.split(/\r?\n/)) {
    const key = line.trim();
    const section = key.split('.')[0].toLowerCase();
    if (/^[A-Za-z][\w.<>*-]*$/.test(key) && key.includes('.') && sections.has(section)) (now[section] ??= []).push(key);
  }
  const fresh = [];
  for (const [section, keys] of Object.entries(now)) for (const key of keys) if (!snapshot.sections[section]?.includes(key)) fresh.push(key);
  assert.deepEqual(fresh, [], `git now lists keys in whole sections that tests/fixtures/git-config-keys.json lacks (snapshot of ${snapshot.gitVersion}): look at each, then update the snapshot`);
});
