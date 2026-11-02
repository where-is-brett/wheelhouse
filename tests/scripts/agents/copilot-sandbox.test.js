// tests/scripts/agents/copilot-sandbox.test.js
// The sandbox round Copilot's steps under the build engine: its settings, the test that gates them, and the clean home
// that holds them only while a test stands (plan Part A, Task A1). No test starts `copilot`: `run` is a stand-in.
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandboxSettings, settingsDigest, sandboxLevel, sandboxState, SETTINGS_FILE, deniedReads } from '../../../adapters/copilot/sandbox.js';
import copilot from '../../../adapters/copilot/index.js';
import { checkAdapter } from '../../../scripts/agents/contract.js';
import { runSandboxTest, writeResult, readResult, TRIES, sandboxNow } from '../../../scripts/agents/copilot/sandbox-test.js';
import { writeEngineHome, engineHomeProblem } from '../../../scripts/agents/copilot/engine-home.js';
import { copilotCliPaths } from '../../../scripts/engine/archon/copilot-cli.js';
import { levelAllowed } from '../../../adapters/copilot/permissions.js';
import { healthLines, COPILOT_SANDBOX_LINES } from '../../../scripts/board/health.js';
import { COPILOT_SANDBOX_CHECKED, COPILOT_VERSION } from '../../../scripts/lib/copilot-numbers.js';
import { keysDir, archonHome } from '../../../scripts/lib/paths.js';
import { tempFolder } from '../../helpers/homes.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const HELPER = '/tmp/wh-helper.sock';
const make = (extra = {}) => sandboxSettings({ worktreeBases: ['/work/wt'], domains: ['example.com'], helper: HELPER, platform: 'darwin', ...extra });
const refuseAll = async () => ({ refused: true });

function signedIn(root) {
  const from = path.join(root, 'signed-in');
  fs.mkdirSync(from, { recursive: true });
  fs.writeFileSync(path.join(from, 'config.json'), JSON.stringify({ loggedInUsers: [{ host: 'https://github.com', login: 'ann' }], lastLoggedInUser: { login: 'ann' } }));
  return from;
}
function homeFor(root, sandbox) {
  const engine = path.join(root, 'engine');
  const args = { engine, signedInFrom: signedIn(root), node: process.execPath, root: ROOT, platform: 'darwin', sandbox };
  return { engine, args, write: () => writeEngineHome(args), problem: () => engineHomeProblem(args) };
}
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
    assert.ok(sandbox.filesystem.denyRead.includes(p), p);
  }
  assert.deepEqual(sandbox.filesystem.write, ['/work/wt']);
  assert.deepEqual(sandbox.network.allowUnixSockets, [HELPER]);
  assert.equal(sandbox.network.allowLocalNetwork, false);
  assert.deepEqual(sandbox.network.allowedHosts, ['example.com']);
  assert.ok(denied.length > 10);
  assert.throws(() => sandboxSettings({ worktreeBases: [], domains: [] }), /helper/);
});

test('one try let through fails the test', async () => {
  for (const [i, attempt] of TRIES.entries()) {
    const settings = make();
    const result = await runSandboxTest({ run: async ({ name }) => ({ refused: name !== attempt.name }), settings, home: tempFolder('wh-sbx-'), platform: 'darwin' });
    assert.equal(result.passed, false, `${i} ${attempt.name}`);
  }
  const throws = await runSandboxTest({ run: async () => { throw new Error('boom'); }, settings: make(), home: tempFolder('wh-sbx-'), platform: 'darwin' });
  assert.equal(throws.passed, false);
  const good = await runSandboxTest({ run: refuseAll, settings: make(), home: tempFolder('wh-sbx-'), platform: 'darwin' });
  assert.equal(good.passed, true);
  assert.equal(good.results.length, TRIES.length);
});

test('the network on Windows is reported, not failed', async () => {
  const run = async ({ name }) => ({ refused: !TRIES.find((t) => t.name === name).network });
  const win = await runSandboxTest({ run, settings: make({ platform: 'win32' }), home: tempFolder('wh-sbx-'), platform: 'win32' });
  assert.equal(win.passed, true);
  assert.deepEqual(win.results.filter((r) => r.reported).map((r) => r.name), TRIES.filter((t) => t.network).map((t) => t.name));
  const mac = await runSandboxTest({ run, settings: make(), home: tempFolder('wh-sbx-'), platform: 'darwin' });
  assert.equal(mac.passed, false);
  // A file try let through still fails on Windows.
  const file = await runSandboxTest({ run: async ({ name }) => ({ refused: name !== 'read the keys folder' }), settings: make(), home: tempFolder('wh-sbx-'), platform: 'win32' });
  assert.equal(file.passed, false);
});

test('the test runs in a scratch home', async () => {
  const parent = tempFolder('wh-sbx-');
  const root = tempFolder('wh-sbx-clean-');
  const clean = copilotCliPaths(path.join(root, 'engine')).home;
  const seen = [];
  const settings = make();
  await runSandboxTest({
    run: async ({ home }) => {
      seen.push(home);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, SETTINGS_FILE), 'utf8')), settings);
      return { refused: true };
    },
    settings,
    home: parent,
    platform: 'darwin',
  });
  assert.equal(new Set(seen).size, 1);
  assert.notEqual(seen[0], clean);
  assert.ok(seen[0].startsWith(parent));
  assert.equal(fs.existsSync(seen[0]), false, 'the scratch home is removed');
  assert.equal(fs.existsSync(clean), false, 'the clean home is never made by the test');
});

