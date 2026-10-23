// tests/scripts/agents/copilot-lineage.test.js
// Lineage and usage on Copilot (Part 8 Task 2; rulings P8-17 to P8-23): the versions in use are read and named in a
// session's provenance, a new version runs the safety subset once before any Copilot session starts and a failure
// holds the project's work with one card, each run's use is counted in credits, never 0 for a figure no run gave,
// and the board claims no month's total. Copilot's sessions are switched off, so the part is built switched on here;
// no session runs, the subset is a stand-in, and stand-ins for gh, glab and copilot come first on the PATH (the last
// test asserts none of them ran).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { holdsDue, holdInput } from '../../../scripts/cards/build-loop.js';
import { KITS_HOLD, KITS_LIFTS } from '../../../scripts/agents/copilot/kits.js';
import {
  VERSION_HOLD, VERSION_LIFTS, copilotModels, copilotVersionCheck, readVersions, seenFile, versionWhy, versionsFile,
} from '../../../scripts/agents/copilot/versions.js';
import { AGENT_PINS } from '../../../scripts/agents/pins.js';
import { boardModel } from '../../../scripts/board/model.js';
import { renderBoard } from '../../../scripts/board/render.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { COPILOT_VERSION } from '../../../scripts/lib/copilot-numbers.js';
import { computerId, stateDir, usageDir } from '../../../scripts/lib/paths.js';
import { agentHoldFile, holdAgentWork, isHeld, recordLift } from '../../../scripts/lineage/check.js';
import { decide as lineageHold, HELD } from '../../../scripts/hooks/lineage-hold.js';
import { briefingModel } from '../../../scripts/briefing/model.js';
import { recordAllowance } from '../../../scripts/usage/store.js';
import { buildManifest, readManifest } from '../../../scripts/lineage/manifest.js';
import { parseProvenance, provenanceBlock, provenanceMatches, sessionProvenance, WHY } from '../../../scripts/lineage/provenance.js';
import { HOLD_WHY_CHARS, eventPath, listEvents, makeEvent } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { usageFigures } from '../../../scripts/usage/figures.js';
import { writeBaseline } from '../../../scripts/watcher/control-files.js';
import { makeWaker } from '../../../scripts/watcher/waker.js';
import { sessionsPart } from '../../../adapters/copilot/sessions.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { P, T0, config as projectConfig, project, worktree as makeWorktree } from '../../helpers/foreman.js';

const stand = standInTools();
after(() => stand.restore());

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ID = 'c3d4e5f6-0000-4000-8000-00000000000b';
const WORK = 'login-page';
// Made-up versions, so no real release is named.
const V1 = { vscode: '9.1.0', runtime: '2.3.4', cli: '7.0.1' };
const V2 = { vscode: '9.1.0', runtime: '2.3.4', cli: '7.0.2' };

const lines = (...events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
const result = (sessionId = ID, premiumRequests = 1) => ({ type: 'result', sessionId, exitCode: 0, usage: { premiumRequests } });

function signedIn() {
  const dir = tempFolder('wh-copilot-person-');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ loggedInUsers: [{ host: 'https://github.com', login: 'someone' }] }));
  return dir;
}

