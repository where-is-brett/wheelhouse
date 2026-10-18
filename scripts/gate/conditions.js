// scripts/gate/conditions.js
import { verify } from '../state/signing.js';

// A review counts only if it verifies, says CLEAN and names the head commit.
function reviewCounts(record, headSha, enrolled) {
  return record?.kind === 'review'
    && verify(record, enrolled)
    && record.data?.verdict === 'CLEAN'
    && record.data?.commit === headSha;
}

// An approval counts only if it verifies and names the head commit.
function approvalCounts(record, headSha, enrolled) {
  return record?.kind === 'approval'
    && verify(record, enrolled)
    && record.data?.commit === headSha;
}

// Pure. Takes what the caller gathered and says whether the merge may go ahead,
// with one plain reason for each condition that fails. Missing or malformed
// input fails the condition it belongs to: `stop` must be exactly false,
// `bypass` exactly false and `holdsLock` exactly true to pass. Never throws.
export function gateDecision(input) {
  const i = input && typeof input === 'object' ? input : {};
  const headSha = typeof i.headSha === 'string' ? i.headSha : '';
  const short = headSha.slice(0, 7);
  const reasons = [];

  if (i.stop !== false) reasons.push('STOP is on');
  if (i.bypass !== false) reasons.push('the session is in bypass mode');
  if (i.holdsLock !== true) reasons.push('this computer no longer holds the lock');

  // 'none' (no pipeline) does not pass: a commit with no pipeline has not passed.
  const ciPassed = headSha !== '' && i.ci?.sha === headSha && i.ci?.state === 'success';
  if (!ciPassed) reasons.push(`CI has not passed on ${short}`);

  const guardrails = i.touchesGuardrails === true;
  const needReview = i.reviewRequired === true || guardrails;
  const needApproval = i.approvalRequired === true || guardrails;

  if (needReview && !(headSha !== '' && reviewCounts(i.review, headSha, i.enrolled))) {
    reasons.push(`no CLEAN review of ${short}`);
  }
  if (needApproval && !(headSha !== '' && approvalCounts(i.approval, headSha, i.enrolled))) {
    reasons.push(`no approval of ${short}`);
  }

  return { allow: reasons.length === 0, reasons };
}
