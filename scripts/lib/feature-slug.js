// scripts/lib/feature-slug.js
// Which feature a folder is for, read with fs only. It sits apart from the session start so the session role
// (scripts/lib/role.js) can ask it without loading the session start's whole graph; the session start re-exports it.
import fs from 'node:fs';
import path from 'node:path';
import { worktreeRoot, readSmallText } from '../hooks/kit.js';
import { safeFeatureFolder, readBrief } from '../feature/status.js';

// Small regular files only, opened without waiting: a FIFO HEAD can't hang the hook.
const readText = (file) => readSmallText(file);

// The branch a folder is on, read from the HEAD file with fs only (never git).
export function branchOf(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  let dir = path.resolve(cwd);
  for (;;) {
    const dot = path.join(dir, '.git');
    let stat = null;
    try {
      stat = fs.statSync(dot);
    } catch { /* look higher */ }
    let gitdir = null;
    if (stat?.isDirectory()) gitdir = dot;
    else if (stat?.isFile()) {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dot) ?? '');
      if (!pointer) return null;
      gitdir = path.resolve(dir, pointer[1]);
    }
    if (gitdir) {
      const head = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readText(path.join(gitdir, 'HEAD')) ?? '');
      return head ? head[1] : null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function featureSlug(cwd) {
  const match = /^feature\/([A-Za-z0-9._-]+)$/.exec(branchOf(cwd) ?? '');
  return match && !/^\.+$/.test(match[1]) ? match[1] : null;
}

// The branch's slug when `cwd` is in a worktree Wheelhouse made for that feature: its
// `.wheelhouse/feature` folder is safe and its brief's `work` is the slug. Null otherwise, and
// null when anything can't be read. A `feature/` branch alone is not a feature session.
export function madeFeatureSlug(cwd) {
  try {
    const slug = featureSlug(cwd);
    if (slug === null) return null;
    const root = worktreeRoot(cwd);
    if (root === null || !safeFeatureFolder(root)) return null;
    return readBrief(root).work === slug ? slug : null;
  } catch {
    return null;
  }
}