// The project's record and its main checkout, whose configuration says this computer runs it on `agent`.
async function projectOn(agent = 'copilot') {
  const checkout = await project();
  onAgent(checkout, agent);
  return checkout;
}
function onAgent(checkout, agent) {
  fs.mkdirSync(path.join(checkout, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(checkout, '.claude', 'wheelhouse.json'), JSON.stringify(projectConfig({ agents: { [computerId()]: agent } })));
}

// A record raised, put in the state as the helper would write it.
function putInState(record) {
  const event = makeEvent({ ...record, now: () => new Date(T0) });
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event)}\n`);
  return event;
}

// The events in the project's state.
const listState = () => listEvents(stateDir(P), { report: () => {} });

// The add-on's record of the versions, in the test's home.
function addOnRecord(home, versions) {
  fs.mkdirSync(path.dirname(versionsFile(home)), { recursive: true });
  fs.writeFileSync(versionsFile(home), JSON.stringify(versions));
}

// Copilot's sessions part switched on, with no kit to fetch, a scratch sign-in, no program started for the versions,
// and `subset` standing in for the safety subset's runner (each call kept in `subset.calls`).
function partWith({ subset = passing(), kits = { manifest: { upstreams: [] } } } = {}) {
  return sessionsPart({
    ready: true, kits, home: { signedInFrom: signedIn(), node: process.execPath, root: ROOT },
    versions: { run: async () => { throw new Error('no copilot is started here'); }, runSubset: subset },
  });
}
function subsetOf(ok) {
  const calls = [];
  const run = async (args) => { calls.push(args); return { ok }; };
  run.calls = calls;
  return run;
}
const passing = () => subsetOf(true);

test('readVersions reads COPILOT_CLI_BINARY_VERSION', () => withHome(async (home) => {
  // No add-on record: the CLI's alone, from a hook's environment, and nothing is started.
  let started = 0;
  const run = async () => { started += 1; return { code: 0, stdout: 'GitHub Copilot CLI 7.0.9.\n' }; };
  assert.deepEqual(await readVersions({ home, env: { COPILOT_CLI_BINARY_VERSION: '7.0.1' }, run }), { vscode: null, runtime: null, cli: '7.0.1' });
  assert.equal(started, 0);
  // The add-on's record, when it is there, names all three.
  addOnRecord(home, V2);
  assert.deepEqual(await readVersions({ home, env: { COPILOT_CLI_BINARY_VERSION: '7.0.1' } }), V2);
  // A field that isn't a version is null, never guessed.
  addOnRecord(home, { vscode: 'latest', runtime: 2, cli: '7.0.2' });
  assert.deepEqual(await readVersions({ home, env: {} }), { vscode: null, runtime: null, cli: '7.0.2' });
  // Neither: `copilot --version` through `run`, asked once per process; without `run`, nothing.
  fs.rmSync(versionsFile(home));
  assert.deepEqual(await readVersions({ home, env: {} }), { vscode: null, runtime: null, cli: null });
  const asked = [];
  const once = async (file, args) => { asked.push([file, ...args]); return { code: 0, stdout: 'GitHub Copilot CLI 7.0.3.\n' }; };
  assert.equal((await readVersions({ home, env: {}, run: once, platform: 'linux' })).cli, '7.0.3');
  assert.equal((await readVersions({ home, env: {}, run: once, platform: 'linux' })).cli, '7.0.3');
  assert.deepEqual(asked, [['copilot', '--version']]);
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

test('the routing table\'s Copilot column is read only in its own shape, and setup pins nothing there (P8-17, P8-22)', () => {
  const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  const read = (over) => readConfig(JSON.stringify({ ...base, ...over }));
  assert.deepEqual(read({ agentRouting: { copilot: { builder: 'model-a', foreman: null } } }).agentRouting, { copilot: { builder: 'model-a', foreman: null } });
  assert.equal(read({}).agentRouting, undefined, 'no column is made up');
  for (const bad of [[], { copilot: [] }, { 'claude-code': { builder: 'model-a' } }, { other: { builder: 'model-a' } }, { copilot: { painter: 'model-a' } }, { copilot: { builder: '-x' } }, { copilot: { builder: 3 } }]) {
    assert.throws(() => read({ agentRouting: bad }), undefined, JSON.stringify(bad));
  }
  // Claude Code's own column is as it was.
  assert.equal(read({ routing: { builder: 'model-a' } }).routing.builder, 'model-a');
});

test('the manifest pins Copilot CLI at the version the code names (P8-18)', () => {
  assert.deepEqual(readManifest().agents, { copilot: { cli: COPILOT_VERSION } });
  assert.deepEqual(AGENT_PINS, { copilot: { cli: COPILOT_VERSION } });
  assert.deepEqual(buildManifest({ roots: {}, version: '1.2.3', upstreams: [] }).agents, { copilot: { cli: COPILOT_VERSION } });
});

test('provenance names the versions', () => withHome(async (home) => {
  await project();
  addOnRecord(home, V1);
  const part = partWith();
  await part.prepare({ project: P, target: `feature-${WORK}` });
  const usageFile = path.join(tempFolder('wh-usage-'), 'usage.json');
  fs.writeFileSync(usageFile, JSON.stringify({ currentModel: 'model-a', totalNanoAiu: 2_500_000_000 }));
  part.afterRun({ stdout: lines(result()), call: { usageFile }, target: `feature-${WORK}`, project: P, at: new Date(T0).toISOString() });

  const found = sessionProvenance({ project: P, sessionId: ID });
  assert.equal(found.agent, 'copilot');
  assert.deepEqual([found.agentVersion, found.editor, found.runtime, found.models, found.claudeCode], ['7.0.1', '9.1.0', '2.3.4', ['model-a'], null]);
  const block = provenanceBlock(found);
  for (const line of ['- Agent: copilot', '- Agent version: 7.0.1', '- Editor: 9.1.0', '- Runtime: 2.3.4', '- Models: model-a']) assert.ok(block.includes(line), line);
  assert.deepEqual(parseProvenance(block), found);

  // The gate compares the agent's version with the manifest's pin for it, not Claude Code's floor.
  const manifest = readManifest();
  const pinned = { ...found, agentVersion: COPILOT_VERSION };
  assert.deepEqual(provenanceMatches(pinned, manifest), { ok: true });
  assert.deepEqual(provenanceMatches({ ...found, agentVersion: '0.0.1' }, manifest), { ok: false, why: WHY.agent });
  assert.deepEqual(provenanceMatches({ ...pinned, agent: 'other' }, manifest), { ok: false, why: WHY.agent });

  // A version not known says so, and still parses; Claude Code's block grows no lines.
  const unknown = provenanceBlock({ ...found, editor: null, runtime: null });
  assert.ok(unknown.includes('- Editor: not known') && unknown.includes('- Runtime: not known'));
  assert.equal(parseProvenance(unknown).editor, null);
  const claude = provenanceBlock({ ...found, agent: undefined });
  assert.ok(!claude.includes('- Agent'));
  assert.equal(parseProvenance(claude).agent, undefined);
  // The four lines come together, or the block can't be read.
  assert.equal(parseProvenance(block.replace('- Runtime: 2.3.4\n', '')), null);
}));

test('a version change runs the subset once', () => withHome(async (home) => {
  await projectOn();
  const subset = passing();
  const part = partWith({ subset });
  addOnRecord(home, V1);
  // Nothing checked yet counts as a change.
  await part.prepare({ project: P, target: 'foreman' });
  assert.deepEqual(subset.calls, [{ versions: V1 }]);
  assert.equal(JSON.parse(fs.readFileSync(seenFile(home), 'utf8')).cli, '7.0.1');
  // The same versions again run nothing.
  await part.prepare({ project: P, target: 'foreman' });
  await part.prepare({ project: P, target: `feature-${WORK}` });
  assert.equal(subset.calls.length, 1);
  // A new CLI runs it once more, before the start.
  addOnRecord(home, V2);
  await part.prepare({ project: P, target: 'foreman' });
  await part.prepare({ project: P, target: 'foreman' });
  assert.deepEqual(subset.calls, [{ versions: V1 }, { versions: V2 }]);
  assert.equal(isHeld(P), false);

  // The check itself: no change passes without running anything; a throw fails.
  const never = async () => { throw new Error('not run'); };
  assert.deepEqual(await copilotVersionCheck({ versions: V1, last: V1, runSubset: never }), { changed: false, ok: true, why: null });
  // A CLI version that couldn't be read is a change every time (review Minor 1).
  const unread = { vscode: null, runtime: null, cli: null };
  assert.equal((await copilotVersionCheck({ versions: unread, last: unread, runSubset: async () => ({ ok: true }) })).changed, true);
  // The hold's words stay within what the record may carry (review Minor 6).
  const long = `7.0.2-${'x'.repeat(60)}`;
  assert.ok(versionWhy({ vscode: long, runtime: long, cli: long }).length <= HOLD_WHY_CHARS);
  assert.doesNotThrow(() => makeEvent({ kind: 'lineage-hold', data: { at: new Date(T0).toISOString(), mismatches: [{ upstream: 'copilot', path: 'cli' }], why: versionWhy({ vscode: long, runtime: long, cli: long }), lifts: VERSION_LIFTS }, now: () => new Date(T0) }));
  const failed = await copilotVersionCheck({ versions: V2, last: V1, runSubset: never });
  assert.equal(failed.ok, false);
  assert.match(failed.why, /Copilot CLI 7\.0\.2 .*hasn't passed Wheelhouse's safety checks/);
}));

// A waker for the Copilot project whose sessions part is `part`: every start is a stand-in kept in `started`, and
// every record raised is kept in `raised` and put in the state, as the helper would write it.
function copilotWaker({ part, dir, raised, started }) {
  return makeWaker({
    shape: 1,
    project: P,
    config: readConfig(JSON.stringify(projectConfig({ agents: { [computerId()]: 'copilot' } }))),
    sessions: part,
    run: (...args) => { started.push(args); return { pid: 100 + started.length, exited: new Promise(() => {}) }; },
    alive: () => false,
    startTimeOf: async () => null,
    now: () => new Date(T0),
    bootedAt: () => 0,
    baseEnv: { PATH: process.env.PATH ?? '', HOME: '/Users/someone' },
    foremanTools: ['Bash(node:*)'],
    print: () => {},
    raise: async (record) => { raised.push(record); putInState(record); },
    onError: () => {},
    windowsBuilds: () => ({ level: 'ask', grants: [], guardedCommand: null }),
    locate: () => dir,
  });
}

test('a failing subset holds Copilot work and raises one card', () => withHome(async (home) => {
  const checkout = await projectOn();
  const dir = makeWorktree(checkout, WORK);
  writeBaseline(P, WORK, dir);
  addOnRecord(home, V2);
  const subset = subsetOf(false);
  const raised = [];
  const started = [];
  const waker = copilotWaker({ part: partWith({ subset }), dir, raised, started });
  for (let n = 0; n < 3; n += 1) await assert.rejects(waker.startFeature({ work: WORK, worktree: dir }), /hasn't passed Wheelhouse's safety checks/);
  assert.equal(started.length, 0, 'no session started');
  assert.equal(subset.calls.length, 1, 'the failed subset is not run again before the watcher starts again');

  // The project is held: its hooks hold edits and commands, and its hold file is the agent's own.
  assert.equal(isHeld(P), true);
  assert.equal(fs.existsSync(agentHoldFile(P, VERSION_HOLD)), true);

  // One lineage-hold record, naming the version and what lifts it, for one card.
  const holds = raised.filter((r) => r.kind === 'lineage-hold');
  assert.equal(holds.length, 1);
  assert.match(holds[0].data.why, /Copilot CLI 7\.0\.2/);
  assert.equal(holds[0].data.lifts, VERSION_LIFTS);
  const views = buildViews(listState(), []);
  assert.equal(holdsDue(views).length, 1);
  const card = holdInput(holdsDue(views)[0]);
  assert.match(card.what, /^Copilot CLI 7\.0\.2 .*hasn't passed Wheelhouse's safety checks, so Copilot work is held\. Edits and commands are held in this project until it passes\.$/);
  assert.equal(card.why, VERSION_LIFTS);

  // A tick (the session start's or the mod's) lifts no hold while the agent's hold file stands.
  const lifted = [];
  const client = { state: { write: async (body) => { lifted.push(body); return { ok: true }; } } };
  assert.equal(await recordLift({ project: P, views, computer: computerId(), now: () => new Date(T0), client }), false);
  assert.deepEqual(lifted, []);

  // A later version that passes lifts the hold, and the waker records the lift itself, so its card closes on a
  // computer with no Claude Code tick (ruling P8-32).
  addOnRecord(home, { ...V2, cli: '7.0.3' });
  const again = copilotWaker({ part: partWith(), dir, raised, started });
  await again.startFeature({ work: WORK, worktree: dir });
  assert.equal(started.length, 1, 'the start goes on');
  assert.equal(isHeld(P), false);
  const lifts = raised.filter((r) => r.kind === 'lineage-lift');
  assert.equal(lifts.length, 1);
  assert.deepEqual(lifts[0].data.holds, [holdsDue(views)[0].id]);
  assert.deepEqual(buildViews(listState(), []).lineageHolds, []);
}));

test('an agent\'s hold counts only while the project runs on that agent, and Claude Code\'s lift clears it (P8-32)', () => withHome(async () => {
  const checkout = await projectOn('copilot');
  holdAgentWork({ project: P, name: VERSION_HOLD, agent: 'copilot', mismatches: [{ upstream: 'copilot', path: 'cli 7.0.2' }], why: versionWhy(V2), lifts: VERSION_LIFTS, now: () => new Date(T0) });
  const hold = putInState({ kind: 'lineage-hold', data: { at: new Date(T0).toISOString(), mismatches: [{ upstream: 'copilot', path: 'cli 7.0.2' }], why: versionWhy(V2), lifts: VERSION_LIFTS } });
  assert.equal(isHeld(P), true);

  // The hook says what holds the work and what lifts it.
  const input = { cwd: checkout, tool_name: 'Write', tool_input: {} };
  const denied = await lineageHold(input, { projectOf: () => ({ project: P }) });
  const reason = denied.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /^Wheelhouse is holding edits and commands: Copilot CLI 7\.0\.2 .*so Copilot work is held\. No click here lifts the hold: .*runs on Claude Code on this computer again\.$/);
  assert.notEqual(reason, HELD);

  // The project goes back to Claude Code here: the hold no longer counts, and Claude Code's lift removes its file and
  // closes its card.
  onAgent(checkout, 'claude-code');
  assert.equal(isHeld(P), false);
  assert.equal(await lineageHold(input, { projectOf: () => ({ project: P }) }), undefined);
  const lifted = [];
  const client = { state: { write: async (body) => { lifted.push(body); return { ok: true }; } } };
  assert.equal(await recordLift({ project: P, views: buildViews(listState(), []), computer: computerId(), now: () => new Date(T0), client }), true);
  assert.equal(fs.existsSync(agentHoldFile(P, VERSION_HOLD)), false);
  assert.deepEqual(lifted.map((b) => [b.kind, b.data.holds]), [['lineage-lift', [hold.id]]]);

  // A configuration that can't be read holds, failing closed.
  onAgent(checkout, 'copilot');
  holdAgentWork({ project: P, name: VERSION_HOLD, agent: 'copilot', mismatches: [{ upstream: 'copilot', path: 'cli 7.0.2' }], now: () => new Date(T0) });
  fs.writeFileSync(path.join(checkout, '.claude', 'wheelhouse.json'), '{ not json');
  assert.equal(isHeld(P), true);
}));

test('a kit that differs writes the project\'s kit hold, so no tick lifts its card early', () => withHome(async () => {
  await projectOn();
  const upstream = { name: 'kit-a', plugin: 'kit-a', repo: 'https://example.invalid/kit-a.git', ref: 'v1', sha: 'a'.repeat(40), folders: [{ path: 'skills/one', hash: '0'.repeat(64) }], files: [] };
  const fetchTo = async (_, into) => {
    fs.mkdirSync(path.join(into, 'skills', 'one'), { recursive: true });
    fs.writeFileSync(path.join(into, 'skills', 'one', 'SKILL.md'), 'Not the pinned text.\n');
  };
  const part = partWith({ kits: { manifest: { upstreams: [upstream] }, fetchTo } });
  const error = await part.prepare({ project: P, target: 'foreman' }).then(() => null, (e) => e);
  assert.match(error.message, /don't match Wheelhouse's manifest/);
  assert.equal(error.records.length, 1);
  assert.equal(error.records[0].data.lifts, KITS_LIFTS, 'the card says what lifts the kit hold');
  assert.doesNotThrow(() => makeEvent({ ...error.records[0], now: () => new Date(T0) }));
  assert.equal(fs.existsSync(agentHoldFile(P, KITS_HOLD)), true);
  assert.equal(isHeld(P), true);
  // Once the record is in the state, a later refusal raises it no more.
  error.raised();
  const again = await part.prepare({ project: P, target: 'foreman' }).then(() => null, (e) => e);
  assert.deepEqual(again.records, []);
  // Kits that match lift it.
  await partWith().prepare({ project: P, target: 'foreman' });
  assert.equal(isHeld(P), false);
}));

test('usage reads credits when the output has them and says so when it doesn\'t', () => withHome(async () => {
  await project();
  const part = partWith();
  const at = new Date(T0).toISOString();
  const dir = tempFolder('wh-usage-');
  // A foreman run whose usage file gives its credits (in billionths), and a builder's whose output gives none.
  const withCredits = path.join(dir, 'a.json');
  fs.writeFileSync(withCredits, JSON.stringify({ totalNanoAiu: 3_000_000_000, totalPremiumRequestCost: 2, tokenDetails: { input: { tokenCount: 10 } } }));
  part.afterRun({ stdout: lines(result('sess-a')), call: { usageFile: withCredits }, target: 'foreman', project: P, at });
  part.afterRun({ stdout: lines(result('sess-b', null)), call: { usageFile: path.join(dir, 'none.json') }, target: `feature-${WORK}`, project: P, at });

  const figures = usageFigures({ project: P, now: () => new Date(T0 + 60_000) });
  assert.equal(figures.byPart.foreman.credits, 3);
  assert.equal(figures.byPart.feature.credits, null, 'no run gave a figure: not available, not 0');
  assert.equal(figures.week.credits, 3);
  assert.deepEqual(figures.byPart.foreman.tokens, null, 'the tokens path is unchanged');
  // Copilot's words take the place of the allowance and token lines.
  assert.equal(figures.missing.length, 1);
  assert.match(figures.missing[0], /this session's use, summed over the sessions Wheelhouse started/);
  assert.equal(typeof figures.words.note, 'string');
  // A run's count of premium requests and the usage file's premium cost are kept apart (review Minor 9).
  const kept = fs.readFileSync(path.join(usageDir(), 'records', `${at.slice(0, 10)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(kept.map((r) => [r.session, r.premiumRequests, r.premiumCost]), [['sess-a', 1, 2], ['sess-b', null, null]]);

  // A project with no such runs reads as it always has.
  const other = usageFigures({ project: 'o__other', now: () => new Date(T0 + 60_000) });
  assert.equal(Object.hasOwn(other.byPart.foreman, 'credits'), false);
  assert.equal(Object.hasOwn(other, 'words'), false);
}));

