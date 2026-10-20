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
// project's folder, which is the project's); the profile's clone and profile.json;
// the profile repository; the app's keys and the profile's own GitLab key; the own app recorded in
// the profile; this computer's enrolment; and, recorded nowhere, the trusted-keys list and then the
// signing key beside it, removed last of all (ruling R123), after every change that can stop
// uninstall, so an uninstall cut short can still be clicked again. The list goes first (ruling
// R128): one that could not be removed leaves the key it trusts, and a key left after the list has
// gone is trusted again by the next session start, so either way the next click can be signed and
// checked. Wheelhouse's own folders and files (the tools it fetched, the profile's clone and
// profile.json, setup's clicks, answers and the like, the trust clicks and the record of the
// profile's enrolments last fetched, the Windows installer's temporary folder, and the project's own
// folder under projects/) are removed whole, never named as changed since setup. journal.json, and uninstall's own progress record, are kept.
//
// The setup commit counts as on the host only when the journal or the folder shows it went up:
// step 7 finished, or recorded protection after the push, or the folder's copy of the
// branch on the host holds it, or uninstall's own look found it there (the push's onHost mark,
// ruling R122). Step 7 records the push before making it, so a push that failed leaves the files
// and pins to be put back here, and the commit named as kept in the folder.
//
// A shared project (ruling R124): this computer joined a project another set up, or it trusts
// another computer's key. Then the project and its committed files, the state branch, the profile
// and the app's installation are other computers' too: the files stay as committed (no pull
// request), no Delete card is offered for what is on the host, the app's installation is left as it
// is (no untick, no Uninstall), and only this computer's own enrolment is withdrawn.
//
// What each kind gives (R87): see the entries below. The order is binding (R89): Stop, Locked, the
// project's files (a pull request the director merges), this computer, keys, kept, last; newest
// first within a phase; then the trusted-keys list and the signing key; the helper stops last of
// all, after its answer.
//
//   Plan = {
//     project: string | null,  the registered project the folder is, or null
//     last: boolean,           no other project on this computer (ruling R114)
//     shared: boolean,         other computers use the project too (ruling R124)
//     changes: Entry[],        in the order they are applied
//     keep: Array<{ what, why, brief?, ids? }>,   left as they are; each changed since setup is
//                              named on the card, by `brief` where it is given
//     asks: Array<{ id, about, phase: 'kept', put, target, ids, card }>,   level 4 cards (a question's
//                              input), recommended Keep: the product's repository setup made, the
//                              state branch, and on the last project the profile repository
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
//       'stop' { what: foreman | watcher | receiver | helper }
//       'leave-locked' { project }           leaveLocked, with the director's password
//       'pull-request' { target, branch, base }   the uninstall pull request, taking out every
//                                            'in-pull-request' entry by its change's `before`; its
//                                            ids hold theirs too, so they are marked with it
//       'in-pull-request' { change }         a project file or pin, taken out by that pull request
//       'close-pull-request' { repo, number?, branch? }, 'delete-branch' { repo, branch, sha }
//       'reverse' { change }                 reverseChange, here (a pin with no pull request: its
//                                            key in the project's settings, as a json-key change)
//       'unset-env' { target, where }        only while it still holds what setup set
//       'put-back-own-app' { change }        own-app.js's putBackOwnApp
//       'remove-enrolment' { target }        this computer's key off the profile, with the sign-in
//       'delete-key' { key, shared? }        the keys deleted; for github-app, the installation's
//                                            page given, to uninstall the app there, unless shared
//       'untick-repository' { key, repo }    while another project stays, on a project not shared:
//                                            the installation's settings page given, to untick
//                                            this repository
//       'revoke-key' { key, pasted, line }   a GitLab key revoked through the API, then deleted
//       'remove' { target }                  a file, or a folder whole, of Wheelhouse's own
//       'remove-plugin' { line }             the line the director follows in Claude Desktop
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run as realRun } from '../lib/run.js';
import { wheelhouseHome, keysDir, profileDir, projectsDir, computerId } from '../lib/paths.js';
import { projectForFolder, registeredProjects } from '../lib/projects.js';
import { listHash } from '../lib/setup-writes.js';
import { joinedRepo, runClosed, HEALTH_STEP } from '../lib/setup-run.js';
import { clicksDir, usedDir, shownDir, askedDir, answersDir, answeredDir, writeWhole } from '../lib/setup-clicks.js';
import { HOST_TOOLS, toolFolder } from '../lib/host-tools.js';
import { trustDir, seenFile } from '../lib/trust-clicks.js';
import { STATE_BRANCH } from '../state/clone.js';
import { enrolledFile, signingKeyFile, readEnrolled } from '../state/signing.js';
import { CLICK_FRESH_MS, RETENTION_DAYS, STEP_TIMEOUT_MS } from '../lib/setup-numbers.js';
import { canonicalJson } from '../lib/canonical.js';
import { cleanDeep } from '../lib/clean.js';
import { composeCard } from '../cards/compose.js';
import { readProfileViews } from '../profile/store.js';
import { readJournal, heldNow } from './journal.js';
import { launchVarState } from './telemetry.js';
import { PROFILE_TARGET, acceptedOwnApp } from './own-app.js';
import { PROFILE_REPO } from './host.js';
import { SETUP_FILES } from './project-files.js';
import { noteAsked, noteUninstallShown, uninstallShownFor, freshUninstallClicks, useClick, releaseClick } from './clicks.js';
import { admitFolder, SetupRefusal } from './engine.js';

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
// The level 4 cards' order: the product's repository, the state branch, the profile.
const ASK_ORDER = ['product', 'state', 'profile'];
export const HOSTS = { github: 'GitHub', gitlab: 'GitLab' };
const KEEP_LABEL = 'Keep it';
// Why a commit setup made in the folder, never pushed, is kept: apply looks for it on the host first.
export const NEVER_PUSHED = 'it stays in this folder\'s history';
// Why what other computers use stays as it is, on a shared project (ruling R124).
const OTHERS_USE = 'your other computers use it, so it stays';
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
  if (c.kind === 'folder') return samePath(c.target, profileDir()) || within(path.join(wheelhouseHome(), 'tools'), c.target);
  if (c.kind !== 'host') return false;
  if (c.target === 'key github-app' || c.target === PROFILE_TARGET) return true;
  if (/^key gitlab-project-\d+$/.test(c.target)) return repoName(c.after?.project) === PROFILE_REPO;
  const h = hostTarget(c.target);
  return h !== null && (h.file === null ? repoName(h.repo) === PROFILE_REPO : h.file.startsWith('enrolments/'));
}

