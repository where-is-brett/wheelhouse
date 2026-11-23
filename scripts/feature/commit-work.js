// scripts/feature/commit-work.js
// Commits what a feature session left in its worktree, for an agent whose session may not run git. At Ask such a session's
// shell may run only the build commands the director allowed (and Wheelhouse's own launcher), and committing to its own
// worktree is Wheelhouse's own work, not a project command, so the session never runs git: Wheelhouse does, here, outside
// the session, when the session asks (`commit`), when it pushes or opens its pull request, and once its run has ended.
//
// The call goes through safeGit, which points git's hooks at the null file, shuts out the global and system settings and
// refuses a worktree whose own settings are off the allowed list (a filter or a program git would run). The message is
// fixed, built from the work's name alone, so nothing the session wrote can add a trailer, and no co-author is named.
// The session's `.wheelhouse/` folder is never added.
import fs from 'node:fs';
import path from 'node:path';
import { safeGit } from '../lib/safe-git.js';

// The identity of a commit where the worktree's own settings name none (the director's own are shut out).
const IDENTITY = { name: 'Wheelhouse', email: 'wheelhouse@localhost' };
const WORK = /^[a-z0-9][a-z0-9-]{0,62}$/;
const FULL_SHA = /^[0-9a-f]{40,64}$/;
// What is kept out of the add: the feature's own folder (report, calls, answers), which is never committed.
const KEPT_OUT = ':(exclude).wheelhouse';
const GIT_MS = 60 * 1000;

const said = (got) => String(got?.stderr ?? '').split(/\r?\n/).map((l) => l.replace(/^(?:error|fatal):\s*/, '').trim()).find((l) => l !== '') ?? 'no reason given';

// Commits the worktree's changes as `Work on <work>`, as `{ head, commit?, skipped? }` or `{ failed }`:
// `head` is the full hash of HEAD afterwards; `commit` is set when this call made a commit; `skipped` says why it made none
// (nothing changed, or a merge or rebase is half done, which the session finishes). With `finishMerge`, a merge whose clashes
// are all resolved is concluded, with the merge's own message. `notGit` marks a folder that is no working tree. `git` is for tests.
export async function commitWork(options = {}) {
  try {
    return await commitIn(options);
  } catch (error) {
    // A setting in the worktree's repository that git is not allowed to run with refuses the call, in its own words.
    return { failed: error instanceof Error ? error.message : 'git could not be run' };
  }
}

async function commitIn({ worktree, work, finishMerge = false, git = null }) {
  if (typeof worktree !== 'string' || worktree === '' || !path.isAbsolute(worktree)) return { failed: 'the worktree is not a whole path' };
  if (typeof work !== 'string' || !WORK.test(work)) return { failed: "the work's name is not one Wheelhouse makes" };
  const fenced = git ?? safeGit({ cwd: worktree, reach: 'local', look: 'each', list: 'project', timeoutMs: GIT_MS });
  const call = (args, env = {}) => fenced(args, { env: { GIT_TERMINAL_PROMPT: '0', ...env }, input: '' });
  const head = async () => {
    const got = await call(['rev-parse', 'HEAD']);
    const sha = String(got.stdout ?? '').trim();
    return got.code === 0 && FULL_SHA.test(sha) ? sha : null;
  };
  const inside = await call(['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || String(inside.stdout).trim() !== 'true') return { failed: 'the worktree is not a git working tree', notGit: true };
  const before = await head();
  if (before === null) return { failed: 'the worktree has no commit to stand on' };

  // A merge or rebase half done, or a file still clashing, is the session's to finish: nothing is committed over it.
  const merging = await call(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  const clashing = await call(['ls-files', '-u']);
  const midMerge = merging.code === 0;
  if (!(finishMerge && midMerge) && (midMerge || String(clashing.stdout ?? '').trim() !== '')) return { head: before, skipped: 'a merge is not finished' };
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const where = await call(['rev-parse', '--git-path', name]);
    const found = String(where.stdout ?? '').trim();
    if (where.code === 0 && found !== '' && fs.existsSync(path.resolve(worktree, found))) return { head: before, skipped: 'a rebase is not finished' };
  }

  const changed = await call(['status', '--porcelain', '--untracked-files=all', '--', '.', KEPT_OUT]);
  if (changed.code !== 0) return { failed: `git could not read the worktree: ${said(changed)}` };
  if (String(changed.stdout).trim() === '' && !(finishMerge && midMerge)) return { head: before, skipped: 'nothing has changed' };

  const added = await call(['add', '-A', '--', '.', KEPT_OUT]);
  if (added.code !== 0) return { failed: `git could not add the changes: ${said(added)}` };
  // Finishing a merge: a file that still holds a conflict marker is not committed.
  if (finishMerge && midMerge) {
    const marked = await call(['diff', '--cached', '--check']);
    const where = String(marked.stdout ?? '').split(/\r?\n/).find((l) => /leftover conflict marker/.test(l));
    if (where !== undefined) return { failed: `a conflict marker is still in ${where.split(':')[0]}: remove it, then commit again` };
  }
  const named = await call(['config', '--get', 'user.name']);
  const mail = await call(['config', '--get', 'user.email']);
  const own = String(named.stdout ?? '').trim();
  const where = String(mail.stdout ?? '').trim();
  const [name, email] = own !== '' && where !== '' ? [own, where] : [IDENTITY.name, IDENTITY.email];
  const message = finishMerge && midMerge ? ['--no-edit'] : ['-m', `Work on ${work}`];
  const made = await call(['commit', '-q', '--no-verify', '--no-gpg-sign', ...message], {
    GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
  });
  if (made.code !== 0) return { failed: `git could not make the commit: ${said(made)}` };
  const after = await head();
  if (after === null || after === before) return { failed: 'git made no commit' };
  return { head: after, commit: after };
}
