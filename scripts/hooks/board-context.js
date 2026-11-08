// scripts/hooks/board-context.js
// What the director asks Wheelhouse to show, added to the turn as context. Agents can't read
// ~/.wheelhouse/, so this hook, which runs outside the sandbox, reads it for them through the desk
// (scripts/desk/client.js: the helper's, or the same core in process when the helper isn't running):
// the board, the briefing, the settings or the changed sources when the prompt is one of the plugin's
// commands, and the briefing on the first prompt after a gap of `briefingGapHours`. The briefing says
// when the delegation review is due, worked out by the desk from the project's events, since the
// front desk can't. What it judges about the visit itself (the gap, learning, a second look at the
// survey) is in scripts/desk/visit.js.
//
// In a folder whose setup isn't finished (beingSetUp), outside a feature worktree, each of the
// director's prompts gets one line instead of anything else, SETUP_FIRST: setup comes first,
// whatever the prompt asks, and the request is kept for the front desk.
//
// Otherwise in a project's main folder only: never in a feature worktree, never for the foreman, never
// outside a Wheelhouse project. It records each session's role from its first prompt (sessionRole),
// which is how a foreman started without WHEELHOUSE_ROLE is known; that first prompt gets one line
// saying so (FOREMAN_LINE), and nothing else. On each prompt it reads when the
// director last wrote, decides, builds the addition, and only then records the prompt's time and,
// when it added a briefing, that the briefing was given, which unusual use it raised and whether it
// showed the weekly lines. It informs: a failure, or a build past WAIT_MS, adds nothing and lets
// the prompt through (the prompt's time is still kept). It only reads the state, so STOP doesn't
// hold it.
//
// When cards wait that no visit has handed out, it adds one line before whatever else it adds, so
// the line is read as an instruction and never as the data to show: how many to ask, and that
// `cli.js cards` gives them (cardsLine). Under STOP the line names the one Lift STOP card, the only
// card `cli.js cards` gives then.
//
// It keeps the director's visits in seen.json: when a visit began (the first prompt of any kind
// after a gap since the last one seen) and the board commands with their tabs. On a visit's first
// prompt that is no command, it runs learning (scripts/frontdesk/learning.js) before the cards are
// counted, within LEARN_WAIT_MS and never under STOP (ruling F32): a concept set to false is written
// to the profile at once, and each other proposal is written with its confirm card, waiting, so it
// is asked with this visit's cards. A setting or a level waiting for its confirmation whose card
// wasn't written gets it then too (rulings F37, F45). Learning adds no text, and a failure or a
// late helper leaves the rest for next visit.
//
// The daily digest the watcher made (scripts/watcher/digest.js) is added once, at the first message after it was made, ahead of the
// cards line, and then taken away; it answers nothing.
//
// A command is matched as typed, in any case, with white space around it ignored:
// /wheelhouse:logbook or /wheelhouse:board (optionally "build" or "director"), /wheelhouse:briefing,
// /wheelhouse:settings and /wheelhouse:sources. The short forms (/board) are left to whoever owns them.
import { answer, runAndExit, projectOf, beingSetUp, readTailEntries } from './kit.js';
import { stoppedQuestion } from './stopped-question.js';
import { answeredWords, subjectOf, NOTE_LEAD } from '../cards/answered.js';
import { SINCE_LEAD, SINCE_TAIL } from '../cards/panel-words.js';
import { chatCopy } from '../state/card-lines.js';
import { readOpen, clearOpen } from '../lib/session-files.js';
import { featureSlug, SETUP_FIRST } from './session-start.js';
import { keepRequest } from '../lib/kept-request.js';
import { briefingModel as realBriefingModel } from '../briefing/model.js';
import { heldBackLine } from '../board/model.js';
import { readSeen, readSurveyAt, markSeen, readVisits } from '../briefing/seen.js';
import { readDigest, clearDigest } from '../digest/due.js';
import { takeFailures } from '../alerts/tick.js';
import { markRaised as realMarkRaised } from '../usage/figures.js';
import { sessionRole, recordRole } from '../lib/role.js';
import { existingCard } from '../cards/visit.js';
import { controlFilesDue, gateAsksDue, holdsDue, premiumFailuresDue } from '../cards/build-loop.js';
import { questionProblem } from '../cards/compose.js';
import { answerLine } from '../state/card-lines.js';
import { helperClient } from '../host/helper-client.js';
import { stopState } from '../lib/stop.js';
import { CARD } from '../lib/front-desk.js';
import { HELPER_WAIT_MS } from '../lib/core-numbers.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { HEADINGS, NOT_CHECKED, NONE_CHANGED, briefingIn } from '../desk/context.js';
import { deskClient, unreached } from '../desk/client.js';
import { isDecisionCard } from '../decisions/pending.js';
import { startedByScript } from '../decisions/answer.js';
import { typedRepliesIn } from '../decisions/switch.js';
import { parseReply } from '../decisions/reply.js';
import { ownWords } from '../lib/own-words.js';
import { isBuildQuestion } from '../protection/windows-builds.js';
import { gapHours, visitLearning, earlierSurvey, offerAgainDue, OFFER_AGAIN_MS } from '../desk/visit.js';

