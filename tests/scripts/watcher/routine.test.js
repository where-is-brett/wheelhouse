// tests/scripts/watcher/routine.test.js
// The script's routine moves (design section 10): a free slot starts the next piece, an answer wakes its session, a finished
// piece opens the gate, and the foreman model wakes only for judgement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUDGEMENT, makeRoutine, readFacts, routineMoves, triage } from '../../../scripts/watcher/routine.js';
import { readIncidents } from '../../../scripts/watcher/reliability.js';
import { route } from '../../../scripts/watcher/core.js';
import { HAND_DONE, HAND_GOAL } from '../../../scripts/lib/by-hand-done.js';
import { FOREMAN_QUESTIONS } from '../../../scripts/lib/build-loop.js';
import fs from 'node:fs';
import path from 'node:path';
import { holdFile, helmHeld, markOpened, takeHold, releaseHold } from '../../../scripts/crew/hold.js';
import { featurePaths, writeStatus } from '../../../scripts/feature/files.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { withHome } from '../../helpers/homes.js';
import { emptyViews, fakeClient, featureView, project, worktree, workView, P as FOREMAN_P } from '../../helpers/foreman.js';

const P = 'harbour__demo';
const NOW = new Date('2026-11-08T05:00:00.000Z');
const words = { goal: HAND_GOAL, done: [...HAND_DONE], sessions: 1, tokens: 1500000 };
const state = (over = {}) => ({
  events: [], halt: null, start: [], build: [], pause: [], merge: [], held: [], lanes: { 'w-tide-1': 'quick', 'w-tide-2': 'small' }, ...over,
});
const ev = (type, work, extra = {}) => ({ type, work, id: `${type}:${work}:1`, detail: {}, ...extra });

// An act that records what it was asked and answers as `reply` says.
function fakeAct(reply = () => ({ code: 0, stdout: '', stderr: '' })) {
  const calls = [];
  const act = async (argv) => {
    calls.push(argv);
    return reply(argv);
  };
  return { act, calls };
}

const routineOf = (facts, act, extra = {}) => makeRoutine({
  project: P, client: {}, now: () => NOW, act, facts: async () => facts, log: () => {}, ...extra,
});

test('a free slot starts the next piece with no foreman wake', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const r = routineOf(state({ start: [{ work: 'w-tide-1', lane: 'quick', words }] }), act);
  const out = await r.run({ events: [] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 4), ['start', 'w-tide-1', '--goal', HAND_GOAL]);
  assert.ok(calls[0].includes('--appetite-tokens') && calls[0].includes('1500000'));
  assert.deepEqual(out.extra, []);
  assert.equal(out.reasons.size, 0);
}));

test('a work-ready event for a piece the script starts is handled, so the foreman is not woken', () => withHome(async () => {
  const { act } = fakeAct();
  const e = ev('work-ready', 'w-tide-1');
  const r = routineOf(state({ start: [{ work: 'w-tide-1', lane: 'quick', words }] }), act);
  const out = await r.run({ events: [e] });
  assert.ok(out.handled.has(e.id));
  assert.equal(route([{ ...e, handled: true }]).foreman.length, 0);
}));

test('a start that needs the approved document read still wakes the foreman, for something no rule covers', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const e = ev('work-ready', 'w-tide-2');
  const r = routineOf(state({ start: [{ work: 'w-tide-2', lane: 'small', words: null }] }), act);
  const out = await r.run({ events: [e] });
  assert.equal(calls.length, 0);
  assert.equal(out.reasons.get(e.id), 'unknown');
}));

test('an answer wakes its session with no foreman wake', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const e = ev('answer', 'w-tide-1', { detail: { questionId: 'q-w-tide-1-1', label: 'A' } });
  const r = routineOf(state(), act);
  const out = await r.run({ events: [e] });
  assert.ok(out.handled.has(e.id));
  assert.equal(calls.length, 0, 'the watcher already routes an answer to its feature session');
  const routed = route([{ ...e, handled: true }]);
  assert.equal(routed.foreman.length, 0);
  assert.equal(routed.features['w-tide-1'].length, 1);
  assert.deepEqual(routineMoves(state({ events: [e] })).map((m) => m.act), ['wake-session']);
}));

