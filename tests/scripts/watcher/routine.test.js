// tests/scripts/watcher/routine.test.js
// The script's routine moves (design section 10): a free slot starts the next piece, an answer wakes its session, a finished
// piece opens the gate, and the foreman model wakes only for judgement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUDGEMENT, makeRoutine, routineMoves, triage } from '../../../scripts/watcher/routine.js';
import { readIncidents } from '../../../scripts/watcher/reliability.js';
import { route } from '../../../scripts/watcher/core.js';
import { HAND_DONE, HAND_GOAL } from '../../../scripts/lib/by-hand-done.js';
import { FOREMAN_QUESTIONS } from '../../../scripts/lib/build-loop.js';
import { withHome } from '../../helpers/homes.js';

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
