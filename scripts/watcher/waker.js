// scripts/watcher/waker.js
// Waking the foreman or one feature session (build-loop design, section 11),
// by the route check 27 found. Both shapes are built, chosen by the project's
// `config.watcherShape`, until check 27's Windows half picks one:
//
//   Shape 1, the `print` route. The watcher starts each session itself, as a
//   detached process with no window:
//     - the foreman: a fresh `claude -p "Wheelhouse foreman: handle <file>"`
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
//     25); on Windows there are none (settings.js). Its mode may not be `auto`.
//     One process runs at a time for each session: a wake that falls due while
//     its session runs waits, and goes when the process has ended. Several that
//     waited together go as one wake listing them all (`merged`).
//   Shape 2. The watcher starts nothing. It prints one line on stdout for each
//   wake, which the plugin monitor delivers to the long-lived foreman session:
//     WAKE foreman <file> | WAKE feature <work> <file> | START feature <work> <worktree>
//
// Every started session gets the watcher's environment less the variables a
// host Claude Code session sets (scripts/lib/claude.js) and less
// WHEELHOUSE_ROLE; the foreman alone gets WHEELHOUSE_ROLE=foreman.
//
// The wake files. The record of each wake is written under the watcher's
// folder, projects/<p>/watcher/wakes/, which no session can read or write.
// What a session is told to read is a copy of it in a folder of its own: the
// main checkout's `.wheelhouse/foreman/wakes/` (git-ignored through
// info/exclude) for the foreman, the worktree's `.wheelhouse/feature/wakes/`
// for a feature. Each folder must be a real folder whose real path is where it
// should be. Merging reads only the records, never a copy.
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
// whose process can't be checked (a `starting` one, or no start time to be
// had) ends at the time limit alone.
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
import { DEFAULT_SESSION_MODE, SESSION_MODES, isModelName } from '../gate/guardrails.js';
import { SLUG } from '../lib/build-loop.js';
import { invocation, resolveClaude, withoutHostVariables } from '../lib/claude.js';
import { stateDir } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { run as runProgram } from '../lib/run.js';
import { takeStartLock } from '../lib/start-lock.js';
import { stopState } from '../lib/stop.js';
import { featureAllowRules } from '../protection/settings.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { buildViews } from '../state/views.js';

export const PROMPTS = Object.freeze({
  foreman: (file) => `Wheelhouse foreman: handle ${file}`,
  feature: (file) => `Wheelhouse: read ${file}`,
  start: 'Read .wheelhouse/feature/brief.md and follow it.',
});

export const ROLE_VARIABLE = 'WHEELHOUSE_ROLE';
const MINUTE = 60 * 1000;
// The longest a session's process counts as running.
export const MAX_RUN_MS = Object.freeze({ foreman: 60 * MINUTE, feature: 8 * 60 * MINUTE });
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
  if (realOf(dir) !== path.join(rootReal, ...parts)) fail();
  return dir;
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

