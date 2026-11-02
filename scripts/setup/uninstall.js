// scripts/setup/uninstall.js
// What uninstall puts back, worked out without changing anything (Task 15, rulings R85 to R89).
// uninstallPlan reads setup's journal, the projects registered on this computer and the world as it
// stands, and gives the list uninstall's card names and its hash covers. The helper's routes
// (uninstallRoutes, below) show it and, after the card's own click (Task 15c), start applying it in
// its own process (scripts/setup/uninstall-run.js, applyUninstall).
//
// Which changes (R85). Every change the folder's runs recorded, not yet marked put back (the
// journal's putBack, so an uninstall cut short resumes and never reverses twice), grouped by
// (kind, target, key):
//   - `json-key` and `file`: each change of the group, newest first, put back by reverseChange, so
//     each retry's `before` (setup's own earlier `after`) chains back to the director's value. The
//     chain is walked on what the target holds now: a link whose `after` it holds is listed, one
//     whose `before` it holds is already put back (an uninstall cut short before its mark), and from
//     the first link it holds neither of, the rest is left and named (Review Focus 2);
//   - `folder` and `host`: the group once, with the earliest change's `before` and the latest's
//     `after`, since a retry records {}, { kept: true } or { origin: null } for what it found.
//
// Whose changes (R86). The project's own are always put back. This computer's are put back only by
// the uninstall of the last project on this computer (no other project registered, and no other
// folder with a setup run not closed, ruling R114), and then from every run in the journal, since
// an earlier project's uninstall left them: steps 2, 6 and 9 (but for what they wrote inside the
// project's folder, which is the project's); the app's keys and a v0.1.x profile's own GitLab key;
// the own app recorded in the director's settings on this computer; and, recorded nowhere, the
// trusted-keys list and the
// signing key beside it, removed last of all (ruling R123), after every change that can stop
// uninstall, so an uninstall cut short can still be clicked again. The list goes first (ruling
// R128): one that could not be removed leaves the key it trusts. Everything else of the last phase
// (this computer's id, the emptied folders) goes after the list and before the key, and from the
// list's removal on nothing stops uninstall but the run's own close: what can't be removed there is
// left and named (ruling R142). Wheelhouse's own folders and files (the tools it fetched, setup's
// clicks, answers and the like, the trust clicks and the record of the profile's enrolments last
// fetched, the Windows installer's temporary folder, and the project's own folder under projects/)
// are removed whole, never named as changed since setup. journal.json, and uninstall's own progress
// record, are kept.
//
// What stays without a card (design section 24.5): the director's settings on this computer
// (~/.wheelhouse/settings/), and what Wheelhouse v0.1.x made: its profile clone and profile.json, the
// profile repository and this computer's enrolment in it, and the project's state clone
// (projects/<project>/state/). Each is named as kept. The project's private record
// (projects/<project>/record/) stays too, unless the director picks Delete it on its own level 4
// card, recommended Keep: like a deleted transcript, it can't come back. The project's folder under
// projects/ is otherwise removed, the record and the old state clone left in it.
//
// The setup commit counts as on the host only when the journal or the folder shows it went up:
// step 7 finished, or recorded protection after the push, or the folder's copy of the
// branch on the host holds it, or uninstall's own look found it there (the push's onHost mark,
// ruling R122). Step 7 records the push before making it, so a push that failed leaves the files
// and pins to be put back here, and the commit named as kept in the folder.
//
// A shared project (ruling R124): this computer joined a project another set up, or it trusts
// another computer's key. Then the project and its committed files and the app's installation are
// other computers' too: the files stay as committed (no pull request), no Delete card is offered for
// what is on the host, and the app's installation is left as it is (no untick, no Uninstall). The
// private record is this computer's own, so its card is offered as on any project.
//
// The project's .wheelhouse/ folder (ruling R131): the front desk's and the foreman's files, which
// setup did not make, stay with the project, and uninstall never touches them. While the folder is
// there, step 7's line keeping it out of git (R108) stays too, and both are named on the card as
// kept; the folder's being there is read from the world, so its coming or going between the card
// and the click changes the list. Without the folder, the line is put back as setup's others are.
//
// The other agent setup's instructions, archived (plan rulings P5, P6): when the pull request is
// planned and the folder's copy of its branch (refs/remotes/origin/<branch>, as last fetched) holds
// .wheelhouse-archive/archived.json, the pull request also moves each file back to where it was, its
// text as the branch holds it, and takes the archive folder out (archiveAt, below). A move whose
// place is taken on the branch is left in the archive, and named; the archive's list is then
// written again with only what stays. A list that can't be read, or that names a path outside the
// project, a file that isn't another setup's instructions (OTHER_SETUP_PATHS), or a move from
// anywhere but `.wheelhouse-archive/<from>`, is refused whole: nothing is moved, and why is named.
// What is moved is in the pull request's entry (`archive`), so the hash covers it; the apply reads
// the archive again from the host and goes ahead only when it is the same. On a shared project the
// archive stays as it is, for the other computers.
//
// What each kind gives (R87): see the entries below. The order is binding (R89): Stop, Locked, the
// project's files (a pull request the director merges), this computer, keys, kept, last; newest
// first within a phase; then the trusted-keys list, this computer's id, the emptied folders, the
// signing key and the keys folder (R142); the helper stops last of all, after its answer.
//
//   Plan = {
//     project: string | null,  the registered project the folder is, or null
//     last: boolean,           no other project on this computer (ruling R114)
//     shared: boolean,         other computers use the project too (ruling R124)
//     changes: Entry[],        in the order they are applied
//     keep: Array<{ what, why, brief?, ids? }>,   left as they are; each changed since setup is
//                              named on the card, by `brief` where it is given
//     asks: Array<{ id, about, phase: 'kept', put, target, ids, card }>,   level 4 cards (a question's
//                              input), recommended Keep: the product's repository setup made, and
//                              the project's private record on this computer
//     done: Array<{ ids, why }>,   changes with nothing left to put back (put back already, closed
//                              by the health check, not made by setup), marked put true as they are
//     card,                    uninstall's own card input (kind 'uninstall', composed by Task 15c)
//     hash,                    SHA-256 of the list, which the card's set line names
//   }
//   Entry = { phase, put, ids?, ... }: `ids` are the journal's changes it deals with, marked straight
//     after it is done (markPutBack, all of an entry's ids in one write); an entry with none comes
//     from the world, not the journal. A kept item with `ids` is marked too, as left (put false, its
//     why), and an ask's ids once it is answered. Every recorded change but the answers is in one of
//     changes, keep, asks or done.
//     `put` is one of:
//       'stop' { what: engine | foreman | watcher | receiver | helper }
//       'leave-locked' { project }           leaveLocked, with the director's password
//       'pull-request' { target, branch, base, archive? }   the uninstall pull request, taking out
//                                            every 'in-pull-request' entry by its change's `before`;
//                                            its ids hold theirs too, so they are marked with it;
//                                            `archive`, what it puts back from the archive (ArchiveView)
//                                            For a project kept here (`local`), a last local change,
//                                            merged at once and into the folder
//       'in-pull-request' { change }         a project file or pin, taken out by that pull request
//       'bring-up' { branch }                a project kept here: the folder takes all the home holds
//       'remove-remote' { target, name, url }   the folder's remote, while it still has setup's address
//       'close-pull-request' { repo, number?, branch? }, 'delete-branch' { repo, branch, sha }
//       'reverse' { change }                 reverseChange, here (a pin with no pull request: its
//                                            key in the project's settings, as a json-key change)
//       'unset-env' { target, where }        only while it still holds what setup set
//       'put-back-own-app' { change }        own-app.js's putBackOwnApp
//       'delete-key' { key, shared? }        the keys deleted; for github-app, the installation's
//                                            page given, to uninstall the app there, unless shared
//       'untick-repository' { key, repo }    while another project stays, on a project not shared:
//                                            the installation's settings page given, to untick
//                                            this repository
//       'revoke-key' { key, pasted, line }   a GitLab key revoked through the API, then deleted
//       'remove' { target, except? }         a file, or a folder whole, of Wheelhouse's own; with
//                                            `except`, the folder but for those names in it, and
//                                            the folder itself only once nothing else is left
//       'remove-empty' { target }            a folder of Wheelhouse's own, only once it is empty
//       'remove-plugin' { line }             the line the director follows in Claude Desktop
//       'remove-plugin-scope' { change }     `claude plugin uninstall` of the plugin setup added at user scope
//       'remove-login-start' { kind, target } the sign-in start the helper's install made, while it holds
//                                            what was written (scripts/lib/login-start.js)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homeBranch, homeDir } from '../host/local/home.js';
import { run as realRun } from '../lib/run.js';
import {
  wheelhouseHome, jobFolder, jobsDir, keysDir, profileDir, oldProfileDir, projectsDir, stateDir, oldStateDir, computerId, engineDir, archonHome,
} from '../lib/paths.js';
import { projectForFolder, registeredProjects } from '../lib/projects.js';
import { LEAN_FOLDER, registeredLeanProjects } from '../lean/project.js';
import { loginStartRecord } from '../lib/login-start.js';
import { listHash } from '../lib/setup-writes.js';
import { joinedRepo, runClosed, HEALTH_STEP } from '../lib/setup-run.js';
import { clicksDir, usedDir, shownDir, askedDir, answersDir, answeredDir, recordsDir, writeWhole } from '../lib/setup-clicks.js';
import { HOST_TOOLS, toolFolder, toolsDir } from '../lib/host-tools.js';
import { enrolledFile, signingKeyFile, readEnrolled } from '../state/signing.js';
import { ownFilesFile } from '../health/own-files.js';
import { CLICK_FRESH_MS, RETENTION_DAYS, STEP_TIMEOUT_MS } from '../lib/setup-numbers.js';
import { canonicalJson } from '../lib/canonical.js';
import { cleanDeep } from '../lib/clean.js';
import { composeCard } from '../cards/compose.js';
import { readProfileViews } from '../profile/store.js';
import { readJournal, heldNow } from './journal.js';
import { launchVarState } from './telemetry.js';
import { PROFILE_TARGET, acceptedOwnApp } from './own-app.js';
import { SETUP_FILES, WHEELHOUSE_LINE, GITIGNORE, ENV_STAYS_LINES } from './project-files.js';
import { ENGINE_FILES } from './engine-parts.js';
import { noteAsked, noteUninstallShown, uninstallShownFor, freshUninstallClicks, useClick, releaseClick } from './clicks.js';
import { admitFolder, SetupRefusal } from './engine.js';
import { setupGit } from './git.js';
import { OTHER_SETUP_PATHS } from '../lib/agent-control.js';
import { readerFolderOf } from '../delegation/reader.js';
import { goalFolderOf } from '../engine/goal-folder.js';
import { matchGlob } from '../gate/glob.js';
import { toolsStatus } from './tools.js';