test('the result is kept for the computer', async () => {
  const file = path.join(tempFolder('wh-sbx-'), 'agents', 'copilot-sandbox.json');
  const result = await runSandboxTest({ run: refuseAll, settings: make(), home: tempFolder('wh-sbx-'), platform: 'darwin' });
  writeResult(result, file);
  assert.deepEqual(readResult(file), result);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(readResult(path.join(path.dirname(file), 'none.json')), null);
  fs.writeFileSync(file, 'not json');
  assert.equal(readResult(file), null);
  // Kept under the Wheelhouse home, outside any project.
  assert.ok(sandboxNow().settings.sandbox);
});

test('a new project\'s domains leave the test standing', () => {
  const before = make({ domains: ['a.example.com'] });
  const after = make({ domains: ['a.example.com', 'b.example.com'] });
  assert.equal(settingsDigest(before), settingsDigest(after));
  assert.notEqual(settingsDigest(before), settingsDigest(make({ worktreeBases: ['/other'] })));
  assert.notEqual(settingsDigest(before), settingsDigest(make({ helper: '/tmp/other.sock' })));
  const result = passed(before);
  assert.equal(sandboxLevel({ result, version: COPILOT_VERSION, digest: settingsDigest(after), checked: true }), true);
});

test('a result for another version counts as no test', () => {
  const settings = make();
  const digest = settingsDigest(settings);
  assert.equal(sandboxLevel({ result: passed(settings, COPILOT_VERSION), version: COPILOT_VERSION, digest, checked: true }), true);
  assert.equal(sandboxLevel({ result: passed(settings, '1.0.1'), version: COPILOT_VERSION, digest, checked: true }), false);
  assert.equal(sandboxState({ result: passed(settings, '1.0.1'), version: COPILOT_VERSION, digest, checked: true }), 'stale');
  assert.equal(sandboxState({ result: null, version: COPILOT_VERSION, digest, checked: true }), 'untested');
});

test('a result for other settings counts as no test', () => {
  const settings = make();
  const other = make({ worktreeBases: ['/elsewhere'] });
  assert.equal(sandboxLevel({ result: passed(settings), version: COPILOT_VERSION, digest: settingsDigest(other), checked: true }), false);
  assert.equal(sandboxLevel({ result: { ...passed(settings), passed: false }, version: COPILOT_VERSION, digest: settingsDigest(settings), checked: true }), false);
});

test('the switch off keeps the settings out of the home', () => {
  const root = tempFolder('wh-sbx-home-');
  // The real default: the switch is off, so even a passing result for these settings writes nothing.
  const home = homeFor(root, sandboxNow({ result: passed(sandboxNow().settings) }));
  const dir = home.write();
  assert.equal(fs.existsSync(path.join(dir, SETTINGS_FILE)), false);
  assert.equal(home.problem(), null);
});

test('the settings are written while a test stands, and removed when it goes stale', () => {
  const root = tempFolder('wh-sbx-home-');
  const settings = make();
  const standing = { level: true, settings };
  const home = homeFor(root, standing);
  const dir = home.write();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')), settings);
  assert.equal(fs.statSync(path.join(dir, SETTINGS_FILE)).mode & 0o777, 0o600);
  assert.equal(home.problem(), null);
  // The test goes stale: a home still holding the file is a problem, and writing again removes it.
  const stale = homeFor(root, { level: false, settings });
  assert.match(stale.problem(), /no passing test covers/);
  stale.write();
  assert.equal(fs.existsSync(path.join(dir, SETTINGS_FILE)), false);
  assert.equal(stale.problem(), null);
});

test('a home whose settings were removed or changed starts no Copilot step', () => {
  const root = tempFolder('wh-sbx-home-');
  const settings = make();
  const home = homeFor(root, { level: true, settings });
  const dir = home.write();
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ sandbox: { enabled: false } }));
  assert.match(home.problem(), /sandbox settings aren't in its clean home/);
  fs.rmSync(path.join(dir, SETTINGS_FILE));
  assert.match(home.problem(), /sandbox settings aren't in its clean home/);
  home.write();
  assert.equal(home.problem(), null);
});

test('a run\'s level is recorded: the level check takes the test\'s answer', () => {
  // levelAllowed takes sandboxLevel's answer: only a standing test lets the sandbox level run.
  assert.deepEqual(levelAllowed({ level: 'sandbox' }).level, 'ask');
  assert.deepEqual(levelAllowed({ level: 'sandbox', sandbox: false }).ok, false);
  assert.deepEqual(levelAllowed({ level: 'sandbox', sandbox: true }), { ok: true, level: 'sandbox', why: null });
});

test('the board stops saying the sandbox holds when the test goes stale', () => {
  const lines = (copilotSandbox) => healthLines({ record: {}, platform: 'darwin', copilotSandbox }).map((l) => l.text);
  assert.ok(lines('holds').includes(COPILOT_SANDBOX_LINES.holds));
  assert.ok(lines('stale').includes(COPILOT_SANDBOX_LINES.stale));
  assert.ok(lines('untested').includes(COPILOT_SANDBOX_LINES.untested));
  assert.ok(!lines('stale').includes(COPILOT_SANDBOX_LINES.holds));
  assert.deepEqual(lines(undefined).filter((t) => /sandbox/.test(t)), []);
  // Without a switch on, the state is never 'holds'.
  assert.notEqual(sandboxNow().state, 'holds');
});

test('the adapter lists nothing as pending', () => {
  assert.deepEqual(copilot.pending, []);
  assert.deepEqual(checkAdapter(copilot), []);
  assert.deepEqual(copilot.settings.local(), {});
  assert.deepEqual(copilot.settings.project({ worktreeBases: [], domains: [], helper: HELPER }), sandboxSettings({ worktreeBases: [], domains: [], helper: HELPER }));
});
