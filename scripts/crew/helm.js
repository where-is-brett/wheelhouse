// scripts/crew/helm.js
// The director's helm of a feature piece (crew visibility design, 9.1): opening the piece's own session in this terminal,
// holding it while they work, and handing it back with a wake when the terminal closes. The CLI is
// `node scripts/crew/helm.js open <work>`.
import fs from 'node:fs';
import { spawn as spawnChild } from 'node:child_process';
import sessionsAdapter from '../../adapters/claude-code/sessions.js';
import { helmHeld, readHold, takeHold, markOpened, releaseHold } from './hold.js';
import {
  runningFile, sessionFile, processStartTime, pidAlive, writeWake, PROMPTS, STARTING_MS,
} from '../watcher/waker.js';
import { stateDir } from '../lib/paths.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { buildViews } from '../state/views.js';
import { SLUG } from '../lib/build-loop.js';

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
} = {}) {
  if (!isDirector(env, stdin)) return refuse('The helm is for the director at their own terminal, not an agent.');
  if (typeof work !== 'string' || !SLUG.test(work)) return refuse('Name the piece by its short name.');
  const views = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
  const feature = views.features?.[work]?.data;
  if (!isPlain(feature) || feature.step === 'closed') return refuse(`${work} is not an open piece.`);
  const kept = readJson(sessionFile(project, work));
  if (!isPlain(kept) || typeof kept.sessionId !== 'string' || kept.sessionId === '') return refuse(`${work} has no session to open yet.`);
  const worktree = typeof kept.worktree === 'string' && kept.worktree !== '' ? kept.worktree : feature.worktree;
  if (typeof worktree !== 'string' || worktree === '') return refuse(`${work} has no worktree to open.`);
  let call;
  try {
    call = sessionsAdapter.featureHelmCall({ config, sessionId: kept.sessionId, allowed, env, claude, platform });
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
      return refuse(error instanceof Error ? error.message : `The helm of ${work} could not be taken.`);
    }
  }

  let why = 'closed';
  try {
    let said = false;
    while (await runIsLive(project, work, { now, alive, startTimeOf })) {
      if (!said) {
        print(`Waiting for the crew's current step on ${work} to finish…`);
        said = true;
      }
      await sleep(waitMs);
    }
    const child = spawn(call.file, call.args, {
      cwd: worktree, env: call.env, stdio: 'inherit', windowsVerbatimArguments: call.verbatim === true,
    });
    const ended = new Promise((resolve) => {
      child.once('error', () => { why = 'failed'; resolve(1); });
      child.once('exit', (c) => resolve(c ?? 0));
    });
    const startTime = Number.isInteger(child.pid) ? await startTimeOf(child.pid).catch(() => null) : null;
    markOpened(project, work, { pid: Number.isInteger(child.pid) ? child.pid : null, startTime: typeof startTime === 'string' ? startTime : null });
    await ended;
  } finally {
    await handBack(project, work, { why, now });
  }
  return { code: why === 'failed' ? 1 : 0 };
}

const handing = new Set();

// Hands the piece back: the hold goes and the piece is woken to read what the director did. It does nothing when no hold
// exists, so the session-end hook and the terminal's exit can both call it. Resolves whether it handed back.
export async function handBack(project, work, { why = 'closed', now = () => new Date() } = {}) {
  const key = `${project}\0${work}`;
  if (handing.has(key) || !helmHeld(project, work)) return false;
  handing.add(key);
  try {
    await releaseHold(project, work, { why, now });
    const stamp = now().getTime();
    const event = { type: 'build', work, id: `helm-back:${work}:${stamp}`, detail: { next: PROMPTS.helmBack } };
    writeWake(project, { to: 'feature', work, events: [event], digest: [], dropped: 0 }, { now });
    return true;
  } finally {
    handing.delete(key);
  }
}

async function main(argv) {
  const [command, work] = argv;
  const say = (line) => process.stderr.write(`${line}\n`);
  if (command !== 'open' || work === undefined) {
    say('Usage: helm.js open <work>');
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
  const allowed = [...featureAllowRules(read.config, { platform: process.platform }), ...featureFileRules()];
  const result = await openHelm(found.project, work, { config: read.config, allowed });
  if (result.why) say(result.why);
  return result.code;
}

const { startedAsScript } = await import('../lib/started-as-script.js');
if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
