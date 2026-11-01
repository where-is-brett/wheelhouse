// scripts/engine/dispatcher.js
// The dispatcher (Archon design, section 7.3): a script, never a model. It takes the open work in the First Mate's
// order and decides what the engine starts now: at most `pace` runs at once, one of them a feature (a feature counts as
// one), only in the lanes the project put on the engine; work whose files overlap a running piece's holds (the clash
// check, as a hint); nothing starts under All stop, an open incident or a reached spend cap. It starts the merge queue
// when a pull request is newly ready, and again every 15 minutes while any wait, one merge-queue run at a time, so the
// engine never has more than pace + 2 runs going. A pull request the merge gate sent back for a clash is started again
// to bring it up to date; a second clash on the same work raises a card instead. A head whose check on this computer
// came back red goes back the same way, counted apart. A piece waiting on the director (waiting.js) gives its place up
// and keeps its files, which stay reserved until its work ends; new work holds once what waits and what runs reach
// PARKED_TIMES pace (delegated decisions design, sections 8.2 and 8.4).
import { paceOf, PACE } from '../lib/build-loop.js';
import { clashCheck, endedBy, since, STARTS_UNAPPROVED } from '../foreman/queue.js';
import { PARKED_TIMES } from '../delegation/limits.js';
import { startedOnOldEngine } from './lanes.js';

export const MERGE_QUEUE_EVERY_MS = 15 * 60 * 1000;
const FEATURE = 'feature';
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The latest record of each run of `id`, since the work was queued.
function runsOf(runs, id, entry) {
  const list = Array.isArray(runs?.[id]) ? runs[id] : [];
  const byRun = new Map();
  for (const e of list) if (isPlain(e?.data) && since(e, entry)) byRun.set(e.data.runId, e);
  return [...byRun.values()];
}

// The work the merge queue's own runs stand for, which no work record names: their asks are routed under it.
export const MERGE_WORK = 'merge-queue';