export { HEADINGS, NOT_CHECKED, NONE_CHANGED, briefingIn, OFFER_AGAIN_MS };
import { helperGrace } from '../lib/helper-grace.js';

export const WAIT_MS = 2000;
// How long learning may take on a visit's first prompt; with WAIT_MS it stays well inside the hook's 10 s.
export const LEARN_WAIT_MS = 3000;
// How long the board's inputs wait on the helper, so a helper that hangs leaves time to finish
// with what is on disk (the host facts' cache among it) inside WAIT_MS.
export const INPUTS_WAIT_MS = HELPER_WAIT_MS - 500;
const HOUR_MS = 60 * 60 * 1000;
const COMMAND = /^\/wheelhouse:(board|logbook|briefing|settings|sources)(?:[ \t]+(.*))?$/i;
// The line for a session whose first prompt made it the foreman, which the session start, seeing no
// prompt yet, named the front desk.
export const FOREMAN_LINE = 'This session is the Bosun, not the First Mate. Follow wheelhouse:foreman and set wheelhouse:front-desk aside.';
// The line that tells the front desk to ask the cards waiting, after the briefing, in Claude Code's words.
export const cardsLine = (n) => `Cards to ask this visit: ${n}. Run \`cli.js cards\` and ask them in one AskUserQuestion call, after the briefing.`;
const TABS = ['director', 'build'];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function attempt(read, fallback = null) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

// { name, tab } for a command prompt, else null.
export function commandOf(prompt) {
  const match = COMMAND.exec(prompt.replace(/\p{Cf}/gu, '').trim());
  if (!match) return null;
  const word = (match[2] ?? '').trim().toLowerCase();
  const name = match[1].toLowerCase();
  // /wheelhouse:logbook is the Logbook's own name; /wheelhouse:board, its earlier one, still works. Both are 'board' here.
  return { name: name === 'logbook' ? 'board' : name, tab: TABS.includes(word) ? word : undefined };
}

// The clock as a Date; one that can't be read gives an invalid Date.
function clockOf(now) {
  return attempt(() => new Date(typeof now === 'function' ? now() : now), new Date(NaN));
}

// Whether the gap since `since` (a time, or null) has passed. None (or one after now) counts as a
// gap; with a clock that can't be read, none can be measured.
function gapPassed(project, since, at) {
  const nowMs = at.getTime();
  if (!Number.isFinite(nowMs)) return false;
  if (since === null) return true;
  return nowMs - Date.parse(since) >= gapHours(project, at) * HOUR_MS;
}

// How many cards `cli.js cards` would hand out now, from the views the desk's waiting view gives: the waiting cards no
// visit has handed out, and the open questions from the build that no waiting card asks yet and
// that the composer can make a card of, which it makes cards of first; then the cards the build
// loop's records call for (scripts/cards/build-loop.js): each click the merge gate waits for whose
// card is to be made or asked again, each lineage hold with no card, and each control-file
// record with no card. Whether a pull request
// has moved on is the host's to say, which `cli.js cards` asks and this doesn't, so until the
// gate's next record this may count a gate card that `cards` then doesn't give. At most one call's worth. Under STOP,
// the one Lift STOP card.
async function cardsToAsk(desk, at) {
  if (stopState().on) return 1;
  const got = await desk.read('waiting');
  return got?.ok === true && isRecord(got.data?.views) ? cardsDue(got.data.views, at) : 0;
}

