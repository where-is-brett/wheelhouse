// scripts/gate/conditions.js
import { verify } from '../state/signing.js';

// A review counts only if it verifies and says CLEAN. A plain record must also
// name the head commit. The carried form, { carried: true, record }, is a review
// of an earlier commit that the caller has already judged still counts (the
// feature's own changes did not move), so it need not name the head.
function reviewCounts(entry, headSha, enrolled) {
  const carried = entry?.carried === true;
  const record = carried ? entry.record : entry;
  return record?.kind === 'review'
    && verify(record, enrolled)
    && record.data?.verdict === 'CLEAN'
    && (carried || record.data?.commit === headSha);
}

// An approval counts only if it verifies and names the head commit, or is the
// carried form, as for a review.
function approvalCounts(entry, headSha, enrolled) {
  const carried = entry?.carried === true;
  const record = carried ? entry.record : entry;
  return record?.kind === 'approval'
    && verify(record, enrolled)
    && (carried || record.data?.commit === headSha);
}

// Why the provenance check failed, or a plain fallback when the input has no reason.
function provenanceWhy(provenance) {
  const why = provenance?.why;
  return typeof why === 'string' && why !== '' ? why : 'it could not be checked';
}

// The incident condition passes when none is open, or when this merge is the
// open incident's fix. Anything else, malformed input included, refuses.
function incidentReason(incident) {
  if (incident?.open === false) return null;
  if (incident?.open === true && incident.isFix === true) return null;
  const id = incident?.open === true && typeof incident.id === 'string' && incident.id !== '' ? incident.id : '';
  return id
    ? `incident ${id} is open, so only its fix may merge`
    : 'an incident is open or could not be checked, so only its fix may merge';
}

// Pure. Takes what the caller gathered and says whether the merge may go ahead,
// with one plain reason for each condition that fails. Missing or malformed
// input fails the condition it belongs to: `stop` must be exactly false,
// `bypass` exactly false, `holdsLock` exactly true and `upToDate` exactly true to
// pass; `provenance` must be { ok: true } and `incident` { open: false } or
// { open: true, isFix: true }. Never throws.
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

  if (i.upToDate !== true) reasons.push('the branch is not up to date with the default branch');
  if (i.provenance?.ok !== true) {
    reasons.push(`the pull request's provenance does not match the manifest: ${provenanceWhy(i.provenance)}`);
  }
  const incident = incidentReason(i.incident);
  if (incident) reasons.push(incident);

  return { allow: reasons.length === 0, reasons };
}
