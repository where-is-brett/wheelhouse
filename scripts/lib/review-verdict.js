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
