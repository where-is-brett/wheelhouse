// scripts/host/local/folder.js
// The project's folder beside its home (spec 5.3, 5.4). The folder is the director's and keeps working as it did: it gains
// one remote, a path to the engine's mirror, which Archon needs (A10). A person, or an agent, can still commit there, and
// nothing reaches the home by itself: at each dispatcher tick the folder's default branch is compared with the home's. The
// home ahead brings the folder up, fast-forward only. Anything the folder holds that the home doesn't raises one card for
// each tip, and enters the home only through a local change.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { CHECK_AND_ADD, LEAVE_THEM_OUT } from '../../state/card-lines.js';
import { withOwnSection } from '../../lib/compact-section.js';
import { onlyPinEdit } from '../../lineage/release.js';
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
  let letGo = null;
  if (!(await folderFree({ folder, branch, git }))) {
    letGo = await editsAlreadyIn({ folder, branch, home, git });
    if (letGo === null) return { line: OWN_CHANGES_LINE };
    if (letGo.failed !== undefined) return { line: letGo.failed ? withStash(OWN_CHANGES_LINE) : OWN_CHANGES_LINE };
  }
  const here = inFolder(folder, git);
  if (await here.ok(['merge', '--ff-only', '--no-overwrite-ignore', '--quiet', home])) {
    if (letGo !== null) await forget(here, letGo.snapshot);
    return { moved: true };
  }
  if (letGo === null) return { line: OWN_CHANGES_LINE };
  // The merge refused (a file changed after it was staged, or something else in the way): the index goes back as it was. The
  // working files were never touched, so any save made meanwhile stands.
  return { line: (await putBack(here, letGo)) ? NOT_BROUGHT_LINE : withStash(NOT_BROUGHT_LINE) };
}

const withStash = (words) => `${words} Your edits are kept in the folder's stash, under "${SNAPSHOT_MESSAGE}".`;

// Puts the index entries of `letGo` back as they were, and drops its snapshot once nothing is lost without it.
async function putBack(here, letGo) {
  let back = true;
  for (const file of letGo.files) {
    const was = letGo.original[file];
    const done = was === null
      ? await here.ok(['--literal-pathspecs', 'update-index', '--force-remove', '--', file])
      : await here.ok(['--literal-pathspecs', 'update-index', '--add', '--cacheinfo', `${was.mode},${was.sha},${file}`]);
    back = back && done;
  }
  if (back) await forget(here, letGo.snapshot);
  return back;
}

// Drops the stash entry that is `snapshot`.
async function forget(here, snapshot) {
  const list = await here.call(['stash', 'list', '--format=%H %gd']);
  const row = String(list.stdout).split('\n').map((l) => l.split(' ')).find(([sha]) => sha === snapshot);
  if (row?.[1]) await here.call(['stash', 'drop', '--quiet', row[1]]);
}

export const NOT_BROUGHT_LINE = 'The newest version could not be brought in, so your folder was put back as it was.';
const SNAPSHOT_MESSAGE = 'Wheelhouse: edits already in the main version';
const MODE_EXEC = '100755';

// The blob and mode a line of `ls-tree` or `ls-files -s` names, or null when git gives none.
const entryOf = (out) => {
  const m = /^(\d+) (?:blob )?([0-9a-f]{40,64})(?: \d)?\t/.exec(String(out).split('\n')[0]);
  return m === null ? null : { mode: m[1], sha: m[2] };
};

