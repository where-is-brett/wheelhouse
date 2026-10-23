// scripts/lib/stop.js
// STOP: while anything exists at the STOP path, nothing is written to the host.
import fs from 'node:fs';
import path from 'node:path';
import { stopFile } from './paths.js';

const SETTERS = ['prompt', 'runbook', 'mod', 'helper'];

// On when anything exists at the path: a file, a folder, something unreadable.
// Only a path that is plainly absent counts as off. `by` and `at` come from the
// file's JSON when it reads.
export function stopState() {
  const file = stopFile();
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { on: false };
    return { on: true };
  }
  if (!stat.isFile()) return { on: true };
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = { on: true };
    if (typeof kept?.by === 'string') out.by = kept.by;
    if (typeof kept?.at === 'string') out.at = kept.at;
    return out;
  } catch {
    return { on: true };
  }
}

// Turns STOP on, recording who did and when. Something already at the path
// keeps STOP on whether or not it can be replaced.
export function setStop({ by, now = () => new Date() }) {
  if (!SETTERS.includes(by)) throw new Error('STOP is set by the prompt, the runbook, the mod or the helper');
  const file = stopFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ by, at: now().toISOString() })}\n`);
  } catch (error) {
    if (!stopState().on) throw error;
  }
}

// Turns STOP off. Only the prompt record's lift and the mod call this.
export function liftStop() {
  fs.rmSync(stopFile(), { recursive: true, force: true });
}

// What a hook says when the helper isn't answering on an agent whose hooks only read (ruling P5-22): writes are
// refused as under STOP, reading carries on, and the STOP word can't set STOP until the helper runs.
export const NO_HELPER_STOP = 'Wheelhouse\'s helper isn\'t running, so writes, pushes, merges and new agents are refused until it is. Start it with the Wheelhouse command.';
