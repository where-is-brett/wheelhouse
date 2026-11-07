// tests/scripts/gate/decision-hold.test.js
// The gate holds a pull request while a decision on its work is unanswered, or answered but not yet applied (design section 6.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gateDecision, WAITING_ON_DECISION } from '../../../scripts/gate/conditions.js';
import { decisionsWaiting, markAnswerHead, markHandled, readAnswerHeads, readHandled } from '../../../scripts/gate/open-questions.js';

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const WORK = 'w-tide-1';
const ID = 'q-w-tide-1-1';
const answered = (label, at) => ({ question: { data: { work: WORK, recommendation: 'Weekly' } }, answer: label === null ? null : { label, at } });
const viewsOf = (entry) => ({ questions: { [ID]: entry } });
const review = (at) => ({ kind: 'review', at, data: { verdict: 'CLEAN' } });
const REVIEWED = review('2026-11-08T10:00:00.000Z');

const gate = (waiting) => gateDecision({
  stop: false, bypass: false, holdsLock: true, headSha: SHA, ci: { sha: SHA, state: 'success' },
  reviewRequired: false, approvalRequired: false, touchesGuardrails: false,
  upToDate: true, provenance: { ok: true }, incident: { open: false },
  decisions: { work: WORK, waiting },
});

function handledDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decision-hold-'));
}

test('a pull request with an unanswered decision is refused with waiting-on-decision', () => {
  const waiting = decisionsWaiting({ views: viewsOf(answered(null)), work: WORK, review: REVIEWED, handled: {} });
  assert.deepEqual(waiting, [{ id: ID, why: 'open' }]);
  const got = gate(waiting);
  assert.equal(got.allow, false);
  assert.equal(got.hold, WAITING_ON_DECISION);
  assert.equal(WAITING_ON_DECISION, 'waiting-on-decision');
  assert.match(got.reasons.join('; '), /the director has a question open on w-tide-1/);
});

test('answered with another option but not yet applied is still refused', () => {
  // Answered before the head was reviewed, which would let an answer that matches the recommendation through; this one differs.
  const views = viewsOf(answered('Daily', '2026-11-08T09:00:00.000Z'));
  const waiting = decisionsWaiting({ views, work: WORK, review: REVIEWED, handled: {} });
  assert.deepEqual(waiting, [{ id: ID, why: 'unapplied' }]);
  const got = gate(waiting);
  assert.equal(got.allow, false);
  assert.equal(got.hold, WAITING_ON_DECISION);
  assert.match(got.reasons.join('; '), /chose something other than what w-tide-1 was built on/);
  // Reviewing the head again does not stand in for applying the answer.
  assert.equal(decisionsWaiting({ views, work: WORK, review: review('2026-11-08T12:00:00.000Z'), handled: {} }).length, 1);
});

