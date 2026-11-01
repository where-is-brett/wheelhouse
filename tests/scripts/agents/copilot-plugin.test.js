// tests/scripts/agents/copilot-plugin.test.js
// The Wheelhouse plugin for Copilot CLI (Part 8 Task 1; rulings P8-15, P8-16): its own root, skills and agents and no hooks.
// No real Copilot runs: `copilot` on the PATH is the stand-in (tests/helpers/host-stand-ins.js), and what Copilot does with an
// installed plugin is modelled by tests/helpers/copilot-plugin-stand-in.js from check 56's answer.
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import { hookFilesLoaded, install, runWithPlugin } from '../../helpers/copilot-plugin-stand-in.js';
import { buildPlugin, checkPlugin, PLUGIN_DIR } from '../../../scripts/agents/copilot/home.js';
import { installPlugin, pluginInstalled } from '../../../scripts/agents/copilot/plugin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PLUGIN = path.join(ROOT, ...PLUGIN_DIR.split('/'));
const COMMIT = 'a'.repeat(40);

// The calls `copilot plugin install` and `copilot plugin list` are taken by the stand-in on the PATH.
const stand = standInTools({ accept: { copilot: [['plugin', 'install']] }, answer: { copilot: [{ args: ['plugin', 'list'], stdout: 'wheelhouse  0.0.0\n' }] } });
after(() => stand.restore());

const walk = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/')).sort();

test('the plugin\'s manifest carries no hooks, and the repository root has no plugin.json', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'wheelhouse');
  assert.equal(manifest.skills, 'skills/');
  assert.equal(manifest.agents, 'agents/');
  assert.ok(!Object.hasOwn(manifest, 'hooks'));
  assert.ok(!fs.existsSync(path.join(ROOT, 'plugin.json')), 'no plugin.json at the repository root');
  const files = walk(PLUGIN);
  assert.deepEqual(files.filter((f) => /(^|\/)hooks(\/|\.json$)/.test(f) || f.startsWith('com.github.copilot/') || f.startsWith('.github/')), []);
  assert.deepEqual(files.filter((f) => /\.(js|sh|cjs|mjs)$/.test(f)), []);
  assert.ok(files.some((f) => f.startsWith('skills/')) && files.some((f) => f.startsWith('agents/')));
});

test('the committed plugin is exactly what buildPlugin gives, and its MANIFEST lists every file', () => {
  assert.deepEqual(checkPlugin({ root: ROOT }), []);
  const built = buildPlugin({ root: ROOT });
  assert.deepEqual(walk(PLUGIN), [...built.keys()].sort());
  const listed = built.get('MANIFEST.txt').trim().split('\n').map((l) => l.split(' ')[1]);
  assert.deepEqual(listed, [...built.keys()].filter((f) => f !== 'MANIFEST.txt'));
});

test('a changed copy in the plugin is found', () => {
  const root = tempFolder('wh-plugin-root-');
  for (const part of ['skills', 'agents', 'commands']) fs.cpSync(path.join(ROOT, part), path.join(root, part), { recursive: true });
  fs.cpSync(path.join(ROOT, 'adapters', 'copilot'), path.join(root, 'adapters', 'copilot'), { recursive: true, filter: (from) => path.basename(from) !== 'plugin' });
  const stale = checkPlugin({ root });
  assert.ok(stale.length > 0);
  fs.cpSync(PLUGIN, path.join(root, ...PLUGIN_DIR.split('/')), { recursive: true });
  assert.deepEqual(checkPlugin({ root }), []);
  fs.appendFileSync(path.join(root, ...PLUGIN_DIR.split('/'), 'agents', 'wheelhouse-builder.agent.md'), 'edited\n');
  assert.deepEqual(checkPlugin({ root }), [`${PLUGIN_DIR}/agents/wheelhouse-builder.agent.md`]);
});

