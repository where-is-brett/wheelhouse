// scripts/desk/work-prs.js
// The pull request each open work has, as its own status says: the number, the head commit it was
// opened at and what it waits on. The record names a work's pull request only once the gate asks
// about it, so a pull request that is open with a review on it shows nowhere in the record's views;
// the work's status file in its worktree does. Read only through the watcher's own folder checks.
import { inWorktreesFolder, plainWorktreePath } from '../watcher/sources.js';
import { featurePaths, readStatus } from '../feature/files.js';
import { safeFeatureFolder } from '../feature/status.js';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// { [work]: { pr, head, phase, waitingOn } } for each work whose feature has a worktree under
// `checkout`'s .claude/worktrees/ and a status that names a pull request. Anything unreadable is left out.
export function prsOfWork(views, checkout) {
  const out = {};
  for (const [id, feature] of Object.entries(isPlain(views?.features) ? views.features : {})) {
    const worktree = feature?.data?.worktree;
    if (typeof worktree !== 'string' || !plainWorktreePath(worktree)) continue;
    try {
      if (!inWorktreesFolder(checkout, worktree) || !safeFeatureFolder(worktree)) continue;
      const status = readStatus(featurePaths(worktree).status);
      if (status !== null && Number.isSafeInteger(status.pr) && status.pr > 0) {
        out[id] = { pr: status.pr, head: typeof status.head === 'string' ? status.head : null, phase: status.phase, waitingOn: status.waitingOn };
      }
    } catch { /* a status that can't be read shows no pull request */ }
  }
  return out;
}
