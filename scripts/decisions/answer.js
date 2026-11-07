// scripts/decisions/answer.js
// Records the director's typed reply to a decision (design sections 6.1 and 6.5). Called by the prompt hook
// (scripts/hooks/prompt-record.js) on UserPromptSubmit, and nowhere else.
//
// Only the director's own typed words decide, so a reply is recorded only when all of these hold:
//   - the prompt text came through UserPromptSubmit, which carries what was typed and nothing an agent wrote;
//   - the session's role is front-desk (a feature, foreman or other session's prompts are never replies);
//   - the session was not started by a script: a headless `claude -p` session's prompt is a script's words.
// A reply that could mean more than one decision, that names no waiting decision, or that answers one already answered
// is never recorded. It leaves a note for the First Mate (board-context.js shows it once), which says what waits or when
// and how the decision was answered. Silence, a timeout or a missing reply is never an answer: nothing here reads a clock
// to decide anything.
//
// A reply is signed into the record as a decision-answer. For a decision made from a question of the build, a letter also
// earns the signed answer a click on that option would (the build waits for it); the director's own words do not, as they
// are not one of the options.
import fs from 'node:fs';
import path from 'node:path';
import { sessionRole, roleFile } from '../lib/role.js';
import { ownWords } from '../lib/own-words.js';
import { helperClient } from '../host/helper-client.js';
import { helperGrace } from '../lib/helper-grace.js';
import { withinBudget, BUDGET_MS } from '../hooks/pending.js';
import { earned, keepEarned, sendKept } from '../hooks/prompt-record.js';
import { whenSaid } from '../cards/answered.js';
import { readDecisions } from './pending.js';
import { parseReply } from './reply.js';
import { LETTERS } from './message.js';

// The values of CLAUDE_CODE_ENTRYPOINT that are not a person typing: Claude Code's print mode and its SDKs. The app,
// the editor and the terminal each set another value.
const SCRIPT_ENTRYPOINT = /^sdk-/;
// The variables only Wheelhouse's own starters set on a session they run.
const STARTER_VARIABLES = ['WHEELHOUSE_ROLE', 'WHEELHOUSE_SESSION', 'WHEELHOUSE_AGENT', 'WHEELHOUSE_ENGINE_RUN'];

// Whether the session was started by a script, from the environment its hooks inherit.
export function startedByScript(env = process.env) {
  const entry = env?.CLAUDE_CODE_ENTRYPOINT;
  if (typeof entry === 'string' && SCRIPT_ENTRYPOINT.test(entry)) return true;
  return STARTER_VARIABLES.some((name) => typeof env?.[name] === 'string' && env[name] !== '');
}

// --- The note for the First Mate ---

const noteFile = (sessionId) => {
  const role = roleFile(sessionId);
  return role === null ? null : path.join(path.dirname(role), 'decision-note.json');
};

