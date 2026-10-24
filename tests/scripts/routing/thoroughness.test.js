// tests/scripts/routing/thoroughness.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, EFFORTS, COLUMNS, EXTRA, resolveRouting, levelOf, premiumOf } from '../../../scripts/routing/thoroughness.js';
import { readConfig, ROLES } from '../../../scripts/gate/guardrails.js';

const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
const PINS = { mostCapable: 'model-top', midSized: 'model-mid', premium: 'model-premium' };
const configWith = (extra) => readConfig(JSON.stringify({ ...base, ...extra }));
const pinned = configWith({ tiers: { pins: PINS } });
const ALL = ['lightest', 'lean', 'balanced', 'thorough'];
const cell = (cls, effort, more = {}) => ({ class: cls, effort, ...more });

test('levels and efforts', () => {
  assert.deepEqual(LEVELS, ALL);
  assert.deepEqual(EFFORTS, ['low', 'medium', 'high', 'xhigh']);
});

test('COLUMNS matches the design table cell for cell, and is frozen', () => {
  const M = 'mostCapable';
  const S = 'midSized';
  assert.deepEqual(COLUMNS.lightest, {
    foreman: cell(S, 'low'), feature: cell(S, 'high'), builderCritical: cell(S, 'high'), reviewerCritical: cell(S, 'high'),
    builder: cell(S, 'medium', { rework: 'high' }), tester: cell(S, 'medium'), mechanical: cell(S, 'low'), reviewer: cell(S, 'medium'),
  });
  assert.deepEqual(COLUMNS.lean, {
    foreman: cell(S, 'low'), feature: cell(M, 'medium'), builderCritical: cell(M, 'medium'), reviewerCritical: cell(M, 'high'),
    builder: cell(S, 'medium', { rework: 'high' }), tester: cell(S, 'medium'), mechanical: cell(S, 'low'), reviewer: cell(S, 'medium'),
  });
  assert.deepEqual(COLUMNS.balanced, {
    foreman: cell(S, 'medium'), feature: cell(M, 'high'), builderCritical: cell(M, 'high'), reviewerCritical: cell(M, 'high'),
    builder: cell(M, 'medium'), tester: cell(M, 'medium'), mechanical: cell(S, 'medium'), reviewer: cell(S, 'high'),
  });
  assert.deepEqual(COLUMNS.thorough, {
    foreman: cell(M, 'medium'), feature: cell(M, 'xhigh'), builderCritical: cell(M, 'xhigh'), reviewerCritical: cell(M, 'xhigh'),
    builder: cell(M, 'high'), tester: cell(M, 'high'), mechanical: cell(S, 'medium'), reviewer: cell(M, 'high'),
  });
  for (const level of ALL) {
    assert.ok(!('frontDesk' in COLUMNS[level]));
    assert.deepEqual(Object.keys(COLUMNS[level]).sort(), ROLES.filter((r) => r !== 'frontDesk').sort());
    assert.ok(Object.isFrozen(COLUMNS[level]));
    for (const c of Object.values(COLUMNS[level])) assert.ok(Object.isFrozen(c));
  }
  assert.ok(Object.isFrozen(COLUMNS));
});

test('EXTRA holds the extra checks', () => {
  const lean = { secondReviewer: false, trials: 3, screenshots: 'shown-first', builderCap: 1 };
  assert.deepEqual(EXTRA.lightest, lean);
  assert.deepEqual(EXTRA.lean, lean);
  assert.deepEqual(EXTRA.balanced, { secondReviewer: false, trials: 3, screenshots: 'visual', builderCap: null });
  assert.deepEqual(EXTRA.thorough, { secondReviewer: true, trials: 5, screenshots: 'every-size', builderCap: null });
  assert.ok(Object.isFrozen(EXTRA) && Object.isFrozen(EXTRA.lean));
});

test('an unknown level runs at Balanced, quietly', () => {
  for (const level of ['', 'max', undefined, null, 7]) {
    const r = resolveRouting({ config: pinned, level, ready: ALL });
    assert.equal(r.level, 'balanced');
    assert.deepEqual(r.lines, []);
  }
});

test('a level that is not ready runs at Balanced, with a line', () => {
  const r = resolveRouting({ config: pinned, level: 'lean', ready: ['balanced'] });
  assert.equal(r.level, 'balanced');
  assert.deepEqual(r.lines, ["Thoroughness: Lean isn't ready yet, so work runs at Balanced."]);
  assert.equal(r.roles.feature.model, 'model-top');
  assert.equal(resolveRouting({ config: pinned, level: 'thorough' }).lines[0], "Thoroughness: Thorough isn't ready yet, so work runs at Balanced.");
  const ok = resolveRouting({ config: pinned, level: 'lean', ready: ['lean'] });
  assert.equal(ok.level, 'lean');
  assert.deepEqual(ok.lines, []);
});

test('Balanced needs no ready entry', () => {
  assert.equal(resolveRouting({ config: pinned, level: 'balanced' }).level, 'balanced');
});

test('with no pins only Balanced runs, on the flat routing', () => {
  const config = configWith({ routing: { builder: 'model-flat', feature: 'model-feat' } });
  const r = resolveRouting({ config, level: 'lean', ready: ALL });
  assert.equal(r.level, 'balanced');
  assert.deepEqual(r.lines, ['Thoroughness: only Balanced until setup sets the models for each level.']);
  assert.deepEqual(r.roles.builder, { model: 'model-flat', effort: 'medium', fallback: null });
  assert.deepEqual(r.roles.feature, { model: 'model-feat', effort: 'high', fallback: null });
  assert.deepEqual(r.roles.reviewer, { model: null, effort: 'high', fallback: null });
  assert.deepEqual(r.extra, EXTRA.balanced);
  const quiet = resolveRouting({ config, level: 'balanced', ready: ALL });
  assert.deepEqual(quiet.lines, []);
  assert.deepEqual(quiet.roles, r.roles);
});

