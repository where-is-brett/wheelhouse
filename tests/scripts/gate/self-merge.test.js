// tests/scripts/gate/self-merge.test.js
// Whether work merges by itself (design section 8 of the director's way of working): only when the checks are green, the signed
// review is clean, the change shows nothing users see and nothing at the director's level, no decision is open and intake did not
// mark the work visible. The helper's own decision-records change (step 4) is one case of it, with every one of its safeguards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateDecision, selfMergeDecision } from '../../../scripts/gate/conditions.js';
import { readEnrolled } from '../../../scripts/state/signing.js';

const ALL = {
  checksGreen: true, reviewClean: true, visible: false, unsure: false, directorLevel: [], decisionsOpen: false, intakeVisible: false,
  guardrails: false,
};

test('internal-only facts allow a merge by itself', () => {
  assert.deepEqual(selfMergeDecision(ALL), { allow: true, reasons: [], case: 'internal' });
});

test('visible or unsure work waits, and so does anything missing or malformed', () => {
  assert.equal(selfMergeDecision({ ...ALL, visible: true }).allow, false);
  assert.equal(selfMergeDecision({ ...ALL, unsure: true }).allow, false);
  for (const key of Object.keys(ALL)) {
    const without = { ...ALL };
    delete without[key];
    assert.equal(selfMergeDecision(without).allow, false, `${key} missing`);
  }
  for (const [key, value] of [['checksGreen', 'true'], ['reviewClean', 1], ['visible', 0], ['unsure', null], ['directorLevel', null], ['decisionsOpen', 'no'], ['intakeVisible', undefined]]) {
    assert.equal(selfMergeDecision({ ...ALL, [key]: value }).allow, false, key);
  }
  assert.equal(selfMergeDecision(null).allow, false);
  assert.equal(selfMergeDecision(undefined).allow, false);
});

test('work intake marked visible waits even if the change looks internal', () => {
  const got = selfMergeDecision({ ...ALL, intakeVisible: true });
  assert.equal(got.allow, false);
  assert.match(got.reasons.join(' '), /intake/);
});

test('director-level facts make it wait', () => {
  const got = selfMergeDecision({ ...ALL, directorLevel: [{ kind: 'data-model', paths: ['db/migrations/1.sql'] }] });
  assert.equal(got.allow, false);
  assert.match(got.reasons.join(' '), /data-model/);
  assert.equal(selfMergeDecision({ ...ALL, decisionsOpen: true }).allow, false);
  assert.equal(selfMergeDecision({ ...ALL, reviewClean: false }).allow, false);
  assert.equal(selfMergeDecision({ ...ALL, checksGreen: false }).allow, false);
  assert.equal(selfMergeDecision({ ...ALL, guardrails: true }).allow, false);
});

const RECORDS = ['docs/decisions/2026-11-07-which-provider.md'];
const BATCH = { batch: true, changedPaths: RECORDS, guardrails: false };

test('the helper\'s own decision-records change is one case, with its safeguards', () => {
  assert.deepEqual(selfMergeDecision(BATCH), { allow: true, reasons: [], case: 'batch' });
  // The caller's say never makes one: it needs batch exactly true, every path a decision record, no guardrail, no release.
  for (const bad of [
    { ...BATCH, batch: undefined }, { ...BATCH, batch: 'true' }, { ...BATCH, batch: false },
    { ...BATCH, changedPaths: [...RECORDS, 'src/a.js'] }, { ...BATCH, changedPaths: [] },
    { ...BATCH, guardrails: true }, { ...BATCH, guardrails: undefined },
    { ...BATCH, release: { release: 'v1', commit: 'a'.repeat(40) } },
  ]) assert.equal(selfMergeDecision(bad).allow, false, JSON.stringify(bad));
});

const gate = (extra = {}) => ({
  stop: false, bypass: false, holdsLock: true, headSha: 'abcdef1234567890abcdef1234567890abcdef12',
  ci: { sha: 'abcdef1234567890abcdef1234567890abcdef12', state: 'success' },
  reviewRequired: false, review: null, approvalRequired: true, approval: null, touchesGuardrails: false, enrolled: readEnrolled(),
  upToDate: true, provenance: { ok: true }, incident: { open: false }, ...extra,
});

test('the gate still asks a feature change of decision records for the approval the caller asked for', () => {
  const lowered = gateDecision(gate(BATCH));
  assert.deepEqual(lowered, { allow: true, reasons: [] });
  const feature = gateDecision(gate({ changedPaths: RECORDS }));
  assert.equal(feature.allow, false);
  assert.equal(feature.approvalMissing, true);
  const claimed = gateDecision(gate({ batch: true, changedPaths: [...RECORDS, 'src/a.js'] }));
  assert.equal(claimed.approvalMissing, true);
});
