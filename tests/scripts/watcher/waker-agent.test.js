// tests/scripts/watcher/waker-agent.test.js
// The waker asks the project's agent before it starts anything (ruling P5-30): the foreman's check is asked right
// before its call is built, and a feature is checked before its session id is written. Every session start is a
// stand-in, and no host program runs.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeWaker, writeWake, watcherDir } from '../../../scripts/watcher/waker.js';
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
  const call = () => ({ file: 'agent', args: [], input: '', verbatim: false, env: {} });
  const refusing = {
    checkForeman: () => {},
    checkFeature: () => { throw new Error('The adapter will not start a feature now'); },
    foremanCall: call, featureStartCall: call, featureResumeCall: call, finalAnswer: () => null,
  };
  const { w, calls } = waker({ sessions: refusing, locate: () => worktree });
  await assert.rejects(w.startFeature({ work: 'login-page', worktree, briefFile: featurePaths(worktree).brief }), /will not start a feature now/);
  assert.equal(fs.existsSync(sessionFile('login-page')), false, 'no session id was written');
  assert.equal(calls.length, 0);
}));