test('an answer to the foreman\'s own question wakes the foreman', () => {
  const e = ev('answer', 'w-tide-1', { detail: { questionId: `q-w-tide-1-${FOREMAN_QUESTIONS}`, label: 'A' } });
  const t = triage(state({ events: [e] }));
  assert.equal(t.handled.length, 0);
  assert.equal(t.wake.length, 1);
  assert.equal(t.wake[0].reason, 'unknown');
});

test('a finished piece opens the gate with no foreman wake', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const ready = ev('merge-ready', 'w-tide-1', { pr: 7, detail: { head: 'a'.repeat(40) } });
  const done = ev('report', 'w-tide-1');
  const r = routineOf(state(), act);
  const out = await r.run({ events: [ready, done] });
  assert.deepEqual(calls.map((c) => c.slice(0, 2)).sort(), [['close', 'w-tide-1'], ['merge', 'w-tide-1']]);
  assert.ok(out.handled.has(ready.id) && out.handled.has(done.id));
  assert.equal(out.reasons.size, 0);
}));

test('a merge held by stop or an incident is not run, and its event is handled', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const ready = ev('merge-ready', 'w-tide-1', { pr: 7, detail: { head: 'a'.repeat(40) } });
  const halt = { why: 'All stop is on', fixes: [], stop: true };
  const out = await routineOf(state({ halt }), act).run({ events: [ready] });
  assert.equal(calls.length, 0);
  assert.ok(out.handled.has(ready.id));
}));

test('an ambiguous report wakes the foreman', () => withHome(async () => {
  const { act } = fakeAct(() => ({ code: 1, stdout: '', stderr: 'The report says both merged and blocked: ask the director\n' }));
  const e = ev('report', 'w-tide-1');
  const out = await routineOf(state(), act).run({ events: [e] });
  assert.equal(out.handled.has(e.id), false);
  assert.equal(out.reasons.get(e.id), 'ambiguous-report');
}));

test('a move that fails leaves its event to the foreman, as something no rule covers', () => withHome(async () => {
  const { act } = fakeAct(() => ({ code: 1, stdout: '', stderr: 'The work is not there\n' }));
  const e = ev('question', 'w-tide-1', { id: 'q-w-tide-1-1' });
  const out = await routineOf(state(), act).run({ events: [e] });
  assert.equal(out.handled.has(e.id), false);
  assert.equal(out.reasons.get(e.id), 'unknown');
}));

test('a stuck piece wakes the foreman and is recorded once; one held on purpose does neither', () => withHome(async () => {
  const { act } = fakeAct();
  const stuck = ev('stuck', 'w-tide-1', { detail: { still: 1300000, phase: 'building' } });
  const held = ev('stuck', 'w-tide-2', { detail: { still: 1300000, phase: 'ready-to-build' } });
  const r = routineOf(state({ held: ['w-tide-2'] }), act);
  const out = await r.run({ events: [stuck, held] });
  assert.equal(out.reasons.get(stuck.id), 'stuck');
  assert.ok(out.handled.has(held.id));
  await r.run({ events: [stuck] });
  const lines = readIncidents();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'stalled');
  assert.equal(lines[0].work, 'w-tide-1');
}));

test('the foreman is woken only for judgement', () => withHome(async () => {
  const { act } = fakeAct();
  const events = [
    ev('over-appetite', 'w-tide-1', { detail: { tokens: 5, appetite: 3 } }), ev('brief-tampered', 'w-tide-2', { detail: {} }),
    ev('review-overdue', 'w-tide-1', { pr: 4, detail: { head: 'b'.repeat(40), still: 1 } }), ev('stuck', 'w-tide-2', { detail: {} }),
  ];
  const out = await routineOf(state(), act).run({ events });
  assert.equal(out.reasons.size, events.length);
  for (const reason of out.reasons.values()) assert.ok(JUDGEMENT.includes(reason), reason);
  assert.deepEqual([...JUDGEMENT], ['ambiguous-report', 'stuck', 'unknown']);
}));

