// tests/scripts/engine/waiting.test.js
// What waits on the director (scripts/engine/waiting.js), from what the runner and the dispatcher's runner know: an
// open card does, and a usage limit or a slice waiting to merge doesn't, whatever the run's record says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { routerWaiting, ownWaiting, limitedRuns, limitedWork } from '../../../scripts/engine/waiting.js';
import { MERGE_WORK } from '../../../scripts/engine/dispatcher.js';
import { tempFolder } from '../../helpers/homes.js';
import path from 'node:path';

const EMPTY = () => ({ waiting: [], questions: {}, approvals: {}, delivered: {}, capped: {} });
const open = (id) => ({ [id]: { question: { data: { id } } } });
const answered = (id, label = 'Yes') => ({ [id]: { question: { data: { id } }, answer: { label } } });
const run = (work, runId, state) => ({ at: '2026-11-01T02:00:00.000Z', data: { work, runId, state } });
const sorted = (set) => [...set].sort();

test('an open card waits on the director, and an answered one no longer does', () => {
  const state = { ...EMPTY(), questions: { q1: { runId: 'r1', work: 'a', ask: { id: 'x' } }, q2: { runId: 'r2', work: 'b', ask: { id: 'y' } } } };
  const views = { questions: { ...open('q1'), ...answered('q2') } };
  assert.deepEqual(sorted(routerWaiting({ state, views })), ['a']);
});

test('a card not yet shown waits, and an approval waits until it is signed', () => {
  const state = {
    ...EMPTY(),
    waiting: [{ work: 'a', runId: 'r1', card: {} }],
    approvals: { '4:abc': { runId: 'r2', work: 'b' }, '5:def': { runId: 'r3', work: 'c' } },
  };
  const views = { approvals: { 5: { def: { by: 'the director' } } } };
  assert.deepEqual(sorted(routerWaiting({ state, views })), ['a', 'b']);
});

test('a card delivered reads as nothing', () => {
  const state = { ...EMPTY(), questions: { q1: { runId: 'r1', work: 'a' } }, delivered: { q1: 'answered' } };
  assert.deepEqual(sorted(routerWaiting({ state, views: { questions: open('q1') } })), []);
});

test('a run paused at a usage limit doesn\'t wait on the director', () => {
  const views = { runs: { a: [run('a', 'r1', 'paused')] }, questions: {} };
  assert.deepEqual(sorted(routerWaiting({ state: EMPTY(), views })), []);
  assert.deepEqual(sorted(ownWaiting({ state: { features: {} }, views })), []);
});

test('a feature waiting only for its slice to merge doesn\'t wait on the director', () => {
  const views = { runs: { f: [run('f', 'r1', 'ended')] }, questions: {} };
  const state = { features: { f: { merged: {}, started: ['r1'], asked: null, stalls: {} } }, clashAsked: {}, redAsked: {} };
  assert.deepEqual(sorted(routerWaiting({ state: EMPTY(), views })), []);
  assert.deepEqual(sorted(ownWaiting({ state, views })), []);
});

test('each feature card counts: cap, stall, clash, approval, demo, switch-on, merge', () => {
  const own = (over) => ({ features: {}, clashAsked: {}, redAsked: {}, ...over });
  const cap = own({ features: { f: { asked: 'q-cap' } } });
  assert.deepEqual(sorted(ownWaiting({ state: cap, views: { questions: open('q-cap') } })), ['f']);
  const stall = own({ features: { f: { asked: null, stalls: { r1: { id: 'q-stall', done: false } } } } });
  assert.deepEqual(sorted(ownWaiting({ state: stall, views: { questions: open('q-stall') } })), ['f']);
  const clash = own({ clashAsked: { f: 'q-clash' } });
  assert.deepEqual(sorted(ownWaiting({ state: clash, views: { questions: open('q-clash') } })), ['f']);
  const red = own({ redAsked: { f: 'q-red' } });
  assert.deepEqual(sorted(ownWaiting({ state: red, views: { questions: open('q-red') } })), ['f']);

  // A slice's approval, the midpoint demo and the switch-on all reach the router as asks of the feature's own run.
  for (const kind of ['approval', 'demo', 'switch-on']) {
    const state = { ...EMPTY(), questions: { q1: { runId: 'r1', work: 'f', ask: { kind } } } };
    assert.deepEqual(sorted(routerWaiting({ state, views: { questions: open('q1') } })), ['f'], kind);
  }

  // The merge queue's card is routed under its own name, and stands for the piece that opened the pull request.
  const merge = { ...EMPTY(), questions: { q1: { runId: 'mq', work: MERGE_WORK, ask: { mergeQuestion: { pr: 7 } } } } };
  assert.deepEqual(sorted(routerWaiting({ state: merge, views: { questions: open('q1') }, prWork: (pr) => (pr === 7 ? 'f' : null) })), ['f']);
});

