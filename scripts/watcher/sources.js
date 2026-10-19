// scripts/watcher/sources.js
// What the watcher reads to make an observation (design section 11): state,
// from the helper's clone with fs; each running feature's files, from the
// worktree the features view names; and the host, through the helper. It
// holds no keys and runs nothing: every git call happens in the helper.
//
// One observation, in this order:
//   1. When its interval has passed, state is synced through /state/sync, so
//      a record another computer pushed is in the clone before any feature
//      file is read.
//   2. The clone is read for the features view: the running features (every
//      one whose latest step is not `closed`) and their worktrees.
//   3. Each running feature's files are read.
//   4. The clone is read again, after the files, for the recorded briefs and
//      the events to send. The foreman records a brief in state on this
//      computer, so state read after the brief file is never older than it.
//   5. Pull requests, and test merges between building features' branches,
//      when their intervals have passed.
// While git is part-way through changing the clone (a rebase, or a held
// index lock, seen before or after a read), the clone is not read: the last
// read this process made stands in for it.
//
// Between observe and the cursor. observe takes `prev`, the observation as
// core's `settle` left it in the cursor, and adds two things to the one it
// makes, which `settle` keeps for the next:
//   - `polled`: when state, the pull requests and the test merges were last
//     asked for, so each waits for its own interval, across restarts too; and
//     in `polled.prAsked`, when each pull request number not known to be open
//     (closed, not answered, or not the claiming feature's) was last asked;
//   - `stateIds`: the ids of the state events in the clone written within
//     LOOKBACK_MS of the observation. An event is sent once: when it is in the
//     clone, within the look-back and not among the last observation's ids. A
//     record pushed late by another computer is still sent if it was written
//     within the look-back; one older than that is taken as seen. With no
//     `prev`, or a `prev` with no `stateIds`, no state event is sent: what is
//     already in state is where things stand, not news.
// `awake`, the milliseconds the watcher ran since its last observation, is
// the caller's to measure, since only the running process can know it.
import fs from 'node:fs';
import path from 'node:path';
import { featurePaths, briefHash, parseBrief, parseReport, readQuestions, readStatus } from '../feature/files.js';
import { readCapped, safeFeatureFolder } from '../feature/status.js';
import { SLUG } from '../lib/build-loop.js';
import { stateDir } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { stopState } from '../lib/stop.js';
import { listEvents, PROTECTED_KINDS } from '../state/events.js';
import { readEnrolled, verify } from '../state/signing.js';
import { buildViews } from '../state/views.js';

// How often each source is read, in milliseconds. The feature files are read
// at every observation, so `features` is how often the caller observes.
export const INTERVALS = Object.freeze({ state: 30000, features: 15000, prs: 60000, testMerge: 600000 });

// How far back a state event pushed late is still sent.
export const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// The most pull request numbers whose last asking is kept; the oldest go first.
export const PR_ASKED_CAP = 200;

// The most of a brief, or of a report, that is read; a longer one reads as missing.
const BRIEF_BYTES = 1024 * 1024;
const REPORT_BYTES = 1024 * 1024;

const CI = ['success', 'failure', 'pending', 'none'];
const MERGEABLE = ['yes', 'no', 'unknown'];

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x !== '';
const caseBlind = process.platform === 'win32' || process.platform === 'darwin';

function lstatOf(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    return error;
  }
}

// --- State, from the clone ---

// What git leaves in the clone while it is part-way through changing it.
const BUSY = ['rebase-merge', 'rebase-apply', 'index.lock'];
const cloneBusy = (project) => BUSY.some((name) => !(lstatOf(path.join(stateDir(project), '.git', name)) instanceof Error));

// The last state each project's clone gave this process, by the clone's folder.
const lastRead = new Map();

// The state events in the clone, in order, leaving out every copy of an id
// carried by more than one event, as the views do. While git is changing the
// clone, the last read stands in; with none yet, the clone is read as it is.
function readEvents(project) {
  const dir = stateDir(project);
  const unique = () => {
    const events = listEvents(dir, { report: () => {} });
    const counts = new Map();
    for (const e of events) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
    return events.filter((e) => counts.get(e.id) === 1);
  };
  if (!cloneBusy(project)) {
    const events = unique();
    if (!cloneBusy(project)) {
      lastRead.set(dir, events);
      return events;
    }
  }
  return lastRead.get(dir) ?? unique();
}

