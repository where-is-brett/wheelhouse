// scripts/decisions/answer.js
// Records the director's typed reply to a decision (design sections 6.1 and 6.5). Called by the prompt hook
// (scripts/hooks/prompt-record.js) on UserPromptSubmit, and nowhere else.
//
// Only the director's own typed words decide, so a reply is recorded only when all of these hold:
//   - the prompt text came through UserPromptSubmit, which carries what was typed and nothing an agent wrote;
//   - the session's role is front-desk (a feature, foreman or other session's prompts are never replies);
//   - the session was not started by a script: a headless `claude -p` session's prompt is a script's words.
// A reply that could mean more than one decision, that names no waiting decision, or that answers one already answered
// is never recorded. It gives a note for the First Mate, which the prompt hook returns as that same turn's context: what
// waits, or when and how the decision was answered. Silence, a timeout or a missing reply is never an answer: nothing here reads a clock
// to decide anything.
//
// A reply is signed into the record as a decision-answer. For a decision made from a question of the build, a letter also
// earns the signed answer a click on that option would (the build waits for it); the director's own words do not, as they
// are not one of the options.
import fs from 'node:fs';
import path from 'node:path';
import { sessionRole } from '../lib/role.js';
import { holdBySession } from '../crew/hold.js';
import { readSeat } from '../lib/first-mate-seat.js';
import { ownWords } from '../lib/own-words.js';
import { helperClient } from '../host/helper-client.js';
import { helperGrace } from '../lib/helper-grace.js';
import { withinBudget, pendingDir, BUDGET_MS } from '../hooks/pending.js';
import { earned, keepEarned, sendKept } from '../hooks/prompt-record.js';
import { whenSaid } from '../cards/answered.js';
import { buildViews } from '../state/views.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { stateDir } from '../lib/paths.js';
import { typedRepliesIn } from './switch.js';
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

// The piece whose helm this session sits at (crew visibility design, 9.4), or null: the hold names this session, the hold is
// opened, and the entrypoint is not a script's. The starter variables are not checked, as the helm session carries its piece's role.
export function helmSeat({ project, sessionId, env = process.env, holdOf = holdBySession }) {
  const entry = env?.CLAUDE_CODE_ENTRYPOINT;
  if (typeof entry === 'string' && SCRIPT_ENTRYPOINT.test(entry)) return null;
  let hold;
  try {
    hold = holdOf(project, sessionId);
  } catch {
    return null;
  }
  return hold?.opened === true && typeof hold.work === 'string' ? hold.work : null;
}

// Whether typed replies are on for the project, from the settings the local record builds (as the session start's fallback
// builds them), so the switch counts the moment it is confirmed. Off when unreadable.
export function typedRepliesOn(project) {
  try {
    return typedRepliesIn(buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled()).settings);
  } catch {
    return false;
  }
}

// --- Answers kept to send ---

// The decision-answers kept on this computer that the helper has not taken yet, as { text, at, label, words }. A reply typed
// while the helper was down, or just now, counts as an answer already: signing a second one would decide the same decision twice.
function keptAnswers(project) {
  const folder = pendingDir(project);
  let names;
  try {
    names = fs.readdirSync(folder).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    try {
      const { route, body } = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
      const event = body?.event;
      if (route === 'record' && event?.kind === 'decision-answer' && typeof event.data?.question === 'string') {
        out.push({ text: event.data.question, at: event.at, label: event.data.label, words: event.data.words ?? '' });
      }
    } catch {
      // A file that cannot be read is sendPending's to set aside.
    }
  }
  return out;
}

const pick = ({ at, label, words }, where = 'chat') => ({ at, label, words, where });

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

// What a window that isn't the First Mate's is told when the director's words read as an answer to a waiting decision (design
// section 6.8, case 11): nothing was recorded, and the decision still waits.
const asideNote = (n) => `The director typed what reads as an answer to decision ${n}, but the First Mate is in another window, so nothing was recorded and the decision still waits. Say so in one plain line: the answer goes in the First Mate's window, or the director can use Take over here to move the First Mate to this one.`;

