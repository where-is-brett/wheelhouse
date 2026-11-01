// scripts/engine/waiting.js
// Which pieces wait on the director (delegated decisions design, section 8.1), from what the runner and the dispatcher's
// runner know and never from a run's `paused` record, which a usage limit writes too. The two sets stay apart, so neither
// module reads the other's file. A feature between slices has no card open, so it waits on a merge, not on the director.
import { MERGE_WORK } from './dispatcher.js';
import { since } from '../foreman/queue.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const entriesOf = (x) => (isPlain(x) ? Object.entries(x) : []);
const answered = (views, id) => typeof views?.questions?.[id]?.answer?.label === 'string';

function runEnded(views, work, runId) {
  const list = views?.runs?.[work];
  return (Array.isArray(list) ? list : []).filter((r) => r?.data?.runId === runId).at(-1)?.data?.state === 'ended';
}

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
    if (kept.cap !== true && kept.work !== MERGE_WORK && runEnded(views, kept.work, kept.runId)) return;
    // A cap card outlives its run, but not the work's next queueing, whose run it would hold back.
    if (kept.cap === true && overtaken(kept, views)) return;
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
  for (const asked of [state?.clashAsked, state?.redAsked]) {
    for (const [work, id] of entriesOf(asked)) if (open(id)) found.push({ id, work });
  }
  for (const entry of Array.isArray(state?.returning) ? state.returning : []) if (open(entry?.asked)) found.push({ id: entry.asked, work: entry.work });
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
