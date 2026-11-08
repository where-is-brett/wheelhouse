// scripts/decisions/calls.js
// The calls the agents logged on their own side of the decision line, read back from the project's record: its `agent-call`
// events (scripts/decisions/log.js says how they get there). Reading only, so the desk's views can use it.
import { listEvents } from '../state/events.js';
import { stateDir } from '../lib/paths.js';

// The most calls the record gives back at once, the latest.
export const MOST_CALLS = 200;

// What a ruling or a request that names a call says: `[call <first 8 of its id>]`.
export const callMark = (id) => `[call ${String(id).slice(0, 8)}]`;

// The calls in `events` (a project's events, in any order): its `agent-call` events from `since` on (a Date, or none for all),
// oldest first, at most the latest 200, each as `{ id, work, at, decided, options, why, kind, ruled, requested }`. `at` is when
// the session logged it. A repeat (an event with the same `key` as an earlier one: a call sent twice) is dropped and the
// earliest kept, so a call's id is stable. `ruled` and `requested` say whether a ruling or a request names the call already.
// An event whose data is not a call is passed over.
export function callsFrom(events, { since } = {}) {
  const list = Array.isArray(events) ? events : [];
  const from = since instanceof Date ? since.getTime() : -Infinity;
  const found = [];
  for (const e of list) {
    const d = e?.kind === 'agent-call' ? e.data : null;
    if (d === null || typeof d !== 'object' || typeof e.id !== 'string') continue;
    const at = typeof d.at === 'string' && !Number.isNaN(Date.parse(d.at)) ? d.at : e.at;
    if (Date.parse(at) < from) continue;
    found.push({ id: e.id, work: d.work, at, decided: d.decided, options: d.options, why: d.why, kind: d.kind, ...(d.where === undefined ? {} : { where: d.where }), key: d.key, logged: e.at });
  }
  // Earliest event first, so a repeat of a key is the later one.
  found.sort((a, b) => (a.logged < b.logged ? -1 : a.logged > b.logged ? 1 : a.id < b.id ? -1 : 1));
  const keys = new Set();
  const once = found.filter((c) => {
    if (typeof c.key !== 'string') return true;
    if (keys.has(c.key)) return false;
    keys.add(c.key);
    return true;
  });
  once.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const wordsOf = (kind) => list.filter((e) => e?.kind === kind && typeof e.data?.words === 'string').map((e) => e.data.words);
  const rulings = wordsOf('ruling');
  const requests = wordsOf('request');
  return once.slice(-MOST_CALLS).map(({ key, logged, ...c }) => ({
    ...c,
    ruled: rulings.some((w) => w.includes(callMark(c.id))),
    requested: requests.some((w) => w.includes(callMark(c.id))),
  }));
}

// The calls recorded for `project` from `since` on (see callsFrom), without the id: `{ work, at, decided, options, why, kind }`.
export function projectCalls(project, { since } = {}) {
  return callsFrom(listEvents(stateDir(project), { report: () => {} }), { since }).map(({ id, ruled, requested, ...call }) => call);
}
