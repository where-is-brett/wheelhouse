// tests/scripts/agents/copilot/sessions.test.js
// Copilot's sessions part (adapters/copilot/sessions.js, design section 8, part 7): the calls it builds, the one command the
// foreman may run, the level checked before its rules, no model passed on an Auto-only plan with the model Auto chose read
// from the output, the version check before every start, and the waker driven with the part. No Copilot program is run
// (a stand-in file stands where the waker looks for one), and no request is spent.
import '../../../helpers/homes.js';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localKits } from '../../../helpers/copilot-kits.js';
import { withHome, tempFolder } from '../../../helpers/homes.js';
import { standInTools } from '../../../helpers/host-stand-ins.js';
import { guardedRun } from '../../../helpers/stood-in.js';
import { P, T0, config as projectConfig, project } from '../../../helpers/foreman.js';
import sessions, {
  FOREMAN_RULES_FILE, WAITING_WHY, WIDE_FLAGS, afterRun, copilotSessionEnv, featureRules, foremanAllow, sessionArgs, sessionHome, sessionsPart,
} from '../../../../adapters/copilot/sessions.js';
import copilot from '../../../../adapters/copilot/index.js';
import { COPILOT_VERSION } from '../../../../scripts/agents/copilot/numbers.js';
import { readLedger } from '../../../../scripts/agents/copilot/usage.js';
import { PLUGIN_ROOT, foremanCommands } from '../../../../scripts/foreman/tools.js';
import { readConfig } from '../../../../scripts/gate/guardrails.js';
import { featurePaths } from '../../../../scripts/feature/files.js';
import { isHeld, provenanceFile, readAgentHold } from '../../../../scripts/lineage/check.js';
import { makeEvent } from '../../../../scripts/state/events.js';
import { makeWaker } from '../../../../scripts/watcher/waker.js';
import { readBaseline, writeBaseline } from '../../../../scripts/watcher/control-files.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const NODE = process.execPath;
const hostStandIns = standInTools();
after(() => hostStandIns.restore());

// A signed-in Copilot home for the sessions' homes to take the sign-in from, and the pinned kits as local folders.
function signedIn() {
  const dir = tempFolder('wh-copilot-signed-in-');
  fs.writeFileSync(path.join(dir, 'config.json'), '// User settings\n{"loggedInUsers":[{"host":"https://github.com","login":"someone"}],"trustedFolders":["/anywhere"]}\n');
  return dir;
}

const AT_PIN = { COPILOT_CLI_BINARY_VERSION: COPILOT_VERSION };
// A part switched on, with nothing fetched or run for real.
function part(over = {}) {
  const { kits } = localKits();
  return sessionsPart({
    ready: true, kits, home: { signedInFrom: signedIn(), node: NODE, root: ROOT }, versions: { env: AT_PIN, run: guardedRun(async () => ({ code: 0, stdout: '', stderr: '' })) }, ...over,
  });
}

const CONFIG = { webDomains: [] };
const flagsOf = (args, name) => args.filter((arg) => arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1));
const valueOf = (args, name) => args[args.indexOf(name) + 1];
const LEVEL_INPUTS = (over = {}) => ({ level: 'ask', grants: [], worktree: path.join(tempFolder('wh-copilot-wt-'), 'wt'), realUsers: true, hostApproval: false, keysUnreadable: false, unattendedConfirmed: false, ...over });
const COPILOT_ON_PATH = () => {
  const bin = tempFolder('wh-copilot-bin-');
  fs.writeFileSync(path.join(bin, 'copilot'), '', { mode: 0o755 });
  return bin;
};

// ---- The foreman's one command ----

test("the foreman's allow rule is the one command its record names, with the folder Wheelhouse is in", () => {
  // The rule is the wake script's launcher by its bare name, wherever Wheelhouse is, on either system.
  assert.deepEqual(foremanAllow({ pluginRoot: '/plugins/wheelhouse', platform: 'darwin' }), ['shell(wh-wake:*)']);
  assert.deepEqual(foremanAllow({ pluginRoot: 'C:\\Wheelhouse', platform: 'win32' }), ['shell(wh-wake:*)']);
  // The rule is the command the foreman's playbook is shown to a Copilot session, with the pattern's own ending.
  assert.deepEqual(foremanAllow(), [`shell(${foremanCommands(undefined, { launchers: true }).wake}:*)`]);
});

