// scripts/host/local/folder.js
// The project's folder beside its home (spec 5.3, 5.4). The folder is the director's and keeps working as it did: it gains
// one remote, a path to the engine's mirror, which Archon needs (A10). A person, or an agent, can still commit there, and
// nothing reaches the home by itself: at each dispatcher tick the folder's default branch is compared with the home's. The
// home ahead brings the folder up, fast-forward only. Anything the folder holds that the home doesn't raises one card for
// each tip, and enters the home only through a local change.
import fs from 'node:fs';
import path from 'node:path';
import { CHECK_AND_ADD, LEAVE_THEM_OUT } from '../../state/card-lines.js';
import { gitRoute, homeDir, homeGit, isBranchName } from './home.js';

export const FOLDER_REMOTE = 'wheelhouse';
export const HAND_MADE_WORK = 'by-hand';
const KEPT_LINES = 'wheelhouse-home';
export const OWN_CHANGES_LINE = 'Your folder has changes of its own, so the newest version waits.';

const FOLDER_WHAT = 'the project\'s folder';
const tracking = (branch, remote = FOLDER_REMOTE) => `refs/remotes/${remote}/${branch}`;
const inFolder = (folder, git) => git(folder, { reach: 'local', what: FOLDER_WHAT });

// Gives the folder its one remote: a plain path to the engine's mirror, so Archon reads the mirror and never the home. A
// remote of that name pointing anywhere else is the director's own, and is left as it is.
export async function addFolderRemote({ folder, mirror, git = gitRoute() }) {
  const here = inFolder(folder, git);
  const named = await here.call(['config', '--get', `remote.${FOLDER_REMOTE}.url`]);
  if (named.code === 0 && String(named.stdout).trim() !== mirror) {
    throw new Error(`This folder has its own setting named ${FOLDER_REMOTE}, pointing somewhere else, so it was left as it is`);
  }
  await here.must(['config', `remote.${FOLDER_REMOTE}.url`, mirror], 'The folder could not be set up for the build engine');
  await here.must(['config', '--replace-all', `remote.${FOLDER_REMOTE}.fetch`, `+refs/heads/*:refs/remotes/${FOLDER_REMOTE}/*`], 'The folder could not be set up for the build engine');
}