test('Copilot installing the plugin loads no Wheelhouse hook from it', async () => {
  const home = tempFolder('wh-copilot-scratch-');
  stand.reset();
  const installed = [];
  const result = await installPlugin({ run: runWithPlugin(home, installed), source: PLUGIN, tag: 'v0.0.0', commit: COMMIT });
  assert.deepEqual(result, { installed: true, tag: 'v0.0.0', commit: COMMIT });
  assert.deepEqual(stand.calls(), [`copilot plugin install ${PLUGIN}`]);
  assert.equal(installed.length, 1);
  assert.equal(installed[0], path.join(home, 'installed-plugins', 'wheelhouse'));
  assert.deepEqual(hookFilesLoaded(installed[0]), []);
  assert.deepEqual(walk(installed[0]).filter((f) => /(^|\/)hooks(\/|\.json$)/.test(f) && /\.(js|sh)$/.test(f)), []);
  assert.deepEqual(walk(installed[0]), walk(PLUGIN));
  assert.equal(await pluginInstalled({ run: runWithPlugin(home) }), true);
  assert.equal(stand.calls().at(-1), 'copilot plugin list');
});

test('installing the repository root as the plan\'s literal layout would is found to carry hooks/hooks.json', () => {
  const layout = tempFolder('wh-plugin-layout-');
  fs.writeFileSync(path.join(layout, 'plugin.json'), JSON.stringify({ name: 'wheelhouse', skills: 'skills/', agents: 'agents/' }));
  fs.mkdirSync(path.join(layout, 'hooks'));
  fs.copyFileSync(path.join(ROOT, 'hooks', 'hooks.json'), path.join(layout, 'hooks', 'hooks.json'));
  const installed = install(layout, tempFolder('wh-copilot-scratch-'));
  assert.deepEqual(hookFilesLoaded(installed), ['hooks/hooks.json']);
  // The stand-in also sees the other places check 56 showed.
  fs.writeFileSync(path.join(layout, 'plugin.json'), JSON.stringify({ name: 'wheelhouse', hooks: {} }));
  fs.mkdirSync(path.join(layout, 'com.github.copilot', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(layout, 'com.github.copilot', 'hooks', 'x.json'), '{}');
  assert.deepEqual(hookFilesLoaded(install(layout, tempFolder('wh-copilot-scratch-'))), ['plugin.json#hooks', 'com.github.copilot/hooks/x.json', 'hooks/hooks.json']);
});

test('installPlugin refuses a call it cannot trace to a release, and reports a failed install', async () => {
  stand.reset();
  const run = runWithPlugin(tempFolder('wh-copilot-scratch-'));
  assert.equal((await installPlugin({ run, source: PLUGIN, tag: '', commit: COMMIT })).installed, false);
  assert.equal((await installPlugin({ run, source: PLUGIN, tag: 'v1', commit: 'abc' })).installed, false);
  assert.equal((await installPlugin({ run, source: '', tag: 'v1', commit: COMMIT })).installed, false);
  assert.deepEqual(stand.calls(), [], 'nothing ran');
  const failing = await installPlugin({ run: async () => ({ code: 1, stdout: '', stderr: 'no such folder\n' }), source: PLUGIN, tag: 'v1', commit: COMMIT });
  assert.deepEqual(failing, { installed: false, tag: 'v1', commit: COMMIT, reason: 'no such folder' });
  assert.equal(await pluginInstalled({ run: async () => ({ code: 1, stdout: 'wheelhouse', stderr: '' }) }), false);
  assert.equal(await pluginInstalled({ run: async () => ({ code: 0, stdout: 'wheelhouse-other 1\n', stderr: '' }) }), false);
});

// What Claude Code loads, as Part 8 left it: the sha256 of each file's text with line endings evened to LF. A
// deliberate change to either file updates its hash here, in the same commit.
const CLAUDE_CODE_FILES = Object.freeze({
  '.claude-plugin/plugin.json': 'a9ea32fa03707a5bed63909add8a567e7b4cb6b2f902ceb83495012928c14c99',
  'hooks/hooks.json': 'c4b757ad26f991b7585c93d445864705f10b6e0d230483cd8c2229cfc09e01a8',
});

test('Claude Code\'s manifest is unchanged', () => {
  for (const [file, hash] of Object.entries(CLAUDE_CODE_FILES)) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'), hash, `${file} is as recorded`);
  }
  // No Copilot file joined Claude Code's manifest folder.
  assert.deepEqual(fs.readdirSync(path.join(ROOT, '.claude-plugin')).sort(), ['marketplace.json', 'plugin.json']);
});

test('no real Copilot ran', () => {
  const lines = stand.calls();
  assert.ok(lines.every((l) => l.startsWith('copilot plugin ')), lines.join('\n'));
});
