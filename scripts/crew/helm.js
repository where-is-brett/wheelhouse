// scripts/crew/helm.js
// The director's helm of a feature piece (crew visibility design, 9.1): opening the piece's own session in this terminal,
// holding it while they work, and handing it back with a wake when the terminal closes. The CLI is
// `node scripts/crew/helm.js open <work>`, and `node scripts/crew/helm.js now <work>` ends the piece's current run.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import sessionsAdapter from '../../adapters/claude-code/sessions.js';
import { helmHeld, readHold, takeHold, markOpened, releaseHold, claimHandBack } from './hold.js';
import {
  runningFile, sessionFile, processStartTime, pidAlive, writeWake, PROMPTS, STARTING_MS, locateFeature, makeWaker, firstPrompt, STEER_NAMES_ITSELF,
} from '../watcher/waker.js';
import { sessionsOfProject } from '../agents/project-agent.js';
import { stateDir } from '../lib/paths.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { buildViews } from '../state/views.js';
import { SLUG } from '../lib/build-loop.js';
import { findTranscript } from './runs.js';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function readJson(file) {
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// True only at a terminal, outside any agent's session: an agent cannot take the helm (design rule 7).
export function isDirector(env = process.env, stdin = process.stdin) {
  const set = (name) => Object.entries(env ?? {}).some(([k, v]) => k.toUpperCase() === name && v !== undefined && v !== '');
  return stdin?.isTTY === true && !set('WHEELHOUSE_ROLE') && !set('CLAUDECODE');
}

// Whether the piece's recorded run is still going: its record names a live process that started when the record says, or
// is a `starting` record too young to name one.
async function runIsLive(project, work, { now, alive, startTimeOf }) {
  const record = readJson(runningFile(project, `feature-${work}`));
  if (!isPlain(record)) return false;
  if (Number.isInteger(record.pid)) {
    if (!alive(record.pid)) return false;
    if (typeof record.startTime === 'string') {
      const started = await startTimeOf(record.pid);
      if (typeof started === 'string' && started !== record.startTime) return false;
    }
    return true;
  }
  const at = Date.parse(record.at);
  return record.state === 'starting' && !Number.isNaN(at) && now().getTime() - at < STARTING_MS;
}

const refuse = (why) => ({ code: 1, why });

// Opens the piece's session for the director and hands the piece back when it closes. Resolves `{ code }`; a refusal
// carries `why`, one line.
export async function openHelm(project, work, {
  spawn = spawnChild, now = () => new Date(), waitMs = 2000, env = process.env, stdin = process.stdin, config = {}, allowed = [],
  claude = null, platform = process.platform, alive = pidAlive, startTimeOf = processStartTime, print = (line) => process.stdout.write(`${line}\n`),
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  locate = locateFeature(project), proc = process, wakerFor = null,
} = {}) {
  if (!isDirector(env, stdin)) return refuse('The helm is for the director at their own terminal, not an agent.');
  if (typeof work !== 'string' || !SLUG.test(work)) return refuse('Name the piece by its short name.');
  const views = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
  const feature = views.features?.[work]?.data;
  if (!isPlain(feature) || feature.step === 'closed') return refuse(`${work} is not an open piece.`);
  const kept = readJson(sessionFile(project, work));
  if (!isPlain(kept) || typeof kept.sessionId !== 'string' || kept.sessionId === '') return refuse(`${work} has no session to open yet.`);
  // The waker's own answer for the piece's folder, so the helm and the waker agree on it.
  const worktree = locate(work);
  if (typeof worktree !== 'string' || worktree === '') return refuse(`${work} has no worktree to open.`);
  if (typeof kept.worktree === 'string' && kept.worktree !== '' && path.resolve(kept.worktree) !== path.resolve(worktree)) {
    return refuse(`${work}'s session is kept for a different folder than its worktree.`);
  }
  // A piece steered from the start has no transcript until its first open, which starts the session; any later open resumes it.
  const starting = readHold(project, work)?.fromStart === true && findTranscript({ sessionId: kept.sessionId, env }) === null;
  let call;
  try {
    call = sessionsAdapter.featureHelmCall({
      config, sessionId: kept.sessionId, allowed, env, claude, platform,
      ...(starting ? { start: true, prompt: firstPrompt(project, work, { config, now }) } : {}),
    });
  } catch (error) {
    return refuse(error instanceof Error ? error.message : 'The session could not be opened.');
  }

  if (helmHeld(project, work)) {
    const hold = readHold(project, work);
    if (hold === null || hold.sessionId !== kept.sessionId) return refuse(`The helm of ${work} is held by another session.`);
    if (hold.opened === true && Number.isInteger(hold.pid) && alive(hold.pid)) return refuse(`The helm of ${work} is already open in another terminal.`);
  } else {
    try {
      await takeHold(project, { work, sessionId: kept.sessionId, now });
    } catch (error) {
      if (error?.code === 'HELD') return refuse(`${work} is already at the helm in another terminal.`);
      return refuse(error instanceof Error ? error.message : `The helm of ${work} could not be taken.`);
    }
  }

  let why = 'closed';
  let opened = false;
  let interrupted = false;
  let child = null;
  // Ctrl-C belongs to the session while it runs, and ends the wait before it. A hang-up or terminate is passed to the
  // session, whose exit then hands the piece back; before there is a session it ends the wait.
  const onInt = () => { if (child === null) interrupted = true; };
  const onEnd = () => {
    if (child === null) interrupted = true;
    else child.kill?.('SIGTERM');
  };
  proc.on('SIGINT', onInt);
  proc.on('SIGHUP', onEnd);
  proc.on('SIGTERM', onEnd);
  try {
    let said = false;
    while (!interrupted && await runIsLive(project, work, { now, alive, startTimeOf })) {
      if (!said) {
        print(`Waiting for the crew's current step on ${work} to finish…`);
        said = true;
      }
      await sleep(waitMs);
    }
    if (interrupted) {
      why = 'interrupted';
    } else {
      child = spawn(call.file, call.args, {
        cwd: worktree, env: call.env, stdio: 'inherit', windowsVerbatimArguments: call.verbatim === true,
      });
      opened = true;
      const ended = new Promise((resolve) => {
        child.once('error', () => { why = 'failed'; resolve(1); });
        child.once('exit', (c) => resolve(c ?? 0));
      });
      const startTime = Number.isInteger(child.pid) ? await startTimeOf(child.pid).catch(() => null) : null;
      markOpened(project, work, { pid: Number.isInteger(child.pid) ? child.pid : null, startTime: typeof startTime === 'string' ? startTime : null });
      await ended;
    }
  } finally {
    proc.off('SIGINT', onInt);
    proc.off('SIGHUP', onEnd);
    proc.off('SIGTERM', onEnd);
    // A session never opened was never worked in: the hold goes with no wake.
    if (opened) await handBack(project, work, { why, now, config, wakerFor, print });
    else if (helmHeld(project, work)) await releaseHold(project, work, { why, now });
  }
  return { code: why === 'failed' || why === 'interrupted' ? 1 : 0 };
}

const handing = new Set();

// Hands the piece back: the hold goes and the piece is woken to read what the director did. It does nothing when no
// hold exists, so the session-end hook and the terminal's exit can both call it. The wake is written first, so a failed
// write cannot keep the hold; it is delivered to the waker (`wakerFor(config)`, by default a Shape 1 waker) once the hold
// is gone, and its file is taken away again if delivery throws. A wake that can't be written or delivered is said, never
// thrown. Resolves whether it handed back.
export async function handBack(project, work, {
  why = 'closed', now = () => new Date(), config = null, wakerFor = null, print = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const key = `${project}\0${work}`;
  if (handing.has(key) || !helmHeld(project, work)) return false;
  handing.add(key);
  // Across processes too: the one that takes the claim hands back, and the other writes no wake and no record.
  const release = claimHandBack(project, work, { now });
  try {
    if (release === null || !helmHeld(project, work)) return false;
    let wake = null;
    try {
      const event = { type: 'build', work, id: `helm-back:${work}:${now().getTime()}`, detail: { next: PROMPTS.helmBack } };
      wake = writeWake(project, { to: 'feature', work, events: [event], digest: [], dropped: 0 }, { now });
    } catch (error) {
      print(`The wake for ${work} couldn't be written: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    await releaseHold(project, work, { why, now });
    if (wake !== null) {
      const make = wakerFor ?? (config === null ? null : (cfg) => makeWaker({ shape: 1, project, config: cfg, print }));
      if (make !== null) {
        try {
          await make(config).wakeFeature(work, wake);
        } catch (error) {
          fs.rmSync(wake, { force: true });
          print(`${work} wasn't woken: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
    }
    return true;
  } finally {
    release?.();
    handing.delete(key);
  }
}

// "Now": ends the held piece's current run at once, so the director need not wait for its quiet point. The step in
// flight is cut off; the session keeps everything before it. It acts only on a piece that is held. At the director's own
// terminal it checks that no agent is typing; `atFrontDesk` is for the front desk, which acts on the director's own words
// and is itself an agent's session. Resolves `{ code }`; a refusal carries `why`, one line.
export async function stopNow(project, work, {
  env = process.env, stdin = process.stdin, config = {}, wakerFor = null, print = (line) => process.stderr.write(`${line}\n`), atFrontDesk = false,
} = {}) {
  if (!atFrontDesk && !isDirector(env, stdin)) return refuse('The helm is for the director at their own terminal, not an agent.');
  if (typeof work !== 'string' || !SLUG.test(work)) return refuse('Name the piece by its short name.');
  if (!helmHeld(project, work)) return refuse(`${work} is not at the helm.`);
  let got;
  try {
    got = await (wakerFor ?? ((cfg) => makeWaker({ shape: 1, project, config: cfg, print })))(config).stopRun(work);
  } catch (error) {
    return refuse(error instanceof Error ? error.message : `${work}'s run could not be ended.`);
  }
  if (got?.stopped !== true) return refuse(`${work} has no run to end.`);
  print(`${work}'s current step is ended.`);
  return { code: 0 };
}

// --- At the front desk ---
// The director's words at the front desk ("take the helm of login-retry", "I'll steer it", "hand back login-retry", "now"):
// the front desk runs these through `cli.js helm`, which acts on those words, so none of them asks for a terminal.

// The command the director runs to open the piece, as the front desk prints it: `<plugin root>` is left for the front desk to
// write as the plugin's folder, as the page's follow command leaves it. On Windows the script is quoted for `cmd.exe`.
export function openCommand(work, { platform = process.platform } = {}) {
  const script = '<plugin root>/scripts/crew/helm.js';
  return `node ${platform === 'win32' ? `"${script}"` : script} open ${work}`;
}

// A throwaway start call, to learn whether the agent's sessions name themselves (`idFromRun`): the one test the waker's start
// makes. Resolves the refusal to give, or null; a call that can't be made is left to the start, which refuses it itself.
export function steerRefusal(project, work, config, { sessions = null, env = process.env, platform = process.platform, claude = null } = {}) {
  try {
    const adapter = sessions ?? sessionsOfProject(config);
    const call = adapter.featureStartCall({
      config, project, work, sessionId: crypto.randomUUID(), prompt: '', allowed: [], env, claude, platform,
    });
    return call?.idFromRun === true ? STEER_NAMES_ITSELF : null;
  } catch {
    return null;
  }
}

// Takes the helm of `work` on the director's word: the hold and its `helm` record, then what to run. With `fromStart` (the
// director chose at intake to steer the piece from its first step) the piece need not have begun; otherwise it must be an
// open piece with a session. Resolves `{ code: 0, lines }`, or `{ code: 1, why }`.
export async function takeAtDesk(project, work, {
  fromStart = false, config = {}, sessions = null, now = () => new Date(), env = process.env, platform = process.platform,
  alive = pidAlive, startTimeOf = processStartTime,
} = {}) {
  if (typeof work !== 'string' || !SLUG.test(work)) return refuse('Name the piece by its short name.');
  if (work === 'foreman' || work === 'bosun') return refuse('The helm is for a feature piece: the Bosun and the helpers a session starts can\'t be taken.');
  let sessionId = null;
  if (fromStart) {
    const why = steerRefusal(project, work, config, { sessions, env, platform });
    if (why !== null) return refuse(why);
  } else {
    const views = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
    const feature = views.features?.[work]?.data;
    if (!isPlain(feature) || feature.step === 'closed') return refuse(`${work} is not an open piece.`);
    const kept = readJson(sessionFile(project, work));
    if (!isPlain(kept) || typeof kept.sessionId !== 'string' || kept.sessionId === '') return refuse(`${work} has no session to open yet.`);
    sessionId = kept.sessionId;
  }
  try {
    await takeHold(project, { work, sessionId, fromStart, now });
  } catch (error) {
    if (error?.code === 'HELD') return refuse(`${work} is already at the helm.`);
    return refuse(error instanceof Error ? error.message : `The helm of ${work} could not be taken.`);
  }
  const block = ['```bash', openCommand(work, { platform }), '```'];
  if (fromStart) return { code: 0, lines: [`${work} will be ready to steer once the crew has made its folder. Run this to open it:`, ...block] };
  // The record gives when the run began but no length for its step, so the wait is said as the step's end.
  const live = await runIsLive(project, work, { now, alive, startTimeOf });
  return {
    code: 0,
    lines: live
      ? [`${work} will be ready when its current step ends. Run this once it is, or say "now" to stop the step:`, ...block]
      : [`${work} is ready for you now. Run this to open it:`, ...block],
  };
}

export const HELM_STILL_OPEN = (work) => `${work}'s helm session is still open. Leave it with /exit first.`;

// Hands `work` back on the director's word. It refuses while the opened session's process is still the one the hold names. A
// helm never opened goes with no wake: nothing was done in it. Resolves `{ code: 0, lines }`, or `{ code: 1, why }`.
export async function backAtDesk(project, work, {
  now = () => new Date(), config = null, wakerFor = null, alive = pidAlive, startTimeOf = processStartTime, print = () => {},
} = {}) {
  if (typeof work !== 'string' || !SLUG.test(work)) return refuse('Name the piece by its short name.');
  if (!helmHeld(project, work)) return refuse(`${work} is not at the helm.`);
  const hold = readHold(project, work);
  if (hold?.opened === true && Number.isInteger(hold.pid) && alive(hold.pid)) {
    const started = typeof hold.startTime === 'string' ? await startTimeOf(hold.pid) : null;
    if (typeof hold.startTime !== 'string' || started === hold.startTime) return refuse(HELM_STILL_OPEN(work));
  }
  if (hold?.opened === true) {
    if (!await handBack(project, work, { why: 'closed', now, config, wakerFor, print })) return refuse(`${work} is already being handed back.`);
  } else {
    await releaseHold(project, work, { why: 'closed', now });
  }
  return { code: 0, lines: [`${work} is back with the crew.`] };
}

// A helm opened on Windows gets no build grants (the allowed rules are made for the platform they are read on); Windows is out of
// scope for now.
async function main(argv) {
  const [command, work] = argv;
  const say = (line) => process.stderr.write(`${line}\n`);
  if ((command !== 'open' && command !== 'now') || work === undefined) {
    say('Usage: helm.js open <work> | helm.js now <work>');
    return 1;
  }
  const { projectOf } = await import('../hooks/kit.js');
  const found = projectOf(process.cwd());
  if (found === null) {
    say("This folder isn't a Wheelhouse project.");
    return 1;
  }
  const { projectConfig } = await import('../watcher/main.js');
  const { helperClient } = await import('../host/helper-client.js');
  const { featureAllowRules, featureFileRules } = await import('../protection/settings.js');
  const read = await projectConfig(found.project, helperClient());
  if (read.config === null) {
    say(`The project's configuration can't be read: ${read.why}`);
    return 1;
  }
  if (command === 'now') {
    const stopped = await stopNow(found.project, work, { config: read.config });
    if (stopped.why) say(stopped.why);
    return stopped.code;
  }
  const allowed = [...featureAllowRules(read.config, { platform: process.platform }), ...featureFileRules()];
  const result = await openHelm(found.project, work, { config: read.config, allowed });
  if (result.why) say(result.why);
  return result.code;
}

const { startedAsScript } = await import('../lib/started-as-script.js');
if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
