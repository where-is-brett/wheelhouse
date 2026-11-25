// scripts/foreman/adopt.js
// A builder Desktop started adopts its own worktree (builders and settings design, section 7.3). Desktop makes the worktree
// and its branch, so Wheelhouse learns them from the builder itself: its first prompt begins with the builder lead and holds
// the marker line (scripts/foreman/desktop-start.js), and the prompt hook calls this with the session's folder. It records
// `{ sessionId, worktree, branch }` for the piece (scripts/foreman/desktop-builders.js), and only when the folder is a linked
// worktree of this project's own checkout, so a typed marker in any other folder records nothing. Files are read, no process
// is run: the hook is on every prompt's way.
import fs from 'node:fs';
import path from 'node:path';
import { markerOf } from './desktop-start.js';
import { recordBuilder } from './desktop-builders.js';

const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

// The root of the folder's own worktree: the nearest folder holding a `.git` that is a file.
function linkedRoot(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  let dir = path.resolve(cwd);
  for (;;) {
    try {
      const stat = fs.lstatSync(path.join(dir, '.git'));
      return stat.isFile() ? dir : null;
    } catch { /* look higher */ }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// `{ adopted: true, work }`, or `{ adopted: false, why }`.
export function adoptBuilder({ project, checkout, sessionId, prompt, cwd, now }) {
  const marker = markerOf(prompt);
  if (marker === null) return { adopted: false, why: 'no marker' };
  if (marker.project !== project) return { adopted: false, why: 'the marker names another project' };
  const root = linkedRoot(cwd);
  if (root === null) return { adopted: false, why: 'not in a linked worktree' };
  try {
    const pointer = /^gitdir: (.+)$/m.exec(fs.readFileSync(path.join(root, '.git'), 'utf8'));
    if (pointer === null) return { adopted: false, why: 'the worktree record is unreadable' };
    const gitdir = path.resolve(root, pointer[1].trim());
    const common = fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim();
    const main = real(path.resolve(gitdir, common));
    if (main === null || main !== real(path.join(checkout, '.git'))) return { adopted: false, why: "not a worktree of this project's checkout" };
    const head = /^ref: refs\/heads\/(.+)$/m.exec(fs.readFileSync(path.join(gitdir, 'HEAD'), 'utf8'));
    if (head === null) return { adopted: false, why: 'the worktree is on no branch' };
    const worktree = real(root);
    const done = worktree !== null && recordBuilder(project, marker.work, { sessionId, worktree, branch: head[1].trim(), now });
    return done ? { adopted: true, work: marker.work } : { adopted: false, why: 'the values could not be recorded' };
  } catch {
    return { adopted: false, why: 'the worktree could not be read' };
  }
}