// Keeps a note for the session's next prompt. Never throws.
export function keepNote(sessionId, text) {
  const file = noteFile(sessionId);
  if (file === null || typeof text !== 'string' || text === '') return false;
  try {
    let notes = [];
    try {
      const held = JSON.parse(fs.readFileSync(file, 'utf8'))?.notes;
      if (Array.isArray(held)) notes = held.filter((n) => typeof n === 'string');
    } catch {
      // None kept yet.
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ notes: [...notes, text] })}\n`);
    return true;
  } catch {
    return false;
  }
}

// The notes kept for the session, once: they are removed as they are read. Null when there are none.
export function takeNote(sessionId) {
  const file = noteFile(sessionId);
  if (file === null) return null;
  try {
    const notes = JSON.parse(fs.readFileSync(file, 'utf8'))?.notes;
    fs.rmSync(file, { force: true });
    const kept = Array.isArray(notes) ? notes.filter((n) => typeof n === 'string' && n !== '') : [];
    return kept.length === 0 ? null : kept.join(' ');
  } catch {
    return null;
  }
}

// --- What each outcome says ---

const listOf = (decisions) => decisions.map((d) => `${d.n}. ${d.question}`).join('; ');
const lettersOf = (decision) => `A to ${LETTERS[Math.max(0, Math.min(LETTERS.length, decision.options.length) - 1)]}`;

// How an answer reads: "B", or "in their own words (…)", with "and …" when a letter came with words.
function howAnswered({ label, words }) {
  if (label === 'own') return `in their own words ("${words}")`;
  return words === '' ? `with ${label}` : `with ${label}, adding "${words}"`;
}

function alreadyNote(n, answer, now) {
  return `Decision ${n} was already answered ${howAnswered(answer)} ${whenSaid(answer.at, now)}. Nothing was recorded from this reply. Say when and how it was answered, in one plain line. Wanting a different answer is a change to what was decided, so it goes through the intake.`;
}

// --- Recording ---

// recordAnswer({ project, sessionId, prompt, at, cwd, env, client, budget }) -> { recorded, note?, why? }
// `why` is { n, words } when the reply asks why of a decision, which records nothing.
export async function recordAnswer({
  project, sessionId, prompt, at = new Date(), cwd, env = process.env, client, budget = BUDGET_MS + helperGrace(), decisions,
}) {
  const now = at instanceof Date ? at : new Date(at);
  if (typeof prompt !== 'string' || typeof project !== 'string') return { recorded: false };
  if (startedByScript(env)) return { recorded: false };
  if (sessionRole({ sessionId, env, prompt, cwd }) !== 'front-desk') return { recorded: false };
  const typed = ownWords(prompt);
  if (typed === null) return { recorded: false };

  const held = decisions ?? readDecisions(project);
  const { pending, answered } = held;
  let reply = parseReply(typed, pending);
  // A numbered reply to a decision answered already, with nothing else waiting for it, is told so.
  if (reply.kind === 'none' && /^\s*(?:reply\s+)?#?[1-9]/i.test(typed)) {
    const late = parseReply(typed, answered);
    if (late.kind === 'answer' || late.kind === 'why') reply = { kind: 'refused', n: late.n, reason: 'not-waiting' };
  }

  const finish = (result, note) => {
    if (note !== undefined) keepNote(sessionId, note);
    return { ...result, ...(note === undefined ? {} : { note }) };
  };

  if (reply.kind === 'none') return { recorded: false };
  if (reply.kind === 'ambiguous') {
    const named = reply.candidates.join(' or ');
    return finish({ recorded: false }, `The director's reply could answer decision ${named}. Nothing was recorded. Decisions waiting: ${listOf(pending)}. Say which wait, in one plain line, and ask which one they meant.`);
  }
  if (reply.kind === 'refused') {
    if (reply.reason === 'beyond-options') {
      const decision = pending.find((d) => d.n === reply.n);
      return finish({ recorded: false }, `The director's reply named an option decision ${reply.n} doesn't offer (it offers ${lettersOf(decision)}). Nothing was recorded. Say so in one plain line and ask again.`);
    }
    const first = answered.find((a) => a.n === reply.n);
    if (first !== undefined) return finish({ recorded: false }, alreadyNote(reply.n, first, now));
    return finish({ recorded: false }, `No decision ${reply.n} is waiting, so nothing was recorded.${pending.length === 0 ? '' : ` Decisions waiting: ${listOf(pending)}.`} Say so in one plain line.`);
  }
  if (reply.kind === 'why') {
    return finish({ recorded: false, why: { n: reply.n, words: reply.words } }, `The director asked why about decision ${reply.n}${reply.words === '' ? '' : `: "${reply.words}"`}. This records nothing. Answer in plain words from what the decision says (\`decision show ${reply.n}\` prints it), then wait for their reply.`);
  }

  const decision = pending.find((d) => d.n === reply.n);
  const data = { question: decision.text, n: decision.n, label: reply.label, words: reply.words, where: 'chat' };
  const api = client ?? helperClient({ timeout: budget });
  const left = withinBudget(Date.now() + budget);
  const clock = () => now;
  const queued = [keepEarned(project, { made: { kind: 'decision-answer', data } }, { now: clock })];
  if (reply.label !== 'own' && /^Answer question q-/.test(decision.line ?? '')) {
    const option = decision.options[LETTERS.indexOf(reply.label)];
    try {
      const got = option === undefined ? null : await earned({ project, question: decision.text, label: option.label, client: api, now: clock, left });
      if (got) queued.push(keepEarned(project, got, { now: clock }));
    } catch {
      // The decision-answer stands; the build's own signed answer is then missing, and the First Mate says so.
    }
  }
  for (const kept of queued) await sendKept(api, left, kept);
  const note = `The director answered decision ${decision.n} ${howAnswered({ label: reply.label, words: reply.words })}, and it is recorded. State it as a fact, in one plain line, and carry on from it.`;
  keepNote(sessionId, note);
  return { recorded: true, note };
}
