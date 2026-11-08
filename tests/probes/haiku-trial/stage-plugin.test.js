// tests/probes/haiku-trial/stage-plugin.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stagePlugin, installCommand, removeCommands, installedProblem, PLUGIN_ID } from '../../../probes/haiku-trial/stage-plugin.js';

const HERE = path.resolve(import.meta.dirname, '..', '..', '..');

function cloneHere(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-stage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const got = spawnSync('git', ['clone', '--quiet', '--local', HERE, repo], { encoding: 'utf8' });
  assert.equal(got.status, 0, got.stderr);
  return { dir, repo };
}

test('staged plugin leaves out this kit and the tests, and keeps what the helper imports', async (t) => {
  const { dir, repo } = cloneHere(t);
  const out = path.join(dir, 'out');
  const staged = await stagePlugin({ repo, out });
  for (const keep of ['scripts', 'skills', '.claude-plugin', 'probes/lib/scratch.js']) assert.ok(fs.existsSync(path.join(staged.pluginDir, keep)), keep);
  for (const gone of ['probes/haiku-trial', 'tests']) assert.equal(fs.existsSync(path.join(staged.pluginDir, gone)), false, gone);
  assert.equal(staged.marketplaceDir, staged.pluginDir, 'the staged copy is its own marketplace');
  const manifest = JSON.parse(fs.readFileSync(path.join(staged.marketplaceDir, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(manifest.name, 'wheelhouse', 'the marketplace setup installs the pins from');
  assert.deepEqual(manifest.plugins.map((p) => p.name), ['wheelhouse', 'superpowers']);
  assert.match(staged.sha, /^[0-9a-f]{40}$/);
  await assert.rejects(stagePlugin({ repo, out }), /not empty/, 'a second stage into the same folder is refused');
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
  assert.deepEqual(lines[1].slice(-3), ['plugin', 'install', 'wheelhouse@wheelhouse']);
  assert.deepEqual(installCommand({ marketplaceDir: '/m' })[0].slice(0, 2), ['claude', 'plugin']);
});

test('removeCommands take out the trial plugin and the copy an earlier kit installed, in the trial configuration', () => {
  assert.equal(PLUGIN_ID, 'wheelhouse@wheelhouse');
  assert.deepEqual(removeCommands({ configDir: '/c', claude: '/bin/claude' }), [
    ['env', 'CLAUDE_CONFIG_DIR=/c', '/bin/claude', 'plugin', 'uninstall', 'wheelhouse@wheelhouse'],
    ['env', 'CLAUDE_CONFIG_DIR=/c', '/bin/claude', 'plugin', 'uninstall', 'wheelhouse@wheelhouse-probe-wheelhouse-trial'],
  ]);
  assert.deepEqual(removeCommands({})[0], ['claude', 'plugin', 'uninstall', 'wheelhouse@wheelhouse']);
});

test('installedProblem compares the installed copy with the staged files', async (t) => {
  const { dir, repo } = cloneHere(t);
  const staged = await stagePlugin({ repo, out: path.join(dir, 'out') });
  const configDir = path.join(dir, 'config');
  const installPath = path.join(configDir, 'plugins', 'cache', 'wheelhouse', 'wheelhouse', '0.3.0');
  const record = (copies) => {
    fs.mkdirSync(path.join(configDir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: copies }));
  };

  assert.match(installedProblem({ configDir, pluginDir: staged.pluginDir }), /cannot be read/);
  record({});
  assert.match(installedProblem({ configDir, pluginDir: staged.pluginDir }), /wheelhouse@wheelhouse is not installed/);
  record({ [PLUGIN_ID]: [{ scope: 'user', installPath, version: '0.3.0' }] });
  assert.match(installedProblem({ configDir, pluginDir: staged.pluginDir }), /is missing/);
  const gitDir = path.join(staged.pluginDir, '.git');
  fs.cpSync(staged.pluginDir, installPath, { recursive: true, filter: (f) => f !== gitDir && !f.startsWith(`${gitDir}${path.sep}`) });
  assert.equal(installedProblem({ configDir, pluginDir: staged.pluginDir }), null, 'the same files, with no commit recorded');
  fs.appendFileSync(path.join(installPath, 'scripts', 'lib', 'paths.js'), '\n// an older copy\n');
  assert.match(installedProblem({ configDir, pluginDir: staged.pluginDir }), /1 of \d+ staged files differ in the installed copy, such as scripts\/lib\/paths\.js/);
  assert.match(installedProblem({ configDir, pluginDir: undefined }), /no staged copy/);
});

test('every file the scripts of the staged plugin import is in the staged copy', async (t) => {
  const { dir, repo } = cloneHere(t);
  const staged = await stagePlugin({ repo, out: path.join(dir, 'out') });
  const missing = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(file); continue; }
      if (!/\.(m?js|cjs)$/.test(entry.name)) continue;
      for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) {
        if (!fs.existsSync(path.resolve(path.dirname(file), spec))) missing.push(`${path.relative(staged.pluginDir, file)} -> ${spec}`);
      }
    }
  };
  walk(path.join(staged.pluginDir, 'scripts'));
  assert.deepEqual(missing, []);
});
