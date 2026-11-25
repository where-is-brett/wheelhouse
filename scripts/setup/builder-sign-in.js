// scripts/setup/builder-sign-in.js
// The builder sign-in check (builders and settings design, section 10.1). It starts one tiny session the way the waker starts a
// builder (the same launch command, `sessionEnv`, no tools, one turn, a scratch folder that isn't a repository) and passes only
// on exit 0 with "ready" in the answer. A failure is named by its kind, never by the raw output. Setup's health check runs it,
// the director's "Check again" runs it, and the helper runs it once an hour while a sign-in fact stands (section 10.2); a
// passing check is the only thing that clears the fact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { FOREGROUND_ONLY, invocation, resolveClaude } from '../lib/claude.js';
import claudeSessions, { sessionEnv } from '../../adapters/claude-code/sessions.js';
import { classify, commandName, readSignIn } from '../lib/sign-in-line.js';
import { SAID, clearSignInFact } from '../lib/sign-in-gate.js';
import { stopState } from '../lib/stop.js';
import { FOREMAN_SETUP_MS, checkInAge } from '../foreman/check-in.js';

export const CHECK_PROMPT = 'Reply with the word ready.';
export const CHECK_WAIT_MS = 90 * 1000;
// The helper looks again this often while a fact stands.
export const RECHECK_EVERY_MS = 60 * 60 * 1000;
// The most of the check's own output kept while it runs (it's only searched for "ready" and the kind of failure).
const OUTPUT_LIMIT = 64 * 1024;

// The line for a launch command that can't be read. The reader's own message can name the settings file (a path with the
// person's user name in it), so the line says only which of the two faults it is.
export const LAUNCH_UNREADABLE = "Your settings can't be read, so the launch command is unknown. Mend the settings file";
export const LAUNCH_UNUSABLE = "The launch command saved for this computer can't be used. Mend it in the settings";
export function launchFaultLine(error) {
  const said = error instanceof Error ? error.message : '';
  return said.startsWith("Your settings can't be read") ? LAUNCH_UNREADABLE : LAUNCH_UNUSABLE;
}

// The line a failed check shows: what happened, by kind, and never what the program printed.
export function checkLine(kind, program) {
  return `A builder started as \`${commandName(program)}\` couldn't sign in: it said ${SAID[kind] ?? SAID.other}.`;
}

// What a failed Desktop check says: the foreman is what proves this route.
export const DESKTOP_LINE = "The foreman hasn't checked in";
export const DESKTOP_TODO = 'Start the foreman from the card in Claude Desktop, then check again';

const fail = (kind, program) => ({ ok: false, kind, line: checkLine(kind, program) });

