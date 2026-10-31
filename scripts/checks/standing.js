// scripts/checks/standing.js
// What the check runner keeps for a project, in `queue.json` beside its check folder, and what the pane reads of it. A test
// can't write here: the sandbox opens only the folders inside (profile.js). What decides a report or a merge isn't kept
// here either: that is the signed record.
import fs from 'node:fs';
import path from 'node:path';
import { engineDir } from '../lib/paths.js';

const EMPTY = () => ({ heads: [], unposted: [], tries: {}, streak: 0, asked: {}, cards: 0, readings: [], taken: [], hostChecksOff: false, checkingUntil: null, waitingForPermission: false });

export const queueFile = (project) => path.join(engineDir(), 'checks', project, 'queue.json');

export function readQueue(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(queueFile(project), 'utf8'));
    return kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? { ...EMPTY(), ...kept } : EMPTY();
  } catch {
    return EMPTY();
  }
}

export function keepQueue(project, queue) {
  const file = queueFile(project);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const part = `${file}.${process.pid}`;
  fs.writeFileSync(part, `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(part, file);
}

// What the pane says of a project's checks: whether one is running now, and whether reports wait for the director. A helper
// that went away mid-check leaves a mark that runs out with the check's time limit.
export function checksStanding(project, { now = new Date() } = {}) {
  const kept = readQueue(project);
  return { checking: typeof kept.checkingUntil === 'string' && Date.parse(kept.checkingUntil) > now.getTime(), waitingForPermission: kept.waitingForPermission === true };
}
