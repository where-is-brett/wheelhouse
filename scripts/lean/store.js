// scripts/lean/store.js
// A Lean project's git store, outside the project (design section 6.4; rulings P5-24 to P5-27). Where the helper
// runs at Lean, the project's repository is moved to <wheelhouseHome>/projects/<p>/git, a bare repository, and
// the project's folder is left as a worktree of it, detached, so the main version is checked out nowhere: an
// agent's edit tools can't move it, add a git hook to it or change its settings. Only the helper moves `main`,
// and only to a merge of a commit the director approved, after that commit's tests passed, or to an undo the
// director clicked in the helper's window. After each change the copy folder fetches the store's `main` and the
// state's branch, in a git run in the copy, so no hook of the copy's runs (ruling P5-50).
//
// Every git call goes through safeGit with the project list and the `lean` caller (ruling P5-25): the fence
// shuts out the person's own git config and points hooks at the null file, so no hook in the store or the
// project runs and no `-c` is needed in any argument list. A store whose settings are off the list is refused,
// with the look's own line. Merges and undos are made in a temporary worktree and moved onto `main` with a
// compare-and-swap (`update-ref <new> <old>`), one at a time per project (withLocalLock).
//
// Refusals are thrown as LeanRefusal, whose message is one plain line and whose `extra` fields go into the
// helper's answer beside it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { safeGit, lookRefusalLine } from '../lib/safe-git.js';
import { computerId, stateDir } from '../lib/paths.js';
import { setStop, stopState } from '../lib/stop.js';
import { STATE_BRANCH } from '../state/clone.js';
import { listEvents, makeEvent, writeEvent } from '../state/events.js';
import { writeViews } from '../state/views.js';
import { readEnrolled, sign, verify } from '../state/signing.js';
import { readLeanRecord, leanToEvents, leanStopOpen } from '../state/lean-record.js';
import { leanMergeDecision } from '../gate/conditions.js';
import { readLean, updateLean, unregisterLean, leanState } from './project.js';
import { AGENT_VARIABLES } from '../agents/variables.js';

// A refusal: its message is the one plain line the director's chat says; `extra` goes beside it in the answer.
export class LeanRefusal extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.extra = extra;
  }
}
const refuse = (message, extra) => { throw new LeanRefusal(message, extra); };

export const OTHER_WINDOW = 'Another VS Code window is merging this project; try again in a minute';
export const MAIN_CHECKED_OUT = 'The main version is checked out in a folder, so the helper can\'t move it: run `git switch --detach main` there, then try again';
export const MAIN_MOVED = 'The main version changed without an approval, so nothing is added to it until the director decides: Undo it or Keep it';
export const NOT_IN_STORE = 'This project\'s git isn\'t in Wheelhouse\'s store yet, so the helper can\'t merge, undo or copy it';
export const NO_COPY = 'No copy folder is set for this project yet';
export const STOPPED = 'STOP is on';

// The longest a project's tests may run before they count as failed, and how long a merge waits for another.
export const LEAN_TEST_MS = 15 * 60 * 1000;
export const LOCK_WAIT_MS = 120 * 1000;
const LOCK_POLL_MS = 100;
// A lock file that can't be read is taken as being written for this long, then as left behind.
const LOCK_WRITING_MS = 10 * 1000;

const FULL_COMMIT = /^[0-9a-f]{40}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const STORE_WHAT = 'the Lean project\'s git store';
const FOLDER_WHAT = 'the Lean project\'s folder';
const MAIN = 'refs/heads/main';
// Who a merge or an undo is committed as when the record names no one: Wheelhouse, as the state's commits are.
const WHEELHOUSE = { name: 'Wheelhouse', email: 'wheelhouse@invalid' };
// The proofs a Lean merge takes (the helper passes the chat's own, from scripts/agents/chat-clicks.js): a signed
// approval naming the window's proof, and, on a project with no real users, a chat click. The add-on's proof joins
// when the add-on exists (spec section 8.6); until then a project with real users is asked for the window's.
export const SIGNED_LEAN_PROOFS = Object.freeze(['window']);

const projectFolder = (project) => path.join(stateDir(project), '..');

// The store: <wheelhouseHome>/projects/<project>/git, a bare repository.
export function storeDir(project) {
  return path.join(projectFolder(project), 'git');
}

// The line a Lean approval card carries, naming the feature's branch and its head in full: the helper's window
// signs an approval only for a card that holds exactly one (scripts/host/helper.js, windowEarned).
export const leanApprovalLine = (branch, commit) => `Approve ${branch} at commit ${commit}`;
export const LEAN_APPROVE = /Approve (feature\/[a-z0-9][a-z0-9-]{0,39}) at commit ([0-9a-f]{40})/g;
// The line the card about a main version moved outside the helper carries (ruling P5-27 f).
export const mainMovedLine = (from, to) => `The main version moved from ${from} to ${to} without an approval`;
export const MAIN_MOVED_LINE = /The main version moved from ([0-9a-f]{40}) to ([0-9a-f]{40}) without an approval/g;
// The line the card asking to undo a merge carries (ruling P5-50): undo is a runbook step, confirmed in the window.
export const undoLine = (merge) => `Undo the merge ${merge} on the main version`;
export const UNDO_LINE = /Undo the merge ([0-9a-f]{40}) on the main version/g;

// --- git, fenced ---

