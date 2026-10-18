// scripts/watcher/core.js
// The watcher's core: what it sees turned into wakes (design section 11).
//
//   Observation = {
//     at: string,             when it was made, UTC ISO 8601
//     awake: number,          milliseconds the watcher ran since its last observation,
//                             so time the computer slept never counts
//     events: Array<{ id, kind, data, verified }>,   state events; `verified` for a signed action
//     features: Record<work, {
//       status: Status | null,
//       questions: string[],          ids of `question` lines in the questions file
//       extraPlans: string[],         ids of `extra-plan` lines
//       skipped: number,              malformed question lines skipped
//       briefHash: string | null,     the brief file's hash as it is now
//       recordedBrief: string | null, the hash the foreman last recorded in state
//       recordedBefore: string | null, the hash it recorded before that one
//       appetite: number | null,      the brief's token appetite
//       report: boolean,
//       still?: number,               set by settle: awake ms the status has stood unchanged
//     }>,
//     prs: Record<pr, { work, head, ci, mergeable, review }>,
//     testMerges: Array<{ a, b, clean }>,
//     stop: boolean,
//   }
//
//   WatchEvent = { type, work?, pr?, id, detail, handled? }
//
// `diff` and `route` are pure, and the bundler takes its clock from the caller.
// Every event's id is made from its inputs alone (a state event's own id, a
// question's id, `<type>:<work>:<head>` and so on), so a watcher restarted from
// its cursor makes the same ids again and the cursor's `seen` list stops any of
// them waking twice. Only the cursor's reader and writer touch the disk.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_MS, STUCK_MS } from '../lib/build-loop.js';
import { stateDir } from '../lib/paths.js';

// How many ids the cursor remembers.
export const SEEN_CAP = 5000;

export const FOREMAN_TYPES = Object.freeze([
  'work-ready', 'amended', 'question', 'extra-plan', 'answer', 'merge-ready', 'stuck',
  'over-appetite', 'clash', 'stop', 'incident', 'brief-tampered',
]);
export const FEATURE_TYPES = Object.freeze(['ci-red', 'findings', 'conflict', 'brief-changed', 'answer']);
export const DIGEST_TYPES = Object.freeze(['task-done', 'review-passed', 'ci-running', 'pushed', 'progress', 'skipped-lines']);

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const entries = (x) => (isPlain(x) ? Object.entries(x) : []);
const list = (x) => (Array.isArray(x) ? x : []);

// A status's content, leaving out the time it was written: two statuses with
// the same content are no change, however often the hook rewrote the file.
function statusKey(status) {
  if (!isPlain(status)) return 'none';
  const { updatedAt, ...rest } = status; // eslint-disable-line no-unused-vars
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
}

// Whether the feature is waiting on someone else, so its stillness is no sign of being stuck:
// it waits on something by its own word, it is done, or its pull request waits on CI,
// a review or a merge (red CI, findings or a conflict are the session's to fix).
function isWaiting(f, prs) {
  const s = f.status;
  if (f.report === true) return true;
  if (!isPlain(s)) return false;
  if (s.waitingOn !== null && s.waitingOn !== undefined) return true;
  if (s.phase === 'done') return true;
  if (s.phase === 'pr-open') {
    const pr = isPlain(prs) ? prs[s.pr] : undefined;
    if (!isPlain(pr)) return true;
    return !(pr.ci === 'failure' || pr.review === 'findings' || pr.mergeable === 'no');
  }
  return false;
}

const awakeOf = (obs) => (typeof obs?.awake === 'number' && Number.isFinite(obs.awake) && obs.awake > 0 ? obs.awake : 0);

