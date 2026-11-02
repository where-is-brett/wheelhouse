// tests/scripts/protection/locked-copilot.test.js
// Locked on Copilot, on the Mac (plan Part A, Task A3): the two computer-wide files, and the rule that Locked is offered
// only once this Mac's sandbox test has passed. Nothing here runs an administrator step or `copilot`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installLocked, NOT_OURS, MAC_ONLY, managedSettings } from '../../../scripts/protection/locked.js';
import { lockedCopilotFiles, lockedCopilotReady, copilotLocked, NEEDS_SANDBOX, ORGANISATION } from '../../../scripts/agents/copilot/locked.js';
import { companyPlaces, OWN_MARK, baselineSettings } from '../../../scripts/agents/copilot/company.js';
import { currentSettings } from '../../../scripts/agents/copilot/sandbox-test.js';
import { settingsDigest } from '../../../adapters/copilot/sandbox.js';
import { COPILOT_VERSION } from '../../../scripts/lib/copilot-numbers.js';
import { runEntry } from '../../../scripts/agents/copilot/hook-entry.js';
import { writeProject } from '../../../scripts/lib/projects.js';

const temp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const ADDRESS = '/Users/someone/.wheelhouse/helper.sock';
const DIR = '/Library/Application Support/ClaudeCode';
const NODE = `${DIR}/wheelhouse/bin/node`;
const NOW = () => new Date('2026-11-02T01:02:03.000Z');
const NO_PLIST = '/nowhere/com.anthropic.claudecode.plist';

async function withHome(fn) {
  const home = temp('wh-lockedc-home-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}
function makeProject(name) {
  const folder = temp(`wh-lockedc-${name}-`);
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: ['docs.example.org'] }));
  writeProject(`owner__${name}`, { folder, remoteUrl: `https://example.com/owner/${name}.git`, host: 'github', repo: `owner/${name}`, connection: { host: 'github', mode: 'narrow', project: `owner/${name}` } });
  return `owner__${name}`;
}
// A fake administrator step: records the command, and the Copilot files staged for it.
function fakeRun() {
  const calls = [];
  const run = async (file, args) => {
    const command = args.at(-1);
    const stage = /'([^']*locked-stage-[^'/]*)[/']/.exec(command)?.[1];
    const staged = stage && fs.existsSync(path.join(stage, 'agent')) ? fs.readdirSync(path.join(stage, 'agent')).sort().map((n) => fs.readFileSync(path.join(stage, 'agent', n), 'utf8')) : [];
    calls.push({ command, staged });
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}
const places = () => {
  const root = temp('wh-lockedc-places-');
  return { managed: path.join(root, 'GitHubCopilot', 'managed-settings.json'), policyDir: path.join(root, 'policy.d') };
};
const passing = () => ({ result: { passed: true, version: COPILOT_VERSION, digest: settingsDigest(currentSettings({ helper: ADDRESS })) }, checked: true, settingsArgs: { helper: ADDRESS } });
const none = { read: () => null, list: () => [] };

test('the files force the sandbox computer-wide', () => {
  const p = companyPlaces('darwin');
  const [managed, hook] = lockedCopilotFiles({ dir: DIR, nodePath: NODE, address: ADDRESS, domains: ['Docs.Example.org', 'https://bad/x'] });
  assert.equal(managed.path, '/Library/Application Support/GitHubCopilot/managed-settings.json');
  assert.equal(hook.path, '/etc/github-copilot/policy.d/wheelhouse.json');
  assert.equal(p.managed, managed.path);
  const settings = JSON.parse(managed.content);
  assert.equal(settings.sandbox.enabled, true);
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.allowBypass, false);
  assert.equal(settings.permissions.disableBypassPermissionsMode, 'disable');
  assert.deepEqual(settings.sandbox.userPolicy.network.allowedHosts, ['registry.npmjs.org', 'docs.example.org']);
  assert.deepEqual(settings.sandbox.userPolicy.filesystem.readwritePaths, [ADDRESS]);
  assert.deepEqual(settings.wheelhouse, OWN_MARK);
  // The baseline's rules are all still there.
  for (const rule of baselineSettings().permissions.deny) assert.ok(settings.permissions.deny.includes(rule), rule);
  assert.equal(managed.mode, '644');
});

