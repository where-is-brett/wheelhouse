// scripts/state/record.js
// The private record (design section 24.1): a git repository on this computer with no remote, one
// file per event under events/, committed and never pushed. Every project has one at
// stateDir(project), and the director's personal settings one at profileDir(). It is opened, never
// cloned: made when its folder is absent or empty, and otherwise used only when it has no remote
// and is on its own branch. Lean projects worked this way first (scripts/lean/project.js).
import fs from 'node:fs';
import path from 'node:path';
import { stateDir, profileDir } from '../lib/paths.js';
import { run as realRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';

export const RECORD_BRANCH = 'record';
// The branch Wheelhouse v0.1.x kept its records on, on the product's repository, and the name a Lean
// project's record had: still recognised as Wheelhouse's own, and a Lean record on it is opened as it is.
export const STATE_BRANCH = 'wheelhouse-state';

// The record's own commits are Wheelhouse's, as every event's commit is (scripts/state/git.js).
const WHEELHOUSE = {
  GIT_AUTHOR_NAME: 'Wheelhouse', GIT_AUTHOR_EMAIL: 'wheelhouse@invalid', GIT_COMMITTER_NAME: 'Wheelhouse', GIT_COMMITTER_EMAIL: 'wheelhouse@invalid',
};

const README = `<!-- README.md -->
# Wheelhouse record

This repository holds Wheelhouse's private record: small files under \`events/\`, one per event.
It stays on this computer and is never pushed. Do not edit these files by hand.
`;

// Opens the record in `dir`, making it when the folder is absent or empty: `git init` on the record
// branch and a first commit, with no remote. A repository already there is used only when it has no
// remote and is on the record branch (or the old one); any other is left alone, and so is a folder
// that holds files but no repository, since it may be the only copy of a record. Every call goes
// through safeGit on the own list. Gives the folder.
export async function openRecord(dir, { run = realRun, what = 'the private record', caller = 'helper' } = {}) {
  const gitHere = (look) => safeGit({ run, cwd: dir, env: WHEELHOUSE, list: 'own', look, caller, what });
  if (fs.existsSync(path.join(dir, '.git'))) {
    const git = gitHere('once');
    const remotes = await git(['remote']);
    if (remotes.code !== 0) throw new Error(`${upper(what)} could not be read, so the folder ${dir} was left alone`);
    if (remotes.stdout.trim() !== '') throw new Error(`The folder ${dir} holds a repository that has a remote, so it is not ${what} and was left alone`);
    const branch = await git(['symbolic-ref', '--short', 'HEAD']);
    const name = branch.stdout.trim();
    if (branch.code !== 0 || (name !== RECORD_BRANCH && name !== STATE_BRANCH)) {
      throw new Error(`The folder ${dir} holds a repository that is not on the record's branch, so it was left alone`);
    }
    return dir;
  }
  let held = [];
  try {
    held = fs.readdirSync(dir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`The folder ${dir} of ${what} could not be read, so it was left alone`);
  }
  if (held.length > 0) throw new Error(`The folder ${dir} of ${what} holds files but no repository, so it was left alone`);
  fs.mkdirSync(dir, { recursive: true });
  // The folder is empty, so there are no settings of its own to look at.
  const git = gitHere('never');
  try {
    for (const args of [['init', '-q'], ['symbolic-ref', 'HEAD', `refs/heads/${RECORD_BRANCH}`]]) {
      if ((await git(args)).code !== 0) throw new Error('git init');
    }
    fs.writeFileSync(path.join(dir, 'README.md'), README);
    for (const args of [['add', '--', 'README.md'], ['commit', '-q', '-m', 'Start the record']]) {
      if ((await git(args)).code !== 0) throw new Error('git commit');
    }
  } catch {
    // The folder was empty before, so it holds only what this start made.
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`${upper(what)} could not be made`);
  }
  return dir;
}

const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The project's private record.
export function openProjectRecord(project, { run, caller } = {}) {
  return openRecord(stateDir(project), { run, caller, what: 'the project\'s private record' });
}

// The director's personal settings on this computer.
export function openSettings({ run, caller } = {}) {
  return openRecord(profileDir(), { run, caller, what: 'your settings on this computer' });
}
