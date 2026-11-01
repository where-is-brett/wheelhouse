// scripts/engine/waiting.js
// Which pieces wait on the director (delegated decisions design, section 8.1), from what the runner and the dispatcher's
// runner know and never from a run's `paused` record, which a usage limit writes too. The two sets stay apart, so neither
// module reads the other's file. A feature between slices has no card open, so it waits on a merge, not on the director.
// A run parked at a usage limit waits on no one, and holds back what would meet the same limit (unattended goals design,
// section 9.3): that is read from the record, so a helper started again keeps it.
import { MERGE_WORK } from './dispatcher.js';
import { since } from '../foreman/queue.js';
import { LIMIT_LATE_MINUTES, LIMIT_NO_RESET_HOURS } from './recovery.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const entriesOf = (x) => (isPlain(x) ? Object.entries(x) : []);
const answered = (views, id) => typeof views?.questions?.[id]?.answer?.label === 'string';

function runEnded(views, work, runId) {
  const list = views?.runs?.[work];
  return (Array.isArray(list) ? list : []).filter((r) => r?.data?.runId === runId).at(-1)?.data?.state === 'ended';
}

// parkedAtLimit(views) -> [{ runId, work, lateAt }]: each run whose latest `run` record is `paused` and whose latest `ask`
// is a usage limit. The reset's `started` or the run's ending says it is over, so nothing needs to hear of the ask being
// resolved; a record that missed those is put right by the runner's look at the engine. `lateAt` is when what should take
// it on counts as having failed (milliseconds): well past its reset, or a good while after an ask whose reset can't be read.
// Time the computer slept doesn't count, since nothing could take the run on.
export function parkedAtLimit(views) {
  const found = [];
  for (const [work, list] of entriesOf(views?.runs)) {
    if (!Array.isArray(list)) continue;
    const latest = new Map();
    for (const r of list) if (isPlain(r?.data)) latest.set(r.data.runId, r.data.state);
    const asks = Array.isArray(views?.asks?.[work]) ? views.asks[work] : [];
    for (const [runId, state] of latest) {
      const ask = asks.filter((a) => a?.data?.runId === runId).at(-1);
      if (state !== 'paused' || ask?.data?.kind !== 'usage-limit') continue;
      const reset = Date.parse(ask.data.resetAt);
      const from = Number.isNaN(reset) ? Date.parse(ask.at) : reset;
      const slept = (Array.isArray(views?.slept) ? views.slept : []).reduce((sum, s) => sum + Math.max(0, Date.parse(s.to) - Math.max(Date.parse(s.from), from)), 0);
      found.push({ runId, work, lateAt: from + slept + (Number.isNaN(reset) ? LIMIT_NO_RESET_HOURS * 60 * 60 * 1000 : LIMIT_LATE_MINUTES * 60 * 1000) });
    }
  }
  return found;
}
// limitedRuns(views, now) -> [runId], and limitedWork(views, now) -> [work], the same runs' pieces: what holds other work
// at `now`. One past `lateAt` holds nothing, since other work mustn't wait on a waker that failed; the runner raises its card.
const holding = (views, at) => parkedAtLimit(views).filter((r) => !(at && at.getTime() >= r.lateAt));
export const limitedRuns = (views, at) => holding(views, at).map((r) => r.runId);
export const limitedWork = (views, at) => [...new Set(holding(views, at).map((r) => r.work))];

// Whether the work has been queued again since this run began: an open card of that run no longer speaks for the work.
export function overtaken(kept, views) {
  const queued = views?.work?.[kept.work]?.work;
  const list = views?.runs?.[kept.work];
  const first = (Array.isArray(list) ? list : []).find((r) => r?.data?.runId === kept.runId);
  return Boolean(queued && first) && !since(first, queued);
}

// Whether a pull request's approval answers its card: one from before a park never saw what the queue is unsure of.
export function approvalAnswers(approval, parked) {
  return Boolean(approval) && (typeof parked?.at !== 'string' || (typeof approval.at === 'string' && approval.at >= parked.at));
}

