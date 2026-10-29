// tests/probes/79-archon-spend/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepSpend, estimatePremium, promptsPerNode } from '../../../probes/79-archon-spend/run.js';

const node = (nodeId, provider, model, tokens, cost, extra = {}) => ({
  nodeId,
  state: 'completed',
  execution: {
    binding: provider ? { provider, model: { requested: model, resolved: provider === 'claude' ? { source: 'provider', value: `${model}-resolved` } : undefined } } : {},
    spend: {
      tokens: tokens ? { source: 'provider', value: tokens } : { source: 'unavailable', reason: 'not_applicable' },
      costUsd: cost === undefined ? { source: 'unavailable', reason: 'not_reported' } : { source: 'provider', value: cost },
    },
    attempt: { id: extra.attempt ?? `${nodeId}-a1` },
    invocation: { id: extra.invocation ?? `${nodeId}-i1`, loopPath: extra.loopPath ?? [] },
  },
});

const record = {
  nodes: [
    node('bash', null, null, null, undefined),
    node('plan', 'claude', 'mid', { input: 1000, output: 50, cacheRead: 10, cacheWrite: 5 }, 0.012),
    node('build', 'copilot', 'auto', { input: 900, output: 40 }, undefined),
  ],
};

test('stepSpend reads tokens and cost per node from workflow get --json --verbose', () => {
  const steps = stepSpend(record);
  assert.equal(steps.length, 2, 'a step with no provider is not an AI step');
  const plan = steps.find((s) => s.node === 'plan');
  assert.equal(plan.provider, 'claude');
  assert.equal(plan.model, 'mid-resolved');
  assert.equal(plan.tokens, 1065);
  assert.equal(plan.costUsd, 0.012);
  assert.equal(plan.source, 'reported');
});

test('stepSpend marks Copilot cost as unavailable, never zero', () => {
  const build = stepSpend(record).find((s) => s.node === 'build');
  assert.equal(build.costUsd, null);
  assert.notEqual(build.costUsd, 0);
  assert.equal(build.source, 'unavailable');
  assert.equal(build.model, 'auto');
  assert.equal(build.tokens, 940);
});

test('stepSpend of a missing record is empty', () => {
  assert.deepEqual(stepSpend(null), []);
});

test('estimatePremium counts a retried attempt as a second prompt', () => {
  const steps = [{ provider: 'copilot', model: 'auto', prompts: 1 }, { provider: 'copilot', model: 'auto', prompts: 2 }];
  assert.equal(estimatePremium(steps, { auto: 1 }), 3);
});

test('estimatePremium counts an included model as zero', () => {
  assert.equal(estimatePremium([{ provider: 'copilot', model: 'free', prompts: 4 }], { free: 0 }), 0);
});

test('estimatePremium skips Claude steps and applies multipliers', () => {
  const steps = [{ provider: 'claude', model: 'mid', prompts: 9 }, { provider: 'copilot', model: 'big', prompts: 2 }];
  assert.equal(estimatePremium(steps, { big: 1.5 }), 3);
});

test('estimatePremium refuses a model with no known multiplier rather than counting it as zero', () => {
  assert.throws(() => estimatePremium([{ provider: 'copilot', model: 'mystery', prompts: 1 }], {}), /mystery/);
});

test('promptsPerNode counts each attempt and each loop round of a node as a prompt', () => {
  const r = {
    nodes: [
      node('build', 'copilot', 'auto', { input: 1, output: 1 }, undefined, { attempt: 'a1', invocation: 'i1' }),
      node('build', 'copilot', 'auto', { input: 1, output: 1 }, undefined, { attempt: 'a2', invocation: 'i1' }),
      node('loop', 'copilot', 'auto', { input: 1, output: 1 }, undefined, { attempt: 'b1', invocation: 'j1', loopPath: [1] }),
      node('loop', 'copilot', 'auto', { input: 1, output: 1 }, undefined, { attempt: 'b2', invocation: 'j2', loopPath: [2] }),
    ],
  };
  assert.deepEqual(promptsPerNode(r), { build: 2, loop: 2 });
});
