// scripts/watcher/core.js
// The watcher's core: what it sees turned into wakes (design section 11).
//
//   Observation = {
//     at: string,             when it was made, UTC ISO 8601
//     awake: number,          milliseconds the watcher ran since its last observation,
//                             so time the computer slept never counts
//     events: Array<{ id, kind, data, verified }>,   the state events after the cursor;
//                             `verified` for a signed action
//     features: Record<work, {
//       status: Status | null,
//       questions: string[],          ids of `question` lines in the questions file
//       extraPlans: string[],         ids of `extra-plan` lines
//       skipped: number,              malformed question lines skipped
//       briefHash: string | null,     the brief file's hash as it is now (null: no file)
//       recordedBrief: string | null, the hash the foreman last recorded in state
//       recordedBefore: string | null, the hash it recorded before that one
//       appetite: number | null,      the brief's token appetite
//       report: boolean,
//       gone: boolean,                the feature's worktree is missing
//     }>,
//     prs: Record<pr, { work, head, ci, mergeable, review } | null>,   null: closed, forget it
//     testMerges: Array<{ a, b, clean, conflicts? }>,   a and b are works
//     stop: boolean,
//     polled?: { state?, prs?, testMerge? },   when each was last asked for (sources.js)
//     stateIds?: string[],    the state events' ids within the look-back (sources.js)
//   }
//
// `settle` keeps `polled` and `stateIds` as they are, so the next observation
// reads them from the cursor; `diff` does not read them.
//
// Task 12 derives `recordedBrief` and `recordedBefore` as the latest two
// distinct `brief` hashes over all `feature` events for the work, and reads
// state no older than the brief file, so a brief the foreman has just recorded
// and written is never judged against an older record.
//
// The foreman's order of writing, which the brief's judging relies on: a
// feature's first brief is written to its file before its hash is recorded
// in state (until then nothing is recorded, so nothing can be tampered); an
// amendment's new hash is recorded before the file is rewritten (until then
// the file still holds the hash recorded before, which counts until the file
// first catches up).
//
// PRs and test merges are polled less often than the feature files, so an
// observation may leave some or all of them out: `settle` keeps the last known
// state of each, and `diff` judges what an observation names against it.
//
//   WatchEvent = { type, work?, pr?, id, detail, handled? }
//
// `diff` and `route` are pure, and the bundler takes its clock from the caller.
// Every event's id is made from its inputs alone, so a watcher restarted from
// its cursor makes the same ids again and the cursor's `seen` list stops any of
// them waking twice:
//   - a state event's own id (work-ready, amended, answer, incident, build);
//   - a question's own id (question, extra-plan);
//   - `<type>:<work>:<head>` for a PR's events;
//   - a change of state with no id of its own (stop, clash, the brief's events,
//     plan-ready, stuck with no status) carries the count of the observation
//     before it, which only ever rises, so a clock set back can never repeat one.
//
// The two wakes around a plan (ruling R76). A feature's status phase arriving
// at `ready-to-build` (from any other phase, from no status, or first seen
// there) is `plan-ready` for the foreman, which checks the plan for clashes,
// pace and dependencies. A status read as null between two reads at
// `ready-to-build` raises it again: wakes are at least once (ruling R27). The
// foreman then records a `feature` event at step `building` carrying no
// `brief`, which is `build` for that feature's session: only then does it
// build. Each slice's plan in the feature lane goes the same way. An event
// carrying `brief` records an amendment's hash at the feature's current step
// (ruling R85) and is never `build`.
//
// Work that starts with no approval (rulings R60 and R78): quick and bug work
// that no one is shown first. Its plain `work` event is `work-ready`; any other
// work is ready only with the director's signed `approve-work`.
// Only the cursor's reader and writer touch the disk.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_MS, STUCK_MS } from '../lib/build-loop.js';
import { stateDir } from '../lib/paths.js';

// How many ids the cursor remembers.
export const SEEN_CAP = 5000;
// How many digest events wait for the foreman; older ones are counted, not kept.
export const DIGEST_CAP = 200;

