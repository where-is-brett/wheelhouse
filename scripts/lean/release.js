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
//
// Before the git leaves the store, what the director decided through the helper is written back into the chat's own
// record (ruling P5-58), the inverse of the import at adoption: the ideas, the rulings in force and the designs
// approved, as `.wheelhouse/record/*.jsonl` lines that keep the proof the helper's record names, in one record-only
// commit on the main version. The git-alone playbook reads only those lines, so its standing rules, ideas and designs
// carry on. Lines that came from the record at adoption are not written again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { stateDir } from '../lib/paths.js';
import { listEvents } from '../state/events.js';
import { buildViews } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { LEAN_DESIGNS_DIR, LEAN_PROOFS as PROOFS, LEAN_RECORD_DIR, LEAN_TEXT_CHARS, parseLeanRecord } from '../state/lean-record.js';
import { briefHash } from '../feature/files.js';
import { readLean, updateLean } from './project.js';
import { LeanRefusal, storeDir, inTempTree, identityEnv } from './store.js';

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

// --- what the helper recorded, written back into the record ---

const DESIGN_PATH = new RegExp(`^${LEAN_RECORD_DIR.replaceAll('.', '\\.')}/${LEAN_DESIGNS_DIR}/([a-z0-9][a-z0-9-]{0,39})\\.md$`);
const CUT = ' (Cut short here: the whole idea is in Wheelhouse\'s state for this project.)';
const proofOr = (proof, fallback) => (PROOFS.includes(proof) ? proof : fallback);
// A line's time as the playbook writes it: UTC, to the second.
const lineTime = (at) => new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
// Made through the helper: not a line the record held already (an event imported at adoption names its source).
const madeHere = (event) => event?.data?.source === undefined;
const nonEmpty = (x) => typeof x === 'string' && x.trim() !== '';

function lineOf(kind, at, card, choice, proof, text) {
  return { at: lineTime(at), kind, card, choice, commit: null, proof, by: 'chat', tier: 'lean', text };
}

// The idea and ruling lines for the helper's own record of a Lean project, from its events: each idea as it stands
// now (the newest words under its short name), and each ruling in force (confirmed by a signed record, or at Lean by
// the chat click the helper recorded), with the proof that put it there. A proposed ruling is not one the
// playbook may follow, so it is left out. Gives { lines, designs }: `designs` are the approved designs to look up
// in the main version, { card, path, hash, at, proof }.
export function helperRecordLines(events, enrolled) {
  const views = buildViews(events, enrolled, { lean: true });
  const byId = new Map(events.map((e) => [e.id, e]));
  const lines = [];
  for (const [key, idea] of Object.entries(views.ideas ?? {})) {
    const event = byId.get(idea.id);
    if (!madeHere(event)) continue;
    const words = [idea.data?.text, idea.data?.title, idea.data?.words, idea.data?.what].find(nonEmpty);
    if (words === undefined) continue;
    const text = words.length > LEAN_TEXT_CHARS ? `${words.slice(0, LEAN_TEXT_CHARS - CUT.length)}${CUT}` : words;
    lines.push(lineOf('idea', idea.at, key, null, proofOr(idea.data?.proof, 'chat-click'), text));
  }
  for (const ruling of views.rulebook ?? []) {
    const event = byId.get(ruling.id);
    if (ruling.status !== 'accepted' || !madeHere(event) || !nonEmpty(ruling.words)) continue;
    const card = nonEmpty(event.data?.card) ? event.data.card : `ruling-${ruling.id.slice(0, 8)}`;
    if (ruling.words.length > LEAN_TEXT_CHARS) {
      refuse(`The ruling ${card} is longer than ${LEAN_TEXT_CHARS} characters, so it can't be written into the record files as it is: give it in shorter words first, then try again`);
    }
    const signed = events.filter((e) => e.kind === 'confirmation' && e.data?.confirms === ruling.id).at(-1);
    const proof = ruling.proof === 'chat-click' ? 'chat-click' : proofOr(signed?.data?.proof, 'signed-hook');
    lines.push(lineOf('ruling', ruling.at, card, 'Confirm', proof, ruling.words));
  }
  const designs = [];
  for (const [id, entry] of Object.entries(views.work ?? {})) {
    const doc = entry.work?.data?.doc;
    const m = typeof doc?.path === 'string' ? DESIGN_PATH.exec(doc.path) : null;
    if (!entry.approved || m === null || typeof entry.approval?.hash !== 'string') continue;
    const approval = events.filter((e) => e.kind === 'action' && e.data?.action === 'approve-work' && e.data?.work === id && e.data?.hash === entry.approval.hash).at(-1);
    designs.push({ card: `design-${m[1]}`, path: doc.path, hash: entry.approval.hash, at: approval?.at ?? entry.work.at, proof: proofOr(approval?.data?.proof, 'signed-hook') });
  }
  return { lines, designs };
}