// The phases, in the order uninstall applies them (ruling R89).
export const PHASES = Object.freeze(['stop', 'locked', 'files', 'computer', 'keys', 'kept', 'last']);
// The steps whose changes are this computer's, not a project's (ruling R86).
const COMPUTER_STEPS = [2, 6, 9];
// The most the card's first part and the project's name (which its set line names again) may take
// together: with the other parts and the options, the card stays within the composer's limit
// (CARD.chars), with some room to spare; Task 15c's composition test holds the whole card to it.
export const WHAT_CHARS = 500;
// What the director does last, in Claude Desktop (its clicks are the playbook's, Task 16).
export const PLUGIN_LINE = 'Last, remove the Wheelhouse plugin from this project in Claude Desktop';
// Said on the card, as step 6's card says (ruling R64).
const TRANSCRIPTS = `Transcripts removed by the ${RETENTION_DAYS}-day retention can't come back.`;
// The level 4 cards' order: the product's repository, the build engine's run history, the project's private record.
const ASK_ORDER = ['product', 'engine', 'home', 'record'];
// The repository Wheelhouse v0.1.x kept the director's profile in, on their own account.
const OLD_PROFILE_REPO = 'wheelhouse-profile';
// Why what Wheelhouse v0.1.x made stays (design section 24.5): nothing of it goes without a card.
export const OLD_STAYS = 'Wheelhouse v0.1.x made it, and it stays as it is';
// The names in the project's folder under projects/ that its removal leaves: its private record,
// which goes only on its own card's Delete it, and v0.1.x's state clone.
// Kept in the project's folder when it is removed: the private record, v0.1.x's state clone, and the
// import's mark, so a record deleted on its card is never imported again from the old clone.
const RECORD_NAMES = ['record', 'state', 'imported.json'];
// What the retired Trust it card left on this computer (v0.1.x): its clicks, and the record of the
// profile's enrolments last fetched. Wheelhouse's own, removed on the last uninstall.
export const trustDir = () => path.join(wheelhouseHome(), 'trust');
export const seenFile = () => path.join(jobsDir(), 'enrolments.json');
export const HOSTS = { github: 'GitHub', gitlab: 'GitLab' };
export const REMOVE_REMOTE = 'remove-remote';
const KEEP_LABEL = 'Keep it';
// Why a commit setup made in the folder, never pushed, is kept: apply looks for it on the host first.
export const NEVER_PUSHED = 'it stays in this folder\'s history';
// Why what other computers use stays as it is, on a shared project (ruling R124).
const OTHERS_USE = 'your other computers use it, so it stays';
// Why step 7's .wheelhouse/ exclude line stays, and the project's .wheelhouse/ folder with it
// (ruling R131): uninstall never touches the files in that folder.
export const FOLDER_STAYS = 'it holds the First Mate\'s and the Bosun\'s files, which stay with the project';
// Why setup's .env lines stay, in the project's .gitignore and in a joining computer's own list: they
// keep secrets out of git and cost nothing, so uninstall never takes them out.
export const ENV_STAYS = 'they keep .env files, which hold secrets, out of git, and cost nothing, so they stay';
export const LINE_STAYS = 'the project\'s .wheelhouse/ folder stays, with the First Mate\'s and the Bosun\'s files, so this line keeps it out of git';
// The two, as the card names them, and in short when the card has no room for more.
export const FOLDER_NOTE = '.wheelhouse/ stays, out of git: the First Mate\'s and Bosun\'s files.';
export const FOLDER_NOTE_SHORT = '.wheelhouse/ stays, out of git.';
// Where the whole list is read.
const STATUS_FORM = 'cli.js uninstall status';
export const DELETE_LABEL = 'Delete it';

const caseBlind = process.platform === 'win32' || process.platform === 'darwin';
export const keyOf = (p) => (caseBlind ? p.toLowerCase() : p);
const resolved = (p) => keyOf(path.resolve(p));
export const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && resolved(a) === resolved(b);
export const within = (base, p) => {
  if (typeof p !== 'string') return false;
  const b = resolved(base);
  const t = resolved(p);
  return t === b || t.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
};
export function realOr(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}
const exists = (p) => fs.existsSync(p);
const profileFile = () => path.join(wheelhouseHome(), 'profile.json');
const projectFolder = (slug) => path.join(projectsDir(), slug);
// This computer's id (scripts/lib/paths.js, computerId), removed in the last phase of the last
// uninstall (R138), before the signing key (R142).
export const computerFile = () => path.join(wheelhouseHome(), 'computer.json');
const repoName = (repo) => (typeof repo === 'string' ? repo.split('/').at(-1) : null);
// A host target `<host>:<owner/name>` or `<host>:<owner/name>:<file>`.
export function hostTarget(target) {
  const m = /^(github|gitlab):([^:]+)(?::(.+))?$/.exec(target);
  return m ? { host: m[1], repo: m[2], file: m[3] ?? null } : null;
}

// Whether a change is this computer's, put back only with the last project (ruling R86). A change
// inside the run's own folder is the project's, whatever its step: step 2's allow rule for setup's
// command is written to the folder's own settings.local.json (ruling R43).
function computerWide(c, run) {
  if (typeof run?.folder === 'string' && path.isAbsolute(c.target) && within(realOr(run.folder), realOr(c.target))) return false;
  if (COMPUTER_STEPS.includes(c.step)) return true;
  if (c.kind === 'file') return samePath(c.target, profileFile());
  if (c.kind === 'folder') return samePath(c.target, oldProfileDir()) || within(path.join(wheelhouseHome(), 'tools'), c.target) || within(engineDir(), c.target);
  if (c.kind === 'plugin-scope') return true;
  if (c.kind !== 'host') return false;
  if (c.target === 'key github-app' || c.target === PROFILE_TARGET) return true;
  if (/^key gitlab-project-\d+$/.test(c.target)) return repoName(c.after?.project) === OLD_PROFILE_REPO;
  const h = hostTarget(c.target);
  return h !== null && (h.file === null ? repoName(h.repo) === OLD_PROFILE_REPO : h.file.startsWith('enrolments/'));
}

// A path for the card, with the home folder as ~.
export function shown(p, userHome) {
  return within(userHome, p) ? path.join('~', path.relative(userHome, p)) : p;
}

// What a change is, in a few words.
export function describe(c, userHome) {
  if (c.kind === 'json-key') return `${c.key.join('.')} in ${shown(c.target, userHome)}`;
  if (c.kind === 'env') return `${c.target}, a variable for your account`;
  if (c.kind === 'process' && c.after?.plugin) return `the pinned kit ${String(c.after.plugin).split('@')[0]}`;
  if (c.kind === 'process') return `${c.after?.tool ?? c.target}, installed by its installer`;
  return shown(c.target, userHome);
}

// What a change is, in a word or two, for the card: the key, the variable or the file's name.
function brief(c) {
  if (c.kind === 'json-key') return c.key.join('.');
  if (c.kind === 'env') return c.target;
  return path.basename(c.target);
}

// The newest change of a group (the list is oldest first), and the group as one change: the
// earliest `before` with the latest `after` (ruling R85).
const newest = (group) => group.at(-1).c;
const asOne = (group) => ({ ...newest(group), before: group[0].c.before });
const idsOf = (group) => group.map((e) => e.c.id);
const seqOf = (group) => group.at(-1).seq;
// A level 4 card's id: the same for the same thing on the host.
const askId = (target) => `uninstall-delete-${crypto.createHash('sha256').update(target).digest('hex').slice(0, 10)}`;

// The level 4 card for deleting something that can't come back, recommended Keep (ruling R92).
function deleteCard({ what, why, deletes, keeps, because }) {
  return {
    kind: 'question',
    // Answered in setup's own chat, where there is no front-desk turn to take a suggested change.
    suggest: false,
    level: 4,
    what,
    why,
    options: [{ label: KEEP_LABEL, says: keeps }, { label: DELETE_LABEL, says: deletes }],
    recommend: KEEP_LABEL,
    because,
    meanwhile: 'Uninstall goes on with the rest; this stays until you decide.',
    checks: 'Nothing: Wheelhouse\'s checks are being removed from this project either way.',
  };
}

// The card's first part, as texts from the fullest to the shortest: the groups with their counts,
// then each item left because it changed since setup while there is room (WHAT_CHARS), then how
// many more and where to read them (ruling R90), what else stays, and the retention line (R64).
// The plan takes the first that fits (fitWhat): the shorter ones say less of what stays, and the
// shortest names no group of what is removed either, only that the whole list is in `cli.js
// uninstall status`. Each shorter one points there, and the playbook runs it and shows its lines
// before asking such a card; the hash covers the whole list whichever is shown.
function cardWhats({ name, changes, keep, asks, pullRequest, archive, local }) {
  const count = (test) => changes.filter(test).length;
  // The trusted-keys list and the signing key, removed last of all, are keys on the card.
  const keyFile = (c) => c.put === 'remove' && (samePath(c.target, signingKeyFile()) || samePath(c.target, enrolledFile()));
  const files = count((c) => c.phase === 'files' && ['in-pull-request', 'reverse'].includes(c.put));
  const trial = count((c) => c.phase === 'files' && ['close-pull-request', 'delete-branch'].includes(c.put));
  const computer = count((c) => c.phase === 'computer');
  const keys = count((c) => c.phase === 'keys' || keyFile(c));
  const removed = count((c) => c.phase === 'last' && c.put === 'remove' && !keyFile(c));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const groups = [
    'stop its jobs',
    changes.some((c) => c.phase === 'locked') ? 'leave Locked (your password)' : null,
    local ? 'bring this folder up to the main version' : null,
    files > 0 ? (pullRequest ? (local ? `take out ${plural(files, 'file')} and pins by a last change, merged here` : `take out ${plural(files, 'file')} and pins by a pull request you merge`) : `put back ${plural(files, 'file')}`) : null,
    trial > 0 ? 'clear its trial' : null,
    computer > 0 ? `put back ${plural(computer, 'change')} on this computer` : null,
    keys > 0 ? `delete or untick ${plural(keys, 'key')}` : null,
    removed > 0 ? `remove ${removed} of Wheelhouse's folders` : null,
  ].filter(Boolean);
  const said = archiveSaid(archive, local);
  const head = `Remove Wheelhouse from ${name}: ${groups.join(', ')}.`;
  const changed = keep.filter((k) => k.why === 'changed since setup').map((k) => k.brief ?? k.what);
  // The project's .wheelhouse/ folder and its exclude line are named (ruling R131), not counted.
  const named = keep.some((k) => k.why === FOLDER_STAYS || k.why === LINE_STAYS);
  const others = keep.length - changed.length - keep.filter((k) => k.why === FOLDER_STAYS || k.why === LINE_STAYS).length;
  const note = named ? ` ${FOLDER_NOTE}` : '';
  const shortNote = named ? ` ${FOLDER_NOTE_SHORT}` : '';
  const othersLine = others > 0 ? ` ${plural(others, 'other thing')} ${others === 1 ? 'stays as it is' : 'stay as they are'}.` : '';
  const asksLine = asks.length > 0 ? ` ${local ? 'Copies' : 'Repositories'} and records stay unless their own cards say otherwise.` : '';
  const transcripts = ` ${TRANSCRIPTS}`;
  const left = (list) => {
    const more = changed.length - list.length;
    if (changed.length === 0) return '';
    return ` Left as you changed them: ${[...list, ...(more > 0 ? [`and ${more} more: ${STATUS_FORM}`] : [])].join('; ')}.`;
  };
  const counted = changed.length > 0 ? ` ${changed.length} left as you changed them: ${STATUS_FORM}.` : '';
  let fitting = changed;
  while (fitting.length > 0 && (head + said.full + left(fitting) + note + othersLine + asksLine + transcripts).length + name.length > WHAT_CHARS) fitting = fitting.slice(0, -1);
  return [
    `${head}${said.full}${left(fitting)}${note}${othersLine}${asksLine}${transcripts}`,
    `${head}${said.full}${counted}${note}${othersLine}${asksLine}${transcripts}`,
    `${head}${said.full}${counted}${shortNote}${othersLine}${asksLine}${transcripts}`,
    `${head}${said.short}${counted}${shortNote} What else stays: ${STATUS_FORM}.${transcripts}`,
    `${head}${said.short}${shortNote} What stays, and why: ${STATUS_FORM}.${transcripts}`,
    `Remove Wheelhouse from ${name}: the whole list is in ${STATUS_FORM}.${shortNote}${transcripts}`,
  ];
}

