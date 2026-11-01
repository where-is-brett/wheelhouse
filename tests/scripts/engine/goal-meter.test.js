// tests/scripts/engine/goal-meter.test.js
// The spend meter (scripts/engine/goal-meter.js): what a goal has spent by both limits, with unknown spend never reading as zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalMeter, shareAtStart } from '../../../scripts/engine/goal-meter.js';
import { LANE_CAPS } from '../../../scripts/engine/order.js';
import { limitsFor } from '../../../scripts/engine/caps.js';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const STARTED = '2026-11-01T09:00:00.000Z';
const AFTER = '2026-11-01T10:00:00.000Z';
const BEFORE = '2026-11-01T08:00:00.000Z';
const RESETS = '2026-11-03T00:00:00.000Z';

const goalOf = (spend = { tokens: 20000000 }, pieces = ['a', 'b']) => ({ id: 'g', startedAt: STARTED, sheet: { spend, pieces: pieces.map((work) => ({ work, hash: 'h' })) } });
const run = (runId, lane, state, at = AFTER, extra = {}) => ({ at, data: { runId, lane, state, ...extra } });
const cost = (runId, tokens, extra = {}) => ({ at: AFTER, data: { runId, tokens, source: 'reported', floorDollars: 1, ...extra } });
const reading = (share, shareAt = '2026-11-01T11:50:00.000Z', resetsAt = RESETS) => ({ share, shareAt, resetsAt });
const atStart = reading(40, '2026-11-01T08:55:00.000Z');

const meter = (over = {}) => goalMeter({
  goal: goalOf(), views: { runs: {}, costs: {} }, inspect: async () => { throw new Error('nothing to read'); }, queueRuns: [], capOf: (lane) => limitsFor(lane), reading: null, shareAtStart: null, requests: null, now: NOW, ...over,
});

test('tokens add the goal\'s cost records, each live run and each queue run', async () => {
  const views = {
    runs: { a: [run('r1', 'quick', 'started'), run('r1', 'quick', 'ended')], b: [run('r2', 'quick', 'started')] },
    costs: { a: [cost('r1', 100)] },
  };
  const seen = { r2: { status: 'running', steps: [{ tokens: 20, source: 'reported', dollars: 1 }] }, q1: { status: 'ended', steps: [{ tokens: 3, source: 'reported', dollars: 1 }] } };
  const got = await meter({ views, queueRuns: ['q1'], inspect: async (id) => seen[id] });
  assert.deepEqual(got, { tokens: 123, points: null, requests: null, unknown: false, reached: null, left: 20000000 - 123 });
});

test('a figure added from outside joins the tokens', async () => {
  assert.equal((await meter({ extra: () => 7 })).tokens, 7);
});

test('spend from before the goal\'s Start counts for nothing', async () => {
  const views = { runs: { a: [run('old', 'quick', 'started', BEFORE), run('old', 'quick', 'ended', BEFORE)] }, costs: { a: [cost('old', 500)] } };
  assert.equal((await meter({ views })).tokens, 0);
});

test('a piece\'s run that was live at Start counts', async () => {
  const views = { runs: { a: [run('r', 'quick', 'started', BEFORE)] }, costs: {} };
  assert.equal((await meter({ views, inspect: async () => ({ status: 'running', steps: [{ tokens: 9, source: 'reported', dollars: 1 }] }) })).tokens, 9);
});

test('a run of other work left going counts for nothing', async () => {
  const views = { runs: { other: [run('r', 'quick', 'started', BEFORE)] }, costs: {} };
  assert.equal((await meter({ views })).tokens, 0);
});

test('a piece narrowed off the sheet keeps the spend it made', async () => {
  const views = { runs: { gone: [run('r', 'quick', 'started'), run('r', 'quick', 'ended')] }, costs: { gone: [cost('r', 50)] } };
  assert.equal((await meter({ views })).tokens, 50);
});

