// scripts/gate/conditions.js
import { reviewClear } from '../lib/review-verdict.js';
import { verify } from '../state/signing.js';
import { NO_HOST_APPROVAL } from '../host/host-approval.js';
import { holdSentence } from './open-questions.js';

// The reason a merge gives, in the answer's `hold`, while a decision on the piece is unanswered or answered but not yet applied.
export const WAITING_ON_DECISION = 'waiting-on-decision';

// The plain reason a merge waits on a decision, or null. `decisions` is { work, waiting } (what decisionsWaiting gave), or
// undefined where none is asked (a restore or a fix); given but unreadable, it holds, as the gate and the broker's permit both read it.
export function decisionReason(decisions) {
  if (decisions === undefined) return null;
  const waiting = decisions !== null && typeof decisions === 'object' && Array.isArray(decisions.waiting) ? decisions.waiting : null;
  if (waiting === null) return 'whether a decision is waiting on this work could not be checked';
  return waiting.length === 0 ? null : holdSentence(waiting, typeof decisions.work === 'string' && decisions.work !== '' ? decisions.work : 'this work');
}

// A review counts only if it verifies and clears the head (CLEAN, or findings none of which is a BLOCKER or HIGH: reviewClear). A plain record must also
// name the head commit. The carried form, { carried: true, record }, is a review
// of an earlier commit that the caller has already judged still counts (the
// feature's own changes did not move), so it need not name the head.
// With `kinds` an array (ruling P7-15), the record's `data.reviewKind` must be one of them too.
export function reviewCounts(entry, headSha, enrolled, kinds = null) {
  const carried = entry?.carried === true;
  const record = carried ? entry.record : entry;
  return record?.kind === 'review'
    && verify(record, enrolled)
    && reviewClear(record.data)
    && (carried || record.data?.commit === headSha)
    && (kinds === null || kinds.includes(record.data?.reviewKind));
}

// A check counts only if it verifies, names the head and the command now on the default branch, and passed; or, on a
// project whose tests aren't counting yet, was not counted.
export function checkCounts(entry, headSha, digest, enrolled, { notCounting = false } = {}) {
  return entry?.kind === 'check'
    && verify(entry, enrolled)
    && entry.data?.commit === headSha
    && entry.data?.command === digest
    && (entry.data?.result === 'passed' || (notCounting && entry.data?.result === 'not-counted'));
}

// The refusal where only a review of the kinds the agent's clean session gives counts, and none does.
export const NO_CLEAN_REVIEW = (short) => `no review of ${short} from a clean session: the helper's own Lookout hasn't passed it`;

// The review kinds that count: null (absent) for today's rule, which reads no kind; an array as given; anything
// else counts none, failing closed.
function reviewKindsOf(i) {
  if (i.reviewKinds === undefined || i.reviewKinds === null) return null;
  return Array.isArray(i.reviewKinds) ? i.reviewKinds.filter((k) => typeof k === 'string') : [];
}

// An approval counts only if it verifies and names the head commit: one of an earlier commit never carries
// over, so after an update the director approves the head again.
export function approvalCounts(entry, headSha, enrolled) {
  return entry?.kind === 'approval'
    && verify(entry, enrolled)
    && entry.data?.commit === headSha;
}

// Today's rule: only a signed approval counts.
const SIGNED_PROOF = 'signed-hook';
// Clicks in an agent's chat, which a project with real users never takes as an approval.
const CHAT_PROOFS = ['chat-click'];
// What a project with real users takes, the strongest first: the host's approval, the window.
const REAL_USER_PROOFS = ['host', 'window'];
const NEEDS_WORDS = { host: 'the director\'s approval on the code host', window: 'the director\'s click in Wheelhouse\'s window' };