// Copies the record `file` into `dir` under its own name, and returns the copy's path.
function copyWake(file, dir) {
  const text = readCapped(file, WAKE_BYTES);
  if (text === null) throw new Error("The wake's record can't be read");
  const copy = path.join(dir, path.basename(file));
  writeWholeText(copy, text, () => { throw new Error("The wake's copy can't be written"); });
  return copy;
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

// --- What sessions start with ---

// The explicit permission mode sessions start in: the configuration's, or
// `acceptEdits`. Bypass mode, and any mode not known, are refused.
export function sessionModeOf(config) {
  const mode = config?.sessionMode ?? DEFAULT_SESSION_MODE;
  if (mode === 'bypassPermissions') throw new Error('Wheelhouse never starts a session in bypass mode');
  if (!SESSION_MODES.includes(mode)) throw new Error(`This isn't a permission mode Wheelhouse starts sessions in: ${JSON.stringify(mode)}`);
  return mode;
}

// A feature session's mode: as sessionModeOf, and never `auto`, on any system.
export function featureModeOf(config) {
  const mode = sessionModeOf(config);
  if (mode === 'auto') throw new Error('A feature session is never started in auto mode');
  return mode;
}

// The role's model from the routing table, or null for the command line's own default.
function modelOf(config, role) {
  const model = config?.routing?.[role] ?? null;
  if (model !== null && !isModelName(model)) throw new Error(`The ${role}'s model can't be passed to claude`);
  return model;
}

// The environment a started session gets: the host session's variables and
// every spelling of WHEELHOUSE_ROLE taken out.
export function sessionEnv(env) {
  return Object.fromEntries(Object.entries(withoutHostVariables(env)).filter(([name]) => name.toUpperCase() !== ROLE_VARIABLE));
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

// When the process with this id started, as the system says it, or null when
// that can't be had: `ps -o lstart=` on macOS and Linux, the process's start
// time through PowerShell on Windows.
export async function processStartTime(pid, { platform = process.platform, run = runProgram } = {}) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    const answer = platform === 'win32'
      ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`], { timeoutMs: 15000 })
      : await run('ps', ['-o', 'lstart=', '-p', String(pid)], { timeoutMs: 5000 });
    const text = answer.code === 0 ? answer.stdout.trim() : '';
    return text === '' ? null : text;
  } catch {
    return null;
  }
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
  startTimeOf = (pid) => processStartTime(pid),
  bootedAt = bootTime,
  stopped = () => stopState().on,
  locate = locateFeature(project),
  claude = null,
  baseEnv = process.env,
  platform = process.platform,
  onError = () => {},
}) {
  if (shape !== 1 && shape !== 2) throw new Error('The watcher shape is 1 or 2');
  sessionModeOf(config);
  if (!Array.isArray(foremanTools) || !foremanTools.every((t) => typeof t === 'string' && t !== '' && !/[\r\n]/.test(t))) {
    throw new Error("The foreman's tools are a list of tool rules");
  }
  watcherDir(project); // a project name that is not a folder name throws here

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

  // Whether the target's recorded process still runs: `{ live }`, `{ ended,
  // why }` (why: 'gone' or 'overran'), or null when nothing is recorded.
  async function stateOf(target) {
    const r = readRunning(target);
    if (r === null) return null;
    const at = Date.parse(r.at);
    const t = now().getTime();
    if (Number.isNaN(at) || at < bootedAt()) return { ended: r, why: 'gone' };
    if (r.state !== 'starting') {
      if (!Number.isInteger(r.pid) || !alive(r.pid)) return { ended: r, why: 'gone' };
      if (typeof r.startTime === 'string') {
        const current = await startTimeOf(r.pid);
        if (current !== null && current !== r.startTime) return { ended: r, why: 'gone' };
      }
    }
    // Still running, or a `starting` record with no pid to check: the time limit decides.
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

  // Starts claude for `target`, recording it as starting first and as running
  // after. Resolves with the pid; the exit code settles `entries`.
  async function launch({ target, cwd, prompt, args, env, file, entries = [] }) {
    const resolved = claude ?? resolveClaude({ env: baseEnv });
    const call = invocation(resolved, [], args, prompt);
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
    const startTime = await startTimeOf(started.pid);
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

  const foremanArgs = () => {
    const model = modelOf(config, 'foreman');
    return [
      '--permission-mode', sessionModeOf(config),
      ...(model ? ['--model', model] : []),
      ...(foremanTools.length > 0 ? ['--allowedTools', ...foremanTools] : []),
    ];
  };
  const featureArgs = () => {
    const model = modelOf(config, 'builder');
    const allowed = featureAllowRules(config, { platform });
    return [
      '--permission-mode', featureModeOf(config),
      ...(model ? ['--model', model] : []),
      ...(allowed.length > 0 ? ['--allowedTools', ...allowed] : []),
    ];
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
        if (e.to === 'foreman') copy = copyWake(e.file, foremanWakesDir(checkoutOf()));
        else {
          const worktree = locate(e.work);
          if (worktree === null) {
            settle([e.id], 'done'); // the feature has closed or gone
            continue;
          }
          copy = copyWake(e.file, featureWakesDir(worktree));
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
        copy = copyWake(gathered.entry.file, work === undefined ? foremanWakesDir(cwd) : featureWakesDir(cwd));
      } catch (error) {
        settle(waiting.map((e) => e.id), 'failed', error.message);
        continue;
      }
      if (stopped()) return delivered;
      markFlight(gathered.entries, gathered.entry);
      try {
        const pid = work === undefined
          ? await launch({
            target, cwd, prompt: PROMPTS.foreman(copy), args: foremanArgs(), env: { ...sessionEnv(baseEnv), [ROLE_VARIABLE]: 'foreman' }, file: gathered.entry.file, entries: [gathered.entry.id],
          })
          : await launch({
            target, cwd, prompt: PROMPTS.feature(copy), args: ['--resume', session, ...featureArgs()], env: sessionEnv(baseEnv), file: gathered.entry.file, entries: [gathered.entry.id],
          });
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
        const pid = await launch({
          target, cwd: worktree, prompt: PROMPTS.start, args: ['--session-id', sessionId, ...featureArgs()], env: sessionEnv(baseEnv), file: brief,
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