test('a fix-lane run\'s spend counts', async () => {
  const views = { runs: { 'red-main': [run('f', 'fix-main', 'started'), run('f', 'fix-main', 'ended')] }, costs: { 'red-main': [cost('f', 70)] } };
  assert.equal((await meter({ views })).tokens, 70);
});

test('a run costed and live isn\'t counted twice', async () => {
  const views = {
    runs: { a: [run('r', 'quick', 'started'), run('r', 'quick', 'ended'), run('r', 'quick', 'started', AFTER, { resume: 1 })] },
    costs: { a: [cost('r', 100)] },
  };
  const live = (tokens) => async () => ({ status: 'running', steps: [{ tokens, source: 'reported', dollars: 1 }] });
  assert.equal((await meter({ views, inspect: live(130) })).tokens, 130, 'the run\'s own figure holds every leg');
  assert.equal((await meter({ views, inspect: live(20) })).tokens, 100, 'a resumed run\'s steps hold only the last leg');
});

test('a run ended with no cost record yet is read from the engine', async () => {
  const views = { runs: { a: [run('r', 'quick', 'started'), run('r', 'quick', 'ended')] }, costs: {} };
  assert.equal((await meter({ views, inspect: async () => ({ status: 'ended', steps: [{ tokens: 11, source: 'reported', dollars: 1 }] }) })).tokens, 11);
});

test('a run of unknown spend counts its whole cap', async () => {
  const views = { runs: { a: [run('r', 'small', 'started'), run('r', 'small', 'ended')] }, costs: { a: [cost('r', null, { source: 'unknown', floorDollars: 0 })] } };
  const got = await meter({ views });
  assert.equal(got.tokens, LANE_CAPS.small.tokens);
  assert.equal(got.unknown, true);
});

test('a run with some spend unknown counts at least its cap, and more if it told more', async () => {
  const views = (tokens) => ({ runs: { a: [run('r', 'quick', 'started'), run('r', 'quick', 'ended')] }, costs: { a: [cost('r', tokens, { source: 'unknown', floorDollars: 0 })] } });
  assert.equal((await meter({ views: views(5) })).tokens, LANE_CAPS.quick.tokens);
  assert.equal((await meter({ views: views(LANE_CAPS.quick.tokens + 5) })).tokens, LANE_CAPS.quick.tokens + 5);
});

test('dollars with no tokens are unknown spend, not zero', async () => {
  const views = { runs: { a: [run('r', 'quick', 'started'), run('r', 'quick', 'ended')] }, costs: { a: [cost('r', 0, { floorDollars: 2 })] } };
  const got = await meter({ views });
  assert.equal(got.tokens, LANE_CAPS.quick.tokens);
  assert.equal(got.unknown, true);
});

test('a live run the engine can\'t read counts its whole cap', async () => {
  const views = { runs: { a: [run('r', 'quick', 'started')] }, costs: {} };
  for (const inspect of [async () => null, async () => { throw new Error('no answer'); }, async () => ({ status: 'unknown', steps: [] }), async () => ({ status: 'running', steps: [], unread: true })]) {
    const got = await meter({ views, inspect });
    assert.equal(got.tokens, LANE_CAPS.quick.tokens);
    assert.equal(got.unknown, true);
  }
});

test('a live run that has spent nothing yet is a known zero', async () => {
  const views = { runs: { a: [run('r', 'quick', 'started')] }, costs: {} };
  const got = await meter({ views, inspect: async () => ({ status: 'running', steps: [] }) });
  assert.deepEqual([got.tokens, got.unknown], [0, false]);
});

test('a queue run of unknown spend counts a small run\'s cap', async () => {
  const got = await meter({ queueRuns: ['q'], inspect: async () => null });
  assert.equal(got.tokens, LANE_CAPS.small.tokens);
  assert.equal(got.unknown, true);
});

test('points read the share less the share at Start while fresh', async () => {
  assert.equal((await meter({ reading: reading(45.5), shareAtStart: atStart })).points, 5.5);
});