test('a project on Copilot shows no share or allowance window, though Claude\'s allowance is readable here (P8-32)', () => withHome(async () => {
  await projectOn();
  // The Claude account's allowance, as the mod reads it, with a window that resets in two days.
  const resetsAt = new Date(T0 + 2 * 86_400_000).toISOString();
  recordAllowance({ windows: [{ kind: 'seven_day', percentUsed: 41, resetsAt }], at: new Date(T0).toISOString(), now: new Date(T0) });
  const now = () => new Date(T0 + 60_000);

  const claude = usageFigures({ project: P, now });
  assert.equal(claude.week.share, 41, 'Claude Code\'s projects read it as before');
  assert.equal(claude.week.to, resetsAt);

  const figures = usageFigures({ project: P, now, agent: 'copilot' });
  assert.deepEqual([figures.week.share, figures.week.shareAt], [null, null]);
  assert.equal(figures.week.to, now().toISOString(), 'the last seven days, not the allowance\'s window');
  assert.equal(figures.missing.some((line) => /weekly allowance shows/.test(line)), false);

  // Neither the board nor the briefing says a share of it.
  const { model, text } = boardText(figures);
  assert.doesNotMatch(text, /weekly allowance/);
  assert.equal(model.director.budget.share, null);
  const briefing = briefingModel({ model, usage: figures, sources: {}, since: null, now: () => new Date(T0) });
  assert.doesNotMatch(JSON.stringify(briefing), /weekly allowance/);
  // With the share, Claude Code's board says it, so the test would see one.
  assert.match(boardText(claude).text, /41% of your weekly allowance/);
}));