// builderSignInCheck({ home, agent, route, launch, run?, timeoutMs }) -> { ok: true } | { ok: false, kind, line }.
// `launch` is the words of the launch command saved for this computer, or null. `home` is Wheelhouse's home, which this
// check doesn't write to; clearing is recheckRoute's. `run`, `env` and `platform` are for tests.
export async function builderSignInCheck({
  home, agent = 'claude-code', route = 'background', launch = null, run = realRun, timeoutMs = CHECK_WAIT_MS, project, now = () => new Date(), checkInAge: foremanAge = checkInAge,
  env = process.env, platform = process.platform, adapter = claudeSessions, resolve = resolveClaude,
} = {}) {
  void home;
  void agent;
  // The Desktop route is proved by the foreman's check-in: its Desktop session is signed in as Desktop is, and a check-in under
  // 2 minutes old shows it is running (no probe builder is started on this route).
  if (route === 'desktop') {
    const age = typeof project === 'string' ? foremanAge(project, { now }) : null;
    return age !== null && age < FOREMAN_SETUP_MS ? { ok: true } : { ok: false, kind: 'other', line: DESKTOP_LINE, todo: DESKTOP_TODO };
  }
  let program = launch?.[0] ?? 'claude';
  let call;
  try {
    const resolved = resolve({ platform, env, launch });
    program = resolved.file ?? program;
    call = invocation(resolved, [], ['--allowedTools', '', '--max-turns', '1'], CHECK_PROMPT);
  } catch {
    return fail('no-program', program);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-sign-in-'));
  try {
    let got;
    try {
      got = await run(call.file, call.args, {
        cwd: scratch, env: { ...sessionEnv(env), ...FOREGROUND_ONLY }, baseEnv: {}, input: call.input, timeoutMs, platform, windowsVerbatimArguments: call.verbatim,
        // A launch wrapper's own children go with it when the wait runs out (Windows ends the whole tree anyway).
        ownGroup: true, limit: OUTPUT_LIMIT,
      });
    } catch (error) {
      return fail(classify('', { error }, adapter.signInPatterns), program);
    }
    const said = `${got.stdout ?? ''}\n${got.stderr ?? ''}`;
    if (got.timedOut === true) return fail('other', program);
    if (got.code === 0 && /\bready\b/i.test(String(got.stdout ?? ''))) return { ok: true };
    return fail(classify(said, { code: got.code }, adapter.signInPatterns), program);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Checks already running, by home, agent and route. A second caller (the hourly look, "Check again", setup's health) joins the
// one running rather than starting another session beside it.
const running = new Map();

// Runs the check for `<agent>:<route>` and, only when it passes, takes the fact away. The waker reads the gate every tick, so
// the wakes it held in the outbox go out on its next one. A failing check keeps the fact (and its first time) as it is.
// -> { ok: true, cleared } | { ok: false, kind, line }.
export function recheckRoute({ home, agent = 'claude-code', route = 'background', check = builderSignInCheck, ...rest } = {}) {
  const key = `${home}\0${agent}:${route}`;
  const already = running.get(key);
  if (already) return already;
  const job = (async () => {
    const got = await check({ home, agent, route, ...rest });
    if (!got.ok) return got;
    return { ok: true, cleared: clearSignInFact(home, `${agent}:${route}`) };
  })().finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

// The helper's hourly look: makes a function that, called as often as the helper likes, re-checks the routes that have a fact
// at most once an hour, and not at all under STOP (nothing counts, re-checks or retries then). `launchFor(agent)` gives the
// launch words saved for this computer. Only the background route has a check to run; a fact on any other is left alone.
export function makeHourlyRecheck({
  home, launchFor = () => null, now = () => new Date(), every = RECHECK_EVERY_MS, stopped = () => stopState().on, check = builderSignInCheck, agents = ['claude-code'], ...rest
} = {}) {
  let last = null;
  let busy = false;
  return async function tick() {
    if (stopped()) return { ran: false, why: 'stop' };
    // A look still waiting on a check (one that hangs until its wait runs out) isn't joined by another.
    if (busy) return { ran: false, why: 'running' };
    const read = readSignIn(home());
    if (!read.ok) return { ran: false, why: 'unreadable' };
    const keys = Object.keys(read.facts).filter((key) => key.endsWith(':background') && agents.includes(key.split(':')[0]));
    if (keys.length === 0) {
      last = null;
      return { ran: false, why: 'no fact' };
    }
    const at = now().getTime();
    if (last !== null && at - last < every) return { ran: false, why: 'not due' };
    last = at;
    busy = true;
    try {
      const done = [];
      for (const key of keys) {
        // STOP may come while an earlier check runs: nothing more starts then.
        if (stopped()) return { ran: true, done, why: 'stop' };
        const [agent, route] = key.split(':');
        let launch = null;
        try {
          launch = launchFor(agent);
        } catch (error) {
          // Plain `claude` would prove nothing about the command the director meant: the fact stands.
          done.push({ key, ok: false, kind: 'other', line: launchFaultLine(error) });
          continue;
        }
        done.push({ key, ...(await recheckRoute({ home: home(), agent, route, launch, check, ...rest })) });
      }
      return { ran: true, done };
    } finally {
      busy = false;
    }
  };
}
