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
// everything back as it was (the store's HEAD too), and a step that can't be put back is named, with where the
// project's git is then. Every git call goes through safeGit with the project list and the `lean` caller.
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
// `rename` is fs.renameSync, given by a test to make a move fail.
export async function releaseProject({ project, folder, run = realRun, rename = fs.renameSync } = {}) {
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
  const headFile = path.join(storeReal, 'HEAD');
  const head0 = fs.readFileSync(headFile, 'utf8');
  const steps = [];
  // Undoes the steps made, last first. Every step it can't undo is named, with where the project's git is then,
  // so the refusal says it in plain words; nothing is ever deleted on this path.
  const putBack = async () => {
    const failed = [];
    const step = async (name, undo) => {
      if (!steps.includes(name)) return;
      try {
        await undo();
      } catch (error) {
        failed.push(`${name === 'moved' ? 'moving the git back into the store' : name === 'pointer' ? 'writing the folder\'s pointer file' : name === 'aside' ? 'putting the store\'s entry for the folder back' : 'setting the store back to bare'} (${error?.code ?? error?.message ?? 'no reason given'})`);
      }
    };
    await step('moved', () => {
      rename(dotGit, store);
      fs.writeFileSync(headFile, head0);
    });
    const inPlace = fs.existsSync(store);
    if (inPlace) {
      await step('pointer', () => fs.writeFileSync(dotGit, pointer));
      await step('aside', () => rename(aside, entry));
      await step('bare', async () => {
        const got = await inStore.call(['config', 'core.bare', 'true']);
        if (got.code !== 0) throw new Error('git config failed');
      });
    }
    return { failed, where: inPlace ? store : dotGit };
  };
  try {
    await inStore.must(['config', 'core.bare', 'false'], 'The store could not be changed');
    steps.push('bare');
    rename(entry, aside);
    steps.push('aside');
    fs.rmSync(dotGit, { force: true });
    steps.push('pointer');
    rename(store, dotGit);
    steps.push('moved');
    const own = gitAt(real, { run, what: FOLDER_WHAT });
    await own.must(['symbolic-ref', 'HEAD', MAIN], 'The main version could not be checked out in the folder');
    await own.must(['reset', '--quiet', '--mixed'], 'The project\'s folder could not be matched to the main version');
    const gitDir = await own.must(['rev-parse', '--path-format=absolute', '--git-dir'], 'The project\'s folder could not be read');
    const nowOn = await own.must(['symbolic-ref', 'HEAD'], 'The project\'s folder could not be read');
    const nowAt = await own.must(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], 'The project\'s folder could not be read');
    const left = await own.must(['status', '--porcelain=v1', '--untracked-files=no'], 'The project\'s folder could not be read');
    if (realOrNull(gitDir) !== realOrNull(dotGit) || nowOn !== MAIN || nowAt !== main || left !== '') {
      refuse('The project\'s folder didn\'t read as its own repository on the main version after the move');
    }
  } catch (error) {
    const why = String(error?.message ?? 'no reason given').replace(/[.\s]+$/, '');
    const back = await putBack();
    if (back.failed.length === 0) refuse(`${why}, so everything was put back: the project's git is still in Wheelhouse's store, ${store}, and nothing was deleted`);
    refuse(`${why}, and the git could not be put back as it was: ${back.failed.join('; ')}. The project's git is now at ${back.where}, whole; nothing was deleted. Ask for help before changing anything there`);
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