// git in `cwd` through safeGit, looked at once: `call` gives run's answer, `must` the trimmed output or a refusal.
function gitAt(cwd, { run, env = {}, reach = 'https', list = 'project', what = STORE_WHAT } = {}) {
  const call = safeGit({ run, cwd, env, reach, list, look: 'once', caller: 'lean', what });
  return {
    call,
    async must(args, why) {
      const got = await call(args);
      if (got.code !== 0) refuse(why);
      return String(got.stdout ?? '').trim();
    },
    async ok(args) {
      return (await call(args)).code === 0;
    },
  };
}

// Who commits: the record's identity, or Wheelhouse's, at `now`.
export function identityEnv(lean, now) {
  const who = lean.identity ?? WHEELHOUSE;
  const at = now().toISOString();
  return {
    GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_AUTHOR_DATE: at,
    GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email, GIT_COMMITTER_DATE: at,
  };
}

// The record of an adopted project, or a refusal.
function adopted(project) {
  const lean = readLean(project);
  if (lean === null) refuse('This project is not registered as a Lean project');
  if (lean.store === null || lean.main === undefined || lean.main === null || !fs.existsSync(storeDir(project))) refuse(NOT_IN_STORE);
  return lean;
}

// The store's main version now.
async function storeMain(project, run) {
  return gitAt(storeDir(project), { run }).must(['rev-parse', '--verify', '-q', `${MAIN}^{commit}`], 'The main version could not be read in the store');
}

