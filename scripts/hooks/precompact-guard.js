// scripts/hooks/precompact-guard.js
// Holds back an automatic compaction while the session has unsaved work, so the
// model can save state first. It gives way near the context limit, and two
// minutes after its first block for the session. A manual compaction is never held.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { answer, runAndExit, worktreeRoot } from './kit.js';
import { projectNameOf, sessionFile, readSession, updateSession } from './context-gauge.js';

export const NEAR_LIMIT = 360000;
export const GIVE_UP_MS = 2 * 60 * 1000;
export const REASON = 'There is unsaved work. Save state now; the compaction will go ahead on the next try.';

// Exists, whatever it is: a folder or a symlink (even a dangling one) counts.
function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

export async function decide(input, { dir, now = () => new Date() } = {}) {
  if (input.trigger !== 'auto' || typeof input.cwd !== 'string') return undefined;
  const project = projectNameOf(input.cwd, dir);
  if (project === null) return undefined;
  const file = sessionFile(project, input.session_id);
  if (file === null) return undefined;
  const session = readSession(file);
  // Letting a compaction through ends this run of blocks; the next starts afresh.
  const letThrough = () => {
    if (session.firstBlockAt !== undefined) updateSession(file, { firstBlockAt: undefined });
    return undefined;
  };
  const root = worktreeRoot(input.cwd);
  if (root === null || !exists(path.join(root, '.claude', 'state', `unsaved-${input.session_id}`))) return letThrough();
  if (Number.isFinite(session.tokens) && session.tokens >= NEAR_LIMIT) return letThrough();
  const at = now();
  const first = Date.parse(session.firstBlockAt);
  if (Number.isFinite(first)) {
    if (at.getTime() - first >= GIVE_UP_MS) return letThrough();
  } else {
    updateSession(file, { firstBlockAt: at.toISOString() });
  }
  return answer.block(REASON);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAndExit(decide, { failClosed: false, event: 'PreCompact' });
}