// The count cardsToAsk gives, from the views given (with STOP off).
export function cardsDue(views, at) {
  const waiting = Array.isArray(views.waiting) ? views.waiting.filter(isRecord) : [];
  // With typed replies on, a decision is shown as a chat message, so it is no card to ask (see decisionsLine); off, it is a card.
  const typed = typedRepliesIn(views.settings);
  const fresh = new Set(waiting.filter((card) => (card.asked === null || card.asked === undefined) && !heldBackLine(card.data?.line, views) && !(typed && isDecisionCard(card.data))).map((card) => card.id));
  const questions = Object.entries(isRecord(views.questions) ? views.questions : {})
    .filter(([id, entry]) => isRecord(entry) && !entry.answer && entry.joins === undefined && existingCard({ waiting }, answerLine(id)) === null && !heldBackLine(answerLine(id), views)
      && (!typed || isBuildQuestion(entry.question?.data)) && questionProblem(entry.question?.data, { recorded: true }) === null).length;
  const gate = gateAsksDue(views, at);
  for (const due of gate) if (due.again !== undefined) fresh.add(due.again);
  const made = gate.filter((due) => due.make).length + holdsDue(views).length + controlFilesDue(views).length + premiumFailuresDue(views).length;
  return Math.min(CARD.questions, fresh.size + questions + made);
}

// The line for the decisions waiting, which are shown as chat messages and never through the question picker: each by its number and
// question, and how to show it. A question from the build that has no card yet is a decision to come: `decision list` makes it. Null
// when none waits.
export const decisionsLead = (waiting) => `Decisions waiting for the director: ${waiting}.`;
export const DECISIONS_TAIL = 'Run `decision list`, then print each one exactly as `decision show <n>` prints it, in a message of its own. The director answers by typing a reply, and only their typed reply decides: never answer for them.';
export const DECISIONS_TAIL_OFF = 'Typed replies are switched off: run `decision list`, print each one exactly as `decision show <n>` prints it, then ask it through the question picker (`cards` hands it out). A typed reply decides nothing: never answer for them.';
export function decisionsLine(views, pending) {
  const typed = typedRepliesIn(isRecord(views) ? views.settings : undefined);
  const listed = (Array.isArray(pending) ? pending : []).filter(isRecord);
  const waiting = isRecord(views) ? views.waiting : [];
  const cards = Array.isArray(waiting) ? waiting.filter(isRecord) : [];
  // Off, a question with no card yet is counted by the cards line instead, as it always was.
  const toCome = !typed ? 0 : Object.entries(isRecord(views?.questions) ? views.questions : {})
    .filter(([id, entry]) => isRecord(entry) && !entry.answer && entry.joins === undefined && existingCard({ waiting: cards }, answerLine(id)) === null
      && !isBuildQuestion(entry.question?.data) && questionProblem(entry.question?.data, { recorded: true }) === null).length;
  if (listed.length === 0 && toCome === 0) return null;
  const said = listed.map((d) => `${d.n}. ${d.question}`).join('; ');
  return [listed.length === 0 ? null : decisionsLead(said), toCome === 0 ? null : `Decisions not shown yet: ${toCome}.`, typed ? DECISIONS_TAIL : DECISIONS_TAIL_OFF].filter(Boolean).join(' ');
}

// `typed` is the director's own words in this prompt. A decision that reply answers is left out, as the prompt hook records it
// beside this hook in the same turn, and the line would otherwise show it as waiting.
async function decisionLineOf(desk, typed) {
  const got = await desk.read('waiting');
  if (got?.ok !== true || !isRecord(got.data?.views)) return null;
  const pending = Array.isArray(got.data.decisions?.pending) ? got.data.decisions.pending : [];
  const reply = typeof typed === 'string' && typedRepliesIn(got.data.views.settings) ? parseReply(typed, pending) : { kind: 'none' };
  return decisionsLine(got.data.views, reply.kind === 'answer' ? pending.filter((d) => d.n !== reply.n) : pending);
}

// The most stuck messages one line names.
const STUCK_NOTES = 3;