// Whether everything the folder holds uncommitted is already in the home's main version `home`, file for file with the same
// content and mode, and so is let go. Gives null when something is not, leaving everything as it is. Otherwise a snapshot of
// the folder's changes is made and kept in its stash (so a save made in the moment after the check can still be got back),
// every file is checked again as the snapshot holds it, and those files go back to the folder's commit; the commit that
// is the snapshot is given. Only tracked files the folder's commit holds, on `branch`, each with an index entry that is the
// folder's commit's or the home's, and no merge in progress.
async function editsAlreadyIn({ folder, branch, home, git }) {
  const here = inFolder(folder, git);
  const on = await here.call(['symbolic-ref', '-q', 'HEAD']);
  if (on.code !== 0 || String(on.stdout).trim() !== `refs/heads/${branch}`) return null;
  const changed = await here.call(['--no-optional-locks', 'diff', '--name-only', '--no-renames', '-z', 'HEAD']);
  if (changed.code !== 0) return null;
  const files = String(changed.stdout).split('\0').filter(Boolean);
  if (files.length === 0) return null;
  const unmerged = await here.call(['--no-optional-locks', 'diff', '--name-only', '--diff-filter=U']);
  if (unmerged.code !== 0 || String(unmerged.stdout).trim() !== '') return null;
  const original = {};
  for (const file of files) {
    const head = entryOf((await here.call(['--literal-pathspecs', 'ls-tree', 'HEAD', '--', file])).stdout);
    if (head === null) return null;
    const theirs = entryOf((await here.call(['--literal-pathspecs', 'ls-tree', home, '--', file])).stdout);
    const staged = entryOf((await here.call(['--literal-pathspecs', 'ls-files', '-s', '--', file])).stdout);
    original[file] = staged;
    if (staged !== null && staged.sha !== head.sha && staged.sha !== theirs?.sha) return null;
    if (staged === null && theirs !== null) return null;
    const full = path.join(folder, file);
    let ours = null;
    let exec = false;
    try {
      const seen = fs.lstatSync(full);
      if (!seen.isFile()) return null;
      exec = (seen.mode & 0o111) !== 0;
      const hashed = await here.call(['hash-object', '--', file]);
      if (hashed.code !== 0) return null;
      ours = String(hashed.stdout).trim();
    } catch (error) {
      if (error?.code !== 'ENOENT') return null;
    }
    if (ours !== (theirs?.sha ?? null)) return null;
    if (theirs !== null && (theirs.mode === MODE_EXEC) !== exec) return null;
    if (theirs !== null && theirs.mode !== '100644' && theirs.mode !== MODE_EXEC) return null;
  }
  const { identityOf } = await import('./merge.js');
  const making = git(folder, { reach: 'local', what: FOLDER_WHAT, env: await identityOf(folder, git) });
  const made = await making.call(['stash', 'create', SNAPSHOT_MESSAGE]);
  const snapshot = String(made.stdout).trim();
  if (made.code !== 0 || snapshot === '') return null;
  // What the snapshot holds is what is checked again, so a save in the gap is either in it or after it.
  for (const file of files) {
    const theirs = await here.call(['rev-parse', '-q', '--verify', `${home}:${file}`]);
    const kept = await here.call(['rev-parse', '-q', '--verify', `${snapshot}:${file}`]);
    if ((theirs.code === 0 ? String(theirs.stdout).trim() : null) !== (kept.code === 0 ? String(kept.stdout).trim() : null)) return null;
  }
  if (!(await making.ok(['stash', 'store', '-m', SNAPSHOT_MESSAGE, snapshot]))) return null;
  // The files are staged, not checked out: git takes an index entry that already is the target's, and its own check refuses the
  // merge where a working file changed after staging, so a save made now is not overwritten.
  const taken = { snapshot, files, original };
  const staging = await here.ok(['--literal-pathspecs', 'add', '-A', '--', ...files]);
  for (const file of files) {
    const theirs = entryOf((await here.call(['--literal-pathspecs', 'ls-tree', home, '--', file])).stdout);
    const now = entryOf((await here.call(['--literal-pathspecs', 'ls-files', '-s', '--', file])).stdout);
    if (!staging || now?.sha !== theirs?.sha || now?.mode !== theirs?.mode) {
      return { ...taken, failed: !(await putBack(here, taken)) };
    }
  }
  return taken;
}

export const NOT_ON_MAIN_LINE = 'Your folder is on another branch, so the newest version waits.';
export const SETTINGS_CHANGED_LINE = 'Your folder has changes of its own to the project\'s Wheelhouse settings, so the update waits. Commit them or set them aside.';