test('a plan that is ready, a question and an amendment are acted on by the script', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const hash = 'c'.repeat(64);
  const events = [
    ev('plan-ready', 'w-tide-2'), ev('question', 'w-tide-2', { id: 'q-w-tide-2-1' }), ev('amended', 'w-tide-2', { id: `amended:${hash}`, detail: { hash } }),
  ];
  const out = await routineOf(state(), act).run({ events });
  assert.deepEqual(calls.map((c) => c.slice(0, 3)), [['plan-ready', 'w-tide-2'], ['question', 'w-tide-2', 'q-w-tide-2-1'], ['amend', 'w-tide-2', hash]]);
  assert.equal(out.handled.size, 3);
}));

test('a plan held back by stop is kept and run once the hold lifts', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const e = ev('plan-ready', 'w-tide-2');
  const facts = { current: state({ halt: { why: 'All stop is on', fixes: [], stop: true } }) };
  const r = makeRoutine({ project: P, client: {}, now: () => NOW, act, facts: async () => facts.current, log: () => {} });
  await r.run({ events: [e] });
  assert.equal(calls.length, 0);
  facts.current = state();
  await r.run({ events: [] });
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['plan-ready', 'w-tide-2']]);
}));

test('queue moves: a plan that clears builds, a ready pull request merges, and stop holds them all', () => {
  const facts = state({ build: [{ verb: 'build', work: 'w-tide-2' }], merge: [{ work: 'w-tide-1', pr: 3 }] });
  assert.deepEqual(routineMoves(facts).map((m) => [m.act, m.args[0]]), [['build', 'w-tide-2'], ['merge', 'w-tide-1']]);
  assert.deepEqual(routineMoves({ ...facts, halt: { why: 'All stop is on', fixes: [], stop: true } }), []);
});

test('a queue move that keeps failing reaches the foreman once, and not again', () => withHome(async () => {
  const { act, calls } = fakeAct(() => ({ code: 1, stdout: '', stderr: 'it waits\n' }));
  let t = NOW.getTime();
  const r = makeRoutine({
    project: P, client: {}, now: () => new Date(t), act, facts: async () => state({ merge: [{ work: 'w-tide-1', pr: 3 }] }), log: () => {},
  });
  const extras = [];
  for (let i = 0; i < 5; i += 1) {
    extras.push(...(await r.run({ events: [] })).extra);
    t += 11 * 60 * 1000;
  }
  assert.equal(calls.length, 5, 'tried again after each wait');
  assert.equal(extras.length, 1);
  assert.equal(extras[0].type, 'merge-ready');
  assert.equal(extras[0].reason, 'unknown');
}));

test('when the views can not be had nothing is handled and nothing is run', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const r = makeRoutine({ project: P, client: {}, now: () => NOW, act, facts: async () => { throw new Error('no helper'); }, log: () => {} });
  const e = ev('report', 'w-tide-1');
  const out = await r.run({ events: [e] });
  assert.equal(calls.length, 0);
  assert.equal(out.handled.size, 0);
}));

test('under All stop a stuck piece is neither stalled nor a wake for the foreman', () => withHome(async () => {
  const { act } = fakeAct();
  const e = ev('stuck', 'w-tide-1', { detail: { still: 1300000, phase: 'building' } });
  const halt = { why: 'All stop is on', fixes: [], stop: true };
  const out = await routineOf(state({ halt }), act).run({ events: [e] });
  assert.ok(out.handled.has(e.id));
  assert.equal(out.reasons.size, 0);
  assert.deepEqual(readIncidents(), []);
}));

test('during an incident a piece that is still building and stalls is stuck: only its starts and merges are frozen', () => withHome(async () => {
  const { act } = fakeAct();
  const small = ev('stuck', 'w-tide-2', { detail: { still: 1300000, phase: 'building' } });
  const bug = ev('stuck', 'w-tide-3', { detail: { still: 1300000, phase: 'building' } });
  const halt = { why: 'incident outage is open', fixes: [], stop: false };
  const lanes = { 'w-tide-2': 'small', 'w-tide-3': 'bug' };
  const out = await routineOf(state({ halt, lanes }), act).run({ events: [small, bug] });
  assert.equal(out.reasons.get(small.id), 'stuck');
  assert.equal(out.reasons.get(bug.id), 'stuck');
  assert.deepEqual(readIncidents().map((l) => l.work).sort(), ['w-tide-2', 'w-tide-3']);
}));

