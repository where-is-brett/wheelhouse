// tests/scripts/setup/project-files.test.js
// Setup's step 7, the project's files, the pins and protection: the project's settings merged by
// key with the director's own, the starter configuration, this computer's local settings, the
// "Compact instructions" section, the pins installed for the project, the setup commit of three
// files pushed with the director's own sign-in before protection is switched on, and the setup
// clicks copied into the project's state once. Nothing real is pushed or installed: git runs for
// real only against bare remotes in temporary folders, and `gh`, `claude` and protection are
// stand-ins. Every home is a scratch folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  projectFilesStep, starterConfig, projectFilesChange, projectFilesCard, commitAuthor, COMMIT_MESSAGE, SETUP_FILES, COMPACT_HEADING,
  EXCLUDE_LINE, WHEELHOUSE_LINE, putYoursIn, LEAVE_YOURS, leftYoursLine,
} from '../../../scripts/setup/project-files.js';
import { STEPS, planHash } from '../../../scripts/setup/steps.js';
import { runApply } from '../../../scripts/setup/engine.js';
import { copySetupRecords, keepClick, keepAnswer } from '../../../scripts/setup/clicks.js';
import { startRun, findRun, addChanges, newId } from '../../../scripts/setup/journal.js';
import { stepDone } from '../../../scripts/lib/setup-run.js';
import { LIVE_DATA } from '../../../scripts/setup/questions.js';
import { readConfig, ROLES, DEFAULT_BUILD_COMMANDS, DEFAULT_HOT_FILES } from '../../../scripts/gate/guardrails.js';
import { buildManifest, checkInstalled, MARKETPLACE } from '../../../scripts/lineage/manifest.js';
import { SWITCHED_OFF_PLUGINS, setupCommand, frontDeskCommand } from '../../../scripts/protection/settings.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stateDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { caFile } from '../../../scripts/host/company-ca.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { makeEvent, writeEvent } from '../../../scripts/state/events.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { directorGitlabApi, REAL_USERS } from '../../../scripts/setup/host.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { guardedRun } from '../../helpers/host-stand-ins.js';

