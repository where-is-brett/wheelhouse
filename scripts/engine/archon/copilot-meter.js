// scripts/engine/archon/copilot-meter.js
// The spend meter's Copilot half (Archon design, section 10.1; checks 74 and 79). Archon reports no cost for a Copilot
// step, so the meter estimates: each attempt counts once at its model's rate (record.js). Once a day the estimate is
// checked against GitHub's own figure, the account's premium interactions from `gh api /copilot_internal/user` (the
// documented billing endpoint needs a scope the sign-in lacks, check 74), and GitHub's count is the true one. GitHub's
// figure covers the whole account, so the meter keeps the figure it first read each month as its starting point and
// compares what was used since then; a difference of more than one request is a line for the Logbook.
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
// How far the estimate may be from GitHub's count before the Logbook says so (spec 15's E6: within one request).
export const WITHIN = 1;

const whole = (n) => Number.isInteger(n) && n >= 0;

// GitHub's figure: { used, entitlement, remaining, resets } or null when it can't be read. `run` runs `gh` with the
// director's own sign-in.
export async function readGitHubFigure({ run }) {
  let got;
  try {
    got = await run('gh', ['api', '/copilot_internal/user']);
  } catch {
    return null;
  }
  if (got?.code !== 0) return null;
  let body;
  try { body = JSON.parse(got.stdout); } catch { return null; }
  const snap = body?.quota_snapshots?.premium_interactions;
  if (!whole(snap?.entitlement) || !whole(snap?.remaining)) return null;
  const used = whole(snap.credits_used) ? snap.credits_used : snap.entitlement - snap.remaining;
  return { used, entitlement: snap.entitlement, remaining: snap.remaining, resets: typeof body.quota_reset_date === 'string' ? body.quota_reset_date : null };
}

// One look at the meter. `read()` gives GitHub's figure (readGitHubFigure), `estimate()` the meter's own count of this
// month's requests, `kept` what the last look kept (null at first). Resolves with { kept, used, line }: `used` is the
// count the cap reads, GitHub's since the starting point where it has been read and else the larger of the two;
// `line` is the Logbook's words, or null.
export async function checkRequests({ read, estimate, kept = null, now = new Date() }) {
  const ours = estimate();
  const started = kept !== null && whole(kept.baseline) && whole(kept.last);
  // What the meter counted before GitHub's first reading (`estimateAt`) is outside GitHub's count since then, so it is
  // added to it.
  const before = started ? kept.estimateAt ?? 0 : 0;
  const soFar = started ? Math.max(ours, kept.last - kept.baseline + before) : ours;
  if (kept && now.getTime() - Date.parse(kept.at) < CHECK_EVERY_MS) return { kept, used: soFar, line: null };
  const figure = await read();
  if (figure === null) {
    // Asked again a day later, not at every look.
    const next = { ...(kept ?? { baseline: null, estimateAt: ours, resets: null, last: null }), at: now.toISOString() };
    return { kept: next, used: soFar, line: 'The meter couldn\'t read GitHub\'s figure for Copilot requests today, so its own estimate stands until it can.' };
  }
  // The first look, or a new month (GitHub's reset date moved, or its count went down): GitHub's figure is the
  // starting point.
  if (!started || (figure.resets !== null && figure.resets !== kept.resets) || figure.used < kept.last) {
    const fresh = { at: now.toISOString(), baseline: started ? 0 : figure.used, estimateAt: started ? 0 : ours, resets: figure.resets, last: figure.used };
    return { kept: fresh, used: Math.max(ours, figure.used - fresh.baseline), line: null };
  }
  const theirs = Math.max(0, figure.used - kept.baseline);
  const estimated = ours - (kept.estimateAt ?? 0);
  const line = Math.abs(theirs - estimated) > WITHIN
    ? `The meter estimated ${estimated} Copilot requests and GitHub counted ${theirs} since ${kept.at.slice(0, 10)}. GitHub's figure is the one that counts, and the cap reads it.`
    : null;
  return { kept: { ...kept, at: now.toISOString(), last: figure.used }, used: theirs + before, line };
}
