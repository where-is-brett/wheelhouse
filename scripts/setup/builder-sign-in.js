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

export const CHECK_PROMPT = 'Reply with the word ready.';
export const CHECK_WAIT_MS = 90 * 1000;
// The helper looks again this often while a fact stands.
export const RECHECK_EVERY_MS = 60 * 60 * 1000;

// The line a failed check shows: what happened, by kind, and never what the program printed.
export function checkLine(kind, program) {
  return `A builder started as \`${commandName(program)}\` couldn't sign in: it said ${SAID[kind] ?? SAID.other}.`;
}

const fail = (kind, program) => ({ ok: false, kind, line: checkLine(kind, program) });

// builderSignInCheck({ home, agent, route, launch, run?, timeoutMs }) -> { ok: true } | { ok: false, kind, line }.
// `launch` is the words of the launch command saved for this computer, or null. `home` is Wheelhouse's home, which this
// check doesn't write to; clearing is recheckRoute's. `run`, `env` and `platform` are for tests.
export async function builderSignInCheck({
  home, agent = 'claude-code', route = 'background', launch = null, run = realRun, timeoutMs = CHECK_WAIT_MS,
  env = process.env, platform = process.platform, adapter = claudeSessions, resolve = resolveClaude,
} = {}) {
  void home;
  void agent;
  // The Desktop route is checked by the foreman's check-in (part 6), which isn't built yet.
  if (route === 'desktop') return { ok: false, kind: 'other', line: 'not built yet' };
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

// Runs the check for `<agent>:<route>` and, only when it passes, takes the fact away. The waker reads the gate every tick, so
// the wakes it held in the outbox go out on its next one. A failing check keeps the fact (and its first time) as it is.
// -> { ok: true, cleared } | { ok: false, kind, line }.
export async function recheckRoute({ home, agent = 'claude-code', route = 'background', check = builderSignInCheck, ...rest } = {}) {
  const got = await check({ home, agent, route, ...rest });
  if (!got.ok) return got;
  return { ok: true, cleared: clearSignInFact(home, `${agent}:${route}`) };
}

// The helper's hourly look: makes a function that, called as often as the helper likes, re-checks the routes that have a fact
// at most once an hour, and not at all under STOP (nothing counts, re-checks or retries then). `launchFor(agent)` gives the
// launch words saved for this computer. Only the background route has a check to run; a fact on any other is left alone.
export function makeHourlyRecheck({
  home, launchFor = () => null, now = () => new Date(), every = RECHECK_EVERY_MS, stopped = () => stopState().on, check = builderSignInCheck, agents = ['claude-code'], ...rest
} = {}) {
  let last = null;
  return async function tick() {
    if (stopped()) return { ran: false, why: 'stop' };
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
    const done = [];
    for (const key of keys) {
      const [agent, route] = key.split(':');
      let launch = null;
      try {
        launch = launchFor(agent);
      } catch {
        // Plain `claude` would prove nothing about the command the director meant: the fact stands.
        done.push({ key, ok: false, kind: 'other', line: "The launch command saved for this computer can't be used" });
        continue;
      }
      done.push({ key, ...(await recheckRoute({ home: home(), agent, route, launch, check, ...rest })) });
    }
    return { ran: true, done };
  };
}
