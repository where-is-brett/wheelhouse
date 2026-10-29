// tests/probes/74-archon-copilot/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { premiumDelta, premiumUsed, tallyE1 } from '../../../probes/74-archon-copilot/run.js';

const usage = (used) => ({ quota_snapshots: { premium_interactions: { entitlement: 200, remaining: 200 - used, credits_used: used, unlimited: false } } });

const record = (over = {}) => ({
  status: 'completed',
  nodes: [{
    nodeId: 'hello',
    state: 'completed',
    outputPreview: 'ok',
    execution: {
      binding: { provider: 'copilot', model: { requested: 'included-model' } },
      spend: { tokens: { source: 'provider', value: { input: 1200, output: 8 } }, costUsd: { source: 'unavailable', reason: 'not_reported' } },
    },
  }],
  ...over,
});

const refusedRead = [{ event: 'preToolUse', input: { toolName: 'view', toolArgs: { path: '/tmp/p/.env' } }, answer: 'deny' }];

const passing = { runRecord: record(), usageBefore: usage(37), usageAfter: usage(37), hookLog: refusedRead, skillSeen: true };
const item = (result, n) => result.items.find((i) => i.n === n);

test('premiumUsed reads the premium-request figure GitHub reports', () => {
  assert.equal(premiumUsed(usage(37)), 37);
  assert.equal(premiumUsed({}), null);
});

test('premiumDelta counts a rise of one as one', () => {
  assert.equal(premiumDelta(usage(37), usage(38)), 1);
  assert.equal(premiumDelta(usage(37), usage(37)), 0);
});

test('premiumDelta is unknown when either figure is missing', () => {
  assert.equal(premiumDelta(undefined, usage(38)), null);
});

test('tallyE1 passes all five items on a good run', () => {
  const result = tallyE1(passing);
  assert.deepEqual(result.items.map((i) => i.pass), [true, true, true, true, true]);
});

test('tallyE1 fails item 2 on any rise in premium requests', () => {
  assert.equal(item(tallyE1({ ...passing, usageAfter: usage(38) }), 2).pass, false);
});

test('tallyE1 fails item 2 when a figure could not be read', () => {
  assert.equal(item(tallyE1({ ...passing, usageAfter: null }), 2).pass, false);
});

test('tallyE1 checks item 2 against an allowance when one is given', () => {
  const result = tallyE1({ ...passing, usageAfter: usage(39), allowance: 2 });
  assert.equal(item(result, 2).pass, true);
  assert.equal(item(tallyE1({ ...passing, usageAfter: usage(40), allowance: 2 }), 2).pass, false);
});

test('tallyE1 fails item 1 when the run never started', () => {
  const result = tallyE1({ ...passing, runRecord: null });
  assert.equal(item(result, 1).pass, false);
  assert.equal(item(result, 4).pass, false);
});

test('tallyE1 fails item 1 when the step was not a Copilot step', () => {
  const r = record();
  r.nodes[0].execution.binding.provider = 'claude';
  assert.equal(item(tallyE1({ ...passing, runRecord: r }), 1).pass, false);
});

test('tallyE1 fails item 1 when the step failed', () => {
  const r = record({ status: 'failed' });
  r.nodes[0].state = 'failed';
  assert.equal(item(tallyE1({ ...passing, runRecord: r }), 1).pass, false);
});

test('tallyE1 fails item 4 when the record has no tokens for the step', () => {
  const r = record();
  r.nodes[0].execution.spend.tokens = { source: 'unavailable', reason: 'not_reported' };
  assert.equal(item(tallyE1({ ...passing, runRecord: r }), 4).pass, false);
});

test('tallyE1 passes item 3 only when the hook log shows the .env read refused', () => {
  assert.equal(item(tallyE1({ ...passing, hookLog: [] }), 3).pass, false);
  const allowed = [{ event: 'preToolUse', input: { toolName: 'view', toolArgs: { path: '/tmp/p/.env' } }, answer: 'allow' }];
  assert.equal(item(tallyE1({ ...passing, hookLog: allowed }), 3).pass, false);
  const other = [{ event: 'preToolUse', input: { toolName: 'view', toolArgs: { path: '/tmp/p/README.md' } }, answer: 'deny' }];
  assert.equal(item(tallyE1({ ...passing, hookLog: other }), 3).pass, false);
});

test('tallyE1 fails item 5 when the skill was not seen', () => {
  assert.equal(item(tallyE1({ ...passing, skillSeen: false }), 5).pass, false);
});