// Fetches the home's main version into the folder's tracking ref and compares. The fetch names the home by its path, so no
// remote's setting is followed, and it is also what `archon complete` reads a merge from (check 83). `from` is another
// repository of Wheelhouse's to read in the home's place, with the remote the folder knows it by: a hosted project's mirror.
async function reading({ project, folder, branch, git, from = null }) {
  if (!isBranchName(branch)) throw new Error('That branch\'s name can\'t be used for the main version');
  const here = inFolder(folder, git);
  const source = from === null ? homeGit(project, git) : git(from.dir, { list: 'own', what: 'the mirror' });
  const home = await source.must(['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`], 'The main version could not be read');
  await here.must(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', from?.dir ?? homeDir(project), `+refs/heads/${branch}:${tracking(branch, from?.remote)}`], 'The folder could not be brought the newest version');
  const held = await here.call(['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`]);
  if (held.code !== 0) return { state: 'home-ahead', tip: null, home };
  const tip = String(held.stdout).trim();
  if (tip === home) return { state: 'same', tip, home };
  const within = async (a, b) => {
    const { code } = await here.call(['merge-base', '--is-ancestor', a, b]);
    if (code > 1) throw new Error('The folder\'s history could not be read');
    return code === 0;
  };
  if (await within(home, tip)) return { state: 'folder-ahead', tip, home };
  return { state: (await within(tip, home)) ? 'home-ahead' : 'parted', tip, home };
}

// compareFolder -> 'same' | 'home-ahead' | 'folder-ahead' | 'parted'.
export async function compareFolder(args) {
  return (await reading({ git: gitRoute(), ...args })).state;
}

// Whether the folder is on `branch` with nothing uncommitted, so its main line can move.
export async function folderFree({ folder, branch, git = gitRoute() }) {
  const here = inFolder(folder, git);
  const on = await here.call(['symbolic-ref', '-q', 'HEAD']);
  if (on.code !== 0 || String(on.stdout).trim() !== `refs/heads/${branch}`) return false;
  const dirty = await here.call(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no']);
  return dirty.code === 0 && String(dirty.stdout).trim() === '';
}

// Brings the folder up to the home's main version, fast-forward only: { moved } says whether it moved, or { line } why it
// waits. Only a folder on that branch with nothing uncommitted. A file git doesn't track holds nothing up, and one in the
// way makes the merge refuse, ignored or not.
export async function bringFolderUp({ project, folder, branch, git = gitRoute(), from = null }) {
  const { state, home } = await reading({ project, folder, branch, git, from });
  if (state !== 'home-ahead') return { moved: false, state };
  if (!(await folderFree({ folder, branch, git }))) return { line: OWN_CHANGES_LINE };
  const here = inFolder(folder, git);
  return (await here.ok(['merge', '--ff-only', '--no-overwrite-ignore', '--quiet', home])) ? { moved: true } : { line: OWN_CHANGES_LINE };
}

// Uninstall's: gives the folder all the home holds, so the folder's git is a full copy once the home has gone. The main line
// comes by bringFolderUp, or by a merge where the two parted. { line } says why it waits, and { kept } names the line that
// holds the home's main version where the merge clashed. A line the folder has no copy of comes as itself, and one that
// differs comes under KEPT_LINES, so nothing of the folder's moves. Wheelhouse's own lines stay behind.
export async function takeHome({ project, folder, branch, env = {}, git = gitRoute() }) {
  const up = await bringFolderUp({ project, folder, branch, git });
  if (up.line !== undefined) return up;
  const here = inFolder(folder, git);
  const home = homeGit(project, git);
  const keepAs = (from, to) => here.must(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', homeDir(project), `+refs/heads/${from}:refs/heads/${to}`], 'The folder could not take a line from the home');
  let kept = null;
  if ((await reading({ project, folder, branch, git })).state === 'parted') {
    if (!(await folderFree({ folder, branch, git }))) return { line: OWN_CHANGES_LINE };
    const joining = git(folder, { reach: 'local', what: FOLDER_WHAT, env });
    if (!(await joining.ok(['merge', '--no-edit', '--no-verify', '--no-gpg-sign', '--no-overwrite-ignore', '--quiet', tracking(branch)]))) {
      await here.call(['merge', '--abort']);
      kept = `${KEPT_LINES}/${branch}`;
      await keepAs(branch, kept);
    }
  }
  const lines = (await home.must(['for-each-ref', '--format=%(refname:lstrip=2) %(objectname)', 'refs/heads'], 'The main version could not be read')).split('\n').filter(Boolean).map((l) => l.split(' '));
  for (const [name, tip] of lines) {
    if (name === branch || name.startsWith('wheelhouse/')) continue;
    const held = await here.call(['rev-parse', '--verify', '-q', `refs/heads/${name}^{commit}`]);
    if (held.code !== 0) await keepAs(name, name);
    else if (!(await here.ok(['merge-base', '--is-ancestor', tip, String(held.stdout).trim()]))) await keepAs(name, `${KEPT_LINES}/${name}`);
  }
  return { kept };
}

// The card for work the folder holds and the home doesn't (spec 5.4).
export function handMadeCard() {
  return {
    work: HAND_MADE_WORK,
    level: 3,
    what: 'Changes were made by hand in your project folder. They aren\'t part of the main version yet.',
    why: 'Nothing joins the main version without a review, and whether these should join it is yours to decide, at level 3.',
    options: [
      { label: CHECK_AND_ADD, says: 'They go through the same review and checks as any other work, and join the main version if they pass.' },
      { label: LEAVE_THEM_OUT, says: 'They stay in your folder as they are, and you won\'t be asked about them again.' },
      { label: 'Not now', says: 'Nothing changes, and the question stays open.' },
    ],
    recommendation: CHECK_AND_ADD,
  };
}

const readKept = (file) => {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { said: kept?.said ?? null, failed: kept?.failed ?? null, cards: Number.isInteger(kept?.cards) ? kept.cards : 0, tips: kept?.tips ?? {} };
  } catch {
    return { said: null, failed: null, cards: 0, tips: {} };
  }
};
function keep(file, kept) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const part = `${file}.${process.pid}`;
  fs.writeFileSync(part, `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(part, file);
}

// folderWatch({ project, folder, branchOf, git, file, card, answerOf, note, add, stopped }) -> { tick }. `branchOf()` gives the
// default branch, `file` keeps what has been asked and said, `card(data)` raises a question, `answerOf(id)` the label chosen,
// `note(words)` writes to the Logbook, and `add(tip, { parted })` opens the local change, { ok } or { refused }.
export function folderWatch({ project, folder, branchOf, git = gitRoute(), file, card, answerOf, note, add, stopped = () => false }) {
  async function answers(found, kept) {
    for (const [tip, entry] of Object.entries(kept.tips)) {
      const label = entry.done ? null : answerOf(entry.id);
      if (label === LEAVE_THEM_OUT) entry.done = true;
      if (label !== CHECK_AND_ADD) continue;
      // Anything the folder holds now goes, and an older card's press means the same thing.
      const waiting = found.state === 'folder-ahead' || found.state === 'parted';
      const got = waiting ? await add(found.tip, { parted: found.state === 'parted' }) : { ok: true };
      if (got?.ok === true) {
        entry.done = true;
        if (waiting && kept.tips[found.tip]) kept.tips[found.tip].done = true;
      } else if (kept.failed !== tip) {
        kept.failed = tip;
        await note(`The changes made by hand couldn't be added yet: ${got?.refused ?? 'the helper didn\'t say why'}`);
      }
    }
  }

  async function tick() {
    if (stopped()) return;
    const branch = await branchOf();
    const found = await reading({ project, folder, branch, git });
    const kept = readKept(file);
    await answers(found, kept);
    if (found.state === 'home-ahead') {
      const got = await bringFolderUp({ project, folder, branch, git });
      if (got.line !== undefined && kept.said !== found.home) {
        await note(got.line);
        kept.said = found.home;
      }
    } else if ((found.state === 'folder-ahead' || found.state === 'parted') && kept.tips[found.tip] === undefined) {
      kept.cards += 1;
      const id = `q-${HAND_MADE_WORK}-${kept.cards}`;
      await card({ id, ...handMadeCard() });
      kept.tips[found.tip] = { id, done: false };
    }
    keep(file, kept);
  }

  return { tick };
}
