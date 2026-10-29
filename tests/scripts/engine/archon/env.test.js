// tests/scripts/engine/archon/env.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { archonEnv } from '../../../../scripts/engine/archon/env.js';
import { engineDir, archonHome, wheelhouseHome } from '../../../../scripts/lib/paths.js';
import { STOOD_IN } from '../../../helpers/stood-in.js';
import { tempFolder } from '../../../helpers/homes.js';

const system = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

function setup() {
  const root = tempFolder('wh-archon-env-');
  const engine = path.join(root, 'engine');
  const nodeDir = path.join(root, 'nodes');
  fs.mkdirSync(nodeDir);
  return { root, engine, nodeDir, home: path.join(root, 'engine-home') };
}

test('archonEnv sets the three telemetry switches, after anything the caller had', () => {
  const { engine, home, nodeDir } = setup();
  const env = archonEnv({ engine, home, nodeDir, baseEnv: { HOME: '/h', ARCHON_TELEMETRY_DISABLED: '0', DO_NOT_TRACK: '0', POSTHOG_API_KEY: 'live' } });
  assert.equal(env.ARCHON_TELEMETRY_DISABLED, '1');
  assert.equal(env.DO_NOT_TRACK, '1');
  assert.equal(env.POSTHOG_API_KEY, 'off');
  assert.equal(env.WHEELHOUSE_ENGINE_RUN, '1');
  // Check 75: in bypass mode Claude Code applies no sandbox, so the patched engine is told to start steps in acceptEdits.
  assert.equal(env.ARCHON_CLAUDE_PERMISSION_MODE, 'acceptEdits');
  // The pack's script steps run Wheelhouse's own scripts from the plugin's folder.
  assert.ok(fs.existsSync(path.join(env.WHEELHOUSE_ROOT, 'scripts', 'engine', 'order-copy.js')));
  assert.equal(archonEnv({ engine, home, nodeDir, root: '/plugin' }).WHEELHOUSE_ROOT, '/plugin');
});

test("archonEnv's PATH has the broker before anything and no folder holding a real gh", () => {
  const { engine, home, nodeDir } = setup();
  fs.writeFileSync(path.join(nodeDir, 'node'), '');
  const env = archonEnv({ engine, home, nodeDir, baseEnv: { PATH: '/opt/homebrew/bin:/somewhere/else' } });
  assert.deepEqual(env.PATH.split(path.delimiter), [
    path.join(engine, 'broker', 'bin'), path.join(engine, 'bun', 'bin'), nodeDir, ...system,
  ]);
});

test('archonEnv never puts a folder holding gh on PATH: the node folder is replaced by a link of its own', () => {
  const { engine, home, nodeDir } = setup();
  fs.writeFileSync(path.join(nodeDir, 'gh'), '');
  fs.writeFileSync(path.join(nodeDir, 'node'), 'node');
  const env = archonEnv({ engine, home, nodeDir });
  const dirs = env.PATH.split(path.delimiter);
  const own = path.join(engine, 'node', 'bin');
  assert.deepEqual(dirs, [path.join(engine, 'broker', 'bin'), path.join(engine, 'bun', 'bin'), own, ...system]);
  assert.ok(!dirs.includes(nodeDir));
  assert.equal(fs.readFileSync(path.join(own, 'node'), 'utf8'), 'node');
  assert.ok(!fs.existsSync(path.join(own, 'gh')));
  archonEnv({ engine, home, nodeDir }); // a second call finds the link in place
});

test('archonEnv defaults the node folder to the one running this process', () => {
  const { engine, home } = setup();
  const env = archonEnv({ engine, home, baseEnv: {} });
  const dirs = env.PATH.split(path.delimiter);
  const running = path.dirname(process.execPath);
  const hasGh = fs.existsSync(path.join(running, 'gh')) || fs.existsSync(path.join(running, 'gh.exe'));
  assert.ok(hasGh ? dirs.includes(path.join(engine, 'node', 'bin')) : dirs.includes(running));
});

test("archonEnv sets ARCHON_HOME outside the Wheelhouse home, and keeps no token or host variable", () => {
  const home = archonHome();
  assert.notEqual(path.dirname(home), wheelhouseHome());
  assert.ok(!home.startsWith(wheelhouseHome() + path.sep));
  assert.equal(engineDir(), path.join(wheelhouseHome(), 'engine'));
  const { engine, nodeDir } = setup();
  const env = archonEnv({ engine, nodeDir, claudeBin: '/c/claude', copilotBin: '/c/copilot', baseEnv: {
    HOME: '/h', LANG: 'C', GH_TOKEN: 't', GITHUB_TOKEN: 't', GITLAB_TOKEN: 't', ANTHROPIC_API_KEY: 'k', GH_HOST: 'x', SSH_AUTH_SOCK: '/s',
  } });
  assert.equal(env.ARCHON_HOME, home);
  assert.equal(env.CLAUDE_BIN_PATH, '/c/claude');
  assert.equal(env.COPILOT_BIN_PATH, '/c/copilot');
  assert.equal(env.HOME, '/h');
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'ANTHROPIC_API_KEY', 'GH_HOST', 'SSH_AUTH_SOCK']) assert.equal(env[name], undefined);
});

test("archonEnv keeps WHEELHOUSE_HOME when it is set, so a step's hooks use the same Wheelhouse home", () => {
  const { engine, nodeDir, home } = setup();
  assert.equal(archonEnv({ engine, home, nodeDir, baseEnv: { WHEELHOUSE_HOME: '/eval/home' } }).WHEELHOUSE_HOME, '/eval/home');
  assert.equal(Object.hasOwn(archonEnv({ engine, home, nodeDir, baseEnv: {} }), 'WHEELHOUSE_HOME'), false);
});

test('the stood-in programs include archon and bun', () => {
  assert.ok(STOOD_IN.includes('archon'));
  assert.ok(STOOD_IN.includes('bun'));
});

test("each project on the engine has its git reads sent to the helper's fetch mirror, by the engine folder's list", async () => {
  const { archonEnv } = await import('../../../../scripts/engine/archon/env.js');
  const fs = (await import('node:fs')).default;
  const os = (await import('node:os')).default;
  const path = (await import('node:path')).default;
  const engine = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-env-mirrors-'));
  const base = { HOME: '/h' };
  assert.equal(archonEnv({ engine, home: '/a', nodeDir: '/usr/bin', baseEnv: base }).GIT_CONFIG_COUNT, undefined);
  fs.mkdirSync(path.join(engine, 'mirrors'));
  fs.writeFileSync(path.join(engine, 'mirrors', 'rules.json'), JSON.stringify({ 'tide-tables': 'https://github.com/a/tide-tables.git', 'bad name': 'https://x', odd: 'line\nbreak' }));
  const env = archonEnv({ engine, home: '/a', nodeDir: '/usr/bin', baseEnv: base });
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, `url.${path.join(engine, 'mirrors', 'tide-tables.git')}.insteadOf`);
  assert.equal(env.GIT_CONFIG_VALUE_0, 'https://github.com/a/tide-tables.git');
});
