// tests/scripts/agents/copilot-sandbox.test.js
// The sandbox settings the Copilot adapter holds, the digest that ties a test result to them, and the board's line for
// the sandbox. The sandbox test and the clean home that writes the settings come back with their own parts.
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sandboxSettings, settingsDigest, sandboxLevel, sandboxState, sandboxLine, SANDBOX_LINES, deniedReads } from '../../../adapters/copilot/sandbox.js';
import copilot from '../../../adapters/copilot/index.js';
import { COPILOT_SANDBOX_CHECKED, COPILOT_VERSION } from '../../../scripts/agents/copilot/numbers.js';
import { keysDir, archonHome } from '../../../scripts/lib/paths.js';

const HELPER = '/tmp/wh-helper.sock';
const make = (extra = {}) => sandboxSettings({ domains: ['example.com'], helper: HELPER, platform: 'darwin', ...extra });
const passed = (settings, version = COPILOT_VERSION) => ({ passed: true, version, digest: settingsDigest(settings), results: [] });

test('the switch starts off', () => {
  assert.equal(COPILOT_SANDBOX_CHECKED, false);
  assert.equal(sandboxLevel({ result: passed(make()), version: COPILOT_VERSION, digest: settingsDigest(make()) }), false);
});

test('the keys and the engine\'s private files are denied, and the sandbox fails closed', () => {
  const { sandbox } = make();
  assert.equal(sandbox.enabled, true);
  assert.equal(sandbox.failIfUnavailable, true);
  assert.equal(sandbox.allowBypass, false);
  const denied = deniedReads({ platform: 'darwin' });
  for (const p of [keysDir(), path.join(process.env.HOME, '.copilot'), path.join(process.env.HOME, '.agents'), path.join(process.env.HOME, '.ssh'), path.join(archonHome(), 'credential-key'), path.join(archonHome(), 'archon.db'), path.join(archonHome(), '.env'), path.join(archonHome(), 'plugins')]) {
    assert.ok(sandbox.userPolicy.filesystem.deniedPaths.includes(p), p);
  }
  assert.equal(sandbox.addCurrentWorkingDirectory, true);
  assert.deepEqual(sandbox.userPolicy.filesystem.readwritePaths, [HELPER]);
  assert.equal(sandbox.userPolicy.network.allowOutbound, false);
  assert.equal(sandbox.userPolicy.network.allowLocalNetwork, false);
  assert.deepEqual(sandbox.userPolicy.network.allowedHosts, ['example.com']);
  assert.throws(() => sandboxSettings({ domains: [] }), /helper/);
});

test('a new project\'s domains leave the test standing', () => {
  const before = make({ domains: ['a.example.com'] });
  const after = make({ domains: ['a.example.com', 'b.example.com'] });
  assert.equal(settingsDigest(before), settingsDigest(after));
  assert.notEqual(settingsDigest(before), settingsDigest(make({ helper: '/tmp/other.sock' })));
  assert.equal(sandboxLevel({ result: passed(before), version: COPILOT_VERSION, digest: settingsDigest(after), checked: true }), true);
});

test('a result for another version, other settings or a failed run counts as no test', () => {
  const settings = make();
  const digest = settingsDigest(settings);
  assert.equal(sandboxLevel({ result: passed(settings, '1.0.1'), version: COPILOT_VERSION, digest, checked: true }), false);
  assert.equal(sandboxState({ result: passed(settings, '1.0.1'), version: COPILOT_VERSION, digest, checked: true }), 'stale');
  assert.equal(sandboxState({ result: null, version: COPILOT_VERSION, digest, checked: true }), 'untested');
  assert.equal(sandboxLevel({ result: passed(settings), version: COPILOT_VERSION, digest: settingsDigest(make({ helper: '/tmp/elsewhere.sock' })), checked: true }), false);
  assert.equal(sandboxLevel({ result: { ...passed(settings), passed: false }, version: COPILOT_VERSION, digest, checked: true }), false);
});

test('the board has a line for each state of the sandbox, and none for an unknown one', () => {
  for (const state of ['holds', 'stale', 'untested']) assert.equal(sandboxLine(state), SANDBOX_LINES[state]);
  assert.equal(sandboxLine('unheard-of'), null);
});

test('the adapter\'s settings part gives the sandbox settings and holds nothing of the person\'s', () => {
  assert.deepEqual(copilot.settings.local(), {});
  assert.deepEqual(copilot.settings.project({ domains: [], helper: HELPER }), sandboxSettings({ domains: [], helper: HELPER }));
});
