// scripts/decisions/calls.js
// The calls the agents logged on their own side of the decision line, read back from the project's record: its `agent-call`
// events (scripts/decisions/log.js says how they get there). Reading only, so the desk's views can use it.
import { listEvents } from '../state/events.js';
import { stateDir } from '../lib/paths.js';

// The most calls the record gives back at once, the latest.
const MOST_CALLS = 200;

// The calls in `events` (a project's events, in any order): its `agent-call` events from `since` on (a Date, or none for all),
// oldest first, at most the latest 200, each as `{ id, work, at, decided, options, why, kind }`. `at` is when the session
// logged it. An event whose data is not a call is passed over.
export function callsFrom(events, { since } = {}) {
  const from = since instanceof Date ? since.getTime() : -Infinity;
  const calls = [];
  for (const e of Array.isArray(events) ? events : []) {
    const d = e?.kind === 'agent-call' ? e.data : null;
    if (d === null || typeof d !== 'object' || typeof e.id !== 'string') continue;
    const at = typeof d.at === 'string' && !Number.isNaN(Date.parse(d.at)) ? d.at : e.at;
    if (Date.parse(at) < from) continue;
    calls.push({ id: e.id, work: d.work, at, decided: d.decided, options: d.options, why: d.why, kind: d.kind });
  }
  calls.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return calls.slice(-MOST_CALLS);
}

// The calls recorded for `project` from `since` on (see callsFrom), without the id: `{ work, at, decided, options, why, kind }`.
export function projectCalls(project, { since } = {}) {
  return callsFrom(listEvents(stateDir(project), { report: () => {} }), { since }).map(({ id, ...call }) => call);
}
