// scripts/lib/review-verdict.js
// Whether a signed review's record clears the head. The design (section 22, ruling of 24 October 2026) holds work back
// for BLOCKER and HIGH findings only; MEDIUM and LOW ones are deferred minors. A review record says it in its own
// signed data: `verdict` CLEAN, or FINDINGS with `findings` (all the findings) and `blocking` (those rated BLOCKER or
// HIGH). A FINDINGS record clears the head only when it carries `blocking` as a whole number and it is 0 with at least
// one finding. A record with no `blocking` (written before it existed, or by a path that does not give it) keeps the
// rule it had: only CLEAN clears. Read from the record's data alone, which the signature covers; nothing an agent
// writes elsewhere counts.
export function reviewClear(data) {
  if (data === null || typeof data !== 'object') return false;
  if (data.verdict === 'CLEAN') return true;
  return data.verdict === 'FINDINGS'
    && Number.isInteger(data.findings) && data.findings >= 1
    && Number.isInteger(data.blocking) && data.blocking === 0;
}

// The minors a record defers: the findings that are not blocking, or 0.
export function minorsOf(data) {
  return reviewClear(data) && data.verdict === 'FINDINGS' ? data.findings : 0;
}

// The findings a reviewer's message lists, counted by the severity each line starts with (`- BLOCKER: …`, `- HIGH: …`,
// `- MEDIUM: …`, `- LOW: …`, also numbered or in bold): `{ total, blocking }`. A report's `blocking` must equal this
// count of BLOCKER and HIGH lines, so the number it signs is the number it shows.
export function severityCounts(text) {
  let total = 0;
  let blocking = 0;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:[-*]|\d+[.)])\s+\**\[?(BLOCKER|HIGH|MEDIUM|LOW)\]?\**\s*[:\u2013\u2014-]/.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] === 'BLOCKER' || m[1] === 'HIGH') blocking += 1;
  }
  return { total, blocking };
}

// The step a review's counts lead to, and the line that says it (the feature CLI's `review` prints it). `total` is every
// finding and `blocking` those rated BLOCKER or HIGH, as `severityCounts` gives them; `round` is this review's number for
// its task (the first review is round 1, and the fix that follows it is fix round 1); `fixRounds` is how many fix rounds a
// task gets. No findings: clean. Findings but none blocking: only minors, deferred and the loop stopped, at any round.
// Blocking findings: a fix round while rounds are left, and the director's question once they are not.
export function reviewStep({ total, blocking, round, fixRounds }) {
  if (total === 0) return { step: 'clean', line: "Clean: the Lookout found nothing. This task's review is done; go on." };
  if (blocking === 0) {
    return { step: 'minors', line: `Only minors left (${total}): defer each in the ledger as deferred, do not fix them, and stop this task's review loop. Go on.` };
  }
  const found = blocking === 1 ? '1 blocking finding' : `${blocking} blocking findings`;
  if (round > fixRounds) {
    return { step: 'limit', line: `Round limit reached: ${found} ${blocking === 1 ? 'is' : 'are'} still open after ${fixRounds} fix rounds. Put them to the director as one question with ask; do not fix them yourself.` };
  }
  return { step: 'fix', line: `${found} to fix: fix round ${round} of ${fixRounds}. Fix them, defer the reply's MEDIUM and LOW findings as minors, then have a Lookout review again.` };
}