// dispatch({ work, runs, reports, features, settings, stop, incident, capsReached, mergeQueue, requests?, sentBack?, waiting?, reserved?, now })
//   -> { start: [{ work, lane }], hold: [{ work, why, by? }], startMergeQueue, requeue: [{ work, lane, branch, reason? }], clashCards: [{ work }], redCards: [{ work }] }
// `work`, `runs` and `reports` are the record's views; `mergeQueue` is { running, lastStart, waiting, newReady };
// `requests` is { counts(workId), used, cap, confirmed }: whether a piece's run would use the plan's counted requests,
// how many this month's runs used, the most the director allows, and whether the engine's count of them is confirmed;
// `sentBack` is [{ work, times, reason? }], the pull requests sent back: for a clash by the merge gate, and with reason
// `red` by the check runner; `waiting` the pieces that wait on the director; `reserved` { [work]: paths } the files held
// for a piece until its work ends. A hold's `by` names what holds it, where that can be named: the clash's pieces, the
// dependencies not merged, or what fills the parked limit.
export function dispatch({ work = {}, runs = {}, reports = {}, features: oldFeatures = {}, settings = {}, stop = false, incident = false, capsReached = false, mergeQueue = {}, requests = null, sentBack = [], waiting = [], reserved = {}, now = new Date() } = {}) {
  const lanes = Array.isArray(settings.engineLanes) ? settings.engineLanes : ['quick'];
  const pace = paceOf(settings);
  // A piece the old engine started before the switch finishes there (scripts/engine/lanes.js).
  const entries = Object.entries(isPlain(work) ? work : {})
    .filter(([id, e]) => isPlain(e?.work?.data) && lanes.includes(e.work.data.lane) && !startedOnOldEngine(oldFeatures, id, e));

  const parked = new Set(Array.isArray(waiting) ? waiting : []);
  const held = isPlain(reserved) ? reserved : {};
  const filesOf = (id, e) => [...new Set([...(e?.files ?? []), ...(Array.isArray(held[id]) ? held[id] : [])])];

  // What holds a slot: a run of the engine's that hasn't ended, and a feature from its first slice until it ends, since
  // its slices run one after another with the dispatcher's runner starting each. A piece waiting on the director holds none.
  const live = entries.filter(([id, e]) => {
    if (parked.has(id)) return false;
    const own = runsOf(runs, id, e.work);
    if (e.work.data.lane === FEATURE && own.length > 0) return !endedBy(reports, id, e.work);
    return own.some((r) => r.data.state !== 'ended');
  });
  let building = live.length;
  let features = live.filter(([, e]) => e.work.data.lane === FEATURE).length;
  // What a new piece mustn't clash with: what is live, what waits, and each reservation whose work hasn't ended.
  const waits = entries.filter(([id, e]) => parked.has(id) && !endedBy(reports, id, e.work));
  const running = [...live, ...waits].map(([id, e]) => ({ work: id, files: filesOf(id, e) }));
  for (const id of Object.keys(held)) {
    const e = isPlain(work) ? work[id] : undefined;
    if (!running.some((r) => r.work === id) && !endedBy(reports, id, e?.work)) running.push({ work: id, files: filesOf(id, e) });
  }

  const sent = Array.isArray(sentBack) ? sentBack.filter((s) => s.times > 0) : [];
  const requeue = [];
  const clashCards = [];
  const redCards = [];
  for (const [id, e] of entries) {
    const own = sent.filter((s) => s.work === id);
    if (own.length === 0 || runsOf(runs, id, e.work).some((r) => r.data.state !== 'ended')) continue;
    const red = own.find((s) => s.reason === 'red');
    const clash = own.find((s) => s.reason !== 'red');
    if (red?.times >= 2) redCards.push({ work: id });
    else if (clash?.times >= 2) clashCards.push({ work: id });
    else {
      const last = runsOf(runs, id, e.work).at(-1);
      requeue.push({ work: id, lane: e.work.data.lane, branch: last?.data?.branch ?? null, ...(red ? { reason: 'red' } : {}) });
    }
  }

  // The work not yet run, in the First Mate's order: a placed piece first, by its place, then oldest first.
  const queued = entries
    .filter(([id, e]) => runsOf(runs, id, e.work).length === 0 && !endedBy(reports, id, e.work) && !sent.some((s) => s.work === id))
    .sort(([a, x], [b, y]) => {
      const pa = x.work.data.place;
      const pb = y.work.data.place;
      const hasA = Number.isFinite(pa);
      const hasB = Number.isFinite(pb);
      if (hasA !== hasB) return hasA ? -1 : 1;
      if (hasA && pa !== pb) return pa - pb;
      const sa = x.since ?? x.work.at;
      const sb = y.since ?? y.work.at;
      return sa < sb ? -1 : sa > sb ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });

  const stopping = stop ? 'stop' : incident ? 'incident' : capsReached ? 'cap' : null;
  const start = [];
  const hold = [];
  let used = Number.isFinite(requests?.used) ? requests.used : 0;
  const parkedAt = PARKED_TIMES * pace.building;
  for (const [id, e] of queued) {
    const { lane, visible, dependsOn = [] } = e.work.data;
    let by = [];
    const needsApproval = !STARTS_UNAPPROVED.includes(lane) || visible === true || e.work.data.from !== undefined;
    let why = stopping;
    if (!why && needsApproval && e.approved !== true) why = 'unapproved';
    const unmerged = dependsOn.filter((dep) => reports?.[dep]?.data?.outcome !== 'merged');
    if (!why && unmerged.length > 0) {
      why = 'dependency';
      by = unmerged;
    }
    if (!why && requests && requests.counts?.(id) === true) {
      if (requests.confirmed !== true) why = 'requests-unconfirmed';
      else if (!(Number.isFinite(requests.cap) && used < requests.cap)) why = 'requests';
    }
    if (!why && (building + requeue.length >= pace.building || (lane === FEATURE && features >= PACE.featureLane))) why = 'pace';
    if (!why && waits.length + building + requeue.length >= parkedAt) {
      why = 'parked';
      by = waits.map(([other]) => other);
    }
    if (!why) {
      const clash = clashCheck({ files: e.files ?? [], running: running.filter((r) => r.work !== id), hotFiles: settings.hotFiles ?? [] });
      if (!clash.ok) {
        why = 'clash';
        by = [...new Set(clash.clashes.map((c) => c.work))];
      }
    }
    if (why) {
      hold.push({ work: id, why, ...(by.length > 0 ? { by } : {}) });
      continue;
    }
    start.push({ work: id, lane });
    building += 1;
    if (lane === FEATURE) features += 1;
    if (requests?.counts?.(id) === true) used += 1;
    running.push({ work: id, files: e.files ?? [] });
  }

  const due = mergeQueue.newReady === true || !mergeQueue.lastStart || now.getTime() - Date.parse(mergeQueue.lastStart) >= MERGE_QUEUE_EVERY_MS;
  const startMergeQueue = !stopping && mergeQueue.running !== true && (mergeQueue.waiting ?? 0) > 0 && due;
  return { start, hold, startMergeQueue, requeue: stopping ? [] : requeue, clashCards, redCards };
}
