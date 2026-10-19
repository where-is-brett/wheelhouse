// tests/scripts/lineage/release.test.js
// Installing a Wheelhouse release in a project only between features, the settings change that
// moves it, and the undo, which reinstalls the earlier release by check 30's route with a fake `run`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { projectSettings } from '../../../scripts/protection/settings.js';
import {
  RELEASE_BRANCH, SETTINGS_FILE, canInstall, pinsOnlyChange, releaseBranch, releaseChange, settingsText, undo,
} from '../../../scripts/lineage/release.js';
import { tempFolder } from '../../helpers/homes.js';

const settingsAt = (ref) => projectSettings(readConfig(null), { release: { ref } });
const feature = (step) => ({ key: 'w', id: 'e', at: '2026-10-19T00:00:00.000Z', data: { work: 'w', step } });

test('a release is held while any feature is building', () => {
  assert.deepEqual(canInstall({ features: {} }), { ok: true });
  assert.deepEqual(canInstall({ features: { a: feature('started'), b: feature('closed') } }), { ok: true });
  for (const step of ['planned', 'building', 'paused']) {
    const held = canInstall({ features: { a: feature('closed'), 'sign-in': feature(step) } });
    assert.equal(held.ok, false, step);
    assert.equal(held.why, `the feature sign-in is ${step}, so the release waits until no feature is running`);
  }
  // A step this does not know, or features that can't be read, hold it too.
  assert.equal(canInstall({ features: { a: feature('dreaming') } }).ok, false);
  assert.equal(canInstall({ features: { a: {} } }).ok, false);
  assert.equal(canInstall({}).ok, false);
  assert.equal(canInstall({ features: null }).ok, false);
});

test('the release change touches only the marketplace\'s ref and sha', () => {
  const sha = 'b'.repeat(40);
  const before = settingsAt('v1.0.0');
  const frozen = JSON.stringify(before);
  const after = releaseChange(before, { ref: 'v1.1.0', sha });
  assert.equal(JSON.stringify(before), frozen, 'the input is not changed');
  assert.deepEqual(after, settingsAt('v1.1.0'));
  // A marketplace source takes no commit (ruling R135): the commit travels in the branch name.
  assert.equal(after.extraKnownMarketplaces.wheelhouse.source.sha, undefined);
  assert.equal(releaseBranch(sha), `wheelhouse-release-${sha}`);
  assert.equal(RELEASE_BRANCH.exec(releaseBranch(sha))[1], sha);
  // From settings with no release named yet, only the ref is added.
  const none = projectSettings(readConfig(null));
  assert.deepEqual(releaseChange(none, { ref: 'v1.1.0', sha }), after);
  // Settings with the director's own keys keep them.
  assert.deepEqual(releaseChange({ ...before, model: 'model-a' }, { ref: 'v1.1.0', sha }), { ...after, model: 'model-a' });

  assert.throws(() => releaseChange(before, { ref: '--upload-pack=x', sha }), /plain tag/);
  assert.throws(() => releaseChange(before, { ref: 'v1.1.0', sha: 'abc' }), /in full/);
  assert.throws(() => releaseChange({ permissions: {} }, { ref: 'v1.1.0', sha }), /no Wheelhouse marketplace/);
  const elsewhere = settingsAt('v1.0.0');
  elsewhere.extraKnownMarketplaces.wheelhouse.source.repo = 'someone/else';
  assert.throws(() => releaseChange(elsewhere, { ref: 'v1.1.0', sha }), /no Wheelhouse marketplace/);

  // The gate's reading of the same change: only the ref may differ, in a plain file.
  const sides = (head, { base = settingsText(before), headMode = '100644' } = {}) => ({ base, head, headMode });
  assert.deepEqual(pinsOnlyChange([SETTINGS_FILE], sides(settingsText(after))), { ref: 'v1.1.0' });
  assert.deepEqual(pinsOnlyChange([SETTINGS_FILE], sides(JSON.stringify(after))), { ref: 'v1.1.0' }, 'layout does not count');
  assert.deepEqual(pinsOnlyChange([SETTINGS_FILE], sides(settingsText(after), { base: settingsText(none) })), { ref: 'v1.1.0' });
  assert.equal(pinsOnlyChange([SETTINGS_FILE, 'README.md'], sides(settingsText(after))), null);
  assert.equal(pinsOnlyChange(['.Claude/settings.json'], sides(settingsText(after))), null);
  assert.equal(pinsOnlyChange([SETTINGS_FILE], sides(settingsText(after), { headMode: '120000' })), null);
  assert.equal(pinsOnlyChange([SETTINGS_FILE], sides(settingsText({ ...after, disableAllHooks: true }))), null);
  assert.equal(pinsOnlyChange([SETTINGS_FILE], sides(settingsText({ ...after, enabledPlugins: {} }))), null);
  const repinned = releaseChange(before, { ref: 'v1.1.0', sha });
  repinned.extraKnownMarketplaces.wheelhouse.autoUpdate = true;
  assert.equal(pinsOnlyChange([SETTINGS_FILE], sides(settingsText(repinned))), null);
  assert.equal(pinsOnlyChange([SETTINGS_FILE], sides('{ not json')), null);
  assert.equal(pinsOnlyChange([SETTINGS_FILE], sides(settingsText(after), { base: null })), null);
});