// recordAnswer({ project, sessionId, prompt, at, cwd, env, client, budget, seat }) -> { recorded, note?, why? }
// `why` is { n, words } when the reply asks why of a decision, which records nothing. `seat` is the First Mate's seat (read from
// the project when not given): with a session id, only the session the seat names records.
export async function recordAnswer({
  project, sessionId, prompt, at = new Date(), cwd, env = process.env, client, budget = BUDGET_MS + helperGrace(), decisions, on, seat = readSeat(project), holdOf,
}) {
  const now = at instanceof Date ? at : new Date(at);
  if (typeof prompt !== 'string' || typeof project !== 'string') return { recorded: false };
  const withId = typeof sessionId === 'string' && sessionId !== '';
  // The front desk's path first; where it refuses, a numbered reply at a piece's helm answers that piece's own decisions.
  let helm = null;
  const toHelm = () => {
    helm = withId ? helmSeat({ project, sessionId, env, holdOf }) : null;
    return helm !== null;
  };
  let role = null;
  if (startedByScript(env)) {
    if (!toHelm()) return { recorded: false };
  } else {
    role = sessionRole({ sessionId, env, prompt, cwd, seat });
    // A session that holds a piece's helm answers there, whatever else its role reads as.
    if (role === 'aside' && withId && !toHelm()) {
      const words = ownWords(prompt);
      if (words === null) return { recorded: false };
      const read = parseReply(words, (decisions ?? readDecisions(project)).pending);
      return read.kind === 'answer' ? { recorded: false, note: asideNote(read.n) } : { recorded: false };
    }
    if ((role !== 'front-desk' || (withId && seat?.session !== sessionId)) && !toHelm()) return { recorded: false };
  }
  const typed = ownWords(prompt);
  if (typed === null) return { recorded: false };
  // At a helm only a reply that names its number counts: a bare letter could be meant for the piece's own work.
  if (helm !== null && !/^\s*(?:reply\s+)?#?[1-9]/i.test(typed)) return { recorded: false };
  const where = helm === null ? 'chat' : 'helm';

  const read0 = decisions ?? readDecisions(project);
  // At a helm, only the held piece's decisions count, waiting or answered.
  const workIds = new Map([...(read0.record ?? []), ...read0.pending].map((d) => [d.id, d.workId]));
  const mine = (d) => helm === null || workIds.get(d.id) === helm;
  const held = helm === null ? read0 : { ...read0, pending: read0.pending.filter(mine), answered: read0.answered.filter(mine) };
  // Off (the default until the director rules on the typed-reply source gap): nothing typed is recorded. Words that read as an
  // answer to a waiting decision are told, so the First Mate asks it the other way.
  if (!(on ?? typedRepliesOn(project))) {
    const read = parseReply(typed, held.pending);
    if (read.kind !== 'answer') return { recorded: false };
    return { recorded: false, note: `The director typed what reads as an answer to decision ${read.n}. Typed replies are switched off, so nothing was recorded and the decision still waits. Ask it through the question picker (\`cards\` hands it out) and say so in one plain line.` };
  }
  // An answer kept to send counts as given: its decision no longer waits, and a second reply to it meets "already answered".
  const kept = keptAnswers(project);
  const keptFor = (d) => kept.find((k) => k.text === d.text);
  const pending = held.pending.filter((d) => keptFor(d) === undefined);
  const answered = [...held.answered, ...held.pending.filter((d) => keptFor(d) !== undefined).map((d) => ({ n: d.n, id: d.id, text: d.text, code: d.code, options: d.options, ...pick(keptFor(d), where) }))];
  let reply = parseReply(typed, pending);
  // A numbered reply to a decision answered already, with nothing else waiting for it, is told so.
  if (reply.kind === 'none' && /^\s*(?:reply\s+)?#?[1-9]/i.test(typed)) {
    const late = parseReply(typed, answered);
    if (late.kind === 'answer' || late.kind === 'why') reply = { kind: 'refused', n: late.n, reason: 'not-waiting' };
  }

  const finish = (result, note) => ({ ...result, ...(note === undefined ? {} : { note }) });

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
  const option = reply.label === 'own' ? undefined : decision.options[LETTERS.indexOf(reply.label)];
  const data = { question: decision.text, n: decision.n, label: reply.label, option: option?.label ?? '', words: reply.words, where, ...(reply.private === true ? { private: true } : {}) };
  const api = client ?? helperClient({ timeout: budget });
  const left = withinBudget(Date.now() + budget);
  // The reply is made first and the action it earns a moment later, so the reply is always what decides.
  const clock = () => now;
  const after = () => new Date(now.getTime() + 1);
  const queued = [keepEarned(project, { made: { kind: 'decision-answer', data } }, { now: clock })];
  if (option !== undefined && /^Answer question q-/.test(decision.line ?? '')) {
    try {
      const got = await earned({ project, question: decision.text, label: option.label, client: api, now: after, left });
      if (got) queued.push(keepEarned(project, got, { now: after }));
    } catch {
      // The decision-answer stands; the build's own signed answer is then missing, and the First Mate says so.
    }
  }
  let sent = true;
  for (const record of queued) {
    try {
      if (!(await sendKept(api, left, record))) sent = false;
    } catch {
      sent = false;
    }
  }
  const how = `${howAnswered({ label: reply.label, words: reply.words })}${reply.private === true ? ', marked private (kept in the private record alone, no file in the project)' : ''}`;
  const note = sent
    ? `The director answered decision ${decision.n} ${how}, and it is recorded. State it as a fact, in one plain line, and carry on from it.`
    : `The director answered decision ${decision.n} ${how}. The helper could not take it just now, so it is kept on this computer and will be sent. Say so in one plain line, and carry on from it.`;
  return { recorded: true, sent, note };
}