// A path for the card, with the home folder as ~.
function shown(p, userHome) {
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

// The card's first part: the groups with their counts, then each item left because it changed
// since setup while there is room, then how many more and where to read them (ruling R90), what
// else stays, and the retention line (R64).
function cardWhat({ name, changes, keep, asks, pullRequest }) {
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
    files > 0 ? (pullRequest ? `take out ${plural(files, 'file')} and pins by a pull request you merge` : `put back ${plural(files, 'file')}`) : null,
    trial > 0 ? 'clear its trial' : null,
    computer > 0 ? `put back ${plural(computer, 'change')} on this computer` : null,
    keys > 0 ? `delete or untick ${plural(keys, 'key')}` : null,
    removed > 0 ? `remove ${removed} of Wheelhouse's folders` : null,
  ].filter(Boolean);
  const head = `Remove Wheelhouse from ${name}: ${groups.join(', ')}.`;
  const changed = keep.filter((k) => k.why === 'changed since setup').map((k) => k.brief ?? k.what);
  const others = keep.length - changed.length;
  const tail = `${others > 0 ? ` ${plural(others, 'other thing')} stay as they are.` : ''}${asks.length > 0 ? ' Repositories and records stay unless their own cards say otherwise.' : ''} ${TRANSCRIPTS}`;
  const left = (list) => {
    const more = changed.length - list.length;
    if (changed.length === 0) return '';
    return ` Left as you changed them: ${[...list, ...(more > 0 ? [`and ${more} more: cli.js uninstall status`] : [])].join('; ')}.`;
  };
  let fitting = changed;
  while (fitting.length > 0 && (head + left(fitting) + tail).length + name.length > WHAT_CHARS) fitting = fitting.slice(0, -1);
  return `${head}${left(fitting)}${tail}`;
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

// What uninstall would do for the folder, worked out without changing anything: the same world
// gives the same list and hash. `userHome` shortens paths on the card; `platform` and `run` read an
// account variable setup set (launchctl or the Windows user variable), changing nothing.
export async function uninstallPlan({ folder, userHome = os.homedir(), platform = process.platform, run = realRun } = {}) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Uninstall needs the project\'s folder, as a full path');
  const real = realOr(folder);
  const own = projectForFolder(real);
  const slug = own?.project ?? null;
  const journal = readJournal();
  const mine = (r) => typeof r?.folder === 'string' && keyOf(realOr(r.folder)) === keyOf(real);
  // The last project on this computer: no other registered, and no other folder whose setup run
  // isn't closed, so a half set-up folder keeps what it needs (ruling R114).
  const others = registeredProjects().filter((p) => p.project !== slug);
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
  const shared = joining || (trusted.length > 0 && trusted.some((e) => typeof e?.computer === 'string' && e.computer !== computerId()));

  const items = []; // { phase, seq, entry }
  const keep = [];
  const asks = [];
  const done = [];
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
      if (pushed && shared) {
        committed = true;
        kept(`setup's commit on ${branch}`, `it stays in the project's history: ${OTHERS_USE}`, idsOf(commitGroup));
      } else if (pushed) pullRequest = true;
      else kept(`setup's commit on ${branch}, never pushed`, NEVER_PUSHED, idsOf(commitGroup));
    } else if (refOf(real, `refs/heads/${branch}`) === commitGroup[0].c.before?.sha) settled(idsOf(commitGroup), 'the commit was never made');
    else kept(`setup's commit on ${branch}, never pushed`, NEVER_PUSHED, idsOf(commitGroup));
  }
  const sharedFile = (target) => SETUP_FILES.some((rel) => samePath(target, path.join(real, ...rel.split('/'))));
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
          remove(c.target, 'last', list, at);
          break;
        }
        if (slug !== null && within(projectFolder(slug), c.target)) {
          remove(projectFolder(slug), 'last', list, at);
          break;
        }
        const inProject = sharedFile(c.target);
        if (inProject && committed) {
          kept(describe(c, userHome), 'the project\'s own file, as committed: it stays', list);
          break;
        }
        const walked = walkChain(group);
        if (walked.why !== undefined) {
          kept(describe(c, userHome), walked.why, list, brief(c));
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
        else if (slug !== null && within(projectFolder(slug), c.target)) remove(projectFolder(slug), 'last', list, at);
        else if (samePath(c.target, profileDir()) || within(path.join(wheelhouseHome(), 'tools'), c.target) || typeof c.after?.installer === 'string') remove(c.target, 'last', list, at);
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
          else kept('your own GitHub App in your profile', 'changed since setup', list, 'own-github-app');
        } else if (c.target === 'key github-app') add('keys', at, { put: 'delete-key', key: 'github-app', before: one.before, ids: list, ...(shared ? { shared: true } : {}) });
        else if (/^key gitlab-project-\d+$/.test(c.target)) {
          const pasted = c.after?.kind === 'pasted-token';
          add('keys', at, {
            put: 'revoke-key', key: c.target.slice('key '.length), pasted, before: one.before, ids: list,
            line: pasted ? 'The GitLab token you pasted is revoked, which stops it everywhere it is used' : 'The project\'s GitLab key is revoked, then deleted',
          });
        } else if (h !== null && h.file?.startsWith('enrolments/')) add('computer', at, { put: 'remove-enrolment', target: c.target, ids: list });
        else if (h !== null && h.file === null && one.after?.made === true && shared) kept(`${h.repo} on ${HOSTS[h.host]}`, OTHERS_USE, list);
        else if (h !== null && h.file === null && one.after?.made === true) {
          const profile = repoName(h.repo) === PROFILE_REPO;
          asks.push({
            id: askId(c.target), about: profile ? 'profile' : 'product', phase: 'kept', put: 'delete-repository', target: c.target, ids: list,
            card: deleteCard(profile ? {
              what: `Delete ${h.repo} on ${HOSTS[h.host]}, your Wheelhouse profile, which setup made?`,
              why: 'It holds your profile and backups for every project and computer, and a deleted repository can\'t be brought back, so it is your call.',
              keeps: `${h.repo} stays on ${HOSTS[h.host]}, for any project you set up again.`,
              deletes: `${HOSTS[h.host]}'s settings page for it opens, where you click Delete yourself.`,
              because: 'your profile and backups can\'t be brought back once deleted',
            } : {
              what: `Delete ${h.repo} on ${HOSTS[h.host]}, the repository setup made for this product?`,
              why: 'It holds your product\'s code and history, and a deleted repository can\'t be brought back, so it is your call.',
              keeps: `${h.repo} and its history stay on ${HOSTS[h.host]}.`,
              deletes: `${HOSTS[h.host]}'s settings page for it opens, where you click Delete yourself.`,
              because: 'your product\'s history can\'t be brought back once deleted',
            }),
          });
        } else if (one.after?.action === 'protect') kept(`protection on ${one.after.branch} of ${c.target.replace(/ protection$/, '')}`, 'left on, as the host keeps it', list);
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
    add('files', seqOf(commitGroup), { put: 'pull-request', kind: 'host', target: c.target, branch: c.after.branch, base: c.before?.sha ?? null, ids: [...idsOf(commitGroup), ...takes] });
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

  // The project's own folder under projects/, and on the last project Wheelhouse's own folders and
  // files, recorded or not; the trusted-keys list, then the signing key beside it, go last of all
  // (rulings R123, R128), below.
  if (slug !== null) remove(projectFolder(slug), 'last');
  const closing = last ? [enrolledFile(), signingKeyFile()].filter(exists).map((target) => ({ phase: 'last', put: 'remove', target })) : [];
  if (last) {
    for (const p of [...HOST_TOOLS.map(toolFolder), profileDir(), profileFile()]) if (exists(p)) remove(p, 'last');
    // Setup's own records are listed whether they are there yet or not: showing uninstall's card
    // and clicking it write them, and the list must be the same before and after.
    // The trust clicks and the record of the profile's enrolments last fetched (the session start's)
    // too, Wheelhouse's own (ruling R86).
    for (const p of [clicksDir(), usedDir(), shownDir(), askedDir(), answersDir(), answeredDir(), trustDir(), seenFile()]) remove(p, 'last');
  } else {
    kept('Wheelhouse\'s helper, telemetry, tools, profile and this computer\'s signing key', `another project on this computer, or one being set up, still uses them${deferred > 0 ? ` (${deferred} change${deferred === 1 ? '' : 's'} of this computer's)` : ''}`);
  }
  // The project's folder first in its phase, as the newest, then the others in their order.
  const projectKey = slug === null ? null : resolved(projectFolder(slug));
  for (const [key, r] of removals) add(r.phase, key === projectKey ? Number.MAX_SAFE_INTEGER : r.seq, { put: 'remove', target: r.target, ...(r.ids.length > 0 ? { ids: r.ids } : {}) });

  // The state branch, while the project is registered, and on the last project the profile, each
  // asked about on its own card; neither is deleted otherwise (ruling R92). On a shared project the
  // other computers use the state branch: it is not offered (ruling R124).
  if (own !== null && shared) kept(`the ${STATE_BRANCH} branch of ${own.record.repo} on ${HOSTS[own.record.host]}`, OTHERS_USE);
  if (own !== null && !shared) {
    const host = own.record.host;
    asks.push({
      id: askId(`${host}:${own.record.repo}:${STATE_BRANCH}`), about: 'state', phase: 'kept', put: 'delete-branch', target: `${host}:${own.record.repo}:${STATE_BRANCH}`, ids: [],
      card: deleteCard({
        what: `Delete the ${STATE_BRANCH} branch of ${own.record.repo} on ${HOSTS[host]}, where this project's decisions and records are kept?`,
        why: 'Your other computers may use it too, and once deleted its records can\'t be brought back, so it is your call.',
        keeps: 'The branch and its records stay, for this project set up again or on another computer.',
        deletes: 'Wheelhouse deletes the branch, with your own sign-in.',
        because: 'the project\'s records can\'t be brought back once deleted',
      }),
    });
  }
  asks.sort((a, b) => ASK_ORDER.indexOf(a.about) - ASK_ORDER.indexOf(b.about));

  // In order: the phases, newest first within each; Stop and the line for Desktop around them, and
  // the helper last of all, after its answer.
  const stops = [
    ...(slug !== null ? ['foreman', 'watcher'] : []),
    ...(last ? ['receiver'] : []),
  ].map((what) => ({ phase: 'stop', put: 'stop', what }));
  const ordered = PHASES.filter((p) => p !== 'stop').flatMap((phase) => items.filter((i) => i.phase === phase)
    .sort((a, b) => b.seq - a.seq).map((i) => i.entry));
  const changes = [
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
  const card = {
    kind: 'uninstall',
    level: 4,
    target: { project: name, hash },
    what: cardWhat({ name, changes, keep, asks, pullRequest }),
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
    meanwhile: 'Nothing changes until you click; if STOP is on, lift it first.',
    // Said only when the checks really go: never on a shared project (ruling R124).
    checks: shared
      ? 'Your other computers keep the checks for this project; they stop on this computer only, and protection stays as it is.'
      : pullRequest
        ? 'Once the pull request is merged, the checks no longer guard this project; protection stays on.'
        : 'The checks no longer guard this project; protection stays as it is.',
  };
  return { project: slug, last, shared, changes, keep, asks, done, card, hash };
}

// ---- The helper's routes (Task 15b, rulings R87 to R92, R116 to R118) ----
//
// The helper's routes /setup/uninstall/plan | apply | status (uninstallRoutes, wired in
// scripts/host/helper.js; `cli.js uninstall plan | apply <hash> | status` asks them):
//   plan   { folder }        -> { ok, hash, card, asks: [{ id, about, card }], last }: the list worked
//                               out, its card composed (cleaned first) and kept as shown for the
//                               folder (noteUninstallShown), and each level 4 card asked; read-only
//                               but for setup's own records, so it answers under STOP
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
export const UNINSTALL_STOP = { ok: false, refused: 'STOP is on, so nothing is removed: lift STOP first, then ask for uninstall\'s plan again' };
export const UNINSTALL_RUNNING = 'uninstall is already running for this folder: ask for its status';
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
    case 'stop': return `stop the ${e.what === 'receiver' ? 'usage receiver' : e.what === 'helper' ? 'host helper, after its answer' : e.what}`;
    case 'leave-locked': return 'leave Locked (your password)';
    case 'pull-request': return `a pull request taking setup's files and pins out of ${e.branch}, for you to merge`;
    case 'in-pull-request': return `  in it: ${describe(e.change, userHome)}`;
    case 'close-pull-request': return `close the trial pull request${e.number ? ` ${e.number}` : ''}`;
    case 'delete-branch': return `delete the trial branch ${e.branch}`;
    case 'reverse': return `put back ${describe(e.change, userHome)}`;
    case 'unset-env': return `take ${e.target} out of your account's settings`;
    case 'put-back-own-app': return 'put back your own GitHub App in your profile';
    case 'remove-enrolment': return 'take this computer\'s key out of your profile';
    case 'delete-key': return e.shared ? 'delete the GitHub app\'s keys from this computer; the app stays installed for your other computers' : 'delete the GitHub app\'s keys, and give its installation page';
    case 'untick-repository': return `give the app's installation page, to untick ${e.repo}`;
    case 'revoke-key': return e.line;
    case 'remove': return `remove ${shown(e.target, userHome)}`;
    case 'remove-plugin': return e.line;
    default: return e.put;
  }
}

