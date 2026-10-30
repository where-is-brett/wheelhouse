// scripts/engine/archon/copilot-meter.js
// The spend meter's Copilot half (Archon design, section 10.1; checks 74 and 79). Archon reports no cost for a Copilot
// step, so the meter estimates: each attempt counts once at its model's rate (record.js). Once a day the estimate is
// checked against GitHub's own figure, the account's premium interactions from `gh api /copilot_internal/user` (the
// documented billing endpoint needs a scope the sign-in lacks, check 74), and GitHub's count is the true one. GitHub's
// figure covers the whole account, so the meter keeps the figure it first read each month as its starting point and
// compares what was used since then; a difference of more than one request is a line for the Logbook. The figure is
// the account's, so the meter is too: requestsFile names one file for the account, and every project on it shares it
// (scripts/engine/request-meter.js).
import crypto from 'node:crypto';
import path from 'node:path';
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
// How far the estimate may be from GitHub's count before the Logbook says so (spec 15's E6: within one request).
export const WITHIN = 1;

const whole = (n) => Number.isInteger(n) && n >= 0;

// The account signed in to `signIn` (Copilot's config.json keys), as a plain name for a file, or a shared name when it
// can't be told: projects on accounts that can't be told apart share a count, which reads high, never low.
export function accountKey(signIn) {
  const logins = [signIn?.lastLoggedInUser, signIn?.last_logged_in_user, signIn?.loggedInUsers?.[0], signIn?.logged_in_users?.[0]];
  const found = logins.find((user) => typeof user?.login === 'string' && user.login !== '');
  if (!found) return 'unknown-account';
  return crypto.createHash('sha256').update(`${found.host ?? 'https://github.com'}\0${found.login}`).digest('hex').slice(0, 16);
}

// The meter's file for `signIn`'s account under the engine's folder.
export const requestsFile = (engine, signIn) => path.join(engine, 'requests', `${accountKey(signIn)}.json`);

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
// month's requests (a number, or a promise of one), `kept` what the last look kept (null at first). Resolves with { kept, used, line }: `used` is the
// count the cap reads, GitHub's since the starting point where it has been read and else the larger of the two;
// `line` is the Logbook's words, or null.
export async function checkRequests({ read, estimate, kept = null, now = new Date() }) {
  const ours = await estimate();
  const started = kept !== null && whole(kept.baseline) && whole(kept.last);
  // What the meter counted before GitHub's first reading (`estimateAt`) is outside GitHub's count since then, so it is
  // added to it.
  const before = started ? kept.estimateAt ?? 0 : 0;
  const soFar = started ? Math.max(ours, kept.last - kept.baseline + before) : ours;
  if (kept && now.getTime() - Date.parse(kept.at) < CHECK_EVERY_MS) return { kept, used: soFar, line: null };
  const figure = await read();
  if (figure === null) {
    // Asked again a day later, not at every look, and said once until a reading works.
    const next = { ...(kept ?? { baseline: null, estimateAt: ours, resets: null, last: null }), at: now.toISOString(), unread: true };
    return { kept: next, used: soFar, line: kept?.unread === true ? null : 'The meter couldn\'t read GitHub\'s figure for Copilot requests today, so its own estimate stands until it can.' };
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
  const { unread: _said, ...reading } = kept;
  return { kept: { ...reading, at: now.toISOString(), last: figure.used }, used: theirs + before, line };
}
