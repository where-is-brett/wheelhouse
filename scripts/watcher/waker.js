// scripts/watcher/waker.js
// Waking the foreman or one feature session (build-loop design, section 11),
// by the route check 27 found. Both shapes are built, chosen by the project's
// `config.watcherShape`, until check 27's Windows half picks one:
//
//   Shape 1, the `print` route. The watcher starts each session itself, as a
//   detached process with no window:
//     - the foreman: a fresh `claude -p "Wheelhouse foreman: handle <file>"`
//       in the project's main checkout, with the foreman's model from
//       `config.routing.foreman`, `--permission-mode` from `config.sessionMode`
//       and WHEELHOUSE_ROLE=foreman in its environment;
//     - a feature: `claude -p --resume <session id> "Wheelhouse: read <file>"`
//       in its worktree, the session id from the hook's session.json. The mode
//       and model are given again, since check 27 found `--resume` needs them;
//     - a new feature: `claude -p "Read .wheelhouse/feature/brief.md and follow
//       it."` in its worktree.
//     A feature session gets the builder's model from `config.routing.builder`
//     and the feature allow rules with --allowedTools, since `claude -p` does
//     not apply the allow rules of a committed .claude/settings.json (check
//     25); nothing is written into the worktree. No feature session gets
//     WHEELHOUSE_ROLE, even when the watcher's own environment has it.
//     One process runs at a time for each session: a wake that falls due while
//     its session runs waits, and goes when the process has ended. Several that
//     waited together go as one wake listing them all (`merged`).
//   Shape 2. The watcher starts nothing. It prints one line on stdout for each
//   wake, which the plugin monitor delivers to the long-lived foreman session:
//     WAKE foreman <file> | WAKE feature <work> <file> | START feature <work> <worktree>
//
// Every wake first goes into the outbox, projects/<p>/watcher/outbox.json, and
// leaves it once delivered, so a wake that is waiting (for its session to end,
// for STOP to lift, or for `claude` to start) survives the watcher stopping.
// Under STOP nothing is started, woken or printed; startFeature is refused.
// What runs is recorded in projects/<p>/watcher/running/, so a restarted
// watcher still knows a foreman is running. A record made before the computer
// last started is taken as ended, since its process id may now be another's.
//
// Bypass mode is refused at every call, whatever the configuration says.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIGEST_CAP } from './core.js';
import { plainWorktreePath } from './sources.js';
import { invocation, resolveClaude } from '../eval/harness.js';
import { featurePaths } from '../feature/files.js';
import { readCapped, safeFeatureFolder } from '../feature/status.js';
import { DEFAULT_SESSION_MODE, SESSION_MODES, isModelName } from '../gate/guardrails.js';
import { SLUG } from '../lib/build-loop.js';
import { stateDir } from '../lib/paths.js';
import { isInsideFolder, readProject } from '../lib/projects.js';
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

// A session id as the feature-status hook keeps it; it never starts with `-`, so it never reads as a flag.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
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

// --- The watcher's folder, projects/<p>/watcher ---

export function watcherDir(project) {
  return path.join(path.dirname(stateDir(project)), 'watcher');
}

export function wakesDir(project) {
  return path.join(watcherDir(project), 'wakes');
}

const outboxFile = (project) => path.join(watcherDir(project), 'outbox.json');
const outboxLock = (project) => path.join(watcherDir(project), 'outbox.lock');
const runningFile = (project, target) => path.join(watcherDir(project), 'running', `${target}.json`);

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

// Writes JSON whole to a temporary name renamed over `file`, refusing a `file`
// that is there but is not a regular file.
export function writeJsonFile(file, value, fail = () => { throw new Error(`${path.basename(file)} can't be written`); }) {
  const stat = lstatOf(file);
  if (stat !== null && !stat.isFile()) fail();
  const temp = `${file}.${crypto.randomUUID().slice(0, 12)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
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

// Writes the bundle as projects/<p>/watcher/wakes/<time>.json and returns the
// file's path, which the wake message names. Each wake gets a name of its own
// (`<time>-<n>.json` when the time is taken), is written to a temporary file
// and renamed into place, and a wakes folder that is a link is refused.
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

// One wake from several that waited: each event once, the digests in order
// (the newest DIGEST_CAP kept, the rest counted in `dropped`).
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

// --- What sessions start with ---

// The explicit permission mode sessions start in: the configuration's, or
// `acceptEdits`. Bypass mode, and any mode not known, are refused.
export function sessionModeOf(config) {
  const mode = config?.sessionMode ?? DEFAULT_SESSION_MODE;
  if (mode === 'bypassPermissions') throw new Error('Wheelhouse never starts a session in bypass mode');
  if (!SESSION_MODES.includes(mode)) throw new Error(`This isn't a permission mode Wheelhouse starts sessions in: ${JSON.stringify(mode)}`);
  return mode;
}

