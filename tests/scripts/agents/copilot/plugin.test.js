// tests/scripts/agents/copilot/plugin.test.js
// Installing a plugin into Copilot CLI (scripts/agents/copilot/plugin.js). No real Copilot runs: `copilot` on the PATH is the
// stand-in (tests/helpers/host-stand-ins.js), and what Copilot does with an installed plugin is modelled by
// tests/helpers/copilot-plugin-stand-in.js from check 56's answer.
import '../../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { standInTools } from '../../../helpers/host-stand-ins.js';
import { tempFolder } from '../../../helpers/homes.js';
import { hookFilesLoaded, install, runWithPlugin } from '../../../helpers/copilot-plugin-stand-in.js';
import { installPlugin, pluginInstalled } from '../../../../scripts/agents/copilot/plugin.js';

const COMMIT = 'a'.repeat(40);

const stand = standInTools({ accept: { copilot: [['plugin', 'install']] }, answer: { copilot: [{ args: ['plugin', 'list'], stdout: 'wheelhouse  0.0.0\n' }] } });
after(() => stand.restore());

// A plugin folder of the shape the stand-in installs: a manifest with no hooks, one skill and one agent.
function pluginFolder() {
  const folder = tempFolder('wh-plugin-');
  fs.writeFileSync(path.join(folder, 'plugin.json'), JSON.stringify({ name: 'wheelhouse', skills: 'skills/', agents: 'agents/' }));
  fs.mkdirSync(path.join(folder, 'skills', 'x'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'skills', 'x', 'SKILL.md'), 'A skill.\n');
  fs.mkdirSync(path.join(folder, 'agents'));
  fs.writeFileSync(path.join(folder, 'agents', 'y.agent.md'), 'An agent.\n');
  return folder;
}

test('installPlugin runs `copilot plugin install` and the plugin lists as installed', async () => {
  const source = pluginFolder();
  const home = tempFolder('wh-copilot-scratch-');
  stand.reset();
  const installed = [];
  const result = await installPlugin({ run: runWithPlugin(home, installed), source, tag: 'v0.0.0', commit: COMMIT });
  assert.deepEqual(result, { installed: true, tag: 'v0.0.0', commit: COMMIT });
  assert.deepEqual(stand.calls(), [`copilot plugin install ${source}`]);
  assert.equal(installed[0], path.join(home, 'installed-plugins', 'wheelhouse'));
  assert.deepEqual(hookFilesLoaded(installed[0]), [], 'a plugin with no hooks loads none');
  assert.equal(await pluginInstalled({ run: runWithPlugin(home) }), true);
  assert.equal(stand.calls().at(-1), 'copilot plugin list');
});

test('a folder that carries hooks is found to, by every place check 56 saw Copilot read them from', () => {
  const layout = tempFolder('wh-plugin-layout-');
  fs.writeFileSync(path.join(layout, 'plugin.json'), JSON.stringify({ name: 'wheelhouse', skills: 'skills/', agents: 'agents/' }));
  fs.mkdirSync(path.join(layout, 'hooks'));
  fs.writeFileSync(path.join(layout, 'hooks', 'hooks.json'), '{}');
  assert.deepEqual(hookFilesLoaded(install(layout, tempFolder('wh-copilot-scratch-'))), ['hooks/hooks.json']);
  fs.writeFileSync(path.join(layout, 'plugin.json'), JSON.stringify({ name: 'wheelhouse', hooks: {} }));
  fs.mkdirSync(path.join(layout, 'com.github.copilot', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(layout, 'com.github.copilot', 'hooks', 'x.json'), '{}');
  assert.deepEqual(hookFilesLoaded(install(layout, tempFolder('wh-copilot-scratch-'))), ['plugin.json#hooks', 'com.github.copilot/hooks/x.json', 'hooks/hooks.json']);
});

test('installPlugin refuses a call it cannot trace to a release, and reports a failed install', async () => {
  stand.reset();
  const source = pluginFolder();
  const run = runWithPlugin(tempFolder('wh-copilot-scratch-'));
  assert.equal((await installPlugin({ run, source, tag: '', commit: COMMIT })).installed, false);
  assert.equal((await installPlugin({ run, source, tag: 'v1', commit: 'abc' })).installed, false);
  assert.equal((await installPlugin({ run, source: '', tag: 'v1', commit: COMMIT })).installed, false);
  assert.deepEqual(stand.calls(), [], 'nothing ran');
  await assert.rejects(installPlugin({ source, tag: 'v1', commit: COMMIT }), /needs a run/);
  const failing = await installPlugin({ run: async () => ({ code: 1, stdout: '', stderr: 'no such folder\n' }), source, tag: 'v1', commit: COMMIT });
  assert.deepEqual(failing, { installed: false, tag: 'v1', commit: COMMIT, reason: 'no such folder' });
  assert.equal(await pluginInstalled({ run: async () => ({ code: 1, stdout: 'wheelhouse', stderr: '' }) }), false);
  assert.equal(await pluginInstalled({ run: async () => ({ code: 0, stdout: 'wheelhouse-other 1\n', stderr: '' }) }), false);
});

test('no real Copilot ran', () => {
  assert.ok(stand.calls().every((l) => l.startsWith('copilot plugin ')), stand.calls().join('\n'));
});
