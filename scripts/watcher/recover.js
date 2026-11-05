// scripts/watcher/recover.js
// Approved work that never started. A wake for it can be lost (the Bosun's session failed, the wake was let go after
// its sends, the watcher was off), and the views still show the work approved with no feature. This raises
// `work-ready` for that work again, when the watcher starts and then every RECOVER_MS, so the Bosun is woken to start
// it. Work the queue holds is left alone: an unapproved one, one that waits on a dependency or on pace, one the new
// engine builds, and everything while All stop is on or an incident is open (the same holds as the Bosun's queue).
import { haltOf, loadViews, queueToStart } from '../foreman/wake.js';

export const RECOVER_MS = 10 * 60 * 1000;
// The same work is raised again no sooner than this.
export const RAISE_AGAIN_MS = 30 * 60 * 1000;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The work to raise: in the queue's order to start, with no feature recorded, and not held.
export function recoverable(views, { now = new Date(), stopped } = {}) {
  if (haltOf(views, stopped ? { stopped } : undefined) !== null) return [];
  const { start } = queueToStart(views, { now });
  return start.filter((id) => !isPlain(views.features?.[id]) || views.features[id]?.data === undefined);
}

// `check()` gives the `work-ready` events to raise now, or none when it is not yet time (debounced) or the views
// can't be had (it is asked again at the next time).
export function makeRecovery({ project, client, now = () => new Date(), stopped, every = RECOVER_MS, again = RAISE_AGAIN_MS }) {
  let last = null;
  const raisedAt = new Map();
  return {
    async check() {
      const t = now().getTime();
      if (last !== null && t - last < every) return [];
      last = t;
      let views;
      try {
        ({ views } = await loadViews(project, client));
      } catch {
        return [];
      }
      const events = [];
      for (const id of recoverable(views, { now: now(), stopped })) {
        if (raisedAt.has(id) && t - raisedAt.get(id) < again) continue;
        raisedAt.set(id, t);
        events.push({ type: 'work-ready', work: id, id: `recover:${id}:${now().toISOString()}`, detail: { lane: views.work?.[id]?.work?.data?.lane, recovered: true } });
      }
      return events;
    },
  };
}
