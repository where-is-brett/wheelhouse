// tests/scripts/agents/copilot/versions.test.js
// The versions in use, and the pin (scripts/agents/copilot/versions.js, scripts/agents/pins.js, lineage/manifest.json):
// Wheelhouse is pinned to the Copilot CLI version its trial's checks ran on (check 96), and a Copilot session is held when the
// installed CLI is another version that hasn't passed the safety subset. Made-up versions stand in wherever the test needs a
// version other than the pin; no Copilot program is started.
import '../../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHome } from '../../../helpers/homes.js';
import { COPILOT_VERSION } from '../../../../scripts/agents/copilot/numbers.js';
import { AGENT_PINS } from '../../../../scripts/agents/pins.js';
import {
  VERSION_HOLD, VERSION_LIFTS, checkVersions, cliFault, copilotModels, copilotVersionCheck, isTested, pinnedCli, readVersions, seenFile, versionWhy, versionsFile,
} from '../../../../scripts/agents/copilot/versions.js';
import { agentHoldFile, agentHoldWords, isHeld, readAgentHold } from '../../../../scripts/lineage/check.js';
import { buildManifest, readManifest } from '../../../../scripts/lineage/manifest.js';
import { provenanceMatches, WHY } from '../../../../scripts/lineage/provenance.js';
import { HOLD_WHY_CHARS, makeEvent } from '../../../../scripts/state/events.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PROJECT = 'o__p';
const NOW = () => new Date('2026-11-10T00:00:00Z');
const AT_PIN = { vscode: null, runtime: null, cli: COPILOT_VERSION };
// Made-up versions: one past the pin and one before it.
const NEWER = { vscode: '9.1.0', runtime: '2.3.4', cli: '7.0.2' };
const OLDER = { vscode: null, runtime: null, cli: '0.0.1' };

const subsetOf = (ok) => {
  const calls = [];
  const run = async (args) => { calls.push(args); return { ok }; };
  run.calls = calls;
  return run;
};

// ---- The pin ----

test('Copilot CLI is pinned at 1.0.105, the version check 96 ran on, in the code and in the manifest', () => {
  assert.equal(COPILOT_VERSION, '1.0.105');
  assert.deepEqual(AGENT_PINS, { copilot: { cli: '1.0.105' } });
  assert.deepEqual(readManifest(ROOT).agents, { copilot: { cli: '1.0.105' } });
  assert.deepEqual(buildManifest({ roots: {}, version: '1.2.3', upstreams: [] }).agents, { copilot: { cli: '1.0.105' } });
  assert.equal(pinnedCli(), '1.0.105');
  // The pin names what was tested: the check records the same version.
  assert.match(fs.readFileSync(path.join(ROOT, 'docs', 'checks', '96-copilot-trial-t1-t2.md'), 'utf8'), /Copilot CLI 1\.0\.105/);
});

test('pinnedCli reads the manifest it is given, and a manifest with no pin or no version gives null', () => {
  assert.equal(pinnedCli({ agents: { copilot: { cli: '2.0.0' } } }), '2.0.0');
  assert.equal(pinnedCli({ agents: {} }), null);
  assert.equal(pinnedCli({ agents: { copilot: { cli: 'latest' } } }), null);
  assert.equal(pinnedCli({}), null);
});

test('the gate compares a Copilot session\'s version with the pin, at or above', () => {
  const manifest = readManifest(ROOT);
  const found = { wheelhouse: manifest.wheelhouse.version, upstreams: Object.fromEntries(manifest.upstreams.map((u) => [u.name, u.sha])), fingerprints: 'match', agent: 'copilot', agentVersion: COPILOT_VERSION, claudeCode: null };
  assert.deepEqual(provenanceMatches(found, manifest), { ok: true });
  assert.deepEqual(provenanceMatches({ ...found, agentVersion: '1.0.101' }, manifest), { ok: false, why: WHY.agent }, 'the version before the pin');
  assert.deepEqual(provenanceMatches({ ...found, agentVersion: null }, manifest), { ok: false, why: WHY.agent });
  assert.deepEqual(provenanceMatches({ ...found, agent: 'other' }, manifest), { ok: false, why: WHY.agent });
});

// ---- The lineage check holds a session when the CLI isn't the pin ----

