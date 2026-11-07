// scripts/decisions/why.js
// "Why" by a session copy (design section 6.3 of the director's way of working). The director asks why about a waiting
// decision, and a read-only fork of the session that raised it answers. The building session is never resumed: the call
// forks it (adapters/claude-code/sessions.js whyCall), and a follow-up forks the last copy, never the builder.
//   askWhy({ project, n, words, run, now }) -> { answer, fork } | { fallback }
// A why run never writes a decision answer, and one that runs past three minutes stops and says so. Silence is never a
// decision: nothing here records, signs or answers anything.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { whyCall } from '../../adapters/claude-code/sessions.js';
import { QUESTION_ID } from '../state/card-lines.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { wheelhouseHome, stateDir } from '../lib/paths.js';
import { readCapped } from '../feature/status.js';
import { sessionFile } from '../watcher/waker.js';
import { readDecisions } from './pending.js';
import { callsFrom } from './calls.js';

// The longest a why run may take.
export const WHY_LIMIT_MS = 3 * 60 * 1000;
// The most characters of an answer that goes to the director's phone screen. Step 3's phone limit replaces this one.
export const PHONE_CHARS = 1400;

const SMALL = 64 * 1024;
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE = /^[A-Za-z0-9._-]+$/;

function readJson(file) {
  try {
    return JSON.parse(readCapped(file, SMALL) ?? 'null');
  } catch {
    return null;
  }
}

// Where the copy's own session id is kept for follow-ups.
export const forkFile = (project, n) => path.join(wheelhouseHome(), 'why', `${project}-${n}.json`);

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

// Runs the call as a child, giving up (and killing it) when `signal` aborts. Resolves { code, stdout, stderr }.
export function runCall(call, { signal } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(call.file, call.args, { cwd: call.cwd, env: call.env, stdio: ['pipe', 'pipe', 'pipe'], signal, windowsVerbatimArguments: call.verbatim === true });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error?.message ?? error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', (error) => resolve({ code: null, stdout, stderr: stderr || String(error?.message ?? error) }));
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(call.input ?? '');
  });
}

// Asks the copy of the session that raised decision `n` (the number `decision list` gives). `run(call, { signal })` starts it
// (tests give their own; the default starts the real command), `limitMs` is the longest it may take, and `read` gives the
// project's events (the default reads the project's own record).
export async function askWhy({ project, n, words = '', run = runCall, now = () => new Date(), limitMs = WHY_LIMIT_MS, read = null }) {
  const events = read === null ? listEvents(stateDir(project), { report: () => {} }) : read();
  const { pending } = readDecisions(project, { events, enrolled: readEnrolled() });
  const decision = pending.find((d) => d.n === n);
  if (decision === undefined) return { fallback: `Decision ${n} isn't waiting, so there is no session left to ask.` };
  const card = events.find((e) => e.id === decision.id)?.data;
  const work = workOf(card, events);
  const sorry = (why) => ({ fallback: fallbackText(decision, work, events, why) });
  if (work === null || !SAFE.test(work)) return sorry("The piece that raised this can't be found, so there is no session to ask.");

  // The session the watcher kept for the piece. A piece that has finished has none to ask.
  const kept = readJson(sessionFile(project, work));
  if (!isPlain(kept) || typeof kept.sessionId !== 'string' || !SESSION_ID.test(kept.sessionId) || typeof kept.worktree !== 'string' || !fs.existsSync(kept.worktree)) {
    return sorry('That piece has finished, so its session is no longer there to ask.');
  }

  // A follow-up forks the last copy, never the building session. A record of another decision with this number is not one.
  const before = readJson(forkFile(project, n));
  const follow = isPlain(before) && before.card === decision.id && typeof before.fork === 'string' && SESSION_ID.test(before.fork) && before.fork !== kept.sessionId;
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
  if (got === 'over' || got?.timedOut === true) return sorry(`The copy of the session took longer than ${Math.round(limitMs / 60000)} minutes, so it was stopped.`);
  const parsed = got?.code === 0 ? parseRun(got.stdout) : null;
  if (parsed === null || parsed.answer.trim() === '') return sorry("The copy of the session didn't give an answer.");

  // The copy's own id is kept for the next question. It never stands in for the building session's.
  if (parsed.fork !== null && SESSION_ID.test(parsed.fork) && parsed.fork !== kept.sessionId) {
    try {
      fs.mkdirSync(path.dirname(forkFile(project, n)), { recursive: true });
      fs.writeFileSync(forkFile(project, n), `${JSON.stringify({ fork: parsed.fork, card: decision.id, at: now().toISOString() })}\n`);
    } catch {
      // Not kept: the next question starts a fresh copy of the building session.
    }
  }
  return { answer: trimTo(parsed.answer), fork: parsed.fork ?? '' };
}