test('a rule record that allows more, less or another command than the wake script refuses the start', () => {
  const dir = tempFolder('wh-copilot-rules-');
  const record = JSON.parse(fs.readFileSync(FOREMAN_RULES_FILE, 'utf8'));
  assert.deepEqual(record.allow, ['wh-wake:*'], 'the committed record holds the wake script and nothing else');
  const write = (value) => {
    const file = path.join(dir, 'rules.json');
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };
  for (const bad of [
    { ...record, allow: [...record.allow, 'wh-act:*'] },
    { ...record, allow: [] },
    { ...record, allow: ['node:*'] },
    { ...record, allow: ['wh-act:*'] },
    { ...record, allow: ["node '<wheelhouse-root>/scripts/foreman/wake.js':*"] },
    { ...record, agent: 'wheelhouse-builder' },
    'not json',
  ]) {
    assert.throws(() => foremanAllow({ rulesFile: write(bad) }), /foreman's rule record/);
  }
  assert.throws(() => foremanAllow({ rulesFile: path.join(dir, 'missing.json') }), /can't be read/);
});

test("the foreman's call carries that one rule and no write, a session id given up front, and no model", () => withHome(async () => {
  const on = part();
  await on.prepare({ project: P, target: 'foreman' });
  const call = on.foremanCall({
    config: { ...CONFIG, routing: { foreman: 'model-a' }, agentRouting: { copilot: { foreman: 'model-b' } } }, project: P, prompt: 'Wheelhouse: read the wake.', sessionId: 'a1b2c3d4-0000-4000-8000-000000000001',
    tools: ['Read', 'Bash(x:*)'], pluginRoot: '/plugins/wheelhouse', platform: 'darwin', copilot: { kind: 'direct', file: '/bin/copilot' },
    env: { PATH: '/bin', HOME: '/h', COPILOT_MODEL: 'model-z', COPILOT_ALLOW_ALL: '1', GH_TOKEN: 'secret', WHEELHOUSE_HOME: '/wh' },
  });
  assert.equal(call.file, '/bin/copilot');
  assert.deepEqual(flagsOf(call.args, '--allow-tool'), ['shell(wh-wake:*)']);
  assert.deepEqual(flagsOf(call.args, '--deny-tool'), []);
  assert.equal(valueOf(call.args, '--session-id'), 'a1b2c3d4-0000-4000-8000-000000000001');
  assert.equal(valueOf(call.args, '--agent'), 'wheelhouse-foreman');
  assert.equal(valueOf(call.args, '-p'), 'Wheelhouse: read the wake.');
  for (const flag of ['--model', '--resume', '--trust-folder', '--allow-all', '--yolo', '--add-dir']) assert.equal(call.args.some((a) => a === flag || a.startsWith(`${flag}=`)), false, flag);
  for (const flag of ['--no-ask-user', '--disallow-temp-dir', '--output-format']) assert.ok(call.args.includes(flag), flag);
  assert.equal(call.env.COPILOT_HOME, sessionHome(P, 'foreman'));
  assert.deepEqual(Object.keys(call.env).sort(), ['COPILOT_HOME', 'HOME', 'PATH', 'WHEELHOUSE_HOME', 'WHEELHOUSE_LAUNCHER_SESSION']);
  assert.equal(call.input, '');
  assert.equal(call.idFromRun, undefined, 'the id is given, not read from the run');
  assert.equal(call.output, call.activityFile);
  assert.throws(() => on.foremanCall({ config: CONFIG, project: P, prompt: 'x', long: true, copilot: { kind: 'direct', file: '/bin/copilot' } }), /one wake at a time/);
  assert.throws(() => on.checkForeman({ watcherShape: 2 }), /second shape/);
}));

test('a call is refused until its session home holds the guards', () => withHome(async () => {
  assert.throws(() => part().foremanCall({ config: CONFIG, project: P, prompt: 'x', copilot: { kind: 'direct', file: '/bin/copilot' } }), /no Wheelhouse hook file/);
}));

// ---- No model on an Auto-only plan ----

test('on an Auto-only plan no call passes a model or COPILOT_MODEL, whatever the configuration holds', () => withHome(async () => {
  const on = part();
  await on.prepare({ project: P, target: 'feature-login' });
  const config = { ...CONFIG, routing: { feature: 'model-a', builder: 'model-b' }, agentRouting: { copilot: { builder: 'model-c' } } };
  const inputs = { config, project: P, work: 'login', prompt: 'Read the brief.', env: { PATH: '/bin', COPILOT_MODEL: 'model-z' }, copilot: { kind: 'direct', file: '/bin/copilot' }, model: 'model-d', effort: 'high', fallback: 'model-e', ...LEVEL_INPUTS() };
  for (const call of [on.featureStartCall({ ...inputs, sessionId: 'a1b2c3d4-0000-4000-8000-000000000002' }), on.featureResumeCall({ ...inputs, sessionId: 'a1b2c3d4-0000-4000-8000-000000000002' })]) {
    assert.equal(call.args.includes('--model'), false);
    assert.equal(call.args.some((a) => a.includes('model-')), false);
    assert.equal('COPILOT_MODEL' in call.env, false);
    assert.equal(call.args.includes('--reasoning-effort'), false, 'no effort either: whether Auto honours one is still open');
  }
  // A plan name that isn't known is taken as Auto-only.
  const odd = part({ plan: 'something-else' });
  assert.equal(odd.featureStartCall({ ...inputs, sessionId: 'a1b2c3d4-0000-4000-8000-000000000002' }).args.includes('--model'), false);
}));

test("on a plan with model choice the Copilot column's model is passed, and one that can't be is refused at the check", () => withHome(async () => {
  const on = part({ plan: 'credits' });
  await on.prepare({ project: P, target: 'feature-login' });
  const config = { ...CONFIG, agentRouting: { copilot: { builder: 'model-c' } } };
  const call = on.featureStartCall({ config, project: P, work: 'login', prompt: 'Go.', sessionId: 'a1b2c3d4-0000-4000-8000-000000000003', env: { PATH: '/bin' }, copilot: { kind: 'direct', file: '/bin/copilot' }, ...LEVEL_INPUTS() });
  assert.equal(valueOf(call.args, '--model'), 'model-c');
  assert.equal('COPILOT_MODEL' in call.env, false, 'never by the environment');
  assert.throws(() => on.checkFeature({ agentRouting: { copilot: { builder: '--yolo' } } }), /can't be passed to copilot/);
  assert.throws(() => on.checkForeman({ agentRouting: { copilot: { foreman: 'a model' } } }), /can't be passed to copilot/);
  assert.doesNotThrow(() => part().checkFeature({ agentRouting: { copilot: { builder: '--yolo' } } }), 'nothing is read on an Auto-only plan');
}));

test('no argument starts a session trusted or with every permission, whatever a caller passes', () => {
  const base = { prompt: 'Go.', logDir: '/l', usageFile: '/u.json', role: 'builder' };
  assert.equal(sessionArgs({ ...base, sessionId: 'abc' }).includes('--session-id'), true);
  for (const wide of WIDE_FLAGS) {
    assert.throws(() => sessionArgs({ ...base, model: wide }), /never started trusted or with every permission given/, wide);
    assert.throws(() => sessionArgs({ ...base, sessionId: wide }), /never started trusted/, wide);
  }
  // The prompt is the one argument not read as a flag, and a call refuses one that starts with a dash anyway.
  assert.doesNotThrow(() => sessionArgs({ ...base, prompt: '--yolo' }));
  assert.deepEqual(copilotSessionEnv({ PATH: '/bin', COPILOT_MODEL: 'm', GH_TOKEN: 't' }, { home: '/h', binDir: '/wh/bin' }), { PATH: '/wh/bin:/bin', WHEELHOUSE_LAUNCHER_SESSION: '1', COPILOT_HOME: '/h' });
  // On Windows the folder goes first under the PATH's own spelling, with that system's separator.
  assert.deepEqual(copilotSessionEnv({ Path: 'C:\\npm' }, { home: 'C:\\h', binDir: 'C:\\wh\\bin', platform: 'win32' }), { Path: 'C:\\wh\\bin;C:\\npm', WHEELHOUSE_LAUNCHER_SESSION: '1', COPILOT_HOME: 'C:\\h' });
});

// ---- The level is checked before its rules ----

test("levelAllowed is asked first: a level that may not run gets Ask's rules, never its own", () => {
  const shellAllowed = (r) => r.allow.includes('shell');
  const base = { config: CONFIG, grants: [], platform: 'darwin', worktree: LEVEL_INPUTS().worktree };
  // Unattended with real users, and with no click on its own card.
  for (const over of [{ realUsers: true, unattendedConfirmed: true }, { realUsers: false, unattendedConfirmed: false }, {}]) {
    const got = featureRules({ ...base, level: 'unattended', ...over });
    assert.equal(got.level, 'ask');
    assert.equal(shellAllowed(got.rules), false);
  }
  // Both given: it runs, and the shell is allowed whole.
  const open = featureRules({ ...base, level: 'unattended', realUsers: false, unattendedConfirmed: true });
  assert.equal(open.level, 'unattended');
  assert.equal(shellAllowed(open.rules), true);
  // The sandbox has not passed its test on this computer (the switch is off), Guarded runs only on Windows, and a level not
  // known is Ask.
  assert.equal(featureRules({ ...base, level: 'sandbox' }).level, 'ask');
  assert.equal(featureRules({ ...base, level: 'guarded', keysUnreadable: true }).level, 'ask');
  for (const level of ['nonsense', undefined, null]) assert.equal(featureRules({ ...base, level }).level, 'ask');
  assert.equal(shellAllowed(featureRules({ ...base, level: 'sandbox' }).rules), false);
});

test("a feature call carries the level levelAllowed lets run, and a grant for a command the configuration doesn't list counts for nothing", () => withHome(async () => {
  const on = part();
  await on.prepare({ project: P, target: 'feature-login' });
  const call = on.featureStartCall({
    config: CONFIG, project: P, work: 'login', prompt: 'Go.', sessionId: 'a1b2c3d4-0000-4000-8000-000000000004', env: { PATH: '/bin' }, copilot: { kind: 'direct', file: '/bin/copilot' },
    ...LEVEL_INPUTS({ level: 'unattended', realUsers: true, grants: [{ scope: 'feature', commands: ['rm -rf /'] }] }),
  });
  assert.equal(call.level, 'ask');
  assert.equal(flagsOf(call.args, '--allow-tool').includes('shell'), false);
  assert.equal(flagsOf(call.args, '--allow-tool').some((rule) => rule.includes('rm -rf')), false);
  assert.ok(flagsOf(call.args, '--deny-tool').includes('shell(copilot:*)'), 'a copilot of its own is refused at every level');
  assert.ok(flagsOf(call.args, '--deny-tool').some((rule) => rule.startsWith('write(')), 'the write denies are passed');
}));

// ---- Start and resume ----

test('a feature starts under the waker\'s session id, and a wake resumes that id in the same home', () => withHome(async () => {
  const on = part();
  await on.prepare({ project: P, target: 'feature-login' });
  const shared = { config: CONFIG, project: P, work: 'login', prompt: 'Read it.', env: { PATH: '/bin' }, copilot: { kind: 'direct', file: '/bin/copilot' }, ...LEVEL_INPUTS() };
  const id = 'a1b2c3d4-0000-4000-8000-000000000005';
  const start = on.featureStartCall({ ...shared, sessionId: id });
  const resume = on.featureResumeCall({ ...shared, sessionId: id });
  assert.equal(valueOf(start.args, '--session-id'), id);
  assert.equal(flagsOf(start.args, '--resume').length, 0);
  assert.deepEqual(flagsOf(resume.args, '--resume'), [id]);
  assert.equal(resume.args.includes('--session-id'), false);
  assert.equal(start.env.COPILOT_HOME, resume.env.COPILOT_HOME);
  assert.equal(start.activityFile, resume.activityFile, 'a session\'s wakes append to one record');
  assert.equal(valueOf(start.args, '--agent'), 'wheelhouse-builder');
  assert.notEqual(start.usageFile, resume.usageFile, 'each run has its own usage file');
  assert.throws(() => on.featureResumeCall({ ...shared }), /needs the session id/);
  assert.throws(() => on.featureResumeCall({ ...shared, sessionId: '../x' }), /can't be used as a session id/);
}));

test('through a .cmd shim the whole line is quoted, and one cmd.exe would change is refused', () => withHome(async () => {
  const on = part();
  await on.prepare({ project: P, target: 'foreman' });
  const call = on.foremanCall({ config: CONFIG, project: P, prompt: 'Wheelhouse: read the wake.', pluginRoot: 'C:\\Wheelhouse', platform: 'win32', copilot: { kind: 'cmd', file: 'C:\\npm\\copilot.cmd' }, env: { PATH: 'C:\\npm' } });
  assert.equal(call.file, 'cmd.exe');
  assert.equal(call.verbatim, true);
  assert.match(call.args[3], /^".*copilot\.cmd.*"$/);
  assert.throws(() => on.foremanCall({ config: CONFIG, project: P, prompt: '100% done', pluginRoot: 'C:\\Wheelhouse', platform: 'win32', copilot: { kind: 'cmd', file: 'C:\\npm\\copilot.cmd' } }), /through a \.cmd program safely/);
}));

// ---- Switched off ----

test('the part as shipped is switched off: every check, call and prepare refuses while BACKGROUND_SESSIONS_READY is off', async () => {
  assert.equal(copilot.sessions, sessions);
  assert.throws(() => sessions.checkForeman(CONFIG), /aren't switched on/);
  assert.throws(() => sessions.checkFeature(CONFIG), /aren't switched on/);
  assert.throws(() => sessions.foremanCall({ config: CONFIG, project: P, prompt: 'x' }), /aren't switched on/);
  assert.throws(() => sessions.featureStartCall({}), /aren't switched on/);
  assert.throws(() => sessions.featureResumeCall({}), /aren't switched on/);
  await assert.rejects(sessions.prepare({ project: P, target: 'foreman' }), /aren't switched on/);
});

// ---- The version check before every start ----

test('a CLI at the pinned version starts, and one that differs is held with the lineage hold\'s record', () => withHome(async () => {
  const ok = part();
  assert.deepEqual(await ok.prepare({ project: P, target: 'foreman' }), { lifted: false });
  assert.ok(fs.existsSync(path.join(sessionHome(P, 'foreman'), 'hooks', 'wheelhouse.json')), 'its home was written');

  const other = part({ versions: { env: { COPILOT_CLI_BINARY_VERSION: '9.9.9' }, run: guardedRun(async () => ({ code: 0 })) } });
  await assert.rejects(other.prepare({ project: P, target: 'foreman' }), (error) => {
    assert.match(error.message, /Copilot CLI 9\.9\.9 .* isn't the version Wheelhouse has tested.*no Copilot session is started until it passes/s);
    assert.equal(error.records[0].kind, 'lineage-hold');
    assert.equal(typeof error.raised, 'function');
    return true;
  });
  assert.equal(isHeld(P), true);
  assert.notEqual(readAgentHold(P, 'copilot-version'), null);
  // Back at the pin, the hold lifts, and the start says so.
  assert.deepEqual(await ok.prepare({ project: P, target: 'foreman' }), { lifted: true });
  assert.equal(readAgentHold(P, 'copilot-version'), null);
}));

test('a CLI whose version can\'t be read fails closed: no start, and the home is not written', () => withHome(async () => {
  const log = [];
  const silent = part({ versions: { env: { PATH: COPILOT_ON_PATH() }, platform: 'linux', run: guardedRun(async () => ({ code: 0, stdout: '1.0.105\n' }), { log }) } });
  await assert.rejects(silent.prepare({ project: P, target: 'foreman' }), /isn't the version Wheelhouse has tested/);
  assert.equal(fs.existsSync(sessionHome(P, 'foreman')), false);
  assert.deepEqual(log, ['copilot --version'], 'it asked the program, and the stand-in refused');
}));

test('a newer CLI that passes the safety subset starts', () => withHome(async () => {
  const subsets = [];
  const newer = part({ versions: { env: { COPILOT_CLI_BINARY_VERSION: '9.9.9' }, runSubset: async ({ versions }) => { subsets.push(versions.cli); return { ok: true }; } } });
  await newer.prepare({ project: P, target: 'foreman' });
  assert.deepEqual(subsets, ['9.9.9']);
}));

// ---- What a run leaves ----

const line = (event) => JSON.stringify(event);
const RUN = [
  line({ type: 'session.auto_mode_resolved', data: { chosenModel: 'model-a', availableModels: ['model-a'] } }),
  line({ type: 'tool.execution_start', data: { toolCallId: '1', toolName: 'bash', arguments: { command: 'ls' } } }),
  line({ type: 'tool.execution_complete', data: { toolCallId: '1', success: false, error: { code: 'denied', message: 'Denied by preToolUse hook: no' } } }),
  line({ type: 'assistant.message', data: { content: 'Done.' } }),
  line({ type: 'result', sessionId: 'sess-1', exitCode: 0, usage: { premiumRequests: 1 } }),
].join('\n');

test('a run that finished settles done, and its record names the model Auto chose', () => withHome(async () => {
  const usageFile = path.join(tempFolder('wh-copilot-usage-'), 'u.json');
  fs.writeFileSync(usageFile, JSON.stringify({ totalPremiumRequestCost: 1, totalNanoAiu: 5e8, tokenDetails: { input: { tokenCount: 6 } }, currentModel: 'model-z' }));
  const result = afterRun({ stdout: RUN, call: { usageFile }, target: 'feature-login', project: P, versions: { cli: COPILOT_VERSION, vscode: null, runtime: null }, at: '2026-11-11T01:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, 'sess-1');
  const [activity, note] = result.records;
  assert.equal(activity.kind, 'activity');
  assert.equal(activity.data.usage.model, 'model-a', 'the output\'s choice, not the usage file\'s current model');
  assert.equal(activity.data.work, 'login');
  assert.deepEqual(activity.data.tools, { bash: 1 });
  assert.deepEqual(activity.data.refusals, [{ tool: 'bash', kind: 'guard' }]);
  assert.equal(activity.data.usage.premiumRequests, 1);
  assert.equal(note.kind, 'note');
  assert.doesNotThrow(() => makeEvent({ kind: 'activity', data: activity.data }), 'the state accepts the record');
  assert.deepEqual(readLedger().map(({ session, requests, model }) => ({ session, requests, model })), [{ session: 'sess-1', requests: 1, model: 'model-a' }]);
  const provenance = JSON.parse(fs.readFileSync(provenanceFile(P, 'sess-1'), 'utf8'));
  assert.deepEqual([provenance.agent, provenance.agentVersion, provenance.models], ['copilot', COPILOT_VERSION, ['model-a']]);
}));

test('the model comes from the usage file when the output names none, and is none when neither does', () => withHome(async () => {
  const usageFile = path.join(tempFolder('wh-copilot-usage-'), 'u.json');
  fs.writeFileSync(usageFile, JSON.stringify({ currentModel: 'model-z' }));
  const bare = line({ type: 'result', sessionId: 'sess-2', exitCode: 0, usage: { premiumRequests: 1 } });
  assert.equal(afterRun({ stdout: bare, call: { usageFile }, target: 'foreman' }).records[0].data.usage.model, 'model-z');
  assert.equal(afterRun({ stdout: bare, call: {}, target: 'foreman' }).records[0].data.usage.model, null);
  // A model name that isn't a plain one (the fixtures' placeholders) is not kept.
  assert.equal(afterRun({ stdout: [line({ type: 'session.auto_mode_resolved', data: { chosenModel: '<MODEL>' } }), bare].join('\n'), call: {}, target: 'foreman' }).records[0].data.usage.model, null);
}));

test('a run with no result failed, whatever its exit code said, and an ordinary failure is not "waiting for the month"', () => withHome(async () => {
  const died = afterRun({ stdout: line({ type: 'assistant.message', data: { content: 'Half' } }), code: 0, target: 'feature-login', project: P });
  assert.equal(died.ok, false);
  assert.equal(died.waiting, undefined);
  assert.match(died.why, /ended without a result/);
  assert.deepEqual(readLedger(), []);
}));

test('a run GitHub refused for the month settles as waiting and goes in the ledger as a refusal, never as a fault', () => withHome(async () => {
  const refused = afterRun({ stdout: 'Error: You have exceeded your monthly quota of premium requests.\n', code: 1, call: { sessionId: 'sess-3' }, target: 'feature-login', project: P, at: '2026-11-11T01:00:00.000Z' });
  assert.deepEqual([refused.ok, refused.waiting, refused.why], [false, true, WAITING_WHY]);
  assert.equal(refused.records[0].kind, 'activity');
  assert.deepEqual(readLedger().map(({ refused: r, session }) => ({ refused: r, session })), [{ refused: true, session: 'sess-3' }]);
  // The words of a finished run that merely mention a limit are not a refusal.
  assert.equal(afterRun({ stdout: [line({ type: 'assistant.message', data: { content: 'The quota was exceeded in the test.' } }), line({ type: 'result', sessionId: 'sess-4', exitCode: 0 })].join('\n'), target: 'foreman' }).ok, true);
}));

test('activity older than thirty days is pruned, and a link refuses the prune', () => withHome(async () => {
  const on = part();
  await on.prepare({ project: P, target: 'foreman' });
  const dir = path.join(path.dirname(sessionHome(P, 'foreman')), '..', 'activity');
  fs.writeFileSync(path.join(dir, 'old.jsonl'), '{}\n');
  fs.writeFileSync(path.join(dir, 'new.jsonl'), '{}\n');
  const old = new Date(T0 - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(dir, 'old.jsonl'), old, old);
  assert.deepEqual(on.pruneActivity({ project: P, now: () => new Date(T0) }), ['old.jsonl']);
  assert.deepEqual(fs.readdirSync(dir), ['new.jsonl']);
}));

// ---- The waker, driven with the part ----

const configOf = (over = {}) => readConfig(JSON.stringify(projectConfig(over)));

test('the waker starts a Copilot foreman and a feature, and resumes a feature that died, with no model passed', () => withHome(async () => {
  const checkout = await project();
  const worktree = path.join(checkout, '.claude', 'worktrees', 'wt-1');
  fs.mkdirSync(featurePaths(worktree).dir, { recursive: true });
  fs.writeFileSync(featurePaths(worktree).brief, 'The brief.\n');
  const calls = [];
  let alive = true;
  const w = makeWaker({
    shape: 1, project: P, config: configOf(), sessions: part(), run: (file, args, options) => { calls.push({ file, args, ...options }); return { pid: 100 + calls.length }; },
    alive: () => alive, startTimeOf: async () => null, now: () => new Date(T0), bootedAt: () => 0, claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: COPILOT_ON_PATH(), HOME: '/h', COPILOT_MODEL: 'model-z' }, print: () => {}, onError: () => {}, locate: () => worktree,
  });
  if (readBaseline(P, 'login-page', worktree) === null) writeBaseline(P, 'login-page', worktree);

  const started = await w.startFeature({ work: 'login-page', worktree, briefFile: featurePaths(worktree).brief });
  assert.equal(calls.length, 1);
  const [first] = calls;
  assert.equal(path.basename(first.file), 'copilot');
  assert.equal(valueOf(first.args, '--session-id'), started.sessionId, 'the id the waker keeps is the one given to Copilot');
  assert.equal(valueOf(first.args, '--agent'), 'wheelhouse-builder');
  assert.equal(first.args.includes('--model'), false);
  assert.equal('COPILOT_MODEL' in first.env, false);
  assert.equal(first.env.COPILOT_HOME, sessionHome(P, 'feature-login-page'));
  assert.equal(first.cwd, worktree);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(first.output), '..', 'watcher', 'sessions', 'login-page.json'), 'utf8')).sessionId, started.sessionId);

  // It dies mid-run: the watcher's crash resume starts it again by its kept id, in the same home.
  alive = false;
  const resumed = await w.resumeFeature({ work: 'login-page', prompt: "Carry on from what's there." });
  assert.equal(calls.length, 2);
  const second = calls[1];
  assert.deepEqual(flagsOf(second.args, '--resume'), [started.sessionId]);
  assert.equal(second.args.includes('--session-id'), false);
  assert.equal(second.args.includes('--model'), false);
  assert.equal(second.env.COPILOT_HOME, first.env.COPILOT_HOME);
  assert.equal(valueOf(second.args, '-p'), "Carry on from what's there.");
  assert.equal(resumed.sessionId, started.sessionId);
  assert.equal(second.output, first.output);
}));