// --- A computer for the undo: Claude Code's records, and a fake `run` that acts as `claude` would ---

const RELEASES = {
  'v1.0.0': { sha: 'a'.repeat(40), upstream: '1'.repeat(40), versions: { wheelhouse: '0.0.0', superpowers: '6.4.2' } },
  'v1.1.0': { sha: 'b'.repeat(40), upstream: '2'.repeat(40), versions: { wheelhouse: '0.0.0', superpowers: '7.0.0' } },
};

function computer() {
  const projectDir = tempFolder('wh-release-project-');
  const claudeHome = tempFolder('wh-release-claude-');
  const marketplaceDir = path.join(claudeHome, 'plugins', 'marketplaces', 'wheelhouse');
  const file = (...parts) => path.join(claudeHome, 'plugins', ...parts);
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const writeJson = (f, value) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(value, null, 2)); };
  const settingsFile = path.join(projectDir, '.claude', 'settings.json');
  let at = null; // the release the computer's copy of the marketplace is at
  const calls = [];

  const pointMarketplace = (ref) => {
    at = ref;
    const { upstream } = RELEASES[ref];
    writeJson(path.join(marketplaceDir, '.claude-plugin', 'marketplace.json'), {
      name: 'wheelhouse',
      plugins: [
        { name: 'wheelhouse', source: './' },
        { name: 'superpowers', source: { source: 'url', url: 'https://example.invalid/superpowers.git', ref: ref, sha: upstream } },
      ],
    });
  };
  const pinOf = (plugin) => (plugin === 'wheelhouse' ? RELEASES[at].sha : RELEASES[at].upstream);
  const records = () => readJson(file('installed_plugins.json'));
  const recordOf = (plugin) => records().plugins[`${plugin}@wheelhouse`]?.[0] ?? null;
  const install = (plugin) => {
    const version = RELEASES[at].versions[plugin];
    const installPath = file('cache', 'wheelhouse', plugin, version);
    fs.mkdirSync(installPath, { recursive: true });
    const all = records();
    all.plugins[`${plugin}@wheelhouse`] = [{ scope: 'project', projectPath: projectDir, installPath, version, gitCommitSha: pinOf(plugin) }];
    writeJson(file('installed_plugins.json'), all);
  };

  writeJson(file('known_marketplaces.json'), { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse' }, installLocation: marketplaceDir } });
  writeJson(file('installed_plugins.json'), { version: 2, plugins: {} });
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, settingsText(settingsAt('v1.0.0')));
  pointMarketplace('v1.0.0');
  install('wheelhouse');
  install('superpowers');

  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  async function run(command, args, options) {
    calls.push([command, ...args].join(' '));
    if (command === 'git') {
      assert.equal(options.cwd, marketplaceDir);
      return ok(`${RELEASES[at].sha}\n`);
    }
    assert.equal(command, 'claude');
    assert.equal(options.cwd, projectDir);
    const [, verb, id] = args;
    if (verb === 'marketplace') {
      // The marketplace is fetched again at the ref the project's settings name.
      pointMarketplace(readJson(settingsFile).extraKnownMarketplaces.wheelhouse.source.ref);
      return ok();
    }
    const plugin = id.split('@')[0];
    if (verb === 'update') {
      // Like Claude Code: nothing moves when the plugin.json version is the same.
      if (recordOf(plugin)?.version === RELEASES[at].versions[plugin]) return ok(`${plugin} is already at the latest version`);
      install(plugin);
      return ok();
    }
    if (verb === 'uninstall') {
      const all = records();
      delete all.plugins[id];
      writeJson(file('installed_plugins.json'), all);
      // Claude Code rewrites the project's settings as it uninstalls and installs at project scope.
      fs.writeFileSync(settingsFile, JSON.stringify(readJson(settingsFile)));
      return ok();
    }
    if (verb === 'install') { install(plugin); return ok(); }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  }
  return { projectDir, claudeHome, settingsFile, run, calls, recordOf, file, at: () => at };
}

const DIRECT = { kind: 'direct', file: 'claude' };

