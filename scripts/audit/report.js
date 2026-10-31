// scripts/audit/report.js
// The audit report: the computer's record of each merged change set against the code host's own
// history. The host's list of merges, pipelines and changes to protection comes from the host, not
// from the computer, so a record that is false (made with a key that leaked, or an event held back)
// shows as a gap. Run as
//
//   node scripts/audit/report.js --project <name> --since <date>
//
// it writes the report as Markdown to standard output and nothing else: it reads the host through
// the adapter with the project's own connection (no new sign-in, no key in an argument), reads the
// state's records from the Wheelhouse folder, and keeps the protection it read for the next report
// in that folder (protection-log.js), never in the project.
//
// A gap is any of: a merge with no approval; an approval for a pull request that never merged; a
// merged commit other than the one approved or reviewed (a Merge click on GitLab that names no
// commit merges one pushed just before, check 71); a merge whose head pipeline was a posted status
// and not a run (check 71); a change to the protection; a merge the record claims and the host does
// not show. Entries Lean kept before the project moved up are marked as Lean's. A Lean mark is
// only a label: it is not signed, so it never counts as an approval or a review, and every change
// the host lists as merged keeps every check; a Lean entry for a change the host does not list is
// a row, not a gap. A report that could not read the host, or all of the record, says it is incomplete and
// why, and never says there are no gaps.
//
// The records it reads that other parts of the plan have not yet made are read by these names, and a
// change without them shows "not recorded":
//   approval  data.proof          one of PROOFS (absent on a signed record: Claude Code's own, signed-hook)
//   review    data.reviewKind     one of REVIEW_KINDS
//   level     data.level          one of LEVELS, with data.pr for one change or none for all after it
//   level     data.allowance      a command an Ask allowance let through, with data.pr
//   report    data.provenance     the versions: wheelhouse, register, claudeCode, vscode, runtime, cli, models
//   any       tier: 'lean'        on the event or in its data: Lean's entry
import { LEVELS, PROOFS, REVIEW_KINDS } from '../lib/copilot-numbers.js';
import { verify, readEnrolled } from '../state/signing.js';
import { listEvents } from '../state/events.js';
import { stateDir } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { run } from '../lib/run.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { adapterOf } from '../host/adapter-for.js';
import { childEnv } from '../host/connection.js';
import { keepingProtection, protectionLogPlace } from './protection-log.js';

export const GAP_KINDS = Object.freeze(['no-approval', 'approval-not-merged', 'other-commit', 'external-pipeline', 'protection-change', 'merge-not-on-host']);

const SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const VERSION_FIELDS = ['wheelhouse', 'register', 'claudeCode', 'vscode', 'runtime', 'cli', 'models'];
const CODED_LINE = new Set(['HOST_UNREACHABLE', 'CERTIFICATE_NOT_TRUSTED']);
const MOST_SHOWN = 200;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const short = (sha) => String(sha).slice(0, 12);
const isPr = (n) => Number.isInteger(n) && n >= 1;

// A time as a UTC ISO string. A bare date is midnight UTC; a time with no zone is refused, because
// it would be read in this computer's zone.
function toIso(value, what) {
  let ms = Number.NaN;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value.trim())) ms = Date.parse(value.trim());
  if (Number.isNaN(ms)) throw new Error(`${what} must be a time, such as 2026-10-01 or 2026-10-01T00:00:00Z`);
  return new Date(ms).toISOString();
}

// Why a host read failed, in our words: the two lines company-ca.js makes for a host that is not
// there or a certificate not trusted, and otherwise only what was being read. Nothing the host said.
function plainReason(error, doing) {
  if (CODED_LINE.has(error?.code) && typeof error.message === 'string') return error.message;
  return `${doing} could not be read from the host`;
}

const isLean = (event) => event?.tier === 'lean' || event?.data?.tier === 'lean';
// Lean's kind for one of its entries: leanToEvents (scripts/state/lean-record.js) keeps an approval, a review and
// the like as a `note`, with the Lean kind in `data.lean`; a card or a merge keeps its own state kind.
const leanKind = (event) => event?.data?.lean ?? event?.kind;
const when = (event) => (typeof event?.at === 'string' ? event.at : null);

