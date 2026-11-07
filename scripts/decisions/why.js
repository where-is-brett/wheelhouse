// scripts/decisions/why.js
// "Why" by a session copy (design section 6.3 of the director's way of working). The director asks why about a waiting
// decision, and a read-only fork of the session that raised it answers. The building session is never resumed: the call
// forks it (adapters/claude-code/sessions.js whyCall), and a follow-up forks the last copy, never the builder.
//   askWhy({ project, id, words, run, now }) -> { answer, fork } | { fallback }
// The decision is found by its id, never by its number, which is reused. A why run never writes a decision answer, and one
// that runs past its limit stops, with everything it started, and says so. Silence is never a decision: nothing here
// records, signs or answers anything.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { whyCall } from '../../adapters/claude-code/sessions.js';
import { QUESTION_ID } from '../state/card-lines.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { wheelhouseHome, stateDir } from '../lib/paths.js';
import { readCapped } from '../feature/status.js';
import { sessionFile } from '../watcher/waker.js';
import { readDecisions } from './pending.js';
import { callsFrom } from './calls.js';

// The longest a why run may take. The front desk runs it through a shell command whose own limit is two minutes, so this
// stays under that, and the front desk's skill asks for a longer limit than this one.
export const WHY_LIMIT_MS = 100 * 1000;
// How long a run that was told to stop gets before everything it started is killed outright.
export const KILL_GRACE_MS = 2000;
// The most characters of an answer that goes to the director's phone screen. Step 3's phone limit replaces this one.
export const PHONE_CHARS = 1400;

const SMALL = 64 * 1024;
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE = /^[A-Za-z0-9._-]+$/;
const FINISHED = ['merged', 'closed'];

function readJson(file) {
  try {
    return JSON.parse(readCapped(file, SMALL) ?? 'null');
  } catch {
    return null;
  }
}

// Where the copy's own session id is kept for follow-ups: one file for each decision, by its id.
export const forkFile = (project, id) => path.join(wheelhouseHome(), 'why', `${project}-${createHash('sha256').update(String(id)).digest('hex').slice(0, 24)}.json`);

// `text` cut to at most `max` characters, at the end of a line or a word when it can be, with an ellipsis.
export function trimTo(text, max = PHONE_CHARS) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

// The work a decision's question is about, from the record: the card's set line names the question, the question names the work.
function workOf(card, events) {
  const id = new RegExp(`^Answer question (${QUESTION_ID})$`).exec(String(card?.line ?? ''))?.[1];
  if (id === undefined) return null;
  const asked = events.filter((e) => e.kind === 'question' && e.data?.id === id).at(-1);
  return typeof asked?.data?.work === 'string' ? asked.data.work : null;
}

// Whether the work's latest report says its pull request merged or closed.
function finishedWork(work, events) {
  const latest = events.filter((e) => e.kind === 'report' && e.data?.work === work).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1);
  return FINISHED.includes(latest?.data?.outcome);
}

// What the director is told when the copy can't be asked: the card's own reason and the calls the piece logged.
function fallbackText(decision, work, events, why) {
  const calls = work === null ? [] : callsFrom(events).filter((c) => c.work === work).slice(-5);
  return trimTo([
    `${why} Here is what the card itself says.`,
    ...(decision.why ? [`Why it comes to you: ${decision.why}`] : []),
    ...(decision.because ? [`Why it recommends ${decision.recommend ?? 'its pick'}: ${decision.because}`] : []),
    ...(calls.length === 0 ? [] : ['Calls the piece made on its own:', ...calls.map((c) => `- ${c.decided}, because ${c.why}`)]),
  ].join('\n'));
}

// The words the copy is asked. It explains and changes nothing.
function promptOf(decision, words) {
  const asked = typeof words === 'string' && words.trim() !== '' ? words.trim() : 'Why did you raise this, and why do you recommend what you do?';
  return [
    `The director is looking at the decision you raised: "${decision.question}".`,
    `They ask: ${asked}`,
    'Answer in plain words for a product owner, in a few short sentences. Only explain what you tried, read and weighed. Change nothing, and do not run commands.',
  ].join('\n');
}

// The answer and the copy's own session id from `claude -p --output-format json`: one result object, or a list of events.
export function parseRun(stdout) {
  let found = null;
  try {
    const parsed = JSON.parse(String(stdout ?? '').trim());
    const list = Array.isArray(parsed) ? parsed : [parsed];
    found = list.filter((e) => isPlain(e) && e.type === 'result' && typeof e.result === 'string').at(-1) ?? null;
  } catch {
    found = null;
  }
  if (found === null) return null;
  return { answer: found.result, fork: typeof found.session_id === 'string' ? found.session_id : null };
}

