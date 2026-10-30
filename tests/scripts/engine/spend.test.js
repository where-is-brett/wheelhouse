// tests/scripts/engine/spend.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countedRequests, runCost, runningMinutes } from '../../../scripts/engine/spend.js';
import { capReached, limitsFor, carriedSpend } from '../../../scripts/engine/caps.js';

const step = (over) => ({ id: 'implement', role: 'implement', provider: 'claude', model: 'mid', tokens: 100000, dollars: 0.3, minutes: 4, source: 'reported', ...over });

test('the cost event has each role\'s share', () => {
  const got = runCost({ steps: [step({}), step({ id: 'review-spec', role: 'review-spec', tokens: 20000, dollars: 0.1, minutes: 1 }), step({ id: 'tests', role: 'tests', provider: null, tokens: 0, dollars: 0, minutes: 0.5 })] });
  assert.equal(got.tokens, 120000);
  assert.equal(got.dollars, 0.4);
  assert.equal(got.floorDollars, 0.4);
  assert.equal(got.source, 'reported');
  assert.equal(got.premiumRequests, 0);
  assert.deepEqual(got.byRole.implement, { tokens: 100000, dollars: 0.3, minutes: 4 });
  assert.deepEqual(Object.keys(got.byRole), ['implement', 'review-spec', 'tests']);
});

test('a run with one unknown step has null dollars and a floor', () => {
  const got = runCost({ steps: [step({}), step({ id: 'review-spec', role: 'review-spec', tokens: null, dollars: null, source: 'unknown' })] });
  assert.equal(got.dollars, null);
  assert.equal(got.floorDollars, 0.3);
  assert.equal(got.source, 'unknown');
  assert.equal(got.premiumRequests, null, 'an unknown run says nothing it doesn\'t know');
  assert.equal(got.tokens, 100000);
});

test('a cancelled step counts its prompt though its spend is unknown, and only a count that can\'t be known is null', () => {
  const cancelled = runCost({ steps: [step({ source: 'estimated', dollars: null, requests: 1 }), step({ id: 'build', role: 'build', tokens: null, dollars: null, source: 'unknown', requests: 1 })] });
  assert.equal(cancelled.source, 'unknown');
  assert.equal(cancelled.premiumRequests, 2, 'check 74 estimated 0 for these');
  assert.equal(runCost({ steps: [step({ id: 'x', role: 'x', tokens: null, dollars: null, source: 'unknown', requests: null })] }).premiumRequests, null);
  assert.equal(runCost({ status: 'unknown', steps: [] }).premiumRequests, null, 'a run the engine no longer has');
});

test('a count that can\'t be known is never read as 0', () => {
  assert.equal(countedRequests({ premiumRequests: 0 }), 0);
  assert.equal(countedRequests({ premiumRequests: 3, byRole: { a: {} } }), 3);
  assert.equal(countedRequests({ premiumRequests: null, byRole: { a: {}, b: {} } }), 2);
  assert.equal(countedRequests({ premiumRequests: null }), 1);
  assert.equal(countedRequests({}), 1);
});

test('estimated requests make the run estimated, never zero dollars', () => {
  const got = runCost({ steps: [step({}), step({ id: 'implement', role: 'implement', provider: 'other', dollars: null, source: 'estimated', requests: 3 })] });
  assert.equal(got.source, 'estimated');
  assert.equal(got.premiumRequests, 3);
  assert.equal(got.dollars, null);
  assert.equal(got.floorDollars, 0.3);
});

test('the four kinds of token are kept apart', () => {
  const got = runCost({ steps: [step({ kinds: { input: 90000, output: 10000, cacheRead: 80000, cacheWrite: 5000 } }), step({ kinds: { input: 1, output: 2, cacheRead: null, cacheWrite: 0 } })] });
  assert.deepEqual(got.kinds, { input: 90001, output: 10002, cacheRead: null, cacheWrite: 5000 });
});

test('waiting time does not count against the minutes cap', () => {
  const records = [
    { at: '2026-10-29T09:00:00.000Z', data: { state: 'started' } },
    { at: '2026-10-29T09:10:00.000Z', data: { state: 'paused' } },
    { at: '2026-10-29T11:10:00.000Z', data: { state: 'started' } },
  ];
  const minutes = runningMinutes(records, new Date('2026-10-29T11:15:00.000Z'));
  assert.equal(minutes, 15);
  assert.equal(capReached({ lane: 'quick', minutes, tokens: 0 }, { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }), null);
  assert.deepEqual(capReached({ lane: 'quick', minutes: 21, tokens: 0 }, { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }), { cap: 'minutes', used: 21, limit: 20 });
});

test('the token cap counts reported and estimated tokens', () => {
  const tokens = runCost({ steps: [step({ tokens: 600000 }), step({ tokens: 500000, dollars: null, source: 'estimated', requests: 1 })] }).tokens;
  assert.deepEqual(capReached({ lane: 'quick', minutes: 1, tokens }, { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }), { cap: 'tokens', used: 1100000, limit: 1000000 });
});

test('Give it more raises a cap once by half', () => {
  assert.deepEqual(limitsFor('quick', { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }, { raised: true }), { minutes: 30, tokens: 1500000 });
  assert.equal(capReached({ lane: 'quick', minutes: 25, tokens: 0, raised: true }, { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }), null);
});

test('a lane with no cap of its own takes the nearest', () => {
  assert.deepEqual(limitsFor('fix-main', { capMinutes: { bug: 30 }, capTokens: { bug: 2000000 } }), { minutes: 30, tokens: 2000000 });
  assert.deepEqual(limitsFor('feature', {}), { minutes: 120, tokens: 10000000 });
});

test('a run carried on counts the spend of the runs before it', () => {
  const costs = [
    { data: { runId: 'r1', tokens: 700000, minutes: 15 } },
    { data: { runId: 'r2', tokens: 100000, minutes: 2 } },
  ];
  assert.deepEqual(carriedSpend(costs, ['r1']), { tokens: 700000, minutes: 15 });
  assert.deepEqual(capReached({ lane: 'quick', minutes: 6, tokens: 400000, carried: { tokens: 700000, minutes: 15 } }, { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }), { cap: 'minutes', used: 21, limit: 20 });
});