test('answered and applied is allowed', () => {
  const dir = handledDir();
  try {
    const at = '2026-11-08T09:00:00.000Z';
    const views = viewsOf(answered('Daily', at));
    assert.equal(markHandled(dir, ID, at), true);
    const waiting = decisionsWaiting({ views, work: WORK, review: REVIEWED, handled: readHandled(dir, [ID]) });
    assert.deepEqual(waiting, []);
    assert.deepEqual(gate(waiting), { allow: true, reasons: [] });
    // The director changes their mind: the mark covered the earlier answer only.
    const changed = viewsOf(answered('Monthly', '2026-11-08T11:00:00.000Z'));
    assert.equal(decisionsWaiting({ views: changed, work: WORK, review: REVIEWED, handled: readHandled(dir, [ID]) }).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('marking the rework applied does not lift the hold without a review of the head made after the answer', () => {
  const dir = handledDir();
  try {
    const at = '2026-11-08T09:00:00.000Z';
    const views = viewsOf(answered('Daily', at));
    markHandled(dir, ID, at);
    const handled = readHandled(dir, [ID]);
    const held = { id: ID, why: 'unapplied' };
    // No review at all, a review from before the answer (the head the piece was built on), or one at the same moment.
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: null, handled }), [held]);
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: review('2026-11-08T08:00:00.000Z'), handled }), [held]);
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: review(at), handled }), [held]);
    // A review carried from an earlier head keeps its own time, so it does not count either.
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: { carried: true, record: review('2026-11-08T08:00:00.000Z') }, handled }), [held]);
    // The rework's new head, reviewed after the answer, with the mark: allowed.
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: review('2026-11-08T10:00:00.000Z'), handled }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a review of the head the answer was recorded on does not lift the hold, marked applied or not; one of a new head does', () => {
  const dir = handledDir();
  const heads = handledDir();
  try {
    const at = '2026-11-08T09:00:00.000Z';
    const views = viewsOf(answered('Daily', at));
    markHandled(dir, ID, at);
    assert.equal(markAnswerHead(heads, ID, at, 'a'.repeat(40)), true);
    assert.equal(markAnswerHead(heads, ID, at, 'b'.repeat(40)), false, 'kept once for an answer\'s time');
    const handled = readHandled(dir, [ID]);
    const answerHeads = readAnswerHeads(heads, [ID]);
    assert.deepEqual(answerHeads, { [ID]: { at, sha: 'a'.repeat(40) } });
    const reviewOf = (commit, when) => ({ kind: 'review', at: when, data: { verdict: 'CLEAN', commit } });
    const held = [{ id: ID, why: 'unapplied' }];
    // The old head, reviewed after the answer, and the mark made: still held.
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: reviewOf('a'.repeat(40), '2026-11-08T10:00:00.000Z'), handled, answerHeads }), held);
    // A review that names no head can't show a new one.
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: review('2026-11-08T10:00:00.000Z'), handled, answerHeads }), held);
    // The rework's head, reviewed after the answer: allowed. Without a recorded head (an older answer) the review's time alone rules.
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: reviewOf('b'.repeat(40), '2026-11-08T10:00:00.000Z'), handled, answerHeads }), []);
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: reviewOf('a'.repeat(40), '2026-11-08T10:00:00.000Z'), handled }), []);
    // A head kept for an earlier answer says nothing of a changed one.
    const changed = viewsOf(answered('Monthly', '2026-11-08T09:30:00.000Z'));
    markHandled(dir, ID, '2026-11-08T09:30:00.000Z');
    assert.deepEqual(decisionsWaiting({ views: changed, work: WORK, review: reviewOf('a'.repeat(40), '2026-11-08T10:00:00.000Z'), handled: readHandled(dir, [ID]), answerHeads }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(heads, { recursive: true, force: true });
  }
});

test('answered with the recommendation and --no-change is allowed', () => {
  const dir = handledDir();
  try {
    const at = '2026-11-08T11:00:00.000Z';
    const views = viewsOf(answered('Weekly', at));
    // Answered after the head was reviewed and not yet acted on: held, as an answer to the recommendation has always been.
    assert.deepEqual(decisionsWaiting({ views, work: WORK, review: REVIEWED, handled: {} }), [{ id: ID, why: 'late' }]);
    assert.equal(gate(decisionsWaiting({ views, work: WORK, review: REVIEWED, handled: {} })).hold, WAITING_ON_DECISION);
    markHandled(dir, ID, at);
    assert.deepEqual(gate(decisionsWaiting({ views, work: WORK, review: REVIEWED, handled: readHandled(dir, [ID]) })), { allow: true, reasons: [] });
    // Answered with the recommendation before the head was reviewed: nothing to do.
    assert.deepEqual(decisionsWaiting({ views: viewsOf(answered('Weekly', '2026-11-08T09:00:00.000Z')), work: WORK, review: REVIEWED, handled: {} }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing waiting, or odd input, holds nothing and never throws', () => {
  assert.deepEqual(gate([]), { allow: true, reasons: [] });
  assert.equal(gateDecision({ decisions: 'x' }).allow, false);
  assert.deepEqual(decisionsWaiting({ views: null, work: undefined, review: undefined }), []);
});