// A feature session's own plain message that it is stuck (the note `act stuck-note` records), told once: those recorded since the
// First Mate's last turn began, or in the last day when there was none. Null when there are none.
export async function stuckLine(desk, since, at) {
  const from = Number.isFinite(Date.parse(since)) ? Date.parse(since) : at.getTime() - 24 * HOUR_MS;
  const got = await desk.read('waiting', { stuck: true });
  const notes = (Array.isArray(got?.data?.stuck) ? got.data.stuck : [])
    .filter((e) => isRecord(e) && typeof e.work === 'string' && typeof e.words === 'string' && Date.parse(e.recorded) > from)
    .slice(0, STUCK_NOTES);
  if (notes.length === 0) return null;
  return notes.map((e) => `${e.work} is stuck: its session says "${e.words.replace(/\s+/g, ' ').trim()}" (sent ${e.at}).`).join(' ');
}

// What the director answered since the First Mate's last turn, and how the cards of a question that was stopped stand now.
// Neither names a card's id: a card goes by its subject.
export { SINCE_LEAD };
export const STOPPED_LEAD = 'The last card question was stopped, which records nothing and is no answer. As each card stands now: ';
const STOPPED_TAIL = 'Never say a card was closed without an answer.';
// The most cards one line names; the rest are on the board.
const NOTE_CARDS = 6;

// The two lines, in the order they go into the context: [since, stopped], each a string or null. `since` is when the
// First Mate's last turn began (the prompt before this one); `open` is what the session's open.json held. A card the
// stopped line names is left out of the since line.
async function cardNotes({ project, input, since, at, desk, open }) {
  // The decided cards, the card events and the board's numbers all come through the desk (design section 4.4): the hook
  // reads neither the state nor the keys itself.
  const from = Date.parse(since);
  const back = new Date((Number.isFinite(from) ? from : at.getTime()) - 3600000).toISOString();
  const got = await desk.read('waiting', { outcomes: { since: back } });
  const data = isRecord(got?.data) ? got.data : {};
  const decided = Array.isArray(data.outcomes) ? data.outcomes.filter((o) => isRecord(o) && isRecord(o.card) && isRecord(o.decided)) : [];
  const events = Array.isArray(data.cards) ? data.cards.filter((e) => isRecord(e) && typeof e.id === 'string') : [];
  const numbers = new Map();
  for (const item of Array.isArray(data.numbered) ? data.numbered : []) if (typeof item.card === 'string') numbers.set(item.card, item.n);
  const outcomes = [
    ...decided,
    ...events.filter((e) => numbers.has(e.id) && !decided.some((o) => o.card.id === e.id)).map((card) => ({ card, decided: null })),
  ];
  const firstLine = (text) => String(text ?? '').split('\n')[0];
  const tail = readTailEntries(input.transcript_path);
  const questions = stoppedQuestion(tail, { prompt: input.prompt });
  // The cards whose hidden line the mod appended is already in the transcript's tail: the chat said them.
  const tailText = Array.isArray(tail) ? JSON.stringify(tail) : '';
  const noted = (id) => tailText.includes(NOTE_LEAD) && tailText.includes(`(card ${id})`);
  const named = new Map();
  if (questions !== null) {
    for (const text of questions) {
      const lines = [firstLine(text), firstLine(chatCopy(text))];
      const mine = outcomes.filter((o) => typeof o.card.data?.question === 'string' && lines.some((l) => l === firstLine(o.card.data.question) || l === firstLine(chatCopy(o.card.data.question))));
      const found = mine.filter((o) => o.decided === null).at(-1) ?? mine.at(-1);
      if (found !== undefined) named.set(found.card.id, found);
    }
    for (const id of open?.cards ?? []) {
      const found = outcomes.find((o) => o.card.id === id);
      if (found !== undefined) named.set(id, found);
    }
  }
  let stopped = null;
  if (named.size > 0) {
    const parts = [...named.values()].slice(0, NOTE_CARDS).map((o) => {
      if (o.decided !== null) return `${subjectOf(o.card)}: ${answeredWords(o, at)}`;
      const n = numbers.get(o.card.id);
      return `${subjectOf(o.card)}: still waiting${n === undefined ? '' : `, card ${n}`}`;
    });
    stopped = `${STOPPED_LEAD}${parts.join('; ')}. ${STOPPED_TAIL}`;
  }
  const fresh = Number.isFinite(from)
    ? outcomes.filter((o) => o.decided !== null && o.decided.where !== 'chat' && Date.parse(o.decided.at) > from && !named.has(o.card.id) && !noted(o.card.id))
      .sort((a, b) => Date.parse(a.decided.at) - Date.parse(b.decided.at)).slice(0, NOTE_CARDS)
    : [];
  const told = fresh.length === 0 ? null : `${SINCE_LEAD}${fresh.map((o) => `${subjectOf(o.card)}: ${answeredWords(o, at)}`).join('; ')}. ${SINCE_TAIL}`;
  return [told, stopped];
}