// The proof a counted approval carries, or null when the record is not one that counts: a signed
// record names a proof from PROOFS, or none at all (Claude Code's own signed record).
function proofOf(event) {
  const named = event.data?.proof;
  if (named === undefined) return 'signed-hook';
  return PROOFS.includes(named) ? named : null;
}

function versionsOf(reports) {
  const latest = reports.filter((e) => isPlain(e.data?.provenance)).sort((a, b) => (when(a) < when(b) ? -1 : 1)).at(-1);
  if (!latest) return null;
  const out = {};
  for (const field of VERSION_FIELDS) {
    const value = latest.data.provenance[field];
    if (typeof value === 'string' && value !== '') out[field] = value;
    else if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v !== '')) out[field] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// The head pipeline: the one the merging request itself had (marked `head`), else the newest of the
// commit's. Another request's newer run of the same commit is not the head.
function headPipeline(pipelines) {
  const list = (Array.isArray(pipelines) ? pipelines : []).filter((p) => Number.isInteger(p?.id));
  const top = list.find((p) => p.head === true) ?? list.sort((a, b) => b.id - a.id)[0];
  return top ? { id: top.id, status: String(top.status ?? 'unknown'), source: typeof top.source === 'string' ? top.source : null } : { id: null, status: 'none', source: null };
}