// Ends the child and everything it started: the process group on POSIX (the child leads its own), `taskkill /T` on Windows.
function killTree(child, signal) {
  const pid = child.pid;
  if (typeof pid !== 'number') return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

// Runs the call as a child of its own process group. When `signal` aborts, the whole tree is told to stop and, after
// `graceMs`, killed outright; the pipes are destroyed and the child let go, so nothing it leaves running holds this process.
// Resolves { code, stdout, stderr }, or { timedOut: true } once aborted.
export function runCall(call, { signal, graceMs = KILL_GRACE_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(call.file, call.args, { cwd: call.cwd, env: call.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsVerbatimArguments: call.verbatim === true, windowsHide: true });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error?.message ?? error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    function onAbort() {
      killTree(child, 'SIGTERM');
      const hard = setTimeout(() => killTree(child, 'SIGKILL'), graceMs);
      hard.unref();
      for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe?.destroy();
      child.unref();
      finish({ timedOut: true });
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', (error) => finish({ code: null, stdout, stderr: stderr || String(error?.message ?? error) }));
    child.once('close', (code) => finish({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(call.input ?? '');
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Asks the copy of the session that raised decision `id` (a waiting decision's id, as `decision list` knows it). `run(call,
// { signal })` starts it (tests give their own; the default starts the real command), `limitMs` is the longest it may take, and
// `read` gives the project's events (the default reads the project's own record).
export async function askWhy({ project, id, words = '', run = runCall, now = () => new Date(), limitMs = WHY_LIMIT_MS, read = null }) {
  const events = read === null ? listEvents(stateDir(project), { report: () => {} }) : read();
  const { pending } = readDecisions(project, { events, enrolled: readEnrolled() });
  const decision = pending.find((d) => d.id === id);
  if (decision === undefined) {
    // A decision no longer waiting has no copy to keep.
    try { fs.rmSync(forkFile(project, id), { force: true }); } catch { /* not there */ }
    return { fallback: "That decision isn't waiting any more, so there is no session left to ask." };
  }
  const card = events.find((e) => e.id === decision.id)?.data;
  const work = workOf(card, events);
  const sorry = (why) => ({ fallback: fallbackText(decision, work, events, why) });
  if (work === null || !SAFE.test(work)) return sorry("The piece that raised this can't be found, so there is no session to ask.");

  // The session the watcher kept for the piece.
  const kept = readJson(sessionFile(project, work));
  if (!isPlain(kept) || typeof kept.sessionId !== 'string' || !SESSION_ID.test(kept.sessionId) || typeof kept.worktree !== 'string' || !fs.existsSync(kept.worktree)) {
    return sorry(finishedWork(work, events) ? 'That piece has finished, so its session is no longer there to ask.' : 'No session is kept for that piece, so there is none to ask.');
  }

  // A follow-up forks the last copy, never the building session. The copy counts only while it is of this decision and of the
  // session kept now; a session that has been replaced starts a fresh copy.
  const before = readJson(forkFile(project, decision.id));
  const follow = isPlain(before) && before.card === decision.id && before.session === kept.sessionId
    && typeof before.fork === 'string' && SESSION_ID.test(before.fork) && before.fork !== kept.sessionId;
  const call = whyCall({ sessionId: follow ? before.fork : kept.sessionId, worktree: kept.worktree, question: promptOf(decision, words) });

  const controller = new AbortController();
  let timer;
  const over = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve('over'); }, limitMs); });
  let got;
  try {
    got = await Promise.race([Promise.resolve().then(() => run(call, { signal: controller.signal })), over]);
  } catch (error) {
    got = { code: null, stdout: '', stderr: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
  if (got === 'over' || got?.timedOut === true) return sorry(`The copy of the session took longer than ${Math.round(limitMs / 1000)} seconds, so it was stopped.`);
  const parsed = got?.code === 0 ? parseRun(got.stdout) : null;
  if (parsed === null || parsed.answer.trim() === '') return sorry("The copy of the session didn't give an answer.");

  // The copy's own id is kept for the next question. It never stands in for the building session's.
  if (parsed.fork !== null && SESSION_ID.test(parsed.fork) && parsed.fork !== kept.sessionId) {
    try {
      fs.mkdirSync(path.dirname(forkFile(project, decision.id)), { recursive: true });
      fs.writeFileSync(forkFile(project, decision.id), `${JSON.stringify({ fork: parsed.fork, card: decision.id, session: kept.sessionId, at: now().toISOString() })}\n`);
    } catch {
      // Not kept: the next question starts a fresh copy of the building session.
    }
  }
  return { answer: trimTo(parsed.answer), fork: parsed.fork ?? '' };
}
