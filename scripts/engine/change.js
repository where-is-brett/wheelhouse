// scripts/engine/change.js
// What a run changed in its worktree, against the base branch: every file added, changed, deleted or renamed since
// the merge base, committed or not, with its text before and after. The check steps read it (protected-check.js,
// control-check.js). Git runs behind Wheelhouse's fence (safe-git.js), since the worktree is one an agent controls.
import fs from 'node:fs';
import path from 'node:path';
import { safeGit } from '../lib/safe-git.js';
import { run as defaultRun } from '../lib/run.js';

const MOST_BYTES = 2 * 1024 * 1024;

// [{ status: 'A'|'M'|'D'|'R', path, from? , before(), after() }] for the worktree `cwd` against `base`.
export async function changeOf({ cwd, base, run = defaultRun }) {
  // The fence alone: the worktree's own settings are an agent's to write, and nothing here runs its hooks or filters.
  const git = safeGit({ run, cwd, look: 'never' });
  const must = async (args) => {
    const got = await git(args, { limit: MOST_BYTES });
    if (got.code !== 0) throw new Error(`git ${args[0]} failed in the worktree: ${String(got.stderr).trim().split('\n').pop()}`);
    return String(got.stdout);
  };
  const mergeBase = (await must(['merge-base', base, 'HEAD'])).trim();
  const listed = (await must(['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--name-status', '-M', '-z', mergeBase])).split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < listed.length;) {
    const status = listed[i][0];
    if (status === 'R' || status === 'C') {
      changes.push({ status: status === 'R' ? 'R' : 'A', from: listed[i + 1], path: listed[i + 2] });
      i += 3;
    } else {
      changes.push({ status: status === 'T' ? 'M' : status, path: listed[i + 1] });
      i += 2;
    }
  }
  const untracked = (await must(['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  for (const file of untracked) changes.push({ status: 'A', path: file });
  const at = async (file) => {
    const got = await git(['show', `${mergeBase}:${file}`], { limit: MOST_BYTES });
    return got.code === 0 ? String(got.stdout) : null;
  };
  const onDisk = (file) => {
    try { return fs.readFileSync(path.join(cwd, ...file.split('/')), 'utf8'); } catch { return null; }
  };
  return changes.map((change) => ({
    ...change,
    before: () => (change.status === 'A' ? Promise.resolve(null) : at(change.from ?? change.path)),
    after: () => Promise.resolve(change.status === 'D' ? null : onDisk(change.path)),
  }));
}