test('answered, each of a feature\'s own cards no longer waits', () => {
  const state = { features: { f: { asked: 'q-cap', stalls: { r1: { id: 'q-stall', done: false }, r2: { id: 'q-old', done: true } } } }, clashAsked: { g: 'q-clash' }, redAsked: { h: 'q-red' } };
  const views = { questions: { ...answered('q-cap'), ...answered('q-stall'), ...open('q-old'), ...answered('q-clash'), ...answered('q-red') } };
  assert.deepEqual(sorted(ownWaiting({ state, views })), []);
});

test('a merge card that names no piece waits for no piece', () => {
  const unknown = { ...EMPTY(), questions: { q1: { runId: 'mq', work: MERGE_WORK, ask: { mergeQuestion: { pr: 7 } } } } };
  assert.deepEqual(sorted(routerWaiting({ state: unknown, views: { questions: open('q1') }, prWork: () => null })), []);
  const trouble = { ...EMPTY(), questions: { q1: { runId: 'mq', work: MERGE_WORK, ask: { kind: 'trouble' } } } };
  assert.deepEqual(sorted(routerWaiting({ state: trouble, views: { questions: open('q1') }, prWork: () => 'f' })), []);
  assert.deepEqual(sorted(routerWaiting({ state: unknown, views: { questions: open('q1') } })), [], 'no way to name the piece');
});

test('a capped entry left after Give it more, after a Stop or in the fix lane doesn\'t wait', () => {
  // Give it more on a held run deletes the entry; a run started again leaves it, with its card answered.
  const more = { ...EMPTY(), capped: { r1: { question: 'q1', reached: {} } }, questions: { q1: { cap: true, runId: 'r1', work: 'a' } }, delivered: { q1: 'answered' } };
  assert.deepEqual(sorted(routerWaiting({ state: more, views: { questions: answered('q1', 'Give it more') } })), []);
  const stop = { ...EMPTY(), capped: { r1: { question: 'q1', stopped: true, held: false, reached: {} } }, questions: { q1: { cap: true, runId: 'r1', work: 'a' } }, delivered: { q1: 'answered' } };
  assert.deepEqual(sorted(routerWaiting({ state: stop, views: { questions: answered('q1', 'Stop') } })), []);
  const fix = { ...EMPTY(), capped: { r1: { reached: {} } } };
  assert.deepEqual(sorted(routerWaiting({ state: fix, views: { questions: {} } })), []);
});

test('an open cap card waits even though its run has ended', () => {
  const state = { ...EMPTY(), capped: { r1: { question: 'q1', reached: {} } }, questions: { q1: { cap: true, runId: 'r1', work: 'a' } } };
  const views = { questions: open('q1'), runs: { a: [run('a', 'r1', 'started'), run('a', 'r1', 'ended')] } };
  assert.deepEqual(sorted(routerWaiting({ state, views })), ['a']);
});

test('a card left open on a run that ended waits for nothing', () => {
  // A held run the director stopped, or one All stop cancelled: no answer can reach it.
  const state = {
    ...EMPTY(),
    waiting: [{ work: 'a', runId: 'r1', card: {} }],
    questions: { q1: { runId: 'r2', work: 'b', ask: {} } },
    approvals: { '4:abc': { runId: 'r3', work: 'c' } },
  };
  const views = { questions: open('q1'), runs: { a: [run('a', 'r1', 'ended')], b: [run('b', 'r2', 'ended')], c: [run('c', 'r3', 'ended')] } };
  assert.deepEqual(sorted(routerWaiting({ state, views })), []);
});

test('a merge card outlives the queue run that asked', () => {
  const state = { ...EMPTY(), questions: { q1: { runId: 'mq', work: MERGE_WORK, ask: { mergeQuestion: { pr: 7 } } } } };
  const views = { questions: open('q1'), runs: { [MERGE_WORK]: [run(MERGE_WORK, 'mq', 'ended')] } };
  assert.deepEqual(sorted(routerWaiting({ state, views, prWork: () => 'f' })), ['f']);
});

test('state kept by the version before reads as waiting on the first tick', () => {
  const dir = tempFolder('wh-waiting-');
  const router = path.join(dir, 'router.json');
  const dispatch = path.join(dir, 'dispatch.json');
  // As the version before wrote them: none of this part's fields, and none of the later ones.
  fs.writeFileSync(router, JSON.stringify({ routed: { a1: true }, questions: { 'q-a-500001': { runId: 'r1', work: 'a', ask: { id: 'a1' } } } }));
  fs.writeFileSync(dispatch, JSON.stringify({ features: { f: { merged: {}, started: [], asked: 'q-f-597001' } }, clashAsked: { g: 'q-g-590002' } }));
  const views = { questions: { ...open('q-a-500001'), ...open('q-f-597001'), ...open('q-g-590002') } };
  assert.deepEqual(sorted(routerWaiting({ state: JSON.parse(fs.readFileSync(router, 'utf8')), views })), ['a']);
  assert.deepEqual(sorted(ownWaiting({ state: JSON.parse(fs.readFileSync(dispatch, 'utf8')), views })), ['f', 'g']);
});

test('nothing kept and nothing to read reads as no one waiting', () => {
  assert.deepEqual(sorted(routerWaiting({})), []);
  assert.deepEqual(sorted(ownWaiting({})), []);
});

