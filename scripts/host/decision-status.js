// scripts/host/decision-status.js
// The commit status `wheelhouse/decision`, which marks a pull request as waiting on the director's decision (design section 6.4).
// Pending, "Waiting on decision <n>", while any decision on the piece is unanswered or answered with something other than the
// recommendation and not yet applied; success once none is. The gate's hold is the rule (scripts/gate/open-questions.js): this
// status only shows it on the host, so a refused or missing status never lets a merge through.
import { decisionsFrom } from '../decisions/pending.js';
import { DECISION_CONTEXT } from '../checks/where.js';

const QUESTION_LINE = /^Answer question (q-[a-z0-9-]+-[0-9]+)$/;
const MOST_KEPT = 200;

export const CLEARED_WORDS = 'No decision waiting';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The number the director sees for each decision, by the id of the question it answers: the decision's own while it waits, or
// the one it had when it was answered. A question the record has no card for is not in the map.
export function decisionNumbers(events, enrolled) {
  const numbers = new Map();
  const all = Array.isArray(events) ? events : [];
  const { pending, answered } = decisionsFrom(all, enrolled);
  for (const d of pending) {
    const id = QUESTION_LINE.exec(d.line ?? '')?.[1];
    if (id !== undefined) numbers.set(id, d.n);
  }
  const lineOf = new Map(all.filter((e) => e.kind === 'card' && typeof e.data?.line === 'string').map((e) => [e.id, e.data.line]));
  for (const a of answered) {
    const id = QUESTION_LINE.exec(lineOf.get(a.id) ?? '')?.[1];
    if (id !== undefined && !numbers.has(id)) numbers.set(id, a.n);
  }
  return numbers;
}

// "Waiting on decision 2", or "Waiting on decisions 2 and 3". A decision with no number in the record is called by the number its
// question ends in.
export function waitingWords(ids, numbers) {
  const ns = [...new Set(ids.map((id) => numbers.get(id) ?? Number(/-([0-9]+)$/.exec(id)?.[1])).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
  if (ns.length === 0) return 'Waiting on a decision';
  if (ns.length === 1) return `Waiting on decision ${ns[0]}`;
  return `Waiting on decisions ${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`;
}

// Sets the status on `sha`: pending while any of `waiting` (what decisionsWaiting gave) holds, success when none does and the
// piece has decisions at all (`any`). Said once for a commit and what it waits on, so a merge tried again posts nothing new.
// `posted` is the caller's memory of that, a Map. `events` and `enrolled` give the numbers, read only when pending is posted.
// A refusal (a host that takes no status, a key that may not) is not an error: the gate holds the merge either way.
// Returns what was posted, `{ state, description }`, or null.
export async function setDecisionStatus({ adapter, sha, waiting, any, events, enrolled, posted }) {
  if (typeof adapter?.setStatus !== 'function' || typeof sha !== 'string' || sha === '') return null;
  const holding = (Array.isArray(waiting) ? waiting : []).filter((w) => isPlain(w) && w.why !== 'late' && typeof w.id === 'string');
  if (holding.length === 0 && any !== true) return null;
  const key = holding.length === 0 ? 'clear' : holding.map((w) => w.id).sort().join(',');
  if (posted?.get(sha) === key) return null;
  const description = holding.length === 0 ? CLEARED_WORDS : waitingWords(holding.map((w) => w.id), decisionNumbers(typeof events === 'function' ? events() : [], enrolled));
  const state = holding.length === 0 ? 'success' : 'pending';
  try {
    const got = await adapter.setStatus({ sha, state, description, context: DECISION_CONTEXT });
    if (got?.ok !== true) return null;
  } catch {
    return null;
  }
  if (posted instanceof Map) {
    posted.set(sha, key);
    while (posted.size > MOST_KEPT) posted.delete(posted.keys().next().value);
  }
  return { state, description };
}
