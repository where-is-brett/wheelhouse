// scripts/checks/queue.js
// What is due, and one check at a time on the computer, since a build can take every core (spec 4.3).
import path from 'node:path';
import { takeStartLock } from '../lib/start-lock.js';
import { checksDir } from './folder.js';

const TURN_WAIT_MS = 24 * 60 * 60 * 1000;

// A result stands if it is for this command and finished. A check that couldn't run is due again, as one All stop ended
// is, and a not-counted result stops standing once counting begins.
const stands = (r, digest, notCounting) => r.command === digest && r.result !== 'could-not-run' && (notCounting || r.result !== 'not-counted');

// The commits to check, `main` (the main line's head, or null) first, since it holds merges. `results` are the data of the
// `check` events held. Only a clean run stands for the main line: a head's pass came from kept build output, and a
// fast-forward can put that same commit on the main line.
export function dueChecks({ main, heads, results, digest, notCounting = false }) {
  const standing = results.filter((r) => stands(r, digest, notCounting));
  const settled = new Set(standing.map((r) => r.commit));
  const due = [];
  if (main && !standing.some((r) => r.commit === main && r.clean === true)) due.push({ commit: main, main: true });
  for (const commit of new Set(heads)) if (commit !== main && !settled.has(commit)) due.push({ commit, main: false });
  return due;
}

// Runs `fn` when no other check on this computer is running, across every project and process. The lock is the check's
// own for as long as its process lives, however long the build takes.
export async function withCheckTurn(fn) {
  const release = await takeStartLock(path.join(checksDir(), 'turn.lock'), { message: 'Another check held the turn for a whole day', waitMs: TURN_WAIT_MS, staleMs: Infinity });
  try {
    return await fn();
  } finally {
    release();
  }
}