// The first of the card's texts that fits: within WHAT_CHARS with the name, and composed within the
// composer's limit (CARD.chars), so uninstall's card can always be shown (rulings R131, R134). The
// budget never costs the groups or the count of what changed since setup (the first COUNTED texts
// keep both); past it, the first that composes at all.
const COUNTED = 4;
function fitWhat(whats, base, name) {
  const composes = (what) => {
    try {
      composeCard(cleanDeep({ ...base, what }, []));
      return true;
    } catch {
      return false;
    }
  };
  return whats.slice(0, COUNTED).find((w) => w.length + name.length <= WHAT_CHARS && composes(w)) ?? whats.find(composes) ?? whats.at(-1);
}

const same = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

// A ref of the folder's own git (`refs/heads/main`), read from its files, a loose ref then
// packed-refs, changing nothing; null when it can't be read.
function refOf(folder, ref) {
  if (ref.split('/').some((part) => part === '' || part === '..' || part === '.')) return null;
  let dir = path.join(folder, '.git');
  try {
    if (fs.statSync(dir).isFile()) {
      const pointed = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dir, 'utf8'));
      if (!pointed) return null;
      dir = path.resolve(folder, pointed[1].trim());
    }
  } catch {
    return null;
  }
  const dirs = [dir];
  try {
    dirs.push(path.resolve(dir, fs.readFileSync(path.join(dir, 'commondir'), 'utf8').trim()));
  } catch { /* not a worktree's */ }
  const SHA = /^[0-9a-f]{40,64}$/;
  for (const d of dirs) {
    try {
      const text = fs.readFileSync(path.join(d, ...ref.split('/')), 'utf8').trim();
      if (SHA.test(text)) return text;
    } catch { /* not loose */ }
    try {
      for (const line of fs.readFileSync(path.join(d, 'packed-refs'), 'utf8').split(/\r?\n/)) {
        const [sha, name] = line.split(' ');
        if (name === ref && SHA.test(sha)) return sha;
      }
    } catch { /* none packed */ }
  }
  return null;
}

// Walks a json-key or file group, newest first, on what its target holds now (ruling R85): the links
// to put back, those put back already, and from the first link that holds neither its after nor its
// before, the rest, changed since setup. `why` when the target can't be read as setup wrote it.
function walkChain(group) {
  const state = heldNow(newest(group));
  if (state.why !== undefined) return { why: state.why };
  let held = state;
  const holds = (value, absent) => (absent ? !held.held : held.held && same(held.value, value));
  const listed = [];
  const already = [];
  const changed = [];
  for (const e of [...group].reverse()) {
    const link = e.c;
    const beforeAbsent = link.kind === 'json-key' ? link.absent === true : link.before === null;
    if (changed.length > 0) changed.push(e);
    else if (holds(link.after, false)) {
      listed.push(e);
      held = beforeAbsent ? { held: false } : { held: true, value: link.before };
    } else if (holds(link.before, beforeAbsent)) already.push(e);
    else changed.push(e);
  }
  return { listed, already, changed };
}

// The text a file holds with the lines uninstall keeps (`kept`, in the order setup adds them): as it
// is when it holds them already, otherwise with each missing one added at the end, as step 7 adds it.
function withKept(text, kept) {
  let out = text;
  for (const line of kept) {
    if (typeof out === 'string' && out.split(/\r?\n/).some((l) => (line === WHEELHOUSE_LINE ? l.trim() === line : l === line))) continue;
    const eol = typeof out === 'string' && out.includes('\r\n') ? '\r\n' : '\n';
    out = `${out ?? ''}${out && !out.endsWith('\n') ? eol : ''}${line}${eol}`;
  }
  return out;
}

// The lines of step 7 that stay (rulings R131 for .wheelhouse/'s, and the .env lines, which stay
// always), when a file group holds them as setup wrote them and the file holds them now:
// { line, rest }, their own links and the others, each of those read with the lines kept, so
// putting them back takes out setup's other lines and leaves these. Otherwise null, and the group
// is walked as it is. `wanted`: the lines to keep.
function keepLines(group, wanted) {
  const line = group.filter((e) => e.c.kind === 'file' && wanted.includes(e.c.line));
  if (line.length === 0) return null;
  const now = heldNow(newest(group));
  if (now.held !== true) return null;
  const held = now.value.split(/\r?\n/);
  const kept = [...new Set(line.map((e) => e.c.line))].filter((l) => held.includes(l));
  if (kept.length === 0) return null;
  const mine = line.filter((e) => kept.includes(e.c.line));
  const rest = group.filter((e) => !mine.includes(e)).map((e) => ({ ...e, c: { ...e.c, before: withKept(e.c.before, kept), after: withKept(e.c.after, kept) } }));
  return { line: mine, kept, rest };
}

// ---- The other agent setup's instructions, archived (plan rulings P5, P6) ----

// The archive folder, its list of what was moved, and the most moves that list may name.
export const ARCHIVE = '.wheelhouse-archive';
export const ARCHIVE_MANIFEST = `${ARCHIVE}/archived.json`;
const ARCHIVE_MOST = 1000;
// The modes of a plain file in git's tree: the only ones put back.
export const PLAIN_FILE = Object.freeze(['100644', '100755']);
// Why an archive is refused whole, named on the card.
export const ARCHIVE_UNREAD = 'its list of what was moved (archived.json) could not be read';
export const ARCHIVE_OUTSIDE = 'its list names a path outside the project, a file that isn\'t another agent setup\'s instructions, a move from anywhere but its own path in the archive folder, or a link or something other than a plain file';
export const ARCHIVE_TWICE = 'its list names one place twice, or one inside another';
// What the pull request does with it, as the card says it.
export const ARCHIVE_BACK = 'the other agent setup\'s instructions, back where they were';

// A path as a case-blind file system reads it (macOS and Windows): one form of each accented
// letter, the characters macOS ignores in names left out, and in lower case. Used everywhere a
// path's place is compared, whatever this computer is, since the project is checked out elsewhere
// too.
const IGNORED = /[​-‏‪-‮⁠-⁯﻿]/g;
export const blindKey = (p) => p.normalize('NFC').replace(IGNORED, '').toLowerCase();
export const underArchive = (p) => blindKey(p) === blindKey(ARCHIVE) || blindKey(p).startsWith(`${blindKey(ARCHIVE)}/`);

// Whether `p` is a path inside the project, as git's tree names it: relative, with `/` between
// parts, no part empty, `.` or `..` (nor one that becomes so, or that Windows reads otherwise, by a
// trailing dot or space), no backslash, colon or control character (so no drive, no second stream),
// and no part that is git's own folder in any case or by its short Windows name.
export function insideProject(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024 || /[\\:\0-\x1f\x7f]/.test(p)) return false;
  return p.split('/').every((part) => {
    const key = blindKey(part);
    return part !== '' && !/[. ]$/.test(part) && !['', '.', '..', '.git', 'git~1'].includes(key);
  });
}

// Whether `p` is one of another agent setup's instruction files (OTHER_SETUP_PATHS), in any case.
export const otherSetupFile = (p) => OTHER_SETUP_PATHS.some((pattern) => matchGlob(pattern, p, { ignoreCase: true }));

// git's tree at `tree`, every entry with its mode, type and object: `ls-tree -z`'s records.
export function treeEntries(text) {
  return String(text).split('\0').filter(Boolean).map((record) => {
    const tab = record.indexOf('\t');
    const [mode, type, sha] = record.slice(0, tab).split(' ');
    return { mode, type, sha, path: record.slice(tab + 1) };
  });
}