export async function auditReport({ events, host, since, now, enrolled = null, damagedRecords = 0, protectionKept = null } = {}) {
  const sinceIso = toIso(since, 'since');
  const nowIso = toIso(now, 'now');
  const keys = enrolled ?? readEnrolled();
  const all = (Array.isArray(events) ? events : []).filter((e) => isPlain(e) && typeof e.kind === 'string' && isPlain(e.data));
  const incomplete = [];
  const limits = [];
  const gaps = [];
  const gap = (kind, pr, commit, text) => gaps.push({ kind, pr, commit: commit ?? null, text });

  if (damagedRecords > 0) incomplete.push(`${damagedRecords} records in the project's record could not be read, so a record that belongs here may be missing`);

  // ---- The computer's record, by pull request ----
  const slots = new Map();
  const slot = (pr) => {
    if (!slots.has(pr)) slots.set(pr, { approvals: [], unverified: 0, reviews: [], unverifiedReviews: 0, reports: [], claims: [], lean: [], levels: [], allowances: [] });
    return slots.get(pr);
  };
  const leanEntries = [];
  const levelEvents = [];
  const unplaced = [];
  const inPeriodAt = (at) => Date.parse(at) >= Date.parse(sinceIso) && Date.parse(at) <= Date.parse(nowIso);
  for (const e of all) {
    const pr = e.data.pr;
    if (isLean(e)) {
      if (e.kind !== 'confirmation') leanEntries.push({ id: e.id ?? null, kind: leanKind(e), at: when(e), pr: isPr(pr) ? pr : null });
      if (isPr(pr)) slot(pr).lean.push(e);
      continue;
    }
    if (e.kind === 'level' && LEVELS.includes(e.data.level) && typeof e.data.allowance !== 'string') levelEvents.push(e);
    if (!isPr(pr)) {
      // A record of a merge that does not say which pull request cannot be checked against the host.
      const claimsMerge = e.kind === 'merge' || (e.kind === 'report' && e.data.outcome === 'merged');
      if (claimsMerge && inPeriodAt(when(e))) unplaced.push(when(e));
      continue;
    }
    const s = slot(pr);
    if (e.kind === 'approval') {
      const proof = verify(e, keys) ? proofOf(e) : null;
      if (proof === null) s.unverified += 1;
      else s.approvals.push({ commit: e.data.commit, at: when(e), proof });
    } else if (e.kind === 'review') {
      if (verify(e, keys)) {
        s.reviews.push({
          commit: e.data.commit, at: when(e), verdict: typeof e.data.verdict === 'string' ? e.data.verdict : null,
          kind: REVIEW_KINDS.includes(e.data.reviewKind) ? e.data.reviewKind : null,
        });
      } else s.unverifiedReviews += 1;
    } else if (e.kind === 'report') {
      s.reports.push(e);
      if (e.data.outcome === 'merged') s.claims.push({ at: when(e), source: 'report' });
    } else if (e.kind === 'merge') {
      s.claims.push({ at: when(e), source: 'merge' });
    } else if (e.kind === 'level' && typeof e.data.allowance === 'string') {
      s.allowances.push({ at: when(e), what: e.data.allowance });
    } else if (e.kind === 'level' && LEVELS.includes(e.data.level)) {
      s.levels.push(e);
    }
  }

  for (const at of unplaced) incomplete.push(`A record of a merge${at ? ` at ${at}` : ''} does not say which pull request it is for, so it could not be checked against the host`);

  // ---- The host's merges ----
  let requests = [];
  try {
    requests = await host.mergedRequests({ since: sinceIso });
    if (!Array.isArray(requests)) throw new Error('not a list');
  } catch (error) {
    incomplete.push(plainReason(error, 'The list of merged changes'));
    requests = [];
  }
  requests = requests.filter((r) => isPr(r?.number) && !(Date.parse(r.mergedAt) < Date.parse(sinceIso)) && !(Date.parse(r.mergedAt) > Date.parse(nowIso)));
  requests.sort((a, b) => (a.mergedAt ?? '9999-12-31') < (b.mergedAt ?? '9999-12-31') ? -1 : a.mergedAt === b.mergedAt ? a.number - b.number : 1);

  const rows = [];
  for (const r of requests) {
    const s = slots.get(r.number) ?? slot(r.number);
    const commit = typeof r.sha === 'string' && SHA.test(r.sha) ? r.sha : null;
    const approvals = s.approvals.map((a) => ({ ...a, matchesMerged: commit !== null && a.commit === commit }));
    const reviews = s.reviews.map((x) => ({ ...x, matchesMerged: commit !== null && x.commit === commit }));
    // Lean's entries for this change are shown and labelled, and never counted: they carry no signature
    // that could be checked, so a change the host lists keeps every check whatever Lean kept.
    const lean = s.lean.length > 0 && approvals.length === 0 && reviews.length === 0;
    const leanApprovals = s.lean.filter((e) => leanKind(e) === 'approval').map((e) => ({ commit: e.data.commit ?? null, at: when(e) }));
    const leanReviews = s.lean.filter((e) => leanKind(e) === 'review').map((e) => ({ commit: e.data.commit ?? null, at: when(e), verdict: e.data.verdict ?? e.data.choice ?? null }));

    // The level the computer ran at: the change's own record, else the latest one before the merge.
    const own = s.levels.sort((a, b) => (when(a) < when(b) ? -1 : 1)).at(-1);
    const before = levelEvents.filter((e) => !isPr(e.data.pr) && (r.mergedAt === null || when(e) <= r.mergedAt)).sort((a, b) => (when(a) < when(b) ? -1 : 1)).at(-1);
    const level = (own ?? before)?.data.level ?? null;

    let ci = null;
    let pipelinesRead = false;
    if (commit === null) {
      incomplete.push(`#${r.number}: the host did not say which commit merged, so the record could not be compared with it`);
    } else {
      try {
        ci = headPipeline(await host.pipelinesFor(commit, { number: r.number }));
        pipelinesRead = true;
      } catch (error) {
        incomplete.push(`#${r.number}: ${plainReason(error, 'The pipelines of the merged commit')}, so its tests are not checked`);
      }
    }

    const row = {
      number: r.number, title: r.title ?? '', url: r.url ?? null, mergedAt: r.mergedAt ?? null, mergedBy: r.mergedBy ?? null,
      commit, onHost: true, lean,
      approvals, reviews, leanApprovals, leanReviews,
      ci, level, allowances: s.allowances, versions: versionsOf(s.reports), unverified: { approvals: s.unverified, reviews: s.unverifiedReviews },
    };
    rows.push(row);

    if (commit !== null) {
      const by = r.mergedBy ? ` by ${r.mergedBy}` : '';
      if (approvals.length === 0) {
        const note = s.unverified > 0 ? `; ${s.unverified} approval ${s.unverified === 1 ? 'record' : 'records'} for it ${s.unverified === 1 ? 'does' : 'do'} not verify (not signed by an enrolled computer, or naming a proof Wheelhouse does not know)` : '';
        gap('no-approval', r.number, commit, `#${r.number} was merged${by} at ${r.mergedAt ?? 'a time the host did not give'} (commit ${short(commit)}) with no approval on record${note}`);
      }
      const approvedOther = approvals.length > 0 && !approvals.some((a) => a.matchesMerged);
      const reviewedOther = reviews.length > 0 && !reviews.some((x) => x.matchesMerged);
      if (approvedOther || reviewedOther) {
        const parts = [];
        if (approvedOther) parts.push(`the approval was for ${[...new Set(approvals.map((a) => short(a.commit)))].join(', ')}`);
        if (reviewedOther) parts.push(`the review was of ${[...new Set(reviews.map((x) => short(x.commit)))].join(', ')}`);
        gap('other-commit', r.number, commit, `#${r.number} merged commit ${short(commit)}${by}, but ${parts.join(' and ')}`);
      }
    }
    if (pipelinesRead && ci.source === 'external') {
      gap('external-pipeline', r.number, commit, `#${r.number}: the head pipeline of commit ${short(commit)} was a status posted with a key (source external), not a run of the project's tests`);
    }
  }

  // ---- What the record claims that the host does not list as merged in the period ----
  const onHost = new Set(requests.map((r) => r.number));
  const sinceMs = Date.parse(sinceIso);
  const nowMs = Date.parse(nowIso);
  const inPeriod = (at) => Date.parse(at) >= sinceMs && Date.parse(at) <= nowMs;
  const wanted = new Map();
  for (const [pr, s] of slots) {
    if (onHost.has(pr)) continue;
    const approved = s.approvals.filter((a) => inPeriod(a.at));
    const claimed = s.claims.filter((c) => inPeriod(c.at));
    if (approved.length > 0 || claimed.length > 0) wanted.set(pr, { approved, claimed });
  }
  const waiting = [];
  for (const [pr, { approved, claimed }] of [...wanted].sort((a, b) => a[0] - b[0])) {
    let state;
    try {
      if (typeof host.prState !== 'function') throw new Error('no read');
      const seen = await host.prState(pr);
      state = typeof seen?.state === 'string' ? seen.state : 'unknown';
    } catch (error) {
      if (/\b404\b|not found/i.test(String(error?.message))) state = 'missing';
      else {
        incomplete.push(`#${pr}: ${plainReason(error, 'The state of the pull request')}, so the record of it is not checked`);
        continue;
      }
    }
    if (state === 'merged') continue; // merged outside the period; not this report's to compare
    const seenAs = { open: 'still open', closed: 'closed without merging', missing: 'not on the host at all' }[state];
    if (seenAs === undefined) {
      incomplete.push(`#${pr}: the host did not say whether it merged, so the record of it is not checked`);
      continue;
    }
    if (approved.length > 0) {
      if (state === 'open') waiting.push(pr);
      else gap('approval-not-merged', pr, approved[0].commit, `#${pr}: an approval of commit ${short(approved[0].commit)} is on record, but the pull request is ${seenAs}`);
    }
    if (claimed.length > 0) {
      gap('merge-not-on-host', pr, null, `#${pr}: the record says it merged, but the host shows it ${seenAs}`);
    }
  }

  // ---- Entries Lean kept, for changes the host does not list: rows, marked ----
  for (const [pr, s] of [...slots].sort((a, b) => a[0] - b[0])) {
    if (onHost.has(pr) || s.lean.length === 0) continue;
    if (!s.lean.some((e) => inPeriod(when(e)))) continue;
    const latestClaim = s.lean.filter((e) => e.kind === 'merge' || (e.kind === 'report' && e.data.outcome === 'merged')).sort((a, b) => (when(a) < when(b) ? -1 : 1)).at(-1);
    rows.push({
      number: pr, title: typeof latestClaim?.data?.work === 'string' ? latestClaim.data.work : '', url: null, mergedAt: when(latestClaim) ?? null, mergedBy: null,
      commit: null, onHost: false, lean: true,
      approvals: [], reviews: [],
      leanApprovals: s.lean.filter((e) => leanKind(e) === 'approval').map((e) => ({ commit: e.data.commit ?? null, at: when(e) })),
      leanReviews: s.lean.filter((e) => leanKind(e) === 'review').map((e) => ({ commit: e.data.commit ?? null, at: when(e), verdict: e.data.verdict ?? e.data.choice ?? null })),
      ci: null, level: null, allowances: [], versions: versionsOf(s.lean.filter((e) => e.kind === 'report')), unverified: { approvals: 0, reviews: 0 },
    });
  }

  // ---- Protection ----
  let protection = null;
  try {
    protection = await host.protectionEvents({ since: sinceIso });
    if (!isPlain(protection) || !Array.isArray(protection.events)) throw new Error('not an answer');
  } catch (error) {
    incomplete.push(plainReason(error, 'The changes to the project\'s protection'));
    protection = null;
  }
  if (protection !== null) {
    for (const e of protection.events) {
      const who = e.by ? ` by ${e.by}` : '';
      const where = e.at ? ` at ${e.at}` : (Array.isArray(e.between) && e.between[0] ? ` between ${e.between[0]} and ${e.between[1]}` : ' at a time the host did not give');
      gap('protection-change', null, null, `Protection changed${who}${where}: ${String(e.what ?? 'a protection setting').slice(0, MOST_SHOWN)}`);
    }
    if (protection.damaged) incomplete.push('The protection reading kept for the last report could not be read, so changes since that report cannot be seen; the comparison starts afresh from this one');
    if (protection.source === 'compared') {
      limits.push('This host has no audit events at this licence (they are Premium and Ultimate\'s), so protection changes are found by comparing the protection read now with the protection read for the last report. A change made and undone between two reports is not seen.');
    } else if (protection.compared === false) {
      limits.push('The protection could not also be read now for comparison, so only the audit events say what changed.');
    }
    if (protection.compared !== false) {
      limits.push('The comparison covers the protected branches (who may push and merge, force-push) and the two merge settings ("pipelines must succeed" and whether a skipped pipeline counts). It does not cover protected tags, the merge method, whether discussions must be resolved, or who is a member of the project.');
    }
    if (protection.kept === false) limits.push('The protection read for this report could not be kept, so the next report has nothing to compare with.');
    if (protection.first && protection.compared !== false) limits.push('There is no earlier reading to compare with, so this report cannot say whether the protection changed before now. The protection read now is kept, and the next report compares with it.');
  }

  const order = (g) => (g.pr === null ? Number.MAX_SAFE_INTEGER : g.pr);
  gaps.sort((a, b) => order(a) - order(b) || GAP_KINDS.indexOf(a.kind) - GAP_KINDS.indexOf(b.kind));
  rows.sort((a, b) => ((a.mergedAt ?? '9999-12-31') < (b.mergedAt ?? '9999-12-31') ? -1 : (a.mergedAt ?? '9999-12-31') > (b.mergedAt ?? '9999-12-31') ? 1 : a.number - b.number));

  return {
    since: sinceIso, now: nowIso, complete: incomplete.length === 0, incomplete, limits, rows, gaps, waiting, lean: leanEntries,
    protection: protection === null ? null : { source: protection.source, first: protection.first === true, compared: protection.compared !== false, events: protection.events, kept: protectionKept },
  };
}

