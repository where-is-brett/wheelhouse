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

// Today's rule: only a signed approval counts.
const SIGNED_PROOF = 'signed-hook';
// Clicks in an agent's chat, which a project with real users never takes as an approval.
const CHAT_PROOFS = ['chat-click', 'hook-click'];
// What a project with real users takes, the strongest first: the host's approval, the add-on's button, the window.
const REAL_USER_PROOFS = ['host', 'add-on', 'window'];
const NEEDS_WORDS = { host: 'the director\'s approval on the code host', 'add-on': 'the director\'s click on the add-on\'s button', window: 'the director\'s click in Wheelhouse\'s window' };

// An unsigned approval (ruling P5-21): a card-answer labelled Approve naming the head commit, or the carried
// form, whose proof is one the caller takes. A click in the chat counts only where the project has no real users.
function clickApproves(entry, headSha, proofs, realUsers) {
  const carried = entry?.carried === true;
  const record = carried ? entry.record : entry;
  const proof = record?.data?.proof;
  return record?.kind === 'card-answer'
    && record.data?.label === 'Approve'
    && (carried || record.data?.commit === headSha)
    && typeof proof === 'string' && proof !== SIGNED_PROOF && proofs.includes(proof)
    && !(realUsers && CHAT_PROOFS.includes(proof));
}

// Whether the approval given counts, and, when it doesn't on a project with real users, the proof it needs.
function approvalOf(i, headSha) {
  const proofs = Array.isArray(i.approvalProofs) ? i.approvalProofs : [SIGNED_PROOF];
  const realUsers = i.realUsers === true;
  // A signed approval counts where signed approvals do (today's rule), or where the proof it names is taken.
  const signedProof = (i.approval?.carried === true ? i.approval.record : i.approval)?.data?.proof;
  const signedTaken = proofs.includes(SIGNED_PROOF) || (typeof signedProof === 'string' && proofs.includes(signedProof) && !(realUsers && CHAT_PROOFS.includes(signedProof)));
  const counts = headSha !== ''
    && ((signedTaken && approvalCounts(i.approval, headSha, i.enrolled)) || clickApproves(i.approval, headSha, proofs, realUsers));
  if (counts) return { counts: true };
  if (!realUsers || !proofs.some((p) => CHAT_PROOFS.includes(p))) return { counts: false };
  return { counts: false, needs: REAL_USER_PROOFS.find((p) => proofs.includes(p)) ?? 'window' };
}

// The refusal's one sentence for an approval that is missing.
function approvalReason(short, needs) {
  return needs === undefined
    ? `no approval of ${short}`
    : `no approval of ${short} that counts: the project has real users, so a click in the chat isn't enough and it needs ${NEEDS_WORDS[needs]}`;
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
// pass (null says the check could not be made); `provenance` must be { ok: true }
// and `incident` { open: false } or { open: true, isFix: true }. Never throws.
//
// `approvalProofs` (ruling P5-21) names the proofs an approval may carry, ['signed-hook'] when not given, which is
// today's rule: only a signed approval counts. With 'chat-click' or 'hook-click' among them, an unsigned
// card-answer labelled Approve naming the head counts too, unless `realUsers` is true: then only a 'window',
// 'add-on' or 'host' proof counts, and the answer's `needs` names which one the merge needs.
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
  const approved = needApproval ? approvalOf(i, headSha) : { counts: true };
  const approvalMissing = !approved.counts;
  if (approvalMissing) reasons.push(approvalReason(short, approved.needs));

  // null: the check could not be made, which refuses as being behind does, with its own reason.
  if (i.upToDate === null) reasons.push('whether the branch is up to date could not be checked');
  else if (i.upToDate !== true) reasons.push('the branch is not up to date with the default branch');
  if (i.provenance?.ok !== true) {
    reasons.push(`the pull request's provenance does not match the manifest: ${provenanceWhy(i.provenance)}`);
  }
  const incident = incidentReason(i.incident);
  if (incident) reasons.push(incident);

  // `approvalMissing` marks the one condition a director's click on the head can meet, so the
  // caller can ask for that approval by name rather than by reading the reasons.
  return { allow: reasons.length === 0, reasons, ...(approvalMissing ? { approvalMissing: true } : {}), ...(approved.needs ? { needs: approved.needs } : {}) };
}

// Pure. A Lean merge (ruling P5-21): no host, so none of the host's conditions (CI, the lock, provenance, an
// incident). STOP must be exactly false; the approval counts as in gateDecision, the director's approval being
// always needed; `tests` must be exactly true (the project's tests passed at `headSha`); and `mainMoved` exactly
// false (the main branch hasn't moved since the tests ran). Never throws.
export function leanMergeDecision(input) {
  const i = input && typeof input === 'object' ? input : {};
  const headSha = typeof i.headSha === 'string' ? i.headSha : '';
  const short = headSha.slice(0, 7);
  const reasons = [];
  if (i.stop !== false) reasons.push('STOP is on');
  const approved = approvalOf(i, headSha);
  if (!approved.counts) reasons.push(approvalReason(short, approved.needs));
  if (i.tests !== true) reasons.push(`the tests have not passed on ${short}`);
  if (i.mainMoved !== false) reasons.push('the main branch has moved since the tests ran, so they must run again');
  return { allow: reasons.length === 0, reasons, ...(approved.counts ? {} : { approvalMissing: true }), ...(approved.needs ? { needs: approved.needs } : {}) };
}