// The role's model from the routing table, or null for the command line's own default.
function modelOf(config, role) {
  const model = config?.routing?.[role] ?? null;
  if (model !== null && !isModelName(model)) throw new Error(`The ${role}'s model can't be passed to claude`);
  return model;
}

// The environment with every spelling of WHEELHOUSE_ROLE taken out.
function withoutRole(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name.toUpperCase() !== ROLE_VARIABLE));
}

// The feature session's id from its session.json, or null.
export function featureSession(worktree) {
  const kept = readJson(featurePaths(worktree).session);
  return isPlain(kept) && typeof kept.sessionId === 'string' && SESSION_ID.test(kept.sessionId) ? kept.sessionId : null;
}

// Whether `worktree` is a feature worktree of the project: a full path, a real
// folder (not a link) inside the project's main checkout, with a real feature folder.
function featureWorktreeOk(project, worktree) {
  if (!plainWorktreePath(worktree) || /[\r\n]/.test(worktree)) return false;
  if (!lstatOf(worktree)?.isDirectory()) return false;
  const checkout = readProject(project)?.folder;
  return typeof checkout === 'string' && isInsideFolder(checkout, worktree) && safeFeatureFolder(worktree);
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
// process has started, with its pid and a promise that settles when it exits.
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
    const exited = new Promise((done) => { child.once('exit', () => done()); });
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

const bootTime = () => Date.now() - os.uptime() * 1000;

// --- The waker ---

export function makeWaker({
  shape,
  project,
  config,
  run = spawnDetached,
  print = (line) => process.stdout.write(`${line}\n`),
  now = () => new Date(),
  alive = pidAlive,
  bootedAt = bootTime,
  stopped = () => stopState().on,
  locate = locateFeature(project),
  claude = null,
  baseEnv = process.env,
}) {
  if (shape !== 1 && shape !== 2) throw new Error('The watcher shape is 1 or 2');
  sessionModeOf(config);
  watcherDir(project); // a project name that is not a folder name throws here

  const outboxFail = () => { throw new Error("The watcher's outbox can't be written"); };
  const validEntry = (e) => isPlain(e) && typeof e.file === 'string'
    && (e.to === 'foreman' || (e.to === 'feature' && typeof e.work === 'string' && SLUG.test(e.work)));
  const load = () => list(readJson(outboxFile(project), WAKE_BYTES)?.entries).filter(validEntry);
  const save = (entries) => {
    watcherFolder(project, null, outboxFail);
    writeJsonFile(outboxFile(project), { entries }, outboxFail);
  };

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

  // --- What is running (Shape 1) ---
  const targetOf = (work) => (work === undefined ? 'foreman' : `feature-${work}`);
  const runningOf = (target) => {
    const r = readJson(runningFile(project, target));
    if (!isPlain(r) || !Number.isInteger(r.pid) || r.pid < 1) return null;
    const at = Date.parse(r.at);
    if (Number.isNaN(at) || at < bootedAt()) return null;
    return alive(r.pid) ? r : null;
  };
  const record = (target, pid, file) => {
    watcherFolder(project, 'running');
    writeJsonFile(runningFile(project, target), { pid, at: now().toISOString(), file });
  };
  const forget = (target, pid) => {
    const r = readJson(runningFile(project, target));
    if (isPlain(r) && r.pid === pid) fs.rmSync(runningFile(project, target), { force: true });
  };

  async function launch({ target, cwd, prompt, args, env, file }) {
    const resolved = claude ?? resolveClaude({ env: baseEnv });
    const call = invocation(resolved, [], args, prompt);
    const started = await run(call.file, call.args, { cwd, env, input: call.input, windowsVerbatimArguments: call.verbatim });
    if (!Number.isInteger(started?.pid)) throw new Error('claude did not start');
    record(target, started.pid, file);
    if (started.exited && typeof started.exited.then === 'function') {
      started.exited.then(() => {
        forget(target, started.pid);
        return api.pump();
      }).catch(() => {});
    }
    return started.pid;
  }

  const foremanArgs = () => {
    const model = modelOf(config, 'foreman');
    return ['--permission-mode', sessionModeOf(config), ...(model ? ['--model', model] : [])];
  };
  const featureArgs = () => {
    const model = modelOf(config, 'builder');
    const allowed = featureAllowRules(config);
    return [
      '--permission-mode', sessionModeOf(config),
      ...(model ? ['--model', model] : []),
      ...(allowed.length > 0 ? ['--allowedTools', ...allowed] : []),
    ];
  };

  const startForeman = (file) => {
    const cwd = readProject(project)?.folder;
    if (typeof cwd !== 'string') throw new Error("The project's folder isn't known");
    return launch({
      target: 'foreman', cwd, prompt: PROMPTS.foreman(file), args: foremanArgs(), env: { ...withoutRole(baseEnv), [ROLE_VARIABLE]: 'foreman' }, file,
    });
  };

  const lineOf = (e) => {
    const line = e.to === 'foreman' ? `WAKE foreman ${e.file}` : `WAKE feature ${e.work} ${e.file}`;
    if (/[\r\n]/.test(line)) throw new Error('A wake line must be one line');
    return line;
  };

  // Delivers what can go now and keeps the rest. Returns what was delivered.
  async function deliver() {
    sessionModeOf(config);
    if (stopped()) return [];
    const entries = load();
    if (shape === 2) {
      for (const e of entries) print(lineOf(e));
      save([]);
      return entries;
    }
    const done = new Set();
    const delivered = [];
    const foreman = entries.filter((e) => e.to === 'foreman');
    if (foreman.length > 0 && runningOf('foreman') === null) {
      try {
        const file = foreman.length === 1 ? foreman[0].file : mergeWakes(project, 'foreman', undefined, foreman.map((e) => e.file), now);
        const pid = await startForeman(file);
        for (const e of foreman) done.add(e);
        delivered.push({ to: 'foreman', file, pid });
      } catch { /* it waits for the next try */ }
    }
    const works = [...new Set(entries.filter((e) => e.to === 'feature').map((e) => e.work))];
    for (const work of works) {
      const waiting = entries.filter((e) => e.to === 'feature' && e.work === work);
      if (runningOf(targetOf(work)) !== null) continue;
      const worktree = locate(work);
      if (worktree === null) {
        for (const e of waiting) done.add(e); // the feature has closed or gone
        continue;
      }
      const session = featureSession(worktree);
      if (session === null) continue; // its session has not run a tool yet
      try {
        const file = waiting.length === 1 ? waiting[0].file : mergeWakes(project, 'feature', work, waiting.map((e) => e.file), now);
        const pid = await launch({
          target: targetOf(work), cwd: worktree, prompt: PROMPTS.feature(file), args: ['--resume', session, ...featureArgs()], env: withoutRole(baseEnv), file,
        });
        for (const e of waiting) done.add(e);
        delivered.push({ to: 'feature', work, file, pid });
      } catch { /* it waits for the next try */ }
    }
    if (done.size > 0) save(entries.filter((e) => !done.has(e)));
    return delivered;
  }

  const enqueue = (entry) => serial(async () => {
    save([...load(), entry]);
    return deliver();
  });

  const api = {
    // Wakes a fresh foreman for the wake in `file`, now or once the running one ends.
    async wakeForeman(file) {
      sessionModeOf(config);
      return enqueue({ to: 'foreman', file });
    },
    // Wakes the feature's own session with the wake in `file`.
    async wakeFeature(work, file) {
      sessionModeOf(config);
      if (typeof work !== 'string' || !SLUG.test(work)) throw new Error('A work id is lower-case letters, digits and hyphens');
      return enqueue({ to: 'feature', work, file });
    },
    // Starts the feature's session in its worktree, reading its brief.
    async startFeature({ work, worktree, briefFile } = {}) {
      sessionModeOf(config);
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
        if (runningOf(targetOf(work)) !== null) throw new Error(`The ${work} session is already running`);
        const pid = await launch({
          target: targetOf(work), cwd: worktree, prompt: PROMPTS.start, args: featureArgs(), env: withoutRole(baseEnv), file: brief,
        });
        return { pid };
      });
    },
    // Delivers what has been waiting: a session has ended, STOP has lifted, or claude can start now.
    pump() {
      return serial(deliver);
    },
    // The wakes not yet delivered, oldest first.
    waiting() {
      return load();
    },
  };
  return api;
}