// Whether the folder can take a change to `file` without touching anything of the director's: it is on `branch`, and `file` has
// no change of its own, staged, unstaged or untracked. Gives null when it can, else the line saying why not.
export async function folderTakes({ folder, branch, file, git = gitRoute() }) {
  const here = inFolder(folder, git);
  const on = await here.call(['symbolic-ref', '-q', 'HEAD']);
  if (on.code !== 0 || String(on.stdout).trim() !== `refs/heads/${branch}`) return NOT_ON_MAIN_LINE;
  const changed = await here.call(['--literal-pathspecs', '--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--', file]);
  return changed.code === 0 && String(changed.stdout).trim() === '' ? null : SETTINGS_CHANGED_LINE;
}

// Like bringFolderUp, for a change that touches one file the folder holds no change of (folderTakes): the director's other
// uncommitted files stay as they are. A fast-forward touches only the files the change touches, and git refuses it, leaving
// everything as it was, where one of those holds a change of its own. Gives { moved } or { line }.
export async function bringFolderUpBesideOwn({ project, folder, branch, file, git = gitRoute(), from = null }) {
  const why = await folderTakes({ folder, branch, file, git });
  if (why !== null) return { line: why };
  const { state, home } = await reading({ project, folder, branch, git, from });
  if (state !== 'home-ahead') return { moved: false, state };
  return (await inFolder(folder, git).ok(['merge', '--ff-only', '--no-overwrite-ignore', '--quiet', home])) ? { moved: true } : { line: OWN_CHANGES_LINE };
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

const MANAGED_FILE = 'CLAUDE.md';
const PINNED_FILE = '.claude/settings.json';
const sameLines = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

// Whether the folder's difference from `base` (a commit) is only what Wheelhouse itself writes, and nothing else: the managed
// section of CLAUDE.md as the installed release writes it, and the release pins in .claude/settings.json (Wheelhouse's
// marketplace `ref` and `autoUpdate`, an update's leftover when its change did not land; onlyPinEdit). At least one of the two,
// no other file. `tip` is the folder's commit, or null for its working tree. A hand edit in or beside either makes the text
// differ, so it is not Wheelhouse's own.
async function onlyOwnSection({ folder, base, tip, git }) {
  const here = inFolder(folder, git);
  const names = tip === null
    ? await here.call(['--no-optional-locks', 'diff', '--name-only', base])
    : await here.call(['diff', '--name-only', base, tip]);
  if (names.code !== 0) return false;
  const changed = String(names.stdout).split('\n').map((n) => n.trim()).filter(Boolean);
  if (changed.length === 0 || changed.some((n) => n !== MANAGED_FILE && n !== PINNED_FILE)) return false;
  const textNow = async (file) => {
    if (tip === null) {
      try {
        return fs.readFileSync(path.join(folder, file), 'utf8');
      } catch {
        return null;
      }
    }
    const shown = await here.call(['show', `${tip}:${file}`]);
    return shown.code === 0 ? String(shown.stdout) : null;
  };
  for (const file of changed) {
    const was = await here.call(['show', `${base}:${file}`]);
    if (was.code !== 0) return false;
    const now = await textNow(file);
    if (now === null) return false;
    if (file === MANAGED_FILE) {
      const wanted = withOwnSection(String(was.stdout));
      if (wanted === String(was.stdout) || !sameLines(now, wanted)) return false;
    } else if (!onlyPinEdit(String(was.stdout), now)) {
      return false;
    }
  }
  return true;
}

// The folder's CLAUDE.md, left changed in the working tree by a refresh of Wheelhouse's own section, committed as that
// alone so it reaches the main version by the route any folder commit takes. Anything else the folder holds is left.
async function commitOwnSection({ folder, branch, git }) {
  const here = inFolder(folder, git);
  const on = await here.call(['symbolic-ref', '-q', 'HEAD']);
  if (on.code !== 0 || String(on.stdout).trim() !== `refs/heads/${branch}`) return false;
  const dirty = await here.call(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no']);
  if (dirty.code !== 0 || String(dirty.stdout).trimEnd() !== ` M ${MANAGED_FILE}`) return false;
  if (!(await onlyOwnSection({ folder, base: 'HEAD', tip: null, git }))) return false;
  const { identityOf } = await import('./merge.js');
  const env = await identityOf(folder, git);
  const making = git(folder, { reach: 'local', what: FOLDER_WHAT, env });
  return making.ok(['commit', '--quiet', '--only', '--no-verify', '--no-gpg-sign', '-m', 'Update Wheelhouse\'s section of CLAUDE.md', '--', MANAGED_FILE]);
}

// The card for work the folder holds and the home doesn't (spec 5.4). `more`: an earlier change made by hand is still open,
// so these are further changes on top of it, and the card says so.
// `earlier` says what became of them: 'open' (`more`) while they are still being checked, 'done' when they no longer are.
export function handMadeCard({ more = false, earlier = more ? 'open' : null } = {}) {
  more = earlier !== null;
  return {
    work: HAND_MADE_WORK,
    level: 3,
    what: earlier === 'open'
      ? 'More changes were made by hand in your project folder, while the earlier ones are still being checked. These aren\'t part of the main version yet.'
      : earlier === 'done'
        ? 'More changes were made by hand in your project folder. The earlier ones are no longer being checked. These aren\'t part of the main version yet.'
        : 'Changes were made by hand in your project folder. They aren\'t part of the main version yet.',
    why: 'Nothing joins the main version without a review, and whether these should join it is yours to decide, at level 3.',
    options: [
      { label: CHECK_AND_ADD, says: more ? 'They go through the same review and checks as the earlier ones, as a change of their own, and join the main version if they pass.' : 'They go through the same review and checks as any other work, and join the main version if they pass.' },
      { label: LEAVE_THEM_OUT, says: 'They stay in your folder as they are, and you won\'t be asked about them again.' },
    ],
    recommendation: CHECK_AND_ADD,
  };
}

// What the folder's working tree holds that no commit does (tracked files only, as folderFree reads them), as a short
// fingerprint of the difference from HEAD, or null when it holds nothing, is off `branch`, or is only Wheelhouse's own section.
async function uncommittedEdit({ folder, branch, git }) {
  const here = inFolder(folder, git);
  const on = await here.call(['symbolic-ref', '-q', 'HEAD']);
  if (on.code !== 0 || String(on.stdout).trim() !== `refs/heads/${branch}`) return null;
  const dirty = await here.call(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no']);
  if (dirty.code !== 0 || String(dirty.stdout).trim() === '') return null;
  if (await onlyOwnSection({ folder, base: 'HEAD', tip: null, git })) return null;
  const diff = await here.call(['--no-optional-locks', 'diff', 'HEAD']);
  if (diff.code !== 0) return null;
  return crypto.createHash('sha256').update(String(diff.stdout)).digest('hex').slice(0, 16);
}

// The working tree's tracked changes as a commit on top of HEAD, made without touching the index, the working tree or any
// branch, so the changes can go the way a committed one does. Null when there is nothing to commit.
async function commitUncommitted({ folder, git }) {
  const { identityOf } = await import('./merge.js');
  const making = git(folder, { reach: 'local', what: FOLDER_WHAT, env: await identityOf(folder, git) });
  const saved = String(await making.must(['stash', 'create'], 'The changes made by hand could not be read')).trim();
  if (saved === '') return null;
  const head = String(await making.must(['rev-parse', '--verify', 'HEAD^{commit}'], 'The changes made by hand could not be read')).trim();
  return String(await making.must(['commit-tree', '--no-gpg-sign', `${saved}^{tree}`, '-p', head, '-m', 'Changes made by hand'], 'The changes made by hand could not be set aside')).trim();
}

// Which of the earlier changes made by hand is the case now: 'open' while one is still being checked, 'done' when one was added
// and no longer is, else null.
async function earlierOf(kept, inFlight) {
  if (await inFlight().catch(() => false)) return 'open';
  return Object.values(kept.tips).some((e) => e.added === true) ? 'done' : null;
}

const readKept = (file) => {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { said: kept?.said ?? null, failed: kept?.failed ?? null, cards: Number.isInteger(kept?.cards) ? kept.cards : 0, tips: kept?.tips ?? {}, seen: kept?.seen ?? null };
  } catch {
    return { said: null, failed: null, cards: 0, tips: {}, seen: null };
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
// `note(words)` writes to the Logbook, and `add(tip, { parted })` opens the local change, { ok } or { refused }, and `inFlight()` says whether an earlier change made by hand is still open.
export function folderWatch({ project, folder, branchOf, git = gitRoute(), file, card, answerOf, note, add, inFlight = async () => false, stopped = () => false }) {
  async function answers(found, kept) {
    for (const [tip, entry] of Object.entries(kept.tips)) {
      if (entry.own === true) {
        // Wheelhouse's own section: it goes by the same route as work the director chose to add, with no question.
        if (entry.done) continue;
        const waiting = found.state === 'folder-ahead' || found.state === 'parted';
        const got = waiting && found.tip === tip ? await add(tip, { parted: found.state === 'parted' }) : { ok: true };
        if (got?.ok === true) entry.done = true;
        else if (kept.failed !== tip) {
          kept.failed = tip;
          await note(`Wheelhouse's own change to CLAUDE.md couldn't be added yet: ${got?.refused ?? 'the helper didn\'t say why'}`);
        }
        continue;
      }
      const label = entry.done ? null : answerOf(entry.id);
      if (label === LEAVE_THEM_OUT) entry.done = true;
      if (label !== CHECK_AND_ADD) continue;
      if (entry.edit === true) {
        // An edit not yet committed: it goes as a commit of its own, while the folder still holds exactly that edit.
        if (found.state !== 'same' || (await uncommittedEdit({ folder, branch: await branchOf(), git })) !== tip) {
          entry.done = true;
          continue;
        }
        const made = await commitUncommitted({ folder, git });
        const got = made === null ? { ok: true } : await add(made, { parted: false, question: entry.id });
        if (got?.ok === true) {
          entry.done = true;
          if (made !== null) entry.added = true;
        } else if (kept.failed !== tip) {
          kept.failed = tip;
          await note(`The changes made by hand couldn't be added yet: ${got?.refused ?? 'the helper didn\'t say why'}`);
        }
        continue;
      }
      // Anything the folder holds now goes, and an older card's press means the same thing.
      const waiting = found.state === 'folder-ahead' || found.state === 'parted';
      const got = waiting ? await add(found.tip, { parted: found.state === 'parted', question: entry.id }) : { ok: true };
      if (got?.ok === true) {
        entry.done = true;
        if (waiting) entry.added = true;
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
    let found = await reading({ project, folder, branch, git });
    if ((found.state === 'same' || found.state === 'folder-ahead') && await commitOwnSection({ folder, branch, git })) {
      found = await reading({ project, folder, branch, git });
    }
    const kept = readKept(file);
    await answers(found, kept);
    if (found.state === 'home-ahead') {
      const got = await bringFolderUp({ project, folder, branch, git });
      if (got.line !== undefined && kept.said !== found.home) {
        await note(got.line);
        kept.said = found.home;
      }
    } else if ((found.state === 'folder-ahead' || found.state === 'parted') && kept.tips[found.tip] === undefined) {
      const base = found.state === 'parted'
        ? String((await inFolder(folder, git).call(['merge-base', found.home, found.tip])).stdout).trim()
        : found.home;
      if (base !== '' && await onlyOwnSection({ folder, base, tip: found.tip, git })) {
        kept.tips[found.tip] = { id: null, done: false, own: true };
        await answers(found, kept);
        keep(file, kept);
        return;
      }
      kept.cards += 1;
      const id = `q-${HAND_MADE_WORK}-${kept.cards}`;
      await card({ id, ...handMadeCard({ earlier: await earlierOf(kept, inFlight) }) });
      kept.tips[found.tip] = { id, done: false };
    } else if (found.state === 'same') {
      // A tracked file edited by hand and not committed: the same question, once the edit has stood for two ticks (a write
      // of Wheelhouse's own is gone by then). Its key is the edit itself, so a further edit is a new question.
      const edit = await uncommittedEdit({ folder, branch, git });
      if (edit === null) kept.seen = null;
      else if (kept.tips[edit] === undefined) {
        if (kept.seen !== edit) kept.seen = edit;
        else {
          kept.cards += 1;
          const id = `q-${HAND_MADE_WORK}-${kept.cards}`;
          await card({ id, ...handMadeCard({ earlier: await earlierOf(kept, inFlight) }) });
          kept.tips[edit] = { id, done: false, edit: true };
        }
      }
    }
    keep(file, kept);
  }

  return { tick };
}