test('the undo reinstalls the previous release, including after the clean-up', async () => {
  const pc = computer();
  const previous = { ref: 'v1.0.0', sha: RELEASES['v1.0.0'].sha };
  const later = { ref: 'v1.1.0', sha: RELEASES['v1.1.0'].sha };
  const common = { project: 'o__p', projectDir: pc.projectDir, claudeHome: pc.claudeHome, run: pc.run, resolved: DIRECT };

  // Release B merged into the project's settings, and the reinstall moved the computer to it.
  fs.writeFileSync(pc.settingsFile, settingsText(settingsAt(later.ref)));
  const forward = await undo({ ...common, previous: later });
  assert.equal(forward.ok, true, forward.line);
  assert.equal(pc.recordOf('superpowers').gitCommitSha, RELEASES['v1.1.0'].upstream);
  assert.equal(pc.recordOf('wheelhouse').gitCommitSha, later.sha);

  // Claude Code's clean-up removes A's folders.
  fs.rmSync(pc.file('cache', 'wheelhouse', 'superpowers', '6.4.2'), { recursive: true });

  // The undo first opens the settings change back to A as a pull request, and installs nothing yet.
  const opened = [];
  const open = async (request) => { opened.push(request); return { ok: true, number: 12 }; };
  const before = pc.calls.length;
  const pending = await undo({ ...common, previous, open });
  assert.deepEqual(pending, { ok: false, pending: true, pr: 12, line: 'The undo\'s pull request #12 is open. Once it merges and this folder has it, the undo reinstalls v1.0.0.' });
  assert.equal(pc.calls.length, before, 'nothing ran');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].branch, `wheelhouse-release-${previous.sha}`);
  assert.equal(opened[0].file, SETTINGS_FILE);
  assert.equal(opened[0].text, settingsText(settingsAt('v1.0.0')));
  assert.equal(opened[0].title, 'Put Wheelhouse back to v1.0.0');

  // A refusal from the opener is said, and nothing runs.
  const refused = await undo({ ...common, previous, open: async () => ({ ok: false, refused: 'STOP is on' }) });
  assert.deepEqual(refused, { ok: false, line: 'The undo\'s pull request could not be opened: STOP is on.' });

  // Once it merges and the folder has it, the undo reinstalls A: Superpowers by update, since its
  // version differs; Wheelhouse by uninstall and install, since both releases say 0.0.0.
  fs.writeFileSync(pc.settingsFile, opened[0].text);
  pc.calls.length = 0;
  const done = await undo({ ...common, previous, open });
  assert.equal(done.ok, true, done.line);
  assert.deepEqual(done.installed, [
    { plugin: 'wheelhouse', want: previous.sha, got: previous.sha, route: 'uninstall, then install' },
    { plugin: 'superpowers', want: RELEASES['v1.0.0'].upstream, got: RELEASES['v1.0.0'].upstream, route: 'update' },
  ]);
  assert.equal(done.line, `Wheelhouse v1.0.0 is installed for this project: wheelhouse ${'a'.repeat(12)}, superpowers ${'1'.repeat(12)}. Claude Code rewrote the project's settings on the way, so they were put back as the release has them.`);
  assert.deepEqual(pc.calls, [
    'claude plugin marketplace update wheelhouse',
    'git -c core.hooksPath=/dev/null rev-parse HEAD',
    'claude plugin update wheelhouse@wheelhouse --scope project --json',
    'claude plugin uninstall wheelhouse@wheelhouse --scope project --json',
    'claude plugin install wheelhouse@wheelhouse --scope project --json',
    'claude plugin update superpowers@wheelhouse --scope project --json',
  ]);
  assert.ok(fs.existsSync(pc.file('cache', 'wheelhouse', 'superpowers', '6.4.2')), 'A\'s folder is fetched again');
  assert.equal(fs.readFileSync(pc.settingsFile, 'utf8'), opened[0].text, 'the merged settings are as they were');

  // Run again, it finds the release installed and changes nothing.
  pc.calls.length = 0;
  const again = await undo({ ...common, previous, open });
  assert.equal(again.ok, true);
  assert.deepEqual(again.installed.map((one) => one.route), ['already installed', 'already installed']);
  assert.equal(pc.calls.filter((c) => /plugin (update|install|uninstall) /.test(c)).length, 0);
});

test('the reinstall stops when the computer\'s marketplace is not at the release', async () => {
  const pc = computer();
  // The settings name A, but the commit given is another: the marketplace's copy is not at it.
  const done = await undo({ project: 'o__p', projectDir: pc.projectDir, claudeHome: pc.claudeHome, run: pc.run, resolved: DIRECT, previous: { ref: 'v1.0.0', sha: 'c'.repeat(40) } });
  assert.equal(done.ok, false);
  assert.equal(done.line, `This computer's copy of the wheelhouse marketplace is at ${'a'.repeat(12)}, not v1.0.0 (${'c'.repeat(12)}), so nothing was reinstalled. Check the project's settings in this folder name v1.0.0, start a Claude Code session in the folder so it fetches the marketplace from them again, then run the reinstall again.`);
  assert.equal(pc.calls.filter((c) => /plugin (update|install|uninstall) /.test(c)).length, 0);
  // Settings that name no Wheelhouse marketplace have nothing to put back.
  fs.writeFileSync(pc.settingsFile, '{}\n');
  const none = await undo({ project: 'o__p', projectDir: pc.projectDir, claudeHome: pc.claudeHome, run: pc.run, resolved: DIRECT, previous: { ref: 'v1.0.0', sha: 'a'.repeat(40) } });
  assert.deepEqual(none, { ok: false, line: 'The project\'s settings name no Wheelhouse marketplace, so there is no release to put back.' });
});