export const FOREMAN_TYPES = Object.freeze([
  'work-ready', 'amended', 'question', 'extra-plan', 'answer', 'merge-ready', 'stuck',
  'over-appetite', 'clash', 'stop', 'incident', 'brief-tampered', 'plan-ready',
]);
export const FEATURE_TYPES = Object.freeze(['ci-red', 'findings', 'conflict', 'brief-changed', 'answer', 'build']);
export const DIGEST_TYPES = Object.freeze(['task-done', 'review-passed', 'ci-running', 'pushed', 'progress', 'skipped-lines']);

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const entries = (x) => (isPlain(x) ? Object.entries(x) : []);
const list = (x) => (Array.isArray(x) ? x : []);
const text = (x) => (typeof x === 'string' ? x : null);

// What diff compares a first observation against when there is no cursor.
const EMPTY = Object.freeze({ seq: 0, features: {}, prs: {}, testMerges: [], stop: false });

// A status's content, leaving out the time it was written: two statuses with
// the same content are no change, however often the hook rewrote the file.
function statusKey(status) {
  if (!isPlain(status)) return 'none';
  const { updatedAt, ...rest } = status; // eslint-disable-line no-unused-vars
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
}

// The PRs as last known: the earlier ones, with what this observation names laid over them.
function knownPrs(prev, next) {
  const prs = { ...(isPlain(prev?.prs) ? prev.prs : {}) };
  for (const [key, p] of entries(next?.prs)) {
    if (isPlain(p)) prs[key] = p;
    else delete prs[key];
  }
  return prs;
}

const pairOf = (m) => [String(m.a), String(m.b)].sort().join('+');

// The test merges as last known, one per pair, in the same way. A pair is
// kept only while both its features are in `next`: once one has gone, so has
// the pair, and a clash between the two when both are back wakes again.
function knownMerges(prev, next) {
  const merges = new Map(list(prev?.testMerges).filter(isPlain).map((m) => [pairOf(m), m]));
  for (const m of list(next?.testMerges)) if (isPlain(m)) merges.set(pairOf(m), m);
  const observed = (w) => isPlain(next?.features) && Object.hasOwn(next.features, String(w)) && isPlain(next.features[String(w)]);
  return [...merges.values()].filter((m) => observed(m.a) && observed(m.b));
}

// Whether the feature is waiting on someone else, so its stillness is no sign of being stuck:
// it waits on something by its own word, it is done, or its pull request waits on CI,
// a review or a merge (red CI, findings or a conflict are the session's to fix). A PR
// the watcher has never seen is unknown, and unknown is not waiting.
function isWaiting(f, prs) {
  const s = f.status;
  if (f.report === true) return true;
  if (!isPlain(s)) return false;
  if (s.waitingOn !== null && s.waitingOn !== undefined) return true;
  if (s.phase === 'done') return true;
  if (s.phase === 'pr-open') {
    const pr = prs[s.pr];
    if (!isPlain(pr)) return false;
    return !(pr.ci === 'failure' || pr.review === 'findings' || pr.mergeable === 'no');
  }
  return false;
}

// The question and extra-plan ids that are this feature's (`q-<work>-<n>`), and how many are not.
function ownIds(work, ids) {
  const own = [];
  let stray = 0;
  for (const id of list(ids)) {
    const rest = typeof id === 'string' && id.startsWith(`q-${work}-`) ? id.slice(work.length + 3) : null;
    if (rest !== null && /^[0-9]+$/.test(rest)) own.push(id);
    else stray += 1;
  }
  return { own, stray };
}

// The brief as judged against the foreman's record. `pf` is the feature as
// last settled, or null. The hash recorded before counts only until the file
// first matches the latest record: after that, going back to it undoes the
// amendment, which is tampering. With nothing recorded, nothing is tampered.
function judgeBrief(pf, f) {
  const recorded = text(f.recordedBrief);
  const hash = text(f.briefHash);
  const sameRecord = pf !== null && text(pf.recordedBrief) === recorded;
  const caughtUp = sameRecord && (pf.briefCaughtUp ?? text(pf.briefHash) === recorded) === true;
  const matched = recorded !== null && (hash === recorded || caughtUp);
  let tampered = false;
  if (f.gone !== true && recorded !== null && hash !== recorded) {
    const before = text(f.recordedBefore);
    tampered = !(hash !== null && hash === before && !caughtUp);
  }
  return { matched, tampered };
}

