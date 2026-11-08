// scripts/watcher/recover.js
// Approved work that never started. A wake for it can be lost (the Bosun's session failed, the wake was let go after
// its sends, the watcher was off), and the views still show the work approved with no feature. This raises
// `work-ready` for that work again, when the watcher starts and then every RECOVER_MS, so the Bosun is woken to start
// it. Work the queue holds is left alone: an unapproved one, one that waits on a dependency or on pace, one the new
// engine builds, and everything while All stop is on or an incident is open (the same holds as the Bosun's queue).
// A piece raised before that is still unstarted RAISE_AGAIN_MS later is a piece the engine lost: `record` takes it as one, once for
// each time it is raised again (scripts/watcher/reliability.js). Work that only waited for a slot or a dependency, and was raised
// when that freed it, is not lost.
import path from 'node:path';
import { watcherFolder, writeJsonFile } from './waker.js';
import { readCapped } from '../feature/status.js';
import { builderCapOf, haltOf, loadViews, queueToStart } from '../foreman/wake.js';

export const RECOVER_MS = 10 * 60 * 1000;
// The same work is raised again no sooner than this.
export const RAISE_AGAIN_MS = 30 * 60 * 1000;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The work to raise: in the queue's order to start, with no feature recorded, and not held.
export function recoverable(views, { now = new Date(), stopped, builderCap = null } = {}) {
  if (haltOf(views, stopped ? { stopped } : undefined) !== null) return [];
  const { start } = queueToStart(views, { now, builderCap });
  return start.filter((id) => !isPlain(views.features?.[id]) || views.features[id]?.data === undefined);
}

// `check()` gives the `work-ready` events to raise now, or none when it is not yet time (debounced) or the views
// can't be had (it is asked again at the next time).
export function makeRecovery({
  project, client, now = () => new Date(), stopped, every = RECOVER_MS, again = RAISE_AGAIN_MS, record = () => {},
}) {
  // Kept in the watcher's folder, so a watcher that runs one loop at a time (Shape 2) or restarts keeps its time.
  let file = null;
  let kept = {};
  try {
    file = path.join(watcherFolder(project), 'recovery.json');
    kept = JSON.parse(readCapped(file, 64 * 1024) ?? '{}') ?? {};
  } catch { /* none yet, or the folder is not a real folder: nothing is kept */ }
  let last = Number.isFinite(kept.last) ? kept.last : null;
  const raisedAt = new Map(Object.entries(isPlain(kept.raised) ? kept.raised : {}).filter(([, v]) => Number.isFinite(v)));
  const keep = () => {
    if (file === null) return;
    try {
      writeJsonFile(file, { last, raised: Object.fromEntries(raisedAt) });
    } catch { /* looked for again at the next time */ }
  };
  return {
    async check({ skip = [], config = null } = {}) {
      const t = now().getTime();
      if (last !== null && t - last < every) return [];
      last = t;
      keep();
      let views;
      try {
        ({ views } = await loadViews(project, client));
      } catch {
        return [];
      }
      const events = [];
      const open = recoverable(views, { now: now(), stopped, builderCap: config === null ? null : builderCapOf(views, config, now()) });
      // A piece that is no longer waiting to start has its count forgotten, so queuing it again starts afresh.
      for (const id of [...raisedAt.keys()]) if (!open.includes(id)) raisedAt.delete(id);
      for (const id of open) {
        if (skip.includes(id)) continue; // this loop's own events already wake the Bosun for it
        if (raisedAt.has(id) && t - raisedAt.get(id) < again) continue;
        if (raisedAt.has(id)) {
          try {
            record({ kind: 'lost', work: id, at: now().toISOString(), key: `lost:${project}:${id}:${raisedAt.get(id)}` });
          } catch { /* a record that can't be kept doesn't stop the raise */ }
        }
        raisedAt.set(id, t);
        events.push({ type: 'work-ready', work: id, id: `recover:${id}:${now().toISOString()}`, detail: { lane: views.work?.[id]?.work?.data?.lane, recovered: true } });
      }
      keep();
      return events;
    },
  };
}