test('unusual use works on credits where there are no tokens', () => withHome(async () => {
  await project();
  const part = partWith();
  const dir = tempFolder('wh-usage-');
  // Five ordinary foreman runs and one that used ten times as much, each its own session.
  for (const [n, nano] of [[1, 1e9], [2, 1e9], [3, 1e9], [4, 1e9], [5, 1e9], [6, 10e9]]) {
    const file = path.join(dir, `${n}.json`);
    fs.writeFileSync(file, JSON.stringify({ totalNanoAiu: nano }));
    part.afterRun({ stdout: lines(result(`sess-${n}`)), call: { usageFile: file }, target: 'foreman', project: P, at: new Date(T0 + n * 1000).toISOString() });
  }
  const { unusual } = usageFigures({ project: P, now: () => new Date(T0 + 60_000) });
  const session = unusual.find((u) => u.kind === 'session');
  assert.deepEqual([session.id, session.unit, session.tokens, session.median], ['session:sess-6', 'credits', 10, 1]);
  const { text } = boardText({ ...figuresWith(), unusual });
  assert.match(text, /One session used 10 credits, against a usual 1 credit/);
}));

// A board model with these usage figures, rendered whole (both tabs).
function boardText(usage) {
  const model = boardModel({ project: P, views: {}, events: [], usage, health: [], settings: {}, sources: {}, now: () => new Date(T0) });
  return { model, text: `${renderBoard(model)}\n${renderBoard(model, { tab: 'build' })}` };
}
const figuresWith = (over = {}) => ({
  week: { from: new Date(T0 - 6 * 86_400_000).toISOString(), to: new Date(T0).toISOString(), tokens: null, usd: null, credits: 3, share: null, shareAt: null },
  byPart: { 'front-desk': { tokens: null, usd: null, credits: null }, foreman: { tokens: null, usd: null, credits: 3 }, feature: { tokens: null, usd: null, credits: null } },
  bySubagents: { tokens: 0 },
  byFeature: {},
  unusual: [],
  missing: ['Copilot\'s use is counted session by session: this session\'s use, summed over the sessions Wheelhouse started. Sessions you start yourself aren\'t counted, and no month\'s total or allowance is shown, as Copilot doesn\'t give one to read'],
  words: { note: 'Each part\'s credits are the sessions Wheelhouse started, each counted as this session\'s use; sessions you start yourself aren\'t in them' },
  ...over,
});

test('a missing usage field shows as not available, not zero', () => {
  const { model, text } = boardText(figuresWith());
  assert.equal(model.build.usage.feature.credits, null);
  assert.equal(model.build.usage.foreman.credits, 3);
  assert.match(text, /Feature builders: credits not available/);
  assert.match(text, /Foreman: 3 credits/);
  assert.doesNotMatch(text, /0 credits/);
});

test('the board claims no whole-month figure', () => {
  const { text } = boardText(figuresWith());
  assert.match(text, /the sessions Wheelhouse started/);
  assert.match(text, /this session's use/);
  assert.doesNotMatch(text, /weekly allowance/);
  assert.doesNotMatch(text, /(this|a|the) month(?!'s total or allowance is shown)/i, 'no month is claimed');
  assert.doesNotMatch(text, /\d[^.]*\bmonth/i, 'no figure for a month');
});

test('none of the real copilot, gh or glab ran', () => {
  assert.deepEqual(stand.calls(), []);
});