// ---- Markdown ----

// Text from outside as one table-safe line.
const cell = (text) => String(text ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/`/g, "'").trim();

const notCounted = (n) => (n > 0 ? ` (${n} ${n === 1 ? 'record does' : 'records do'} not verify, so ${n === 1 ? 'it is' : 'they are'} not counted)` : '');

// Lean's entries for the change: shown, labelled, and never counted.
const leanApprovalLines = (row) => row.leanApprovals.map((a) => `Lean's approval (not counted): commit ${short(a.commit ?? '-')} at ${a.at ?? 'no time'}`);
const leanReviewLines = (row) => row.leanReviews.map((x) => `Lean's review (not counted): commit ${short(x.commit ?? '-')} at ${x.at ?? 'no time'}, ${x.verdict ?? 'no verdict'}`);

function approvalLine(row) {
  const lean = leanApprovalLines(row);
  const counted = row.approvals.length === 0
    ? [`Approval: none on record${notCounted(row.unverified.approvals)}`]
    : row.approvals.map((a) => `Approval: commit ${short(a.commit ?? '-')} at ${a.at ?? 'no time'}${a.proof ? `, proof ${a.proof}` : ''}${a.matchesMerged ? '' : ', not the merged commit'}`);
  return [...counted, ...lean].join('\n- ');
}
function reviewLine(row) {
  const lean = leanReviewLines(row);
  const counted = row.reviews.length === 0
    ? [`Review: not recorded${notCounted(row.unverified.reviews)}`]
    : row.reviews.map((x) => `Review: commit ${short(x.commit ?? '-')} at ${x.at ?? 'no time'}, ${x.verdict ?? 'no verdict'}, kind ${x.kind ?? 'not recorded'}${x.matchesMerged ? '' : ', not the merged commit'}`);
  return [...counted, ...lean].join('\n- ');
}
function ciLine(row) {
  if (!row.onHost) return 'CI: not compared (Lean)';
  if (row.ci === null) return 'CI: could not be read';
  if (row.ci.status === 'none') return 'CI: no pipeline found for the merged commit';
  return `CI: ${row.ci.status}${row.ci.source ? ` (${row.ci.source})` : ''}`;
}
function versionsLine(row) {
  if (row.versions === null) return 'Versions: not recorded';
  return `Versions: ${Object.entries(row.versions).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')}`;
}

export function renderAudit(report) {
  const out = [];
  out.push('<!-- the audit report -->', '', '# Audit report', '');
  out.push(`Period: ${report.since} to ${report.now} (UTC).`, '');
  if (!report.complete) {
    out.push('**This report is incomplete.** It could not check everything, so it is not a statement that nothing is wrong:', '');
    for (const line of report.incomplete) out.push(`- ${cell(line)}`);
    out.push('');
  }
  const merged = report.rows.filter((r) => r.onHost).length;
  out.push(`Changes merged on the host in the period: ${merged}. Entries Lean kept: ${report.rows.filter((r) => r.lean).length}.`, '');

  out.push(`## Gaps (${report.gaps.length})`, '');
  if (report.gaps.length === 0) {
    const protectionClause = report.protection !== null && !(report.protection.first && report.protection.compared)
      ? ', and the protection has not changed'
      : '';
    const firstLook = report.protection !== null && report.protection.first && report.protection.compared
      ? ' There was nothing to compare the protection with yet, so whether it changed is not said.'
      : '';
    out.push(report.complete ? `No gaps: every merged change has a matching approval, the merged commit is the one approved and reviewed, and its pipeline ran${protectionClause}.${firstLook}` : 'Nothing was found in the part that could be checked. The part that could not be checked is listed at the top of this report.');
  } else {
    for (const g of report.gaps) out.push(`- **${g.kind}**: ${cell(g.text)}`);
  }
  out.push('');

  if (report.waiting.length > 0) {
    out.push(`Approved and still open on the host: ${report.waiting.map((n) => `#${n}`).join(', ')}.`, '');
  }

  out.push('## Merged changes', '');
  if (report.rows.length === 0) out.push('None in the period.', '');
  for (const row of report.rows) {
    out.push(`### #${row.number}${row.title ? ` ${cell(row.title)}` : ''}${row.lean ? " (Lean's)" : ''}`, '');
    if (row.lean) out.push(row.onHost ? "Marked as Lean's. Lean's entries are not signed, so they are shown but never counted: this change was checked against the host like any other." : "Kept at Lean, and the host does not list it: not compared with the host.", '');
    if (row.onHost) {
      out.push(`- Merged: ${row.mergedAt ?? 'at a time the host did not give'}${row.mergedBy ? ` by ${cell(row.mergedBy)}` : ''}, commit ${row.commit ? short(row.commit) : 'not given'}`);
    } else {
      out.push(`- Merged at Lean: ${row.mergedAt ?? 'no time recorded'}; the host has no record of it`);
    }
    out.push(`- ${approvalLine(row)}`);
    out.push(`- ${reviewLine(row)}`);
    out.push(`- ${ciLine(row)}`);
    out.push(`- Level: ${row.level ?? 'not recorded'}`);
    out.push(`- Ask allowances: ${row.allowances.length === 0 ? 'none recorded' : row.allowances.map((a) => `${cell(a.what)} (${a.at ?? 'no time'})`).join('; ')}`);
    out.push(`- ${versionsLine(row)}`, '');
  }

  out.push('## Protection', '');
  if (report.protection === null) {
    out.push('Not read, so changes to the protection are not checked.', '');
  } else {
    out.push(report.protection.source === 'audit-events'
      ? 'Read from the host\'s audit events.'
      : `Read now and compared with the reading kept for the last report${report.protection.kept ? `, which is kept in the Wheelhouse folder on this computer at ${cell(report.protection.kept)}` : ''}.`, '');
    if (report.protection.events.length === 0) out.push('No change found.', '');
  }

  if (report.lean.length > 0) {
    out.push("## Entries Lean kept (never counted as approvals or reviews)", '');
    for (const e of report.lean) out.push(`- ${e.kind}${e.pr ? ` for #${e.pr}` : ''}${e.at ? ` at ${e.at}` : ''}`);
    out.push('');
  }

  if (report.limits.length > 0) {
    out.push('## Limits', '');
    for (const l of report.limits) out.push(`- ${cell(l)}`);
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---- The command ----

const USAGE = 'Usage: node scripts/audit/report.js --project <name> --since <date>';

function argumentsOf(argv) {
  const found = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [name, inline] = String(argv[i]).split(/=(.*)/s);
    if (name !== '--project' && name !== '--since') return null;
    const value = inline ?? argv[i + 1];
    if (inline === undefined) i += 1;
    if (typeof value !== 'string' || value === '' || value.startsWith('--') || Object.hasOwn(found, name)) return null;
    found[name.slice(2)] = value;
  }
  return typeof found.project === 'string' && typeof found.since === 'string' ? found : null;
}

// Runs the report for a project and writes it, as Markdown, to `out`. Everything it reaches is
// injectable so a test reaches none of the real tools: `adapterFor(record, env)`, `eventsFor(project,
// skipped)` and `enrolledFor()`. The exit code is 0 for a report made whole (gaps or none: they are
// in the report), 1 when it could not be made whole or at all, 2 when the arguments are wrong.
export async function main(argv, {
  out = process.stdout, err = process.stderr, now = () => new Date(),
  adapterFor = (record, env) => adapterOf(record, { run, env }),
  envFor = (record) => childEnv(record.connection),
  eventsFor = (project, skipped) => listEvents(stateDir(project), { report: () => {}, skipped }),
  enrolledFor = () => readEnrolled(),
} = {}) {
  const given = argumentsOf(argv);
  if (given === null) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  // Every line written here is ours. An error's own message is never repeated, since one from
  // the connection or a tool could carry key material; the two coded lines for a host that is not
  // there or a certificate not trusted are ours too.
  let since;
  try {
    since = toIso(given.since, 'since');
  } catch {
    err.write('The audit report could not be made: --since must be a time, such as 2026-10-01 or 2026-10-01T00:00:00Z\n');
    return 1;
  }
  const record = readProject(given.project);
  if (!record) {
    err.write('The audit report could not be made: the project has not been set up on this computer\n');
    return 1;
  }
  if (record.host !== 'gitlab') {
    err.write(record.host === 'local'
      ? 'This project is kept on this computer, so there is no second record to compare with, and no report was made.\n'
      : 'The audit report is for GitLab in this version. This project is on GitHub, so no report was made.\n');
    return 1;
  }
  try {
    const adapter = adapterFor(record, await envFor(record));
    const skipped = [];
    const events = eventsFor(given.project, skipped);
    const host = {
      mergedRequests: (args) => adapter.mergedRequests(args),
      pipelinesFor: (sha, options) => adapter.pipelinesFor(sha, options),
      prState: (number) => adapter.prState(number),
      protectionEvents: keepingProtection({ project: given.project, adapter, now }),
    };
    const report = await auditReport({
      events, host, since, now: now(), enrolled: enrolledFor(), damagedRecords: skipped.length, protectionKept: protectionLogPlace(given.project),
    });
    out.write(renderAudit(report));
    return report.complete ? 0 : 1;
  } catch (error) {
    const line = CODED_LINE.has(error?.code) && typeof error.message === 'string' ? error.message : "the project's connection or records could not be read";
    err.write(`The audit report could not be made: ${line}\n`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