// `next` as the watcher keeps it for its next diff: each feature gains `still`,
// the awake time its status has stood unchanged while not waiting, and the
// state events are kept by id only, which is all a later diff reads of them.
export function settle(prev, next) {
  const awake = awakeOf(next);
  const features = {};
  for (const [work, f] of entries(next?.features)) {
    const before = isPlain(prev?.features) ? prev.features[work] : undefined;
    const same = isPlain(before) && statusKey(before.status) === statusKey(f.status);
    const prior = same && typeof before.still === 'number' && Number.isFinite(before.still) ? before.still : 0;
    features[work] = { ...f, still: same && !isWaiting(f, next.prs) ? prior + awake : 0 };
  }
  return { ...next, events: list(next?.events).map((e) => ({ id: e.id })), features };
}

const isOver = (f) => isPlain(f) && isPlain(f.status)
  && typeof f.status.tokens === 'number' && typeof f.appetite === 'number'
  && f.status.tokens > f.appetite;

// Whether the brief file is anything but the foreman's: neither the hash it last
// recorded nor, while it rewrites the file after recording, the hash before.
const isTampered = (f) => isPlain(f) && typeof f.briefHash === 'string'
  && f.briefHash !== f.recordedBrief && f.briefHash !== f.recordedBefore;

const workOfQuestion = (id) => (typeof id === 'string' ? /^q-([a-z0-9-]+)-[0-9]+$/.exec(id)?.[1] : undefined);