// The commit a branch of the store names (`main` or `feature/<slug>`), or null: for the helper's window, which
// signs a Lean approval only for a branch's head as it stands.
export async function storeHead({ project, branch, run = realRun }) {
  if (typeof branch !== 'string' || !(branch === 'main' || (branch.startsWith('feature/') && SLUG.test(branch.slice('feature/'.length))))) return null;
  if (!fs.existsSync(storeDir(project))) return null;
  const got = await gitAt(storeDir(project), { run }).call(['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`]);
  const sha = String(got.stdout ?? '').trim();
  return got.code === 0 && FULL_COMMIT.test(sha) ? sha : null;
}

// Refuses when any worktree has the main version checked out: the helper moves `main` only where no folder holds it.
async function mainCheckedOutNowhere(project, run) {
  const listed = await gitAt(storeDir(project), { run }).must(['worktree', 'list', '--porcelain'], 'The store\'s worktrees could not be read');
  if (listed.split('\n').some((line) => line.trim() === `branch ${MAIN}`)) refuse(MAIN_CHECKED_OUT);
}

// Moves `main` from `from` to `to`, only if it is still at `from`.
async function moveMain(project, run, to, from) {
  const moved = await gitAt(storeDir(project), { run }).ok(['update-ref', '-m', 'Wheelhouse', MAIN, to, from]);
  if (!moved) refuse('The main version moved while the helper was working, so nothing was added; try again');
  updateLean(project, { main: to });
}

// A fresh worktree of the store at `at`, detached, in a folder of its own under the project's folder, for `fn`;
// removed afterwards whatever happens.
export async function inTempTree(project, { run, at, env = {} }, fn) {
  const store = gitAt(storeDir(project), { run });
  const parent = fs.mkdtempSync(path.join(projectFolder(project), 'work-'));
  const tree = path.join(parent, 'tree');
  try {
    await store.must(['worktree', 'add', '--detach', '--quiet', tree, at], 'A worktree for the work could not be made in the store');
    return await fn(tree, gitAt(tree, { run, env }));
  } finally {
    await store.call(['worktree', 'remove', '--force', tree]).catch(() => {});
    fs.rmSync(parent, { recursive: true, force: true });
    await store.call(['worktree', 'prune']).catch(() => {});
  }
}

// --- the lock: one change to the store at a time ---

function lockGone(file) {
  let held;
  try {
    held = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Being written, or left half written: only age frees it.
    try {
      return Date.now() - fs.statSync(file).mtimeMs > LOCK_WRITING_MS;
    } catch {
      return false;
    }
  }
  const pid = held?.pid;
  if (!Number.isInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

// Runs `fn` holding the project's lock: a file in <wheelhouseHome>/projects/<p>/ made with an exclusive create,
// holding { pid, startedAt }, and freed in `finally`. A lock whose process has gone is taken over (renamed to a
// name of its own first, so a waiter never removes a lock made in its place). After `waitMs` it refuses with
// OTHER_WINDOW.
export async function withLocalLock(project, fn, { waitMs = LOCK_WAIT_MS, pollMs = LOCK_POLL_MS, now = () => new Date() } = {}) {
  const file = path.join(projectFolder(project), 'lean.lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const mine = `${JSON.stringify({ pid: process.pid, startedAt: now().toISOString(), token: crypto.randomBytes(8).toString('hex') })}\n`;
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let seen;
    try { seen = fs.readFileSync(file, 'utf8'); } catch { /* gone */ }
    if (seen !== undefined && lockGone(file)) {
      const taken = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.gone`;
      try {
        fs.renameSync(file, taken);
        if (fs.readFileSync(taken, 'utf8') !== seen) {
          try { fs.linkSync(taken, file); } catch { /* another lock stands */ }
        }
        fs.rmSync(taken, { force: true });
      } catch { /* another waiter took it over */ }
      continue;
    }
    if (Date.now() >= until) refuse(OTHER_WINDOW);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  try {
    return await fn();
  } finally {
    try {
      if (fs.readFileSync(file, 'utf8') === mine) fs.rmSync(file, { force: true });
    } catch { /* already gone */ }
  }
}

// --- the record ---

// Writes a plain event into the project's local state, as the helper does when it isn't the one asking: made
// here, committed and never pushed, with the views written again. Gives its id.
async function writeHere(project, kind, data, { run, now, signed = false }) {
  await leanState(project, { run });
  const made = makeEvent({ kind, data, now });
  const event = signed ? sign(made) : made;
  await writeEvent({ project, event, push: async () => ({ ok: false }), env: {}, now });
  try { await writeViews(project, { now }); } catch { /* the next write brings them up to date */ }
  return event.id;
}
// A recorder is called as (project, kind, data, { signed }): `signed` for the record of a merge or an undo whose proof is
// the window's, which this computer signs (ruling P5-24).
const recorderFor = (record, { run, now }) => record ?? ((project, kind, data, { signed = false } = {}) => writeHere(project, kind, data, { run, now, signed }));

const eventsOf = (project) => listEvents(stateDir(project), { report: () => {} });

// Whether a card's data is the helper's own composed card: its question, options, header, kind, level and
// recommendation the same (ruling P5-50), so a card anyone wrote with the helper's line but other words, or another
// recommendation for the board to show, is never taken for it.
export function sameCard(data, composed) {
  return data !== null && typeof data === 'object'
    && data.question === composed.question && data.header === composed.header
    && data.kind === composed.kind && data.level === composed.level && data.recommend === composed.recommend
    && Array.isArray(data.options) && data.options.length === composed.options.length && data.options.every((o, i) => o === composed.options[i]);
}

// The helper's card, raised once: the id of the one the state holds, if it is that card word for word, else of one
// written now.
async function raiseCard(project, data, record) {
  const held = eventsOf(project).find((e) => e.kind === 'card' && e.data?.line === data.line && sameCard(e.data, data));
  return held ? held.id : record(project, 'card', data);
}

export function mainMovedCard(from, to) {
  const line = mainMovedLine(from, to);
  return {
    question: [
      'The main version changed without an approval: something moved it outside Wheelhouse\'s helper.',
      'Undo it takes those changes back out with a new commit; nothing is deleted. Keep it keeps them, confirmed in Wheelhouse\'s own window.',
      'Recommended: Undo it. Until you choose, nothing is added to the main version.',
      line,
    ].join('\n'),
    header: 'Main moved',
    options: ['Undo it', 'Keep it', 'Not now'],
    kind: 'question',
    level: 4,
    recommend: 'Undo it',
    line,
  };
}

// The card asking to undo a merge: Undo adds a commit that reverses it, confirmed in the helper's window, and works
// while STOP is on (a runbook step, spec section 6.4).
export function undoCard(merge) {
  const line = undoLine(merge);
  return {
    question: [
      'Take this merge back out of the main version?',
      'Undo adds a new commit that reverses it: nothing is deleted, and later work stays. It is confirmed in Wheelhouse\'s own window, and it works while STOP is on.',
      line,
    ].join('\n'),
    header: 'Undo',
    options: ['Undo', 'Not now'],
    kind: 'runbook',
    level: 3,
    line,
  };
}

export function approvalCard(branch, commit, testCommand) {
  const line = leanApprovalLine(branch, commit);
  const slug = branch.slice('feature/'.length);
  return {
    question: [
      `Add ${slug.replace(/-/g, ' ')} to the main version?`,
      'This project has real users, so the approval is confirmed in Wheelhouse\'s own window, not by a click in the chat.',
      testCommand === null ? 'No tests are set for this project, so none will run.' : 'Its tests run on this exact commit before it is added.',
      line,
    ].join('\n'),
    header: 'Approve',
    options: ['Approve', 'Show me', 'Suggest a change…', 'Not now'],
    kind: 'approval',
    level: 3,
    recommend: 'Approve',
    line,
  };
}

// Compares the main version the record holds with the store's. When they differ, nothing is added until the
// director decides, and the card asking is raised once. Gives { recorded, current, moved, card? }.
// The record is read again after the store, so a status asked while another window moves the main version (the
// store first, then the record) never sees the new head against the old record.
async function lookAtMain(project, lean, { run, record }) {
  const current = await storeMain(project, run);
  const recorded = readLean(project)?.main ?? lean.main;
  if (current === recorded) return { recorded, current, moved: false };
  const card = await raiseCard(project, mainMovedCard(recorded, current), record);
  return { recorded, current, moved: true, card };
}

// --- adopting a project ---

// The settings refused at adoption beyond the project list: `core.hooksPath`, `include.*` and `includeIf.*`.
const HOOKS_OR_INCLUDES = /^(?:core\.hookspath|include\..+|includeif\..+)$/i;

const realOrNull = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

// Where `folder` stands for adoption into `project`'s store: { real, dotGit, store, lean, adopted } once the folder
// is the project's own (registered under it, or not yet registered at all), with `adopted` true when its git is in
// the store already. Refused for a folder that is another's, or has no git of its own.
async function placeForAdoption(project, folder, run) {
  const lean = readLean(project);
  const real = realOrNull(folder);
  if (real === null || (lean !== null && real !== realOrNull(lean.folder))) refuse('That folder is not this Lean project\'s folder');
  const store = storeDir(project);
  const dotGit = path.join(real, '.git');
  let stat = null;
  try { stat = fs.lstatSync(dotGit); } catch { /* none */ }
  if (stat?.isFile() && lean !== null && lean.store !== null && fs.existsSync(store)) {
    const common = await gitAt(real, { run, what: FOLDER_WHAT }).must(['rev-parse', '--path-format=absolute', '--git-common-dir'], 'The project\'s folder could not be read');
    if (realOrNull(common) !== realOrNull(store)) refuse('The project\'s folder points to another repository, so it was left alone');
    return { real, dotGit, store, lean, adopted: true };
  }
  if (!stat?.isDirectory()) refuse('The project\'s folder has no git repository of its own, so there is nothing to move');
  return { real, dotGit, store, lean, adopted: false };
}

// Adoption's own checks on a folder whose git is still its own: the store's folder empty, the folder on `main` with
// nothing uncommitted, no worktrees of its own, no hooks folder or include in its settings, no submodules. Gives
// { main, copy }: the main version's head, and the copy folder its `wheelhouse-copy` remote names, or null.
async function adoptionChecks({ real, dotGit, store }, run) {
  if (fs.existsSync(store) && fs.readdirSync(store).length > 0) refuse(`The store's folder ${store} already holds files, so it was left alone`);
  const here = gitAt(real, { run, what: FOLDER_WHAT });
  const head = await here.must(['symbolic-ref', '-q', 'HEAD'], 'The project\'s folder isn\'t on the main version');
  if (head !== MAIN) refuse('The project\'s folder isn\'t on the main version: switch to main, then try again');
  const changes = await here.must(['status', '--porcelain=v1', '--untracked-files=no'], 'The project\'s folder could not be read');
  if (changes !== '') refuse('The project\'s folder has changes that aren\'t committed, so it was left alone');
  const main = await here.must(['rev-parse', '--verify', '-q', `${MAIN}^{commit}`], 'The main version could not be read');
  const trees = await here.must(['worktree', 'list', '--porcelain'], 'The project\'s worktrees could not be read');
  if (trees.split('\n').filter((l) => l.startsWith('worktree ')).length !== 1) refuse('The project has worktrees of its own, so it was left alone');
  // On top of the project list (ruling P5-25): a hooks folder of the project's own, or an include that reads a file
  // outside the store, would apply to every plain git command run in the folder after the move.
  const own = await here.must(['config', '--local', '--no-includes', '--name-only', '--list', '-z'], 'The project\'s git settings could not be read');
  const kept = [...new Set(own.split('\0').map((k) => k.trim()).filter((k) => HOOKS_OR_INCLUDES.test(k)))];
  if (kept.length > 0) refuse(lookRefusalLine('lean', { keys: kept }, { what: FOLDER_WHAT }));
  // A submodule's .git file points into .git/modules, which no longer resolves once .git is a pointer file.
  if (fs.existsSync(path.join(dotGit, 'modules'))) refuse('The project has submodules, which can\'t move into the store yet, so it was left alone');
  const copyUrl = await here.call(['remote', 'get-url', 'wheelhouse-copy']);
  const copy = copyUrl.code === 0 && path.isAbsolute(copyUrl.stdout.trim()) ? copyUrl.stdout.trim() : null;
  return { main, copy };
}

// Whether `folder` can be adopted into `project`'s store, checked as adoptProject checks it and changing nothing
// (ruling P5-58): for the helper's install plan, so no card is asked for a folder the store would refuse. Refuses
// with adoption's own plain line. Gives { adopted, stop }: whether its git is in the store already, and whether the
// chat's own record leaves STOP on (its last stop or lift-stop line is a stop), which adoption carries over.
export async function checkAdoptable({ project, folder, run = realRun } = {}) {
  const place = await placeForAdoption(project, folder, run);
  if (place.adopted) return { adopted: true, stop: false };
  await adoptionChecks(place, run);
  return { adopted: false, stop: leanStopOpen(readLeanRecord(place.real).entries) };
}

// Moves the project's `.git` into the store and leaves the folder a worktree of it, detached at the main
// version's head (ruling P5-26). Refused for a folder with uncommitted changes, one that isn't on `main`, one
// whose git settings are off the project list, or one with worktrees of its own. Earlier lines of the chat's own
// record (`.wheelhouse/record/*.jsonl`) become events once (leanToEvents), and the files stay where they are; when
// the record's last stop or lift-stop line is a stop, STOP is turned on, as the director left it (ruling P5-58), and
// only the helper's window lifts it. Adopting a folder already in the store changes nothing.
// `register`, for a project not registered yet (the helper's install): called with { store, main, copy } once the
// git is in the store, to register the project; if it throws, the git is put back and nothing stays registered, so
// a failed adoption never leaves a project half on the helper. Gives { adopted, main, imported, problems, stop }.
export async function adoptProject({ project, folder, run = realRun, now = () => new Date(), register = null } = {}) {
  if (readLean(project) === null && register === null) refuse('This project is not registered as a Lean project');
  const place = await placeForAdoption(project, folder, run);
  const { real, dotGit, store, lean } = place;
  if (place.adopted) return { adopted: false, main: lean.main ?? null, imported: 0, problems: 0, stop: false };
  const { main, copy } = await adoptionChecks(place, run);

  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.rmSync(store, { recursive: true, force: true });
  try {
    fs.renameSync(dotGit, store);
  } catch (error) {
    refuse(error.code === 'EXDEV'
      ? 'The project\'s folder and Wheelhouse\'s folder are on different drives, so the project\'s git could not be moved'
      : 'The project\'s git could not be moved into the store');
  }
  // The repository goes back where it was, without the worktree entry the move made, so the next adoption isn't
  // refused for worktrees of its own.
  const putBack = () => {
    try {
      if (!fs.existsSync(dotGit) || fs.lstatSync(dotGit).isFile()) {
        fs.rmSync(dotGit, { force: true });
        fs.renameSync(store, dotGit);
      }
      fs.rmSync(path.join(dotGit, 'worktrees', 'tree'), { recursive: true, force: true });
      const worktrees = path.join(dotGit, 'worktrees');
      if (fs.existsSync(worktrees) && fs.readdirSync(worktrees).length === 0) fs.rmdirSync(worktrees);
    } catch { /* left for the director: the refusal says what happened */ }
  };
  const parent = fs.mkdtempSync(path.join(projectFolder(project), 'adopt-'));
  try {
    const inStore = gitAt(store, { run });
    await inStore.must(['config', 'core.bare', 'true'], 'The store could not be made');
    const tree = path.join(parent, 'tree');
    await inStore.must(['worktree', 'add', '--detach', '--no-checkout', '--quiet', tree, MAIN], 'The project\'s folder could not be made a worktree of the store');
    fs.renameSync(path.join(tree, '.git'), dotGit);
    await inStore.must(['worktree', 'repair', real], 'The project\'s folder could not be made a worktree of the store');
    const folderGit = gitAt(real, { run, what: FOLDER_WHAT });
    await folderGit.must(['reset', '--quiet', '--mixed'], 'The project\'s folder could not be matched to the main version');
    const left = await folderGit.must(['status', '--porcelain=v1', '--untracked-files=no'], 'The project\'s folder could not be read');
    if (left !== '') refuse('The project\'s folder didn\'t match the main version after the move');
    if (lean === null) register({ store, main, copy });
    else updateLean(project, { store, main, ...(lean.copy === null && copy !== null ? { copy } : {}) });
  } catch (error) {
    if (lean === null) unregisterLean(project);
    await gitAt(store, { run }).call(['config', 'core.bare', 'false']).catch(() => {});
    putBack();
    throw error;
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }

  // The chat's own record, kept until now in the project, becomes events once. A STOP it leaves on stays on.
  const { entries, problems } = readLeanRecord(real);
  const stop = leanStopOpen(entries);
  if (stop) setStop({ by: 'prompt', now });
  const events = leanToEvents(entries, { project });
  if (events.length > 0) {
    await leanState(project, { run });
    for (const event of events) await writeEvent({ project, event, push: async () => ({ ok: false }), env: {}, now });
    try { await writeViews(project, { now }); } catch { /* the next write brings them up to date */ }
  }
  return { adopted: true, main, imported: events.length, problems: problems.length, stop };
}

// --- the project's tests ---

// Wheelhouse's own variables, the code hosts', the coding agents' and the SSH agent's are cleared from the tests'
// environment.
// The person's SSH agent and password prompt too, so the approved code's tests can't push with their keys.
const CLEARED = /^(?:WHEELHOUSE_|GIT_|GH_|GITHUB_|GITLAB_|GLAB_)|^(?:CI_JOB_TOKEN|SSH_AUTH_SOCK|SSH_ASKPASS)$/i;
export function testEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !CLEARED.test(name) && !AGENT_VARIABLES.test(name)));
}

// The command line the tests run by: the system's own shell.
function shellFor(command, { platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
    return { file: path.win32.join(root, 'System32', 'cmd.exe'), args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true };
  }
  return { file: '/bin/sh', args: ['-c', command], windowsVerbatimArguments: false };
}

// Runs the project's test command in a clean worktree at `commit`, with a cleared environment and a time limit.
// Gives { ran: false } when the project has no test command, else { ran: true, passed, timedOut }.
async function runTests(project, { commit, command, run, platform, timeoutMs }) {
  if (command === null) return { ran: false };
  return inTempTree(project, { run, at: commit }, async (tree) => {
    const { file, args, windowsVerbatimArguments } = shellFor(command, { platform });
    let got;
    try {
      got = await run(file, args, { cwd: tree, baseEnv: testEnv(), env: {}, timeoutMs, limit: 64 * 1024, windowsVerbatimArguments });
    } catch {
      return { ran: true, passed: false, timedOut: false };
    }
    return { ran: true, passed: got.code === 0 && got.timedOut !== true, timedOut: got.timedOut === true };
  });
}

// --- merging an approved commit ---

// The records that could approve `commit`: signed approvals naming it, and clicks on Approve naming it, newest first.
function approvalsOf(project, commit) {
  return eventsOf(project)
    .filter((e) => (e.kind === 'approval' && e.data?.commit === commit) || (e.kind === 'card-answer' && e.data?.label === 'Approve' && e.data?.commit === commit))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// The decision for `commit` with each approval in turn: the first that allows, else the newest one's refusal.
function decide(project, base) {
  const candidates = approvalsOf(project, base.headSha);
  const enrolled = readEnrolled();
  let first = null;
  for (const approval of candidates.length > 0 ? candidates : [null]) {
    const decision = leanMergeDecision({ ...base, approval, enrolled });
    if (decision.allow) return { decision, approval };
    first ??= { decision, approval };
  }
  return first;
}

const proofOf = (approval) => (approval?.kind === 'approval' ? (approval.data?.proof ?? 'signed-hook') : approval?.data?.proof ?? null);

// Merges the approved `commit` of `branch` (`feature/<slug>`) into the main version (ruling P5-26). Needs: STOP
// off; the main version where the helper last moved it, and checked out nowhere; the branch's head still
// `commit`; an approval of exactly `commit` that counts (a signed one naming `window` or `add-on`, or a chat click
// where the project has no real users); and the project's tests passed at `commit` in a clean worktree (or no
// test command, which the record says). Then a merge commit is made in a fresh worktree, moved onto `main` by
// compare-and-swap, recorded, and the copy updated. One at a time per project. Gives { merge, tests, copy }.
export async function mergeApproved({
  project, branch, commit, now = () => new Date(), run = realRun, record, approvalProofs = ['chat-click', ...SIGNED_LEAN_PROOFS],
  platform = process.platform, testMs = LEAN_TEST_MS, lockWaitMs = LOCK_WAIT_MS,
} = {}) {
  if (typeof branch !== 'string' || !branch.startsWith('feature/') || !SLUG.test(branch.slice('feature/'.length))) refuse('The branch must be a feature\'s own: feature/<slug>');
  if (typeof commit !== 'string' || !FULL_COMMIT.test(commit)) refuse('The approved commit must be written in full');
  const write = recorderFor(record, { run, now });
  return withLocalLock(project, async () => {
    const lean = adopted(project);
    const slug = branch.slice('feature/'.length);
    if (stopState().on) refuse(STOPPED);
    const main = await lookAtMain(project, lean, { run, record: write });
    if (main.moved) refuse(MAIN_MOVED, { card: main.card });
    await mainCheckedOutNowhere(project, run);
    const store = gitAt(storeDir(project), { run });
    const head = await store.call(['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`]);
    if (head.code !== 0) refuse(`There is no ${branch} in the store`);
    if (head.stdout.trim() !== commit) refuse(`The head of ${branch} has moved since it was approved, so it needs a new review and approval`);
    if (await store.ok(['merge-base', '--is-ancestor', commit, MAIN])) refuse('That commit is in the main version already');
    const realUsers = lean.realUsers === true;
    const base = { stop: false, approvalProofs, realUsers, headSha: commit, mainMoved: false };

    // The approval first, so tests run only for a commit that may be merged.
    const before = decide(project, { ...base, tests: true });
    if (!before.decision.allow) {
      const extra = { reasons: before.decision.reasons };
      if (before.decision.needs) {
        extra.needs = before.decision.needs;
        extra.card = await raiseCard(project, approvalCard(branch, commit, lean.test), write);
      }
      refuse(`Not added: ${before.decision.reasons.join('; ')}`, extra);
    }
    const tests = await runTests(project, { commit, command: lean.test, run, platform, timeoutMs: testMs });
    if (stopState().on) refuse(STOPPED);
    // With no test command the merge goes ahead, and the record says no tests ran (ruling P5-26).
    const after = decide(project, { ...base, tests: tests.ran ? tests.passed : true, stop: stopState().on });
    if (!after.decision.allow) {
      const why = tests.timedOut ? `the tests ran past ${Math.round(testMs / 60000)} minutes` : after.decision.reasons.join('; ');
      refuse(`Not added: ${why}`, { reasons: after.decision.reasons });
    }

    const message = `Add ${slug} to the main version (approved ${commit.slice(0, 12)})`;
    const merge = await inTempTree(project, { run, at: main.current, env: identityEnv(lean, now) }, async (_tree, tree) => {
      const merged = await tree.call(['merge', '--no-ff', '--no-edit', '-m', message, commit]);
      if (merged.code !== 0) {
        await tree.call(['merge', '--abort']);
        refuse('It didn\'t fit the main version yet: later work touches the same lines, so it goes back to the builder. Nothing was added');
      }
      const sha = await tree.must(['rev-parse', '--verify', 'HEAD^{commit}'], 'The merge could not be read');
      const parents = (await tree.must(['rev-list', '--parents', '-n', '1', sha], 'The merge could not be read')).split(' ');
      if (parents.length !== 3 || parents[1] !== main.current || parents[2] !== commit) refuse('The merge was not of the approved commit onto the main version, so nothing was added');
      return sha;
    });
    await moveMain(project, run, merge, main.current);

    const approval = after.approval;
    const proof = proofOf(approval);
    await write(project, 'merge', {
      commit: merge,
      approved: commit,
      branch,
      card: `merge-${slug}`,
      tests: tests.ran ? 'passed' : 'none',
      proof,
      approval: approval?.id ?? null,
      forUsers: `${slug.replace(/-/g, ' ')} was added to the main version${tests.ran ? '' : '; no tests ran, as none are set for this project'}`,
    }, { signed: SIGNED_LEAN_PROOFS.includes(proof) });
    const copy = await updateCopy(project, { run, now, record: write });
    return { merge, tests: tests.ran ? 'passed' : 'none', copy };
  }, { waitMs: lockWaitMs, now });
}

// --- undoing ---

// The latest signed record of a click in the helper's window on `action` whose data `matches`: made and signed on this
// computer, by an enrolled key, naming the window's proof. Or null.
// Each click is used once: one an undo's own signed record names (`click`) counts no more, so a later undo needs a
// new click. Only signed undo records count as using one, so a plain note can't use up the director's click.
function windowClick(project, action, matches) {
  const me = computerId();
  const enrolled = readEnrolled();
  const events = eventsOf(project);
  const ownSigned = (e) => e.computer === me && e.sig?.computer === me && verify(e, enrolled);
  const used = new Set(events.filter((e) => e.kind === 'note' && e.data?.lean === 'undo' && typeof e.data?.click === 'string' && ownSigned(e)).map((e) => e.data.click));
  return events.filter((e) => e.kind === 'action' && e.data?.action === action && e.data?.proof === 'window'
    && !used.has(e.id) && matches(e.data) && ownSigned(e)).at(-1) ?? null;
}

// Whether `merge` is a merge commit (two parents) in the store's main version: for the helper's window, which offers
// Undo only for one.
export async function mergeOnMain({ project, merge, run = realRun }) {
  if (typeof merge !== 'string' || !FULL_COMMIT.test(merge) || !fs.existsSync(storeDir(project))) return false;
  const store = gitAt(storeDir(project), { run });
  const parents = await store.call(['rev-list', '--parents', '-n', '1', merge]);
  if (parents.code !== 0 || parents.stdout.trim().split(' ').length !== 3) return false;
  return store.ok(['merge-base', '--is-ancestor', merge, MAIN]);
}

// Reverts `commits` (newest first) in a fresh worktree at `at`, and gives the new head.
async function revertIn(project, lean, { run, now, at, commits }) {
  return inTempTree(project, { run, at, env: identityEnv(lean, now) }, async (_tree, tree) => {
    for (const commit of commits) {
      const parents = (await tree.must(['rev-list', '--parents', '-n', '1', commit], 'A commit to undo could not be read')).split(' ').length - 1;
      if (parents > 2) refuse('A commit to undo joins more than two lines of work, so it can\'t be undone here');
      const reverted = await tree.call(['revert', '--no-edit', ...(parents === 2 ? ['-m', '1'] : []), commit]);
      if (reverted.code !== 0) {
        await tree.call(['revert', '--abort']);
        refuse('The undo didn\'t apply cleanly, because later work touches the same files: ask the builder to do it as a new feature. Nothing was changed');
      }
    }
    return tree.must(['rev-parse', '--verify', 'HEAD^{commit}'], 'The undo could not be read');
  });
}

export const UNDO_NEEDS_WINDOW = 'Undo is confirmed in Wheelhouse\'s own window, not by a click in the chat: show the director the card there';

// Undoes `merge`, a merge on the main version, with a new commit that reverses it: nothing is deleted and later
// work stays. Undo is a runbook step (ruling P5-50): it needs the signed record of the director's click on Undo in
// the helper's window naming `merge`, and it carries on under STOP. Without that record the helper raises the card
// for the window once, and the refusal names it with `needs: 'window'`. With `moved: true` in place of `merge`, it
// undoes what the main version gained outside the helper (ruling P5-27 f: Undo it), on the window's signed record
// of Undo it naming the move as it stands; only the main line's own commits are reverted (a merge with `-m 1`, never
// the commits it brought in again). The record of the undo is signed. Gives { undo, copy }.
export async function undoMerge({ project, merge, moved = false, now = () => new Date(), run = realRun, record, lockWaitMs = LOCK_WAIT_MS } = {}) {
  if (!moved && (typeof merge !== 'string' || !FULL_COMMIT.test(merge))) refuse('The merge to undo must be written in full');
  const write = recorderFor(record, { run, now });
  return withLocalLock(project, async () => {
    const lean = adopted(project);
    const store = gitAt(storeDir(project), { run });
    let commits;
    let data;
    let current;
    let click;
    if (moved) {
      const main = await lookAtMain(project, lean, { run, record: write });
      ({ current } = main);
      if (!main.moved) refuse('The main version is where the helper last moved it, so there is nothing to undo');
      click = windowClick(project, 'undo-main', (d) => d.from === main.recorded && d.to === current);
      if (click === null) refuse(UNDO_NEEDS_WINDOW, { needs: 'window', card: main.card });
      if (!(await store.ok(['merge-base', '--is-ancestor', main.recorded, current]))) refuse('The main version\'s history was rewritten, not added to, so it can\'t be undone here: look into it');
      commits = (await store.must(['rev-list', '--first-parent', `${main.recorded}..${current}`], 'The changes to undo could not be read')).split('\n').filter(Boolean);
      data = { lean: 'undo', moved: true, from: main.recorded, to: current };
    } else {
      const main = await lookAtMain(project, lean, { run, record: write });
      if (main.moved) refuse(MAIN_MOVED, { card: main.card });
      ({ current } = main);
      const parents = await store.call(['rev-list', '--parents', '-n', '1', merge]);
      if (parents.code !== 0 || parents.stdout.trim().split(' ').length !== 3) refuse('That commit is not a merge, so there is nothing to undo with it');
      if (!(await store.ok(['merge-base', '--is-ancestor', merge, MAIN]))) refuse('That merge is not in the main version');
      click = windowClick(project, 'undo-merge', (d) => d.merge === merge);
      if (click === null) {
        refuse(UNDO_NEEDS_WINDOW, { needs: 'window', card: await raiseCard(project, undoCard(merge), write) });
      }
      commits = [merge];
      data = { lean: 'undo', merge };
    }
    await mainCheckedOutNowhere(project, run);
    const undo = await revertIn(project, lean, { run, now, at: current, commits });
    await moveMain(project, run, undo, current);
    await write(project, 'note', {
      ...data,
      commit: undo,
      proof: 'window',
      click: click.id,
      text: moved ? 'The changes made to the main version without an approval were undone, on the director\'s click in Wheelhouse\'s window.' : 'A merge was undone with a new commit, on the director\'s click in Wheelhouse\'s window; later work stays.',
    }, { signed: true });
    const copy = await updateCopy(project, { run, now, record: write });
    return { undo, copy };
  }, { waitMs: lockWaitMs, now });
}

// Keeps the main version as it was moved outside the helper (ruling P5-27 f: Keep it), after the director's click
// in the helper's window: the record's main version becomes `to`, only while the record still says `from` and the
// store `to`. Gives true when it did.
export async function keepMain({ project, from, to, run = realRun, now = () => new Date(), lockWaitMs = LOCK_WAIT_MS } = {}) {
  return withLocalLock(project, async () => {
    const lean = adopted(project);
    if (lean.main !== from || (await storeMain(project, run)) !== to) return false;
    updateLean(project, { main: to });
    return true;
  }, { waitMs: lockWaitMs, now });
}

// --- the copy ---

const COPY_WHAT = 'the Lean project\'s copy folder';

// Brings the copy folder up to the store's main version and the state's branch, as `main` and `wheelhouse-state`
// (ruling P5-24), never with force. The copy fetches them, in a git run in the copy through safeGit, naming the store
// and the state repository by their paths (ruling P5-50): nothing is pushed into the copy, so its receive hooks never
// run, the fence's hooks setting covers the one process that writes its refs, and the look reads the copy's own
// settings first. No remote's name is read, so no push or fetch setting anywhere is followed. A copy that can't take
// it is recorded and the work carries on. Gives { pushed, commit, refused? } (`pushed`: the copy holds them now).
async function updateCopy(project, { run, now, record }) {
  const lean = readLean(project);
  if (lean?.copy === null || lean?.copy === undefined) return { pushed: false, refused: NO_COPY };
  if (!path.isAbsolute(lean.copy)) return { pushed: false, refused: 'The copy folder is not a full path' };
  const commit = await storeMain(project, run);
  let pushed = false;
  if (fs.existsSync(lean.copy)) {
    await leanState(project, { run });
    const copy = gitAt(lean.copy, { run, reach: 'local', what: COPY_WHAT });
    // The copy folder must be a repository itself (a bare one, or one with its own .git): git looks upwards from a
    // folder that isn't one, and the fetch would land in whatever repository holds it.
    const own = async () => {
      const got = await copy.call(['rev-parse', '--absolute-git-dir']);
      const dir = got.code === 0 ? realOrNull(String(got.stdout ?? '').trim()) : null;
      return dir !== null && [realOrNull(lean.copy), realOrNull(path.join(lean.copy, '.git'))].includes(dir);
    };
    const fetch = (from, ref) => copy.ok(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', from, `${ref}:${ref}`]);
    try {
      pushed = (await own()) && (await fetch(storeDir(project), MAIN)) && (await fetch(stateDir(project), `refs/heads/${STATE_BRANCH}`));
    } catch {
      pushed = false;
    }
  }
  await record(project, 'note', {
    lean: 'copy',
    choice: pushed ? 'pushed' : 'failed',
    commit,
    text: pushed ? `The copy was updated to ${commit.slice(0, 12)}.` : `The copy was not updated at ${commit.slice(0, 12)}: the folder wasn't there or couldn't take it. The next copy brings everything.`,
  });
  return pushed ? { pushed: true, commit } : { pushed: false, commit, refused: 'The copy folder wasn\'t there or couldn\'t take the update; the next copy brings everything' };
}

// Updates the copy now, on its own (the Lean command's `copy`). Refused under STOP, and while the main version has
// moved outside the helper (ruling P5-27 f), so an unapproved main version never reaches the copy.
export async function copyNow({ project, now = () => new Date(), run = realRun, record, lockWaitMs = LOCK_WAIT_MS } = {}) {
  const write = recorderFor(record, { run, now });
  return withLocalLock(project, async () => {
    const lean = adopted(project);
    if (stopState().on) refuse(STOPPED);
    const main = await lookAtMain(project, lean, { run, record: write });
    if (main.moved) refuse(MAIN_MOVED, { card: main.card });
    return updateCopy(project, { run, now, record: write });
  }, { waitMs: lockWaitMs, now });
}

// --- how the store stands ---

// Where the project's store stands, for the Lean command's `status` and the session start: whether it is adopted,
// the main version, whether it moved outside the helper (raising the card once when it did), STOP, the copy
// folder, the test command and whether the project has real users.
export async function leanStatus({ project, run = realRun, now = () => new Date(), record } = {}) {
  const lean = readLean(project);
  if (lean === null) refuse('This project is not registered as a Lean project');
  const write = recorderFor(record, { run, now });
  const common = { stop: stopState().on, copy: lean.copy, test: lean.test, realUsers: lean.realUsers === true };
  if (lean.store === null || lean.main === undefined || lean.main === null || !fs.existsSync(storeDir(project))) return { adopted: false, ...common };
  const main = await lookAtMain(project, lean, { run, record: write });
  return { adopted: true, main: main.current, moved: main.moved, ...(main.moved ? { recorded: main.recorded, card: main.card } : {}), ...common };
}