// The lines to write back for `project` at the store's main version `main`: the ideas and rulings, and each approved
// design whose file the main version holds as it was approved, named by its git blob hash as the playbook names
// it. Sorted by time. A design changed since its approval is not one to build from, so it is left out.
export async function writeBackLines({ project, run = realRun, main }) {
  const { lines, designs } = helperRecordLines(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
  const store = gitAt(storeDir(project), { run, what: STORE_WHAT });
  for (const design of designs) {
    const blob = await store.call(['rev-parse', '--verify', '-q', `${main}:${design.path}`]);
    const sha = String(blob.stdout ?? '').trim();
    if (blob.code !== 0 || !/^[0-9a-f]{40}$/.test(sha)) continue;
    const text = await store.call(['cat-file', 'blob', sha]);
    if (text.code !== 0 || briefHash(text.stdout) !== design.hash) continue;
    lines.push(lineOf('design', design.at, design.card, 'Build it', design.proof, `${design.path} ${sha}`));
  }
  return lines.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// "2 ideas, 1 ruling and no designs": the card's count of the lines written back.
export function writeBackCount(lines) {
  const n = (kind, one, many) => {
    const count = lines.filter((l) => l.kind === kind).length;
    return count === 0 ? `no ${many}` : `${count} ${count === 1 ? one : many}`;
  };
  return `${n('idea', 'idea', 'ideas')}, ${n('ruling', 'ruling', 'rulings')} and ${n('design', 'design', 'designs')}`;
}

// Writes `lines` into the record's day files in one commit on the store's main version, made in a fresh worktree and
// moved onto `main` by compare-and-swap; the folder, a worktree of the store at the main version, is moved to it as
// well. Each line is checked as the record's reader checks it, and the commit holds only record files. Gives the new
// main version, or `main` as it was when there is nothing to write.
async function writeBack({ project, real, run, main, lines, now }) {
  if (lines.length === 0) return main;
  const lean = readLean(project);
  const files = new Map();
  for (const line of lines) {
    const name = `${line.at.slice(0, 10)}.jsonl`;
    const text = `${JSON.stringify(line)}\n`;
    const got = parseLeanRecord(text, { file: `${LEAN_RECORD_DIR}/${name}` });
    if (got.problems.length > 0) refuse(`What the helper recorded could not be written into the record: ${got.problems[0].why}`);
    files.set(name, `${files.get(name) ?? ''}${text}`);
  }
  const paths = [...files.keys()].sort().map((name) => `${LEAN_RECORD_DIR}/${name}`);
  const commit = await inTempTree(project, { run, at: main, env: identityEnv(lean, now) }, async (tree, git) => {
    for (const rel of paths) {
      const full = path.join(tree, ...rel.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const held = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
      fs.writeFileSync(full, `${held}${held === '' || held.endsWith('\n') ? '' : '\n'}${files.get(path.posix.basename(rel))}`);
    }
    await git.must(['add', '-f', '--', ...paths], 'The record files could not be added');
    await git.must(['commit', '-q', '--no-verify', '-m', 'Record: what was decided through Wheelhouse\'s helper'], 'The record files could not be committed');
    const sha = await git.must(['rev-parse', '--verify', 'HEAD^{commit}'], 'The record\'s commit could not be read');
    const touched = (await git.must(['diff', '--name-only', main, sha], 'The record\'s commit could not be read')).split('\n').filter(Boolean);
    if (touched.some((p) => !paths.includes(p))) refuse('The record\'s commit held more than the record files, so nothing was added');
    return sha;
  });
  const here = gitAt(real, { run, what: FOLDER_WHAT });
  const moved = await here.call(['checkout', '--detach', '--quiet', commit]);
  if (moved.code !== 0) {
    refuse(`The record files in this folder (${paths.join(', ')}) hold lines that aren't committed, so nothing was written and the project's git stays in Wheelhouse's store: commit or remove them, then try again`);
  }
  const swapped = await gitAt(storeDir(project), { run, what: STORE_WHAT }).call(['update-ref', '-m', 'Wheelhouse', MAIN, commit, main]);
  if (swapped.code !== 0) {
    await here.call(['checkout', '--detach', '--quiet', main]);
    refuse('The main version moved while the record was being written, so nothing was added and the project\'s git stays in Wheelhouse\'s store; try again');
  }
  updateLean(project, { main: commit });
  return commit;
}

// releaseProject({ project, folder, run, now }) -> { released, main, written }
//   released  false when the folder's git is its own already (never adopted, or given back before)
//   written   the record lines written back before the git left the store
// `rename` is fs.renameSync, given by a test to make a move fail.
export async function releaseProject({ project, folder, run = realRun, rename = fs.renameSync, now = () => new Date() } = {}) {
  const lean = readLean(project);
  if (lean === null) refuse('This project is not registered as a Lean project');
  const real = realOrNull(folder);
  if (real === null || real !== realOrNull(lean.folder)) refuse('That folder is not this Lean project\'s folder');
  const dotGit = path.join(real, '.git');
  let stat = null;
  try { stat = fs.lstatSync(dotGit); } catch { /* none */ }
  if (stat?.isDirectory()) return { released: false, main: null, written: 0 };
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
  const before = await inStore.must(['rev-parse', '--verify', '-q', `${MAIN}^{commit}`], 'The main version could not be read in the store');
  const branch = await here.call(['symbolic-ref', '-q', 'HEAD']);
  const head = await here.must(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], 'The project\'s folder could not be read');
  const onBranch = branch.code === 0 ? String(branch.stdout).trim() : null;
  if ((onBranch !== null && onBranch !== MAIN) || head !== before) {
    refuse('The project\'s folder isn\'t on the main version, so its git was left in the store: run `git switch --detach main` there, then try again');
  }
  const trees = await inStore.must(['worktree', 'list', '--porcelain'], 'The store\'s worktrees could not be read');
  const listed = trees.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => realOrNull(l.slice('worktree '.length)));
  if (listed.filter((p) => p !== storeReal && p !== real).length > 0) refuse('The store has worktrees other than this folder, so its git was left in the store');
  // What the director decided through the helper goes into the record first, while the store still holds the git.
  const lines = await writeBackLines({ project, run, main: before });
  const main = await writeBack({ project, real, run, main: before, lines, now });

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
  return { released: true, main, written: lines.length };
}