// Each open card of the card router's: { id, work, kept }. A card still to be written has no id yet, and a joiner behind
// a card goes by its lead's, since that is the card its piece waits on.
function routerOpen({ state, views, prWork }) {
  const found = [];
  const add = (id, kept) => {
    const pr = kept?.ask?.mergeQuestion?.pr;
    const work = kept?.work === MERGE_WORK ? (Number.isInteger(pr) ? prWork(pr) : null) : kept?.work;
    if (typeof work !== 'string' || work === '') return;
    const outlives = kept.cap === true || kept.ask?.ownerLost === true;
    if (!outlives && kept.work !== MERGE_WORK && runEnded(views, kept.work, kept.runId)) return;
    // A cap card, or the card for a run that lost its process, outlives its run, but not the work's next queueing, whose run it would hold back.
    if (outlives && overtaken(kept, views)) return;
    // A cap card kept but never written asks nothing: the piece isn't waiting on the director for that.
    if (kept.cap === true && typeof id === 'string' && isPlain(views?.questions) && !isPlain(views.questions[id])) return;
    found.push({ id: (id === undefined ? undefined : views?.questions?.[id]?.joins) ?? id, work, kept });
  };
  for (const kept of Array.isArray(state?.waiting) ? state.waiting : []) add(undefined, kept);
  for (const [id, kept] of entriesOf(state?.questions)) if (!state.delivered?.[id] && !answered(views, id)) add(id, kept);
  for (const [key, kept] of entriesOf(state?.approvals)) {
    const [pr, sha] = key.split(':');
    const parked = kept.parked === true && state.parked?.[pr]?.head === sha ? state.parked[pr] : null;
    if (!state.delivered?.[key] && !approvalAnswers(views?.approvals?.[pr]?.[sha], parked)) add(key, kept);
  }
  return found;
}

// routerWaiting({ state, views, prWork }) -> Set<work>, from the card router's kept state. `prWork(pr)` names the piece
// that opened a pull request, for a merge-queue card, which is routed under MERGE_WORK; one that names none is left out.
// An ask whose run has ended can't be answered, so only a cap card or a merge card, which outlive their runs, stand after that.
export function routerWaiting({ state, views, prWork = () => null } = {}) {
  return new Set(routerOpen({ state, views, prWork }).map((c) => c.work));
}

const levelOf = (views, id, kept) => views?.questions?.[id]?.question?.data?.level ?? (kept?.ask?.level === 4 ? 4 : 3);

// routerCards({ state, views, prWork }) -> [{ id, work, rank }], the written cards behind routerWaiting. A card's rank is its level.
export function routerCards({ state, views, prWork = () => null } = {}) {
  return routerOpen({ state, views, prWork }).filter((c) => typeof c.id === 'string').map((c) => ({ id: c.id, work: c.work, rank: levelOf(views, c.id, c.kept) }));
}

// Each open card of the dispatcher's runner's: [{ id, work }].
function ownOpen({ state, views }) {
  // A card kept but never written asks nothing: the piece isn't waiting on the director for that.
  const open = (id) => typeof id === 'string' && isPlain(views?.questions?.[id]) && !answered(views, id);
  const found = [];
  for (const [work, kept] of entriesOf(state?.features)) {
    for (const id of [kept?.asked, ...entriesOf(kept?.stalls).filter(([, held]) => held?.done !== true).map(([, held]) => held?.id)]) if (open(id)) found.push({ id, work });
  }
  for (const asked of [state?.clashAsked, state?.redAsked, state?.cutOffAsked]) {
    for (const [work, id] of entriesOf(asked)) if (open(id)) found.push({ id, work });
  }
  for (const held of Object.values(state?.areas ?? {})) if (open(held?.id)) found.push({ id: held.id, work: held.work });
  for (const entry of Array.isArray(state?.returning) ? state.returning : []) if (open(entry?.asked)) found.push({ id: entry.asked, work: entry.work });
  // A merge queue that can't start: every piece it would take waits on the one card.
  if (open(state?.queueFault?.asked)) for (const work of state.queueFault.works) found.push({ id: state.queueFault.asked, work });
  return found;
}

// ownWaiting({ state, views }) -> Set<work>, from the dispatcher's runner's kept state: its own cards, unanswered.
export function ownWaiting({ state, views } = {}) {
  return new Set(ownOpen({ state, views }).map((c) => c.work));
}

// ownCards({ state, views }) -> [{ id, work, rank }], the cards behind ownWaiting.
export function ownCards({ state, views } = {}) {
  return ownOpen({ state, views }).map((c) => ({ ...c, rank: levelOf(views, c.id) }));
}