// Whether the last settled feature counted as tampered (an unsettled one is judged on its own).
const wasTampered = (pf) => pf !== null && (pf.briefTampered ?? judgeBrief(null, pf).tampered) === true;

const awakeOf = (obs) => (typeof obs?.awake === 'number' && Number.isFinite(obs.awake) && obs.awake > 0 ? obs.awake : 0);
const seqOf = (obs) => (Number.isInteger(obs?.seq) && obs.seq >= 0 ? obs.seq : 0);

// `next` as the watcher keeps it for its next diff, holding only what diff reads:
//   - its count, one more than the observation before;
//   - each feature with `still`, the awake time its status has stood unchanged
//     while not waiting, and how its brief stands against the foreman's record;
//   - the PRs and test merges as last known;
//   - no events, since the next observation holds only those after the cursor.
export function settle(prev, next) {
  const before = isPlain(prev) ? prev : EMPTY;
  const awake = awakeOf(next);
  const prs = knownPrs(before, next);
  const features = {};
  for (const [work, f] of entries(next?.features)) {
    if (!isPlain(f)) continue;
    const p = isPlain(before.features) ? before.features[work] : undefined;
    const pf = isPlain(p) ? p : null;
    const same = pf !== null && statusKey(pf.status) === statusKey(f.status);
    const prior = same && typeof pf.still === 'number' && Number.isFinite(pf.still) ? pf.still : 0;
    const brief = judgeBrief(pf, f);
    features[work] = {
      ...f,
      still: same && !isWaiting(f, prs) ? prior + awake : 0,
      briefCaughtUp: brief.matched,
      briefTampered: brief.tampered,
    };
  }
  const { events, ...rest } = isPlain(next) ? next : {}; // eslint-disable-line no-unused-vars
  return { ...rest, seq: seqOf(before) + 1, features, prs, testMerges: knownMerges(before, next) };
}

const isOver = (f) => isPlain(f) && isPlain(f.status)
  && typeof f.status.tokens === 'number' && typeof f.appetite === 'number'
  && f.status.tokens > f.appetite;

// The lanes whose work starts with no approval when no one is shown it first.
const STARTS_UNAPPROVED = Object.freeze(['quick', 'bug']);

const workOfQuestion = (id) => (typeof id === 'string' ? /^q-([a-z0-9-]+)-[0-9]+$/.exec(id)?.[1] : undefined);

// The events from state: every one in the observation is after the cursor; only signed clicks count as actions.
function stateEvents(next, out) {
  for (const e of list(next.events)) {
    if (!isPlain(e) || typeof e.id !== 'string' || !isPlain(e.data)) continue;
    const { id, kind, data } = e;
    if (kind === 'work') {
      if (STARTS_UNAPPROVED.includes(data.lane) && data.visible === false) out.push({ type: 'work-ready', work: data.id, id, detail: { lane: data.lane } });
    } else if (kind === 'feature') {
      if (data.step === 'building' && data.brief === undefined && typeof data.work === 'string') out.push({ type: 'build', work: data.work, id, detail: { slice: data.slice ?? null } });
    } else if (kind === 'incident') {
      out.push({ type: 'incident', id, detail: { incident: data.id, what: data.what } });
    } else if (kind === 'action' && e.verified === true) {
      if (data.action === 'approve-work') {
        out.push({ type: 'work-ready', work: data.work, id, detail: { lane: data.lane, hash: data.hash } });
      } else if (data.action === 'amend') {
        out.push({ type: 'amended', work: data.work, id, detail: { hash: data.hash } });
      } else if (data.action === 'answer') {
        out.push({ type: 'answer', work: workOfQuestion(data.questionId), id, detail: { questionId: data.questionId, label: data.label } });
      }
    }
  }
}

