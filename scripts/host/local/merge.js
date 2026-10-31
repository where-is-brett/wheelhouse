// scripts/host/local/merge.js
// A local change reaches the main version (spec 7.4): the merge is worked out on the home's objects, with no working files, so
// nothing of the change runs, and the main version moves by compare-and-swap, one at a time. Most changes squash, as Archon's
// queue does. A change carrying what the project's folder holds keeps its history instead: the folder's tip stays within the main
// version, so the folder comes up by a fast-forward rather than reading as parted (spec 5.4). The file `main-seen` beside the
// home holds the main version as the helper last left it, which is how one moved outside the helper is seen. The file
// `main-next` holds a merge from before the main version moves until all that follows it is done, so a crash anywhere in
// between is finished on the next look, rather than read as a move outside the helper or merged a second time.
import fs from 'node:fs';
import path from 'node:path';
import { LocalRefusal, moveHead, revertOn } from '../../lib/local-git.js';
import { run as realRun } from '../../lib/run.js';
import { localChanges } from './changes.js';
import { FOLDER_REMOTE } from './folder.js';
import { gitRoute, homeDir, homeGit, projectFolder } from './home.js';

const SEEN_FILE = 'main-seen';
const NEXT_FILE = 'main-next';
export const HAND_MADE_BRANCH = /^feature\/by-hand-[0-9a-f]+$/;
// The identity of a commit the helper makes where the folder's git has none.
const WHEELHOUSE = { name: 'Wheelhouse', email: 'wheelhouse@localhost' };

const inFolder = (folder, git) => git(folder, { reach: 'local', what: 'the project\'s folder' });

export function seenMain(project) {
  try {
    return fs.readFileSync(path.join(projectFolder(project), SEEN_FILE), 'utf8').trim() || null;
  } catch {
    return null;
  }
}
export function keepSeenMain(project, commit) {
  const file = path.join(projectFolder(project), SEEN_FILE);
  const part = `${file}.${process.pid}`;
  fs.writeFileSync(part, `${commit}\n`, { mode: 0o600 });
  fs.renameSync(part, file);
}

export function nextMain(project) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectFolder(project), NEXT_FILE), 'utf8'));
  } catch {
    return null;
  }
}
function keepNextMain(project, merge) {
  const file = path.join(projectFolder(project), NEXT_FILE);
  const part = `${file}.${process.pid}`;
  fs.writeFileSync(part, `${JSON.stringify(merge)}\n`, { mode: 0o600 });
  fs.renameSync(part, file);
}
export function dropNextMain(project) {
  fs.rmSync(path.join(projectFolder(project), NEXT_FILE), { force: true });
}

// The folder's git identity, or Wheelhouse's, as a commit's environment.
export async function identityOf(folder, git) {
  let name = '';
  let email = '';
  if (typeof folder === 'string' && fs.existsSync(folder)) {
    const here = inFolder(folder, git);
    name = String((await here.call(['config', '--get', 'user.name']).catch(() => null))?.stdout ?? '').trim();
    email = String((await here.call(['config', '--get', 'user.email']).catch(() => null))?.stdout ?? '').trim();
  }
  const [who, where] = name !== '' && email !== '' ? [name, email] : [WHEELHOUSE.name, WHEELHOUSE.email];
  return { GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: where, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: where };
}