test('a stale reading leaves the tokens standing alone', async () => {
  const got = await meter({ goal: goalOf({ tokens: 100, points: 1 }), reading: reading(90, '2026-11-01T11:29:00.000Z'), shareAtStart: atStart });
  assert.equal(got.points, null);
  assert.equal(got.reached, null);
});

test('a reading at the edge of fresh still counts', async () => {
  assert.equal((await meter({ reading: reading(41, '2026-11-01T11:30:00.000Z'), shareAtStart: atStart })).points, 1);
});

test('no reading, or none at Start, leaves the tokens standing alone', async () => {
  assert.equal((await meter({ reading: null, shareAtStart: atStart })).points, null);
  assert.equal((await meter({ reading: { share: null, shareAt: null }, shareAtStart: atStart })).points, null);
  assert.equal((await meter({ reading: reading(50), shareAtStart: null })).points, null);
});

test('a reset during a goal leaves the tokens standing alone', async () => {
  const afterReset = reading(2, '2026-11-01T11:50:00.000Z', '2026-11-08T00:00:00.000Z');
  const before = { ...atStart, resetsAt: '2026-11-01T11:00:00.000Z' };
  const got = await meter({ goal: goalOf({ tokens: 100, points: 1 }), reading: afterReset, shareAtStart: before });
  assert.equal(got.points, null);
  assert.equal(got.reached, null);
  const higher = await meter({ goal: goalOf({ tokens: 100, points: 1 }), reading: { ...afterReset, share: 90 }, shareAtStart: before });
  assert.equal(higher.points, null, 'a share higher than at Start in a new week is no spend of the goal\'s');
});

test('a share lower than at Start reads as no figure, never a negative', async () => {
  assert.equal((await meter({ reading: reading(30), shareAtStart: atStart })).points, null);
});

test('a reset time that moves a little within one week is no reset', async () => {
  assert.equal((await meter({ reading: reading(41, '2026-11-01T11:50:00.000Z', '2026-11-03T00:00:30.000Z'), shareAtStart: atStart })).points, 1);
});

test('a Copilot project reads counted requests', async () => {
  const got = await meter({ goal: goalOf({ tokens: 100, requests: 12 }), requests: 12 });
  assert.equal(got.requests, 12);
  assert.equal(got.reached, 'requests');
  assert.equal(got.points, null);
});

test('reached names the limit met, tokens first, and only a limit the sheet holds', async () => {
  const views = { runs: { a: [run('r', 'quick', 'started'), run('r', 'quick', 'ended')] }, costs: { a: [cost('r', 100)] } };
  assert.equal((await meter({ goal: goalOf({ tokens: 100, points: 1 }), views, reading: reading(50), shareAtStart: atStart })).reached, 'tokens');
  assert.equal((await meter({ goal: goalOf({ tokens: 101 }), views })).reached, null);
  assert.equal((await meter({ goal: goalOf({ tokens: 101, points: 5 }), views, reading: reading(45), shareAtStart: atStart })).reached, 'points');
  assert.equal((await meter({ goal: goalOf({ tokens: 101 }), views, reading: reading(99), shareAtStart: atStart })).reached, null);
});

test('the share at Start is a reading fresh at Start, or nothing', () => {
  const goal = goalOf();
  assert.deepEqual(shareAtStart(reading(40, '2026-11-01T08:40:00.000Z'), goal), reading(40, '2026-11-01T08:40:00.000Z'));
  assert.deepEqual(shareAtStart(reading(40, '2026-11-01T09:20:00.000Z'), goal), reading(40, '2026-11-01T09:20:00.000Z'), 'one read just after Start will do');
  assert.equal(shareAtStart(reading(40, '2026-11-01T08:00:00.000Z'), goal), null);
  assert.equal(shareAtStart(reading(40, '2026-11-01T10:00:00.000Z'), goal), null, 'one read long after would leave out what was spent before it');
  assert.equal(shareAtStart({ share: null, shareAt: null, resetsAt: null }, goal), null);
  assert.equal(shareAtStart(null, goal), null);
});