// The events from state: new since the last observation, and only signed clicks for actions.
function stateEvents(prev, next, out) {
  const before = new Set(list(prev.events).map((e) => e?.id));
  for (const e of list(next.events)) {
    if (!isPlain(e) || typeof e.id !== 'string' || before.has(e.id) || !isPlain(e.data)) continue;
    const { id, kind, data } = e;
    if (kind === 'work') {
      if (data.lane === 'quick' && data.visible === false) out.push({ type: 'work-ready', work: data.id, id, detail: { lane: 'quick' } });
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

function featureEvents(prev, next, out) {
  const settled = settle(prev, next).features;
  for (const [work, f] of entries(next.features)) {
    if (!isPlain(f)) continue;
    const p = isPlain(prev.features) ? prev.features[work] : undefined;
    const pf = isPlain(p) ? p : null;

    const asked = new Set(list(pf?.questions));
    for (const q of list(f.questions)) if (!asked.has(q)) out.push({ type: 'question', work, id: q, detail: {} });
    const split = new Set(list(pf?.extraPlans));
    for (const q of list(f.extraPlans)) if (!split.has(q)) out.push({ type: 'extra-plan', work, id: q, detail: {} });

    const skipped = Number.isInteger(f.skipped) ? f.skipped : 0;
    if (skipped > 0 && skipped !== (pf?.skipped ?? 0)) {
      out.push({ type: 'skipped-lines', work, id: `skipped-lines:${work}:${skipped}`, detail: { skipped } });
    }

    // The brief: tampered goes to the foreman; the file catching up with the
    // foreman's record goes to the session. Nothing here is ever an amendment.
    if (isTampered(f) && !(isTampered(pf) && pf.briefHash === f.briefHash)) {
      out.push({ type: 'brief-tampered', work, id: `brief-tampered:${work}:${f.briefHash}`, detail: { found: f.briefHash, recorded: f.recordedBrief ?? null } });
    } else if (pf && typeof f.briefHash === 'string' && f.briefHash === f.recordedBrief && pf.briefHash !== f.briefHash) {
      out.push({ type: 'brief-changed', work, id: `brief-changed:${work}:${f.briefHash}`, detail: { hash: f.briefHash } });
    }

    const s = isPlain(f.status) ? f.status : null;
    const ps = isPlain(pf?.status) ? pf.status : null;
    if (s && pf && statusKey(s) !== statusKey(ps)) {
      const n = s.task?.n ?? 0;
      if (n >= 1 && n > (ps?.task?.n ?? 0)) out.push({ type: 'task-done', work, id: `task-done:${work}:${n}`, detail: { task: s.task } });
      out.push({
        type: 'progress',
        work,
        id: `progress:${work}:${s.updatedAt}`,
        detail: { phase: s.phase, task: s.task, fixRound: s.fixRound, waitingOn: s.waitingOn, tokens: s.tokens },
      });
    }

    const still = settled[work].still;
    if (still >= STUCK_MS && !((pf?.still ?? 0) >= STUCK_MS)) {
      out.push({ type: 'stuck', work, id: `stuck:${work}:${s?.updatedAt ?? 'none'}`, detail: { still, phase: s?.phase ?? null } });
    }

    if (isOver(f) && !(isOver(pf) && pf.appetite === f.appetite)) {
      out.push({ type: 'over-appetite', work, id: `over-appetite:${work}:${f.appetite}`, detail: { tokens: s.tokens, appetite: f.appetite } });
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

// A change of state between two observations, anchored on the earlier one's
// time: the same change seen again from the same cursor has the same id.
function edgeEvents(prev, next, out) {
  const anchor = typeof prev.at === 'string' ? prev.at : 'start';
  if (next.stop === true && prev.stop !== true) out.push({ type: 'stop', id: `stop:${anchor}`, detail: {} });
  const pair = (m) => [String(m.a), String(m.b)].sort().join('+');
  const clean = new Map(list(prev.testMerges).filter(isPlain).map((m) => [pair(m), m.clean === true]));
  for (const m of list(next.testMerges)) {
    if (!isPlain(m) || m.clean !== false) continue;
    const key = pair(m);
    if (clean.get(key) === false) continue;
    out.push({ type: 'clash', id: `clash:${key}:${anchor}`, detail: { a: m.a, b: m.b } });
  }
}

// The events between two observations. The first observation (no `prev`) is
// the starting point and makes none: the foreman reads where things stand when
// it starts. An id in `seen` was sent before and is dropped; an id in `handled`
// (the foreman wrote it while handling a wake) is marked so it goes to the digest.
export function diff(prev, next, { handled = new Set(), seen = new Set() } = {}) {
  if (!isPlain(prev) || !isPlain(next)) return [];
  const out = [];
  stateEvents(prev, next, out);
  featureEvents(prev, next, out);
  prEvents(prev, next, out);
  edgeEvents(prev, next, out);
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

// Gathers routed events into wakes. Each recipient's events go out together
// once `windowMs` has passed since the first of them; the digest waits for the
// next foreman bundle. `held` is what `held()` gave before a restart.
export function makeBundler({ windowMs = BUNDLE_MS, now = () => new Date(), held = null } = {}) {
  let foreman = null;
  const features = new Map();
  let digest = [];
  if (isPlain(held)) {
    const group = (g) => (isPlain(g) && typeof g.first === 'number' && Array.isArray(g.events) ? { first: g.first, events: [...g.events] } : null);
    foreman = group(held.foreman);
    for (const [work, g] of entries(held.features)) if (group(g)) features.set(work, group(g));
    digest = list(held.digest).filter(isPlain);
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
    },
    due() {
      const t = timeOf(now());
      const out = [];
      if (foreman && t - foreman.first >= windowMs) {
        out.push({ to: 'foreman', events: foreman.events, digest });
        foreman = null;
        digest = [];
      }
      for (const [work, g] of features) {
        if (t - g.first >= windowMs) {
          out.push({ to: work, events: g.events, digest: [] });
          features.delete(work);
        }
      }
      return out;
    },
    // What is waiting, for the cursor: a restarted bundler picks up from here.
    held() {
      return structuredClone({ foreman, features: Object.fromEntries(features), digest });
    },
  };
}

// One watch: the events since the cursor's observation, and the cursor to keep
// after them (the ids now seen, and the observation settled for the next diff).
export function step(cursor, next, { handled = new Set() } = {}) {
  const prev = isPlain(cursor?.prev) ? cursor.prev : null;
  const before = list(cursor?.seen);
  const events = diff(prev, next, { handled, seen: new Set(before) });
  const seen = [...before, ...events.map((e) => e.id)].slice(-SEEN_CAP);
  return { events, cursor: { ...cursor, seen, prev: settle(prev, next) } };
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
