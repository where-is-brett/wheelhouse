// tests/scripts/agents/claude-sessions.test.js
// Sessions start through the project's adapter, and Claude Code's adapter builds exactly the command line the
// waker and the foreman's start built before it. The recorded command lines (tests/fixtures/agents/claude-argv.json)
// were taken from that earlier code, so each session's permissions are held to what they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterFor } from '../../../scripts/agents/index.js';
import { agentOfProject, sessionsFor, sessionsOfProject } from '../../../scripts/agents/project-agent.js';
import { foremanSession } from '../../../scripts/foreman/start.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { computerId } from '../../../scripts/lib/paths.js';
import { makeWaker, writeWake } from '../../../scripts/watcher/waker.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { withHome } from '../../helpers/homes.js';
import { P, config as projectConfig, project } from '../../helpers/foreman.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RECORDED = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'agents', 'claude-argv.json'), 'utf8'));
const sessions = adapterFor('claude-code').sessions;
const T0 = '2026-10-19T09:00:00.000Z';

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

test('the foreman gets its role in its environment and a feature does not, whatever spelling the host used', () => {
  const env = { PATH: '/bin', wheelhouse_role: 'front-desk', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/c' };
  const claude = { kind: 'direct', file: 'claude' };
  assert.deepEqual(sessions.foremanCall({ config: {}, prompt: 'p', env, claude }).env, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', WHEELHOUSE_ROLE: 'foreman' });
  assert.deepEqual(sessions.featureResumeCall({ config: {}, prompt: 'p', sessionId: 's', env, claude }).env, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/c' });
});

// --- The waker asks the project's adapter ---

const waker = (over = {}) => {
  const calls = [];
  const w = makeWaker({
    shape: 1, project: P, config: readConfig(JSON.stringify(projectConfig())), run: (file, args, options) => { calls.push({ file, args, ...options }); return { pid: 100 }; },
    alive: () => true, startTimeOf: async () => null, now: () => new Date(T0), bootedAt: () => 0, claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: '/bin' }, print: () => {}, ...over,
  });
  return { w, calls };
};
const foremanWake = () => writeWake(P, { to: 'foreman', events: [{ type: 'incident', id: 'e1', detail: {} }], digest: [], dropped: 0 }, { now: () => new Date(T0) });
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
  const stand = { foremanCall: answer('foreman'), featureStartCall: answer('start'), featureResumeCall: answer('resume'), finalAnswer: () => null };
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
  assert.deepEqual(seen[0].options.tools, ['Read']);
  assert.equal(seen[0].options.config.routing.foreman, 'model-a');
  assert.ok(seen[0].options.prompt.startsWith('Wheelhouse foreman: follow wheelhouse:foreman to handle '));
  assert.equal(seen[0].options.long, undefined, 'the waker\'s foreman is the one-wake kind');

  const started = await w.startFeature({ work: 'login-page', worktree, briefFile: featurePaths(worktree).brief });
  assert.equal(calls[1].file, 'agent-start');
  assert.equal(seen[1].options.sessionId, started.sessionId);
  assert.equal(seen[1].options.prompt, 'Read .wheelhouse/feature/brief.md and follow it.');
  assert.deepEqual(seen[1].options.allowed, ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)']);
  assert.equal(calls[1].cwd, worktree);

  // The foreman's record ends so the feature's wake can go; the feature's session is the kept one.
  const { w: again, calls: more } = waker({ sessions: stand, locate: () => worktree, platform: 'darwin', alive: () => false });
  await again.wakeFeature('login-page', writeWake(P, { to: 'feature', work: 'login-page', events: [{ type: 'ci-red', id: 'x' }], digest: [], dropped: 0 }, { now: () => new Date(T0) }));
  // The first waker's foreman has gone from this one's view, so its wake goes again; the feature's wake goes as a resume.
  assert.ok(more.some((c) => c.file === 'agent-resume' && c.cwd === worktree));
  const resume = seen.find((x) => x.name === 'resume');
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
  agentsFile(await project(), { [computerId()]: 'claude-code' });
  const named = waker();
  await named.w.wakeForeman(foremanWake());
  assert.equal(named.calls[0].file, 'claude');
}));

test('a project that names an agent with no adapter for this computer starts nothing, and keeps the wake', () => withHome(async () => {
  const checkout = await project();
  agentsFile(checkout, { [computerId()]: 'model-x', 'other-computer': 'claude-code' });
  assert.equal(agentOfProject(checkout, { computerId: computerId() }), 'model-x');
  const refused = waker();
  await refused.w.wakeForeman(foremanWake());
  assert.equal(refused.calls.length, 0, 'no session starts for an agent with no adapter');
  assert.equal(refused.w.waiting().length, 1, 'the wake is kept to go again');
  assert.match(refused.w.waiting()[0].lastError, /no adapter for the agent "model-x"/);
}));

test('the foreman\'s long session asks the project\'s adapter too', () => withHome(async () => {
  const checkout = await project();
  const call = foremanSession({ project: P, config: projectConfig(), pluginRoot: ROOT, platform: 'darwin', env: { PATH: '/bin' }, claude: { kind: 'direct', file: 'claude' } });
  assert.equal(call.file, 'claude');
  assert.equal(call.args[0].startsWith('Wheelhouse foreman: you are the long-lived foreman of '), true);
  assert.equal(call.options.cwd, checkout);
  assert.equal(call.options.env.WHEELHOUSE_ROLE, 'foreman');
  assert.equal(sessionsOfProject(checkout), sessions);
  assert.equal(sessionsOfProject(null), sessions);

  agentsFile(checkout, { [computerId()]: 'model-x' });
  assert.throws(() => foremanSession({ project: P, config: projectConfig(), pluginRoot: ROOT, platform: 'darwin', env: {}, claude: { kind: 'direct', file: 'claude' } }), /no adapter for the agent "model-x"/);
}));
