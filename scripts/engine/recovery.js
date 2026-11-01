// scripts/engine/recovery.js
// The rules of recovery (unattended goals design, section 9): pure, used by the helper and the runner, and the same
// with or without a goal. Nothing here reads a goal.

// The helper's tick fires each minute, so a gap longer than this means the computer slept.
export const SLEEP_GAP_MINUTES = 3;

// The span the computer slept between two beats of the helper's tick (milliseconds since the epoch), as times, or null
// when it didn't. A helper that was dead has no beat to measure from, so it leaves no span, which is right: its runs
// went on. A clock put back is no sleep.
export function sleepGap(lastMs, nowMs) {
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return null;
  if (nowMs - lastMs <= SLEEP_GAP_MINUTES * 60 * 1000) return null;
  return { from: new Date(lastMs).toISOString(), to: new Date(nowMs).toISOString() };
}