test('during an incident a stuck piece held at planned or paused, or with its merge frozen, stays quiet', () => withHome(async () => {
  const { act } = fakeAct();
  const planned = ev('stuck', 'w-tide-2', { detail: { still: 1300000, phase: 'ready-to-build' } });
  const frozen = ev('stuck', 'w-tide-3', { detail: { still: 1300000, phase: 'pr-open' } });
  const halt = { why: 'incident outage is open', fixes: [], stop: false };
  const lanes = { 'w-tide-2': 'small', 'w-tide-3': 'small' };
  const out = await routineOf(state({ halt, lanes, held: ['w-tide-2'], ready: [{ work: 'w-tide-3', pr: 5 }] }), act).run({ events: [planned, frozen] });
  assert.ok(out.handled.has(planned.id) && out.handled.has(frozen.id));
  assert.equal(out.reasons.size, 0);
  assert.deepEqual(readIncidents(), []);
  // The incident's own fix is not frozen, so a stall in its merge is a stall.
  const fix = await routineOf(state({ halt: { ...halt, fixes: [5] }, lanes, ready: [{ work: 'w-tide-3', pr: 5 }] }), act).run({ events: [frozen] });
  assert.equal(fix.reasons.get(frozen.id), 'stuck');
}));

test('a plan found ready after a restart that fails is put to the foreman with a reason', () => withHome(async () => {
  const { act } = fakeAct(() => ({ code: 1, stdout: '', stderr: 'its brief changed\n' }));
  const out = await routineOf(state({ readyPlans: ['w-tide-2'] }), act).run({ events: [] });
  assert.equal(out.extra.length, 1);
  assert.equal(out.extra[0].type, 'plan-ready');
  assert.equal(out.extra[0].work, 'w-tide-2');
  assert.equal(out.extra[0].reason, 'unknown');
}));

test('the facts name ready plans only when asked, and find them from the status the session wrote', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.p = workView('p');
  views.features.p = featureView('p', { step: 'started', worktree: worktree(checkout, 'p'), branch: 'feature/p' });
  views.work.q = workView('q');
  views.features.q = featureView('q', { step: 'started', worktree: worktree(checkout, 'q'), branch: 'feature/q' });
  const status = (work, phase) => ({
    v: 1, work, lane: 'small', phase, task: null, fixRound: null, waitingOn: null, head: null, pr: null, slice: null, tokens: null, updatedAt: '2026-11-05T21:57:00.000Z',
  });
  writeStatus(featurePaths(path.join(checkout, '.claude', 'worktrees', 'p')).status, status('p', 'ready-to-build'));
  writeStatus(featurePaths(path.join(checkout, '.claude', 'worktrees', 'q')).status, status('q', 'building'));
  const { client } = fakeClient({ views });
  const common = { project: FOREMAN_P, client, now: () => new Date('2026-10-19T09:00:00.000Z'), stopped: () => false };
  assert.deepEqual((await readFacts({ ...common, readyPlans: true })).readyPlans, ['p']);
  assert.deepEqual((await readFacts({ ...common, readyPlans: false })).readyPlans, [], 'not read when not wanted');
}));

test('a piece freed to start whose words need its document read is put to the foreman once', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const facts = { current: state({ start: [] }) };
  const r = makeRoutine({ project: P, client: {}, now: () => NOW, act, facts: async () => facts.current, log: () => {} });
  assert.deepEqual((await r.run({ events: [ev('merge-ready', 'w-tide-1', { pr: 7 })] })).extra, []);
  facts.current = state({ start: [{ work: 'w-tide-2', lane: 'small', words: null }] });
  const out = await r.run({ events: [ev('report', 'w-tide-1')] });
  assert.equal(out.extra.length, 1);
  assert.equal(out.extra[0].type, 'work-ready');
  assert.equal(out.extra[0].work, 'w-tide-2');
  assert.equal(out.extra[0].reason, 'unknown');
  assert.equal(calls.some((c) => c[0] === 'start'), false);
  assert.deepEqual((await r.run({ events: [ev('report', 'w-tide-9')] })).extra, [], 'not again while it waits');
}));

test('a plan the session said was ready, never recorded, is run again after a restart', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const facts = state({ readyPlans: ['w-tide-2'] });
  const first = routineOf(facts, act);
  await first.run({ events: [] });
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['plan-ready', 'w-tide-2']]);
  await first.run({ events: [] });
  assert.equal(calls.filter((c) => c[0] === 'plan-ready').length, 1, 'only when the watcher starts');
}));