// What `start` gives within `ms`, or null when it throws or is late.
async function within(start, ms) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    return await Promise.race([Promise.resolve().then(start), late]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The desk the hook reads through (scripts/desk/client.js): the helper's, or, when it isn't running,
// the same core in process over the files. A `client` with no desk of its own (a test's) has the
// helper's desk added. The board's inputs ask the helper whether it is up and who holds the lock,
// each within INPUTS_WAIT_MS, so a helper that hangs leaves time to finish with what is on disk
// inside WAIT_MS; and once the helper hasn't been reached, the prompt's later reads don't wait on
// it again.
function deskOf({ cwd, client, at }) {
  const timeout = INPUTS_WAIT_MS + helperGrace();
  const base = client ?? helperClient({ timeout });
  const desk = isRecord(base.desk) ? base.desk : helperClient({ timeout }).desk;
  let away = null;
  const bounded = (call) => (...args) => within(() => call(...args), timeout);
  const helper = {
    ...base,
    ...(typeof base.health === 'function' ? { health: bounded(base.health) } : {}),
    ...(isRecord(base.lock) && typeof base.lock.read === 'function' ? { lock: { ...base.lock, read: bounded(base.lock.read) } } : {}),
    desk: {
      ...desk,
      read: async (body) => {
        if (away !== null) return away;
        const got = await desk.read(body);
        if (unreached(got)) away = got;
        return got;
      },
    },
  };
  return deskClient({ cwd, client: helper, local: 'auto', now: () => at, waitMs: INPUTS_WAIT_MS + helperGrace() });
}

// The addition for `want`, as the desk's view gives it, and the unusual items it showed. Throws
// when it can't be built. A stand-in `briefingModel` (a test's) reaches the core only when it runs
// in process; it never crosses to the helper.
async function build(want, { desk, at, command, reserve, briefingModel, ...rest }) {
  let got;
  if (want === 'briefing') {
    got = await desk.read('briefing', {
      reserve, ...rest, ...(Number.isFinite(at.getTime()) ? { at: at.toISOString() } : {}),
      ...(briefingModel === realBriefingModel ? {} : { briefingModel }),
    });
  } else if (want === 'board') {
    got = await desk.read('logbook', { context: true, tab: command?.tab, reserve });
  } else {
    got = await desk.read('settings', { context: true, part: want, reserve });
  }
  if (got?.ok !== true || !isRecord(got.data) || typeof got.data.text !== 'string') throw new Error(got?.refused ?? 'No context');
  const { text, raise, weeklyShown, surveyShown, safekeeping } = got.data;
  return { text, raise: Array.isArray(raise) ? raise : [], weeklyShown: weeklyShown === true, surveyShown: typeof surveyShown === 'string' ? surveyShown : null, safekeeping: typeof safekeeping === 'string' ? safekeeping : null };
}

// The latest survey as the desk's survey view gives it ({ id, at, data }), or null. One that missed
// the host, and was not itself a second look, is taken again first, once (plan ruling P3): the helper
// takes it only when none was taken since, and refuses under STOP, so then the briefing is built from
// the survey there is. Never throws.
async function surveyOf({ project, client, desk }) {
  const held = async () => {
    const got = await desk.read('survey');
    return got?.ok === true && isRecord(got.data?.survey) ? got.data.survey : null;
  };
  const survey = await held();
  if (!isRecord(survey?.data) || survey.data.hostReached !== false || survey.data.again === true) return survey;
  try {
    const asker = client ?? helperClient({ timeout: LEARN_WAIT_MS + helperGrace() });
    const got = await asker.survey.again({ project });
    if (got?.ok !== true || got.taken !== true) return survey;
    return await held();
  } catch {
    return survey;
  }
}

// decide(input, deps) -> the context to add, or undefined.
//
// On an agent whose hooks only read (`writeVia: 'helper'`, ruling P5-20) nothing is written under the Wheelhouse
// home: no role, no visit, no prompt time, no unusual use raised. With no prompt time kept, a gap can't be told,
// so it adds no briefing and runs no learning: that agent's briefing comes with its session start. The board
// commands and the cards line are added as for any agent, read through the helper.
export async function decide(input, deps = {}) {
  try {
    const {
      dir, now = () => new Date(), env = process.env, client, desk: givenDesk, waitMs = WAIT_MS + helperGrace(), learnWaitMs = LEARN_WAIT_MS + helperGrace(),
      briefingModel = realBriefingModel, markRaised: raiseMarked = realMarkRaised, writeVia = 'self',
    } = deps;
    const writes = writeVia === 'self';
    const markSeenHere = writes ? markSeen : () => {};
    const markRaised = writes ? raiseMarked : () => {};
    if (!isRecord(input) || typeof input.cwd !== 'string' || typeof input.prompt !== 'string') return undefined;
    // While setup is unfinished here, setup comes first, whatever the prompt asks. A step the build engine started is
    // not the director arriving, so setup never comes first for it (the health trial runs in an unfinished folder).
    const setup = featureSlug(input.cwd) === null && env?.WHEELHOUSE_ENGINE_RUN !== '1' ? attempt(() => beingSetUp(input.cwd), null) : null;
    const found = projectOf(input.cwd, { dir });
    // The director's request is kept for the session that carries setup on, should setup need a new one.
    if (setup !== null && writes && typeof setup.folder === 'string') attempt(() => keepRequest(setup.folder, input.prompt, now), false);
    if (!found) return setup === null ? undefined : answer.context('UserPromptSubmit', SETUP_FIRST);
    const role = sessionRole({ sessionId: input.session_id, env, prompt: input.prompt, cwd: input.cwd });
    const first = writes ? attempt(() => recordRole(input.session_id, role), false) : false;
    // A foreman known only from its first prompt was pointed at the front desk by the session start.
    if (role === 'foreman' && first && env?.WHEELHOUSE_ROLE !== 'foreman') return answer.context('UserPromptSubmit', FOREMAN_LINE);
    if (setup !== null && role === 'front-desk') return answer.context('UserPromptSubmit', SETUP_FIRST);
    if (role !== 'front-desk' || featureSlug(input.cwd) !== null) return undefined;
    const { project } = found;
    const at = clockOf(now);
    const seen = readSeen(project, { now: at });
    const visits = attempt(() => readVisits(project, { now: at }), { visitAt: null, boardAsks: [] });
    const command = commandOf(input.prompt);
    // The gap runs from the director's last prompt or the last briefing given, whichever is later,
    // so a briefing /wheelhouse-digest gave counts as given: a prompt soon after it brings none.
    const due = gapPassed(project, [seen.promptAt, seen.briefedAt].filter((t) => typeof t === 'string').sort().at(-1) ?? null, at);
    const want = command?.name ?? (due && writes ? 'briefing' : null);
    // A visit begins with the first prompt of any kind after a gap since the last one seen: the last
    // message, the last board command or the visit's own start.
    const lastSeen = [seen.promptAt, visits.visitAt, visits.boardAsks.at(-1)?.at].filter((t) => typeof t === 'string').sort().at(-1) ?? null;
    const visit = gapPassed(project, lastSeen, at) ? at : visits.visitAt;
    if (visit === at) attempt(() => markSeenHere(project, { visitAt: at }));
    if (command?.name === 'board') attempt(() => markSeenHere(project, { boardAsk: { at, tab: command.tab ?? null, visit } }));
    if (!command && due && writes && !attempt(() => stopState().on, true)) {
      const asker = client ?? helperClient({ timeout: LEARN_WAIT_MS + helperGrace() });
      await within(() => visitLearning({ project, cwd: input.cwd, client: asker, at, boardAsks: visits.boardAsks }), learnWaitMs);
    }
    const desk = givenDesk ?? deskOf({ cwd: input.cwd, client, at });
    const count = (await within(() => cardsToAsk(desk, at), waitMs)) ?? 0;
    const cards = count > 0 ? cardsLine(count) : null;
    // What the cards just answered or left open say, ahead of the cards line. A session's open.json is read once and
    // cleared by this prompt, whatever comes of the lines.
    const sessionId = typeof input.session_id === 'string' ? input.session_id : null;
    const open = sessionId === null ? null : attempt(() => readOpen(sessionId), null);
    if (writes && sessionId !== null) attempt(() => clearOpen(sessionId));
    // What the prompt hook makes of a reply (scripts/decisions/answer.js) it tells in its own context for this turn. Here the
    // reply is only read, under the same guards, to leave out the decision it answers.
    const typed = !writes || startedByScript(env) ? null : attempt(() => ownWords(input.prompt), null);
    const decisionLine = await within(() => decisionLineOf(desk, typed), waitMs);
    const stuck = await within(() => stuckLine(desk, seen.promptAt, at), waitMs);
    // The daily digest the watcher made waits for the director's next message and is shown once, here (scripts/digest/due.js). A hook that
    // only reads leaves it for one that can take it away.
    // A session a script started is no director arriving, so it never uses the digest up.
    const digest = writes && !startedByScript(env) ? attempt(() => readDigest(project), null) : null;
    const notes = [decisionLine, digest?.text ?? null, stuck, ...((await within(() => cardNotes({ project, input, since: seen.promptAt, at, desk, open }), waitMs)) ?? [])].filter((line) => typeof line === 'string');
    const reserve = (cards === null ? 0 : cards.length + 2) + notes.reduce((sum, line) => sum + line.length + 2, 0);
    // A survey not worked out in time is left to the briefing view, which takes the record's latest.
    const survey = want === 'briefing' ? (await within(() => surveyOf({ project, client, desk }), learnWaitMs)) ?? undefined : null;
    // Offered once more, the survey's line about work in flight is said again, alone.
    const again = want === 'briefing' && attempt(() => offerAgainDue(project, at), false);
    const built = want
      ? await within(() => build(want, {
        desk, at, command, since: seen.briefedAt, weeklySince: seen.weeklyAt, briefingModel, reserve, survey,
        surveyAt: again ? null : readSurveyAt(project),
        ...(again ? { leaveOut: ['instructions', 'missed'] } : { earlier: attempt(() => earlierSurvey(project, survey, readSurveyAt(project)), null) }),
      }), waitMs)
      : null;
    // The director did write, whatever could be shown. A command other than the briefing's
    // leaves the time as it was, so a briefing that was due still comes with the next prompt.
    if (!command || command.name === 'briefing') attempt(() => markSeenHere(project, { promptAt: at }));
    if (built && want === 'briefing') {
      // The weekly lines count as given only when the text showed them, and so does the survey.
      attempt(() => markSeenHere(project, { briefedAt: at, ...(built.weeklyShown ? { weeklyAt: at } : {}), ...(built.surveyShown ? { surveyAt: built.surveyShown } : {}), ...(again && built.surveyShown ? { surveyAgainAt: at } : {}), ...(built.safekeeping ? { safekeepingLevel: built.safekeeping, safekeepingAt: at } : {}) }));
      if (built.raise.length > 0 && Number.isFinite(at.getTime())) attempt(() => markRaised(built.raise, { now: at }));
    }
    const text = [...notes, cards, built?.text].filter((part) => typeof part === 'string').join('\n\n');
    // Shown now, so it is not shown again: the time is kept for the next digest's "since", and the file taken away.
    if (digest !== null && text !== '') {
      attempt(() => clearDigest(project));
      attempt(() => markSeenHere(project, { digestShownAt: at, ...(digest.weekly ? { digestLogShownAt: at } : {}) }));
      // The failed alerts it said are said.
      if (digest.failures > 0) attempt(() => takeFailures(project, digest.failures));
    }
    return text === '' ? undefined : answer.context('UserPromptSubmit', text);
  } catch {
    return undefined;
  }
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'UserPromptSubmit' });
}