// The archive on `ref`, read by `git(args)` (run's answer), changing nothing:
//   null                     no archive there, or `ref` can't be read;
//   { view, entries, manifest }, where view (ArchiveView, what the list and its hash hold) is
//     { moves: [{ from, to, mode, sha }], taken: [from], missing: [from], folder: [path] }: the moves to make,
//     in the list's order; those whose place is taken on `ref` (a file there, in any case, or a
//     file where a folder on its way would be), left in the archive; those the archive no longer
//     holds as a file, left out; and every file in the archive folder;
//     or { refused: why, folder } when the list can't be read or names a path it may not.
// `entries` is the whole tree, and `manifest` the list as read.
export async function archiveAt(git, ref) {
  const tree = await git(['rev-parse', '--verify', '--quiet', `${ref}^{tree}`]);
  if (tree.code !== 0) return null;
  const listed = await git(['ls-tree', '-r', '-t', '-z', '--full-tree', String(tree.stdout).trim()]);
  if (listed.code !== 0) return null;
  const entries = treeEntries(listed.stdout);
  const inside = entries.filter((e) => e.path === ARCHIVE || e.path.startsWith(`${ARCHIVE}/`));
  if (inside.length === 0) return null;
  const folder = inside.filter((e) => e.type !== 'tree').map((e) => e.path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const refused = (why) => ({ view: { refused: why, folder }, entries, manifest: null });
  const listEntry = inside.find((e) => e.path === ARCHIVE_MANIFEST && e.type === 'blob');
  if (listEntry === undefined) return refused(ARCHIVE_UNREAD);
  const text = await git(['cat-file', 'blob', listEntry.sha]);
  if (text.code !== 0) return refused(ARCHIVE_UNREAD);
  let manifest;
  try {
    manifest = JSON.parse(String(text.stdout));
  } catch {
    return refused(ARCHIVE_UNREAD);
  }
  const moved = manifest?.moved;
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.v !== 1 || !Array.isArray(moved) || moved.length > ARCHIVE_MOST) return refused(ARCHIVE_UNREAD);
  if (moved.some((m) => m === null || typeof m !== 'object' || typeof m.from !== 'string' || typeof m.to !== 'string')) return refused(ARCHIVE_UNREAD);
  // A move counts only for another setup's instruction file (any case), from its own path in the
  // archive; anything else refuses the whole archive.
  for (const { from, to } of moved) {
    if (!insideProject(from) || underArchive(from) || !otherSetupFile(from)) return refused(ARCHIVE_OUTSIDE);
    if (to !== `${ARCHIVE}/${from}`) return refused(ARCHIVE_OUTSIDE);
  }
  const froms = moved.map((m) => blindKey(m.from));
  const tos = moved.map((m) => blindKey(m.to));
  if (new Set(froms).size < froms.length || new Set(tos).size < tos.length) return refused(ARCHIVE_TWICE);
  if (froms.some((a) => froms.some((b) => a.startsWith(`${b}/`)))) return refused(ARCHIVE_TWICE);
  // Every place on `ref`, case-blind, with what is there.
  const places = new Map();
  for (const e of entries) {
    const key = blindKey(e.path);
    if (!places.has(key)) places.set(key, []);
    places.get(key).push(e);
  }
  const taken = (from) => {
    if (places.has(blindKey(from))) return true;
    const parts = from.split('/');
    // A folder on the way is taken only by a file, or by a folder of another case.
    return parts.slice(0, -1).some((_, i) => {
      const on = parts.slice(0, i + 1).join('/');
      return (places.get(blindKey(on)) ?? []).some((e) => e.type !== 'tree' || e.path !== on);
    });
  };
  // Only a plain file is ever put back: a link, another repository or a folder where a moved file
  // should be refuses the whole archive. Each move names the file's mode and object, so the hash
  // covers what is put back, not only where.
  const at = new Map(inside.map((e) => [e.path, e]));
  if (moved.some((m) => at.has(m.to) && !PLAIN_FILE.includes(at.get(m.to).mode))) return refused(ARCHIVE_OUTSIDE);
  const view = { moves: [], taken: [], missing: [], folder };
  for (const m of moved) {
    const e = at.get(m.to);
    if (e === undefined) view.missing.push(m.from);
    else if (taken(m.from)) view.taken.push(m.from);
    else view.moves.push({ from: m.from, to: m.to, mode: e.mode, sha: e.sha });
  }
  return { view, entries, manifest };
}

// The archive as the folder's copy of `branch` last showed it (its ArchiveView), or null when there
// is none, the folder holds no copy, or git can't read it; read with setup's fenced git, changing
// nothing. The apply reads the host's and compares.
async function archiveSeen({ real, branch, run, findGit, local }) {
  const ref = local ? `refs/heads/${branch}` : `refs/remotes/origin/${branch}`;
  if (refOf(real, ref) === null) return null;
  try {
    const found = await findGit();
    if (!found?.ok || typeof found.path !== 'string') return null;
    const git = setupGit({ run, gitPath: found.path, env: { GIT_NO_REPLACE_OBJECTS: '1' }, cwd: real });
    return (await archiveAt(git, ref))?.view ?? null;
  } catch {
    return null;
  }
}

// The paths as the card names them: up to three, then how many more.
function someOf(list) {
  return list.length <= 3 ? list.join(', ') : `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`;
}

// What the card says of the archive, in full and in short.
function archiveSaid(archive, local) {
  if (archive === null || archive === undefined) return { full: '', short: '' };
  if (archive.refused !== undefined) {
    const line = ` ${ARCHIVE}/ stays as it is: ${archive.refused}.`;
    return { full: line, short: line };
  }
  const back = archive.moves.length > 0 ? ` By the ${local ? 'last change' : 'pull request'} too: ${ARCHIVE_BACK}.` : '';
  const one = archive.taken.length === 1;
  const taken = archive.taken.length > 0 ? ` Left in ${ARCHIVE}/, as ${one ? 'its place is' : 'their places are'} taken: ${someOf(archive.taken)}.` : '';
  const counted = archive.taken.length > 0 ? ` ${archive.taken.length} left in ${ARCHIVE}/: ${STATUS_FORM}.` : '';
  return { full: `${back}${taken}`, short: `${back}${counted}` };
}

// The status lines for the archive, under its pull request.
function archiveLines(archive) {
  if (archive === null || archive === undefined) return [];
  if (archive.refused !== undefined) return [`  ${ARCHIVE}/ stays as it is: ${archive.refused}`];
  return [
    ...(archive.moves.length > 0 ? [`  in it: ${ARCHIVE_BACK}: ${archive.moves.map((m) => m.from).join(', ')}`] : []),
    ...archive.taken.map((from) => `  left in ${ARCHIVE}/, as its place is taken: ${from}`),
    ...archive.missing.map((from) => `  not in ${ARCHIVE}/, so not put back: ${from}`),
  ];
}

