// scripts/watcher/stuck-cards.js
// A stuck work must never stay silent. The watcher's `stuck` wake tells the Bosun to ask the director, but a Bosun that
// closes that wake `--idle` without running `act ask` leaves no card. This reads the measures the Bosun's `wake.js
// done` leaves: for each wake closed idle that carried a `stuck` event, the question is put to the director here, in
// code, through the helper: it asks nothing when the work already has an open question from the Bosun or has ended.
import path from 'node:path';
import { readCapped } from '../feature/status.js';
import {
  readWake, watcherDir, watcherFolder, wakesDir, writeJsonFile,
} from './waker.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const KEPT = 200;

const doneFile = (project) => path.join(watcherDir(project), 'stuck-cards.json');

function readDone(project) {
  try {
    const kept = JSON.parse(readCapped(doneFile(project), 64 * 1024) ?? '{}');
    return Array.isArray(kept?.done) ? kept.done.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// The wakes the Bosun closed idle, oldest first.
function idleWakes(project) {
  let text = null;
  try {
    text = readCapped(path.join(watcherDir(project), 'measures.jsonl'), 64 * 1024 * 1024);
  } catch { /* none */ }
  const out = [];
  for (const line of (text ?? '').split('\n')) {
    try {
      const m = JSON.parse(line);
      if (isPlain(m) && m.outcome === 'idle' && typeof m.wake === 'string') out.push(m.wake);
    } catch { /* a damaged line */ }
  }
  return out;
}

// Asks the helper for the card of each stuck work in a wake closed idle, once. The helper makes the question itself (a
// question of the Bosun's own range is written by the helper alone) and leaves none when the Bosun has asked already
// or the work has ended. Gives the ids written.
export async function raiseStuckCards({ project, client }) {
  watcherFolder(project);
  const done = readDone(project);
  const fresh = idleWakes(project).filter((id) => !done.includes(id));
  if (fresh.length === 0) return [];
  const written = [];
  const handled = [];
  for (const id of fresh) {
    const wake = readWake(path.join(wakesDir(project), `${id}.json`));
    const stuck = (Array.isArray(wake?.events) ? wake.events : []).filter((e) => e?.type === 'stuck' && typeof e.work === 'string');
    let failed = false;
    for (const e of stuck) {
      try {
        const answer = await client.state.stuckCard({ project, work: e.work, phase: e.detail?.phase ?? null, still: e.detail?.still ?? 0 });
        if (answer?.ok !== true) throw new Error('refused');
        if (typeof answer.id === 'string') written.push(answer.id);
      } catch {
        failed = true; // asked again at the next loop
      }
    }
    if (!failed) handled.push(id);
  }
  if (handled.length > 0) writeJsonFile(doneFile(project), { done: [...done, ...handled].slice(-KEPT) });
  return written;
}
