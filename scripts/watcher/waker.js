// scripts/watcher/waker.js
// Waking the foreman or one feature session (build-loop design, section 11),
// by the route check 27 found. Both shapes are built, chosen by the project's
// `config.watcherShape`, until check 27's Windows half picks one:
//
//   Shape 1, the `print` route. The watcher starts each session itself, as a
//   detached process with no window:
//     - the foreman: a fresh `claude -p "Wheelhouse foreman: follow
//       wheelhouse:foreman to handle <file>. First run: <wake command> read
//       <file>"` (see PROMPTS)
//       in the project's main checkout, with the foreman's model and effort
//       from the Thoroughness column in force (below), `--permission-mode` from `config.sessionMode`,
//       `--allowedTools` from `foremanTools` when there are any, and
//       WHEELHOUSE_ROLE=foreman in its environment;
//     - a new feature: `claude -p --session-id <id> "Read
//       .wheelhouse/feature/brief.md and follow it."` in its worktree. The id
//       is made here and kept in the watcher's own folder;
//     - a feature: `claude -p --resume <that id> "Wheelhouse: read <file>"` in
//       its worktree. Only the id the watcher kept is resumed, never one from
//       a file the session can write. The mode and model are given again,
//       since check 27 found `--resume` needs them.
//     A feature session gets the `feature` role's model and effort from the column in force
//     and the feature allow rules with --allowedTools, since `claude -p` does
//     not apply the allow rules of a committed .claude/settings.json (check
//     25). On Windows they follow the level of build commands on this computer
//     and the director's grants (design section 12.2, settings.js): an Allow
//     this time grant goes to one run only, and is recorded as used in
//     projects/<p>/watcher/grants-used.json before that run starts, so no
//     later run gets it again. At Guarded the worktree is labelled for the low
//     runner (scripts/windows/low.js) before each run starts; a run whose
//     worktree can't be labelled gets the Ask rules, and the watcher's log
//     says so. Its mode may not be `auto`.
//     One process runs at a time for each session: a wake that falls due while
//     its session runs waits, and goes when the process has ended. Several that
//     waited together go as one wake listing them all (`merged`).
//   Shape 2. The watcher starts nothing. It prints one line for each wake,
//   through `print` (stdout unless another printer is given), which the mod in
//   the long-lived foreman session hands it as a prompt (scripts/mod/watch.js):
//     WAKE foreman <file> | WAKE feature <work> <file> | START feature <work> <worktree>
//
// Every started session gets the watcher's environment less the variables a
// host Claude Code session sets (scripts/lib/claude.js) and less
// WHEELHOUSE_ROLE; the foreman alone gets WHEELHOUSE_ROLE=foreman.
//
// The command lines above, and the environments, are built by the adapter of
// the agent the project runs on this computer (adapters/claude-code/sessions.js
// for Claude Code, found by scripts/agents/project-agent.js); the waker gives it
// the prompt, the foreman's tools or the feature's allow rules, and runs what it
// is given. The allow rules stay here: they follow the build-command levels.
// Every feature call is also given its level's inputs, read here on every
// system (levelInputs), for an adapter that works out its own rules; Claude
// Code's ignores them.
//
// What an adapter may add (ruling P8-2), each asked for only when it is there:
//   - `prepare({ project, target })`, run before every start: a throw refuses
//     the start before anything is run, the error's `records` are raised, each
//     once, and its `raised(record)`, when it has one, is told of each once it
//     is in the state; a prepare that answers `{ lifted: true }` removed a hold
//     of the project's, and its lift is recorded (liftHolds);
//   - a call's `output`, a file the child's stdout and stderr are appended to,
//     with `afterRun({ stdout, code, call, target, project, at })` reading what the run
//     appended once it ends: its `{ ok, why }` settles the wakes in place of the
//     exit code, its `records` are written through `raise`, and, for a call
//     with `idFromRun`, its `sessionId` is the one kept for the feature's wakes
//     (ruling P8-3). A run whose exit this watcher didn't see (one the
//     foreman's command started, or one from before a restart) is read the same
//     way once its record ends;
//   - `pruneActivity({ project, now })`, called by prune;
//   - `takesColumn: true`, for an agent whose sessions pass each subagent its model and effort (Claude Code's): only
//     then does a feature's prompt carry the Thoroughness column's lines, and a Shape 2 wake's copy its `column`;
//     another agent's prompt stays one line naming its file, as a .cmd shim needs;
//   - `grantProofs`, the proofs an answer must name for its build-command grant to count (buildGrants'
//     `proofs`, ruling P8-8): an agent whose hooks don't sign counts only a click in the helper's own window.
//     Without it, every verified answer counts, as before.
// A feature call that says the level it runs at (`level`) has it recorded as a
// `level` record when it changes (ruling P8-5).
//
// The Thoroughness column (design section 14.6). At every start of the foreman
// or a feature session, at Shape 1, the waker reads the column in force
// (`routing`, by default scripts/routing/in-force.js's routingInForce: the
// level and premium settings, and the columns whose evaluation passed on the
// pins in force) and gives the adapter the role's model, thinking effort and
// fallback: `foreman` for the foreman, `feature` for a feature session. A
// feature's prompt also carries the column for the subagents it dispatches
// (columnLines), when its adapter says it takes it (`takesColumn`). At Shape 2,
// whose wake lines must stay one line, the column goes as `column` in the
// copy of each wake the session reads, and in a wake of its own written into
// a feature's wakes folder before its START line. A session already running is never changed: it keeps what it
// started with until its next start. The column's own lines (a level that
// isn't ready, say) go to `onNote`, the watcher's log, once each time they
// change. Anything that can't be read gives Balanced.
//
// The wake files. The record of each wake is written under the watcher's
// folder, projects/<p>/watcher/wakes/, which no session can read or write.
// What a session is told to read is a copy of it in a folder of its own: the
// main checkout's `.wheelhouse/foreman/wakes/` (git-ignored through
// info/exclude) for the foreman, the worktree's `.wheelhouse/feature/wakes/`
// for a feature. Each folder must be a real folder whose real path is where it
// should be, checked again just before and after each copy (see copyWake).
// Merging reads only the records, never a copy.
//
// The outbox. Every wake goes into projects/<p>/watcher/outbox.json first.
// When its session is started it is marked in flight, and it leaves the
// outbox only when that process exits with 0 (or, for a run whose output is
// kept, when its adapter's afterRun reads it as done). A process that exits otherwise,
// or cannot be started, puts its wakes back with a wait of 1, 5, then 15
// minutes; from the third failure on, each is reported (health.json's
// `lastError`) and it keeps trying every 15 minutes. A watcher that restarts
// cannot learn an exit code, so a wake whose process has gone is sent again.
// A wake may therefore repeat, and never goes missing. An outbox that is there
// but cannot be read is never overwritten: the call throws.
//
// What runs is recorded in projects/<p>/watcher/running/: a `starting` record
// before the process is started, replaced by its pid and start time after. A
// record ends when its process has gone, when it was made before the computer
// last started, when the running process's start time is not the recorded one
// (its pid was reused), or when its maximum run time has passed: 60 minutes
// for the foreman, 8 hours for a feature. An overrun is reported. A record
// with no start time to be had ends at the time limit alone. A `starting`
// record names no process yet: it ends after 2 minutes, and its wakes go
// again. Start times are asked for every running pid in one call (`ps`, or
// one PowerShell call on Windows) and kept for a minute.
//
// Before every wake of a feature, at either shape, the files in its worktree
// that steer agents are read (control-files.js) and compared with the record
// kept when the worktree was made. A new or changed one, or no record at all,
// fails the wake and does not wake: `raise` is given a `control-file` record
// once for each work and finding, for the director's card, and the wake waits
// and is tried again. Once the files match again the wake goes, and `raise`
// is given a `control-file-lift`, which closes the card. The director's Keep
// (a signed `keep-control-files` action, from a signed click on Claude Code or
// the helper's window, naming the finding's hash, made after the record it
// replaces) keeps the files as they were found as the new record, and the
// wake goes; a plain record never does (ruling P7-31).
//
// Under STOP nothing is started, woken or printed (it is checked again right
// before each start), and startFeature is refused. Bypass mode is refused at
// every call, whatever the configuration says.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIGEST_CAP } from './core.js';
import { WALK_CAP, checkControlFiles, markRaised, raisedOf, writeBaseline } from './control-files.js';
import { controlFilesNamed } from '../cards/build-loop.js';
import { keepControlLine, setLineOf } from '../state/card-lines.js';
import { inWorktreesFolder, LOOKBACK_MS, plainWorktreePath } from './sources.js';
import { ensureIgnored, featurePaths } from '../feature/files.js';
import { readCapped, safeFeatureFolder } from '../feature/status.js';
import { SLUG } from '../lib/build-loop.js';
import { computerId, stateDir, wheelhouseHome } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { clearOtherAgentHolds, hasAgentHolds, recordLift } from '../lineage/check.js';
import { agentInFolder, agentOfConfig } from '../agents/names.js';
import { run as runProgram } from '../lib/run.js';
import { takeStartLock } from '../lib/start-lock.js';
import { stopState } from '../lib/stop.js';
import { ROLE_VARIABLE, featureModeOf, sessionEnv, sessionModeOf } from '../../adapters/claude-code/sessions.js';
import { sessionsOfProject } from '../agents/project-agent.js';
import { PLUGIN_ROOT, foremanCommands } from '../foreman/tools.js';
import { lockedByPath } from '../hooks/kit.js';
import { featureAllowRules } from '../protection/settings.js';
import { LEVELS, buildGrants, buildsLevel } from '../protection/windows-builds.js';
import { CONTROL_PATHS, listEvents } from '../state/events.js';
import { readEnrolled, verify } from '../state/signing.js';
import { buildViews } from '../state/views.js';
import { balancedRouting, columnLines, promptWithColumn, roleOf, routingInForce } from '../routing/in-force.js';
import { hostApprovalReady } from '../host/approval-ready.js';
import { guardedCommand, guardedReady, labelWorktree, readSelfTest } from '../windows/low.js';