test('a plan found ready after a restart waits for a hold to lift, like one held in memory', () => withHome(async () => {
  const { act, calls } = fakeAct();
  const facts = { current: state({ readyPlans: ['w-tide-2'], halt: { why: 'All stop is on', fixes: [], stop: true } }) };
  const r = makeRoutine({ project: P, client: {}, now: () => NOW, act, facts: async () => facts.current, log: () => {} });
  await r.run({ events: [] });
  assert.equal(calls.length, 0);
  facts.current = state({ readyPlans: ['w-tide-2'] });
  await r.run({ events: [] });
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['plan-ready', 'w-tide-2']]);
}));

test('the facts leave out plans that clash with running work or wait on their own pull request', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.e = workView('e');
  views.features.e = featureView('e', { step: 'building', worktree: worktree(checkout, 'e'), branch: 'feature/e', files: ['package.json'] });
  views.work.ok = workView('ok');
  views.features.ok = featureView('ok', { step: 'planned', worktree: worktree(checkout, 'ok'), branch: 'feature/ok', plan: 'docs/plans/ok.md', files: ['src/ok.js'] });
  views.work.clash = workView('clash');
  views.features.clash = featureView('clash', { step: 'planned', worktree: worktree(checkout, 'clash'), branch: 'feature/clash', plan: 'docs/plans/c.md', files: ['package.json'] });
  views.work.open = workView('open');
  views.features.open = featureView('open', { step: 'planned', worktree: worktree(checkout, 'open', { pr: { pr: 3, merged: false } }), branch: 'feature/open', plan: 'docs/plans/o.md', files: ['src/open.js'] });
  const { client } = fakeClient({ views });
  const facts = await readFacts({ project: FOREMAN_P, client, now: () => new Date('2026-10-19T09:00:00.000Z'), stopped: () => false, readyPlans: true });
  assert.deepEqual(facts.build.map((b) => b.work), ['ok']);
}));

test('during an incident a piece whose plan is held back, so its session sits at ready-to-build, is not stalled', () => withHome(async () => {
  const { act } = fakeAct();
  const waiting = ev('stuck', 'w-tide-2', { detail: { still: 1300000, phase: 'ready-to-build' } });
  const halt = { why: 'incident outage is open', fixes: [], stop: false };
  const out = await routineOf(state({ halt, lanes: { 'w-tide-2': 'small' } }), act).run({ events: [waiting] });
  assert.ok(out.handled.has(waiting.id));
  assert.equal(out.reasons.size, 0);
  assert.deepEqual(readIncidents(), []);
  // Bug work goes on during an incident, so its plan is not held back: sitting at ready-to-build is a stall.
  const bug = ev('stuck', 'w-tide-3', { detail: { still: 1300000, phase: 'ready-to-build' } });
  const stalled = await routineOf(state({ halt, lanes: { 'w-tide-3': 'bug' } }), act).run({ events: [bug] });
  assert.equal(stalled.reasons.get(bug.id), 'stuck');
  // And without a hold at all, ready-to-build for long is a stall too.
  const free = ev('stuck', 'w-tide-4', { detail: { still: 1300000, phase: 'ready-to-build' } });
  assert.equal((await routineOf(state({ lanes: { 'w-tide-4': 'small' } }), act).run({ events: [free] })).reasons.get(free.id), 'stuck');
}));

test('the routine asks for ready plans only on its first run', () => withHome(async () => {
  const { act } = fakeAct();
  const asked = [];
  const r = makeRoutine({ project: P, client: {}, now: () => NOW, act, facts: async (options) => { asked.push(options?.readyPlans); return state(); }, log: () => {} });
  await r.run({ events: [] });
  await r.run({ events: [ev('report', 'w-tide-1')] });
  await r.run({ events: [ev('report', 'w-tide-1')] });
  assert.equal(asked[0], true);
  assert.deepEqual([...new Set(asked.slice(1))], [false]);
}));