// Setup's own runs: git and what the test fakes; any other host tool is refused and noted here.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));
import { g, push as fixturePush, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const T0 = new Date('2026-10-20T03:00:00.000Z');
const REPO = 'a-director/Shop';
const SLUG = 'a-director__Shop';
const USER = { login: 'a-director', id: 4242, name: 'A Director' };
const PLUGIN_ROOT = '/Applications/Wheel house/plugin';
const ADDRESS = '/h/zoë/.wheelhouse/helper.sock';
const NODE = '/usr/local/bin/node';
const REF = 'v1.4.0';
const GITLAB_TOKEN = 'glpat-directors-own-token-0001';
const GITLAB_USER = { username: 'a-director', id: 77, name: 'A Director' };
const SHA = { superpowers: 'a'.repeat(40), 'mattpocock-skills': 'b'.repeat(40) };

// ---- The world: a product on a stand-in host, connected as step 3 leaves it ----

// The director's own shared settings as the product's repository holds them; `stepOne` says
// whether step 1's project-scope install switched the plugin on there (check 37): 'committed'
// (already in the repository), 'modified' (added to the tracked file, not committed) or 'untracked'
// (the repository has no settings file; step 1's install made one, not committed).
const OWN_SETTINGS = { theme: 'dark', permissions: { allow: ['Bash(ls:*)'] }, enabledPlugins: { 'their-own@elsewhere': true } };
const STEP_ONE = { 'wheelhouse@wheelhouse': true };

async function seedBare(dir, branch = 'main', { stepOne = 'committed', gitignore = null } = {}) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const made = await realRun('git', ['init', '--bare', '-q', '-b', branch, dir]);
  if (made.code !== 0) throw new Error('git init --bare failed');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seed-'));
  try {
    await g(work, 'init', '-q', '-b', branch);
    fs.writeFileSync(path.join(work, 'README.md'), '# Shop\n');
    fs.writeFileSync(path.join(work, 'CLAUDE.md'), '# Shop\n\n- Keep commits small.\n');
    if (gitignore !== null) fs.writeFileSync(path.join(work, '.gitignore'), gitignore);
    if (stepOne !== 'untracked') {
      fs.mkdirSync(path.join(work, '.claude'));
      const committed = stepOne === 'committed' ? { ...OWN_SETTINGS, enabledPlugins: { ...STEP_ONE, ...OWN_SETTINGS.enabledPlugins } } : OWN_SETTINGS;
      fs.writeFileSync(path.join(work, '.claude', 'settings.json'), `${JSON.stringify(committed, null, 2)}\n`);
    }
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'The director\'s first commit');
    await g(work, 'push', '-q', dir, branch);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const lsRemote = async (dir, branch) => (await realRun('git', ['ls-remote', dir, `refs/heads/${branch}`])).stdout.split(/\s/)[0] || null;

// A small copy of each pinned kit, its manifest, and where a stand-in install puts it.
function kits(root) {
  const upstreams = ['superpowers', 'mattpocock-skills'].map((name) => ({
    name, plugin: name, repo: `https://example.invalid/${name}.git`, ref: 'v1.0.0', sha: SHA[name], folders: ['skills/one'], files: ['LICENSE'],
  }));
  const roots = {};
  for (const u of upstreams) {
    roots[u.name] = path.join(root, 'pristine', u.name);
    fs.mkdirSync(path.join(roots[u.name], 'skills', 'one'), { recursive: true });
    fs.writeFileSync(path.join(roots[u.name], 'skills', 'one', 'SKILL.md'), `${u.name}\n`);
    fs.writeFileSync(path.join(roots[u.name], 'LICENSE'), 'licence\n');
  }
  return { manifest: buildManifest({ roots, version: '1.4.0', upstreams }), roots };
}

// `defaultBranch` is what the host says; `branch` the folder's own. `claudeMissing`: no `claude`.
// `host`: 'github' or 'gitlab'. `stepOne` and `gitignore`: as seedBare's. `ownStatusLine`: a status
// line of the director's in their user settings. `w.duringInstall(plugin)` runs while each pin is
// installed, and `w.gitFails(args)` makes a git call fail.
async function world({
  defaultBranch = 'main', branch = 'main', claudeMissing = false, release = REF, host = 'github', stepOne = 'committed', gitignore = null, ownStatusLine = null, baseUrl = null,
} = {}) {
  const w = { calls: [], protection: [], asked: [], gitCalls: [], duringInstall: () => {}, gitFails: () => false, api: [], layout: (o) => JSON.stringify(o) };
  w.noGlobal = path.join(tempFolder('wh-git-'), 'empty-config');
  fs.writeFileSync(w.noGlobal, '');
  const hostRoot = tempFolder('wh-host-');
  w.bare = path.join(hostRoot, `${REPO}.git`);
  await seedBare(w.bare, branch, { stepOne, gitignore });
  w.user = tempFolder('wh-user zoë ');
  w.folder = path.join(w.user, 'Projects', 'Shop');
  fs.mkdirSync(path.dirname(w.folder), { recursive: true });
  const cloned = await realRun('git', ['clone', '-q', w.bare, w.folder]);
  if (cloned.code !== 0) throw new Error(cloned.stderr);
  w.folder = fs.realpathSync.native(w.folder);
  fs.mkdirSync(path.join(w.folder, '.claude'), { recursive: true });
  // Step 1's project-scope install switched the plugin on in the project's settings (check 37).
  const shared = path.join(w.folder, '.claude', 'settings.json');
  if (stepOne === 'untracked') fs.writeFileSync(shared, `${JSON.stringify({ enabledPlugins: STEP_ONE }, null, 2)}\n`);
  if (stepOne === 'modified') {
    const was = JSON.parse(fs.readFileSync(shared, 'utf8'));
    fs.writeFileSync(shared, `${JSON.stringify({ ...was, enabledPlugins: { ...was.enabledPlugins, ...STEP_ONE } }, null, 2)}\n`);
  }
  // Step 2 wrote setup's own allow rule into this computer's local settings (ruling R43).
  fs.writeFileSync(path.join(w.folder, '.claude', 'settings.local.json'), `${JSON.stringify({ permissions: { allow: [`Bash(${setupCommand(PLUGIN_ROOT, { platform: 'darwin' })}:*)`] } }, null, 2)}\n`);
  writeProject(SLUG, { folder: w.folder, remoteUrl: w.bare, host, repo: REPO, connection: { host, mode: host === 'gitlab' ? 'narrow' : 'quick', project: REPO, ...(baseUrl === null ? {} : { baseUrl }) } });
  w.claudeHome = path.join(w.user, 'claude config');
  fs.mkdirSync(w.claudeHome, { recursive: true });
  // The install line declared Wheelhouse's marketplace at its release in the user's settings (check 37).
  fs.writeFileSync(path.join(w.claudeHome, 'settings.json'), JSON.stringify({
    ...(release ? { extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: release } } } } : {}),
    ...(ownStatusLine ? { statusLine: ownStatusLine } : {}),
  }));
  const k = kits(tempFolder('wh-kits-'));
  w.manifest = k.manifest;
  const answer = (stdout, code = 0, stderr = '') => ({ code, stdout, stderr });
  w.run = async (file, args = [], options = {}) => {
    const name = path.basename(file).replace(/\.(exe|cmd)$/, '');
    if (name === 'git') {
      w.gitCalls.push({ args: [...args], env: options.env ?? {} });
      if (w.gitFails(args)) return answer('', 1, 'refused by the test');
      // The step's git reads no global settings or ignore list here, so this computer's own don't count.
      return realRun(file, args, { ...options, env: { ...options.env, GIT_CONFIG_GLOBAL: w.noGlobal, XDG_CONFIG_HOME: path.dirname(w.noGlobal) } });
    }
    w.calls.push({ tool: name, args: [...args], cwd: options.cwd, env: options.env });
    if (name === 'gh') {
      if (args[0] === 'api' && args[1] === 'user') return answer(JSON.stringify(USER));
      if (args[0] === 'api' && args[1] === `repos/${REPO}`) return answer(JSON.stringify({ full_name: REPO, default_branch: defaultBranch, private: true }));
      return answer('', 1, 'unknown command');
    }
    if (name === 'glab') {
      if (args[0] === 'auth' && args[1] === 'status' && args.includes('--show-token')) return answer('', 0, `gitlab.com\n  ✓ Logged in to gitlab.com as ${USER.login}\n  ✓ Token found: ${GITLAB_TOKEN}\n`);
      if (args[0] === 'api' && args[1] === 'user') return answer(JSON.stringify(GITLAB_USER));
      return answer('', 1, 'unknown command');
    }
    if (name === 'claude') {
      if (claudeMissing) throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      if (args[0] === 'plugin' && args[1] === 'install' && args.includes('--scope') && args[args.indexOf('--scope') + 1] === 'project') {
        const [plugin, marketplace] = args[2].split('@');
        const into = path.join(w.claudeHome, 'plugins', 'cache', marketplace, plugin);
        fs.cpSync(k.roots[plugin], into, { recursive: true });
        const file = path.join(w.claudeHome, 'plugins', 'installed_plugins.json');
        let record = { version: 2, plugins: {} };
        try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first install */ }
        record.plugins[args[2]] = [{ scope: 'project', projectPath: options.cwd, installPath: into, version: '1.0.0', gitCommitSha: SHA[plugin] }];
        fs.writeFileSync(file, JSON.stringify(record));
        // Claude Code writes the project's settings again on the way, in its own layout (`w.layout`).
        const settings = path.join(options.cwd, '.claude', 'settings.json');
        fs.writeFileSync(settings, w.layout(JSON.parse(fs.readFileSync(settings, 'utf8'))));
        await w.duringInstall(plugin);
        return answer(`Successfully installed plugin: ${args[2]} (scope: project)\n`);
      }
      return answer('', 1, 'unknown command');
    }
    return hostGuard(file, args, options);
  };
  // Protection as Task 8's switchOnAsDirector gives it: here it notes what the host held when it
  // was asked, so the order can be read.
  w.switchOn = async ({ host: on, repo, api, realUsers }) => {
    w.switched = { realUsers };
    w.protection.push({ host: on, repo, tip: await lsRemote(w.bare, defaultBranch), ...(api ? { api: (await api.get(`/projects/${encodeURIComponent(repo)}`)).status } : {}) });
    return on === 'gitlab'
      ? { available: true, on: true, line: `GitLab blocks direct pushes to ${defaultBranch}.`, askPipelines: true, gaps: w.gaps ?? [] }
      : { available: true, on: true, line: `GitHub blocks direct pushes to ${defaultBranch}.` };
  };
  // GitLab's API, reached as directorGitlabApi reaches it with glab's sign-in: the token only in the header.
  w.fetch = async (url, init = {}) => {
    w.api.push({ url, auth: init.headers?.Authorization ?? null });
    const body = url.endsWith(`/projects/${encodeURIComponent(REPO)}`) ? { id: 41, path_with_namespace: REPO, default_branch: defaultBranch } : null;
    return { status: body ? 200 : 404, text: async () => JSON.stringify(body) };
  };
  w.status = async () => ({ available: true, on: w.protection.length > 0, line: 'read' });
  w.step = projectFilesStep({
    run: (...args) => w.run(...args), findGit: async () => ({ ok: true, path: 'git' }), claude: () => ({ kind: 'direct', file: 'claude' }),
    manifest: () => w.manifest, claudeHome: () => w.claudeHome, switchOn: w.switchOn, protectionStatus: w.status,
    gitlab: ({ run, baseUrl: asked }) => { w.asked.push(asked); return directorGitlabApi({ run, fetch: w.fetch, baseUrl: asked }); },
    address: () => ADDRESS, node: NODE, pluginRoot: PLUGIN_ROOT,
  });
  w.answers = { '4.live-data': { label: LIVE_DATA.yes, text: null, at: T0.toISOString() } };
  w.ctx = (extra = {}) => ({ folder: w.folder, step: 7, now: () => T0, platform: 'darwin', userHome: w.user, answers: w.answers, ...extra });
  w.plan = () => w.step.plan(w.ctx());
  // Applies the step's list as the engine does, each change recorded in the journal as it is made.
  w.apply = async (changes) => {
    const run = findRun(w.folder) ?? startRun({ folder: w.folder, now: () => T0 });
    const done = await runApply({ step: w.step, runId: run.id, changes, ctx: w.ctx({ runId: run.id }), current: () => true, copy: async () => {} });
    return { ...done, run: findRun(w.folder) };
  };
  w.json = (rel) => JSON.parse(fs.readFileSync(path.join(w.folder, rel), 'utf8'));
  return w;
}

// ---- The tests ----