// A path as one shell word the foreman can type as it is: bare when it holds
// only plain characters, otherwise in single quotes, which bash reads
// literally; null when it holds a single quote or a line break.
function shellWord(p) {
  if (/^[A-Za-z0-9._/:@=+-]+$/.test(p)) return p;
  return /['\r\n]/.test(p) ? null : `'${p}'`;
}

export const PROMPTS = Object.freeze({
  // It begins "Wheelhouse foreman:" (ruling R26) and names the foreman's
  // playbook, which the foreman may load (ruling R98). With `wake`, the wake
  // command exactly as the foreman's allow rule matches it (foremanCommands),
  // it ends with the first command whole, so the first step needs neither the
  // skill nor the substitution of ${CLAUDE_PLUGIN_ROOT}.
  foreman: (file, wake = null) => {
    const word = typeof wake === 'string' && wake !== '' ? shellWord(file) : null;
    return `Wheelhouse foreman: follow wheelhouse:foreman to handle ${file}${word === null ? '' : `. First run: ${wake} read ${word}`}`;
  },
  feature: (file) => `Wheelhouse: read ${file}`,
  start: 'Read .wheelhouse/feature/brief.md and follow it.',
});

// The role variable, the modes and the session environment are the adapter's (they come with how it starts a
// session); they stay exported here for the callers that have always taken them from the waker.
export { ROLE_VARIABLE, featureModeOf, sessionEnv, sessionModeOf };
const MINUTE = 60 * 1000;
// The longest a session's process counts as running.
export const MAX_RUN_MS = Object.freeze({ foreman: 60 * MINUTE, feature: 8 * 60 * MINUTE });
// The longest a `starting` record, which names no process yet, counts as running.
export const STARTING_MS = 2 * MINUTE;
// The waits after a failed start or a failed exit, in order; the last repeats.
export const BACKOFF_MS = Object.freeze([MINUTE, 5 * MINUTE, 15 * MINUTE]);
// From this many failures on, each is reported.
export const FAILURES_REPORTED = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A session id a run named itself: a plain word, as a `--resume=` argument takes it.
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// A feature whose first run hasn't named its session yet.
const STARTING = Symbol('starting');
// What a check made just before a run starts throws when STOP has come on: the wake goes again.
class StopNow extends Error {
  constructor() {
    super('STOP is on: no session is started');
  }
}
const WAKE_BYTES = 8 * 1024 * 1024;
const SMALL_BYTES = 64 * 1024;

const REPEAT_NOTE = 'A wake may repeat one already sent: the watcher records its place only after waking, '
  + 'so a stop in between sends the same events again. Act on where things stand now.';
const gapNote = (since) => `The watcher was off for over a week (since ${since}). Events from then are not listed: `
  + 'read the views for where things stand.';
const mergedNote = (n) => `This wake gathers ${n} wakes that waited while a session ran; their files are listed in merged.`;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (Array.isArray(x) ? x : []);

function lstatOf(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function realOf(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

// --- The watcher's folder, projects/<p>/watcher ---

export function watcherDir(project) {
  return path.join(path.dirname(stateDir(project)), 'watcher');
}

export function wakesDir(project) {
  return path.join(watcherDir(project), 'wakes');
}

export const outboxFile = (project) => path.join(watcherDir(project), 'outbox.json');
const outboxLock = (project) => path.join(watcherDir(project), 'outbox.lock');
export const runningFile = (project, target) => path.join(watcherDir(project), 'running', `${target}.json`);
export const sessionFile = (project, work) => path.join(watcherDir(project), 'sessions', `${work}.json`);
export const grantsUsedFile = (project) => path.join(watcherDir(project), 'grants-used.json');
// The level the project's builders last ran at on this computer, as the last `level` record named it (ruling P8-5).
export const levelFile = (project) => path.join(watcherDir(project), 'level.json');

// Makes `sub` under the watcher's folder, refusing any part of it that is there
// but is not a real folder (a link above all). Returns the folder.
export function watcherFolder(project, sub = null, fail = () => { throw new Error("The watcher's folder isn't a real folder"); }) {
  const dirs = [watcherDir(project)];
  if (sub !== null) dirs.push(path.join(dirs[0], sub));
  for (const dir of dirs) {
    const before = lstatOf(dir);
    if (before !== null && !before.isDirectory()) fail();
    if (before === null) fs.mkdirSync(dir, { recursive: true });
    if (!lstatOf(dir)?.isDirectory()) fail();
  }
  return dirs.at(-1);
}

// Writes text whole to a temporary name renamed over `file`, refusing a
// `file` that is there but is not a regular file.
function writeWholeText(file, text, fail) {
  const stat = lstatOf(file);
  if (stat !== null && !stat.isFile()) fail();
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID().slice(0, 12)}.tmp`);
  try {
    fs.writeFileSync(temp, text, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function writeJsonFile(file, value, fail = () => { throw new Error(`${path.basename(file)} can't be written`); }) {
  writeWholeText(file, `${JSON.stringify(value)}\n`, fail);
}

function readJson(file, max = SMALL_BYTES) {
  try {
    return JSON.parse(readCapped(file, max) ?? 'null');
  } catch {
    return null;
  }
}

// --- Build-command grants on Windows ---

// The question ids of the Allow this time grants already given to a run. No
// record is none; one that is there but can't be read is null, which counts
// every such grant as used.
export function readGrantsUsed(project) {
  const file = grantsUsedFile(project);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    return error.code === 'ENOENT' ? [] : null;
  }
  if (!stat.isFile()) return null;
  const kept = readJson(file, WAKE_BYTES);
  return isPlain(kept) && Array.isArray(kept.used) && kept.used.every((x) => typeof x === 'string') ? kept.used : null;
}

// Adds `ids` to the record of used grants, written whole.
function recordGrantsUsed(project, ids) {
  if (ids.length === 0) return;
  const fail = () => { throw new Error("The record of used build-command grants can't be written"); };
  const used = readGrantsUsed(project);
  if (used === null) fail();
  watcherFolder(project, null, fail);
  writeJsonFile(grantsUsedFile(project), { used: [...new Set([...used, ...ids])] }, fail);
}

// The level of build commands on this computer and the director's grants to
// the feature `work`, read from the views as locateFeature reads them, with
// the Guarded runner's command. Guarded counts only while this computer's
// self-test passes (guardedReady). Beside them, the facts a level's rules are
// worked out from on every system (ruling P8-4): whether the project has real
// users (its `phase` setting is `launched`), whether the self-test found the
// helper's keys unreadable to builds, and whether the host's approval is ready.
// Anything that can't be read is Ask with no grants, and real users. With `proofs`, a grant counts only from an
// answer naming one of them (buildGrants).
export function windowsBuildsOf(project, { pluginRoot = PLUGIN_ROOT, now = () => new Date(), platform = process.platform } = {}) {
  return (work, { proofs } = {}) => {
    try {
      const views = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
      const computer = computerId();
      const checkout = readProject(project)?.folder;
      const locked = typeof checkout === 'string' ? lockedByPath(checkout) : true;
      const home = wheelhouseHome();
      let runner = null;
      try {
        runner = guardedCommand({ home, pluginRoot, platform });
      } catch { /* no runner to name: Guarded gives the grants alone */ }
      return {
        level: buildsLevel({ views, computer, locked, guardedReady: guardedReady({ home, now, platform }) }),
        grants: buildGrants({ views, work, used: readGrantsUsed(project), computer, ...(proofs === undefined ? {} : { proofs }) }),
        guardedCommand: runner,
        realUsers: views.settings?.phase?.value === 'launched',
        keysUnreadable: readSelfTest({ home, now, platform })?.keysReadHeld === true,
        hostApproval: hostApprovalReady() === true,
      };
    } catch {
      return { level: 'ask', grants: [], guardedCommand: null, realUsers: true, keysUnreadable: false, hostApproval: false };
    }
  };
}

// --- Wake files ---

function wakeNote(bundle) {
  const notes = [REPEAT_NOTE];
  const gap = list(bundle.events).find((e) => isPlain(e) && e.type === 'long-gap');
  if (gap) notes.push(gapNote(gap.detail?.since ?? 'its last run'));
  if (list(bundle.merged).length > 0) notes.push(mergedNote(bundle.merged.length));
  return notes.join(' ');
}

// Writes the bundle's record as projects/<p>/watcher/wakes/<time>.json and
// returns its path. Each wake gets a name of its own (`<time>-<n>.json` when
// the time is taken), is written to a temporary file and renamed into place,
// and a wakes folder that is a link is refused.
export function writeWake(project, bundle, { now = () => new Date() } = {}) {
  const fail = () => { throw new Error("The wake can't be written"); };
  if (!isPlain(bundle) || !['foreman', 'feature'].includes(bundle.to)) fail();
  if (bundle.to === 'feature' && !(typeof bundle.work === 'string' && SLUG.test(bundle.work))) fail();
  const at = now().toISOString();
  const body = {
    v: 1,
    to: bundle.to,
    ...(bundle.to === 'feature' ? { work: bundle.work } : {}),
    at,
    note: wakeNote(bundle),
    events: list(bundle.events),
    digest: list(bundle.digest),
    dropped: Number.isInteger(bundle.dropped) && bundle.dropped > 0 ? bundle.dropped : 0,
    ...(list(bundle.merged).length > 0 ? { merged: bundle.merged } : {}),
  };
  const dir = watcherFolder(project, 'wakes', fail);
  const base = at.replace(/[:.]/g, '-');
  const temp = path.join(dir, `.${base}.${crypto.randomUUID().slice(0, 12)}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' });
    for (let n = 0; ; n += 1) {
      const file = path.join(dir, n === 0 ? `${base}.json` : `${base}-${n}.json`);
      try {
        fs.writeFileSync(file, '', { flag: 'wx' }); // claims the name
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        throw error;
      }
      fs.renameSync(temp, file);
      return file;
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// A wake file as writeWake wrote it, or null.
export function readWake(file) {
  const wake = readJson(file, WAKE_BYTES);
  return isPlain(wake) && ['foreman', 'feature'].includes(wake.to) ? wake : null;
}

// One record from several that waited: each event once, the digests in order
// (the newest DIGEST_CAP kept, the rest counted in `dropped`). Reads only
// records under the watcher's folder.
function mergeWakes(project, to, work, files, now) {
  const events = [];
  const ids = new Set();
  let digest = [];
  let dropped = 0;
  for (const file of files) {
    const wake = readWake(file);
    if (wake === null) continue;
    for (const e of list(wake.events)) {
      if (isPlain(e) && ids.has(e.id)) continue;
      if (isPlain(e)) ids.add(e.id);
      events.push(e);
    }
    digest.push(...list(wake.digest));
    dropped += Number.isInteger(wake.dropped) && wake.dropped > 0 ? wake.dropped : 0;
  }
  if (digest.length > DIGEST_CAP) {
    dropped += digest.length - DIGEST_CAP;
    digest = digest.slice(-DIGEST_CAP);
  }
  return writeWake(project, { to, work, events, digest, dropped, merged: files }, { now });
}

// Makes `parts` one by one under `root`, each a real folder (a link or a file
// is refused), and checks the last one's real path is the one under the
// root's real path, so nothing written there can land anywhere else.
// Returns `{ dir, expected }`: the folder and the real path it must keep.
function realFolderUnder(root, parts, fail) {
  const rootReal = realOf(root);
  if (rootReal === null) fail();
  let dir = root;
  for (const part of parts) {
    dir = path.join(dir, part);
    const before = lstatOf(dir);
    if (before !== null && !before.isDirectory()) fail();
    if (before === null) {
      try {
        fs.mkdirSync(dir);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (!lstatOf(dir)?.isDirectory()) fail();
  }
  const expected = path.join(rootReal, ...parts);
  if (realOf(dir) !== expected) fail();
  return { dir, expected };
}

// The foreman's copies: the main checkout's .wheelhouse/foreman/wakes/,
// git-ignored through the repository's info/exclude.
export function foremanWakesDir(checkout) {
  const fail = () => { throw new Error("The foreman's wakes folder isn't a real folder in the project"); };
  ensureIgnored(checkout, { mainCheckout: checkout });
  return realFolderUnder(checkout, ['.wheelhouse', 'foreman', 'wakes'], fail);
}

// A feature's copies: its worktree's .wheelhouse/feature/wakes/.
export function featureWakesDir(worktree) {
  const fail = () => { throw new Error("The feature's wakes folder isn't a real folder in its worktree"); };
  if (!safeFeatureFolder(worktree)) fail();
  return realFolderUnder(worktree, ['.wheelhouse', 'feature', 'wakes'], fail);
}

// Copies the record `file` into the session's folder `place` (from
// foremanWakesDir or featureWakesDir) under the record's own name, and returns
// the copy's path. The session can change its folder at any moment, so: the
// copy is made from a temporary file in the watcher's own folder; the folder
// is checked again (a real folder, at its expected real path) just before
// copying; the copy never replaces anything but a regular file and is made
// with COPYFILE_EXCL, so it never follows a link left in its place; and the
// folder is checked once more after. If it moved, the copy is removed and the
// wake counts as not delivered. `beforeCopy(dir)` is for tests.
function copyWake(project, file, place, { beforeCopy = () => {}, add = null } = {}) {
  const moved = () => { throw new Error("The wakes folder isn't a real folder where it should be"); };
  const read = readCapped(file, WAKE_BYTES);
  if (read === null) throw new Error("The wake's record can't be read");
  // `add`, fields written into the copy beside the record's own (Shape 2's `column`); the record is never changed.
  let text = read;
  if (add !== null) {
    const record = readWake(file);
    if (record === null) throw new Error("The wake's record can't be read");
    text = `${JSON.stringify({ ...record, ...add }, null, 2)}\n`;
  }
  const temp = path.join(watcherFolder(project, 'copies'), `${crypto.randomUUID()}.json`);
  fs.writeFileSync(temp, text, { flag: 'wx' });
  try {
    const sound = () => lstatOf(place.dir)?.isDirectory() === true && realOf(place.dir) === place.expected;
    if (!sound()) moved();
    beforeCopy(place.dir);
    const copy = path.join(place.dir, path.basename(file));
    const there = lstatOf(copy);
    if (there !== null) {
      if (!there.isFile()) throw new Error("The wake's copy can't be written");
      fs.rmSync(copy, { force: true }); // an earlier copy of the same wake
    }
    fs.copyFileSync(temp, copy, fs.constants.COPYFILE_EXCL);
    if (!sound()) {
      fs.rmSync(copy, { force: true });
      moved();
    }
    return copy;
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Removes the wake files in `dir` older than the look-back, except those whose
// names are in `keep`.
function pruneFolder(dir, keep, nowMs) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json') || keep.has(name)) continue;
    const file = path.join(dir, name);
    const stat = lstatOf(file);
    if (stat?.isFile() && nowMs - stat.mtimeMs > LOOKBACK_MS) fs.rmSync(file, { force: true });
  }
}

// Whether `worktree` is a feature worktree of the project: a full path, a real
// folder (not a link) strictly inside the main checkout's .claude/worktrees/,
// with a real feature folder.
function featureWorktreeOk(project, worktree) {
  if (!plainWorktreePath(worktree) || /[\r\n]/.test(worktree)) return false;
  if (!lstatOf(worktree)?.isDirectory()) return false;
  const checkout = readProject(project)?.folder;
  return typeof checkout === 'string' && inWorktreesFolder(checkout, worktree) && safeFeatureFolder(worktree);
}

// Finds a running feature's worktree from the features view, or null when the
// feature is closed, unknown, or its worktree is not one to start a session in.
export function locateFeature(project) {
  return (work) => {
    const events = listEvents(stateDir(project), { report: () => {} });
    const views = buildViews(events, readEnrolled());
    const f = isPlain(views.features) ? views.features[work]?.data : undefined;
    if (!isPlain(f) || f.step === 'closed') return null;
    return featureWorktreeOk(project, f.worktree) ? f.worktree : null;
  };
}

// Opens `file` for the child's output: appended to, made if missing (readable
// by this account only), and never through a link where the system can refuse
// one.
function openOutput(file) {
  const { O_WRONLY, O_CREAT, O_APPEND, O_NOFOLLOW } = fs.constants;
  return fs.openSync(file, O_WRONLY | O_CREAT | O_APPEND | (O_NOFOLLOW ?? 0), 0o600);
}

// Starts `file` with `args` detached from the watcher, with no window; `input`,
// when given, is written to its stdin. Its output is kept only when `output`
// names a file: its stdout and stderr are appended there (ruling P8-2), and
// otherwise thrown away. Resolves once the process has started, with its pid
// and a promise of its exit code.
export function spawnDetached(file, args, { cwd, env, input = '', windowsVerbatimArguments = false, output = null } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let fd = null;
    try {
      if (typeof output === 'string') fd = openOutput(output);
      child = spawn(file, args, {
        cwd, env, detached: true, windowsHide: true, shell: false, windowsVerbatimArguments, stdio: [input ? 'pipe' : 'ignore', fd ?? 'ignore', fd ?? 'ignore'],
      });
    } catch (error) {
      reject(error);
      return;
    } finally {
      // The child holds its own copy from here.
      if (fd !== null) fs.closeSync(fd);
    }
    const exited = new Promise((done) => { child.once('exit', (code) => done(Number.isInteger(code) ? code : 1)); });
    child.once('error', reject);
    child.once('spawn', () => {
      if (input) {
        child.stdin.on('error', () => {});
        child.stdin.end(input);
      }
      child.unref();
      resolve({ pid: child.pid, exited });
    });
  });
}

// Whether a process with this id is running. EPERM means it exists.
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// When each of these processes started, as the system says it, in one call:
// `ps -o pid=,lstart= -p <pids>` on macOS and Linux, Win32_Process's
// CreationDate through one PowerShell call on Windows. A Map from pid to the
// start time, or to null when it can't be had (the process has gone, or the
// system won't say).
export async function processStartTimes(pids, { platform = process.platform, run = runProgram } = {}) {
  const wanted = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const found = new Map(wanted.map((pid) => [pid, null]));
  if (wanted.length === 0) return found;
  try {
    const filter = wanted.map((pid) => `ProcessId=${pid}`).join(' OR ');
    const answer = platform === 'win32'
      ? await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CreationDate.ToUniversalTime().ToString('o') }`,
      ], { timeoutMs: 15000 })
      : await run('ps', ['-o', 'pid=,lstart=', '-p', wanted.join(',')], { timeoutMs: 5000 });
    for (const line of String(answer.stdout ?? '').split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
      if (m && found.has(Number(m[1]))) found.set(Number(m[1]), m[2]);
    }
  } catch { /* none can be had */ }
  return found;
}