// What uninstall would do for the folder, worked out without changing anything: the same world
// gives the same list and hash. `userHome` shortens paths on the card; `platform` and `run` read an
// account variable setup set (launchctl or the Windows user variable), changing nothing, and with
// `findGit` the archive on the folder's copy of the branch: git on the path, as the helper runs it
// (setup put it there, and on the Mac it is past Apple's window by then), or on Windows where
// tools.js finds Git for Windows.
export async function uninstallPlan({
  folder, userHome = os.homedir(), platform = process.platform, run = realRun,
  findGit = platform === 'win32' ? async () => (await toolsStatus({ platform, run, tools: ['git'] })).git : async () => ({ ok: true, path: 'git' }),
} = {}) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Uninstall needs the project\'s folder, as a full path');
  const real = realOr(folder);
  const own = projectForFolder(real);
  // A Lean project is removed through its own install, never here (ruling P5-47).
  if (own?.lean === true) throw new Error(LEAN_FOLDER);
  const slug = own?.project ?? null;
  const local = own?.record.host === 'local';
  const journal = readJournal();
  const mine = (r) => typeof r?.folder === 'string' && keyOf(realOr(r.folder)) === keyOf(real);
  // The last project on this computer: no other registered, a Lean project among them (whose
  // signed records need this computer's key and id, ruling P5-47), and no other folder whose setup
  // run isn't closed, so a half set-up folder keeps what it needs (ruling R114).
  const others = [...registeredProjects(), ...registeredLeanProjects()].filter((p) => p.project !== slug);
  const settingUp = new Set(journal.runs.filter((r) => typeof r?.folder === 'string' && !runClosed(r) && !mine(r)).map((r) => keyOf(realOr(r.folder))));
  const last = others.length === 0 && settingUp.size === 0;

  // Every change not yet put back, in the journal's order (`seq`), with whether it is this
  // folder's, grouped by (kind, target, key).
  const groups = new Map();
  let deferred = 0;
  let seq = 0;
  for (const r of journal.runs) {
    for (const c of Array.isArray(r?.changes) ? r.changes : []) {
      const at = seq++;
      if (c?.putBack !== undefined || c?.kind === 'answer') continue;
      const wide = computerWide(c, r);
      if (!mine(r) && !wide) continue;
      if (wide && !last) {
        if (mine(r)) deferred++;
        continue;
      }
      const k = JSON.stringify([c.kind, c.target, c.key ?? null]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ c, run: r, seq: at });
    }
  }
  const all = [...groups.values()];
  const joining = journal.runs.some((r) => mine(r) && joinedRepo(r) !== null);
  // Shared (ruling R124): a joining computer's, or this computer trusts another computer's key.
  // This computer's id is read only once there is a list to compare it with: reading it with none
  // kept yet would make one, and the plan changes nothing.
  const trusted = readEnrolled();
  // A project kept here is on no other computer, whatever computers this one trusts.
  const shared = !local && (joining || (trusted.length > 0 && trusted.some((e) => typeof e?.computer === 'string' && e.computer !== computerId())));

  const items = []; // { phase, seq, entry }
  const keep = [];
  const asks = [];
  const done = [];
  // The journal's changes for the project's private record, which its own card deals with.
  const recordIds = [];
  // And for the home of a project kept on this computer, which its own card deals with too.
  const homeIds = [];
  const removals = new Map(); // path -> { phase, ids, seq }
  const add = (phase, at, entry) => items.push({ phase, seq: at, entry: { phase, ...entry } });
  const kept = (what, why, list, short) => keep.push({ what, why, ...(short && short !== what ? { brief: short } : {}), ...(list ? { ids: list } : {}) });
  const settled = (list, why) => { if (list.length > 0) done.push({ ids: list, why }); };
  const remove = (target, phase, list = [], at = -1) => {
    const key = resolved(target);
    const was = removals.get(key) ?? { target, phase, ids: [], seq: -1 };
    was.ids.push(...list);
    was.seq = Math.max(was.seq, at);
    removals.set(key, was);
  };

  // The setup commit and its push: on the host only when the journal or the folder shows it went up
  // (step 7 recorded the push before making it). Then a pull request takes the project's files and
  // pins out, unless the project is shared, when they stay as committed; otherwise they are put back
  // here, and a commit made in the folder is kept there.
  const commitGroup = all.find((g) => g[0].c.kind === 'host' && ['commit', 'push'].includes(newest(g).after?.action));
  let pullRequest = false;
  let committed = joining;
  let archive = null;
  if (commitGroup !== undefined) {
    const { c, run: pushRun } = commitGroup.at(-1);
    const branch = c.after.branch;
    if (c.after.action === 'push') {
      const runChanges = Array.isArray(pushRun.changes) ? pushRun.changes : [];
      // Protection is recorded only once the push went up; another change of step 7's after it may be
      // a later attempt's, stopped before its own push.
      const afterPush = runChanges.slice(runChanges.findIndex((x) => x.id === c.id) + 1).some((x) => x.step === 7 && x.kind === 'host' && x.after?.action === 'protect');
      const pushed = typeof pushRun.steps?.[7]?.doneAt === 'string' || afterPush || c.onHost !== undefined
        || refOf(real, `refs/remotes/origin/${branch}`) === c.after.sha;
      // The archive on the branch: put back by the pull request, or left for the other computers.
      if (pushed) archive = await archiveSeen({ real, branch, run, findGit, local });
      if (pushed && shared) {
        committed = true;
        kept(`setup's commit on ${branch}`, `it stays in the project's history: ${OTHERS_USE}`, idsOf(commitGroup));
        if (archive !== null) kept(`${ARCHIVE}/, the other agent setup's instructions on ${branch}`, OTHERS_USE);
      } else if (pushed) pullRequest = true;
      else kept(`setup's commit on ${branch}, never pushed`, NEVER_PUSHED, idsOf(commitGroup));
    } else if (refOf(real, `refs/heads/${branch}`) === commitGroup[0].c.before?.sha) settled(idsOf(commitGroup), 'the commit was never made');
    else kept(`setup's commit on ${branch}, never pushed`, NEVER_PUSHED, idsOf(commitGroup));
  }
  const sharedFile = (target) => [...SETUP_FILES, ...ENGINE_FILES, GITIGNORE].some((rel) => samePath(target, path.join(real, ...rel.split('/'))));
  // The project's .wheelhouse/ folder: while it is there, step 7's line keeping it out of git stays
  // (ruling R131).
  const ownFolder = path.join(real, '.wheelhouse');
  let ownFolderThere = false;
  try {
    ownFolderThere = fs.statSync(ownFolder).isDirectory();
  } catch { /* not there */ }
  const projectSettings = path.join(real, '.claude', 'settings.json');
  const numberedPrs = new Set(all.map((g) => /^(.+) pull request \d+$/.exec(g[0].c.target)?.[1]).filter(Boolean));

  for (const whole of all) {
    if (whole === commitGroup) continue;
    // The own app proposed again with the value the profile already held (ruling R115) changed
    // nothing: there is nothing to put back for it, so the last uninstall never proposes again what
    // would hide the accepted app on every computer.
    const group = whole[0].c.target === PROFILE_TARGET ? whole.filter((e) => !same(e.c.before, e.c.after)) : whole;
    if (group.length < whole.length) settled(whole.filter((e) => !group.includes(e)).map((e) => e.c.id), 'it held this before setup');
    if (group.length === 0) continue;
    const c = newest(group);
    const at = seqOf(group);
    const list = idsOf(group);
    switch (c.kind) {
      case 'json-key':
      case 'file': {
        if (samePath(c.target, profileFile())) {
          kept(shown(c.target, userHome), OLD_STAYS, list);
          break;
        }
        if (slug !== null && within(projectFolder(slug), c.target)) {
          remove(projectFolder(slug), 'last', list, at);
          break;
        }
        // The broker's launcher, in the engine's folder: it goes with the folder. The project's mirror rule there is a
        // key, put back with the project.
        if (c.kind === 'file' && within(engineDir(), c.target)) {
          remove(c.target, 'last', list, at);
          break;
        }
        const inProject = sharedFile(c.target);
        if (inProject && committed) {
          kept(describe(c, userHome), 'the project\'s own file, as committed: it stays', list);
          break;
        }
        const keeping = keepLines(group, [...ENV_STAYS_LINES, ...(ownFolderThere ? [WHEELHOUSE_LINE] : [])]);
        if (keeping !== null) {
          const own = keeping.kept.includes(WHEELHOUSE_LINE);
          const env = keeping.kept.filter((l) => l !== WHEELHOUSE_LINE);
          if (env.length > 0) kept(`${env.join(' and ')} in ${shown(c.target, userHome)}`, ENV_STAYS, idsOf(keeping.line.filter((e) => e.c.line !== WHEELHOUSE_LINE)));
          if (own) {
            kept(`${WHEELHOUSE_LINE} in ${shown(c.target, userHome)}`, LINE_STAYS, idsOf(keeping.line.filter((e) => e.c.line === WHEELHOUSE_LINE)));
            kept('the project\'s .wheelhouse/ folder', FOLDER_STAYS);
          }
          if (keeping.rest.length === 0) break;
        }
        const links = keeping?.rest ?? group;
        const walked = walkChain(links);
        if (walked.why !== undefined) {
          kept(describe(c, userHome), walked.why, idsOf(links), brief(c));
          break;
        }
        const phase = inProject ? 'files' : 'computer';
        const put = inProject && pullRequest ? 'in-pull-request' : 'reverse';
        for (const e of walked.listed) add(phase, e.seq, { put, change: e.c, ids: [e.c.id] });
        settled(walked.already.map((e) => e.c.id), 'already put back');
        if (walked.changed.length > 0) kept(describe(c, userHome), 'changed since setup', walked.changed.map((e) => e.c.id), brief(c));
        break;
      }
      case 'folder': {
        const one = asOne(group);
        if (path.basename(c.target) === '.git') kept(shown(c.target, userHome), 'the folder\'s git history is kept', list);
        else if (slug !== null && samePath(c.target, stateDir(slug))) recordIds.push(...list);
        else if (local && samePath(c.target, homeDir(slug))) homeIds.push(...list);
        else if (slug !== null && samePath(c.target, oldStateDir(slug))) kept(shown(c.target, userHome), OLD_STAYS, list);
        else if (slug !== null && within(projectFolder(slug), c.target)) remove(projectFolder(slug), 'last', list, at);
        else if (samePath(c.target, oldProfileDir())) kept(shown(c.target, userHome), OLD_STAYS, list);
        else if (within(path.join(wheelhouseHome(), 'tools'), c.target) || within(engineDir(), c.target) || typeof c.after?.installer === 'string') remove(c.target, 'last', list, at);
        else if (one.before !== null) settled(list, 'not made by setup');
        else {
          // Gone is put back already; a folder that can't be read is kept, with why.
          let inside = null;
          try {
            inside = fs.readdirSync(c.target);
          } catch (error) {
            if (error.code === 'ENOENT') settled(list, 'already put back');
            else kept(shown(c.target, userHome), `could not read it: ${error.code ?? error.message}`, list);
          }
          if (inside !== null && inside.length === 0) add('computer', at, { put: 'reverse', change: one, ids: list });
          else if (inside !== null) kept(shown(c.target, userHome), 'not empty: what is in it stays', list);
        }
        break;
      }
      case 'host': {
        const one = asOne(group);
        const h = hostTarget(c.target);
        const trial = /^(.+) (pull request (\d+)|pull request from (.+)|branch (.+))$/.exec(c.target);
        if (c.target === PROFILE_TARGET) {
          // While the profile holds setup's app, or setup's record was never confirmed, putBackOwnApp
          // puts it back; an app the director recorded since is theirs.
          const views = readProfileViews();
          const current = views === null ? undefined : acceptedOwnApp(views);
          if (current === undefined || same(current, one.after) || same(current, one.before)) add('computer', at, { put: 'put-back-own-app', change: one, ids: list });
          else kept('your own GitHub App in your settings on this computer', 'changed since setup', list, 'own-github-app');
        } else if (c.target === 'key github-app') add('keys', at, { put: 'delete-key', key: 'github-app', before: one.before, ids: list, ...(shared ? { shared: true } : {}) });
        else if (/^key gitlab-project-\d+$/.test(c.target)) {
          const pasted = c.after?.kind === 'pasted-token';
          add('keys', at, {
            put: 'revoke-key', key: c.target.slice('key '.length), pasted, before: one.before, ids: list,
            line: pasted ? 'The GitLab token you pasted is revoked, which stops it everywhere it is used' : 'The project\'s GitLab key is revoked, then deleted',
          });
        } else if (h !== null && h.file?.startsWith('enrolments/')) kept(`this computer's key in ${h.repo} on ${HOSTS[h.host]}`, OLD_STAYS, list);
        else if (h !== null && h.file === null && repoName(h.repo) === OLD_PROFILE_REPO) kept(`${h.repo} on ${HOSTS[h.host]}, your profile`, OLD_STAYS, list);
        else if (h !== null && h.file === null && one.after?.made === true && shared) kept(`${h.repo} on ${HOSTS[h.host]}`, OTHERS_USE, list);
        else if (h !== null && h.file === null && one.after?.made === true) {
          asks.push({
            id: askId(c.target), about: 'product', phase: 'kept', put: 'delete-repository', target: c.target, ids: list,
            card: deleteCard({
              what: `Delete ${h.repo} on ${HOSTS[h.host]}, the repository setup made for this product?`,
              why: 'It holds your product\'s code and history, and a deleted repository can\'t be brought back, so it is your call.',
              keeps: `${h.repo} and its history stay on ${HOSTS[h.host]}.`,
              deletes: `${HOSTS[h.host]}'s settings page for it opens, where you click Delete yourself.`,
              because: 'your product\'s history can\'t be brought back once deleted',
            }),
          });
        // Step 7's switch of a folder on a line of work, and a line of the director's changes it kept
        // safe (the director's ruling of 25 October 2026): their work, never switched back or deleted.
        } else if (one.after?.action === 'switch') kept(`this folder's switch from ${one.after.from} to ${one.after.to}`, `left as it is: your work stays on ${one.after.from}`, list);
        else if (one.after?.action === 'keep') kept(`your changes kept on ${one.after.line}`, 'left as they are, on their own line', list);
        else if (one.after?.action === 'protect') kept(`protection on ${one.after.branch} of ${c.target.replace(/ protection$/, '')}`, 'left on, as the host keeps it', list);
        else if (trial?.[3] !== undefined) {
          if (c.after?.state === 'open') add('files', at, { put: 'close-pull-request', repo: trial[1], number: Number(trial[3]), ids: list });
          else settled(list, 'closed by the health check');
        } else if (trial?.[4] !== undefined) {
          if (c.after?.state === 'opening' && !numberedPrs.has(trial[1])) add('files', at, { put: 'close-pull-request', repo: trial[1], branch: trial[4], ids: list });
          else settled(list, 'its pull request is recorded by its number');
        } else if (trial?.[5] !== undefined) {
          if (c.after !== null) add('files', at, { put: 'delete-branch', repo: trial[1], branch: trial[5], sha: c.after?.sha ?? null, ids: list });
          else settled(list, 'deleted by the health check');
        } else kept(c.target, 'left as it is on the host', list);
        break;
      }
      case 'process': {
        const plugin = typeof c.after?.plugin === 'string' ? c.after.plugin : null;
        if (plugin === null) kept(describe(c, userHome), 'it stays installed', list);
        else if (committed) kept(describe(c, userHome), 'it stays installed for this folder', list);
        else if (pullRequest) add('files', at, { put: 'in-pull-request', change: c, ids: list });
        else {
          // No pull request: the pin is switched off here, by its key in the project's settings,
          // unless setup's own key edits there put it back already.
          const key = ['enabledPlugins', plugin];
          const pin = { id: c.id, step: c.step, kind: 'json-key', target: projectSettings, key, before: null, absent: true, after: true };
          const held = heldNow(pin);
          if (groups.has(JSON.stringify(['json-key', projectSettings, key]))) settled(list, 'its key goes back with the project\'s settings');
          else if (held.why !== undefined) kept(describe(c, userHome), held.why, list);
          else if (held.held && held.value === true) add('files', at, { put: 'reverse', change: pin, ids: list });
          else settled(list, 'not switched on in the project\'s settings');
        }
        break;
      }
      // The folder's one remote, after the last change, which needs it.
      case 'git-config':
        add('files', at, { put: REMOVE_REMOTE, target: c.target, name: c.key[1], url: c.after, ids: list });
        break;
      case 'env': {
        const one = asOne(group);
        if (one.before === one.after) {
          settled(list, 'it held this before setup');
          break;
        }
        // A variable that can't be read is kept, with why: never taken for one already unset.
        let read;
        try {
          read = await launchVarState(c.target, { platform, run });
        } catch (error) {
          read = { why: `could not read ${c.target}: ${error.message}` };
        }
        if (read.why !== undefined) kept(describe(c, userHome), read.why, list, brief(c));
        else if (read.value === c.after) add('computer', at, { put: 'unset-env', target: c.target, where: c.where ?? null, ids: list });
        else if (read.value === one.before) settled(list, 'already put back');
        else kept(describe(c, userHome), 'changed since setup', list, brief(c));
        break;
      }
      case 'plugin-scope':
        // One setup only brought up to date was there before it (part 3f): the director's own, so it stays.
        if ((asOne(group).before ?? null) !== null) kept(describe(c, userHome), 'it was there before setup, which only brought it up to date', list);
        else add('computer', at, { put: 'remove-plugin-scope', change: c, ids: list });
        break;
      case 'locked': {
        const one = asOne(group);
        if (one.before?.exists === true && one.before?.ours !== true) kept(`Locked's file ${c.target}`, 'it is not Wheelhouse\'s, so it is left as it is', list);
        else add('locked', at, { put: 'leave-locked', target: c.target, project: c.after?.project ?? slug, ids: list });
        break;
      }
      default:
        kept(describe(c, userHome), 'left as it is', list);
    }
  }

  // The pull request, once its files and pins are known: its ids are the commit's, the push's and
  // those of everything it takes out, so marking it done marks them all in one write.
  if (pullRequest) {
    const c = asOne(commitGroup);
    const takes = items.filter((i) => i.entry.put === 'in-pull-request').flatMap((i) => i.entry.ids);
    add('files', seqOf(commitGroup), {
      put: 'pull-request', ...(local ? { local: true } : {}), kind: 'host', target: c.target, branch: c.after.branch, base: c.before?.sha ?? null, ids: [...idsOf(commitGroup), ...takes],
      ...(archive !== null ? { archive } : {}),
    });
  }

  // The app on GitHub: on the last project its keys go and its installation page is given; while
  // another project stays, this repository is unticked on the installation's page instead (R88).
  // The installation is the account's, not this computer's: on a shared project it is left as it
  // is, for the other computers (ruling R124).
  const connection = own?.record.connection;
  const usedApp = connection?.mode === 'narrow' && (connection?.host ?? own?.record.host) === 'github';
  if (last && !items.some((i) => i.entry.put === 'delete-key') && exists(path.join(keysDir(), 'github-app.json'))) add('keys', -1, { put: 'delete-key', key: 'github-app', before: null, ...(shared ? { shared: true } : {}) });
  if (!last && usedApp && !shared) add('keys', -1, { put: 'untick-repository', key: 'github-app', repo: own.record.repo });
  if (!last && usedApp && shared) kept(`the GitHub app's access to ${own.record.repo}`, OTHERS_USE);
  // The sign-in start the helper's own install made (design section 8.5), on the last project, if there is one.
  // Recorded nowhere in the journal: its record is in Wheelhouse's home (scripts/lib/login-start.js).
  const loginStart = last ? loginStartRecord() : null;

  // The project's own folder under projects/, and on the last project Wheelhouse's own folders and
  // files, recorded or not; the trusted-keys list and the signing key go last of all (rulings R123,
  // R128), below.
  if (slug !== null) remove(projectFolder(slug), 'last');
  // Last of all: the trusted-keys list, this computer's id, the folders the project's records and
  // the fetched tools were in (each only once nothing is left in it, ruling R138), then the signing
  // key, and the keys folder it was in. Everything else goes before the key (ruling R142); from the
  // list's removal on, a click made in this session can't count, so nothing there stops uninstall
  // but the run's own close (uninstall-run.js).
  const asRemove = (put) => (target) => ({ phase: 'last', put, target });
  const closing = last ? [
    ...[enrolledFile(), computerFile(), ownFilesFile()].filter(exists).map(asRemove('remove')),
    ...[projectsDir(), toolsDir()].filter(exists).map(asRemove('remove-empty')),
    ...[signingKeyFile()].filter(exists).map(asRemove('remove')),
    ...[keysDir()].filter(exists).map(asRemove('remove-empty')),
  ] : [];
  if (last) {
    for (const p of HOST_TOOLS.map(toolFolder)) if (exists(p)) remove(p, 'last');
    // The build engine's folder whole: its Bun, its Archon, the broker, the fetch mirrors and the merge queue folders.
    if (exists(engineDir())) remove(engineDir(), 'last');
    if (exists(profileDir())) kept(shown(profileDir(), userHome), 'your settings on this computer: yours, so they stay');
    // Setup's own records are listed whether they are there yet or not: showing uninstall's card
    // and clicking it write them, and the list must be the same before and after.
    // The trust clicks and the record of the profile's enrolments last fetched (the session start's)
    // too, Wheelhouse's own (ruling R86).
    for (const p of [clicksDir(), usedDir(), shownDir(), askedDir(), answersDir(), answeredDir(), recordsDir(), trustDir(), seenFile()]) remove(p, 'last');
  } else {
    // The project's own fetch mirror, merge queue folder and reader's folder in the engine folder (the helper makes them
    // before a run starts), which nothing else reads once the project is gone; the engine and the other projects' stay.
    const own = slug === null ? [] : [path.join(engineDir(), 'mirrors', `${slug}.git`), path.join(engineDir(), 'queues', slug), path.join(engineDir(), 'checks', slug), readerFolderOf(slug), goalFolderOf(slug)];
    for (const p of own) if (exists(p)) remove(p, 'last');
    kept('Wheelhouse\'s helper, telemetry, tools, your settings and this computer\'s signing key', `another project on this computer, or one being set up, still uses them${deferred > 0 ? ` (${deferred} change${deferred === 1 ? '' : 's'} of this computer's)` : ''}`);
  }
  // The project's folder first in its phase, as the newest, then the others in their order.
  const projectKey = slug === null ? null : resolved(projectFolder(slug));
  for (const [key, r] of removals) {
    add(r.phase, key === projectKey ? Number.MAX_SAFE_INTEGER : r.seq, {
      put: 'remove', target: r.target, ...(key === projectKey ? { except: local ? [...RECORD_NAMES, 'home.git'] : RECORD_NAMES } : {}), ...(r.ids.length > 0 ? { ids: r.ids } : {}),
    });
  }

  // A project kept here: the folder first takes all the home holds, so it needs the home for nothing afterwards, and the
  // home has its own card, as the record has.
  if (local && exists(homeDir(slug))) {
    add('files', Number.MAX_SAFE_INTEGER, { put: 'bring-up', branch: homeBranch(slug) });
    asks.push({
      id: askId(`home:${slug}`), about: 'home', phase: 'kept', put: 'delete-home', target: homeDir(slug), ids: homeIds,
      card: deleteCard({
        what: `Delete this project's private copy on this computer, ${shown(homeDir(slug), userHome)}?`,
        why: 'Your folder holds the whole history once Wheelhouse has gone, so the copy is a spare. Once deleted it can\'t be brought back, so it is your call.',
        keeps: 'The private copy stays on this computer, unused, for this project set up again.',
        deletes: 'Wheelhouse deletes the private copy from this computer. Your folder and its history stay.',
        because: 'a deleted copy can\'t be brought back',
      }),
    });
  } else if (homeIds.length > 0) settled(homeIds, 'already gone');

  // The project's private record on this computer: kept unless its own card says delete, as a
  // deleted transcript can't come back (design section 24.3, item 5). v0.1.x's state clone beside it
  // stays (24.5). The state and lock branches on the host are left as they are: nothing of
  // Wheelhouse's is pushed there now, and v0.1.x's go only on the migration's own cards.
  if (slug !== null && exists(stateDir(slug))) {
    asks.push({
      id: askId(`record:${slug}`), about: 'record', phase: 'kept', put: 'delete-record', target: stateDir(slug), ids: recordIds,
      card: deleteCard({
        what: `Delete this project's private record on this computer, ${shown(stateDir(slug), userHome)}: your words, cards and clicks for ${own?.record?.repo ?? slug}?`,
        why: 'It is kept only on this computer, like your chats with Claude, and once deleted it can\'t be brought back, so it is your call.',
        keeps: 'The record stays on this computer, for this project set up again. Once Wheelhouse is gone from this computer altogether, the clicks signed in it no longer count, since its key goes too.',
        deletes: 'Wheelhouse deletes the record from this computer.',
        because: 'a deleted record can\'t be brought back',
      }),
    });
  } else settled(recordIds, 'already gone');
  if (slug !== null && exists(oldStateDir(slug))) kept(shown(oldStateDir(slug), userHome), OLD_STAYS);
  // The build engine's own record on this computer, Archon's run history (its database and its runs' transcripts):
  // recorded nowhere by setup, as Archon writes it. Kept unless its own card says delete, like the private record.
  if (last && exists(archonHome())) {
    asks.push({
      id: askId(`engine:${archonHome()}`), about: 'engine', phase: 'kept', put: 'delete-engine-history', target: archonHome(), ids: [],
      card: deleteCard({
        what: `Delete the build engine's run history on this computer, ${shown(archonHome(), userHome)}: what each of its runs did, and their transcripts?`,
        why: 'It is kept only on this computer, and once deleted it can\'t be brought back, so it is your call.',
        keeps: 'The run history stays on this computer, for Wheelhouse set up again.',
        deletes: 'Wheelhouse deletes the run history from this computer.',
        because: 'a deleted run history can\'t be brought back',
      }),
    });
  }
  asks.sort((a, b) => ASK_ORDER.indexOf(a.about) - ASK_ORDER.indexOf(b.about));

  // In order: the phases, newest first within each; Stop and the line for Desktop around them, and
  // the helper last of all, after its answer.
  // The engine's runs are cancelled first of all, on the last project, while its folder is there to cancel them. While
  // other projects stay on it, only this project's own runs are (`engine-runs`).
  const stops = [
    ...(last && exists(engineDir()) ? ['engine'] : []),
    ...(!last && slug !== null && exists(engineDir()) ? ['engine-runs'] : []),
    ...(slug !== null ? ['foreman', 'watcher'] : []),
    ...(last ? ['receiver'] : []),
  ].map((what) => ({ phase: 'stop', put: 'stop', what }));
  const ordered = PHASES.filter((p) => p !== 'stop').flatMap((phase) => items.filter((i) => i.phase === phase)
    .sort((a, b) => b.seq - a.seq).map((i) => i.entry));
  const changes = [
    // Ahead of the stops: it runs the start command every minute, which would start again what they stop.
    ...(loginStart !== null ? [{ phase: 'computer', put: 'remove-login-start', kind: loginStart.kind, target: loginStart.path }] : []),
    ...stops,
    ...ordered,
    { phase: 'last', put: 'remove-plugin', line: PLUGIN_LINE },
    ...closing,
    ...(last ? [{ phase: 'last', put: 'stop', what: 'helper', when: 'after the answer' }] : []),
  ];
  // The folder's real path is in the hash too, so a click stands for one folder: two folders with
  // the same name and nothing recorded would otherwise give the same list.
  const hash = listHash({ folder: real, changes, keep, asks: asks.map((a) => ({ id: a.id, put: a.put, target: a.target, ids: a.ids })), done });
  const name = slug ?? path.basename(real);
  const base = {
    kind: 'uninstall',
    level: 4,
    target: { project: name, hash },
    why: shared
      ? `You asked for it. It takes Wheelhouse off this computer for this project; the project stays on ${HOSTS[own?.record.host] ?? 'the host'} for your other computers.`
      : 'You asked for it, and it takes away the checks that guard this project.',
    options: [
      { label: 'Remove it', says: 'Setup\'s changes are put back, as listed.' },
      { label: 'Not now', says: 'Nothing changes.' },
    ],
    recommend: 'Remove it',
    because: 'you asked, and what changed since setup is kept',
    // Uninstall's apply is refused under STOP, as setup's is (ruling R91).
    meanwhile: 'Nothing changes until you click; if All stop is on, lift it first.',
    // Said only when the checks really go: never on a shared project (ruling R124).
    checks: shared
      ? 'Your other computers keep the checks for this project; they stop on this computer only, and protection stays as it is.'
      : local
        ? 'The checks no longer guard this project.'
        : pullRequest
          ? 'Once the pull request is merged, the checks no longer guard this project; protection stays on.'
          : 'The checks no longer guard this project; protection stays as it is.',
  };
  const card = { ...base, what: fitWhat(cardWhats({ name, changes, keep, asks, pullRequest, archive: pullRequest ? archive : null, local }), base, name) };
  return { project: slug, last, shared, changes, keep, asks, done, card, hash };
}

// ---- The helper's routes (Task 15b, rulings R87 to R92, R116 to R118) ----
//
// The helper's routes /setup/uninstall/plan | apply | status (uninstallRoutes, wired in
// scripts/host/helper.js; `cli.js uninstall plan | apply <hash> | status` asks them):
//   plan   { folder }        -> { ok, hash, card, asks: [{ id, about, card }], last }: the list worked
//                               out, its card composed (cleaned first) and kept as shown for the
//                               folder (noteUninstallShown), and each level 4 card asked; read-only
//                               but for setup's own records, so it answers under STOP. Once an
//                               uninstall has stopped past the trusted-keys list's removal, it gives
//                               { ok, lines } instead, status's lines with UNINSTALL_NEW_SESSION
//                               first, and no card, writing nothing (ruling R146)
//   apply  { folder, hash }  -> { ok, started: true }: only after the director's Remove it on the
//                               card naming this project and this hash, signed and fresh, the card
//                               shown for this folder, and the hash of the list worked out again
//                               now; refused under STOP, read again just before the click is used
//                               (ruling R91). The click is used, and the apply starts in its own
//                               process (scripts/setup/uninstall-run.js, ruling R116), detached, as
//                               setup's long steps do: a password prompt and the host's round trips
//                               can outlast any one request
//   status { folder }        -> { ok, lines, uninstall? }: while an uninstall runs, or once it has
//                               finished and no other card has been shown since, how it stands, with what
//                               it said and the pages it gave (its progress record); otherwise the
//                               whole list as plain lines, the card's "and N more"
//
// The progress record, setup/uninstalls/<16 hex of the folder>.json, is written by the route as it
// starts the apply and by the apply's process as it finishes: { folder, project, hash, clickedAt,
// deadline, startedAt, state: 'running' | 'done' | 'stopped', lines, pages, refused?, helperStops?,
// helperStoppedAt? }. It outlasts the last uninstall (it is no record uninstall removes), so its
// answer is kept. An apply has STEP_TIMEOUT_MS from the click; one still recorded running past
// that is stuck, and a fresh card may start another.
//
// The helper stops on the last uninstall (the list's own helper entry, so only when no other project
// needs it) once the apply has reported done: after the first status answer that gives that done
// record, or, when no one asks, LINGER_MS after the apply's process ended.
//
// The level 4 cards are asked as questions of setup's run in the folder, under ASK_STEP: the
// director's answer is then a signed setup-answer the prompt record keeps as it keeps every setup
// question's, which names a step from 1 to 10. Their ids (uninstall-delete-…) keep them apart from
// that step's own questions. An answer counts only if it was given after its card was last asked
// (ruling R117), so a Delete it from an uninstall never applied is never used by a later one.

export const UNINSTALL_FIELDS = Object.freeze(['folder', 'hash']);
export const UNINSTALL_NEEDS_CLICK = `uninstall needs the director's Remove it on its card, from the last ${CLICK_FRESH_MS / 60000} minutes`;
export const UNINSTALL_CHANGED = 'the list has changed since the card: ask for uninstall\'s plan again and show the new card';
export const UNINSTALL_OWN_LIST = 'the helper works out uninstall\'s list itself: a request names only the folder and the hash on the card';
export const UNINSTALL_STOP = { ok: false, refused: 'All stop is on, so nothing is removed: lift All stop first, then ask for uninstall\'s plan again' };
export const UNINSTALL_RUNNING = 'uninstall is already running for this folder: ask for its status';
// Status's and plan's first line for an uninstall that stopped, or did not finish, once a click made
// in this session can no longer count: past the trusted-keys list's removal (rulings R142, R146).
export const UNINSTALL_NEW_SESSION = 'Start a new session on this folder, then ask for uninstall\'s plan again: this computer\'s key for your clicks is gone, so a Remove it clicked in this session can\'t count.';
// The setup step uninstall's level 4 cards are asked under (see above).
export const ASK_STEP = HEALTH_STEP;
// The apply's own process.
export const UNINSTALL_RUN = fileURLToPath(new URL('./uninstall-run.js', import.meta.url));
// How long the helper stays up after the last uninstall finished, when no one asks its status.
export const LINGER_MS = CLICK_FRESH_MS;
const FULL_HASH = /^[0-9a-f]{64}$/;

// Where a folder's uninstall progress is kept.
export const progressFile = (folder) => path.join(wheelhouseHome(), 'setup', 'uninstalls',
  `${crypto.createHash('sha256').update(keyOf(realOr(folder))).digest('hex').slice(0, 16)}.json`);

// A folder's uninstall progress record, or null.
export function readProgress(folder) {
  try {
    const r = JSON.parse(fs.readFileSync(progressFile(folder), 'utf8'));
    return r && typeof r === 'object' && ['running', 'done', 'stopped'].includes(r.state) && typeof r.clickedAt === 'string' ? r : null;
  } catch {
    return null;
  }
}

// Writes a folder's uninstall progress record whole.
export function writeProgress(folder, record) {
  writeWhole(progressFile(folder), `${JSON.stringify(record, null, 2)}\n`);
}

// Whether a Remove it clicked in this session can count: this computer's id, its signing key, and
// that key on the trusted-keys list under that id are all here. Read as they are, so no id is made
// (signing with none here would make a new one, not the enrolled one).
function clickCountsHere() {
  let id;
  let publicKey;
  try {
    id = JSON.parse(fs.readFileSync(computerFile(), 'utf8'))?.id;
    publicKey = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(signingKeyFile()))).export({ type: 'spki', format: 'der' }).toString('base64');
  } catch {
    return false;
  }
  return typeof id === 'string' && readEnrolled().some((e) => e?.computer === id && e?.publicKey === publicKey);
}

