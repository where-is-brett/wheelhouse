// scripts/foreman/helm-hold.js
// The helm on the Desktop route (builders and settings design, section 7.4). The director takes a builder's helm by typing in its
// row: its prompt hook sees a prompt that didn't come through the foreman and writes the helm hold, as the front desk's "take the
// helm" does. `helmHeld` then gates every wake for the piece, and the session stays open: SessionEnd never ends this hold
// (scripts/hooks/helm-end.js); "Hand back" at the front desk does.
//
// The foreman's own message to a builder is `Wheelhouse: read <file>` on one line, where the file is the wake copy in the
// builder's own `.wheelhouse/feature/wakes/` folder. A builder's first prompt (the start) is the foreman's too; it is told by the
// hook, which passes `first`. Nothing else is the foreman's, so anything the director types holds the piece.
import fs from 'node:fs';
import path from 'node:path';
import { listBuilders } from './desktop-builders.js';

export const WAKE_LEAD = 'Wheelhouse: read ';
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const WAKES = /(^|[\\/])\.wheelhouse[\\/]feature[\\/]wakes$/;

// Whether `prompt` is the foreman's wake message to the builder in `worktree`: one line, the lead, and a plain file in that
// worktree's own wakes folder. A wake file in any other folder (another piece's, or one written to look like it) doesn't count.
export function foremanMessage(prompt, worktree) {
  if (typeof prompt !== 'string' || !prompt.startsWith(WAKE_LEAD) || /[\r\n\0]/.test(prompt.trimEnd())) return false;
  if (typeof worktree !== 'string' || !path.isAbsolute(worktree)) return false;
  const file = prompt.slice(WAKE_LEAD.length).trim();
  if (file === '' || !path.isAbsolute(file) || !WAKES.test(path.dirname(file))) return false;
  try {
    if (!fs.lstatSync(file).isFile()) return false;
    return fs.realpathSync.native(path.dirname(file)) === fs.realpathSync.native(path.join(worktree, '.wheelhouse', 'feature', 'wakes'));
  } catch {
    return false;
  }
}

// `{ held: true, work }` once the session's piece is held (by this prompt or earlier), else `{ held: false, why }`.
// Only a session recorded as a Desktop builder, whose session hasn't been stopped, can hold a piece.
export async function holdFromPrompt({ project, sessionId, prompt, first = false, now = () => new Date() }) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || typeof prompt !== 'string') return { held: false, why: 'not a session' };
  if (first) return { held: false, why: 'first prompt' };
  const row = listBuilders(project).find((b) => b.sessionId === sessionId && b.endedAt === undefined);
  if (row === undefined) return { held: false, why: 'not a Desktop builder' };
  if (foremanMessage(prompt, row.worktree)) return { held: false, why: "the foreman's message" };
  const { takeHold } = await import('../crew/hold.js');
  try {
    await takeHold(project, { work: row.work, sessionId, now });
  } catch (error) {
    if (error?.code !== 'HELD') throw error;
  }
  return { held: true, work: row.work };
}