test('the project settings keep the director\'s own keys and add Wheelhouse\'s', async () => {
  await withHome(async () => {
    const w = await world();
    const planned = await w.plan();
    assert.ok(Array.isArray(planned.changes), planned.why);
    // The card composes, names the step, the release, the branch and the sign-in.
    const { question } = composeCard({ ...planned.card, target: { step: 7, hash: '0'.repeat(64) } });
    assert.match(question.question, /step 7/);
    assert.match(question.question, new RegExp(REF.replaceAll('.', '\\.')));
    assert.match(question.question, /main/);
    assert.match(question.question, /never updates itself/);
    const done = await w.apply(planned.changes);
    assert.equal(done.ok, true, done.reason);

    const settings = w.json('.claude/settings.json');
    // The director's own keys stay as they were.
    assert.equal(settings.theme, 'dark');
    assert.ok(settings.permissions.allow.includes('Bash(ls:*)'));
    assert.equal(settings.enabledPlugins['their-own@elsewhere'], true);
    assert.equal(settings.enabledPlugins['wheelhouse@wheelhouse'], true);
    // Wheelhouse's: the deny rules, the sandbox, the pins on and the other copies off, and the
    // marketplace at the release with auto-update off, which step 6's card rests on.
    assert.ok(settings.permissions.deny.includes('Bash(git push:*)'));
    assert.equal(settings.sandbox.enabled, true);
    assert.equal(settings.enabledPlugins[`superpowers@${MARKETPLACE}`], true);
    assert.equal(settings.enabledPlugins[`mattpocock-skills@${MARKETPLACE}`], true);
    for (const off of SWITCHED_OFF_PLUGINS) assert.equal(settings.enabledPlugins[off], false);
    assert.equal(settings.extraKnownMarketplaces[MARKETPLACE].autoUpdate, false);
    assert.equal(settings.extraKnownMarketplaces[MARKETPLACE].source.ref, REF);
    assert.equal(settings.autoCompactWindow, 300000);

    // This computer's settings: setup's own rule kept, the front desk's added with the one file it
    // writes its input to without a scratchpad (ruling F85), the helper's socket and the status
    // line, by key; never committed.
    const local = w.json('.claude/settings.local.json');
    assert.deepEqual(local.permissions.allow, [
      `Bash(${setupCommand(PLUGIN_ROOT, { platform: 'darwin' })}:*)`, `Bash(${frontDeskCommand(PLUGIN_ROOT, { platform: 'darwin' })}:*)`,
      `Bash(${frontDeskCommand(PLUGIN_ROOT, { platform: 'darwin', noSystemCa: true })}:*)`,
      'Edit(/.wheelhouse/front-desk.json)',
      `Bash(${setupCommand(PLUGIN_ROOT, { platform: 'darwin', noSystemCa: true })}:*)`,
    ]);
    assert.deepEqual(local.sandbox.network.allowUnixSockets, [ADDRESS]);
    assert.match(local.statusLine.command, /statusline\.js/);

    // The "Compact instructions" section, added once after the director's own lines.
    const claude = fs.readFileSync(path.join(w.folder, 'CLAUDE.md'), 'utf8');
    assert.ok(claude.startsWith('# Shop\n\n- Keep commits small.\n'));
    assert.equal(claude.split(COMPACT_HEADING).length, 2);

    // Every change is in the journal with its value before; the director's keys were not touched.
    const changes = done.run.changes;
    assert.ok(changes.every((c) => c.step === 7));
    assert.ok(!changes.some((c) => c.kind === 'json-key' && c.key[0] === 'theme'));
    const claudeChange = changes.find((c) => c.kind === 'file' && c.target.endsWith('CLAUDE.md'));
    assert.equal(claudeChange.before, '# Shop\n\n- Keep commits small.\n');

    // Asked again, the step finds nothing more to change in the files, and lists no second section.
    const again = await w.plan();
    assert.deepEqual(again.changes.filter((c) => c.kind === 'json-key' || c.kind === 'file'), []);
    assert.deepEqual(projectFilesChange({
      folder: w.folder, config: w.json('.claude/wheelhouse.json'), release: { ref: REF },
      local: { address: ADDRESS, node: NODE, pluginRoot: PLUGIN_ROOT, platform: 'darwin' },
    }), []);
  });
});

test('the configuration has every plan\'s keys with their defaults', () => {
  for (const [label, liveData] of [[LIVE_DATA.yes, true], [LIVE_DATA.no, false]]) {
    const config = starterConfig({ answers: { '4.live-data': { label, text: null } }, host: 'github' });
    const read = readConfig(JSON.stringify(config));
    // Each plan's keys: safety's, the build loop's, the front desk's pages, and live data from step 4.
    for (const key of ['v', 'criticalAreas', 'ciFiles', 'mcpServers', 'webDomains', 'routing', 'sessionMode', 'buildCommands', 'watcherShape', 'hotFiles', 'flagFiles', 'pages', 'liveData']) {
      assert.ok(Object.hasOwn(config, key), key);
    }
    assert.deepEqual(read, config, 'it reads back as it was written, with nothing filled in');
    assert.deepEqual(Object.keys(config.routing).sort(), [...ROLES].sort());
    assert.ok(Object.values(config.routing).every((m) => m === null), 'no model is named');
    assert.equal(config.sessionMode, 'acceptEdits');
    assert.deepEqual(config.buildCommands, [...DEFAULT_BUILD_COMMANDS]);
    assert.deepEqual(config.hotFiles, [...DEFAULT_HOT_FILES]);
    assert.equal(config.watcherShape, 1);
    assert.deepEqual(config.pages, []);
    assert.equal(config.liveData, liveData);
    // Real users are the `phase` setting in state (ruling R38), never a configuration key.
    assert.equal(Object.hasOwn(config, 'realUsers'), false);
  }
  assert.throws(() => starterConfig({ answers: {}, host: 'github' }), /live data/);
});

test('the setup commit holds exactly the three files, and goes up before protection is on', async () => {
  await withHome(async () => {
    const w = await world();
    const tipBefore = await lsRemote(w.bare, 'main');
    // The director's own work in progress: a file staged, one not yet added.
    fs.writeFileSync(path.join(w.folder, 'notes.txt'), 'the director\'s own notes\n');
    await g(w.folder, 'add', 'notes.txt');
    fs.writeFileSync(path.join(w.folder, 'scratch.txt'), 'not added\n');

    const planned = await w.plan();
    assert.deepEqual(planned.changes.filter((c) => c.kind === 'host').map((c) => c.action), ['commit', 'protect']);
    const done = await w.apply(planned.changes);
    assert.equal(done.ok, true, done.reason);

    const tip = await lsRemote(w.bare, 'main');
    assert.notEqual(tip, tipBefore);
    assert.equal(await g(w.bare, 'log', '-1', '--format=%s', tip), COMMIT_MESSAGE);
    assert.equal(await g(w.bare, 'rev-parse', `${tip}^`), tipBefore, 'one commit on the branch as it was');
    const files = (await g(w.bare, 'diff-tree', '--no-commit-id', '--name-only', '-r', tip)).split('\n').sort();
    assert.deepEqual(files, [...SETUP_FILES].sort());
    assert.deepEqual(files, ['.claude/settings.json', '.claude/wheelhouse.json', 'CLAUDE.md']);
    // The author is the signed-in account's own, its no-reply address: a fresh computer has no git identity.
    assert.equal(await g(w.bare, 'log', '-1', '--format=%an <%ae>', tip), `${USER.name} <${USER.id}+${USER.login}@users.noreply.github.com>`);
    // What was committed is what the folder holds, as Wheelhouse wrote it (Claude Code's rewrite put back).
    assert.equal(await g(w.bare, 'show', `${tip}:.claude/settings.json`), fs.readFileSync(path.join(w.folder, '.claude', 'settings.json'), 'utf8').trim());
    assert.deepEqual(JSON.parse(await g(w.bare, 'show', `${tip}:.claude/wheelhouse.json`)).liveData, true);

    // The director's staged work is still staged, and in no commit; their other file untouched.
    assert.deepEqual((await g(w.folder, 'diff', '--cached', '--name-only')).split('\n'), ['notes.txt']);
    assert.equal(await g(w.folder, 'status', '--porcelain', '--', 'scratch.txt'), '?? scratch.txt');
    assert.equal(fs.existsSync(path.join(w.folder, '.claude', 'settings.local.json')), true);

    // Pushed with the director's own sign-in, their tool as git's credential helper; never the narrow key.
    const pushed = w.gitCalls.find((c) => c.args.includes('push'));
    assert.match(pushed.env.GIT_CONFIG_VALUE_1, /"gh" auth git-credential$/);
    assert.ok(pushed.args.includes(`${tip}:refs/heads/main`), 'the exact commit, never whatever HEAD is');
    assert.ok(!Object.keys(pushed.env).some((k) => /TOKEN|KEY$/.test(k)));

    // Protection was switched on once, after the commit was on the host.
    assert.deepEqual(w.protection, [{ host: 'github', repo: REPO, tip }]);
    // What protection read back is the step's last line for the director.
    assert.match(done.run.steps[7].say.line, /blocks direct pushes/);

    // Recorded first: the commit and the push as host changes with the branch's tip before them, then protection.
    const host = done.run.changes.filter((c) => c.kind === 'host');
    assert.deepEqual(host.map((c) => c.after?.action), ['commit', 'push', 'protect']);
    assert.equal(host[0].before.sha, tipBefore);
    assert.equal(host[1].before.sha, tipBefore);
    assert.equal(host[1].after.sha, tip);
    assert.equal(host[2].before.on, false);

    // Asked again, nothing is left to commit or push: only protection, which is safe to repeat.
    const again = await w.plan();
    assert.deepEqual(again.changes.map((c) => c.action ?? c.kind), ['protect']);
  });
});