// Whether a record says its apply is still running: recorded so, and within its time.
const runningNow = (record, now) => record?.state === 'running' && now().getTime() < Date.parse(record.deadline);

// How a recorded uninstall stands, as lines for the director.
function progressLines(record, now) {
  const pages = (record.pages ?? []).map((p) => `Open ${p.what}: ${p.url}`);
  if (runningNow(record, now)) return [`Uninstall is running, started at ${record.startedAt}: ask for its status again in a minute.`];
  if (record.state === 'running') {
    return [`Uninstall did not finish: it started at ${record.startedAt}, more than ${STEP_TIMEOUT_MS / 60000} minutes ago. Ask for uninstall's plan again for what is left.`, ...(record.lines ?? []), ...pages];
  }
  if (record.state === 'done') return ['Uninstall is done.', ...(record.lines ?? []), ...pages];
  return [record.refused ?? 'Uninstall stopped.', ...((record.lines ?? []).length > 0 ? ['Done before it stopped:', ...record.lines] : []), ...pages];
}

// One line for a change of the list, for `status`.
function entryLine(e, userHome) {
  switch (e.put) {
    case 'stop': return `stop the ${e.what === 'receiver' ? 'usage receiver' : e.what === 'helper' ? 'host helper, after its answer' : e.what === 'foreman' ? 'Bosun' : e.what}`;
    case 'leave-locked': return 'leave Locked (your password)';
    case 'bring-up': return `bring this folder up to ${e.branch}, with every line of the project's private copy`;
    case REMOVE_REMOTE: return `take Wheelhouse's ${e.name} setting out of this folder's git`;
    case 'pull-request': return e.local ? `a last change taking setup's files and pins out of ${e.branch}, merged into this folder` : `a pull request taking setup's files and pins out of ${e.branch}, for you to merge`;
    case 'in-pull-request': return `  in it: ${describe(e.change, userHome)}`;
    case 'close-pull-request': return `close the trial pull request${e.number ? ` ${e.number}` : ''}`;
    case 'delete-branch': return `delete the trial branch ${e.branch}`;
    case 'reverse': return `put back ${describe(e.change, userHome)}`;
    case 'unset-env': return `take ${e.target} out of your account's settings`;
    case 'put-back-own-app': return 'put back your own GitHub App in your settings on this computer';
    case 'delete-key': return e.shared ? 'delete the GitHub app\'s keys from this computer; the app stays installed for your other computers' : 'delete the GitHub app\'s keys, and give its installation page';
    case 'untick-repository': return `give the app's installation page, to untick ${e.repo}`;
    case 'revoke-key': return e.line;
    case 'remove': return e.except ? `remove ${shown(e.target, userHome)}, but for ${e.except.join(' and ')} in it` : `remove ${shown(e.target, userHome)}`;
    case 'remove-empty': return `remove ${shown(e.target, userHome)} once it is empty`;
    case 'remove-plugin': return e.line;
    case 'remove-login-start': return e.kind === 'run-entry'
      ? 'remove the start-up entry that starts Wheelhouse\'s helper when you sign in'
      : `remove ${shown(e.target, userHome)}, which starts Wheelhouse's helper when you sign in`;
    default: return e.put;
  }
}

