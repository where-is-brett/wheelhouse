// scripts/engine/waiting.js
// Which pieces wait on the director (delegated decisions design, section 8.1), from what the runner and the dispatcher's
// runner know and never from a run's `paused` record, which a usage limit writes too. The two sets stay apart, so neither
// module reads the other's file. A feature between slices has no card open, so it waits on a merge, not on the director.
import { MERGE_WORK } from './dispatcher.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const entriesOf = (x) => (isPlain(x) ? Object.entries(x) : []);
const answered = (views, id) => typeof views?.questions?.[id]?.answer?.label === 'string';

function runEnded(views, work, runId) {
  const list = views?.runs?.[work];
  return (Array.isArray(list) ? list : []).filter((r) => r?.data?.runId === runId).at(-1)?.data?.state === 'ended';
}

// routerWaiting({ state, views, prWork }) -> Set<work>, from the card router's kept state. `prWork(pr)` names the piece
// that opened a pull request, for a merge-queue card, which is routed under MERGE_WORK; one that names none is left out.
// An ask whose run has ended can't be answered, so only a cap card, which outlives its run, stands after that.
export function routerWaiting({ state, views, prWork = () => null } = {}) {
  const waiting = new Set();
  const add = (kept) => {
    const pr = kept?.ask?.mergeQuestion?.pr;
    const work = kept?.work === MERGE_WORK ? (Number.isInteger(pr) ? prWork(pr) : null) : kept?.work;
    if (typeof work !== 'string' || work === '') return;
    if (kept.cap !== true && runEnded(views, kept.work, kept.runId)) return;
    waiting.add(work);
  };
  for (const kept of Array.isArray(state?.waiting) ? state.waiting : []) add(kept);
  for (const [id, kept] of entriesOf(state?.questions)) if (!state.delivered?.[id] && !answered(views, id)) add(kept);
  for (const [key, kept] of entriesOf(state?.approvals)) {
    const [pr, sha] = key.split(':');
    if (!state.delivered?.[key] && !views?.approvals?.[pr]?.[sha]) add(kept);
  }
  return waiting;
}

// ownWaiting({ state, views }) -> Set<work>, from the dispatcher's runner's kept state: its own cards, unanswered.
export function ownWaiting({ state, views } = {}) {
  const waiting = new Set();
  const open = (id) => typeof id === 'string' && !answered(views, id);
  for (const [work, kept] of entriesOf(state?.features)) {
    const stalled = entriesOf(kept?.stalls).some(([, held]) => held?.done !== true && open(held?.id));
    if (open(kept?.asked) || stalled) waiting.add(work);
  }
  for (const asked of [state?.clashAsked, state?.redAsked]) {
    for (const [work, id] of entriesOf(asked)) if (open(id)) waiting.add(work);
  }
  return waiting;
}