// The whole list as plain lines: what uninstall's card names by groups and counts.
export function planLines(got, folder, userHome) {
  const name = got.card.target.project;
  return [
    `Uninstall of ${name} (${folder}), its list ${got.hash.slice(0, 12)}:`,
    ...got.changes.map((e, i) => `${i + 1}. ${entryLine(e, userHome)}`),
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
  const claimStop = (folder) => {
    const record = readProgress(folder);
    if (record?.state !== 'done' || record.helperStops !== true || record.helperStoppedAt !== undefined) return false;
    writeProgress(folder, { ...record, helperStoppedAt: now().toISOString() });
    clearTimeout(lingering);
    return true;
  };

  async function plan(body) {
    only(body, ['folder']);
    const folder = admitFolder(body.folder, { userHome });
    const got = await planFor(folder);
    // The card as the director sees it, cleaned before it is composed, so the stored card is the
    // one sent (ruling R33).
    const card = composeCard(cleanDeep(got.card, [])).question;
    if (JSON.stringify(cleanDeep(card, [])) !== JSON.stringify(card)) throw new Error('Uninstall\'s card could not be cleaned as it is sent');
    noteUninstallShown({ project: got.card.target.project, folder, hash: got.hash, card, now });
    const open = openRunOf(folder);
    const asks = open === null ? [] : got.asks.map((a) => {
      const asked = composeCard({ ...cleanDeep(a.card, []), kind: 'question' }).question;
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
          cwd: wheelhouseHome(), detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
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
    const shown = uninstallShownFor(folder);
    // The recorded uninstall, while it runs, or until another card has been shown since it started.
    const since = shown === null || (shown.hash === record?.hash && Date.parse(shown.at) <= Date.parse(record.startedAt));
    if (record !== null && (runningNow(record, now) || since)) {
      const lines = progressLines(record, now);
      if (record.state === 'stopped' || (record.state === 'running' && !runningNow(record, now))) {
        lines.push('What is left:', ...planLines(await planFor(folder), folder, userHome));
      }
      const { state, refused, pages = [] } = record;
      const answer = { ok: true, lines, uninstall: { state: runningNow(record, now) || state !== 'running' ? state : 'stuck', lines: record.lines ?? [], pages, ...(refused ? { refused } : {}) } };
      // The answer that gives a finished last uninstall stops the helper once it is sent.
      return claimStop(folder) ? { ...answer, helperStops: true } : answer;
    }
    return { ok: true, lines: planLines(await planFor(folder), folder, userHome) };
  }

  return { '/setup/uninstall/plan': plan, '/setup/uninstall/apply': apply, '/setup/uninstall/status': status };
}
