// scripts/engine/goal-meter.js
// The spend meter of an unattended goal (unattended goals design, section 5): what it has spent by its two limits, tokens
// and either allowance points or a project's counted requests. Pure but for `inspect`, the engine's record of a run;
// `dispatch-run.js` reads it each tick and the gate at `startPiece` holds on the answer.
//
// A run counts if it started since Start, or is a live run of a listed piece or the fix lane; so a piece narrowed off the sheet
// keeps what it spent. Only those two kinds of work can start during a goal. Unknown spend is never zero: it counts as the
// run's whole cap, and a queue run, which has no lane's cap, as a small run's. That holds a start, but it is a harder test
// to end a goal, so the meter says what a figure rests on: `reached` is `settled` when it is met on what the engine reported
// and on runs that have ended. A stand-in for a run still live is the most it can spend, and comes good when it ends. What
// Archon's record holds for a step still under way hasn't been checked, so that stand-in may be on every step of a live run.
import { runCost } from './spend.js';
import { runLive } from './recovery.js';
import { LANE_CAPS } from './order.js';
import { FIX_LANE } from './fix-main.js';
import { READING_FRESH_MINUTES } from './goal-limits.js';

const FRESH_MS = READING_FRESH_MINUTES * 60000;

const spendUnknown = (cost) => cost.source === 'unknown' || cost.tokens === null || (cost.tokens === 0 && cost.floorDollars > 0);
// What `cost` (a `cost` record's data, or runCost's answer) adds to the tokens, with `cap` standing in for what isn't known.
const charged = (cost, cap) => (spendUnknown(cost) ? { tokens: Math.max(cost.tokens ?? 0, cap), unknown: true, firm: cost.tokens ?? 0 } : { tokens: cost.tokens, unknown: false, firm: cost.tokens });

// What the engine says of a run: `cap` when it can't say, a run of no reply being one of unknown spend.
async function readRun(runId, cap, inspect) {
  let record = null;
  try { record = await inspect(runId); } catch { /* counted as unknown below */ }
  if (record === null || record === undefined || record.unread === true || record.status === 'unknown') return { tokens: cap, unknown: true, firm: 0, unread: true };
  return charged(runCost(record), cap);
}

// The runs that count towards `goal`: [{ work, runId, lane, live }].
export function goalRuns(goal, views) {
  const startedAt = Date.parse(goal.startedAt);
  const listed = new Set(goal.sheet.pieces.map((p) => p.work));
  const found = [];
  for (const [work, records] of Object.entries(views?.runs ?? {})) {
    const byRun = new Map();
    for (const r of records ?? []) if (typeof r?.data?.runId === 'string') (byRun.get(r.data.runId) ?? byRun.set(r.data.runId, []).get(r.data.runId)).push(r);
    for (const [runId, own] of byRun) {
      const { lane } = own[0].data;
      const live = runLive(own);
      if (Date.parse(own[0].at) >= startedAt || (live && (listed.has(work) || lane === FIX_LANE))) found.push({ work, runId, lane, live });
    }
  }
  return found;
}

// A run's share: its cost record once it has ended, else the engine's figure. A resumed run has both: the engine's holds every
// leg where it gives totals, and only the last where it doesn't, so the larger stands and nothing counts twice.
async function runShare({ work, runId, lane, live }, { views, inspect, capOf }) {
  const cap = capOf(lane).tokens;
  const record = (views?.costs?.[work] ?? []).find((c) => c?.data?.runId === runId);
  const costed = record === undefined ? null : charged(record.data, cap);
  if (costed !== null && !live) return { ...costed, firm: costed.tokens };
  const read = await readRun(runId, cap, inspect);
  return costed === null ? read : { tokens: Math.max(costed.tokens, read.tokens), unknown: costed.unknown || read.unknown, firm: Math.max(costed.firm, read.firm), unread: read.unread };
}

// Points of the week used since Start, or null with no fresh reading, or once the week that Start's reading belongs to has
// reset: a percentage can't be read across a reset, so the tokens stand alone.
function pointsOf(reading, atStart, now) {
  if (!Number.isFinite(reading?.share) || !Number.isFinite(atStart?.share)) return null;
  const at = Date.parse(reading.shareAt);
  if (!Number.isFinite(at) || now.getTime() - at > FRESH_MS) return null;
  if (!(Date.parse(atStart.resetsAt) > at)) return null;
  const points = reading.share - atStart.share;
  return points < 0 ? null : points;
}

// The reading to keep as the share at Start, or null: one fresh at the goal's Start. One read much later would leave out what
// was spent before it.
export function shareAtStart(reading, goal) {
  if (!Number.isFinite(reading?.share)) return null;
  return Math.abs(Date.parse(reading.shareAt) - Date.parse(goal.startedAt)) <= FRESH_MS ? reading : null;
}

// goalMeter({ goal, views, inspect, queueRuns, capOf, reading, shareAtStart, requests, extra, now })
//   -> { tokens, points, requests, unknown, reached, left, settled, unread }.
// `goal` is `goalInForce`'s, `queueRuns` the ids of the merge-queue runs started during it, `capOf(lane)` `limitsFor`'s answer,
// `reading` { share, shareAt, resetsAt } from `weeklyShare`, `shareAtStart` the reading kept at Start, `requests` the counted
// requests since Start of a project that counts them, else null, `extra()` tokens spent elsewhere for the goal. `points` and
// `requests` are null where they aren't known. `unknown` says some of the tokens stand in for spend no one reported.
// `reached` names the first limit met: 'tokens', 'points', 'requests' or null. `left` is the tokens still to spend. `settled`
// says `reached` stands without any stand-in for a live run, and `unread` that a run couldn't be read just now.
export async function goalMeter({ goal, views, inspect, queueRuns = [], capOf, reading = null, shareAtStart: atStart = null, requests = null, extra = () => 0, now }) {
  const shares = await Promise.all([
    ...goalRuns(goal, views).map((run) => runShare(run, { views, inspect, capOf })),
    ...queueRuns.map((runId) => readRun(runId, LANE_CAPS.small.tokens, inspect)),
  ]);
  const tokens = shares.reduce((sum, share) => sum + share.tokens, extra());
  const points = pointsOf(reading, atStart, now);
  const { spend } = goal.sheet;
  const over = (figure, limit) => figure !== null && limit !== undefined && figure >= limit;
  const reached = over(tokens, spend.tokens) ? 'tokens' : over(points, spend.points) ? 'points' : over(requests, spend.requests) ? 'requests' : null;
  const firm = shares.reduce((sum, share) => sum + share.firm, extra());
  const settled = reached !== 'tokens' || over(firm, spend.tokens);
  return { tokens, points, requests, unknown: shares.some((share) => share.unknown), reached, left: spend.tokens - tokens, settled, unread: shares.some((share) => share.unread === true) };
}
