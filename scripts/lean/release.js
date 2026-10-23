// scripts/lean/release.js
// Gives a Lean project's git back to its folder (ruling P5-51): the inverse of adoptProject (scripts/lean/store.js).
// The store, a bare repository at <wheelhouseHome>/projects/<p>/git with the folder as its one worktree, becomes the
// folder's `.git` folder again, with the main version checked out, so the project works with git alone, as Lean does
// without the helper.
//
// Refused, with nothing changed, for a folder with tracked changes not committed, or one that isn't at the main
// version (on another branch, or detached at another commit), or a store with other worktrees. The move is a rename
// within one drive (adoption needed the same), and the store's own worktree entry for the folder is set aside first
// and removed only once the folder reads as a whole repository on main at the same commit; until then a failure puts
// everything back as it was. Every git call goes through safeGit with the project list and the `lean` caller.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { readLean } from './project.js';
import { LeanRefusal, storeDir } from './store.js';

const MAIN = 'refs/heads/main';
const FOLDER_WHAT = 'the Lean project\'s folder';
const STORE_WHAT = 'the Lean project\'s git store';

const refuse = (line) => { throw new LeanRefusal(line); };

const realOrNull = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

function gitAt(cwd, { run, what }) {
  const call = safeGit({ run, cwd, env: {}, reach: 'local', list: 'project', look: 'once', caller: 'lean', what });
  return {
    call,
    async must(args, why) {
      const got = await call(args);
      if (got.code !== 0) refuse(why);
      return String(got.stdout ?? '').trim();
    },
  };
}

// releaseProject({ project, folder, run }) -> { released, main }
//   released  false when the folder's git is its own already (never adopted, or given back before)
export async function releaseProject({ project, folder, run = realRun } = {}) {
  const lean = readLean(project);
  if (lean === null) refuse('This project is not registered as a Lean project');
  const real = realOrNull(folder);
  if (real === null || real !== realOrNull(lean.folder)) refuse('That folder is not this Lean project\'s folder');
  const dotGit = path.join(real, '.git');
  let stat = null;
  try { stat = fs.lstatSync(dotGit); } catch { /* none */ }
  if (stat?.isDirectory()) return { released: false, main: null };
  if (!stat?.isFile()) refuse('The project\'s folder has no git of its own or in the store, so there is nothing to give back');
  const store = storeDir(project);
  const storeReal = realOrNull(store);
  if (storeReal === null) refuse('The project\'s git store isn\'t there, so its git can\'t be given back');

  const here = gitAt(real, { run, what: FOLDER_WHAT });
  const common = await here.must(['rev-parse', '--path-format=absolute', '--git-common-dir'], 'The project\'s folder could not be read');
  if (realOrNull(common) !== storeReal) refuse('The project\'s folder points to another repository, so it was left alone');
  const changes = await here.must(['status', '--porcelain=v1', '--untracked-files=no'], 'The project\'s folder could not be read');
  if (changes !== '') refuse('The project\'s folder has changes that aren\'t committed, so its git was left in the store: commit them or put them away, then try again');
  const inStore = gitAt(store, { run, what: STORE_WHAT });
  const main = await inStore.must(['rev-parse', '--verify', '-q', `${MAIN}^{commit}`], 'The main version could not be read in the store');
  const branch = await here.call(['symbolic-ref', '-q', 'HEAD']);
  const head = await here.must(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], 'The project\'s folder could not be read');
  const onBranch = branch.code === 0 ? String(branch.stdout).trim() : null;
  if ((onBranch !== null && onBranch !== MAIN) || head !== main) {
    refuse('The project\'s folder isn\'t on the main version, so its git was left in the store: run `git switch --detach main` there, then try again');
  }
  const trees = await inStore.must(['worktree', 'list', '--porcelain'], 'The store\'s worktrees could not be read');
  const listed = trees.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => realOrNull(l.slice('worktree '.length)));
  if (listed.filter((p) => p !== storeReal && p !== real).length > 0) refuse('The store has worktrees other than this folder, so its git was left in the store');

  // The folder's worktree entry in the store, from its .git file.
  const pointer = fs.readFileSync(dotGit, 'utf8');
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(pointer);
  const entry = m ? realOrNull(path.resolve(real, m[1])) : null;
  if (entry === null || path.dirname(entry) !== path.join(storeReal, 'worktrees')) refuse('The project\'s folder points to another repository, so it was left alone');

  const aside = path.join(storeReal, `released-${crypto.randomBytes(4).toString('hex')}`);
  const steps = [];
  const putBack = async () => {
    try {
      if (steps.includes('moved')) fs.renameSync(dotGit, store);
      if (steps.includes('pointer')) fs.writeFileSync(dotGit, pointer);
      if (steps.includes('aside')) fs.renameSync(aside, entry);
      if (steps.includes('bare')) await inStore.call(['config', 'core.bare', 'true']);
    } catch { /* left for the director: the refusal says what happened */ }
  };
  try {
    await inStore.must(['config', 'core.bare', 'false'], 'The store could not be changed');
    steps.push('bare');
    fs.renameSync(entry, aside);
    steps.push('aside');
    fs.rmSync(dotGit, { force: true });
    steps.push('pointer');
    fs.renameSync(store, dotGit);
    steps.push('moved');
    const own = gitAt(real, { run, what: FOLDER_WHAT });
    await own.must(['symbolic-ref', 'HEAD', MAIN], 'The main version could not be checked out in the folder');
    await own.must(['reset', '--quiet', '--mixed'], 'The project\'s folder could not be matched to the main version');
    const gitDir = await own.must(['rev-parse', '--path-format=absolute', '--git-dir'], 'The project\'s folder could not be read');
    const nowOn = await own.must(['symbolic-ref', 'HEAD'], 'The project\'s folder could not be read');
    const nowAt = await own.must(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], 'The project\'s folder could not be read');
    const left = await own.must(['status', '--porcelain=v1', '--untracked-files=no'], 'The project\'s folder could not be read');
    if (realOrNull(gitDir) !== realOrNull(dotGit) || nowOn !== MAIN || nowAt !== main || left !== '') {
      refuse('The project\'s folder didn\'t read as its own repository on the main version after the move, so everything was put back');
    }
  } catch (error) {
    await putBack();
    throw error;
  }
  // Verified: the store's entry for the folder, set aside, goes now.
  const movedAside = path.join(dotGit, path.basename(aside));
  fs.rmSync(movedAside, { recursive: true, force: true });
  const worktrees = path.join(dotGit, 'worktrees');
  try {
    if (fs.readdirSync(worktrees).length === 0) fs.rmdirSync(worktrees);
  } catch { /* none */ }
  return { released: true, main };
}