// An unsigned approval (ruling P5-21): a card-answer labelled Approve naming the head commit, whose proof is a chat click the caller takes, on a project with no real users. Only the chat proofs
// count unsigned (ruling P5-48): the helper alone writes a card-answer naming a proof, but an unsigned record
// proves nothing more than a chat click, so a window's or the host's proof counts only signed.
function clickApproves(entry, headSha, proofs, realUsers) {
  const proof = entry?.data?.proof;
  return !realUsers
    && entry?.kind === 'card-answer'
    && entry.data?.label === 'Approve'
    && entry.data?.commit === headSha
    && CHAT_PROOFS.includes(proof) && proofs.includes(proof);
}

// Whether the approval given counts, and, when it doesn't on a project with real users, the proof it needs.
function approvalOf(i, headSha) {
  const proofs = Array.isArray(i.approvalProofs) ? i.approvalProofs : [SIGNED_PROOF];
  const realUsers = i.realUsers === true;
  // A signed approval counts where signed approvals do (today's rule), or where the proof it names is taken.
  const signedProof = i.approval?.data?.proof;
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

const isRelease = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && typeof x.release === 'string' && /^[0-9a-f]{40}$/.test(x.commit ?? '');

// The refusal's one sentence for a release's approval that is missing: it names the release and its commit, not the head.
function releaseApprovalReason(release) {
  return `no approval of the move from ${release.previous ?? 'the current release'} to ${release.release} (${release.commit.slice(0, 7)}) from the director's card for it`;
}

// Why the provenance check failed, or a plain fallback when the input has no reason.
function provenanceWhy(provenance) {
  const why = provenance?.why;
  return typeof why === 'string' && why !== '' ? why : 'it could not be checked';
}

// The incident condition passes when none is open, or when this merge is the
// open incident's fix. Anything else, malformed input included, refuses.
export function incidentReason(incident) {
  if (incident?.open === false) return null;
  if (incident?.open === true && incident.isFix === true) return null;
  const id = incident?.open === true && typeof incident.id === 'string' && incident.id !== '' ? incident.id : '';
  return id
    ? `incident ${id} is open, so only its fix may merge`
    : 'an incident is open or could not be checked, so only its fix may merge';
}

// Whether a change touches only the project's decision records (design section 6.6 of the director's way of working): every
// changed path is a Markdown file directly under docs/decisions/, and there is at least one. Narrow on purpose: the general
// rule for work that is internal only comes later (step 8), and this one names a folder and nothing else.
const DECISION_RECORD = /^docs\/decisions\/[^/]+\.md$/;
export function decisionsOnly(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  return paths.every((p) => typeof p === 'string' && DECISION_RECORD.test(p.replace(/\\/g, '/')) && !p.split(/[\\/]/).includes('..'));
}

// Pure. Takes what the caller gathered and says whether the merge may go ahead,
// with one plain reason for each condition that fails. Missing or malformed
// input fails the condition it belongs to: `stop` must be exactly false,
// `bypass` exactly false, `holdsLock` exactly true and `upToDate` exactly true to
// pass (null says the check could not be made); `provenance` must be { ok: true }
// and `incident` { open: false } or { open: true, isFix: true }. Never throws.
//
// `approvalProofs` (ruling P5-21) names the proofs an approval may carry, ['signed-hook'] when not given, which is
// today's rule: only a signed approval counts. With 'chat-click' among them, an unsigned
// card-answer labelled Approve naming the head counts too, unless `realUsers` is true: then only a signed
// approval naming a 'window' or 'host' proof counts, and the answer's `needs` names which one.
//
// `changedPaths` is the list of files the change touches, where the caller has read it; when every one is a decision record
// (decisionsOnly) the approval a piece's shown-first wish or the project's queue would have asked for is not asked.
//
// `hostApproval` is undefined where the person's approval on GitHub isn't needed, and otherwise passes only when exactly
// true (a review that couldn't be read is false).
//
// `decisions` is { work, waiting }, `waiting` being what decisionsWaiting gave (scripts/gate/open-questions.js). Any decision waiting
// refuses the merge, and the answer says `hold: 'waiting-on-decision'`. With no `decisions` given, none is asked.
//
// `reviewKinds` (ruling P7-15) names the kinds of review that count, null when not given, which is today's rule: any
// signed CLEAN review of the head counts, whatever its kind. Given a list, a review counts only if its
// `data.reviewKind` is in it, and a missing one is refused with NO_CLEAN_REVIEW; an empty list counts none.
export function gateDecision(input) {
  const i = input && typeof input === 'object' ? input : {};
  const headSha = typeof i.headSha === 'string' ? i.headSha : '';
  const short = headSha.slice(0, 7);
  const reasons = [];

  if (i.stop !== false) reasons.push('All stop is on');
  if (i.bypass !== false) reasons.push('the session is in bypass mode');
  if (i.holdsLock !== true) reasons.push('this computer no longer holds the lock');

  // 'none' (no pipeline) does not pass: a commit with no pipeline has not passed.
  const ciPassed = headSha !== '' && i.ci?.sha === headSha && i.ci?.state === 'success';
  if (!ciPassed) reasons.push(`CI has not passed on ${short}`);

  const guardrails = i.touchesGuardrails === true;
  const needReview = i.reviewRequired === true || guardrails;
  // A change that touches only the decision records (`changedPaths`, as the caller read them) asks for no approval of its own,
  // whatever else raised one for the piece; a guardrail, a release's card and every other condition stand.
  const recordsOnly = !guardrails && !isRelease(i.release) && decisionsOnly(i.changedPaths);
  const needApproval = (i.approvalRequired === true && !recordsOnly) || guardrails;

  const kinds = reviewKindsOf(i);
  if (needReview && !(headSha !== '' && reviewCounts(i.review, headSha, i.enrolled, kinds))) {
    reasons.push(kinds === null ? `no CLEAN review of ${short}` : NO_CLEAN_REVIEW(short));
  }
  // The change that moves a project to a Wheelhouse release that is not pins-only (update design, section 6.2) is approved by
  // the director's card for that release at that commit, and by no other approval: the caller gives `release`, { release,
  // commit, approved }, only for a change it has found to be exactly that and nothing else, and `approved` only for a signed
  // answer to that card.
  const byRelease = isRelease(i.release);
  let approved = { counts: true };
  if (needApproval) approved = byRelease ? { counts: i.release.approved === true } : approvalOf(i, headSha);
  const approvalMissing = !approved.counts;
  if (approvalMissing) reasons.push(byRelease ? releaseApprovalReason(i.release) : approvalReason(short, approved.needs));

  // The person's approval on the host, where the project needs it: undefined when it isn't needed, else exactly true to pass.
  if (i.hostApproval !== undefined && i.hostApproval !== true) reasons.push(NO_HOST_APPROVAL(short));

  // null: the check could not be made, which refuses as being behind does, with its own reason.
  if (i.upToDate === null) reasons.push('whether the branch is up to date could not be checked');
  else if (i.upToDate !== true) reasons.push('the branch is not up to date with the default branch');
  if (i.provenance?.ok !== true) {
    reasons.push(`what passed review is not what is on the pull request now: ${provenanceWhy(i.provenance)}`);
  }
  const incident = incidentReason(i.incident);
  if (incident) reasons.push(incident);
  // The decisions on the piece (design section 6.4), asked only where the caller gives them, so a merge that has none to ask (a
  // restore) leaves them out. Given but unreadable, it refuses.
  const decisionHold = decisionReason(i.decisions);
  const hold = decisionHold === null ? null : WAITING_ON_DECISION;
  if (decisionHold !== null) reasons.push(decisionHold);

  // `approvalMissing` marks the one condition a director's click on the head can meet, so the
  // caller can ask for that approval by name rather than by reading the reasons.
  return { allow: reasons.length === 0, reasons, ...(approvalMissing ? { approvalMissing: true } : {}), ...(approved.needs ? { needs: approved.needs } : {}), ...(hold === null ? {} : { hold }) };
}