function featureEvents(prev, next, settled, out) {
  const anchor = seqOf(prev);
  for (const [work, f] of entries(next.features)) {
    if (!isPlain(f)) continue;
    const p = isPlain(prev.features) ? prev.features[work] : undefined;
    const pf = isPlain(p) ? p : null;

    const questions = ownIds(work, f.questions);
    const extraPlans = ownIds(work, f.extraPlans);
    const asked = new Set(list(pf?.questions));
    for (const q of questions.own) if (!asked.has(q)) out.push({ type: 'question', work, id: q, detail: {} });
    const split = new Set(list(pf?.extraPlans));
    for (const q of extraPlans.own) if (!split.has(q)) out.push({ type: 'extra-plan', work, id: q, detail: {} });

    const skippedOf = (x, ownQ, ownP) => (Number.isInteger(x?.skipped) ? x.skipped : 0) + ownQ.stray + ownP.stray;
    const skipped = skippedOf(f, questions, extraPlans);
    const before = pf === null ? 0 : skippedOf(pf, ownIds(work, pf.questions), ownIds(work, pf.extraPlans));
    if (skipped > 0 && skipped !== before) {
      out.push({ type: 'skipped-lines', work, id: `skipped-lines:${work}:${skipped}`, detail: { skipped } });
    }

    // The brief: tampered goes to the foreman; the file catching up with the
    // foreman's record goes to the session. Nothing here is ever an amendment.
    const hash = text(f.briefHash);
    const s = settled.features[work];
    if (s.briefTampered && !(wasTampered(pf) && text(pf.briefHash) === hash)) {
      out.push({
        type: 'brief-tampered', work, id: `brief-tampered:${work}:${hash ?? 'none'}:${anchor}`, detail: { found: hash, recorded: text(f.recordedBrief) },
      });
    } else if (pf !== null && f.gone !== true && hash !== null && hash === text(f.recordedBrief) && text(pf.briefHash) !== hash) {
      out.push({ type: 'brief-changed', work, id: `brief-changed:${work}:${hash}:${anchor}`, detail: { hash } });
    }

    const status = isPlain(f.status) ? f.status : null;
    const ps = isPlain(pf?.status) ? pf.status : null;
    if (status && pf && statusKey(status) !== statusKey(ps)) {
      const n = status.task?.n ?? 0;
      if (n >= 1 && n > (ps?.task?.n ?? 0)) out.push({ type: 'task-done', work, id: `task-done:${work}:${n}`, detail: { task: status.task } });
      out.push({
        type: 'progress',
        work,
        id: `progress:${work}:${status.updatedAt}`,
        detail: { phase: status.phase, task: status.task, fixRound: status.fixRound, waitingOn: status.waitingOn, tokens: status.tokens },
      });
    }

    // A plan arriving: the phase is ready-to-build now and was not when last seen.
    if (status?.phase === 'ready-to-build' && ps?.phase !== 'ready-to-build') {
      out.push({
        type: 'plan-ready', work, id: `plan-ready:${work}:${anchor}`, detail: { phase: status.phase, task: status.task, slice: status.slice },
      });
    }

    if (s.still >= STUCK_MS && !((pf?.still ?? 0) >= STUCK_MS)) {
      const id = status ? `stuck:${work}:${status.updatedAt}` : `stuck:${work}:none:${anchor}`;
      out.push({ type: 'stuck', work, id, detail: { still: s.still, phase: status?.phase ?? null } });
    }

    if (isOver(f) && !(isOver(pf) && pf.appetite === f.appetite)) {
      out.push({ type: 'over-appetite', work, id: `over-appetite:${work}:${f.appetite}`, detail: { tokens: status.tokens, appetite: f.appetite } });
    }
  }
}

// What a pull request's state says, each to whom section 11 sends it.
const PR_CONDITIONS = [
  ['merge-ready', (p) => p.ci === 'success' && p.review === 'clean' && p.mergeable === 'yes'],
  ['ci-red', (p) => p.ci === 'failure'],
  ['findings', (p) => p.review === 'findings'],
  ['conflict', (p) => p.mergeable === 'no'],
  ['review-passed', (p) => p.review === 'clean'],
  ['ci-running', (p) => p.ci === 'pending'],
];