test('a default branch that is Wheelhouse\'s own, or not the folder\'s, is refused plainly; a commit made but not pushed is pushed on the next Go ahead', async () => {
  await withHome(async () => {
    const own = await world({ defaultBranch: 'wheelhouse-state' });
    await assert.rejects(own.plan(), /wheelhouse-state.*Wheelhouse's own/);
  });
  await withHome(async () => {
    const pages = await world({ defaultBranch: 'gh-pages' });
    await assert.rejects(pages.plan(), /default branch .*gh-pages.*this folder is on main/);
  });
  await withHome(async () => {
    // A product whose default branch is not main has its commit and protection there, named on the card.
    const trunk = await world({ defaultBranch: 'trunk', branch: 'trunk' });
    const planned = await trunk.plan();
    assert.match(composeCard({ ...planned.card, target: { step: 7, hash: '0'.repeat(64) } }).question.question, /trunk/);
  });
  await withHome(async () => {
    // The director's own commit not yet on the host would go up with setup's: refused.
    const ahead = await world();
    fs.writeFileSync(path.join(ahead.folder, 'mine.txt'), 'mine\n');
    await g(ahead.folder, 'add', 'mine.txt');
    await g(ahead.folder, 'commit', '-q', '-m', 'Mine');
    await assert.rejects(ahead.plan(), /commits of your own/);
  });
  await withHome(async () => {
    // Their own changes to CLAUDE.md, not committed, would go up in setup's commit: asked about
    // first (ruling R95; the question's own test is below).
    const edited = await world();
    fs.appendFileSync(path.join(edited.folder, 'CLAUDE.md'), '- Draft rule.\n');
    assert.match((await edited.plan()).ask?.card.what ?? '', /CLAUDE\.md has changes of yours/);
  });
  await withHome(async () => {
    // A push that failed leaves setup's commit in the folder: the next plan pushes it, and commits nothing new.
    const w = await world();
    const planned = await w.plan();
    const failing = w.run;
    w.run = async (file, args, options) => (args.includes('push') ? { code: 1, stdout: '', stderr: 'could not reach the host' } : failing(file, args, options));
    const first = await w.apply(planned.changes);
    assert.equal(first.ok, false);
    assert.match(first.reason, /push/);
    assert.deepEqual(w.protection, [], 'no protection without the commit up');
    w.run = failing;
    const again = await w.plan();
    assert.deepEqual(again.changes.filter((c) => c.kind === 'host').map((c) => c.action), ['push', 'protect']);
    const second = await w.apply(again.changes);
    assert.equal(second.ok, true, second.reason);
    assert.equal(await g(w.bare, 'log', '-1', '--format=%s', 'main'), COMMIT_MESSAGE);
    assert.equal(await g(w.bare, 'rev-list', '--count', 'main'), '2');
  });
});

test('step 1\'s install left in the folder, not committed, goes up in setup\'s commit; the director\'s own change is still asked about', async () => {
  for (const stepOne of ['untracked', 'modified']) {
    await withHome(async () => {
      const w = await world({ stepOne });
      const planned = await w.plan();
      assert.ok(Array.isArray(planned.changes), stepOne);
      const done = await w.apply(planned.changes);
      assert.equal(done.ok, true, done.reason);
      const committed = JSON.parse(await g(w.bare, 'show', 'main:.claude/settings.json'));
      assert.equal(committed.enabledPlugins['wheelhouse@wheelhouse'], true, stepOne);
      assert.equal(committed.sandbox.enabled, true);
      if (stepOne === 'modified') assert.equal(committed.theme, 'dark');
    });
  }
  await withHome(async () => {
    const w = await world({ stepOne: 'modified' });
    const file = path.join(w.folder, '.claude', 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), theme: 'light' }));
    assert.match((await w.plan()).ask?.card.what ?? '', /\.claude\/settings\.json has changes of yours/);
  });
});

test('a commit, a branch switch or an edit made while the pins install never goes up', async () => {
  const cases = {
    commit: async (w) => {
      fs.writeFileSync(path.join(w.folder, 'mine.txt'), 'mine\n');
      await g(w.folder, 'add', 'mine.txt');
      await g(w.folder, 'commit', '-q', '-m', 'Mine');
    },
    'branch switch': (w) => g(w.folder, 'switch', '-q', '-c', 'elsewhere'),
    edit: (w) => { fs.appendFileSync(path.join(w.folder, 'CLAUDE.md'), '- Draft rule.\n'); },
  };
  for (const [name, meanwhile] of Object.entries(cases)) {
    await withHome(async () => {
      const w = await world();
      const tip = await lsRemote(w.bare, 'main');
      let once = false;
      w.duringInstall = async () => { if (!once) { once = true; await meanwhile(w); } };
      const done = await w.apply((await w.plan()).changes);
      assert.equal(done.ok, false, name);
      assert.match(done.reason, /changed while|since the card/, name);
      assert.equal(await lsRemote(w.bare, 'main'), tip, `${name}: nothing went up`);
      assert.deepEqual(w.protection, [], name);
      assert.ok(!(await g(w.folder, 'log', '--all', '--format=%s')).includes(COMMIT_MESSAGE), `${name}: no setup commit made`);
    });
  }
  await withHome(async () => {
    // On the push's retry, the setup commit itself goes up, never a commit of the director's on top of it.
    const w = await world();
    const failing = w.run;
    w.run = async (file, args, options) => (args.includes('push') ? { code: 1, stdout: '', stderr: 'no' } : failing(file, args, options));
    await w.apply((await w.plan()).changes);
    w.run = failing;
    const setupCommit = await g(w.folder, 'rev-parse', 'HEAD');
    const again = await w.plan();
    fs.writeFileSync(path.join(w.folder, 'mine.txt'), 'mine\n');
    await g(w.folder, 'add', 'mine.txt');
    await g(w.folder, 'commit', '-q', '-m', 'Mine');
    const done = await w.apply(again.changes);
    assert.equal(done.ok, true, done.reason);
    assert.equal(await lsRemote(w.bare, 'main'), setupCommit);
  });
});

test('Claude Code\'s rewrite of the settings during the installs is put back key by key, through the journal', async () => {
  await withHome(async () => {
    const w = await world();
    const file = path.join(w.folder, '.claude', 'settings.json');
    w.duringInstall = () => {
      const now = JSON.parse(fs.readFileSync(file, 'utf8'));
      delete now.autoCompactWindow;
      fs.writeFileSync(file, JSON.stringify(now));
    };
    const done = await w.apply((await w.plan()).changes);
    assert.equal(done.ok, true, done.reason);
    assert.equal(w.json('.claude/settings.json').autoCompactWindow, 300000);
    assert.equal(w.json('.claude/settings.json').theme, 'dark');
    assert.equal(done.run.changes.filter((c) => c.kind === 'json-key' && c.key.join('.') === 'autoCompactWindow').length, 2);
    assert.equal(JSON.parse(await g(w.bare, 'show', 'main:.claude/settings.json')).autoCompactWindow, 300000);
  });
});

