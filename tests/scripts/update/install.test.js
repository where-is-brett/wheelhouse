// tests/scripts/update/install.test.js
// Installing a release on this computer for the update, and putting it back. A scratch Claude
// folder and a fake `claude` that answers as check 94 saw; the real command is never run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openJournal } from '../../../scripts/update/journal.js';
import { accountFollowers, installRelease, installsOf, moveCatalogue, putBack } from '../../../scripts/update/install.js';
import { SETTINGS_FILE } from '../../../scripts/lineage/release.js';
import { tempFolder } from '../../helpers/homes.js';

const RELEASES = {
  'v1.0.0': { sha: 'a'.repeat(40), upstream: '1'.repeat(40), versions: { wheelhouse: '1.0.0', superpowers: '6.4.2' } },
  'v1.1.0': { sha: 'b'.repeat(40), upstream: '2'.repeat(40), versions: { wheelhouse: '1.1.0', superpowers: '7.0.0' } },
  // Wheelhouse's plugin.json says the same version at two commits.
  'v1.1.1': { sha: 'c'.repeat(40), upstream: '2'.repeat(40), versions: { wheelhouse: '1.1.0', superpowers: '7.0.0' } },
};
const DIRECT = { kind: 'direct', file: 'claude' };

let counter = 0;
function computer({ account = true, extraProjects = 0 } = {}) {
  counter += 1;
  const projectDir = tempFolder('wh-inst-project-');
  const claudeHome = tempFolder('wh-inst-claude-');
  const marketplaceDir = path.join(claudeHome, 'plugins', 'marketplaces', 'wheelhouse');
  const file = (...parts) => path.join(claudeHome, 'plugins', ...parts);
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
  const settingsFile = path.join(projectDir, '.claude', 'settings.json');
  const localFile = path.join(projectDir, '.claude', 'settings.local.json');
  const accountFile = path.join(claudeHome, 'settings.json');
  const calls = [];
  const state = { at: null, failUpdates: false, refuseAdd: false };

  const point = (tag) => {
    state.at = tag;
    writeJson(path.join(marketplaceDir, '.claude-plugin', 'marketplace.json'), {
      name: 'wheelhouse',
      plugins: [
        { name: 'wheelhouse', source: './' },
        { name: 'superpowers', source: { source: 'url', url: 'https://example.invalid/sp.git', ref: tag, sha: RELEASES[tag].upstream } },
      ],
    });
  };
  const pinOf = (plugin) => (plugin === 'wheelhouse' ? RELEASES[state.at].sha : RELEASES[state.at].upstream);
  const records = () => readJson(file('installed_plugins.json'));
  const installsOfPlugin = (plugin) => records().plugins[`${plugin}@wheelhouse`] ?? [];
  const recordAt = (plugin, scope, folder = projectDir) => installsOfPlugin(plugin).find((i) => i.scope === scope && (scope === 'user' || i.projectPath === folder)) ?? null;
  const install = (plugin, scope, folder = projectDir) => {
    const version = RELEASES[state.at].versions[plugin];
    const installPath = file('cache', 'wheelhouse', plugin, `${version}-${pinOf(plugin).slice(0, 4)}`);
    fs.mkdirSync(installPath, { recursive: true });
    const all = records();
    const list = (all.plugins[`${plugin}@wheelhouse`] ?? []).filter((i) => !(i.scope === scope && (scope === 'user' || i.projectPath === folder)));
    list.push({ scope, ...(scope === 'user' ? {} : { projectPath: folder }), installPath, version, gitCommitSha: pinOf(plugin) });
    all.plugins[`${plugin}@wheelhouse`] = list;
    writeJson(file('installed_plugins.json'), all);
  };

  writeJson(file('known_marketplaces.json'), { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: 'v1.0.0' }, installLocation: marketplaceDir } });
  writeJson(file('installed_plugins.json'), { version: 2, plugins: {} });
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: 'v1.1.0' } } } }, null, 2)}\n`);
  fs.writeFileSync(localFile, `${JSON.stringify({ statusLine: { type: 'command', command: 'mine' } })}\n`);
  if (account) writeJson(accountFile, { model: 'mine', extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: 'v1.0.0' } } } });
  else writeJson(accountFile, { model: 'mine' });
  point('v1.0.0');
  for (const plugin of ['wheelhouse', 'superpowers']) { install(plugin, 'project'); install(plugin, 'user'); }
  const others = [];
  for (let i = 0; i < extraProjects; i += 1) {
    const folder = tempFolder('wh-inst-other-');
    others.push(folder);
    install('wheelhouse', 'project', folder);
  }

  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const bad = { code: 1, stdout: '', stderr: 'no' };
  async function run(command, args, options) {
    calls.push([command, ...args].join(' '));
    if (command === 'git') {
      assert.equal(options.cwd, marketplaceDir);
      if (args[0] === 'config') return ok();
      return ok(`${RELEASES[state.at].sha}\n`);
    }
    assert.equal(command, 'claude', 'only the fake claude is run');
    assert.equal(options.cwd, projectDir);
    const [, verb, id, ...rest] = args;
    const scopeOf = (a) => a[a.indexOf('--scope') + 1];
    if (verb === 'marketplace') {
      if (id === 'add') {
        if (state.refuseAdd) return bad;
        const [, tag] = args[3].split('#');
        // Claude Code refuses to add the catalogue again when the account's settings declare it at another ref.
        const declared = fs.existsSync(accountFile) ? readJson(accountFile).extraKnownMarketplaces?.wheelhouse?.source?.ref : undefined;
        if (declared !== undefined && declared !== tag) return bad;
        const known = readJson(file('known_marketplaces.json'));
        known.wheelhouse.source.ref = tag;
        writeJson(file('known_marketplaces.json'), known);
        point(tag);
        const target = scopeOf(args) === 'user' ? accountFile : localFile;
        const settings = fs.existsSync(target) ? readJson(target) : {};
        settings.extraKnownMarketplaces = { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: tag } } };
        writeJson(target, settings);
        return ok('now points at');
      }
      // update: fetches again at the ref known_marketplaces.json records.
      point(readJson(file('known_marketplaces.json')).wheelhouse.source.ref);
      return ok();
    }
    const plugin = id.split('@')[0];
    const scope = scopeOf(rest);
    if (verb === 'update') {
      if (state.failUpdates) return bad;
      if (recordAt(plugin, scope)?.version === RELEASES[state.at].versions[plugin]) return ok('already at the latest version');
      install(plugin, scope);
      return ok();
    }
    if (verb === 'uninstall') {
      const all = records();
      all.plugins[id] = all.plugins[id].filter((i) => !(i.scope === scope && (scope === 'user' || i.projectPath === projectDir)));
      writeJson(file('installed_plugins.json'), all);
      if (scope === 'project') fs.writeFileSync(settingsFile, JSON.stringify(readJson(settingsFile))); // Claude Code rewrites it
      return ok();
    }
    if (verb === 'install') {
      if (state.failUpdates) return bad;
      install(plugin, scope);
      return ok();
    }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  }
  return { projectDir, claudeHome, settingsFile, localFile, accountFile, run, calls, state, recordAt, file, others, point, readJson };
}

const journalFor = () => openJournal(`inst-${counter}`);
const target = (tag) => ({ tag, sha: RELEASES[tag].sha });
const common = (pc) => ({ project: 'proj', projectDir: pc.projectDir, claudeHome: pc.claudeHome, run: pc.run, resolved: DIRECT, journal: journalFor() });
const claudeCalls = (pc) => pc.calls.filter((c) => c.startsWith('claude '));

test('install: the catalogue is moved without ever naming project scope', async () => {
  const pc = computer();
  const done = await installRelease({ ...common(pc), target: target('v1.1.0'), projects: [pc.projectDir] });
  assert.equal(done.ok, true, done.line);
  const adds = claudeCalls(pc).filter((c) => c.startsWith('claude plugin marketplace add'));
  assert.deepEqual(adds, ['claude plugin marketplace add where-is-brett/wheelhouse#v1.1.0 --scope user']);
  for (const c of pc.calls) assert.doesNotMatch(c, /--scope project\b.*marketplace|marketplace add.*--scope project/);
  // The account's install moved too, and the project's.
  assert.equal(pc.recordAt('wheelhouse', 'user').gitCommitSha, RELEASES['v1.1.0'].sha);
  assert.equal(pc.recordAt('wheelhouse', 'project').gitCommitSha, RELEASES['v1.1.0'].sha);
  assert.equal(pc.recordAt('superpowers', 'user').gitCommitSha, RELEASES['v1.1.0'].upstream);
  assert.equal(pc.readJson(pc.accountFile).model, 'mine', 'nothing else in the account file changes');
});

test('install: with a follower project the user install stays', async () => {
  const pc = computer({ extraProjects: 0 });
  const follower = tempFolder('wh-inst-follower-');
  const done = await installRelease({ ...common(pc), target: target('v1.1.0'), projects: [pc.projectDir, follower] });
  assert.equal(done.ok, true, done.line);
  assert.deepEqual(claudeCalls(pc).filter((c) => c.includes('marketplace add')), ['claude plugin marketplace add where-is-brett/wheelhouse#v1.1.0 --scope user']);
  assert.equal(pc.recordAt('wheelhouse', 'user').gitCommitSha, RELEASES['v1.0.0'].sha, 'the user install stays');
  assert.equal(pc.readJson(pc.accountFile).extraKnownMarketplaces.wheelhouse.source.ref, 'v1.1.0', 'Claude Code refuses the catalogue at a ref the account contradicts, so the one line moves');
  assert.equal(pc.recordAt('wheelhouse', 'project').gitCommitSha, RELEASES['v1.1.0'].sha);
  assert.ok(!claudeCalls(pc).some((c) => c.includes('plugin update') && c.includes('--scope user')), 'no user install was moved');
  assert.match(done.line, new RegExp(`stay at the earlier release for ${path.basename(follower)}`));
});

test('install: the account line is the only byte changed, and a failure puts the file back', async () => {
  const pc = computer();
  const before = fs.readFileSync(pc.accountFile, 'utf8');
  const done = await installRelease({ ...common(pc), target: target('v1.1.0'), projects: [pc.projectDir] });
  assert.equal(done.ok, true, done.line);
  assert.equal(fs.readFileSync(pc.accountFile, 'utf8'), before.replace('"v1.0.0"', '"v1.1.0"'));
  const bad = computer();
  const original = fs.readFileSync(bad.accountFile, 'utf8');
  bad.state.failUpdates = true;
  const failed = await installRelease({ ...common(bad), target: target('v1.1.0'), projects: [bad.projectDir] });
  assert.equal(failed.ok, false);
  assert.equal(fs.readFileSync(bad.accountFile, 'utf8'), original, 'the account file is back as it was');
});

test('install: an account that names another source is refused and nothing changes', async () => {
  const pc = computer();
  fs.writeFileSync(pc.accountFile, JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'someone/else', ref: 'v1.0.0' } } } }));
  const kept = fs.readFileSync(pc.accountFile, 'utf8');
  const done = await installRelease({ ...common(pc), target: target('v1.1.0'), projects: [pc.projectDir] });
  assert.equal(done.ok, false);
  assert.match(done.line, /not the Wheelhouse repository/);
  assert.equal(fs.readFileSync(pc.accountFile, 'utf8'), kept);
  assert.equal(claudeCalls(pc).length, 0, 'no claude command ran');
  const broken = computer();
  fs.writeFileSync(broken.accountFile, '{ nope');
  const got = await installRelease({ ...common(broken), target: target('v1.1.0'), projects: [broken.projectDir] });
  assert.equal(got.ok, false);
  assert.equal(fs.readFileSync(broken.accountFile, 'utf8'), '{ nope');
  assert.equal(claudeCalls(broken).length, 0);
});

test('install: an account that does not name the catalogue is left alone', async () => {
  const pc = computer({ account: false });
  const done = await installRelease({ ...common(pc), target: target('v1.1.0'), projects: [pc.projectDir] });
  assert.equal(done.ok, true, done.line);
  assert.ok(claudeCalls(pc).some((c) => c.endsWith('--scope local')));
  assert.equal(pc.recordAt('wheelhouse', 'user').gitCommitSha, RELEASES['v1.0.0'].sha);
});

test('install: a failed plugin update after the catalogue moved puts the catalogue back', async () => {
  const pc = computer();
  const before = {
    account: fs.readFileSync(pc.accountFile, 'utf8'),
    local: fs.readFileSync(pc.localFile, 'utf8'),
    known: fs.readFileSync(pc.file('known_marketplaces.json'), 'utf8'),
    installed: fs.readFileSync(pc.file('installed_plugins.json'), 'utf8'),
    settings: fs.readFileSync(pc.settingsFile, 'utf8'),
  };
  pc.state.failUpdates = true;
  const journal = journalFor();
  // The network drops once the catalogue has moved; it is back for the put-back.
  const flaky = async (command, args, options) => {
    const out = await pc.run(command, args, options);
    if (args[1] === 'marketplace' && args[2] === 'add') pc.state.failUpdates = true;
    return out;
  };
  const failing = await installRelease({ ...common(pc), journal, run: flaky, target: target('v1.1.0'), projects: [pc.projectDir] });
  // The put-back's own plugin updates fail too, so it says so; the files are restored regardless.
  assert.equal(failing.ok, false);
  assert.match(failing.line, /not fully installed/);
  assert.equal(fs.readFileSync(pc.accountFile, 'utf8'), before.account);
  assert.equal(fs.readFileSync(pc.localFile, 'utf8'), before.local);
  assert.equal(fs.readFileSync(pc.file('known_marketplaces.json'), 'utf8'), before.known);
  assert.equal(fs.readFileSync(pc.file('installed_plugins.json'), 'utf8'), before.installed);
  assert.equal(fs.readFileSync(pc.settingsFile, 'utf8'), before.settings);
  assert.equal(pc.state.at, 'v1.0.0', 'the catalogue copy is back at the earlier release');
  assert.equal(pc.recordAt('wheelhouse', 'project').gitCommitSha, RELEASES['v1.0.0'].sha);
});

test('install: a failure the put-back can mend says the computer was put back', async () => {
  const pc = computer();
  const journal = journalFor();
  let updates = 0;
  const once = async (command, args, options) => {
    if (args[1] === 'update' || args[1] === 'install') {
      updates += 1;
      if (updates <= 2) return { code: 1, stdout: '', stderr: 'network' };
    }
    return pc.run(command, args, options);
  };
  const done = await installRelease({ ...common(pc), journal, run: once, target: target('v1.1.0'), projects: [pc.projectDir] });
  assert.equal(done.ok, false);
  assert.match(done.line, /was put back to v1\.0\.0/);
  assert.equal(pc.state.at, 'v1.0.0');
  assert.equal(pc.recordAt('wheelhouse', 'user').gitCommitSha, RELEASES['v1.0.0'].sha);
});

test('install: the same plugin version at two commits goes by uninstall then install', async () => {
  const pc = computer();
  // Move to v1.1.0 first (version 1.1.0), then to v1.1.1, which says 1.1.0 again at another commit.
  assert.equal((await installRelease({ ...common(pc), target: target('v1.1.0'), projects: [pc.projectDir] })).ok, true);
  pc.calls.length = 0;
  const done = await installRelease({ ...common(pc), journal: journalFor(), target: target('v1.1.1'), projects: [pc.projectDir] });
  assert.equal(done.ok, true, done.line);
  assert.ok(claudeCalls(pc).includes('claude plugin uninstall wheelhouse@wheelhouse --scope project --json'));
  assert.ok(claudeCalls(pc).includes('claude plugin install wheelhouse@wheelhouse --scope project --json'));
  assert.ok(claudeCalls(pc).includes('claude plugin uninstall wheelhouse@wheelhouse --scope user --json'));
  assert.equal(pc.recordAt('wheelhouse', 'project').gitCommitSha, RELEASES['v1.1.1'].sha);
  assert.equal(pc.recordAt('wheelhouse', 'user').gitCommitSha, RELEASES['v1.1.1'].sha);
});

test('install: a project settings file Claude Code rewrote is put back', async () => {
  const pc = computer();
  assert.equal((await installRelease({ ...common(pc), target: target('v1.1.0'), projects: [pc.projectDir] })).ok, true);
  const merged = fs.readFileSync(pc.settingsFile, 'utf8');
  const done = await installRelease({ ...common(pc), journal: journalFor(), target: target('v1.1.1'), projects: [pc.projectDir] });
  assert.equal(done.ok, true, done.line);
  assert.equal(fs.readFileSync(pc.settingsFile, 'utf8'), merged, 'the merged settings are as they were');
  assert.match(done.line, /put back as the release has them/);
  assert.ok(fs.existsSync(path.join(pc.projectDir, SETTINGS_FILE)));
});

test('install: run again after a stop it carries on and keeps the first earlier release', async () => {
  const pc = computer();
  const journal = journalFor();
  const first = await installRelease({ ...common(pc), journal, target: target('v1.1.0'), projects: [pc.projectDir] });
  assert.equal(first.ok, true);
  const noted = JSON.parse(fs.readFileSync(path.join(journal.folder, 'install.json'), 'utf8'));
  assert.deepEqual(noted.previous, { ref: 'v1.0.0', sha: RELEASES['v1.0.0'].sha });
  pc.calls.length = 0;
  const again = await installRelease({ ...common(pc), journal, target: target('v1.1.0'), projects: [pc.projectDir] });
  assert.equal(again.ok, true, again.line);
  assert.equal(claudeCalls(pc).filter((c) => /plugin (update|install|uninstall) /.test(c)).length, 0, 'nothing is installed twice');
  assert.ok(!claudeCalls(pc).some((c) => c.includes('marketplace add')), 'the catalogue is not added twice');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(journal.folder, 'install.json'), 'utf8')).previous, noted.previous);
});

test('catalogue: a refused add falls back to the recorded ref and a marketplace update', async () => {
  const pc = computer();
  pc.state.refuseAdd = true;
  const moved = await moveCatalogue({ tag: 'v1.1.0', sha: RELEASES['v1.1.0'].sha, scope: 'local', run: pc.run, resolved: DIRECT, projectDir: pc.projectDir, claudeHome: pc.claudeHome });
  assert.deepEqual(moved, { ok: true });
  assert.equal(pc.readJson(pc.file('known_marketplaces.json')).wheelhouse.source.ref, 'v1.1.0');
  assert.ok(claudeCalls(pc).includes('claude plugin marketplace update wheelhouse'));
});

test('catalogue: a copy that is not at the tag\'s commit is refused, and project scope never runs', async () => {
  const pc = computer();
  const wrong = await moveCatalogue({ tag: 'v1.1.0', sha: 'd'.repeat(40), scope: 'user', run: pc.run, resolved: DIRECT, projectDir: pc.projectDir, claudeHome: pc.claudeHome });
  assert.equal(wrong.ok, false);
  assert.match(wrong.why, /not v1\.1\.0/);
  const project = await moveCatalogue({ tag: 'v1.1.0', sha: RELEASES['v1.1.0'].sha, scope: 'project', run: pc.run, resolved: DIRECT, projectDir: pc.projectDir, claudeHome: pc.claudeHome });
  assert.equal(project.ok, false);
  assert.ok(!pc.calls.some((c) => /--scope project/.test(c) && c.includes('marketplace')));
  const bad = await moveCatalogue({ tag: '--upload-pack=x', sha: RELEASES['v1.1.0'].sha, scope: 'user', run: pc.run, resolved: DIRECT, projectDir: pc.projectDir, claudeHome: pc.claudeHome });
  assert.equal(bad.ok, false);
});

test('installsOf and accountFollowers read Claude Code\'s record of installs', () => {
  const pc = computer({ extraProjects: 1 });
  const found = installsOf({ claudeHome: pc.claudeHome, projectDir: pc.projectDir });
  assert.deepEqual(found.map((i) => `${i.plugin}:${i.scope}`).sort(), ['superpowers:project', 'superpowers:user', 'wheelhouse:project', 'wheelhouse:user']);
  assert.ok(found.every((i) => i.scope === 'user' || i.projectPath === pc.projectDir), 'other projects\' installs are left out');
  const stranger = tempFolder('wh-inst-stranger-');
  assert.deepEqual(accountFollowers({ claudeHome: pc.claudeHome, projects: [pc.projectDir, ...pc.others, stranger] }), [stranger]);
  assert.deepEqual(accountFollowers({ claudeHome: pc.claudeHome, projects: [] }), []);
});

test('putBack: restores the backups and says so when the earlier release is unknown', async () => {
  const pc = computer();
  const journal = journalFor();
  const out = await putBack({ previous: null, journal, run: pc.run, resolved: DIRECT, projectDir: pc.projectDir, claudeHome: pc.claudeHome });
  assert.equal(out.ok, false);
  assert.match(out.line, /Nothing was put back/);
});

test('install: a put-back keeps later edits to the account file and leaves another person\'s ref', async () => {
  const later = computer();
  later.state.failUpdates = true;
  const real = later.run;
  const edits = async (...a) => {
    if (a[1][1] === 'update') { const t = later.readJson(later.accountFile); t.model = 'edited'; fs.writeFileSync(later.accountFile, JSON.stringify(t, null, 2)); }
    return real(...a);
  };
  const failed = await installRelease({ ...common(later), run: edits, target: target('v1.1.0'), projects: [later.projectDir] });
  assert.equal(failed.ok, false);
  const now = later.readJson(later.accountFile);
  assert.equal(now.model, 'edited');
  assert.equal(now.extraKnownMarketplaces.wheelhouse.source.ref, 'v1.0.0');
  const third = computer();
  third.state.failUpdates = true;
  const realRun = third.run;
  const changes = async (...a) => {
    if (a[1][1] === 'update') { const t = third.readJson(third.accountFile); t.extraKnownMarketplaces.wheelhouse.source.ref = 'v1.5.0'; fs.writeFileSync(third.accountFile, JSON.stringify(t)); }
    return realRun(...a);
  };
  const out = await installRelease({ ...common(third), run: changes, target: target('v1.1.0'), projects: [third.projectDir] });
  assert.equal(out.ok, false);
  assert.match(out.line, /changed since the update wrote v1\.1\.0/);
  assert.equal(third.readJson(third.accountFile).extraKnownMarketplaces.wheelhouse.source.ref, 'v1.5.0');
});

test('install: a card that did not name the account ref the file now holds stops with nothing changed', async () => {
  const pc = computer();
  const before = fs.readFileSync(pc.accountFile, 'utf8');
  const stopped = await installRelease({ ...common(pc), target: target('v1.1.0'), projects: [pc.projectDir], accountNamed: null });
  assert.equal(stopped.ok, false);
  assert.match(stopped.line, /Your account settings changed since the card; type \/wheelhouse:update again/);
  assert.equal(fs.readFileSync(pc.accountFile, 'utf8'), before);
  assert.equal(claudeCalls(pc).length, 0);
  const named = await installRelease({ ...common(pc), target: target('v1.1.0'), projects: [pc.projectDir], accountNamed: { from: 'v1.0.0', to: 'v1.1.0' } });
  assert.equal(named.ok, true, named.line);
});