test('a CLI at the pin passes without running the safety subset, and writes nothing', () => withHome(async (home) => {
  const subset = subsetOf(false);
  assert.deepEqual(await checkVersions({ project: PROJECT, versions: AT_PIN, runSubset: subset, home, now: NOW }), { lifted: false });
  assert.equal(subset.calls.length, 0);
  assert.equal(isHeld(PROJECT), false);
  assert.equal(fs.existsSync(seenFile(home)), false);
  assert.deepEqual(await copilotVersionCheck({ versions: AT_PIN, last: null, runSubset: subset, pin: COPILOT_VERSION }), { changed: false, ok: true, why: null });
}));

test('a CLI that differs from the pin holds the session, whether it is newer, older or unreadable', () => withHome(async (home) => {
  for (const [versions, name] of [[NEWER, 'newer'], [OLDER, 'older'], [{ vscode: null, runtime: null, cli: null }, 'unreadable']]) {
    const project = `o__${name}`;
    const subset = subsetOf(false);
    let error;
    try { await checkVersions({ project, versions, runSubset: subset, home, now: NOW }); } catch (e) { error = e; }
    assert.ok(error, `${name}: the start is refused`);
    assert.match(error.message, /isn't the version Wheelhouse has tested, and Wheelhouse is pinned to 1\.0\.105, and it hasn't passed Wheelhouse's safety checks/);
    assert.match(error.message, /no Copilot session is started until it passes/);
    assert.equal(subset.calls.length, 1, `${name}: the subset ran once`);
    assert.equal(isHeld(project), true, `${name}: the project is held`);
    assert.equal(fs.existsSync(agentHoldFile(project, VERSION_HOLD)), true);
    assert.equal(readAgentHold(project, VERSION_HOLD).agent, 'copilot');
    assert.deepEqual(error.records.map((r) => [r.kind, r.data.lifts]), [['lineage-hold', VERSION_LIFTS]]);
    assert.match(agentHoldWords(project), /pinned to 1\.0\.105/, `${name}: the hook says what holds the work`);
  }
}));

test('the hold stands until the CLI is back at the pin, which lifts it with no subset run', () => withHome(async (home) => {
  await assert.rejects(checkVersions({ project: PROJECT, versions: NEWER, runSubset: subsetOf(false), home, now: NOW }), /hasn't passed/);
  assert.equal(isHeld(PROJECT), true);
  const subset = subsetOf(false);
  assert.deepEqual(await checkVersions({ project: PROJECT, versions: AT_PIN, runSubset: subset, home, now: NOW }), { lifted: true });
  assert.equal(subset.calls.length, 0);
  assert.equal(isHeld(PROJECT), false);
}));

test('a version other than the pin that passes the subset is let through once and then remembered', () => withHome(async (home) => {
  const subset = subsetOf(true);
  assert.deepEqual(await checkVersions({ project: PROJECT, versions: NEWER, runSubset: subset, home, now: NOW }), { lifted: false });
  assert.deepEqual(subset.calls, [{ versions: NEWER }]);
  assert.equal(JSON.parse(fs.readFileSync(seenFile(home), 'utf8')).cli, '7.0.2');
  await checkVersions({ project: PROJECT, versions: NEWER, runSubset: subset, home, now: NOW });
  assert.equal(subset.calls.length, 1, 'the same versions run nothing more');
  assert.equal(isHeld(PROJECT), false);
}));

test('with no subset runner given, a version other than the pin is held: the runner isn\'t built yet', () => withHome(async (home) => {
  await assert.rejects(checkVersions({ project: PROJECT, versions: NEWER, home, now: NOW }), /Copilot CLI 7\.0\.2 .*hasn't passed Wheelhouse's safety checks/);
  assert.equal(isHeld(PROJECT), true);
}));

test('a hold\'s words stay within what the record may carry, and name the pin', () => {
  const long = `7.0.2-${'x'.repeat(60)}`;
  const why = versionWhy({ vscode: long, runtime: long, cli: long }, '1.0.105');
  assert.ok(why.length <= HOLD_WHY_CHARS);
  assert.doesNotThrow(() => makeEvent({ kind: 'lineage-hold', data: { at: NOW().toISOString(), mismatches: [{ upstream: 'copilot', path: 'cli' }], why, lifts: VERSION_LIFTS }, now: NOW }));
  assert.match(versionWhy(NEWER, '1.0.105'), /Copilot CLI 7\.0\.2 \(VS Code 9\.1\.0, Copilot runtime 2\.3\.4\) isn't the version Wheelhouse has tested, and Wheelhouse is pinned to 1\.0\.105/);
  assert.doesNotMatch(versionWhy(NEWER), /pinned/);
});

// ---- The versions in use ----

test('readVersions takes the CLI\'s version from the environment or from `copilot --version`, never from a file', () => withHome(async (home) => {
  let started = 0;
  const run = async () => { started += 1; return { code: 0, stdout: 'GitHub Copilot CLI 7.0.9.\n' }; };
  assert.deepEqual(await readVersions({ home, env: { COPILOT_CLI_BINARY_VERSION: '7.0.1' }, run }), { vscode: null, runtime: null, cli: '7.0.1' });
  assert.equal(started, 0, 'the environment settles it, and nothing is started');
  // The add-on's record names VS Code and the runtime; its `cli` is ignored, so a written file can't claim the pin.
  fs.mkdirSync(path.dirname(versionsFile(home)), { recursive: true });
  fs.writeFileSync(versionsFile(home), JSON.stringify({ ...NEWER, cli: COPILOT_VERSION }));
  assert.deepEqual(await readVersions({ home, env: { COPILOT_CLI_BINARY_VERSION: '7.0.1' } }), { vscode: '9.1.0', runtime: '2.3.4', cli: '7.0.1' });
  assert.deepEqual(await readVersions({ home, env: {} }), { vscode: '9.1.0', runtime: '2.3.4', cli: null }, 'a file alone names no CLI');
  const claimed = await readVersions({ home, env: {}, run: async () => ({ code: 0, stdout: 'GitHub Copilot CLI 7.0.9.\n' }), platform: 'linux' });
  assert.equal(claimed.cli, '7.0.9', 'the program\'s own answer decides, not the file\'s claim of the pin');
  fs.writeFileSync(versionsFile(home), JSON.stringify({ vscode: 'latest', runtime: 2 }));
  assert.deepEqual(await readVersions({ home, env: { COPILOT_CLI_BINARY_VERSION: 'not a version' } }), { vscode: null, runtime: null, cli: null });
  fs.rmSync(versionsFile(home));
  const asked = [];
  const once = async (file, args) => { asked.push([file, ...args]); return { code: 0, stdout: 'GitHub Copilot CLI 7.0.3.\n' }; };
  // `copilot --version` is asked once per process: the answer above is kept.
  assert.equal((await readVersions({ home, env: {}, run: once, platform: 'linux' })).cli, '7.0.9');
  assert.deepEqual(asked, []);
}));

test('a CLI version that could not be read is not kept: a later read tries again', () => withHome(async (home) => {
  const env = { Path: 'C:\\bin-retry-a' };
  const exists = () => true;
  let answers = [{ code: 1, stdout: '' }, { code: 1, stdout: '' }, { code: 0, stdout: 'GitHub Copilot CLI 1.0.105.\n' }];
  const asked = [];
  const run = async () => { asked.push(1); return answers.shift(); };
  const first = await readVersions({ home, env, run, platform: 'win32', exists });
  assert.equal(first.cli, null, 'a failed read is null');
  const second = await readVersions({ home, env, run, platform: 'win32', exists });
  assert.equal(second.cli, '1.0.105', 'a later start asks again and is not held to the early failure');
  assert.equal((await readVersions({ home, env, run, platform: 'win32', exists })).cli, '1.0.105');
  assert.equal(asked.length, 3, 'a good answer is kept for the process');
}));

test('a read that fails once is tried once more before it counts, and an answer written to stderr is read', () => withHome(async (home) => {
  let calls = 0;
  const flaky = async () => { calls += 1; return calls === 1 ? { code: 0, stdout: '' } : { code: 0, stdout: 'GitHub Copilot CLI 1.0.106.\n' }; };
  assert.equal((await readVersions({ home, env: { Path: 'C:\\bin-retry-b' }, run: flaky, platform: 'win32', exists: () => true })).cli, '1.0.106');
  const onStderr = async () => ({ code: 0, stdout: '', stderr: 'GitHub Copilot CLI 1.0.107.\n' });
  assert.equal((await readVersions({ home, env: { Path: 'C:\\bin-retry-c' }, run: onStderr, platform: 'win32', exists: () => true })).cli, '1.0.107');
}));

test('on Windows a copilot program missing from the PATH is looked for in VS Code\'s shim folders, and the fault is named when none answers', () => withHome(async (home) => {
  const shim = 'C:\\Users\\p\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\copilot-shim\\copilot.exe';
  const env = { Path: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' };
  const started = [];
  const run = async (file) => { started.push(file); return { code: 0, stdout: 'GitHub Copilot CLI 1.0.105.\n' }; };
  const found = await readVersions({ home, env, run, platform: 'win32', exists: (f) => f === shim });
  assert.equal(found.cli, '1.0.105');
  assert.equal(started[0], shim);
  const none = await readVersions({ home, env: { Path: 'C:\\nowhere' }, run, platform: 'win32', exists: () => false });
  assert.equal(none.cli, null, 'a program that is nowhere still fails closed');
  assert.match(cliFault(), /not found/);
}));

test('copilotModels reads the models Copilot offers, and guesses none', async () => {
  const help = (stdout, code = 0) => async () => ({ code, stdout });
  const text = 'Options:\n  --model <model>  Set the AI model to use (choices: "model-a", "model-b-1.5", "-bad", "model-a")\n  --help\n';
  assert.deepEqual(await copilotModels({ run: help(text), platform: 'linux' }), ['model-a', 'model-b-1.5']);
  assert.deepEqual(await copilotModels({ run: help('Options:\n  --model <model>  Set the AI model to use\n'), platform: 'linux' }), []);
  assert.deepEqual(await copilotModels({ run: help(text, 1), platform: 'linux' }), []);
  assert.deepEqual(await copilotModels({ run: async () => { throw new Error('no'); }, platform: 'linux' }), []);
  assert.deepEqual(await copilotModels({}), []);
});

// ---- The tested-versions table ----

const TEXT = [
  '<!-- docs/copilot/tested-versions.md -->',
  '',
  'Some words that mention | a pipe | in a line that is not a row.',
  '',
  '| VS Code | Copilot runtime | Tested on | Result |',
  '|---|---|---|---|',
  '| 9.1.0 | 2.3.4 | 1 January 2030 | passed |',
  '| 9.1.0 | 2.3.5 | 1 January 2030 | failed |',
  '| 9.2.0 | 2.3.4 | 2 January 2030 | Passed on both systems |',
  '| `9.3.0` | `2.4.0` | 3 January 2030 | passed |',
  '| 9.4.0 | 2.5.0 | 4 January 2030 | did not pass |',
  '| 9.6.0 | 2.7.0 | 6 January 2030 |  |',
  '',
].join('\n');

test('isTested counts a row only when its Result says it passed, and both versions match exactly', () => {
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.3.4' }, TEXT), true);
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.3.5' }, TEXT), false, 'failed');
  assert.equal(isTested({ vscode: '9.2.0', runtime: '2.3.4' }, TEXT), true, 'Result begins with passed, in any case');
  assert.equal(isTested({ vscode: '9.3.0', runtime: '2.4.0' }, TEXT), true, 'versions in backticks');
  assert.equal(isTested({ vscode: '9.4.0', runtime: '2.5.0' }, TEXT), false, '"did not pass" is not a pass');
  assert.equal(isTested({ vscode: '9.6.0', runtime: '2.7.0' }, TEXT), false, 'no result');
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.4.0' }, TEXT), false, 'the VS Code of one row and the runtime of another');
  assert.equal(isTested({ vscode: '9.1', runtime: '2.3.4' }, TEXT), false, 'a prefix is not a match');
  assert.equal(isTested({ vscode: ' 9.1.0 ', runtime: '2.3.4\n' }, TEXT), true);
  assert.equal(isTested({ vscode: '9.1.0' }, TEXT), false);
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.3.4' }, ''), false);
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.3.4' }, TEXT.replaceAll('\n', '\r\n')), true, 'Windows line endings');
});