// When one process started, or null.
export async function processStartTime(pid, options = {}) {
  return (await processStartTimes([pid], options)).get(pid) ?? null;
}

// Start times kept for `ttlMs`, so a watcher checking its running sessions
// every loop asks the system at most once a minute, and for every pid at
// once. `get(pid, others)` asks for `pid` and every one of `others` not
// fresh; `{ fresh: true }` asks again whatever is kept.
export function makeStartTimes({ platform = process.platform, run = runProgram, now = () => new Date(), ttlMs = 60 * 1000 } = {}) {
  const kept = new Map();
  const isFresh = (pid) => kept.has(pid) && now().getTime() - kept.get(pid).at < ttlMs;
  return {
    async get(pid, others = [], { fresh = false } = {}) {
      if (!fresh && isFresh(pid)) return kept.get(pid).time;
      const asked = [pid, ...others.filter((p) => p !== pid && !isFresh(p))];
      const found = await processStartTimes(asked, { platform, run });
      const at = now().getTime();
      for (const [p, time] of found) kept.set(p, { at, time });
      return found.get(pid) ?? null;
    },
  };
}

const bootTime = () => Date.now() - os.uptime() * 1000;

// The size of a run's output file before the run, so only what the run itself
// appended is read after it (a wake appends to its session's file).
function outputSize(file) {
  const stat = lstatOf(file);
  return stat?.isFile() ? stat.size : 0;
}