test('the policy hook runs the managed copy and does nothing outside a Locked project', async () => {
  const [, hook] = lockedCopilotFiles({ dir: DIR, nodePath: NODE, address: ADDRESS });
  const hooks = JSON.parse(hook.content).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['preCompact', 'preToolUse', 'sessionStart', 'userPromptSubmitted']);
  for (const [event, entries] of Object.entries(hooks)) {
    assert.equal(entries[0].command, `"${NODE}" "${DIR}/wheelhouse/scripts/agents/copilot/hook-entry.js" ${event} --policy`);
    assert.equal(entries[0].bash, entries[0].command);
  }
  // Run as the policy hook, a start in a folder that isn't a Locked project answers nothing, even for a call the guard refuses.
  const stdin = async function* () { yield JSON.stringify({ cwd: '/work/project', toolName: 'bash', toolArgs: { command: 'rm -rf /' } }); };
  const deps = { projectOf: () => ({ project: 'p' }), steps: { stopGuard: async () => ({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'no' } }) }, harnessOf: () => 'copilot', client: { health: async () => ({ ok: true }), session: { mark: async () => ({}) } } };
  const outside = await runEntry('preToolUse', { stdin: stdin(), deps: { ...deps, policy: true, lockedByPath: () => false } });
  assert.deepEqual(outside, { text: '', code: 0 });
  const inside = await runEntry('preToolUse', { stdin: stdin(), deps: { ...deps, policy: true, lockedByPath: () => true } });
  assert.equal(inside.code, 2, 'in a Locked project the guards run');
  // Without `--policy` (the person\'s own registration) the entry is as it was.
  const own = await runEntry('preToolUse', { stdin: stdin(), deps });
  assert.equal(own.code, 2);
});

test('nothing is offered on Windows', async () => {
  await withHome(async () => {
    const project = makeProject('w');
    const fake = fakeRun();
    const got = await installLocked({ project, platform: 'win32', run: fake.run, now: NOW, dir: temp('wh-lockedc-dir-'), nodePath: process.execPath, address: ADDRESS, mdmPlist: NO_PLIST, agent: copilotLocked({ sandbox: passing(), places: places(), company: none }) });
    assert.deepEqual(got, { installed: false, line: MAC_ONLY });
    assert.equal(fake.calls.length, 0);
  });
});

test('Locked for Copilot refuses until this Mac\'s sandbox test passes', async () => {
  assert.equal(lockedCopilotReady({}).ready, false);
  assert.equal(lockedCopilotReady({}).why, NEEDS_SANDBOX);
  // A passing result is not enough while the switch is off.
  assert.equal(lockedCopilotReady({ ...passing(), checked: false }).ready, false);
  // The switch on, and the result for another version: no test.
  assert.equal(lockedCopilotReady({ ...passing(), result: { ...passing().result, version: '0.0.1' } }).ready, false);
  assert.deepEqual(lockedCopilotReady(passing()), { ready: true, why: null });
  await withHome(async () => {
    const project = makeProject('s');
    const dir = temp('wh-lockedc-dir-');
    const fake = fakeRun();
    const refused = await installLocked({ project, platform: 'darwin', run: fake.run, now: NOW, dir, nodePath: process.execPath, address: ADDRESS, mdmPlist: NO_PLIST, agent: copilotLocked({ sandbox: {}, places: places(), company: none }) });
    assert.deepEqual(refused, { installed: false, line: NEEDS_SANDBOX });
    assert.equal(fake.calls.length, 0, 'no password prompt is asked');
    const ok = await installLocked({ project, platform: 'darwin', run: fake.run, now: NOW, dir, nodePath: process.execPath, address: ADDRESS, mdmPlist: NO_PLIST, agent: copilotLocked({ sandbox: passing(), places: places(), company: none }) });
    assert.equal(fake.calls.length, 1);
    assert.equal(ok.installed, false, 'the fake step put nothing in place; the files were still staged and named');
    const p = fake.calls[0];
    assert.equal(p.staged.length, 2);
    assert.match(p.command, /managed-settings\.json\.new/);
    assert.match(p.command, /chown root:wheel/);
  });
});