// Whether merging `change` must keep its history: it is hand-made, or it shares with the folder's default branch commits the
// main version doesn't hold, as a lane carrying hand-made work on does. It decides only the shape of the merge, never whether.
export async function carriesFolderWork({ project, folder, branch, change, git = gitRoute() }) {
  if (HAND_MADE_BRANCH.test(change.branch)) return true;
  if (typeof folder !== 'string' || !fs.existsSync(folder)) return false;
  const here = inFolder(folder, git);
  const held = `refs/remotes/${FOLDER_REMOTE}/pull/${change.n}`;
  const main = `refs/remotes/${FOLDER_REMOTE}/${branch}`;
  try {
    if (!(await here.ok(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', homeDir(project), `+refs/pull/${change.n}/head:${held}`, `+refs/heads/${branch}:${main}`]))) return false;
    const shared = await here.call(['merge-base', `refs/heads/${branch}`, held]);
    if (shared.code !== 0) return false;
    return (await here.call(['merge-base', '--is-ancestor', String(shared.stdout).trim(), main])).code === 1;
  } finally {
    await here.call(['update-ref', '-d', held]).catch(() => {});
  }
}

// mergeChange -> { merged: true, commit } | { merged: false, reason }. The caller holds the project's lock. `stopped()` is read
// last of all, so All stop leaves the main version where it was. A clash, a head that moved or a lost compare-and-swap merge
// nothing, and the next sweep looks again.
export async function mergeChange({ project, n, head, folder, keepHistory = false, stopped = () => false, run = realRun, write, now = () => new Date() }) {
  const git = gitRoute({ run });
  const changes = localChanges({ project, git, ...(write ? { write } : {}), now });
  const change = changes.changeOf(n);
  if (change === null || change.state !== 'open') return { merged: false, reason: `Change ${n} is not open` };
  if (change.head !== head) return { merged: false, reason: `Change ${n} moved after it was reviewed` };
  if (nextMain(project) !== null) return { merged: false, reason: 'The last merge is still being finished' };
  const home = homeGit(project, git);
  const headRef = `refs/heads/${change.base}`;
  const main = await home.must(['rev-parse', '--verify', '-q', `${headRef}^{commit}`], 'unread');
  // Building on it would take in what moved it, and the director hasn't decided on that yet.
  const seen = seenMain(project);
  if (seen !== null && seen !== main) return { merged: false, reason: 'The main version moved outside the helper' };
  const onTop = await home.ok(['merge-base', '--is-ancestor', main, head]);
  let commit = head;
  if (!(keepHistory && onTop)) {
    const merged = await home.call(['merge-tree', '--write-tree', '--no-messages', main, head]);
    if (merged.code === 1) return { merged: false, reason: 'clash' };
    if (merged.code !== 0) return { merged: false, reason: 'The merge could not be worked out' };
    const tree = String(merged.stdout).split('\n')[0].trim();
    const env = await identityOf(folder, git);
    const making = homeGit(project, (cwd, options) => git(cwd, { ...options, env }));
    commit = await making.must(['commit-tree', '--no-gpg-sign', tree, '-p', main, ...(keepHistory ? ['-p', head] : []), '-m', change.title], 'unread');
  }
  if (stopped()) return { merged: false, reason: 'All stop is on' };
  keepNextMain(project, { n, commit, from: main, base: change.base });
  try {
    await moveHead({ dir: homeDir(project), branch: change.base, to: commit, from: main, run, list: 'own' });
  } catch (error) {
    dropNextMain(project);
    if (error instanceof LocalRefusal) return { merged: false, reason: error.message };
    throw error;
  }
  keepSeenMain(project, commit);
  await changes.markMerged({ n, commit });
  return { merged: true, commit };
}

// Takes up a merge `main-next` still holds. One whose move never happened is dropped. One that happened gets the rest of its
// records, and is given back for what follows a merge, which drops `main-next` at its end. The caller holds the project's lock.
export async function finishMerge({ project, run = realRun, write, now = () => new Date() }) {
  const merge = nextMain(project);
  if (merge === null) return null;
  const git = gitRoute({ run });
  if (!(await homeGit(project, git).ok(['merge-base', '--is-ancestor', merge.commit, `refs/heads/${merge.base}`]))) {
    dropNextMain(project);
    return null;
  }
  if (seenMain(project) === merge.from) keepSeenMain(project, merge.commit);
  const changes = localChanges({ project, git, ...(write ? { write } : {}), now });
  if (changes.changeOf(merge.n)?.state === 'open') await changes.markMerged({ n: merge.n, commit: merge.commit });
  return merge;
}

// Reverts `commits` on the main version, by a new commit each, and moves it. Nothing is deleted. Gives the new main version.
export async function revertOnHome({ project, branch, commits, folder, run = realRun }) {
  const git = gitRoute({ run });
  const dir = homeDir(project);
  const main = await homeGit(project, git).must(['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`], 'unread');
  const env = await identityOf(folder, git);
  const undone = await revertOn({ dir, at: main, commits, env, run, list: 'own' });
  await moveHead({ dir, branch, to: undone, from: main, run, list: 'own' });
  keepSeenMain(project, undone);
  return undone;
}

// What a build or an install makes again, so nothing is lost with it, as `git status --ignored` names it. Anything else ignored,
// such as a settings file with its secrets, is the only copy there is.
const REBUILT = /^!! (.*\/)?(node_modules|\.build|build|dist|target|out|coverage|__pycache__|\.venv|venv|\.pytest_cache|\.next|\.turbo|\.cache|DerivedData|\.gradle|\.wheelhouse)\/.*$/;
const isRebuilt = (line) => REBUILT.test(line);

// Whether a merged change's worktree can go, and if so sends it (check 83). `archon complete` refuses a squashed branch, and
// `--force` takes anything at all, so this look stands in front of it: the worktree goes only when the branch is within what
// merged, nothing in it is uncommitted, untracked, ignored but not rebuilt, or half done, and no run is on it. Gives 'gone',
// 'removed', 'running' or 'kept'.
export async function cleanMerged({ project, folder, change, running = () => false, complete, git = gitRoute() }) {
  const here = inFolder(folder, git);
  const tip = await here.call(['rev-parse', '--verify', '-q', `refs/heads/${change.branch}^{commit}`]);
  if (tip.code !== 0) return 'gone';
  const listed = await here.must(['worktree', 'list', '--porcelain'], 'The folder\'s worktrees could not be read');
  const tree = listed.split('\n\n').map((block) => block.split('\n')).find((lines) => lines.includes(`branch refs/heads/${change.branch}`))?.[0]?.replace(/^worktree /, '');
  if (tree === undefined) return 'gone';
  if (await running(change.branch)) return 'running';
  if (!(await homeGit(project, git).ok(['merge-base', '--is-ancestor', String(tip.stdout).trim(), change.head]))) return 'kept';
  const inTree = git(tree, { reach: 'local', what: 'a finished worktree' });
  const dirty = await inTree.call(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--ignored=traditional']);
  if (dirty.code !== 0 || String(dirty.stdout).split('\n').some((line) => line.trim() !== '' && !isRebuilt(line))) return 'kept';
  const gitDir = await inTree.must(['rev-parse', '--absolute-git-dir'], 'The worktree could not be read');
  if (['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'].some((name) => fs.existsSync(path.join(gitDir, name)))) return 'kept';
  const got = await complete({ folder, branch: change.branch });
  return got?.ok === true ? 'removed' : 'running';
}