// What a run appended to its output file from `from` on, at most the last
// WAKE_BYTES of it; empty when the file isn't a regular file.
function readOutput(file, from) {
  const stat = lstatOf(file);
  if (!stat?.isFile()) return '';
  const start = Math.max(Number.isInteger(from) && from >= 0 ? from : 0, stat.size - WAKE_BYTES);
  const length = stat.size - start;
  if (length <= 0) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, read).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// --- The waker ---

export function makeWaker({
  shape,
  project,
  config,
  foremanTools = [],
  run = spawnDetached,
  print = (line) => process.stdout.write(`${line}\n`),
  now = () => new Date(),
  alive = pidAlive,
  startTimeOf = null,
  bootedAt = bootTime,
  stopped = () => stopState().on,
  locate = locateFeature(project),
  windowsBuilds = null,
  labelGuarded = null,
  claude = null,
  sessions = null,
  baseEnv = process.env,
  platform = process.platform,
  pluginRoot = PLUGIN_ROOT,
  onError = () => {},
  onNote = () => {},
  routing = null,
  raise = async () => {},
  walkCap = WALK_CAP,
  beforeCopy = () => {},
}) {
  if (shape !== 1 && shape !== 2) throw new Error('The watcher shape is 1 or 2');
  // The foreman's wake command, for its prompt; none when the plugin's folder can't be given as one.
  let wakeCommand = null;
  try {
    wakeCommand = foremanCommands(pluginRoot, { platform }).wake;
  } catch { /* the prompt names the playbook alone */ }
  // The sessions part of the adapter for the agent this computer runs for the project (the `agents` map of the
  // configuration from the default branch, which the mode and the models come from too; Claude Code when it
  // names none), unless one was given.
  const sessionsOf = () => sessions ?? sessionsOfProject(config);
  // Asks that adapter whether its sessions may start under `config` (`check` is checkForeman or checkFeature): a
  // throw refuses the wake. When there is no adapter to ask (the project names an agent that has none, or this
  // computer's id can't be read), nothing is asked here at Shape 1: the call that would start the session asks
  // again and refuses it, and the wake is kept. At Shape 2 the waker prints a line for the director's own session,
  // with no call after it to refuse, so there the missing adapter refuses (ruling P5-30).
  const mayStart = (check) => {
    let adapter;
    try {
      adapter = sessionsOf();
    } catch (error) {
      if (shape === 1) return;
      throw error;
    }
    adapter[check](config);
  };
  mayStart('checkForeman');
  if (!Array.isArray(foremanTools) || !foremanTools.every((t) => typeof t === 'string' && t !== '' && !/[\r\n]/.test(t))) {
    throw new Error("The foreman's tools are a list of tool rules");
  }
  watcherDir(project); // a project name that is not a folder name throws here
  const buildsOf = windowsBuilds ?? windowsBuildsOf(project, { pluginRoot, now, platform });
  // The column in force now, read at each session start; Balanced when it can't be read. Its lines are noted once
  // each time they change.
  let noted = null;
  const columnNow = () => {
    let found;
    try {
      found = routing === null ? routingInForce(project, config, { now }) : routing();
    } catch {
      found = null;
    }
    if (!isPlain(found) || !isPlain(found.roles)) found = balancedRouting(config);
    const said = list(found.lines).filter((line) => typeof line === 'string' && line !== '');
    if (said.join('\n') !== noted) {
      noted = said.join('\n');
      for (const line of said) {
        try {
          onNote(line);
        } catch { /* a note that can't be said is said at the next change */ }
      }
    }
    return found;
  };
  // A role's model, effort and fallback from the column, for the adapter (null where it names none): roleOf.
  // A feature's prompt with the column for its subagents after it.
  // Only for an adapter that says it takes the column (`takesColumn`): another agent's prompt stays one line, and
  // never names models it can't use.
  const withColumn = (adapter, prompt, found) => (adapter?.takesColumn === true ? promptWithColumn(prompt, found) : prompt);
  // At Shape 2 the column goes in the copy of the wake the session reads, as `column`, since its prompt is one line.
  const shape2Column = () => {
    let adapter = null;
    try {
      adapter = sessionsOf();
    } catch { /* no adapter: no column */ }
    return adapter?.takesColumn === true ? { column: columnLines(columnNow()) } : null;
  };
  // Start times, asked of this system for every running pid at once and kept a minute.
  const startTimes = makeStartTimes({ now });
  const timeOf = startTimeOf ?? ((pid, others, options) => startTimes.get(pid, others, options));
  const copyInto = (file, place, add = null) => copyWake(project, file, place, { beforeCopy, add });

  // --- The outbox ---
  const outboxFail = () => { throw new Error("The watcher's outbox can't be read or written"); };
  const validEntry = (e) => isPlain(e) && typeof e.id === 'string' && typeof e.file === 'string'
    && (e.to === 'foreman' || (e.to === 'feature' && typeof e.work === 'string' && SLUG.test(e.work)));
  // The entries, oldest first. No outbox is an empty one; one that is there
  // but is not a regular file, is too big, or does not read throws.
  const load = () => {
    const file = outboxFile(project);
    const stat = lstatOf(file);
    if (stat === null) return [];
    if (!stat.isFile()) outboxFail();
    let kept;
    try {
      kept = JSON.parse(readCapped(file, WAKE_BYTES) ?? '');
    } catch {
      outboxFail();
    }
    if (!isPlain(kept) || !Array.isArray(kept.entries)) outboxFail();
    return kept.entries.filter(validEntry);
  };
  const save = (entries) => {
    watcherFolder(project, null, outboxFail);
    writeJsonFile(outboxFile(project), { entries }, outboxFail);
  };
  const newEntry = (fields) => ({ id: crypto.randomUUID(), at: now().toISOString(), failures: 0, retryAt: null, flight: null, ...fields });

  // One change at a time: in this process by a chain, across processes by a lock file.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const next = chain.then(async () => {
      watcherFolder(project, null, outboxFail);
      const release = await takeStartLock(outboxLock(project), { message: "The watcher's outbox is busy", waitMs: 30000 });
      try {
        return await fn();
      } finally {
        release();
      }
    });
    chain = next.catch(() => {});
    return next;
  };

  // How each entry in `ids` turned out: `done` leaves the outbox; `failed`
  // waits and counts a failure; `again` is sent again with no failure counted.
  const settle = (ids, outcome, why) => {
    const wanted = new Set(ids);
    if (wanted.size === 0) return;
    const entries = load();
    const kept = [];
    for (const e of entries) {
      if (!wanted.has(e.id)) kept.push(e);
      else if (outcome === 'again') kept.push({ ...e, flight: null });
      else if (outcome === 'failed') {
        const failures = (Number.isInteger(e.failures) ? e.failures : 0) + 1;
        const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
        kept.push({ ...e, flight: null, failures, retryAt: new Date(now().getTime() + wait).toISOString(), lastError: why });
        if (failures >= FAILURES_REPORTED) onError(`A wake for ${e.to === 'foreman' ? 'the foreman' : e.work} has failed ${failures} times: ${why}`);
      }
    }
    save(kept);
  };

  // --- What is running (Shape 1) ---
  const targetOf = (work) => (work === undefined ? 'foreman' : `feature-${work}`);
  const maxRunOf = (target) => (target === 'foreman' ? MAX_RUN_MS.foreman : MAX_RUN_MS.feature);
  const readRunning = (target) => {
    const r = readJson(runningFile(project, target));
    return isPlain(r) && typeof r.at === 'string' ? r : null;
  };
  // Takes the target's record away, whole, when `matches(record)`: it is renamed aside first, which only one
  // process can do, so two that see the same run end (the exit handler of the waker that started it, and another
  // waker's endRecord) never both act on it. A record that doesn't match is put back. Returns the record taken, or
  // null.
  const claimRecord = (target, matches) => {
    const file = runningFile(project, target);
    const aside = path.join(path.dirname(file), `.${target}.${crypto.randomUUID()}.claim`);
    try {
      fs.renameSync(file, aside);
    } catch {
      return null;
    }
    const r = readJson(aside);
    if (isPlain(r) && typeof r.at === 'string' && matches(r)) {
      fs.rmSync(aside, { force: true });
      return r;
    }
    try {
      if (lstatOf(file) === null) fs.renameSync(aside, file);
    } finally {
      fs.rmSync(aside, { force: true });
    }
    return null;
  };
  // Ends the target's record when it is this process's; says whether it was.
  const forget = (target, pid) => claimRecord(target, (r) => r.pid === pid) !== null;

  // The pids of every recorded running process, so their start times are asked for together.
  const runningPids = () => {
    let names;
    try {
      names = fs.readdirSync(path.join(watcherDir(project), 'running'));
    } catch {
      return [];
    }
    return names.filter((n) => n.endsWith('.json'))
      .map((n) => readJson(path.join(watcherDir(project), 'running', n))?.pid)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  };

  // Whether the target's recorded process still runs: `{ live }`, `{ ended,
  // why }` (why: 'gone' or 'overran'), or null when nothing is recorded. A
  // `starting` record, left by a watcher that stopped mid-start, has no pid
  // to check and ends after STARTING_MS; its wakes go again.
  async function stateOf(target) {
    const r = readRunning(target);
    if (r === null) return null;
    const at = Date.parse(r.at);
    const t = now().getTime();
    if (Number.isNaN(at) || at < bootedAt()) return { ended: r, why: 'gone' };
    if (r.state === 'starting') return t - at >= STARTING_MS ? { ended: r, why: 'gone' } : { live: r };
    if (!Number.isInteger(r.pid) || !alive(r.pid)) return { ended: r, why: 'gone' };
    if (typeof r.startTime === 'string') {
      const current = await timeOf(r.pid, runningPids());
      if (current !== null && current !== r.startTime) return { ended: r, why: 'gone' };
    }
    // Still running: the time limit decides.
    if (t - at >= maxRunOf(target)) return { ended: r, why: 'overran' };
    return { live: r };
  }

  const nameOf = (target) => (target === 'foreman' ? 'foreman' : target.slice('feature-'.length));

  // The sessions part that ran `target`'s run, for reading its output: none to ask (no adapter for the agent, or
  // one with no afterRun) gives null.
  const readerOf = () => {
    try {
      const adapter = sessionsOf();
      return typeof adapter.afterRun === 'function' ? adapter : null;
    } catch {
      return null;
    }
  };

  // What a run whose output was kept (`kept`: the record's `run`, { output, from, usageFile, idFromRun }) leaves,
  // read by the adapter's afterRun from what the run appended (ruling P8-2): its records written through `raise`
  // (a record that can't be written is reported, and the run still settles), a first run's session id kept for
  // its wakes (ruling P8-3), and its wakes settled by its outcome, never by its exit code.
  async function finishRun(adapter, target, kept, code, entries) {
    let result;
    try {
      result = adapter.afterRun({ stdout: readOutput(kept.output, kept.from), code, call: kept, target, project, at: now().toISOString() });
    } catch (error) {
      result = { ok: false, why: `its output couldn't be read: ${error instanceof Error ? error.message : 'unknown error'}`, sessionId: null, records: [] };
    }
    for (const record of list(result?.records)) {
      try {
        await raise(record);
      } catch (error) {
        onError(`What the ${nameOf(target)} session did couldn't be recorded: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    if (target !== 'foreman' && kept.idFromRun === true) keepStartedId(nameOf(target), result?.sessionId ?? null);
    if (result?.ok === true) settle(entries, 'done');
    else {
      const why = typeof result?.why === 'string' ? result.why : 'its run gave no outcome';
      settle(entries, 'failed', why);
      if (entries.length === 0) onError(`The ${nameOf(target)} session's run failed: ${why}`);
    }
  }

  // Ends a record that has ended: its wakes go again (an overrun counts as a failure). A run whose output was kept
  // is read instead, so a run whose exit this watcher never saw (a start made by the foreman's command, or a
  // watcher that restarted) still leaves its records and its session id, and its wakes settle by its outcome.
  // A record another process has already taken is left to it.
  async function endRecord(target, state) {
    const ids = list(state.ended.entries).filter((x) => typeof x === 'string');
    const same = (r) => r.at === state.ended.at && r.pid === state.ended.pid && r.state === state.ended.state;
    if (claimRecord(target, same) === null) return;
    const kept = isPlain(state.ended.run) && typeof state.ended.run.output === 'string' ? state.ended.run : null;
    if (state.why === 'overran') {
      const minutes = Math.round(maxRunOf(target) / MINUTE);
      onError(`The ${nameOf(target)} session ran past its ${minutes} minutes`);
      settle(ids, 'failed', 'its session ran past its time');
    } else if (kept !== null && state.ended.state !== 'starting' && readerOf() !== null) {
      await finishRun(readerOf(), target, kept, null, ids);
    } else {
      settle(ids, 'again');
    }
  }

  // Raises a `level` record when the level a feature's call runs at differs from the one last recorded on this
  // computer, and keeps the new one (ruling P8-5): `{ level, work, at }`, with no `key`, so the views never take it
  // for a level the director set, and no `pr`, so the audit reads it as the project's. A record that can't be
  // written is reported and tried again at the next start.
  async function noteLevel(level, work) {
    if (typeof level !== 'string' || level === '') return;
    const kept = readJson(levelFile(project));
    if (isPlain(kept) && kept.level === level) return;
    try {
      await raise({ kind: 'level', data: { level, work, at: now().toISOString() } });
    } catch (error) {
      onError(`The level builders run at here (${level}) couldn't be recorded: ${error instanceof Error ? error.message : 'unknown error'}`);
      return;
    }
    watcherFolder(project);
    writeJsonFile(levelFile(project), { level });
  }

  // Starts a session for `target`. In order: `check(adapter)` (the adapter's own check, which refuses by
  // throwing); the adapter's `prepare({ project, target })` when it has one (an adapter whose sessions run from a
  // home of their own writes it there: a throw refuses the start, and the records it carries are raised, each once);
  // `build(adapter)`, the call ({ file, args, env, input, verbatim, output?, level?, idFromRun? }); `beforeRun(call)`,
  // which may refuse; the call's level noted (noteLevel, for a feature), so a refused start records none; the session
  // recorded as starting; `afterRecord(call)`, which writes what must only exist beside that record (a feature's
  // session record, so no other process finds it with no run recorded); then run, and recorded as running.
  // Resolves with the pid. When the call names an `output` file, the child's output is appended there and read once
  // it exits (finishRun); otherwise its exit code settles `entries`, as it always has.
  async function launch({ target, cwd, check, build, file, entries = [], beforeRun = () => {}, afterRecord = () => {} }) {
    const adapter = sessionsOf();
    check(adapter);
    if (typeof adapter.prepare === 'function') {
      let prepared;
      try {
        prepared = await adapter.prepare({ project, target });
      } catch (error) {
        for (const record of list(error?.records)) {
          const said = `${record?.kind}:${JSON.stringify(record?.data?.mismatches ?? record?.data ?? null)}`;
          if (raisedPrepare.has(said)) continue;
          try {
            await raise(record);
            raisedPrepare.add(said);
          } catch {
            continue; // raised again at the next start
          }
          // The adapter keeps that its record is in the state, so a later start (or another watcher) raises it no more.
          try {
            if (typeof error?.raised === 'function') error.raised(record);
          } catch { /* raised again, at worst */ }
        }
        throw error;
      }
      if (prepared?.lifted === true) await liftHolds();
    }
    const call = build(adapter);
    beforeRun(call);
    if (target !== 'foreman') await noteLevel(call.level, nameOf(target));
    const { env } = call;
    const kept = typeof call.output === 'string'
      ? { output: call.output, from: outputSize(call.output), ...(typeof call.usageFile === 'string' ? { usageFile: call.usageFile } : {}), idFromRun: call.idFromRun === true }
      : null;
    watcherFolder(project, 'running');
    const file0 = runningFile(project, target);
    const at = now().toISOString();
    writeJsonFile(file0, { state: 'starting', at, file, entries, ...(kept ? { run: kept } : {}) });
    let started;
    try {
      afterRecord(call);
      started = await run(call.file, call.args, {
        cwd, env, input: call.input, windowsVerbatimArguments: call.verbatim, ...(kept ? { output: kept.output } : {}),
      });
      if (!Number.isInteger(started?.pid)) throw new Error('the session did not start');
    } catch (error) {
      fs.rmSync(file0, { force: true });
      throw error;
    }
    const startTime = await timeOf(started.pid, [], { fresh: true });
    writeJsonFile(file0, { state: 'running', pid: started.pid, startTime, at, file, entries, ...(kept ? { run: kept } : {}) });
    if (started.exited && typeof started.exited.then === 'function') {
      started.exited.then((code) => serial(async () => {
        const mine = forget(target, started.pid);
        if (kept !== null && typeof adapter.afterRun === 'function') {
          // A record already ended elsewhere (endRecord) has been read there.
          if (mine) await finishRun(adapter, target, kept, code, entries);
        } else if (code === 0) settle(entries, 'done');
        else {
          settle(entries, 'failed', `its session exited with code ${code}`);
          if (entries.length === 0) onError(`The ${target.slice('feature-'.length)} session exited with code ${code}`);
        }
        return deliver();
      })).catch(() => {});
    }
    return started.pid;
  }
  // The records a refused prepare raised, each once for this waker.
  const raisedPrepare = new Set();

  // A prepare that removed a hold of the project's (an agent's own, ruling P8-32): its lift is recorded here, through
  // `raise`, as the session start and the mod's tick record one, so its card closes on a computer with neither. It
  // informs: a lift that can't be recorded is kept, as recordLift keeps one, and the start goes on.
  async function liftHolds() {
    try {
      const views = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
      const client = { state: { write: async (body) => { await raise({ kind: body.kind, data: body.data }); return { ok: true }; } } };
      await recordLift({ project, views, computer: computerId(), now, client });
    } catch (error) {
      onError(`A lifted hold's card couldn't be closed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  // The foreman's start for `prompt`'s wake: its check asked right before its call is built.
  const startForeman = (cwd, prompt, gathered) => {
    const column = columnNow();
    return launch({
      target: 'foreman',
      cwd,
      check: (adapter) => adapter.checkForeman(config),
      build: (adapter) => adapter.foremanCall({
        config, project, prompt, tools: foremanTools, env: baseEnv, claude, platform, ...roleOf(column, 'foreman'),
      }),
      file: gathered.entry.file,
      entries: [gathered.entry.id],
    });
  };
  // What windowsBuilds answers for `work`, or Ask with no grants and real users when it can't answer. `proofs` is
  // the adapter's grantProofs, passed only when the adapter has them.
  const windowsAnswer = (work, proofs) => {
    let answer;
    try {
      answer = proofs === undefined ? buildsOf(work) : buildsOf(work, { proofs });
    } catch {
      answer = null;
    }
    return {
      level: LEVELS.includes(answer?.level) ? answer.level : 'ask',
      grants: Array.isArray(answer?.grants) ? answer.grants.filter(isPlain) : [],
      guardedCommand: typeof answer?.guardedCommand === 'string' ? answer.guardedCommand : null,
      realUsers: answer?.realUsers !== false,
      keysUnreadable: answer?.keysUnreadable === true,
      hostApproval: answer?.hostApproval === true,
    };
  };
  // Labels the worktree for the low runner: by default with Windows' own icacls, the common
  // folder being the main checkout's .git.
  const label = labelGuarded ?? ((worktree) => labelWorktree(worktree, { run: runProgram, commonDir: path.join(checkoutOf(), '.git') }));
  // What a feature session's call is given for `work` in `worktree` (ruling P8-4), read on every system from
  // trusted sources only:
  //   - `allowed`, Claude Code's allow rules, exactly as before: on Windows they follow the level of build commands
  //     and the director's grants, elsewhere the feature's allow rules alone;
  //   - `inputs`, a level's inputs for an adapter that works out its own rules: the level and the
  //     grants still in force, the Guarded runner's command, the worktree, the project's web domains, whether the
  //     project has real users, whether the self-test found the keys unreadable, whether the host's approval is
  //     ready, and whether Unattended is confirmed (its level reads `unattended` only from its own card);
  //   - `recordUsed(call)`, which records the Allow this time grants given as used before the run starts, so a
  //     grant goes to one run whatever windowsBuilds answers: on Windows, and wherever the call says the level it
  //     runs at (an adapter that took the grants).
  // At Guarded the worktree is labelled first (Windows only); if it can't be, the run gets the Ask rules (failing
  // closed) and says so. Anything that can't be read is Ask with no grants and real users.
  const levelInputs = async (work, worktree) => {
    const sessions = sessionsOf();
    sessions.checkFeature(config); // before anything is labelled or recorded
    // An adapter's grantProofs that aren't a list of names count no grant (failing closed).
    const named = sessions.grantProofs;
    const proofs = named === undefined ? undefined : Array.isArray(named) && named.every((p) => typeof p === 'string') ? [...named] : [];
    const answer = windowsAnswer(work, proofs);
    const { grants, guardedCommand } = answer;
    let { level } = answer;
    if (platform === 'win32' && level === 'guarded') {
      try {
        if (guardedCommand === null) throw new Error('the runner\'s command can\'t be given');
        await label(worktree);
      } catch (error) {
        onError(`The ${work} worktree couldn't be made ready for Guarded, so this run asks for build commands: ${error instanceof Error ? error.message : 'unknown error'}`);
        level = 'ask';
      }
    }
    const used = readGrantsUsed(project);
    const given = grants.filter((g) => g.scope !== 'run' || (used !== null && !used.includes(g.questionId)));
    const allowed = platform === 'win32'
      ? featureAllowRules(config, { platform, level, grants: given, guardedCommand })
      : featureAllowRules(config, { platform });
    // Used up at every level: a grant given while Unattended or Guarded is on is spent with
    // this run, so it is not there for a later run once the level goes back to Ask.
    const runs = given.filter((g) => g.scope === 'run' && typeof g.questionId === 'string').map((g) => g.questionId);
    const inputs = {
      level,
      grants: given,
      guardedCommand,
      worktree,
      domains: Array.isArray(config?.webDomains) ? config.webDomains : [],
      realUsers: answer.realUsers,
      keysUnreadable: answer.keysUnreadable,
      hostApproval: answer.hostApproval,
      unattendedConfirmed: level === 'unattended',
    };
    return {
      allowed,
      inputs,
      recordUsed: (call) => recordGrantsUsed(project, platform === 'win32' || typeof call?.level === 'string' ? runs : []),
    };
  };

  const checkoutOf = () => {
    const folder = readProject(project)?.folder;
    if (typeof folder !== 'string') throw new Error("The project's folder isn't known");
    return folder;
  };

  // The session id the watcher kept for the feature in this worktree: the one it made, or, for an adapter whose
  // sessions name their own (`fromRun`), the one the first run gave (ruling P8-3). STARTING while that first run
  // hasn't given it yet; null when there is none.
  const keptSession = (work, worktree) => {
    const kept = readJson(sessionFile(project, work));
    if (!isPlain(kept) || typeof kept.worktree !== 'string' || path.resolve(kept.worktree) !== path.resolve(worktree)) return null;
    if (kept.fromRun === true) {
      if (kept.sessionId === null) return STARTING;
      return typeof kept.sessionId === 'string' && RUN_ID.test(kept.sessionId) ? kept.sessionId : null;
    }
    return typeof kept.sessionId === 'string' && UUID.test(kept.sessionId) ? kept.sessionId : null;
  };

  // Keeps the session id a feature's first run gave, for its wakes; a first run that gave none leaves no session
  // to wake, so its record is removed and the foreman's next start begins it again (ruling P8-3).
  const keepStartedId = (work, id) => {
    const file = sessionFile(project, work);
    const kept = readJson(file);
    if (!isPlain(kept) || kept.fromRun !== true || kept.sessionId !== null) return;
    if (typeof id === 'string' && RUN_ID.test(id)) {
      writeJsonFile(file, { ...kept, sessionId: id });
      return;
    }
    fs.rmSync(file, { force: true });
    onError(`The ${work} session's first run gave no session id; it is started again by the foreman's next \`act start\``);
  };

  // Whether the feature's wakes `ids` are held by the files in `worktree` that steer agents: when
  // one is new or changed since the worktree was made, or there is no record of them, the wakes
  // fail, the finding is raised once (a raise that fails is tried again at the next wake), and
  // nothing is woken. A folder that can't be read holds them too. Once the files match again, a
  // finding raised before is lifted.
  // Whether the director kept the files as `found` found them (ruling P7-33): the watcher's own last
  // finding raised for the work (kept under the home, never read from the state) is this one, and a
  // verified keep-control-files action names its hash, was made after the record it would replace
  // was kept, and was a Confirm on a card whose one set line is that finding's Keep line and whose
  // words say what the watcher found, by name or by count.
  const keptByDirector = (work, found) => {
    const raised = raisedOf(project, work);
    if (raised === null || raised.hash !== found.hash || raised.why !== found.why) return false;
    const line = keepControlLine(work, found.hash);
    const said = [false, true].map((short) => controlFilesNamed(raised, { short }));
    const enrolled = readEnrolled();
    return listEvents(stateDir(project), { report: () => {} }).some((e) => e.kind === 'action' && e.data?.action === 'keep-control-files'
      && e.data.work === work && e.data.hash === found.hash && (found.since === null || e.at > found.since)
      && typeof e.data.question === 'string' && setLineOf(e.data.question) === line && said.some((words) => e.data.question.includes(words))
      && verify(e, enrolled));
  };

  // Whether a control-file-lift for the work came into the state after `at`: one the watcher didn't
  // write (its own clears its finding first), so the card it closed is raised again.
  const liftedSince = (work, at) => listEvents(stateDir(project), { report: () => {} })
    .some((e) => e.kind === 'control-file-lift' && e.data?.work === work && typeof e.at === 'string' && e.at > at);

  async function controlHeld(work, worktree, ids) {
    let found;
    try {
      found = checkControlFiles(project, work, worktree, { platform, walkCap });
    } catch (error) {
      settle(ids, 'failed', `the files in its folder that steer agents can't be read: ${error instanceof Error ? error.message : 'unknown error'}`);
      return true;
    }
    const at = now().toISOString();
    if (!found.ok && found.state !== null && keptByDirector(work, found)) {
      try {
        writeBaseline(project, work, worktree, { now, platform, state: found.state });
      } catch (error) {
        settle(ids, 'failed', `the director kept its agent files, but the record of them couldn't be written: ${error instanceof Error ? error.message : 'unknown error'}`);
        return true;
      }
      found = { ok: true };
    }
    if (found.ok) {
      if (raisedOf(project, work) !== null) {
        try {
          await raise({ kind: 'control-file-lift', data: { work, at } });
          markRaised(project, work, null);
        } catch (error) {
          onError(`The ${work} feature's agent files match again, but its card couldn't be closed: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      return false;
    }
    const why = {
      'no-record': "there is no record yet of this feature's agent files",
      'too-many': 'its folder has too many files to check',
      changed: `its folder has a new or changed file that steers agents: ${found.paths.slice(0, 3).join(', ')}${found.paths.length > 3 ? ` and ${found.paths.length - 3} more` : ''}`,
    }[found.why];
    settle(ids, 'failed', why);
    const raised = raisedOf(project, work);
    if (raised?.hash === found.hash && !liftedSince(work, raised.at)) return true;
    const paths = found.paths.slice(0, CONTROL_PATHS);
    try {
      await raise({ kind: 'control-file', data: { work, why: found.why, paths, hash: found.hash, at } });
      markRaised(project, work, { hash: found.hash, why: found.why, paths, at });
    } catch (error) {
      onError(`The ${work} feature's agent files hold its wakes, but the card couldn't be raised: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    return true;
  }

  // The features whose wakes wait for a session the watcher started, already reported.
  const unstarted = new Set();

  const ready = (e) => e.flight === null || e.flight === undefined
    ? (typeof e.retryAt !== 'string' || Date.parse(e.retryAt) <= now().getTime())
    : false;

  // The waiting wakes for one target as one entry: several are merged into a
  // new record, which takes their place in the outbox.
  function gather(entries, waiting, to, work) {
    if (waiting.length === 1) return { entries, entry: waiting[0] };
    const file = mergeWakes(project, to, work, waiting.map((e) => e.file), now);
    const failures = Math.max(0, ...waiting.map((e) => (Number.isInteger(e.failures) ? e.failures : 0)));
    const entry = newEntry({ to, ...(work === undefined ? {} : { work }), file, failures });
    const gone = new Set(waiting.map((e) => e.id));
    const next = [...entries.filter((e) => !gone.has(e.id)), entry];
    save(next);
    return { entries: next, entry };
  }

  const markFlight = (entries, entry) => {
    const next = entries.map((e) => (e.id === entry.id ? { ...e, flight: { at: now().toISOString() } } : e));
    save(next);
    return next;
  };

  // Delivers what can go now and keeps the rest. Returns what was delivered.
  async function deliver() {
    mayStart('checkForeman');
    if (stopped()) return [];
    return shape === 2 ? deliverByLine() : deliverByStart();
  }

  async function deliverByLine() {
    const delivered = [];
    for (const e of load()) {
      if (!ready(e)) continue;
      if (stopped()) break;
      let copy;
      try {
        if (e.to === 'foreman') copy = copyInto(e.file, foremanWakesDir(checkoutOf()), shape2Column());
        else {
          const worktree = locate(e.work);
          if (worktree === null) {
            settle([e.id], 'done'); // the feature has closed or gone
            continue;
          }
          if (await controlHeld(e.work, worktree, [e.id])) continue;
          copy = copyInto(e.file, featureWakesDir(worktree), shape2Column());
        }
      } catch (error) {
        settle([e.id], 'failed', error.message);
        continue;
      }
      const line = e.to === 'foreman' ? `WAKE foreman ${copy}` : `WAKE feature ${e.work} ${copy}`;
      if (/[\r\n]/.test(line)) {
        settle([e.id], 'failed', 'its line would not be one line');
        continue;
      }
      print(line);
      settle([e.id], 'done');
      delivered.push({ to: e.to, work: e.work, file: copy });
    }
    return delivered;
  }

  // The features with a record of a running session, so a run whose exit wasn't seen here is read once it ends.
  const runningWorks = () => {
    let names;
    try {
      names = fs.readdirSync(path.join(watcherDir(project), 'running'));
    } catch {
      return [];
    }
    return names.filter((n) => n.startsWith('feature-') && n.endsWith('.json')).map((n) => n.slice('feature-'.length, -'.json'.length)).filter((w) => SLUG.test(w));
  };

  async function deliverByStart() {
    const delivered = [];
    const works = [...new Set([...load().filter((e) => e.to === 'feature').map((e) => e.work), ...runningWorks()])];
    for (const work of [undefined, ...works]) {
      const target = targetOf(work);
      const state = await stateOf(target);
      if (state?.ended) await endRecord(target, state);
      else if (state?.live) continue;
      let entries = load();
      const mine = (e) => (work === undefined ? e.to === 'foreman' : e.to === 'feature' && e.work === work);
      // In flight with no live process: its process went before this watcher saw it exit.
      const lost = entries.filter((e) => mine(e) && !ready(e) && e.flight);
      if (lost.length > 0) {
        settle(lost.map((e) => e.id), 'again');
        entries = load();
      }
      const waiting = entries.filter((e) => mine(e) && ready(e));
      if (waiting.length === 0) continue;

      let cwd;
      let session = null;
      if (work !== undefined) {
        cwd = locate(work);
        if (cwd === null) {
          settle(entries.filter(mine).map((e) => e.id), 'done'); // the feature has closed or gone
          continue;
        }
        session = keptSession(work, cwd);
        if (session === STARTING) {
          // Its first run ended with no id kept for it (its record has gone): there is no session to wake. A record
          // younger than a start's own time may belong to a start still being made elsewhere: it waits.
          const since = Date.parse(readJson(sessionFile(project, work))?.at ?? '');
          if (!Number.isNaN(since) && now().getTime() - since < STARTING_MS) continue;
          keepStartedId(work, null);
          continue;
        }
        if (session === null) {
          if (!unstarted.has(work)) onError(`The ${work} session was not started by the watcher, so its wakes wait`);
          unstarted.add(work); // said once
          continue;
        }
        unstarted.delete(work);
        if (await controlHeld(work, cwd, waiting.map((e) => e.id))) continue;
      }
      let gathered;
      let copy;
      try {
        cwd ??= checkoutOf();
        gathered = gather(entries, waiting, work === undefined ? 'foreman' : 'feature', work);
        copy = copyInto(gathered.entry.file, work === undefined ? foremanWakesDir(cwd) : featureWakesDir(cwd));
      } catch (error) {
        // Once gathered, the waiting wakes are one entry: that is the one that failed.
        settle(gathered ? [gathered.entry.id] : waiting.map((e) => e.id), 'failed', error.message);
        continue;
      }
      if (stopped()) return delivered;
      markFlight(gathered.entries, gathered.entry);
      try {
        let pid;
        if (work === undefined) {
          pid = await startForeman(cwd, PROMPTS.foreman(copy, wakeCommand), gathered);
        } else {
          const feature = await levelInputs(work, cwd);
          const column = columnNow();
          pid = await launch({
            target,
            cwd,
            check: (adapter) => adapter.checkFeature(config),
            build: (adapter) => adapter.featureResumeCall({
              config, project, work, sessionId: session, prompt: withColumn(adapter, PROMPTS.feature(copy), column), allowed: feature.allowed, env: baseEnv, claude, platform,
              ...feature.inputs, ...roleOf(column, 'feature'),
            }),
            file: gathered.entry.file,
            entries: [gathered.entry.id],
            // Built before the grants are recorded as used, so a call that can't be built uses none up.
            beforeRun: (call) => {
              if (stopped()) throw new StopNow();
              feature.recordUsed(call);
            },
          });
        }
        delivered.push({ to: work === undefined ? 'foreman' : 'feature', work, file: copy, pid });
      } catch (error) {
        if (error instanceof StopNow) {
          settle([gathered.entry.id], 'again');
          return delivered;
        }
        settle([gathered.entry.id], 'failed', error.message);
      }
    }
    return delivered;
  }

  const enqueue = (entry) => serial(async () => {
    save([...load(), newEntry(entry)]);
    return deliver();
  });

  const api = {
    // Wakes a fresh foreman for the wake whose record is `file`, now or once the running one ends.
    async wakeForeman(file) {
      mayStart('checkForeman');
      return enqueue({ to: 'foreman', file });
    },
    // Wakes the feature's own session with the wake whose record is `file`.
    async wakeFeature(work, file) {
      mayStart('checkFeature');
      if (typeof work !== 'string' || !SLUG.test(work)) throw new Error('A work id is lower-case letters, digits and hyphens');
      return enqueue({ to: 'feature', work, file });
    },
    // Starts the feature's session in its worktree, reading its brief.
    async startFeature({ work, worktree, briefFile } = {}) {
      mayStart('checkFeature');
      if (typeof work !== 'string' || !SLUG.test(work)) throw new Error('A work id is lower-case letters, digits and hyphens');
      if (!featureWorktreeOk(project, worktree)) throw new Error("This isn't a feature worktree of the project");
      const brief = featurePaths(worktree).brief;
      if (briefFile !== undefined && path.resolve(briefFile) !== brief) throw new Error("The brief must be the worktree's own .wheelhouse/feature/brief.md");
      if (!lstatOf(brief)?.isFile()) throw new Error("The feature's brief isn't there");
      return serial(async () => {
        if (stopped()) throw new Error('STOP is on: no session is started');
        // The files that steer agents are checked as before a wake: a worktree a closed feature
        // left, started again, may hold some an earlier session planted (ruling P7-33).
        if (await controlHeld(work, worktree, [])) throw new Error("the files in its folder that steer agents are new or changed, or can't be checked, so its session waits for the director's card");
        if (shape === 2) {
          // The column for its subagents, in a wake of its own in the feature's wakes folder, which its brief names.
          const add = shape2Column();
          if (add !== null) copyInto(writeWake(project, { to: 'feature', work, events: [], digest: [], dropped: 0 }, { now }), featureWakesDir(worktree), add);
          print(`START feature ${work} ${worktree}`);
          return { printed: true };
        }
        const target = targetOf(work);
        const state = await stateOf(target);
        if (state?.live) throw new Error(`The ${work} session is already running`);
        if (state?.ended) await endRecord(target, state);
        // Checked before anything is written, so a refused start leaves nothing behind.
        sessionsOf().checkFeature(config);
        const sessionId = crypto.randomUUID();
        if (stopped()) throw new Error('STOP is on: no session is started');
        const feature = await levelInputs(work, worktree);
        const column = columnNow();
        let named = sessionId;
        const pid = await launch({
          target,
          cwd: worktree,
          check: (adapter) => adapter.checkFeature(config),
          build: (adapter) => adapter.featureStartCall({
            config, project, work, sessionId, prompt: withColumn(adapter, PROMPTS.start, column), allowed: feature.allowed, env: baseEnv, claude, platform,
            ...feature.inputs, ...roleOf(column, 'feature'),
          }),
          file: brief,
          beforeRun: (call) => {
            if (stopped()) throw new Error('STOP is on: no session is started');
            feature.recordUsed(call);
          },
          // The session's id is kept before the run starts, once its record is written: the one made here, or, for
          // an adapter whose sessions name their own (`idFromRun`), none yet, which the first run's output gives
          // (ruling P8-3).
          afterRecord: (call) => {
            named = call.idFromRun === true ? null : sessionId;
            watcherFolder(project, 'sessions');
            writeJsonFile(sessionFile(project, work), { sessionId: named, worktree, at: now().toISOString(), ...(named === null ? { fromRun: true } : {}) });
          },
        });
        return { pid, sessionId: named };
      });
    },
    // Delivers what has been waiting: a session has ended, STOP has lifted, a wait has passed.
    pump() {
      return serial(deliver);
    },
    // Removes wake files older than the look-back, keeping every one the outbox still names.
    prune() {
      return serial(async () => {
        const keep = new Set(load().map((e) => path.basename(e.file)));
        const t = now().getTime();
        pruneFolder(wakesDir(project), keep, t);
        const checkout = readProject(project)?.folder;
        if (typeof checkout === 'string') {
          const dir = path.join(checkout, '.wheelhouse', 'foreman', 'wakes');
          if (lstatOf(dir)?.isDirectory() && realOf(dir) === path.join(realOf(checkout) ?? '', '.wheelhouse', 'foreman', 'wakes')) pruneFolder(dir, keep, t);
        }
        // A hold of an agent the project no longer runs on here goes, and its card closes (ruling P8-33): the agent is
        // read from the default branch's configuration this waker runs on, and the hold goes only when the main
        // checkout's names the same agent; otherwise it stands. A project with no agent's hold has nothing to look at,
        // so nothing more is read (not even this computer's id).
        try {
          if (hasAgentHolds(project)) {
            const id = computerId();
            const agent = agentOfConfig(config, { computerId: id });
            const checkoutAgent = typeof checkout === 'string' ? agentInFolder(checkout, { computerId: id }) : null;
            if (clearOtherAgentHolds(project, { agent, checkoutAgent }) > 0) await liftHolds();
          }
        } catch (error) {
          onError(`Another agent's hold couldn't be looked at: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
        // And the sessions' kept output past its days, when the adapter keeps any (ruling P8-2).
        let adapter = null;
        try {
          adapter = sessionsOf();
        } catch { /* no adapter to ask */ }
        // A prune that throws (a link where the activity folder should be) removes nothing, and says so.
        try {
          if (typeof adapter?.pruneActivity === 'function') adapter.pruneActivity({ project, now });
        } catch (error) {
          onError(`The sessions' old activity couldn't be pruned: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      });
    },
    // The wakes not yet delivered, oldest first.
    waiting() {
      return load();
    },
  };
  return api;
}