test('with pins, each cell takes its class\'s pin, and the other class is the fallback', () => {
  const r = resolveRouting({ config: pinned, level: 'lean', ready: ALL });
  assert.equal(r.level, 'lean');
  assert.deepEqual(r.roles.builder, { model: 'model-mid', effort: 'medium', fallback: 'model-top' });
  assert.deepEqual(r.roles.feature, { model: 'model-top', effort: 'medium', fallback: 'model-mid' });
  assert.deepEqual(r.roles.reviewerCritical, { model: 'model-top', effort: 'high', fallback: null });
  assert.deepEqual(r.extra, EXTRA.lean);
  assert.deepEqual(r.lines, []);
  assert.ok(!('frontDesk' in r.roles));
  assert.deepEqual(Object.keys(r.roles).sort(), Object.keys(COLUMNS.lean).sort());
});

test('a missing mid-sized pin sends its work to the most capable model, with a line', () => {
  const config = configWith({ tiers: { pins: { mostCapable: 'model-top' } } });
  const r = resolveRouting({ config, level: 'lean', ready: ALL });
  assert.equal(r.roles.builder.model, 'model-top');
  assert.equal(r.roles.builder.fallback, null);
  assert.equal(r.roles.feature.model, 'model-top');
  assert.deepEqual(r.lines, ["The lighter model isn't set, so its work runs on the most capable model."]);
});

test('a missing most capable pin uses the flat routing', () => {
  const config = configWith({ tiers: { pins: { midSized: 'model-mid' } }, routing: { feature: 'model-feat' } });
  const r = resolveRouting({ config, level: 'balanced', ready: ALL });
  assert.equal(r.roles.feature.model, 'model-feat');
  assert.equal(r.roles.builder.model, null);
  assert.equal(r.roles.reviewer.model, 'model-mid');
  assert.equal(r.roles.feature.fallback, null);
  assert.equal(r.roles.reviewer.fallback, null);
});

test('no fallback when it would equal the model', () => {
  const config = configWith({ tiers: { pins: { mostCapable: 'model-same', midSized: 'model-same' } } });
  const r = resolveRouting({ config, level: 'lean', ready: ALL });
  assert.equal(r.roles.builder.fallback, null);
  assert.equal(r.roles.feature.fallback, null);
});

const withPremium = (o) => resolveRouting({ config: pinned, level: 'thorough', ready: [...ALL, 'premium'], ...o });

test('the premium model: thorough, feature and builderCritical only, when paid from the plan', () => {
  const r = withPremium({ premium: 'paid-too' });
  for (const role of ['feature', 'builderCritical']) assert.deepEqual(r.roles[role], { model: 'model-premium', effort: 'high', fallback: 'model-top' });
  assert.deepEqual(r.roles.builder, { model: 'model-top', effort: 'high', fallback: 'model-mid' });
  assert.deepEqual(r.roles.reviewerCritical, { model: 'model-top', effort: 'xhigh', fallback: null });
  assert.deepEqual(r.lines, []);
  const plan = withPremium({ premium: 'within-plan', billing: 'within-plan' });
  assert.equal(plan.roles.feature.model, 'model-premium');
});

test('the premium model stays off unless every condition holds', () => {
  const credits = "Premium model not used: it might have been paid from credits.";
  for (const billing of ['unknown', 'credits']) {
    const r = withPremium({ premium: 'within-plan', billing });
    assert.equal(r.roles.feature.model, 'model-top');
    assert.equal(r.roles.feature.effort, 'xhigh');
    assert.deepEqual(r.lines, [credits]);
  }
  assert.equal(withPremium({ premium: 'off', billing: 'within-plan' }).roles.feature.model, 'model-top');
  assert.deepEqual(withPremium({ premium: 'off' }).lines, []);
  assert.equal(resolveRouting({ config: pinned, level: 'thorough', ready: ALL, premium: 'paid-too' }).roles.feature.model, 'model-top');
  assert.equal(resolveRouting({ config: configWith({ tiers: { pins: { mostCapable: 'model-top', midSized: 'model-mid' } } }), level: 'thorough', ready: [...ALL, 'premium'], premium: 'paid-too' }).roles.feature.model, 'model-top');
  for (const level of ['lightest', 'lean', 'balanced']) {
    const r = resolveRouting({ config: pinned, level, ready: [...ALL, 'premium'], premium: 'paid-too' });
    assert.notEqual(r.roles.feature.model, 'model-premium');
    assert.deepEqual(r.lines, []);
  }
});

test('levelOf and premiumOf read a settings view, falling back to the safe value', () => {
  assert.equal(levelOf({ efficiency: { value: 'lean' } }), 'lean');
  assert.equal(levelOf({ efficiency: { value: 'max' } }), 'balanced');
  assert.equal(levelOf({}), 'balanced');
  assert.equal(levelOf(undefined), 'balanced');
  assert.equal(premiumOf({ premium: { value: 'paid-too' } }), 'paid-too');
  assert.equal(premiumOf({ premium: { value: 'within-plan' } }), 'within-plan');
  assert.equal(premiumOf({ premium: { value: 'yes' } }), 'off');
  assert.equal(premiumOf({}), 'off');
  assert.equal(premiumOf(null), 'off');
});