test('a hook declared in the project folder\'s git config stops step 7, named, before setup\'s git runs with the director\'s sign-in (rulings R109, R110)', async () => {
  await withHome(async () => {
    const w = await world();
    const planned = await w.plan();
    const mark = path.join(w.user, 'hook-ran');
    await g(w.folder, 'config', 'hook.planted.event', 'pre-push');
    await g(w.folder, 'config', 'hook.planted.command', `echo ran >> "${mark}"`);
    const done = await w.apply(planned.changes);
    assert.equal(done.ok, false);
    assert.match(done.reason, /setup doesn't allow \(hook\.planted\.event, hook\.planted\.command\)/);
    assert.equal(fs.existsSync(mark), false);
    assert.equal(await g(w.bare, 'rev-list', '--count', 'main'), '1', 'nothing pushed');
    // Every git call setup made ran with the global and system config shut out and hooks off.
    assert.ok(w.gitCalls.length > 0);
    for (const c of w.gitCalls) {
      assert.equal(c.env.GIT_CONFIG_NOSYSTEM, '1');
      assert.equal(c.env.GIT_CONFIG_GLOBAL, '/dev/null');
      // The look at the repository's own settings runs without the call's settings, to see only the repository's.
      if (c.args.join(' ') === 'config --includes --name-only --list -z') continue;
      const pairs = Array.from({ length: Number(c.env.GIT_CONFIG_COUNT) }, (_, i) => `${c.env[`GIT_CONFIG_KEY_${i}`]}=${c.env[`GIT_CONFIG_VALUE_${i}`]}`);
      assert.ok(pairs.includes('core.hooksPath=/dev/null') && pairs.includes('core.fsmonitor=false'), pairs.join(' '));
    }
  });
});

test('a clean filter in the project folder\'s git config stops step 7, named, before setup\'s commit adds anything (ruling R110)', async () => {
  await withHome(async () => {
    const w = await world();
    const planned = await w.plan();
    const mark = path.join(w.user, 'filter-ran');
    fs.writeFileSync(path.join(w.folder, '.git', 'info', 'attributes'), '* filter=planted\n');
    await g(w.folder, 'config', 'filter.planted.clean', `sh -c 'echo ran >> "${mark}"; cat'`);
    const done = await w.apply(planned.changes);
    assert.equal(done.ok, false);
    assert.match(done.reason, /setup doesn't allow \(filter\.planted\.clean\)/);
    assert.equal(fs.existsSync(mark), false);
    assert.equal(await g(w.bare, 'rev-list', '--count', 'main'), '1', 'nothing pushed');
  });
});

test('a commit that fails leaves nothing staged by setup, and nothing pushed', async () => {
  await withHome(async () => {
    const w = await world();
    w.gitFails = (args) => args.includes('commit');
    const done = await w.apply((await w.plan()).changes);
    assert.equal(done.ok, false);
    assert.match(done.reason, /setup commit/);
    assert.equal(await g(w.folder, 'ls-files', '--', '.claude/wheelhouse.json'), '', 'the intent-to-add entry is gone');
    assert.equal(await g(w.bare, 'rev-list', '--count', 'main'), '1');
  });
});

test('this computer\'s settings are kept out of git, unless the product already ignores them', async () => {
  await withHome(async () => {
    const w = await world();
    const planned = await w.plan();
    assert.ok(planned.changes.some((c) => c.line === '/.claude/settings.local.json'));
    const done = await w.apply(planned.changes);
    assert.equal(done.ok, true, done.reason);
    const exclude = path.join(w.folder, '.git', 'info', 'exclude');
    assert.ok(fs.readFileSync(exclude, 'utf8').split('\n').includes('/.claude/settings.local.json'));
    assert.equal(await g(w.folder, 'status', '--porcelain', '--', '.claude/settings.local.json'), '');
    const change = done.run.changes.find((c) => c.target === exclude);
    assert.equal(change.kind, 'file');
    assert.equal(change.line, '/.claude/settings.local.json');
  });
  await withHome(async () => {
    const w = await world({ gitignore: '.claude/settings.local.json\n' });
    assert.ok(!(await w.plan()).changes.some((c) => c.line === EXCLUDE_LINE));
  });
});

test('.wheelhouse/ is kept out of git by step 7, listed on its card and recorded with its value before, unless the folder\'s list holds it in any form (ruling R108)', async () => {
  await withHome(async () => {
    const w = await world();
    const exclude = path.join(w.folder, '.git', 'info', 'exclude');
    const before = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : null;
    const planned = await w.plan();
    assert.deepEqual(planned.changes.filter((c) => c.line !== undefined).map((c) => [c.target, c.line]), [[exclude, EXCLUDE_LINE], [exclude, WHEELHOUSE_LINE]]);
    const text = composeCard({ ...planned.card, target: { step: 7, hash: planHash(planned.changes) } }).question.question;
    assert.match(text, /\.wheelhouse\/ kept out of git/);
    const done = await w.apply(planned.changes);
    assert.equal(done.ok, true, done.reason);
    const lines = fs.readFileSync(exclude, 'utf8').split('\n');
    assert.ok(lines.includes(EXCLUDE_LINE) && lines.includes(WHEELHOUSE_LINE), 'both lines written');
    // Each line recorded just before it was written, with the list as it was, so uninstall reverses both.
    const made = done.run.changes.filter((c) => c.target === exclude);
    assert.deepEqual(made.map((c) => [c.kind, c.line]), [['file', EXCLUDE_LINE], ['file', WHEELHOUSE_LINE]]);
    assert.equal(made[0].before, before);
    assert.equal(made[1].before, made[0].after);
    assert.equal(made[1].after, fs.readFileSync(exclude, 'utf8'));
    fs.mkdirSync(path.join(w.folder, '.wheelhouse'), { recursive: true });
    fs.writeFileSync(path.join(w.folder, '.wheelhouse', 'note'), 'x\n');
    assert.equal(await g(w.folder, 'status', '--porcelain', '--', '.wheelhouse'), '', 'git sees nothing in .wheelhouse/');
  });
  for (const form of ['/.wheelhouse', '.wheelhouse', '/.wheelhouse/', '  .wheelhouse/  ']) {
    await withHome(async () => {
      const w = await world();
      const exclude = path.join(w.folder, '.git', 'info', 'exclude');
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.writeFileSync(exclude, `# git ls-files --others --exclude-from=.git/info/exclude\n${form}\n`);
      const planned = await w.plan();
      assert.deepEqual(planned.changes.filter((c) => c.line !== undefined).map((c) => c.line), [EXCLUDE_LINE], form);
      const text = composeCard({ ...planned.card, target: { step: 7, hash: planHash(planned.changes) } }).question.question;
      assert.doesNotMatch(text, /\.wheelhouse\//, form);
      const done = await w.apply(planned.changes);
      assert.equal(done.ok, true, done.reason);
      assert.equal(fs.readFileSync(exclude, 'utf8').split('\n').filter((l) => l.includes('.wheelhouse')).length, 1, `${form}: nothing added for it`);
    });
  }
});

test('on GitLab: the default branch and protection through glab\'s sign-in, the author\'s no-reply address, and the pipelines line', async () => {
  await withHome(async () => {
    const w = await world({ host: 'gitlab' });
    const planned = await w.plan();
    assert.match(composeCard({ ...planned.card, target: { step: 7, hash: '0'.repeat(64) } }).question.question, /pipelines must succeed/);
    const done = await w.apply(planned.changes);
    assert.equal(done.ok, true, done.reason);
    assert.equal(await g(w.bare, 'log', '-1', '--format=%an <%ae>', 'main'), `${GITLAB_USER.name} <${GITLAB_USER.id}-${GITLAB_USER.username}@users.noreply.gitlab.com>`);
    const pushed = w.gitCalls.find((c) => c.args.includes('push'));
    assert.match(pushed.env.GIT_CONFIG_VALUE_1, /"glab" auth git-credential$/);
    assert.ok(w.api.length > 0 && w.api.every((a) => a.auth === `Bearer ${GITLAB_TOKEN}`), 'the token only in the header');
    assert.ok(w.calls.every((c) => !c.args.join(' ').includes(GITLAB_TOKEN)));
    assert.deepEqual(w.protection.map((p) => [p.host, p.api]), [['gitlab', 200]]);
    assert.match(done.run.steps[7].say.line, /Pipelines must succeed/);
  });
  // An account's own commit address is used where it has one.
  const run = async () => ({ code: 0, stdout: JSON.stringify({ ...GITLAB_USER, commit_email: 'me@example.invalid' }), stderr: '' });
  assert.deepEqual(await commitAuthor({ host: 'gitlab', run }), { name: GITLAB_USER.name, email: 'me@example.invalid' });
});

test('on GitLab, a project with real users is switched on as one, and the gaps found are said in one line', async () => {
  await withHome(async () => {
    const w = await world({ host: 'gitlab' });
    w.answers['3.real-users'] = { label: REAL_USERS.yes, text: null, at: T0.toISOString() };
    w.gaps = ["DEBUG is a project secret that a merge request's pipeline could read", "With real users, the project's tests on the host could be faked with Wheelhouse's key; GitLab Premium's approval step would close that"];
    const done = await w.apply((await w.plan()).changes);
    assert.equal(done.ok, true, done.reason);
    assert.deepEqual(w.switched, { realUsers: true });
    const said = done.run.steps[7].say.line;
    assert.ok(said.length <= 500);
    assert.match(said, /merged by Maintainers only on GitLab/);
    // The faked-tests line comes before the secrets' names; with the pipelines prompt before them too the
    // line is full, so the one secret is counted rather than named.
    assert.ok(said.includes(w.gaps[1].replace(/\.$/, '')), w.gaps[1]);
    assert.ok(said.includes(w.gaps[0]) || / \(and 1 more\)$/.test(said), said);
  });
  // Many gaps still fit one line: the ones that do not are counted.
  await withHome(async () => {
    const w = await world({ host: 'gitlab' });
    w.gaps = Array.from({ length: 30 }, (_, i) => `SECRET_NUMBER_${i} is a project secret that a merge request's pipeline could read`);
    const done = await w.apply((await w.plan()).changes);
    assert.equal(done.ok, true, done.reason);
    assert.deepEqual(w.switched, { realUsers: false });
    const said = done.run.steps[7].say.line;
    assert.ok(said.length <= 500);
    assert.match(said, /SECRET_NUMBER_0 is a project secret/);
    assert.match(said, / \(and \d+ more\)$/);
  });
});

test('on a company GitLab, step 7 reads and protects through the company address, and the setup commit\'s git carries the certificate for it', async () => {
  const COMPANY = 'https://git.example.org:8443';
  await withHome(async () => {
    const w = await world({ host: 'gitlab', baseUrl: COMPANY });
    // Setup made the company's certificate file (step 3): git then gets it for that address.
    const file = caFile(wheelhouseHome());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'CERTIFICATES\n');
    const planned = await w.plan();
    assert.ok(Array.isArray(planned.changes), planned.why);
    const done = await w.apply(planned.changes);
    assert.equal(done.ok, true, done.reason);
    // The API is asked at the company's address (the default branch, then protection), never gitlab.com.
    assert.deepEqual(w.asked, [COMPANY, COMPANY]);
    assert.ok(w.api.length > 0 && w.api.every((a) => a.url.startsWith(`${COMPANY}/api/v4/`)), JSON.stringify(w.api));
    // glab is named the company's host wherever it is asked, and the author is read from it.
    const glab = w.calls.filter((c) => c.tool === 'glab');
    assert.ok(glab.length >= 2);
    assert.ok(glab.every((c) => c.env?.GITLAB_HOST === 'git.example.org:8443'), JSON.stringify(glab.map((c) => c.env)));
    // Every git call of the step carries the certificate pair for that address and no other (the push too).
    const pushed = w.gitCalls.find((c) => c.args.includes('push'));
    const pairs = Object.entries(pushed.env).filter(([k]) => /^GIT_CONFIG_KEY_\d+$/.test(k)).map(([k, key]) => [key, pushed.env[k.replace('KEY', 'VALUE')]]);
    assert.ok(pairs.some(([key, value]) => key === `http.${COMPANY}/.sslCAInfo` && value === file), JSON.stringify(pairs));
    assert.ok(w.gitCalls.every((c) => !JSON.stringify(c.env).match(/sslVerify["',]*\s*[:=]\s*["']?(false|0)/i)), 'checks stay on');
  });
  // Without the file the pair is not added, and the public service is asked at its own address.
  await withHome(async () => {
    const w = await world({ host: 'gitlab' });
    const done = await w.apply((await w.plan()).changes);
    assert.equal(done.ok, true, done.reason);
    assert.deepEqual(w.asked, [undefined, undefined]);
    assert.ok(w.api.every((a) => a.url.startsWith('https://gitlab.com/api/v4/')));
    assert.ok(w.gitCalls.every((c) => !JSON.stringify(c.env).includes('sslCAInfo')));
  });
});

test('step 7\'s line puts everything but the secrets\' names first, so "(and N more)" only ever counts secrets', async () => {
  const secrets = Array.from({ length: 5 }, (_, i) => `SECRET_NUMBER_${i} is a project secret that a merge request's pipeline could read`);
  const skipped = 'A merge request whose pipeline was skipped still counts as passed';
  const faked = "With real users, the project's tests on the host could be faked with Wheelhouse's key; GitLab Premium's approval step would close that";
  // [real users, the host's other gaps, what must come before the first secret]
  for (const [realUsers, others, before] of [
    [true, [faked], ['GitLab blocks direct pushes to main', 'merged by Maintainers only on GitLab', '"Pipelines must succeed" is left off on main', 'faked with Wheelhouse']],
    [false, [skipped], ['GitLab blocks direct pushes to main', '"Pipelines must succeed" is left off on main', skipped]],
  ]) {
    await withHome(async () => {
      const w = await world({ host: 'gitlab' });
      if (realUsers) w.answers['3.real-users'] = { label: REAL_USERS.yes, text: null, at: T0.toISOString() };
      // The host reads the secrets first and the other gaps after them, as protection.js gives them.
      w.gaps = [...secrets, ...others];
      const done = await w.apply((await w.plan()).changes);
      assert.equal(done.ok, true, done.reason);
      const said = done.run.steps[7].say.line;
      assert.ok(said.length <= 500, String(said.length));
      const shown = secrets.filter((x) => said.includes(x)).length;
      const firstSecret = shown === 0 ? said.length : said.indexOf('SECRET_NUMBER_0');
      for (const part of before) assert.ok(said.includes(part) && said.indexOf(part) < firstSecret, part);
      // What is left out is only secrets, counted: with all of the others in, none or some are named.
      assert.ok(shown < secrets.length && (realUsers || shown >= 1), `${shown} secrets shown`);
      assert.equal(Number(/\(and (\d+) more\)$/.exec(said)?.[1]), secrets.length - shown);
    });
  }
});

test('a director with a status line of their own keeps it: none is written for this computer', async () => {
  await withHome(async () => {
    const w = await world({ ownStatusLine: { type: 'command', command: 'my-line.sh' } });
    const done = await w.apply((await w.plan()).changes);
    assert.equal(done.ok, true, done.reason);
    assert.equal(w.json('.claude/settings.local.json').statusLine, undefined);
    assert.deepEqual(w.json('.claude/settings.local.json').sandbox.network.allowUnixSockets, [ADDRESS]);
  });
  assert.throws(() => projectFilesChange({ folder: os.tmpdir(), config: starterConfig({ answers: { '4.live-data': { label: LIVE_DATA.no } } }) }), /this computer's local settings/);
});

test('the pins are installed and the lineage check passes', async () => {
  await withHome(async () => {
    const w = await world();
    const before = checkInstalled({ manifest: w.manifest, projectDir: w.folder, claudeHome: w.claudeHome });
    assert.equal(before.ok, false);
    const planned = await w.plan();
    const pins = planned.changes.filter((c) => c.kind === 'process');
    assert.deepEqual(pins.map((c) => c.target), [`superpowers@${MARKETPLACE}`, `mattpocock-skills@${MARKETPLACE}`]);
    const done = await w.apply(planned.changes);
    assert.equal(done.ok, true, done.reason);
    // Each by the documented command at project scope, in the project's folder (check 37).
    const installs = w.calls.filter((c) => c.tool === 'claude');
    assert.deepEqual(installs.map((c) => c.args), [
      ['plugin', 'install', `superpowers@${MARKETPLACE}`, '--scope', 'project'],
      ['plugin', 'install', `mattpocock-skills@${MARKETPLACE}`, '--scope', 'project'],
    ]);
    assert.ok(installs.every((c) => c.cwd === w.folder));
    assert.equal(checkInstalled({ manifest: w.manifest, projectDir: w.folder, claudeHome: w.claudeHome }).ok, true);
    // Each install recorded before it was made, with what was installed before (nothing).
    const recorded = done.run.changes.filter((c) => c.kind === 'process');
    assert.deepEqual(recorded.map((c) => [c.after.plugin, c.before]), [[`superpowers@${MARKETPLACE}`, null], [`mattpocock-skills@${MARKETPLACE}`, null]]);
    // Installed, they are not listed again.
    assert.deepEqual((await w.plan()).changes.filter((c) => c.kind === 'process'), []);
  });
  await withHome(async () => {
    // With no `claude` command line on this computer, the step fails plainly, before any commit.
    const w = await world({ claudeMissing: true });
    const done = await w.apply((await w.plan()).changes);
    assert.equal(done.ok, false);
    assert.match(done.reason, /Claude Code's command line/);
    assert.deepEqual(w.protection, []);
    assert.equal(await g(w.bare, 'rev-list', '--count', 'main'), '1');
  });
});

test('the setup clicks reach the state branch once', async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-20T00:00:00.000Z' });
    const hostRoot = tempFolder('wh-host-');
    const bare = path.join(hostRoot, `${REPO}.git`);
    fs.mkdirSync(path.dirname(bare), { recursive: true });
    await realRun('git', ['init', '--bare', '-q', bare]);
    const folder = fs.realpathSync.native(tempFolder('wh-proj-'));
    writeProject(SLUG, { folder, remoteUrl: bare, host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
    await cloneState({ project: SLUG, remoteUrl: bare, env: LOCAL_PATHS });

    const run = startRun({ folder, now: () => T0 });
    const other = startRun({ folder: tempFolder('wh-other-'), now: () => T0 });
    const at = (ms) => () => new Date(T0.getTime() + ms);
    const click = (runId, step, ms) => keepClick(makeEvent({ kind: 'action', data: { action: 'setup', runId, step, hash: 'c'.repeat(64), question: `Step ${step}`, label: 'Go ahead' }, now: at(ms) }));
    click(run.id, 2, 1000);
    click(run.id, 3, 2000);
    keepAnswer(makeEvent({ kind: 'action', data: { action: 'setup-answer', runId: run.id, step: 4, questionId: 'live-data', question: 'Live data?', label: LIVE_DATA.yes, text: null }, now: at(3000) }));
    click(other.id, 2, 4000);

    const sent = [];
    const record = async ({ project, event }) => {
      sent.push(event.id);
      const result = await writeEvent({ project, event, push: fixturePush, env: {} });
      return { ok: true, id: event.id, pushed: result.pushed };
    };
    const first = await copySetupRecords(run.id, SLUG, { record });
    assert.deepEqual({ copied: first.copied, skipped: first.skipped }, { copied: 3, skipped: 0 });
    // Run again (a later step's apply), each is found in the state already and sent no second time.
    const second = await copySetupRecords(run.id, SLUG, { record });
    assert.deepEqual({ copied: second.copied, skipped: second.skipped }, { copied: 0, skipped: 3 });
    assert.equal(sent.length, 3);
    const onBranch = (await g(bare, 'ls-tree', '-r', '--name-only', 'wheelhouse-state', 'events')).split('\n').filter(Boolean);
    assert.equal(onBranch.length, 3, 'each of the run\'s clicks and answers once, and not another run\'s');
    assert.equal(new Set(sent).size, 3);
    assert.ok(onBranch.every((f) => /_action_/.test(f)));
    // Each is in the state clone under its own event path, which is how the second run knew it.
    const kept = fs.readdirSync(path.join(stateDir(SLUG), 'events'), { recursive: true }).filter((f) => f.endsWith('.json'));
    assert.deepEqual(kept.map((f) => path.join('events', f)).sort(), onBranch.map((f) => path.join(...f.split('/'))).sort());

    // The engine copies them at the end of each successful apply, and not after a failed one.
    const copied = [];
    const step = (fail) => ({ n: 7, title: 'x', plan: async () => ({ changes: [] }), apply: async () => { if (fail) throw new Error('no'); return []; } });
    const ctx = { folder, now: () => T0 };
    await runApply({ step: step(false), runId: run.id, changes: [], ctx, current: () => true, copy: async (...args) => { copied.push(args); } });
    await runApply({ step: step(true), runId: run.id, changes: [], ctx, current: () => true, copy: async (...args) => { copied.push(args); } });
    assert.deepEqual(copied, [[run.id, folder]]);
  });
});

test('the card lists every part on GitLab with a long branch and release, and stays within the composer\'s limit', () => {
  const changes = [
    { kind: 'json-key', target: '/p/.claude/settings.json', key: ['a'], after: 1 },
    { kind: 'file', target: '/p/CLAUDE.md', section: 'Compact instructions' },
    { kind: 'json-key', target: '/p/.claude/settings.local.json', key: ['b'], after: 2 },
    { kind: 'process', target: `superpowers@${MARKETPLACE}` }, { kind: 'process', target: `mattpocock-skills@${MARKETPLACE}` },
    { kind: 'host', action: 'commit' }, { kind: 'host', action: 'protect' },
  ];
  const text = (branch, ref) => composeCard({ ...projectFilesCard({ changes, host: 'gitlab', branch, release: { ref } }), target: { step: 7, hash: '0'.repeat(64) } }).question.question;
  const usual = text('main', 'v1.4.0');
  for (const words of ['Compact instructions', 'settings.local.json', 'Superpowers and Matt Pocock\'s skills', 'Set up Wheelhouse', 'pipelines must succeed', 'GitLab sign-in', 'v1.4.0', 'never updates itself']) {
    assert.ok(usual.includes(words), words);
  }
  const long = text(`release/${'x'.repeat(200)}`, `v${'9'.repeat(150)}`);
  assert.ok(long.length <= 1200);
  assert.match(long, /never updates itself/);
});

test('step 7 is setup\'s own step 7, after the host and the questions, run in its own process', () => {
  const step = STEPS.find((s) => s.n === 7);
  assert.equal(step.long, true);
  assert.deepEqual(step.after, [3, 4]);
  assert.deepEqual(SETUP_FILES, ['.claude/settings.json', '.claude/wheelhouse.json', 'CLAUDE.md']);
});

// ---- The director's own changes (ruling R95) ----

const said = (label) => ({ label, text: null, at: T0.toISOString() });
const composedQuestion = (asked) => composeCard({ ...asked.card, kind: 'question' }).question;

test('the director\'s own changes to a shared file are asked about: Leave them waits, and a file changed since asks again', async () => {
  await withHome(async () => {
    // An existing product (no repository step 3 made): Leave them is recommended.
    const w = await world();
    fs.appendFileSync(path.join(w.folder, 'CLAUDE.md'), '- Draft rule.\n');
    const asked = (await w.plan()).ask;
    assert.match(asked.id, /^yours-[0-9a-f]{12}$/);
    assert.deepEqual(asked.card.options.map((o) => o.label), ['Put your changes to CLAUDE.md in setup\'s commit', 'Leave them; I\'ll come back']);
    assert.equal(asked.card.recommend, LEAVE_YOURS);
    assert.match(asked.card.what, /CLAUDE\.md has changes of yours not yet committed/);
    assert.deepEqual(composedQuestion(asked).options.slice(0, 2).map((o) => o.label), [putYoursIn('CLAUDE.md'), LEAVE_YOURS]);
    // Asked again with nothing changed, the same question.
    assert.equal((await w.plan()).ask.id, asked.id);
    // Leave them: the step waits, saying why, and nothing is listed.
    w.answers[`7.${asked.id}`] = said(LEAVE_YOURS);
    const waiting = await w.plan();
    assert.ok(waiting.wait > 0);
    assert.equal(waiting.why, leftYoursLine('CLAUDE.md'));
    // The file changed since: asked again, under another id.
    fs.appendFileSync(path.join(w.folder, 'CLAUDE.md'), '- Another rule.\n');
    const again = (await w.plan()).ask;
    assert.ok(again && again.id !== asked.id, 'a file changed since asks again');
    // Committed by the director meanwhile: no question at all.
    await g(w.folder, 'commit', '-q', '-am', 'My rules');
    await fixturePush(w.folder, 'main');
    assert.ok(Array.isArray((await w.plan()).changes));
  });
});

test('a new product\'s uncommitted CLAUDE.md is put in setup\'s commit on Put them in, named on the card and covered by the list\'s hash', async () => {
  await withHome(async () => {
    const w = await world();
    // Step 3 made this product's repository, so it is a new product.
    const run = startRun({ folder: w.folder, now: () => T0 });
    addChanges(run.id, [{ id: newId('chg'), step: 3, kind: 'host', target: `github:${REPO}`, before: null, after: { repository: REPO, private: true, made: true } }]);
    fs.appendFileSync(path.join(w.folder, 'CLAUDE.md'), '- Draft rule.\n');
    const asked = (await w.plan()).ask;
    assert.equal(asked.card.recommend, putYoursIn('CLAUDE.md'));
    w.answers[`7.${asked.id}`] = said(putYoursIn('CLAUDE.md'));
    const planned = await w.plan();
    const commit = planned.changes.find((c) => c.action === 'commit');
    assert.deepEqual(commit.yours.map((y) => y.file), ['CLAUDE.md']);
    assert.match(commit.yours[0].sha256, /^[0-9a-f]{64}$/);
    const text = composeCard({ ...planned.card, target: { step: 7, hash: planHash(planned.changes) } }).question.question;
    assert.match(text, /in one commit, "Set up Wheelhouse", with your own changes to CLAUDE\.md/);
    // The hash covers them: the same list without them is another list.
    assert.notEqual(planHash(planned.changes), planHash(planned.changes.map(({ yours, ...c }) => c)));
    // An edit after the answer asks again, so the Go ahead on this list would be refused as changed.
    const file = path.join(w.folder, 'CLAUDE.md');
    const kept = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, `${kept}- Late edit.\n`);
    assert.ok((await w.plan()).ask, 'a changed file asks again');
    fs.writeFileSync(file, kept);
    const done = await w.apply((await w.plan()).changes);
    assert.equal(done.ok, true, done.reason);
    const up = await g(w.bare, 'show', 'main:CLAUDE.md');
    assert.match(up, /- Draft rule\./);
    assert.match(up, /## Compact instructions/);
    assert.equal(await g(w.bare, 'log', '-1', '--format=%s', 'main'), COMMIT_MESSAGE);
  });
});

// ---- A joining computer's step 7 (ruling R78) ----

// A second computer, as step 3 leaves it: the project checked out into its own folder, registered,
// its state not needed here, with no pins and no settings of its own, its run joining, and no
// answers from step 4. Gives the run.
async function secondComputer(w) {
  const folder = path.join(w.user, 'Projects', 'Shop on the laptop');
  const cloned = await realRun('git', ['clone', '-q', w.bare, folder]);
  if (cloned.code !== 0) throw new Error(cloned.stderr);
  w.folder = fs.realpathSync.native(folder);
  writeProject(SLUG, { folder: w.folder, remoteUrl: w.bare, host: 'github', repo: REPO, connection: { host: 'github', mode: 'narrow', project: REPO } });
  w.claudeHome = path.join(tempFolder('wh-laptop zoë '), 'claude config');
  fs.mkdirSync(w.claudeHome, { recursive: true });
  fs.writeFileSync(path.join(w.claudeHome, 'settings.json'), JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: REF } } } }));
  w.answers = {};
  w.calls = [];
  w.protection = [];
  const run = startRun({ folder: w.folder, now: () => T0 });
  addChanges(run.id, [{ id: newId('chg'), step: 3, kind: 'answer', target: 'step 3', before: null, after: { joined: REPO, found: true } }]);
  return run;
}

test('a joining computer\'s step 7 lists only this computer\'s files and pins, with no commit and no protection, and leaves a differing shared file alone', async () => {
  await withHome(async () => {
    const w = await world();
    // The first computer's step 7 put the project's files up.
    const first = await w.apply((await w.plan()).changes);
    assert.equal(first.ok, true, first.reason);
    const tip = await lsRemote(w.bare, 'main');
    const run = await secondComputer(w);
    // Step 4 is not this run's, so step 7 waits for step 3 alone.
    assert.deepEqual(STEPS.find((s) => s.n === 7).after, [3, 4]);
    assert.equal(stepDone(findRun(w.folder), 4), true);
    // A note of the director's in CLAUDE.md on this computer, not committed.
    fs.appendFileSync(path.join(w.folder, 'CLAUDE.md'), '- A note on the laptop.\n');
    const before = Object.fromEntries(SETUP_FILES.map((rel) => [rel, fs.readFileSync(path.join(w.folder, rel), 'utf8')]));
    // This computer's Claude Code lays the settings out its own way as it installs the pins.
    w.layout = (o) => JSON.stringify(o, null, '\t');

    const planned = await w.step.plan(w.ctx({ runId: run.id }));
    assert.ok(Array.isArray(planned.changes), JSON.stringify(planned));
    const local = path.join(w.folder, '.claude', 'settings.local.json');
    assert.deepEqual(planned.changes.map((c) => (c.kind === 'process' ? c.target : c.line ?? `${c.kind} ${path.relative(w.folder, c.target)}`)), [
      `file ${path.join('.claude', 'settings.local.json')}`, EXCLUDE_LINE, WHEELHOUSE_LINE, `superpowers@${MARKETPLACE}`, `mattpocock-skills@${MARKETPLACE}`,
    ]);
    assert.ok(!planned.changes.some((c) => c.kind === 'host'), 'no commit, no push, no protection');
    const text = composeCard({ ...planned.card, target: { step: 7, hash: planHash(planned.changes) } }).question.question;
    assert.match(text, /for this computer/);
    assert.match(text, /nothing is committed and protection stays as it is/);
    assert.match(text, /CLAUDE\.md differs from what is committed, and setup leaves it as it is/);
    assert.doesNotMatch(text, /protection goes on|Set up Wheelhouse/);
    assert.deepEqual(w.calls.filter((c) => c.tool === 'gh'), [], 'nothing asked of the host');

    const done = await w.apply(planned.changes);
    assert.equal(done.ok, true, done.reason);
    // This computer's settings by key, kept out of git; the pins installed; every shared file exactly
    // as it was, byte for byte (ruling R103), though Claude Code rewrote the settings in its own layout.
    const mine = JSON.parse(fs.readFileSync(local, 'utf8'));
    assert.deepEqual(mine.sandbox.network.allowUnixSockets, [ADDRESS]);
    assert.ok(mine.permissions.allow.includes(`Bash(${frontDeskCommand(PLUGIN_ROOT, { platform: 'darwin' })}:*)`));
    const excluded = fs.readFileSync(path.join(w.folder, '.git', 'info', 'exclude'), 'utf8').split('\n');
    assert.ok(excluded.includes(EXCLUDE_LINE) && excluded.includes(WHEELHOUSE_LINE), 'this computer\'s settings and .wheelhouse/ kept out of git (ruling R108)');
    assert.equal(checkInstalled({ manifest: w.manifest, projectDir: w.folder, claudeHome: w.claudeHome }).ok, true);
    for (const rel of SETUP_FILES) assert.equal(fs.readFileSync(path.join(w.folder, rel), 'utf8'), before[rel], rel);
    assert.equal(await g(w.folder, 'status', '--porcelain', '--', '.claude/settings.json', '.claude/wheelhouse.json'), '', 'git sees no change to them');
    assert.equal(await lsRemote(w.bare, 'main'), tip, 'nothing went up');
    assert.deepEqual(w.protection, [], 'protection left as the first computer set it');
    const made = done.run.changes.filter((c) => c.step === 7);
    // The one shared file recorded is the settings put back to the committed text, recorded first.
    const shared = made.filter((c) => SETUP_FILES.some((rel) => c.target === path.join(w.folder, rel)));
    assert.deepEqual(shared.map((c) => [c.kind, path.relative(w.folder, c.target), c.after === before['.claude/settings.json']]), [['file', path.join('.claude', 'settings.json'), true]]);
    assert.notEqual(shared[0].before, shared[0].after, 'the layout the installs left is the value before');
    assert.ok(!made.some((c) => c.kind === 'host'));
  });
});

test('a joining computer\'s settings changed in their keys by the installs are left as they are and named', async () => {
  await withHome(async () => {
    const w = await world();
    const first = await w.apply((await w.plan()).changes);
    assert.equal(first.ok, true, first.reason);
    const run = await secondComputer(w);
    const settings = path.join(w.folder, '.claude', 'settings.json');
    w.duringInstall = () => {
      fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(fs.readFileSync(settings, 'utf8')), addedByTheInstall: true }));
    };
    const done = await w.apply((await w.step.plan(w.ctx({ runId: run.id }))).changes);
    assert.equal(done.ok, true, done.reason);
    assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).addedByTheInstall, true, 'left as it is');
    assert.equal(done.run.steps[7].say.line, '.claude/settings.json differs from what is committed since the pinned kits were installed, and setup leaves it as it is');
    assert.ok(!done.run.changes.some((c) => c.step === 7 && c.target === settings), 'never written by setup');
  });
});

test('a joining computer\'s step 7 reads the committed configuration, never step 4\'s answers, and refuses plainly without one', async () => {
  await withHome(async () => {
    // The first computer never finished its step 7: no configuration in the project's commit.
    const w = await world();
    const run = await secondComputer(w);
    await assert.rejects(w.step.plan(w.ctx({ runId: run.id })), /\.claude\/wheelhouse\.json is not in this folder's last commit/);
  });
});
