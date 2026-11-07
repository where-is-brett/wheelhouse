// tests/scripts/gate/decisions-only.test.js
// A change that touches only docs/decisions/ (the day's decision records) asks for no approval, whatever else would have raised
// one for the piece. Anything that touches another file is judged as before. The rule is narrow: it lowers the approval
// condition and nothing else.
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

test('decisionsOnly is true only for markdown files directly under docs/decisions/', () => {
  assert.equal(decisionsOnly(['docs/decisions/2026-11-07-which-provider.md']), true);
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
  const only = gateDecision(input({ changedPaths: ['docs/decisions/2026-11-07-which-provider.md'] }));
  assert.deepEqual(only, { allow: true, reasons: [] });

  const more = gateDecision(input({ changedPaths: ['docs/decisions/2026-11-07-which-provider.md', 'src/app.js'] }));
  assert.equal(more.allow, false);
  assert.equal(more.approvalMissing, true);
  assert.match(more.reasons[0], /^no approval of abcdef1/);

  // No paths given is the rule as it was: the approval is asked for.
  assert.equal(gateDecision(input()).allow, false);
});

test('the rule lowers the approval condition and nothing else', () => {
  const paths = ['docs/decisions/a.md'];
  // A guardrail change, a release and a failed check are all still refused.
  assert.equal(gateDecision(input({ changedPaths: paths, touchesGuardrails: true })).allow, false);
  assert.equal(gateDecision(input({ changedPaths: paths, ci: { sha: SHA, state: 'failure' } })).allow, false);
  assert.equal(gateDecision(input({ changedPaths: paths, reviewRequired: true, review: null })).allow, false);
  assert.equal(gateDecision(input({ changedPaths: paths, stop: true })).allow, false);
  assert.equal(gateDecision(input({ changedPaths: paths, release: { release: 'v1', commit: SHA, approved: false } })).allow, false);
});