test('a company\'s file is never replaced', async () => {
  await withHome(async () => {
    const project = makeProject('c');
    const dir = temp('wh-lockedc-dir-');
    const mine = places();
    fs.mkdirSync(path.dirname(mine.managed), { recursive: true });
    fs.writeFileSync(mine.managed, JSON.stringify({ sandbox: { enabled: true } }));
    const fake = fakeRun();
    const args = { project, platform: 'darwin', run: fake.run, now: NOW, dir, nodePath: process.execPath, address: ADDRESS, mdmPlist: NO_PLIST };
    // Read as the company's: the organisation route, not Locked.
    const org = await installLocked({ ...args, agent: copilotLocked({ sandbox: passing(), places: mine, company: { read: (f) => (f === companyPlaces('darwin').managed ? '{}' : null), list: () => [] } }) });
    assert.deepEqual(org, { installed: false, line: ORGANISATION });
    // Not marked as ours at the place Locked would write: never replaced.
    const notOurs = await installLocked({ ...args, agent: copilotLocked({ sandbox: passing(), places: mine, company: none }) });
    assert.deepEqual(notOurs, { installed: false, line: NOT_OURS });
    // A policy hook file by our name that isn't ours either.
    fs.rmSync(mine.managed);
    fs.mkdirSync(mine.policyDir, { recursive: true });
    fs.writeFileSync(path.join(mine.policyDir, 'wheelhouse.json'), '{"hooks":{}}');
    assert.deepEqual(await installLocked({ ...args, agent: copilotLocked({ sandbox: passing(), places: mine, company: none }) }), { installed: false, line: NOT_OURS });
    assert.equal(fake.calls.length, 0);
    assert.equal(fs.readFileSync(path.join(mine.policyDir, 'wheelhouse.json'), 'utf8'), '{"hooks":{}}');
  });
});

test('Claude Code\'s Locked files are unchanged', async () => {
  await withHome(async () => {
    const project = makeProject('k');
    const dir = temp('wh-lockedc-dir-');
    const seen = [];
    const run = async (file, args) => {
      const command = args.at(-1);
      const stage = /'([^']*locked-stage-[^'/]*)[/']/.exec(command)?.[1];
      seen.push({ command, settings: JSON.parse(fs.readFileSync(path.join(stage, 'managed-settings.json'), 'utf8')), copilot: fs.readdirSync(stage) });
      return { code: 0, stdout: '', stderr: '' };
    };
    await installLocked({ project, platform: 'darwin', run, now: NOW, dir, nodePath: process.execPath, address: ADDRESS, mdmPlist: NO_PLIST });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].settings, managedSettings({ dir, nodePath: path.join(dir, 'wheelhouse', 'bin', 'node'), address: ADDRESS, domains: ['docs.example.org'] }));
    assert.ok(!/GitHubCopilot|github-copilot/.test(seen[0].command), 'no Copilot path in a Claude Code project\'s step');
    assert.ok(!seen[0].copilot.includes('agent'));
  });
});

test('what Locked forces is the sandbox the test covers', () => {
  const [managed] = lockedCopilotFiles({ dir: DIR, nodePath: NODE, address: ADDRESS, domains: ['docs.example.org'] });
  const forced = JSON.parse(managed.content).sandbox;
  const tested = currentSettings({ domains: ['registry.npmjs.org', 'docs.example.org'], helper: ADDRESS, platform: 'darwin' }).sandbox;
  assert.deepEqual(forced, tested);
  assert.equal(settingsDigest({ sandbox: forced }), settingsDigest({ sandbox: tested }));
  assert.equal(forced.userPolicy.network.allowOutbound, false);
});

test('leaving the last project takes Copilot\'s files away, and only Wheelhouse\'s', async () => {
  await withHome(async () => {
    const project = makeProject('l');
    const dir = temp('wh-lockedc-dir-');
    const mine = places();
    const part = copilotLocked({ places: mine, company: none, sandbox: passing() });
    // Nothing of ours there yet: nothing to remove.
    assert.deepEqual(part.removal(), []);
    for (const f of lockedCopilotFiles({ dir, nodePath: NODE, address: ADDRESS, places: mine })) {
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      fs.writeFileSync(f.path, f.content);
    }
    assert.deepEqual(part.removal().sort(), [mine.managed, path.join(mine.policyDir, 'wheelhouse.json')].sort());
    // A company's managed file is never removed.
    fs.writeFileSync(mine.managed, JSON.stringify({ sandbox: {} }));
    assert.deepEqual(part.removal(), []);
  });
});