test('routine: a held piece is never stuck', () => withHome(async () => {
  const { act } = fakeAct();
  const stuck = ev('stuck', 'w-tide-1', { detail: { still: 1300000, phase: 'building' } });
  const file = holdFile(P, 'w-tide-1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}\n');
  const out = await routineOf(state(), act).run({ events: [stuck] });
  assert.ok(out.handled.has(stuck.id), 'no wake for the foreman');
  assert.equal(out.reasons.size, 0);
  assert.deepEqual(readIncidents(), [], 'no stalled record and no incident');
  // Handed back, the same stall is trouble again.
  fs.rmSync(file);
  const again = await routineOf(state(), act).run({ events: [stuck] });
  assert.equal(again.reasons.get(stuck.id), 'stuck');
}));

// A hold taken as the helm takes it, opened with the given process.
async function openedHold(work, { pid, startTime, opened = true }) {
  await openTestRecord({ project: P });
  await takeHold(P, { work, sessionId: 's-1' });
  if (opened) markOpened(P, work, { pid, startTime });
}
const helmDeps = (woken, over = {}) => ({
  alive: () => true, startTimeOf: async () => 'Sun Nov  8 02:00:00 2026',
  wakerFor: () => ({ wakeFeature: async (work) => { woken.push(work); } }), ...over,
});

test('routine: events for a held piece are deferred and run once it is handed back', () => withHome(async () => {
  await openTestRecord({ project: P });
  await takeHold(P, { work: 'w-tide-1', sessionId: 's-1' });
  const { act, calls } = fakeAct();
  const r = routineOf(state(), act);
  for (const e of [ev('report', 'w-tide-1'), ev('merge-ready', 'w-tide-1', { pr: 7, detail: { head: 'a'.repeat(40) } }), ev('amended', 'w-tide-1', { detail: { hash: 'b'.repeat(40) } })]) {
    await r.run({ events: [e] });
  }
  assert.deepEqual(calls, [], 'nothing is closed, merged or amended while held');
  await r.run({ events: [] });
  assert.deepEqual(calls, [], 'still held on a later run');
  await releaseHold(P, 'w-tide-1');
  await r.run({ events: [] });
  assert.deepEqual(calls.map((c) => c.slice(0, 2)).sort(), [['amend', 'w-tide-1'], ['close', 'w-tide-1'], ['merge', 'w-tide-1']]);
}));

test('routine: a closed terminal hands back', () => withHome(async () => {
  await openedHold('w-tide-1', { pid: 4242, startTime: 'Sun Nov  8 02:00:00 2026' });
  const woken = [];
  await routineOf(state(), fakeAct().act, { helm: helmDeps(woken, { alive: () => false }) }).run({ events: [] });
  assert.equal(helmHeld(P, 'w-tide-1'), false);
  assert.deepEqual(woken, ['w-tide-1']);
}));

test('routine: a reused pid hands back', () => withHome(async () => {
  await openedHold('w-tide-1', { pid: 4242, startTime: 'Sun Nov  8 02:00:00 2026' });
  const woken = [];
  await routineOf(state(), fakeAct().act, { helm: helmDeps(woken, { startTimeOf: async () => 'Sun Nov  8 09:30:00 2026' }) }).run({ events: [] });
  assert.equal(helmHeld(P, 'w-tide-1'), false);
  assert.deepEqual(woken, ['w-tide-1']);
}));

test('routine: a live pid with the same or an unreadable start time stays', () => withHome(async () => {
  await openedHold('w-tide-1', { pid: 4242, startTime: 'Sun Nov  8 02:00:00 2026' });
  await openedHold('w-tide-2', { pid: 4243, startTime: 'Sun Nov  8 02:00:00 2026' });
  const woken = [];
  const times = { 4242: 'Sun Nov  8 02:00:00 2026', 4243: null };
  await routineOf(state(), fakeAct().act, { helm: helmDeps(woken, { startTimeOf: async (pid) => times[pid] }) }).run({ events: [] });
  assert.equal(helmHeld(P, 'w-tide-1'), true);
  assert.equal(helmHeld(P, 'w-tide-2'), true);
  assert.deepEqual(woken, []);
}));

test('routine: an unopened hold stays', () => withHome(async () => {
  await openedHold('w-tide-1', { opened: false });
  const woken = [];
  await routineOf(state(), fakeAct().act, { helm: helmDeps(woken, { alive: () => false }) }).run({ events: [] });
  assert.equal(helmHeld(P, 'w-tide-1'), true);
  assert.deepEqual(woken, []);
}));
