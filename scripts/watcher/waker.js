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
//       in the project's main checkout, with the foreman's model from
//       `config.routing.foreman`, `--permission-mode` from `config.sessionMode`,
//       `--allowedTools` from `foremanTools` when there are any, and
//       WHEELHOUSE_ROLE=foreman in its environment;
//     - a new feature: `claude -p --session-id <id> "Read
//       .wheelhouse/feature/brief.md and follow it."` in its worktree. The id
//       is made here and kept in the watcher's own folder;
//     - a feature: `claude -p --resume <that id> "Wheelhouse: read <file>"` in
//       its worktree. Only the id the watcher kept is resumed, never one from
//       a file the session can write. The mode and model are given again,
//       since check 27 found `--resume` needs them.
//     A feature session gets the builder's model from `config.routing.builder`
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
// outbox only when that process exits with 0. A process that exits otherwise,
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
// Under STOP nothing is started, woken or printed (it is checked again right
// before each start), and startFeature is refused. Bypass mode is refused at
// every call, whatever the configuration says.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIGEST_CAP } from './core.js';
import { inWorktreesFolder, LOOKBACK_MS, plainWorktreePath } from './sources.js';
import { ensureIgnored, featurePaths } from '../feature/files.js';
import { readCapped, safeFeatureFolder } from '../feature/status.js';
import { SLUG } from '../lib/build-loop.js';
import { computerId, stateDir, wheelhouseHome } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { run as runProgram } from '../lib/run.js';
import { takeStartLock } from '../lib/start-lock.js';
import { stopState } from '../lib/stop.js';
import { ROLE_VARIABLE, featureModeOf, sessionEnv, sessionModeOf } from '../../adapters/claude-code/sessions.js';
import { sessionsOfProject } from '../agents/project-agent.js';
import { PLUGIN_ROOT, foremanCommands } from '../foreman/tools.js';
import { lockedByPath } from '../hooks/kit.js';
import { featureAllowRules } from '../protection/settings.js';
import { LEVELS, buildGrants, buildsLevel } from '../protection/windows-builds.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { buildViews } from '../state/views.js';
import { guardedCommand, guardedReady, labelWorktree } from '../windows/low.js';

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
// self-test passes (guardedReady). Anything that can't be read is Ask with no
// grants.
export function windowsBuildsOf(project, { pluginRoot = PLUGIN_ROOT, now = () => new Date(), platform = process.platform } = {}) {
  return (work) => {
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
        grants: buildGrants({ views, work, used: readGrantsUsed(project), computer }),
        guardedCommand: runner,
      };
    } catch {
      return { level: 'ask', grants: [], guardedCommand: null };
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
function copyWake(project, file, place, { beforeCopy = () => {} } = {}) {
  const moved = () => { throw new Error("The wakes folder isn't a real folder where it should be"); };
  const text = readCapped(file, WAKE_BYTES);
  if (text === null) throw new Error("The wake's record can't be read");
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

// Starts `file` with `args` detached from the watcher, with no window and no
// output kept; `input`, when given, is written to its stdin. Resolves once the
// process has started, with its pid and a promise of its exit code.
export function spawnDetached(file, args, { cwd, env, input = '', windowsVerbatimArguments = false } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd, env, detached: true, windowsHide: true, shell: false, windowsVerbatimArguments, stdio: [input ? 'pipe' : 'ignore', 'ignore', 'ignore'],
      });
    } catch (error) {
      reject(error);
      return;
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
  beforeCopy = () => {},
}) {
  if (shape !== 1 && shape !== 2) throw new Error('The watcher shape is 1 or 2');
  // The foreman's wake command, for its prompt; none when the plugin's folder can't be given as one.
  let wakeCommand = null;
  try {
    wakeCommand = foremanCommands(pluginRoot, { platform }).wake;
  } catch { /* the prompt names the playbook alone */ }
  sessionModeOf(config);
  if (!Array.isArray(foremanTools) || !foremanTools.every((t) => typeof t === 'string' && t !== '' && !/[\r\n]/.test(t))) {
    throw new Error("The foreman's tools are a list of tool rules");
  }
  watcherDir(project); // a project name that is not a folder name throws here
  const buildsOf = windowsBuilds ?? windowsBuildsOf(project, { pluginRoot, now, platform });
  // Start times, asked of this system for every running pid at once and kept a minute.
  const startTimes = makeStartTimes({ now });
  const timeOf = startTimeOf ?? ((pid, others, options) => startTimes.get(pid, others, options));
  const copyInto = (file, place) => copyWake(project, file, place, { beforeCopy });

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
  const forget = (target, pid) => {
    const r = readRunning(target);
    if (r !== null && r.pid === pid) fs.rmSync(runningFile(project, target), { force: true });
  };

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

  // Ends a record that has ended: its wakes go again (an overrun counts as a failure).
  function endRecord(target, state) {
    const ids = list(state.ended.entries).filter((x) => typeof x === 'string');
    fs.rmSync(runningFile(project, target), { force: true });
    if (state.why === 'overran') {
      const minutes = Math.round(maxRunOf(target) / MINUTE);
      onError(`The ${target === 'foreman' ? 'foreman' : target.slice('feature-'.length)} session ran past its ${minutes} minutes`);
      settle(ids, 'failed', 'its session ran past its time');
    } else {
      settle(ids, 'again');
    }
  }

  // The sessions part of the adapter for the agent this computer runs for the project (the `agents` map of the
  // configuration from the default branch, which the mode and the models come from too; Claude Code when it
  // names none), unless one was given.
  const sessionsOf = () => sessions ?? sessionsOfProject(config);

  // Starts the session `call` describes (the adapter's { file, args, env, input, verbatim }) for `target`,
  // recording it as starting first and as running after. Resolves with the pid; the exit code settles `entries`.
  async function launch({ target, cwd, call, file, entries = [] }) {
    const { env } = call;
    watcherFolder(project, 'running');
    const file0 = runningFile(project, target);
    const at = now().toISOString();
    writeJsonFile(file0, { state: 'starting', at, file, entries });
    let started;
    try {
      started = await run(call.file, call.args, { cwd, env, input: call.input, windowsVerbatimArguments: call.verbatim });
      if (!Number.isInteger(started?.pid)) throw new Error('claude did not start');
    } catch (error) {
      fs.rmSync(file0, { force: true });
      throw error;
    }
    const startTime = await timeOf(started.pid, [], { fresh: true });
    writeJsonFile(file0, { state: 'running', pid: started.pid, startTime, at, file, entries });
    if (started.exited && typeof started.exited.then === 'function') {
      started.exited.then((code) => serial(async () => {
        forget(target, started.pid);
        if (code === 0) settle(entries, 'done');
        else {
          settle(entries, 'failed', `its session exited with code ${code}`);
          if (entries.length === 0) onError(`The ${target.slice('feature-'.length)} session exited with code ${code}`);
        }
        return deliver();
      })).catch(() => {});
    }
    return started.pid;
  }

  // The call that starts a fresh foreman to read `prompt`'s wake.
  const foremanCall = (prompt) => sessionsOf().foremanCall({
    config, prompt, tools: foremanTools, env: baseEnv, claude,
  });
  // What windowsBuilds answers for `work`, or Ask with no grants when it can't answer.
  const windowsAnswer = (work) => {
    let answer;
    try {
      answer = buildsOf(work);
    } catch {
      answer = null;
    }
    return {
      level: LEVELS.includes(answer?.level) ? answer.level : 'ask',
      grants: Array.isArray(answer?.grants) ? answer.grants.filter(isPlain) : [],
      guardedCommand: typeof answer?.guardedCommand === 'string' ? answer.guardedCommand : null,
    };
  };
  // Labels the worktree for the low runner: by default with Windows' own icacls, the common
  // folder being the main checkout's .git.
  const label = labelGuarded ?? ((worktree) => labelWorktree(worktree, { run: runProgram, commonDir: path.join(checkoutOf(), '.git') }));
  // The feature session's allow rules for `work` in `worktree`, and the Allow this time grants they
  // give, which are recorded as used before the run starts (Windows only). The record is read
  // again here, so a grant goes to one run whatever windowsBuilds answers. At Guarded the worktree
  // is labelled first; if it can't be, the run gets the Ask rules (failing closed) and says so.
  const featureRules = async (work, worktree) => {
    sessionsOf().checkFeature(config); // before anything is labelled or recorded
    let allowed;
    let runs = [];
    if (platform === 'win32') {
      const answer = windowsAnswer(work);
      const { grants, guardedCommand } = answer;
      let { level } = answer;
      if (level === 'guarded') {
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
      allowed = featureAllowRules(config, { platform, level, grants: given, guardedCommand });
      // Used up at every level: a grant given while Unattended or Guarded is on is spent with
      // this run, so it is not there for a later run once the level goes back to Ask.
      runs = given.filter((g) => g.scope === 'run' && typeof g.questionId === 'string').map((g) => g.questionId);
    } else {
      allowed = featureAllowRules(config, { platform });
    }
    return { allowed, recordUsed: () => recordGrantsUsed(project, runs) };
  };

  const checkoutOf = () => {
    const folder = readProject(project)?.folder;
    if (typeof folder !== 'string') throw new Error("The project's folder isn't known");
    return folder;
  };

  // The session id the watcher made for the feature in this worktree, or null.
  const keptSession = (work, worktree) => {
    const kept = readJson(sessionFile(project, work));
    if (!isPlain(kept) || typeof kept.sessionId !== 'string' || !UUID.test(kept.sessionId)) return null;
    return typeof kept.worktree === 'string' && path.resolve(kept.worktree) === path.resolve(worktree) ? kept.sessionId : null;
  };

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
    sessionModeOf(config);
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
        if (e.to === 'foreman') copy = copyInto(e.file, foremanWakesDir(checkoutOf()));
        else {
          const worktree = locate(e.work);
          if (worktree === null) {
            settle([e.id], 'done'); // the feature has closed or gone
            continue;
          }
          copy = copyInto(e.file, featureWakesDir(worktree));
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

  async function deliverByStart() {
    const delivered = [];
    const works = [...new Set(load().filter((e) => e.to === 'feature').map((e) => e.work))];
    for (const work of [undefined, ...works]) {
      const target = targetOf(work);
      const state = await stateOf(target);
      if (state?.ended) endRecord(target, state);
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
        if (session === null) {
          if (!unstarted.has(work)) onError(`The ${work} session was not started by the watcher, so its wakes wait`);
          unstarted.add(work); // said once
          continue;
        }
        unstarted.delete(work);
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
          pid = await launch({
            target, cwd, call: foremanCall(PROMPTS.foreman(copy, wakeCommand)), file: gathered.entry.file, entries: [gathered.entry.id],
          });
        } else {
          const feature = await featureRules(work, cwd);
          // Built before the grants are recorded as used, so a call that can't be built uses none up.
          const call = sessionsOf().featureResumeCall({
            config, sessionId: session, prompt: PROMPTS.feature(copy), allowed: feature.allowed, env: baseEnv, claude,
          });
          if (stopped()) {
            settle([gathered.entry.id], 'again');
            return delivered;
          }
          feature.recordUsed();
          pid = await launch({
            target, cwd, call, file: gathered.entry.file, entries: [gathered.entry.id],
          });
        }
        delivered.push({ to: work === undefined ? 'foreman' : 'feature', work, file: copy, pid });
      } catch (error) {
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
      sessionModeOf(config);
      return enqueue({ to: 'foreman', file });
    },
    // Wakes the feature's own session with the wake whose record is `file`.
    async wakeFeature(work, file) {
      featureModeOf(config);
      if (typeof work !== 'string' || !SLUG.test(work)) throw new Error('A work id is lower-case letters, digits and hyphens');
      return enqueue({ to: 'feature', work, file });
    },
    // Starts the feature's session in its worktree, reading its brief.
    async startFeature({ work, worktree, briefFile } = {}) {
      featureModeOf(config);
      if (typeof work !== 'string' || !SLUG.test(work)) throw new Error('A work id is lower-case letters, digits and hyphens');
      if (!featureWorktreeOk(project, worktree)) throw new Error("This isn't a feature worktree of the project");
      const brief = featurePaths(worktree).brief;
      if (briefFile !== undefined && path.resolve(briefFile) !== brief) throw new Error("The brief must be the worktree's own .wheelhouse/feature/brief.md");
      if (!lstatOf(brief)?.isFile()) throw new Error("The feature's brief isn't there");
      return serial(async () => {
        if (stopped()) throw new Error('STOP is on: no session is started');
        if (shape === 2) {
          print(`START feature ${work} ${worktree}`);
          return { printed: true };
        }
        const target = targetOf(work);
        const state = await stateOf(target);
        if (state?.live) throw new Error(`The ${work} session is already running`);
        if (state?.ended) endRecord(target, state);
        const sessionId = crypto.randomUUID();
        watcherFolder(project, 'sessions');
        writeJsonFile(sessionFile(project, work), { sessionId, worktree, at: now().toISOString() });
        if (stopped()) throw new Error('STOP is on: no session is started');
        const feature = await featureRules(work, worktree);
        const call = sessionsOf().featureStartCall({
          config, sessionId, prompt: PROMPTS.start, allowed: feature.allowed, env: baseEnv, claude,
        });
        if (stopped()) throw new Error('STOP is on: no session is started');
        feature.recordUsed();
        const pid = await launch({
          target, cwd: worktree, call, file: brief,
        });
        return { pid, sessionId };
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
      });
    },
    // The wakes not yet delivered, oldest first.
    waiting() {
      return load();
    },
  };
  return api;
}
