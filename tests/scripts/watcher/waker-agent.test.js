// tests/scripts/watcher/waker-agent.test.js
// The waker asks the project's agent before it starts anything (ruling P5-30, the four minors of ledger line 369):
// the skip for an agent with no adapter holds only at Shape 1, where the call that starts a session refuses it and
// the wake is kept; the foreman's check is asked right before its call is built; a feature is checked before its
// session id is written; and a project whose agent's sessions are switched off (Copilot's, ruling P8-1) raises no
// card from a watcher pass. Every session start is a stand-in, and no host program runs.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computerId } from '../../../scripts/lib/paths.js';
import { makeWaker, writeWake, watcherDir } from '../../../scripts/watcher/waker.js';
import { runWatcher, healthFile } from '../../../scripts/watcher/main.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { withHome } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { P, T0, config as projectConfig, project } from '../../helpers/foreman.js';
import { readBaseline, writeBaseline } from '../../../scripts/watcher/control-files.js';

const hostStandIns = standInTools();
after(() => hostStandIns.restore());

const configOf = (over = {}) => readConfig(JSON.stringify(projectConfig(over)));
const waker = (over = {}) => {
  const calls = [];
  const w = makeWaker({
    shape: 1, project: P, config: configOf(), run: (file, args, options) => { calls.push({ file, args, ...options }); return { pid: 100 }; },
    alive: () => true, startTimeOf: async () => null, now: () => new Date(T0), bootedAt: () => 0, claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: '/bin' }, print: () => {}, ...over,
  });
  // A start comes straight after the foreman's start recorded the worktree's agent files, which the
  // waker now checks before a start too (ruling P7-33): kept here when missing.
  const start = w.startFeature;
  w.startFeature = (args = {}) => {
    try {
      if (readBaseline(P, args.work, args.worktree) === null) writeBaseline(P, args.work, args.worktree);
    } catch { /* a start the waker refuses for its own reasons */ }
    return start(args);
  };
  return { w, calls };
};
const foremanWake = () => writeWake(P, { to: 'foreman', events: [{ type: 'incident', id: 'e1', detail: {} }], digest: [], dropped: 0 }, { now: () => new Date(T0) });
const sessionFile = (work) => path.join(watcherDir(P), 'sessions', `${work}.json`);

test('the skip for an agent with no adapter holds at Shape 1 only: Shape 2 refuses as the waker is made', () => withHome(async () => {
  await project();
  const unknown = { agents: { [computerId()]: 'model-x' } };
  // Shape 1: the waker is made, and the start refuses later, keeping the wake (claude-sessions.test.js).
  assert.doesNotThrow(() => waker({ config: configOf(unknown) }));
  // Shape 2 prints a line for the director's own session, which nothing checks after: refused now.
  assert.throws(() => waker({ shape: 2, config: configOf({ ...unknown, watcherShape: 2 }) }), /no adapter for the agent "model-x"/);
  // A Shape 2 waker for Claude Code is made as before, and refuses a wake once the agent named has no adapter.
  const held = configOf({ watcherShape: 2 });
  const { w } = waker({ shape: 2, config: held });
  held.agents = unknown.agents;
  await assert.rejects(w.wakeForeman(foremanWake()), /no adapter/);
}));

test('the foreman\'s check is asked right before its call is built', () => withHome(async () => {
  await project();
  const seen = [];
  let refuse = false;
  const call = () => ({ file: 'agent', args: [], input: '', verbatim: false, env: {} });
  const stood = {
    checkForeman: () => { seen.push('check'); if (refuse) throw new Error('The adapter will not start a foreman now'); },
    checkFeature: () => seen.push('check-feature'),
    foremanCall: (options) => { seen.push('call'); return call(options); },
    featureStartCall: call, featureResumeCall: call, finalAnswer: () => null,
  };
  // The check turns to a refusal while the wake is being copied, after deliver's own check.
  const { w, calls } = waker({ sessions: stood, beforeCopy: () => { refuse = true; } });
  await w.wakeForeman(foremanWake());
  assert.equal(seen.includes('call'), false, 'no call is built after a refusing check');
  assert.equal(calls.length, 0, 'no session was started');
  assert.equal(w.waiting().length, 1, 'the wake is kept to go again');
  assert.match(w.waiting()[0].lastError, /will not start a foreman now/);
  // Allowed: the check comes straight before the call.
  refuse = false;
  seen.length = 0;
  // Past the wake's wait, so it goes again.
  const allowed = waker({ sessions: stood, alive: () => false, now: () => new Date(T0 + 10 * 60 * 1000) });
  await allowed.w.pump();
  assert.equal(seen.at(-1), 'call');
  assert.equal(seen.at(-2), 'check');
  assert.equal(allowed.calls.length, 1, 'the session was started');
}));

test('a feature is checked before its session id is written', () => withHome(async () => {
  const checkout = await project();
  const worktree = path.join(checkout, '.claude', 'worktrees', 'wt-1');
  fs.mkdirSync(featurePaths(worktree).dir, { recursive: true });
  fs.writeFileSync(featurePaths(worktree).brief, 'The brief.\n');
  // An agent with no adapter, at Shape 1: the waker is made, and the start is refused before anything is written.
  const { w, calls } = waker({ config: configOf({ agents: { [computerId()]: 'model-x' } }), locate: () => worktree });
  await assert.rejects(w.startFeature({ work: 'login-page', worktree, briefFile: featurePaths(worktree).brief }), /no adapter/);
  assert.equal(fs.existsSync(sessionFile('login-page')), false, 'no session id was written');
  assert.equal(calls.length, 0);
}));

test('a project whose agent\'s sessions are switched off gets no card from a watcher pass', () => withHome(async () => {
  hostStandIns.reset();
  await project();
  const config = projectConfig({ agents: { [computerId()]: 'copilot' } });
  // The helper's client answers the configuration; any other call (a card, a write) is recorded.
  const asked = [];
  const client = new Proxy({}, {
    get: (_, name) => {
      if (name === 'config') return async () => { asked.push('config'); return { ok: true, config }; };
      if (name === 'then') return undefined;
      return new Proxy(async () => { asked.push(String(name)); return { ok: true }; }, { get: (__, sub) => async () => { asked.push(`${String(name)}.${String(sub)}`); return { ok: true }; } });
    },
  });
  let observed = 0;
  const logged = [];
  const done = await runWatcher({
    project: P, client, observe: async () => { observed += 1; return {}; }, loops: 3, sleep: async () => {}, now: () => new Date(T0), log: (m) => logged.push(m),
  });
  assert.equal(done.started, true);
  assert.equal(observed, 0, 'nothing is observed, so nothing is woken');
  assert.deepEqual([...new Set(asked)], ['config'], 'the helper is asked for nothing but the configuration: no card, no write');
  const health = JSON.parse(fs.readFileSync(healthFile(P), 'utf8'));
  assert.match(health.lastError.message, /aren't switched on yet/);
  assert.ok(logged.every((m) => /aren't switched on yet/.test(m)), logged.join('\n'));
  assert.deepEqual(hostStandIns.calls(), [], 'no host program ran');
  // The waker itself is refused as it is made, by the switch.
  assert.throws(() => waker({ config: configOf(config) }), /aren't switched on yet/);
}));
