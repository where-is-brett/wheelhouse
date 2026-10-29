// scripts/engine/fix-main.js
// A red main line (Archon design, section 7.7): the merge queue holds merges while the default branch's checks are
// red, and asks only to hold. The card router answers that itself (level 1); answering it opens a red-main incident,
// which holds all other work. The dispatcher starts one fix-main run for the incident, and the fix merges through the
// helper's own gate (Archon's gate refuses any merge onto a red default branch, the fix's too). The incident ends once
// the main line's checks are green again. These are the rules for that, with no engine or host in them.
import crypto from 'node:crypto';
import { workOrder } from './order.js';
import { limitsFor } from './caps.js';

export const RED_MAIN = 'red-main';
export const FIX_LANE = 'fix-main';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The pull request a merge queue's words name as the suspect ("PR 41", "#41", "pull request 41"), or null.
export function suspectOf(text) {
  if (typeof text !== 'string') return null;
  const found = /(?:#|\bPR\s*#?|\bpull request\s*#?)(\d+)\b/i.exec(text);
  const n = found ? Number(found[1]) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// The incident a red main line's ask opens: its id comes from the ask's, so the same ask seen again is the same
// incident. { id, what, kind, suspect, work }.
export function redMainIncident(ask) {
  const id = `${RED_MAIN}-${crypto.createHash('sha256').update(String(ask?.id)).digest('hex').slice(0, 10)}`;
  const suspect = Number.isInteger(ask?.suspect) && ask.suspect >= 1 ? ask.suspect : null;
  return {
    id,
    what: suspect ? `The main line's checks are red, it seems since pull request #${suspect}.` : 'The main line\'s checks are red.',
    kind: RED_MAIN,
    suspect,
    work: `${FIX_LANE}-${id}`,
  };
}

// The open red-main incident in the views, or null.
export function openRedMain(views) {
  const open = views?.incidents?.open;
  return Array.isArray(open) ? open.find((i) => isPlain(i) && i.kind === RED_MAIN) ?? null : null;
}

const FIX_GOAL = 'Make the main line\'s checks pass again.';

// The order for one attempt at the fix (section 7.4): level 1, since code that makes the checks pass is (main design,
// section 6); its done check the project's tests; no file it may change in the tests' way; never shown first. With
// `revert`, the goal is to undo the pull request the merge queue suspects. Throws where `revert` has no suspect.
export function fixOrder(incident, { config = {}, settings = {}, revert = false, raised = false } = {}) {
  if (revert && !incident?.suspect) throw new Error('There is no suspect pull request to undo');
  const order = workOrder({
    work: {
      id: incident.work, lane: FIX_LANE, level: 1, visible: false, protectedFiles: [],
      goal: revert ? `Undo pull request #${incident.suspect}, which broke the main line's checks, so they pass again.` : FIX_GOAL,
      notInScope: ['Anything but making the main line\'s checks pass again'],
      done: [{ command: config.testCommand, expect: 0 }],
    },
    config,
    routing: config.routing ?? {},
    caps: limitsFor(FIX_LANE, settings, { raised }),
  });
  return { ...order, incident: incident.id };
}

// The latest record of each run, in the order the runs started.
function latestRuns(records) {
  const byRun = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    const data = r?.data;
    if (!isPlain(data) || typeof data.runId !== 'string') continue;
    byRun.set(data.runId, { ...(byRun.get(data.runId) ?? {}), ...data, ...(data.branch ? { branch: data.branch } : {}) });
  }
  return [...byRun.values()];
}

// What the dispatcher does about a red main line this tick. `incident` the open red-main incident (or null); `runs`
// the fix work's run records; `green` whether the main line's checks read green (true, false, or null when unknown);
// `stopped` the runs All stop cancelled; `merged` the runs whose fix the helper added; `kept` the dispatcher's own
// { carried: [runId], carded: [runId], next: { revert } | null }.
//   -> { act: 'none' } | { act: 'close' } | { act: 'wait', why } | { act: 'start', revert } |
//      { act: 'start', carryOn: true, branch, after } | { act: 'card', run, why }
export function fixDecision({ incident, runs = [], green = null, stop = false, stopped = [], merged = [], kept = {} } = {}) {
  if (!isPlain(incident)) return { act: 'none' };
  if (green === true) return { act: 'close' };
  if (stop) return { act: 'wait', why: 'stop' };
  const carded = new Set(kept.carded ?? []);
  const carried = new Set(kept.carried ?? []);
  const latest = latestRuns(runs).at(-1);
  if (!latest) return { act: 'start', revert: false };
  if (latest.state !== 'ended') return { act: 'wait', why: 'running' };
  if (isPlain(kept.next)) return { act: 'start', revert: kept.next.revert === true };
  if (carded.has(latest.runId)) return { act: 'wait', why: 'card' };
  if (latest.outcome === 'cancelled' && stopped.includes(latest.runId) && !carried.has(latest.runId) && latest.branch) {
    return { act: 'start', carryOn: true, branch: latest.branch, after: latest.runId };
  }
  if (merged.includes(latest.runId)) return green === false ? { act: 'card', run: latest.runId, why: 'still-red' } : { act: 'wait', why: 'merged' };
  if (latest.outcome === 'cancelled') return { act: 'card', run: latest.runId, why: 'cancelled' };
  if (green === null) return { act: 'wait', why: 'unknown' };
  return { act: 'card', run: latest.runId, why: 'failed' };
}
