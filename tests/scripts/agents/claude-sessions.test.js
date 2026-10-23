// tests/scripts/agents/claude-sessions.test.js
// Sessions start through the project's adapter, and Claude Code's adapter builds exactly the command line the
// waker and the foreman's start built before it. The recorded command lines (tests/fixtures/agents/claude-argv.json)
// were taken from that earlier code, so each session's permissions are held to what they were.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterFor } from '../../../scripts/agents/index.js';
import { NOT_BUILT_YET } from '../../../scripts/agents/contract.js';
import { agentOfConfig, agentOfProject, sessionsFor, sessionsOfProject } from '../../../scripts/agents/project-agent.js';
import { foremanSession } from '../../../scripts/foreman/start.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { computerId } from '../../../scripts/lib/paths.js';
import { makeWaker, writeWake } from '../../../scripts/watcher/waker.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { withHome } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { P, config as projectConfig, project } from '../../helpers/foreman.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RECORDED = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'agents', 'claude-argv.json'), 'utf8'));
const sessions = adapterFor('claude-code').sessions;
const T0 = '2026-10-19T09:00:00.000Z';

// Stand-ins for gh, glab, copilot and claude come first on the PATH; the tests that name them assert none ran.
const hostStandIns = standInTools();
after(() => hostStandIns.restore());

// The configuration a recorded case was built from.
const configOf = ({ sessionMode, routing }) => ({ ...(sessionMode === null ? {} : { sessionMode }), routing });

// What the adapter builds for a recorded case's inputs, in the shape the fixture holds.
function build(c) {
  const i = c.inputs;
  const common = { config: configOf(i.config), prompt: i.prompt, env: i.env, claude: i.claude };
  if (c.kind === 'foreman-wake') return sessions.foremanCall({ ...common, tools: i.tools });
  if (c.kind === 'foreman-long') return sessions.foremanCall({ ...common, pluginRoot: i.pluginRoot, platform: c.platform, settings: i.settings, long: true });
  const feature = { ...common, sessionId: i.sessionId, allowed: i.allowed };
  return c.kind === 'feature-start' ? sessions.featureStartCall(feature) : sessions.featureResumeCall(feature);
}

test('each call builds the recorded argv on darwin and win32', () => {
  assert.ok(RECORDED.length >= 30);
  for (const platform of ['darwin', 'win32']) {
    for (const kind of ['foreman-wake', 'foreman-long', 'feature-start', 'feature-resume']) {
      assert.ok(RECORDED.some((c) => c.platform === platform && c.kind === kind), `${kind} on ${platform} is recorded`);
    }
  }
  for (const c of RECORDED) {
    const call = build(c);
    const got = { file: call.file, args: call.args, input: call.input, verbatim: call.verbatim, env: call.env };
    const want = c.kind === 'foreman-long' ? { ...c.argv, input: '' } : c.argv;
    assert.deepEqual(got, want, c.case);
  }
});

test('the registry\'s adapter and the sessions the waker loads are one object', () => {
  assert.equal(sessionsFor('claude-code'), sessions);
  assert.throws(() => sessionsFor('model-x'), /no adapter for the agent "model-x"/);
  assert.throws(() => sessionsFor(undefined), /no adapter/);
});