// The PRs this observation names, each against its last known state.
function prEvents(prev, next, out) {
  for (const [key, p] of entries(next.prs)) {
    if (!isPlain(p)) continue;
    const pr = Number(key);
    const before = isPlain(prev.prs) && isPlain(prev.prs[key]) ? prev.prs[key] : null;
    const sameHead = before !== null && before.head === p.head;
    for (const [type, holds] of PR_CONDITIONS) {
      if (holds(p) && !(sameHead && holds(before))) {
        out.push({ type, work: p.work, pr, id: `${type}:${p.work}:${p.head}`, detail: { head: p.head } });
      }
    }
    if (before !== null && !sameHead && typeof p.head === 'string') {
      out.push({ type: 'pushed', work: p.work, pr, id: `pushed:${p.work}:${p.head}`, detail: { head: p.head } });
    }
  }
}

// STOP set, and a pair of features newly not clean against its last known test merge.
function edgeEvents(prev, next, out) {
  const anchor = seqOf(prev);
  if (next.stop === true && prev.stop !== true) out.push({ type: 'stop', id: `stop:${anchor}`, detail: {} });
  const known = new Map(list(prev.testMerges).filter(isPlain).map((m) => [pairOf(m), m.clean]));
  for (const m of list(next.testMerges)) {
    if (!isPlain(m) || m.clean !== false) continue;
    const key = pairOf(m);
    if (known.get(key) === false) continue;
    out.push({ type: 'clash', id: `clash:${key}:${anchor}`, detail: { a: m.a, b: m.b } });
  }
}

// The events between two observations. With no `prev` (no cursor), `next` is
// judged against an empty observation, so what is already waiting wakes on the
// first run. An id in `seen` was sent before and is dropped; an id in `handled`
// (the foreman wrote it while handling a wake) is marked so it goes to the digest.
export function diff(prev, next, { handled = new Set(), seen = new Set() } = {}) {
  if (!isPlain(next)) return [];
  const before = isPlain(prev) ? prev : EMPTY;
  const settled = settle(before, next);
  const out = [];
  stateEvents(next, out);
  featureEvents(before, next, settled, out);
  prEvents(before, next, out);
  edgeEvents(before, next, out);
  const kept = new Set();
  const events = [];
  for (const e of out) {
    if (seen.has(e.id) || kept.has(e.id)) continue;
    kept.add(e.id);
    events.push(handled.has(e.id) ? { ...e, handled: true } : e);
  }
  return events;
}

// Who hears each event. A handled event goes to the digest in place of the
// foreman; an answer still reaches its feature.
export function route(events) {
  const routed = { foreman: [], features: {}, digest: [] };
  const toFeature = (e) => {
    if (typeof e.work !== 'string') return;
    (routed.features[e.work] ??= []).push(e);
  };
  for (const e of list(events)) {
    if (FEATURE_TYPES.includes(e.type)) toFeature(e);
    if (FOREMAN_TYPES.includes(e.type)) (e.handled ? routed.digest : routed.foreman).push(e);
    else if (!FEATURE_TYPES.includes(e.type)) routed.digest.push(e);
  }
  return routed;
}

const timeOf = (t) => (t instanceof Date ? t.getTime() : Number(t));

