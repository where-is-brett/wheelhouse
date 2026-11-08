// tests/probes/haiku-trial/stage-plugin.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stagePlugin, installCommand, removeCommand, installedProblem, PLUGIN_ID } from '../../../probes/haiku-trial/stage-plugin.js';

const HERE = path.resolve(import.meta.dirname, '..', '..', '..');

function cloneHere(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-stage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const got = spawnSync('git', ['clone', '--quiet', '--local', HERE, repo], { encoding: 'utf8' });
  assert.equal(got.status, 0, got.stderr);
  return { dir, repo };
}

test('staged plugin leaves out probes and tests', async (t) => {
  const { dir, repo } = cloneHere(t);
  const out = path.join(dir, 'out');
  const staged = await stagePlugin({ repo, out });
  t.after(() => fs.rmSync(staged.marketplaceDir, { recursive: true, force: true }));
  for (const keep of ['scripts', 'skills', '.claude-plugin']) assert.ok(fs.existsSync(path.join(staged.pluginDir, keep)), keep);
  for (const gone of ['probes', 'tests']) assert.equal(fs.existsSync(path.join(staged.pluginDir, gone)), false, gone);
  const manifest = JSON.parse(fs.readFileSync(path.join(staged.marketplaceDir, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(manifest.plugins[0].name, 'wheelhouse');
  assert.match(staged.sha, /^[0-9a-f]{40}$/, 'the staged commit is returned, so the install can be checked against it');
  assert.equal(manifest.plugins[0].source.sha, staged.sha);
});

test('stagePlugin installs nothing', async (t) => {
  const { dir, repo } = cloneHere(t);
  const seen = [];
  const run = (command, args, options) => {
    seen.push(command);
    return spawnSync(command, args, options);
  };
  const staged = await stagePlugin({ repo, out: path.join(dir, 'out'), run });
  t.after(() => fs.rmSync(staged.marketplaceDir, { recursive: true, force: true }));
  assert.ok(seen.length > 0);
  assert.equal(seen.some((c) => /claude/.test(c)), false);
});

test('installCommand lists the marketplace add and the install', () => {
  const lines = installCommand({ marketplaceDir: '/m', configDir: '/c', claude: '/bin/claude' });
  assert.deepEqual(lines[0], ['env', 'CLAUDE_CONFIG_DIR=/c', '/bin/claude', 'plugin', 'marketplace', 'add', '/m']);
  assert.deepEqual(lines[1].slice(-3), ['plugin', 'install', 'wheelhouse@wheelhouse-probe-wheelhouse-trial']);
  assert.deepEqual(installCommand({ marketplaceDir: '/m' })[0].slice(0, 2), ['claude', 'plugin']);
});

test('removeCommand takes out the trial plugin in the trial configuration', () => {
  assert.deepEqual(removeCommand({ configDir: '/c', claude: '/bin/claude' }), ['env', 'CLAUDE_CONFIG_DIR=/c', '/bin/claude', 'plugin', 'uninstall', PLUGIN_ID]);
  assert.deepEqual(removeCommand({}), ['claude', 'plugin', 'uninstall', PLUGIN_ID]);
});

test('installedProblem compares the installed copy with the staged commit', (t) => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-installed-'));
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  const installPath = path.join(configDir, 'plugins', 'cache', 'x', 'wheelhouse', '0.3.0');
  fs.mkdirSync(path.join(installPath, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(installPath, '.claude-plugin', 'plugin.json'), '{}');
  const record = (sha) => fs.writeFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2, plugins: { [PLUGIN_ID]: [{ scope: 'user', installPath, version: '0.3.0', gitCommitSha: sha }] },
  }));

  assert.match(installedProblem({ configDir, sha: 'new' }), /cannot be read/);
  record('old');
  assert.equal(installedProblem({ configDir, sha: 'new' }), 'the installed copy is commit old, not the staged new');
  record('new');
  assert.equal(installedProblem({ configDir, sha: 'new' }), null);
  assert.match(installedProblem({ configDir, sha: undefined }), /no staged commit/);
  fs.rmSync(path.join(installPath, '.claude-plugin'), { recursive: true });
  assert.match(installedProblem({ configDir, sha: 'new' }), /has no plugin in it/);
  fs.writeFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {} }));
  assert.match(installedProblem({ configDir, sha: 'new' }), /is not installed/);
});