// The latest two distinct brief hashes the foreman recorded for each work,
// over all its `feature` events: `{ recorded, before }`. The foreman's amend
// checks the brief against the same record.
export function recordedBriefs(events) {
  const hashes = new Map();
  for (const e of events) {
    if (e.kind !== 'feature' || !isPlain(e.data) || !isText(e.data.work) || !isText(e.data.brief)) continue;
    const list = hashes.get(e.data.work) ?? [];
    list.push(e.data.brief);
    hashes.set(e.data.work, list);
  }
  const out = new Map();
  for (const [work, list] of hashes) {
    const recorded = list.at(-1);
    const before = [...list].reverse().find((h) => h !== recorded) ?? null;
    out.set(work, { recorded, before });
  }
  return out;
}

// --- The feature files ---

// Whether `p` is a path the watcher may follow on `platform`: a full path,
// never a network or device path (starting `\\` or `//`) on any system, and
// on Windows one that starts with a drive letter.
export function plainWorktreePath(p, platform = process.platform) {
  if (!isText(p) || p.includes('\0')) return false;
  if (p.startsWith('\\\\') || p.startsWith('//')) return false;
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(p);
  return path.posix.isAbsolute(p);
}

// Whether `p`, spelt as it is, lies strictly inside `folder` (for a worktree
// that is not there, so has no real path).
function speltInside(folder, p) {
  const key = (x) => (caseBlind ? x.toLowerCase() : x);
  const base = key(path.resolve(folder));
  const target = key(path.resolve(p));
  return target !== base && target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

// The folder feature worktrees are made in: `<checkout>/.claude/worktrees`.
export const worktreesFolder = (checkout) => path.join(checkout, '.claude', 'worktrees');

// Whether `worktree` lies, by its real path, strictly inside the checkout's
// `.claude/worktrees/` (also by its real path): never the folder itself, and
// never anywhere else in the checkout.
export function inWorktreesFolder(checkout, worktree) {
  if (!isText(checkout) || !isText(worktree)) return false;
  let base;
  let target;
  try {
    base = fs.realpathSync.native(worktreesFolder(checkout));
    target = fs.realpathSync.native(worktree);
  } catch {
    return false;
  }
  return speltInside(base, target);
}

// A feature's files, read only from `<worktree>/.wheelhouse/feature/`. The
// worktree must pass plainWorktreePath, be a real folder (a link is not
// followed), and lie, by its real path, strictly inside the project's
// `.claude/worktrees/`, where feature worktrees are made; the feature folder
// must be a real folder under it. Otherwise nothing is read. Only a worktree
// spelt inside that folder that is plainly not there is `gone`. Each file is
// read with a cap, and refused when it is not a regular file, without
// waiting on it.
function readFeature(work, worktree, checkout) {
  const nothing = { status: null, questions: [], extraPlans: [], skipped: 0, briefHash: null, appetite: null, report: false, gone: false };
  if (!plainWorktreePath(worktree) || !isText(checkout)) return nothing;
  const stat = lstatOf(worktree);
  if (stat instanceof Error) {
    const missing = stat.code === 'ENOENT' || stat.code === 'ENOTDIR';
    return missing && spelt(checkout, worktree) ? { ...nothing, gone: true } : nothing;
  }
  if (!stat.isDirectory() || !inWorktreesFolder(checkout, worktree) || !safeFeatureFolder(worktree)) return nothing;

  const p = featurePaths(worktree);
  const status = readStatus(p.status);
  const asked = readQuestions(p.questions);
  const brief = readCapped(p.brief, BRIEF_BYTES);
  let appetite = null;
  if (brief !== null) {
    try {
      appetite = parseBrief(brief).fields.appetite.tokens;
    } catch { /* a brief that can't be read has no appetite */ }
  }
  let report = false;
  const reportText = readCapped(p.report, REPORT_BYTES);
  if (reportText !== null) {
    try {
      report = parseReport(reportText).fields.work === work;
    } catch { /* a report that can't be read is no report */ }
  }
  return {
    status: status !== null && status.work === work ? status : null,
    questions: asked.questions.filter((q) => q.kind !== 'extra-plan').map((q) => q.id),
    extraPlans: asked.questions.filter((q) => q.kind === 'extra-plan').map((q) => q.id),
    skipped: asked.skipped,
    briefHash: brief === null ? null : briefHash(brief),
    appetite,
    report,
    gone: false,
  };
}

// The worktrees folder as recorded, and by the checkout's real path, either
// of which a missing worktree may be spelt under.
function spelt(checkout, worktree) {
  if (speltInside(worktreesFolder(checkout), worktree)) return true;
  try {
    return speltInside(worktreesFolder(fs.realpathSync.native(checkout)), worktree);
  } catch {
    return false;
  }
}

// --- The pull requests ---

// The review of the pull request's head, from the signed review records.
function reviewOf(views, pr, head) {
  const verdict = views.reviews?.[String(pr)]?.[head]?.data?.verdict;
  if (verdict === 'CLEAN') return 'clean';
  if (verdict === 'FINDINGS') return 'findings';
  return 'none';
}

// One pull request as the host has it, for the first of `works` whose branch
// is the pull request's head branch: its state, or null once it has closed or
// merged. Undefined when the helper could not say, or no claimant's branch
// is its head branch.
async function readPr({ project, client, number, works, branchOf, views }) {
  let answer;
  try {
    answer = await client.prState({ project, number });
  } catch {
    return undefined;
  }
  const pr = answer?.ok === true && isPlain(answer.result) ? answer.result : null;
  if (pr === null || !isText(pr.headRef)) return undefined;
  const work = works.find((w) => branchOf(w) === pr.headRef);
  if (work === undefined) return undefined;
  if (pr.state === 'merged' || pr.state === 'closed') return null;
  if (pr.state !== 'open' || !isText(pr.headSha)) return undefined;
  let ci;
  try {
    ci = await client.ci({ project, sha: pr.headSha });
  } catch {
    return undefined;
  }
  if (ci?.ok !== true || !CI.includes(ci.result?.state)) return undefined;
  return {
    work,
    head: pr.headSha,
    ci: ci.result.state,
    mergeable: MERGEABLE.includes(pr.mergeable) ? pr.mergeable : 'unknown',
    review: reviewOf(views, number, pr.headSha),
  };
}

// The observation core's `diff` takes. `prev` is the cursor's settled
// observation, or null; `awake` the milliseconds the watcher ran since it;
// `intervals` overrides some or all of INTERVALS. Never throws for a missing
// or unreadable feature: it is reported.
export async function observe({ project, client, now = () => new Date(), intervals = {}, prev = null, awake = 0 }) {
  const every = { ...INTERVALS, ...(isPlain(intervals) ? intervals : {}) };
  const t = now();
  const ms = t.getTime();
  const iso = t.toISOString();
  const before = isPlain(prev) && isPlain(prev.polled) ? prev.polled : {};
  const polled = { ...before };
  // Never asked, or a clock set back: due now.
  const dueSince = (when, interval) => {
    const last = Date.parse(when ?? '');
    return Number.isNaN(last) || ms < last || ms - last >= interval;
  };
  const due = (kind) => dueSince(before[kind], every[kind]);

  // 1. State from the host.
  if (due('state')) {
    try {
      await client.state.sync({ project });
    } catch { /* the clone is read as it is */ }
    polled.state = iso;
  }

  // 2. The running features and their worktrees.
  const enrolled = readEnrolled();
  const views = buildViews(readEvents(project), enrolled, { now });
  const viewed = isPlain(views.features) ? views.features : {};
  const running = Object.entries(viewed).filter(([work, f]) => SLUG.test(work) && isPlain(f?.data) && f.data.step !== 'closed');
  const branchOf = (work) => (isText(viewed[work]?.data?.branch) ? viewed[work].data.branch : null);

  // 3. Their files.
  const checkout = readProject(project)?.folder ?? null;
  const read = new Map(running.map(([work, f]) => [work, readFeature(work, f.data.worktree, checkout)]));

  // 4. State again, no older than the files.
  const events = readEvents(project);
  const recorded = recordedBriefs(events);
  const features = {};
  for (const [work, f] of read) {
    const r = recorded.get(work);
    const { gone, ...rest } = f;
    features[work] = { ...rest, recordedBrief: r?.recorded ?? null, recordedBefore: r?.before ?? null, gone };
  }

  const since = ms - LOOKBACK_MS;
  const recent = events.filter((e) => {
    const when = Date.parse(e.at);
    return !Number.isNaN(when) && when >= since;
  });
  const stateIds = recent.map((e) => e.id);
  const known = isPlain(prev) && Array.isArray(prev.stateIds) ? new Set(prev.stateIds) : null;
  const sent = known === null ? [] : recent.filter((e) => !known.has(e.id)).map((e) => ({
    id: e.id,
    kind: e.kind,
    data: e.data,
    verified: PROTECTED_KINDS.includes(e.kind) && verify(e, enrolled),
  }));

  // 5. The pull requests: those known before, until they close, then those a
  // running feature's status names. Each number's claimants are in that
  // order, and the first whose branch is the pull request's head branch has
  // it, so a later claim never takes a binding from an earlier one. A known
  // pull request is asked again when its interval has passed; any other
  // number, when that much time has passed since it was last asked.
  const prevPrs = isPlain(prev) && isPlain(prev.prs) ? prev.prs : {};
  const claims = new Map();
  const claim = (n, work) => {
    if (!Number.isSafeInteger(n) || n < 1 || !isText(work)) return;
    const works = claims.get(n) ?? [];
    if (!works.includes(work)) works.push(work);
    claims.set(n, works);
  };
  for (const [key, p] of Object.entries(prevPrs)) if (isPlain(p)) claim(Number(key), p.work);
  for (const [work, f] of Object.entries(features)) claim(f.status?.pr, work);

  const prsDue = due('prs');
  const prAsked = isPlain(before.prAsked) ? { ...before.prAsked } : {};
  const prs = {};
  for (const [number, works] of claims) {
    const key = String(number);
    if (Object.hasOwn(prevPrs, key) ? !prsDue : !dueSince(prAsked[key], every.prs)) continue;
    const pr = await readPr({ project, client, number, works, branchOf, views });
    if (pr !== undefined) prs[key] = pr;
    if (isPlain(pr)) delete prAsked[key];
    else prAsked[key] = iso;
  }
  if (prsDue) polled.prs = iso;
  const asked = Object.entries(prAsked).filter(([, when]) => typeof when === 'string')
    .sort(([, x], [, y]) => (x < y ? -1 : x > y ? 1 : 0)).slice(-PR_ASKED_CAP);
  polled.prAsked = Object.fromEntries(asked);

  // Test merges between every pair of building features' branches.
  const testMerges = [];
  if (due('testMerge')) {
    const building = running
      .filter(([work, f]) => f.data.step === 'building' && isText(f.data.branch) && !features[work].gone)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 0; i < building.length; i += 1) {
      for (let j = i + 1; j < building.length; j += 1) {
        const [a, fa] = building[i];
        const [b, fb] = building[j];
        let answer;
        try {
          answer = await client.testMerge({ project, a: fa.data.branch, b: fb.data.branch });
        } catch {
          continue;
        }
        if (answer?.ok !== true || typeof answer.clean !== 'boolean') continue;
        testMerges.push({ a, b, clean: answer.clean, conflicts: Array.isArray(answer.conflicts) ? answer.conflicts : [] });
      }
    }
    polled.testMerge = iso;
  }

  return {
    at: iso,
    awake: typeof awake === 'number' && Number.isFinite(awake) && awake > 0 ? awake : 0,
    events: sent,
    features,
    prs,
    testMerges,
    stop: stopState().on,
    polled,
    stateIds,
  };
}