test('a parked pull request waits until it is approved since the park', () => {
  const state = { ...EMPTY(), approvals: { '5:abc': { runId: 'r', ask: { mergeQuestion: { pr: 5 } }, work: MERGE_WORK, parked: true } }, parked: { 5: { head: 'abc', at: '2026-11-01T02:00:00.000Z' } } };
  const waits = (at) => sorted(routerWaiting({ state, views: { questions: {}, runs: {}, approvals: { 5: { abc: { at } } } }, prWork: () => 'a' }));
  assert.deepEqual(waits('2026-11-01T01:00:00.000Z'), ['a'], 'an approval from before the park');
  assert.deepEqual(waits('2026-11-01T03:00:00.000Z'), []);
});

test('a cap card from before the work was queued again doesn\'t wait', () => {
  const state = { ...EMPTY(), questions: { q1: { cap: true, runId: 'r1', work: 'a' } } };
  const views = { questions: open('q1'), runs: { a: [run('a', 'r1', 'ended')] }, work: { a: { work: { at: '2026-11-01T03:00:00.000Z' } } } };
  assert.deepEqual(sorted(routerWaiting({ state, views })), []);
  views.work.a.work.at = '2026-11-01T01:00:00.000Z';
  assert.deepEqual(sorted(routerWaiting({ state, views })), ['a']);
});

test('a cap card kept but never written asks nothing; written, it does', () => {
  const state = { questions: { 'q-a-1': { cap: true, work: 'a', runId: 'r' } } };
  assert.deepEqual([...routerWaiting({ state, views: { questions: {}, runs: {} } })], []);
  assert.deepEqual([...routerWaiting({ state, views: { questions: { 'q-a-1': { question: { data: {} } } }, runs: {} } })], ['a']);
});

const ask = (work, runId, kind) => ({ at: '2026-11-01T02:00:00.000Z', data: { id: `${runId}:${kind}`, runId, work, kind, level: 1, options: [] } });

test('a run whose latest record is paused and whose latest ask is a usage limit is limited', () => {
  const views = { runs: { a: [run('a', 'r1', 'started'), run('a', 'r1', 'paused')], b: [run('b', 'r2', 'started')] }, asks: { a: [ask('a', 'r1', 'usage-limit')] } };
  assert.deepEqual(limitedRuns(views), ['r1']);
});

test('a run paused on the director is not limited, and neither is one that has since gone on or ended', () => {
  const later = { runs: { a: [run('a', 'r1', 'paused')] }, asks: { a: [ask('a', 'r1', 'usage-limit'), ask('a', 'r1', 'question')] } };
  assert.deepEqual(limitedRuns(later), [], 'its latest ask is a question');
  for (const state of ['started', 'ended']) {
    const views = { runs: { a: [run('a', 'r1', 'paused'), run('a', 'r1', state)] }, asks: { a: [ask('a', 'r1', 'usage-limit')] } };
    assert.deepEqual(limitedRuns(views), [], state);
  }
});

test('an earlier run of a piece at a limit says nothing of its later run, nor of what the record can\'t show', () => {
  const views = { runs: { a: [run('a', 'r1', 'ended'), run('a', 'r2', 'paused')] }, asks: { a: [ask('a', 'r1', 'usage-limit'), ask('a', 'r2', 'question')] } };
  assert.deepEqual(limitedRuns(views), []);
  assert.deepEqual(limitedRuns({}), []);
  assert.deepEqual(limitedRuns({ runs: { a: 'x', b: [null, { data: null }] }, asks: 'x' }), []);
});

test('a limit well past its reset no longer holds: the waker has failed, and other work needn\'t wait on it', () => {
  const limit = { ...ask('a', 'r1', 'usage-limit'), data: { ...ask('a', 'r1', 'usage-limit').data, resetAt: '2026-11-01T05:00:00.000Z' } };
  const views = { runs: { a: [run('a', 'r1', 'paused')] }, asks: { a: [limit] } };
  assert.deepEqual(limitedRuns(views, new Date('2026-11-01T05:29:00.000Z')), ['r1']);
  assert.deepEqual(limitedRuns(views, new Date('2026-11-01T05:31:00.000Z')), []);
  assert.deepEqual(limitedWork(views, new Date('2026-11-01T05:29:00.000Z')), ['a']);
  assert.deepEqual(limitedRuns(views), ['r1'], 'with no time given, every run parked at a limit');
});

test('a limit whose reset can\'t be read stops holding six hours after its ask', () => {
  for (const resetAt of [undefined, 'soon']) {
    const limit = { ...ask('a', 'r1', 'usage-limit'), data: { ...ask('a', 'r1', 'usage-limit').data, ...(resetAt ? { resetAt } : {}) } };
    const views = { runs: { a: [run('a', 'r1', 'paused')] }, asks: { a: [limit] } };
    assert.deepEqual(limitedRuns(views, new Date('2026-11-01T07:59:00.000Z')), ['r1']);
    assert.deepEqual(limitedRuns(views, new Date('2026-11-01T08:00:00.000Z')), []);
  }
});