test('a session is never started in bypass mode, a feature never in auto mode, and a model that is no model is refused', () => {
  const claude = { kind: 'direct', file: 'claude' };
  const base = { prompt: 'go', env: {}, claude };
  assert.throws(() => sessions.foremanCall({ ...base, config: { sessionMode: 'bypassPermissions' } }), /never starts a session in bypass mode/);
  assert.throws(() => sessions.featureStartCall({ ...base, sessionId: 'x', config: { sessionMode: 'bypassPermissions' } }), /bypass/);
  assert.throws(() => sessions.featureResumeCall({ ...base, sessionId: 'x', config: { sessionMode: 'auto' } }), /never started in auto mode/);
  assert.equal(sessions.foremanCall({ ...base, config: { sessionMode: 'auto' } }).args.includes('auto'), true, 'the foreman may be in auto mode');
  assert.throws(() => sessions.featureStartCall({ ...base, sessionId: 'x', config: { sessionMode: 'nonsense' } }), /isn't a permission mode/);
  assert.throws(() => sessions.foremanCall({ ...base, config: { routing: { foreman: '--dangerously-skip-permissions' } } }), /model can't be passed/);
  assert.throws(() => sessions.featureStartCall({ ...base, sessionId: 'x', config: { routing: { builder: 'a b' } } }), /model can't be passed/);
  // With no configuration at all, the default mode is still given in words.
  assert.deepEqual(sessions.featureStartCall({ ...base, sessionId: 'x' }).args, ['-p', 'go', '--session-id', 'x', '--permission-mode', 'acceptEdits']);
});

test('the foreman, which works in the front desk\'s folder, always names its model, so it never takes the front desk\'s', () => {
  const claude = { kind: 'direct', file: 'claude' };
  for (const long of [false, true]) {
    const named = sessions.foremanCall({ config: { routing: { foreman: 'model-a', frontDesk: 'model-top' } }, prompt: 'x', claude, long, settings: long ? '/s.json' : null });
    assert.equal(named.args[named.args.indexOf('--model') + 1], 'model-a');
    const unnamed = sessions.foremanCall({ config: { routing: { frontDesk: 'model-top' } }, prompt: 'x', claude, long, settings: long ? '/s.json' : null });
    assert.equal(unnamed.args[unnamed.args.indexOf('--model') + 1], 'default', 'the command line\'s own default, by its alias');
  }
  // A feature session works in its own worktree, which the front desk's model never reaches: unchanged.
  const feature = sessions.featureStartCall({ config: { routing: { frontDesk: 'model-top' } }, prompt: 'x', claude, sessionId: 's' });
  assert.ok(!feature.args.includes('--model'));
});

test('the foreman gets its role in its environment and a feature does not, whatever spelling the host used', () => {
  const env = { PATH: '/bin', wheelhouse_role: 'front-desk', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/c' };
  const claude = { kind: 'direct', file: 'claude' };
  assert.deepEqual(sessions.foremanCall({ config: {}, prompt: 'p', env, claude }).env, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', WHEELHOUSE_ROLE: 'foreman' });
  assert.deepEqual(sessions.featureResumeCall({ config: {}, prompt: 'p', sessionId: 's', env, claude }).env, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/c' });
});

// --- The waker asks the project's adapter ---

// The configuration from the default branch, as the watcher holds it.
const configOf2 = (over = {}) => readConfig(JSON.stringify(projectConfig(over)));
const waker = (over = {}) => {
  const calls = [];
  const w = makeWaker({
    shape: 1, project: P, config: configOf2(), run: (file, args, options) => { calls.push({ file, args, ...options }); return { pid: 100 }; },
    alive: () => true, startTimeOf: async () => null, now: () => new Date(T0), bootedAt: () => 0, claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: '/bin' }, print: () => {}, ...over,
  });
  return { w, calls };
};
const foremanWake = () => writeWake(P, { to: 'foreman', events: [{ type: 'incident', id: 'e1', detail: {} }], digest: [], dropped: 0 }, { now: () => new Date(T0) });
// A working copy's .claude/wheelhouse.json, which no session's agent comes from.
const agentsFile = (checkout, agents) => {
  fs.mkdirSync(path.join(checkout, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(checkout, '.claude', 'wheelhouse.json'), JSON.stringify({ agents }));
};

test('the waker asks the project\'s adapter for the foreman\'s call, the feature\'s start and its resume, and runs what it is given', () => withHome(async () => {
  const checkout = await project();
  const seen = [];
  const answer = (name) => (options) => {
    seen.push({ name, options });
    return { file: `agent-${name}`, args: [name, options.prompt], input: 'in', verbatim: false, env: { PATH: '/p', MARK: name } };
  };
  const stand = { checkForeman: (config) => seen.push({ name: 'check-foreman', config }), checkFeature: (config) => seen.push({ name: 'check', config }), foremanCall: answer('foreman'), featureStartCall: answer('start'), featureResumeCall: answer('resume'), finalAnswer: () => null };
  const worktree = path.join(checkout, '.claude', 'worktrees', 'wt-1');
  fs.mkdirSync(featurePaths(worktree).dir, { recursive: true });
  fs.writeFileSync(featurePaths(worktree).brief, 'The brief.\n');
  const { w, calls } = waker({ sessions: stand, locate: () => worktree, foremanTools: ['Read'], windowsBuilds: () => ({ level: 'ask', grants: [], guardedCommand: null }), platform: 'darwin' });

  await w.wakeForeman(foremanWake());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'agent-foreman');
  assert.deepEqual(calls[0].env, { PATH: '/p', MARK: 'foreman' });
  assert.equal(calls[0].input, 'in');
  assert.equal(calls[0].cwd, checkout);
  const foreman = seen.find((x) => x.name === 'foreman');
  assert.deepEqual(foreman.options.tools, ['Read']);
  assert.equal(foreman.options.config.routing.foreman, 'model-a');
  assert.ok(foreman.options.prompt.startsWith('Wheelhouse foreman: follow wheelhouse:foreman to handle '));
  assert.equal(foreman.options.long, undefined, 'the waker\'s foreman is the one-wake kind');

  const started = await w.startFeature({ work: 'login-page', worktree, briefFile: featurePaths(worktree).brief });
  assert.equal(calls[1].file, 'agent-start');
  const start = seen.find((x) => x.name === 'start');
  assert.equal(start.options.sessionId, started.sessionId);
  assert.equal(start.options.prompt, 'Read .wheelhouse/feature/brief.md and follow it.');
  assert.deepEqual(start.options.allowed, ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)']);
  assert.equal(calls[1].cwd, worktree);

  // The foreman's record ends so the feature's wake can go; the feature's session is the kept one.
  const { w: again, calls: more } = waker({ sessions: stand, locate: () => worktree, platform: 'darwin', alive: () => false });
  await again.wakeFeature('login-page', writeWake(P, { to: 'feature', work: 'login-page', events: [{ type: 'ci-red', id: 'x' }], digest: [], dropped: 0 }, { now: () => new Date(T0) }));
  // The first waker's foreman has gone from this one's view, so its wake goes again; the feature's wake goes as a resume.
  assert.deepEqual(more.map((c) => [c.file, c.cwd]), [['agent-foreman', checkout], ['agent-resume', worktree]]);
  const resume = seen.find((x) => x.name === 'resume');
  assert.ok(seen.some((x) => x.name === 'check'), 'the feature is checked before it is set up');
  assert.equal(resume.options.sessionId, started.sessionId);
  assert.match(resume.options.prompt, /^Wheelhouse: read /);
}));

test('without a stand-in the waker starts Claude Code, the default agent', () => withHome(async () => {
  await project();
  const defaulted = waker();
  await defaulted.w.wakeForeman(foremanWake());
  assert.equal(defaulted.calls[0].file, 'claude');
  assert.equal(defaulted.calls[0].args[0], '-p');
}));

test('a project that names Claude Code for this computer starts it too', () => withHome(async () => {
  await project();
  const named = waker({ config: configOf2({ agents: { [computerId()]: 'claude-code' } }) });
  await named.w.wakeForeman(foremanWake());
  assert.equal(named.calls[0].file, 'claude');
}));

test('a project that names an agent with no adapter for this computer starts nothing, and keeps the wake', () => withHome(async () => {
  await project();
  const refused = waker({ config: configOf2({ agents: { [computerId()]: 'model-x', 'other-computer': 'claude-code' } }) });
  await refused.w.wakeForeman(foremanWake());
  assert.equal(refused.calls.length, 0, 'no session starts for an agent with no adapter');
  assert.equal(refused.w.waiting().length, 1, 'the wake is kept to go again');
  assert.match(refused.w.waiting()[0].lastError, /no adapter for the agent "model-x"/);
}));

test('the agent comes from the default branch\'s configuration, never from the working copy', () => withHome(async () => {
  const checkout = await project();
  // The working copy names another agent for this computer (an edit nobody has merged): nothing changes.
  agentsFile(checkout, { [computerId()]: 'model-x' });
  assert.equal(agentOfProject(checkout, { computerId: computerId() }), 'model-x', 'setup can still read the working copy');
  const w = waker();
  await w.w.wakeForeman(foremanWake());
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].file, 'claude');
  const long = foremanSession({ project: P, config: projectConfig(), pluginRoot: ROOT, platform: 'darwin', env: {}, claude: { kind: 'direct', file: 'claude' } });
  assert.equal(long.file, 'claude');
  // And the other way: the default branch names one, the working copy does not.
  fs.rmSync(path.join(checkout, '.claude', 'wheelhouse.json'));
  const other = waker({ config: configOf2({ agents: { [computerId()]: 'model-x' } }) });
  await other.w.wakeForeman(foremanWake());
  assert.equal(other.calls.length, 0);
}));

test('agentOfConfig reads the computer\'s entry and defaults to Claude Code', () => {
  assert.equal(agentOfConfig({}, { computerId: 'c1' }), 'claude-code');
  assert.equal(agentOfConfig({ agents: { c1: 'model-x' } }, { computerId: 'c1' }), 'model-x');
  assert.equal(agentOfConfig({ agents: { c1: 'model-x' } }, { computerId: 'c2' }), 'claude-code');
  assert.equal(agentOfConfig({ agents: { c1: 'model-x' } }), 'claude-code');
  assert.equal(agentOfConfig({ agents: ['model-x'] }, { computerId: '0' }), 'claude-code');
  assert.equal(agentOfConfig({ agents: { c1: '' } }, { computerId: 'c1' }), 'claude-code');
  assert.equal(agentOfConfig(null, { computerId: 'c1' }), 'claude-code');
});

test('when this computer\'s id can\'t be read, a configuration with an agents map chooses nothing and one without it gives Claude Code', () => withHome(async (home) => {
  const blocker = path.join(home, 'a-file');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(blocker, 'x');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = path.join(blocker, 'inside'); // a home that can't be made, with no computer.json in it
  let withoutMap;
  try {
    assert.throws(() => computerId());
    assert.throws(() => sessionsOfProject({ agents: { c1: 'claude-code' } }), /id can't be read/);
    withoutMap = sessionsOfProject({});
  } finally {
    process.env.WHEELHOUSE_HOME = before;
  }
  assert.equal(withoutMap, sessions);
}));

test('the foreman\'s long session asks the project\'s adapter too', () => withHome(async () => {
  const checkout = await project();
  const call = foremanSession({ project: P, config: projectConfig(), pluginRoot: ROOT, platform: 'darwin', env: { PATH: '/bin' }, claude: { kind: 'direct', file: 'claude' } });
  assert.equal(call.file, 'claude');
  assert.equal(call.args[0].startsWith('Wheelhouse foreman: you are the long-lived foreman of '), true);
  assert.equal(call.options.cwd, checkout);
  assert.equal(call.options.env.WHEELHOUSE_ROLE, 'foreman');
  assert.equal(sessionsOfProject(projectConfig()), sessions);
  assert.equal(sessionsOfProject(null), sessions);

  assert.throws(() => foremanSession({
    project: P, config: projectConfig({ agents: { [computerId()]: 'model-x' } }), pluginRoot: ROOT, platform: 'darwin', env: {}, claude: { kind: 'direct', file: 'claude' },
  }), /no adapter for the agent "model-x"/);
}));

test('a builder model that can\'t be passed is refused before the worktree is labelled or a grant is recorded', () => withHome(async () => {
  const checkout = await project();
  const worktree = path.join(checkout, '.claude', 'worktrees', 'wt-1');
  fs.mkdirSync(featurePaths(worktree).dir, { recursive: true });
  fs.writeFileSync(featurePaths(worktree).brief, 'The brief.\n');
  const labelled = [];
  const bad = { ...configOf2(), routing: { foreman: 'model-a', builder: 'a b' } }; // readConfig would refuse it; a wrong model is still not trusted
  const { w, calls } = waker({
    config: bad, platform: 'win32', locate: () => worktree,
    windowsBuilds: () => ({ level: 'guarded', grants: [], guardedCommand: 'runner' }), labelGuarded: async (dir) => { labelled.push(dir); },
  });
  await assert.rejects(w.startFeature({ work: 'login-page', worktree, briefFile: featurePaths(worktree).brief }), /model can't be passed/);
  assert.deepEqual(labelled, [], 'nothing was labelled');
  assert.equal(calls.length, 0);
}));

// --- The waker asks the project's adapter whether its sessions may start ---

test('Claude Code\'s checkForeman refuses bypass mode as sessionModeOf does', () => {
  assert.throws(() => sessions.checkForeman({ sessionMode: 'bypassPermissions' }), /never starts a session in bypass mode/);
  assert.throws(() => sessions.checkForeman({ sessionMode: 'nonsense' }), /isn't a permission mode/);
  assert.equal(sessions.checkForeman({ sessionMode: 'auto' }), undefined, 'the foreman may be in auto mode');
  assert.equal(sessions.checkForeman({}), undefined, 'none given: the explicit default');
  assert.equal(sessions.checkForeman(null), undefined);
});

test('the waker asks the project\'s adapter for the mode checks', () => withHome(async () => {
  const checkout = await project();
  const seen = [];
  const call = () => ({ file: 'agent', args: [], input: '', verbatim: false, env: {} });
  const stood = {
    checkForeman: (config) => seen.push(['foreman', config]),
    checkFeature: (config) => seen.push(['feature', config]),
    foremanCall: call, featureStartCall: call, featureResumeCall: call, finalAnswer: () => null,
  };
  const worktree = path.join(checkout, '.claude', 'worktrees', 'wt-1');
  fs.mkdirSync(featurePaths(worktree).dir, { recursive: true });
  fs.writeFileSync(featurePaths(worktree).brief, 'The brief.\n');
  const held = configOf2();
  const { w } = waker({ config: held, sessions: stood, locate: () => worktree });
  assert.deepEqual(seen.map(([kind]) => kind), ['foreman'], 'the waker is checked as it is made');
  assert.equal(seen[0][1], held, 'with the very configuration it holds');
  seen.length = 0;

  await w.wakeForeman(foremanWake());
  assert.ok(seen.length >= 1 && seen.every(([kind, given]) => kind === 'foreman' && given === held), 'a foreman wake is a foreman check');
  seen.length = 0;
  await w.wakeFeature('login-page', writeWake(P, { to: 'feature', work: 'login-page', events: [{ type: 'ci-red', id: 'x' }], digest: [], dropped: 0 }, { now: () => new Date(T0) }));
  assert.ok(seen.some(([kind]) => kind === 'feature'), 'a feature wake is a feature check');
  assert.ok(seen.every(([, given]) => given === held));
  seen.length = 0;
  await w.startFeature({ work: 'login-page', worktree, briefFile: featurePaths(worktree).brief });
  assert.ok(seen.some(([kind]) => kind === 'feature'), 'a feature start is a feature check');

  // A check that throws refuses the waker, as a bad mode does.
  const refusing = { ...stood, checkForeman: () => { throw new Error('The adapter will not start a foreman'); } };
  assert.throws(() => waker({ sessions: refusing }), /will not start a foreman/);
}));

// A waker made for a project with no `agents` map, whose held configuration is then given one naming this
// computer's agent: the configuration changes after the waker was made, as the bad-mode test changes the mode.
async function copilotProject() {
  const checkout = await project();
  const held = configOf2();
  const made = waker({ config: held });
  held.agents = { [computerId()]: 'copilot' };
  return { checkout, held, ...made };
}

test('the waker refuses a Copilot project\'s foreman wake while Copilot\'s sessions are not built', () => withHome(async () => {
  hostStandIns.reset();
  const { w, calls } = await copilotProject();
  await assert.rejects(w.wakeForeman(foremanWake()), (error) => error.code === NOT_BUILT_YET && /not built yet/.test(error.message));
  assert.equal(calls.length, 0, 'no session was started');
  assert.deepEqual(w.waiting(), [], 'nothing was recorded for the refused wake, as with a bad mode');
  assert.deepEqual(hostStandIns.calls(), [], 'no host program ran, claude included');
  // A waker made for such a project is refused as it is made, as a bad mode is.
  assert.throws(() => waker({ config: configOf2({ agents: { [computerId()]: 'copilot' } }) }), (error) => error.code === NOT_BUILT_YET);
}));

test('the waker refuses a Copilot project\'s feature wake while Copilot\'s sessions are not built', () => withHome(async () => {
  hostStandIns.reset();
  const { checkout, w, calls } = await copilotProject();
  const worktree = path.join(checkout, '.claude', 'worktrees', 'wt-1');
  fs.mkdirSync(featurePaths(worktree).dir, { recursive: true });
  fs.writeFileSync(featurePaths(worktree).brief, 'The brief.\n');
  const bundle = { to: 'feature', work: 'login-page', events: [{ type: 'ci-red', id: 'x' }], digest: [], dropped: 0 };
  await assert.rejects(w.wakeFeature('login-page', writeWake(P, bundle, { now: () => new Date(T0) })), (error) => error.code === NOT_BUILT_YET);
  await assert.rejects(w.startFeature({ work: 'login-page', worktree, briefFile: featurePaths(worktree).brief }), (error) => error.code === NOT_BUILT_YET);
  assert.equal(calls.length, 0, 'no session was started');
  assert.deepEqual(w.waiting(), []);
  assert.deepEqual(hostStandIns.calls(), []);
}));
