// scripts/desk/work-prs.js
// The pull request each open work has, as its own status says: the number and the head commit it was
// opened at, as a hint only. The record names a work's pull request only once the gate asks
// about it, so a pull request that is open with a review on it shows nowhere in the record's views;
// the work's status file in its worktree does. Read only through the watcher's own folder checks.
import { inWorktreesFolder, plainWorktreePath } from '../watcher/sources.js';
import { featurePaths, readStatus } from '../feature/files.js';
import { readPrRecord, safeFeatureFolder } from '../feature/status.js';

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
        out[id] = { pr: status.pr, head: typeof status.head === 'string' ? status.head : null, phase: status.phase, merged: readPrRecord(worktree)?.merged === true };
      }
    } catch { /* a status that can't be read shows no pull request */ }
  }
  return out;
}

// Whether the builder has finished `worktree`'s work: its status reads `done`, or its kept pull request has merged. The
// worktree must already be a checked feature worktree (prsOfWork's checks, or the foreman's worktreeOf).
export function builderFinished(worktree, feature = null) {
  // A feature with later pieces still to build has not finished when one piece's pull request merges.
  const slice = feature?.slice;
  if (slice && Number.isInteger(slice.n) && Number.isInteger(slice.m) && slice.n < slice.m) return false;
  try {
    if (readStatus(featurePaths(worktree).status)?.phase === 'done') return true;
    return readPrRecord(worktree)?.merged === true;
  } catch {
    return false;
  }
}

// Whether `work` has finished and so takes no more changes: its feature closed or a report ended it (not open), or its
// builder finished (status `done`, or its pull request merged) before the Bosun closed it. `isOpenWork` is the desk's
// own test of open work. A follow-up to finished work becomes a new work.
export function workFinished(views, work, checkout, isOpenWork) {
  if (!isOpenWork(views, work)) return true;
  const worktree = views?.features?.[work]?.data?.worktree;
  if (typeof worktree !== 'string' || !plainWorktreePath(worktree)) return false;
  try {
    return inWorktreesFolder(checkout, worktree) && safeFeatureFolder(worktree) && builderFinished(worktree, views.features[work].data);
  } catch {
    return false;
  }
}

export const FINISHED_WORDS = 'that work has finished; this becomes a new work';