// Gathers routed events into wakes: `{ to: 'foreman', events, digest, dropped }`
// or `{ to: 'feature', work, events, digest: [], dropped: 0 }`. Each recipient's
// events go out together once `windowMs` has passed since the first of them.
// The digest waits for the next foreman bundle, keeping its newest DIGEST_CAP
// events and counting the rest in `dropped`. `held` is what `held()` gave
// before a restart.
export function makeBundler({ windowMs = BUNDLE_MS, now = () => new Date(), held = null } = {}) {
  let foreman = null;
  const features = new Map();
  let digest = [];
  let dropped = 0;
  if (isPlain(held)) {
    const group = (g) => (isPlain(g) && typeof g.first === 'number' && Array.isArray(g.events) ? { first: g.first, events: [...g.events] } : null);
    foreman = group(held.foreman);
    for (const [work, g] of entries(held.features)) if (group(g)) features.set(work, group(g));
    digest = list(held.digest).filter(isPlain).slice(-DIGEST_CAP);
    dropped = Number.isInteger(held.dropped) && held.dropped > 0 ? held.dropped : 0;
  }

  const put = (group, events, t) => {
    const g = group ?? { first: t, events: [] };
    const ids = new Set(g.events.map((e) => e.id));
    for (const e of events) if (!ids.has(e.id)) { ids.add(e.id); g.events.push(e); }
    return g.events.length > 0 ? g : group;
  };

  return {
    add(routed) {
      const t = timeOf(now());
      foreman = put(foreman, list(routed?.foreman), t);
      for (const [work, events] of entries(routed?.features)) {
        const g = put(features.get(work) ?? null, list(events), t);
        if (g) features.set(work, g);
      }
      const ids = new Set(digest.map((e) => e.id));
      for (const e of list(routed?.digest)) if (!ids.has(e.id)) { ids.add(e.id); digest.push(e); }
      if (digest.length > DIGEST_CAP) {
        dropped += digest.length - DIGEST_CAP;
        digest = digest.slice(-DIGEST_CAP);
      }
    },
    due() {
      const t = timeOf(now());
      const out = [];
      if (foreman && t - foreman.first >= windowMs) {
        out.push({ to: 'foreman', events: foreman.events, digest, dropped });
        foreman = null;
        digest = [];
        dropped = 0;
      }
      for (const [work, g] of features) {
        if (t - g.first >= windowMs) {
          out.push({ to: 'feature', work, events: g.events, digest: [], dropped: 0 });
          features.delete(work);
        }
      }
      return out;
    },
    // What is waiting, for the cursor: a restarted bundler picks up from here.
    held() {
      return structuredClone({ foreman, features: Object.fromEntries(features), digest, dropped });
    },
  };
}

// One watch: the events since the cursor's observation, and the cursor to keep
// after them (the ids now seen, and the observation settled for the next diff).
// The returned cursor has no `held`: the caller sets it from its bundler's
// `held()` before writing, so a restart never brings back an old bundle.
export function step(cursor, next, { handled = new Set() } = {}) {
  const prev = isPlain(cursor?.prev) ? cursor.prev : null;
  const before = list(cursor?.seen);
  const events = diff(prev, next, { handled, seen: new Set(before) });
  const seen = [...before, ...events.map((e) => e.id)].slice(-SEEN_CAP);
  return { events, cursor: { seen, prev: settle(prev, next) } };
}

// --- The cursor, at projects/<p>/watcher/cursor.json ---

export function cursorFile(project) {
  return path.join(stateDir(project), '..', 'watcher', 'cursor.json');
}

const FRESH = () => ({ seen: [], prev: null, held: null });
const validCursor = (c) => isPlain(c)
  && Array.isArray(c.seen) && c.seen.every((x) => typeof x === 'string')
  && (c.prev === null || c.prev === undefined || isPlain(c.prev))
  && (c.held === null || c.held === undefined || isPlain(c.held));

function lstatOf(file) {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}

// The cursor the watcher last wrote, or a fresh one when there is none, it is
// not a regular file or it is not the right shape.
export function readCursor(project) {
  const file = cursorFile(project);
  if (!lstatOf(file)?.isFile()) return FRESH();
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!validCursor(c)) return FRESH();
    return { seen: c.seen.slice(-SEEN_CAP), prev: c.prev ?? null, held: c.held ?? null };
  } catch {
    return FRESH();
  }
}

// Writes the cursor whole, to a temporary name renamed over the old one, keeping
// the last SEEN_CAP ids. A cursor file or folder that is a link, or anything but
// a regular file or folder, is refused.
export function writeCursor(project, cursor) {
  const fail = () => { throw new Error("The watcher's cursor can't be written"); };
  if (!validCursor(cursor)) fail();
  const file = cursorFile(project);
  const dir = path.dirname(file);
  const dirStat = lstatOf(dir);
  if (dirStat !== null && !dirStat.isDirectory()) fail();
  const fileStat = lstatOf(file);
  if (fileStat !== null && !fileStat.isFile()) fail();
  fs.mkdirSync(dir, { recursive: true });
  const body = { seen: cursor.seen.slice(-SEEN_CAP), prev: cursor.prev ?? null, held: cursor.held ?? null };
  const temp = `${file}.${crypto.randomUUID().slice(0, 12)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(body)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
