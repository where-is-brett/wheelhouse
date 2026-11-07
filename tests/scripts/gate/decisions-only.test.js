// tests/scripts/gate/decisions-only.test.js
// The helper's own change that adds the day's decision records (verified by the helper: its branch, its kept head, the default
// branch as base) asks for no approval when it touches only docs/decisions/. Nothing else lowers the bar: a caller's request for
// an approval, a feature branch's decision files, a guardrail, a release and every other condition stand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionsOnly, gateDecision } from '../../../scripts/gate/conditions.js';
import { readEnrolled } from '../../../scripts/state/signing.js';

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const input = (extra = {}) => ({
  stop: false, bypass: false, holdsLock: true, headSha: SHA,
  ci: { sha: SHA, state: 'success' },
  reviewRequired: false, review: null, approvalRequired: true, approval: null,
  touchesGuardrails: false, enrolled: readEnrolled(),
  upToDate: true, provenance: { ok: true }, incident: { open: false }, ...extra,
});
const ONLY = ['docs/decisions/2026-11-07-which-provider.md'];

test('decisionsOnly is true only for markdown files directly under docs/decisions/', () => {
  assert.equal(decisionsOnly(ONLY), true);
  assert.equal(decisionsOnly(['docs/decisions/a.md', 'docs/decisions/b.md']), true);
  for (const paths of [
    [], undefined, null, 'docs/decisions/a.md',
    ['docs/decisions/a.md', 'src/app.js'],
    ['docs/decisions/sub/a.md'],
    ['docs/decisions/a.txt'],
    ['docs/decisions/../../src/app.js'],
    ['docs/decisions.md'],
    ['xdocs/decisions/a.md'],
    ['docs/decisions/'],
  ]) assert.equal(decisionsOnly(paths), false, JSON.stringify(paths));
});

test('the gate lets a decisions-only change merge with no approval and refuses one that touches anything else', () => {
  assert.deepEqual(gateDecision(input({ batch: true, changedPaths: ONLY })), { allow: true, reasons: [] });

  const more = gateDecision(input({ batch: true, changedPaths: [...ONLY, 'src/app.js'] }));
  assert.equal(more.allow, false);
  assert.equal(more.approvalMissing, true);
  assert.match(more.reasons[0], /^no approval of abcdef1/);
});

test('decision files alone do not lower the bar unless the helper verified the change as its own batch', () => {
  // A feature branch's change, or a caller that asked for an approval: the paths alone change nothing.
  assert.equal(gateDecision(input({ changedPaths: ONLY })).allow, false);
  assert.equal(gateDecision(input({ batch: false, changedPaths: ONLY })).allow, false);
  assert.equal(gateDecision(input({ batch: 'yes', changedPaths: ONLY })).allow, false);
  assert.equal(gateDecision(input({ batch: true })).allow, false);
  assert.equal(gateDecision(input()).allow, false);
});

test('the rule lowers the approval condition and nothing else', () => {
  const batch = { batch: true, changedPaths: ONLY };
  assert.equal(gateDecision(input({ ...batch, touchesGuardrails: true })).allow, false);
  assert.equal(gateDecision(input({ ...batch, ci: { sha: SHA, state: 'failure' } })).allow, false);
  assert.equal(gateDecision(input({ ...batch, reviewRequired: true, review: null })).allow, false);
  assert.equal(gateDecision(input({ ...batch, stop: true })).allow, false);
  assert.equal(gateDecision(input({ ...batch, release: { release: 'v1', commit: SHA, approved: false } })).allow, false);
});