// The whole list as plain lines: what uninstall's card names by groups and counts.
export function planLines(got, folder, userHome) {
  const name = got.card.target.project;
  return [
    `Uninstall of ${name} (${folder}), its list ${got.hash.slice(0, 12)}:`,
    ...got.changes.flatMap((e, i) => [`${i + 1}. ${entryLine(e, userHome)}`, ...(e.put === 'pull-request' ? archiveLines(e.archive) : [])]),
    ...got.keep.map((k) => `Stays: ${k.what}: ${k.why}`),
    ...got.asks.map((a) => `Its own card: ${a.card.what}`),
    ...(got.done.length > 0 ? [`Nothing left to put back for ${got.done.reduce((n, d) => n + d.ids.length, 0)} of setup's changes`] : []),
  ];
}

// The helper's uninstall routes, each taking the request's body and giving its answer; a refusal
// throws SetupRefusal, which the helper sends as { ok: false, refused }. `spawn` starts the apply's
// process (a test may run it in its own); `stopHelper` is what stops the helper once the last
// uninstall has finished and its status was not asked for within `lingerMs`.
export function uninstallRoutes({
  now = () => new Date(), stopped = () => false, stopRefusal = UNINSTALL_STOP, userHome = os.homedir(), platform = process.platform,
  run = realRun, spawn = nodeSpawn, stopHelper = () => {}, lingerMs = LINGER_MS,
} = {}) {
  const running = new Set();
  let lingering = null;
  const only = (body, fields) => {
    if (Object.keys(body).some((k) => !fields.includes(k))) throw new SetupRefusal(UNINSTALL_OWN_LIST);
  };
  const planFor = (folder) => uninstallPlan({ folder, userHome, platform, run });
  const openRunOf = (folder) => readJournal().runs.filter((r) => typeof r?.folder === 'string' && !runClosed(r) && keyOf(realOr(r.folder)) === keyOf(folder)).at(-1) ?? null;
  // Marks a finished last uninstall's record as having stopped the helper; true when this call did.
  // `seen` is the record an answer was made from: the stop is claimed only when that record gave
  // the end, so an answer saying it still runs never stops the helper, even when the process
  // finished while that answer was being made.
  const claimStop = (folder, seen) => {
    const record = readProgress(folder);
    const ends = (r) => r?.state === 'done' && r.helperStops === true && r.helperStoppedAt === undefined;
    if (!ends(record) || (seen !== undefined && (!ends(seen) || seen.clickedAt !== record.clickedAt))) return false;
    writeProgress(folder, { ...record, helperStoppedAt: now().toISOString() });
    clearTimeout(lingering);
    return true;
  };

  // Whether a folder's recorded uninstall still stands for it: while it runs, or until another card
  // has been shown since it started.
  const standing = (folder, record) => {
    const shown = uninstallShownFor(folder);
    return record !== null && (runningNow(record, now) || shown === null || (shown.hash === record.hash && Date.parse(shown.at) <= Date.parse(record.startedAt)));
  };
  // Whether a recorded uninstall stopped, or did not finish in its time.
  const cutShort = (record) => record.state === 'stopped' || (record.state === 'running' && !runningNow(record, now));
  // Cut short past the trusted-keys list's removal: no Remove it clicked in this session can count,
  // so status and plan both say first to start a new session, never to ask the card again (rulings
  // R142, R146).
  const newSessionFirst = (record) => cutShort(record) && !clickCountsHere();
  // How a cut-short uninstall stands, then what is left.
  const cutShortLines = async (folder, record) => [
    ...(newSessionFirst(record) ? [UNINSTALL_NEW_SESSION] : []), ...progressLines(record, now),
    'What is left:', ...planLines(await planFor(folder), folder, userHome),
  ];

  async function plan(body) {
    only(body, ['folder']);
    const folder = admitFolder(body.folder, { userHome });
    // Past the trusted-keys list's removal, status's lines and no card: a Remove it clicked here
    // could not be signed. Nothing is noted as shown or asked then.
    const record = readProgress(folder);
    if (standing(folder, record) && newSessionFirst(record)) return { ok: true, lines: await cutShortLines(folder, record) };
    const got = await planFor(folder);
    // The card as the director sees it, cleaned before it is composed, so the stored card is the
    // one sent (ruling R33).
    const card = composeCard(cleanDeep(got.card, [])).question;
    if (JSON.stringify(cleanDeep(card, [])) !== JSON.stringify(card)) throw new Error('Uninstall\'s card could not be cleaned as it is sent');
    noteUninstallShown({ project: got.card.target.project, folder, hash: got.hash, card, now });
    const open = openRunOf(folder);
    const asks = open === null ? [] : got.asks.map((a) => {
      const asked = composeCard({ ...cleanDeep(a.card, []), kind: 'question', suggest: false }).question;
      noteAsked({ runId: open.id, folder: open.folder, step: ASK_STEP, id: a.id, card: asked, now });
      return { id: a.id, about: a.about, card: asked };
    });
    return { ok: true, hash: got.hash, card, asks, last: got.last };
  }

  async function apply(body) {
    if (stopped()) return stopRefusal;
    only(body, UNINSTALL_FIELDS);
    const folder = admitFolder(body.folder, { userHome });
    if (typeof body.hash !== 'string' || !FULL_HASH.test(body.hash)) throw new SetupRefusal('the hash must be the full hash of the list on uninstall\'s card');
    const key = keyOf(folder);
    if (running.has(key) || runningNow(readProgress(folder), now)) throw new SetupRefusal(UNINSTALL_RUNNING);
    running.add(key);
    try {
      // The list as it is now, worked out here with the same home and system the card's was.
      const got = await planFor(folder);
      const project = got.card.target.project;
      const shownNow = uninstallShownFor(folder);
      if (got.hash !== body.hash || shownNow?.hash !== got.hash || shownNow.project !== project) throw new SetupRefusal(UNINSTALL_CHANGED);
      // STOP is read again at the last moment, before the click is used.
      if (stopped()) return stopRefusal;
      const click = freshUninstallClicks({ project, hash: got.hash, now }).find((e) => useClick(e, now));
      if (!click) throw new SetupRefusal(UNINSTALL_NEEDS_CLICK);
      const clickedAt = new Date(click.at).toISOString();
      const deadline = new Date(Date.parse(clickedAt) + STEP_TIMEOUT_MS).toISOString();
      try {
        writeProgress(folder, { folder, project, hash: got.hash, clickedAt, deadline, startedAt: now().toISOString(), state: 'running', lines: [], pages: [] });
      } catch (error) {
        releaseClick(click);
        throw new SetupRefusal(`uninstall could not be recorded as started, so it did not start and the click can be used again: ${error instanceof Error ? error.message : 'its record could not be written'}`);
      }
      const failed = () => {
        const record = readProgress(folder);
        if (record?.clickedAt === clickedAt && record.state === 'running') writeProgress(folder, { ...record, state: 'stopped', refused: 'Uninstall stopped: its process could not be started. Ask for uninstall\'s plan again.' });
      };
      // Once its process has ended, a last uninstall that finished stops the helper, unless its
      // status is asked for first (which stops it after that answer).
      const ended = () => {
        const record = readProgress(folder);
        if (record?.clickedAt !== clickedAt || record.state !== 'done' || record.helperStops !== true) return;
        clearTimeout(lingering);
        lingering = setTimeout(() => { if (claimStop(folder)) stopHelper(); }, lingerMs);
        lingering.unref?.();
      };
      try {
        const child = spawn(process.execPath, [UNINSTALL_RUN, folder, got.hash, clickedAt, deadline, userHome], {
          cwd: jobFolder(), detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
        });
        child?.on?.('error', failed);
        child?.on?.('exit', ended);
        child?.unref?.();
      } catch {
        failed();
      }
      return { ok: true, started: true };
    } finally {
      running.delete(key);
    }
  }

  async function status(body) {
    only(body, ['folder']);
    // A folder uninstall has finished with is no longer one setup acts on, but its end is still told.
    let folder;
    try {
      folder = admitFolder(body.folder, { userHome });
    } catch (error) {
      if (typeof body.folder !== 'string' || !path.isAbsolute(body.folder) || readProgress(realOr(body.folder)) === null) throw error;
      folder = realOr(body.folder);
    }
    const record = readProgress(folder);
    if (standing(folder, record)) {
      const lines = cutShort(record) ? await cutShortLines(folder, record) : progressLines(record, now);
      const { state, refused, pages = [] } = record;
      const answer = { ok: true, lines, uninstall: { state: runningNow(record, now) || state !== 'running' ? state : 'stuck', lines: record.lines ?? [], pages, ...(refused ? { refused } : {}) } };
      // The answer that gives a finished last uninstall stops the helper once it is sent.
      return claimStop(folder, record) ? { ...answer, helperStops: true } : answer;
    }
    return { ok: true, lines: planLines(await planFor(folder), folder, userHome) };
  }

  return { '/setup/uninstall/plan': plan, '/setup/uninstall/apply': apply, '/setup/uninstall/status': status };
}
