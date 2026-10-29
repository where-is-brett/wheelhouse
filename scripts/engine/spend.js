// scripts/engine/spend.js
// The spend meter (Archon design, section 10.1): a run's cost from the engine's record of its steps, and the minutes
// it has spent running, from the project's own `run` records. Only running time counts: a run paused at an ask is
// waiting for someone, not spending.

// The minutes `records` (a run's `run` records, each { at, data: { state } }, in time order) spent running up to
// `now`: from each start, or carrying on after an ask, to the next pause or end.
export function runningMinutes(records, now = new Date()) {
  let total = 0;
  let from = null;
  for (const e of records ?? []) {
    const at = Date.parse(e?.at);
    if (!Number.isFinite(at)) continue;
    const state = e.data?.state;
    if (state === 'started') from ??= at;
    else if (from !== null) {
      total += at - from;
      from = null;
    }
    if (state === 'ended') break;
  }
  if (from !== null) total += Math.max(0, now.getTime() - from);
  return Math.round(total / 600) / 100;
}
