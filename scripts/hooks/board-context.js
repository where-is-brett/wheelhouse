// scripts/hooks/board-context.js
// What the director asks Wheelhouse to show, added to the turn as context. Agents can't read
// ~/.wheelhouse/, so this hook, which runs outside the sandbox, reads it for them through the desk
// (scripts/desk/client.js: the helper's, or the same core in process when the helper isn't running):
// the board, the briefing, the settings or the changed sources when the prompt is one of the plugin's
// commands, and the briefing on the first prompt after a gap of `briefingGapHours`. The briefing says
// when the delegation review is due, worked out by the desk from the project's events, since the
// front desk can't. What it judges about the visit itself (the gap, learning, a second look at the
// survey) is in scripts/desk/visit.js; learning, which only a visit's first prompt runs, is loaded then (scripts/desk/visit-learning.js).
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
import { answer, runAndExit, projectOf, beingSetUp } from './kit.js';
import { SINCE_LEAD } from '../cards/panel-words.js';
import { readOpen, clearOpen } from '../lib/session-files.js';
import { featureSlug, madeFeatureSlug } from '../lib/feature-slug.js';
import { SETUP_FIRST } from '../lib/setup-first.js';
import { keepRequest } from '../lib/kept-request.js';
import { readSeen, readSurveyAt, markSeen, readVisits } from '../briefing/seen.js';
import { readDigest, clearDigest } from '../digest/due.js';
import { takeFailures } from '../alerts/tick.js';
import { sessionRole, recordRole, recordAside, asideByChoice } from '../lib/role.js';
import { BUILDER_PROMPT_LEAD } from '../foreman/prompt-lead.js';
import { refreshSeat, movedAway, releaseSeat } from '../lib/first-mate-seat.js';
import { SEAT_MOVED_LINE } from '../lib/front-desk.js';
import { helperClient } from '../host/helper-client.js';
import { stopState } from '../lib/stop.js';
import { HELPER_WAIT_MS } from '../lib/core-numbers.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { HEADINGS, NOT_CHECKED, NONE_CHANGED } from '../desk/context-words.js';
import { deskClient, unreached } from '../desk/client.js';
import { startedByScript } from '../lib/started-by-script.js';
import { ownWords } from '../lib/own-words.js';

export { HEADINGS, NOT_CHECKED, NONE_CHANGED };
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
  // `/wheelhouse:logbook watch <piece>` is the page command's: the Logbook is not added for it.
  const watch = name === 'logbook' && /^watch(\s|$)/.test(word);
  return { name: name === 'logbook' ? 'board' : name, tab: TABS.includes(word) ? word : undefined, ...(watch ? { watch: true } : {}) };
}

// The clock as a Date; one that can't be read gives an invalid Date.
function clockOf(now) {
  return attempt(() => new Date(typeof now === 'function' ? now() : now), new Date(NaN));
}

// Whether the gap since `since` (a time, or null) has passed. None (or one after now) counts as a
// gap; with a clock that can't be read, none can be measured.
function gapPassed(project, since, at, gapHours) {
  const nowMs = at.getTime();
  if (!Number.isFinite(nowMs)) return false;
  if (since === null) return true;
  return nowMs - Date.parse(since) >= gapHours(project, at) * HOUR_MS;
}

// The line for the decisions waiting, which are shown as chat messages and never through the question picker: each by its number and
// question, and how to show it. A question from the build that has no card yet is a decision to come: `decision list` makes it. Null
// when none waits.
export const decisionsLead = (waiting) => `Decisions waiting for the director: ${waiting}.`;
export const DECISIONS_TAIL = 'Run `decision list`, then print each one exactly as `decision show <n>` prints it, in a message of its own. The director answers by typing a reply, and only their typed reply decides: never answer for them.';
export const DECISIONS_TAIL_OFF = 'Typed replies are switched off: run `decision list`, print each one exactly as `decision show <n>` prints it, then ask it through the question picker (`cards` hands it out). A typed reply decides nothing: never answer for them.';
// What the director answered since the First Mate's last turn, and how the cards of a question that was stopped stand now.
// Neither names a card's id: a card goes by its subject.
export { SINCE_LEAD };
export const STOPPED_LEAD = 'The last card question was stopped, which records nothing and is no answer. As each card stands now: ';

// How far back the decided cards are read: an hour before the First Mate's last turn began, or before now when none is known.
export function outcomesSince(since, at) {
  const from = Date.parse(since);
  return new Date((Number.isFinite(from) ? from : at.getTime()) - 3600000).toISOString();
}

// The waiting view, read once for every line the prompt builds from it (the cards due, the decisions, the stuck notes, the helm
// notes, the approvals with no card, the decided cards): each asks for the one view with its own extras, so one read with all
// the extras answers them all, where a read each was seven helper round trips in turn, each rebuilding the views.
function sharedWaiting(desk, { since, at }) {
  let once;
  return { ...desk, read: (view, args) => (view === 'waiting' ? (once ??= desk.read('waiting', { stuck: true, helmNotes: true, outcomes: { since: outcomesSince(since, at) } })) : desk.read(view, args)) };
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
      ...(briefingModel === undefined ? {} : { briefingModel }),
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

// The helper's small read for an agent whose hooks can't write: when the session's last turn began, which this read records,
// in the helper. Asked of the helper alone, never run in this process, so a helper that isn't running gives null and nothing
// is written under the Wheelhouse home.
async function helperTurnAt({ cwd, client, session }) {
  const timeout = INPUTS_WAIT_MS + helperGrace();
  const base = client ?? helperClient({ timeout });
  const asker = isRecord(base.desk) ? base : { ...base, desk: helperClient({ timeout }).desk };
  const got = await deskClient({ cwd, client: asker, local: 'never', timeout }).read('waiting', { turn: session });
  return got?.ok === true && typeof got.data?.turnAt === 'string' ? got.data.turnAt : null;
}

// Whether `value` holds nothing: no entry, no text, nothing under any key.
const hollow = (value) => value === null || value === undefined || value === ''
  || (Array.isArray(value) ? value.every(hollow) : isRecord(value) && Object.values(value).every(hollow));

// The lines the waiting view gives, [cards due, decisions, stuck, helm notes, approvals with no card, the cards decided since]
// (scripts/hooks/waiting-lines.js), each within its own wait: together they wait no longer than one does. That module is read only
// when the view holds something: one that can't be read, or holds nothing but settings, gives none of them. STOP, whose
// one card is counted without the view, always reads it.
async function waitingLines(waiting, { project, input, since, promptAt, at, open, typed, waitMs }) {
  const none = [null, null, null, null, null, null];
  if (!stopState().on) {
    const got = await within(() => waiting.read('waiting'), waitMs);
    const { views, ...others } = isRecord(got?.data) ? got.data : {};
    const { settings, ...otherViews } = isRecord(views) ? views : {};
    if (got?.ok !== true || (hollow(isRecord(views) ? otherViews : views) && hollow(others))) return none;
  }
  const lines = await import('./waiting-lines.js');
  return Promise.all([
    within(() => lines.cardsToAsk(waiting, at), waitMs),
    within(() => lines.decisionLineOf(waiting, typed), waitMs),
    within(() => lines.stuckLine(waiting, promptAt, at), waitMs),
    within(() => lines.helmNoteLine(waiting, promptAt, at), waitMs),
    within(() => lines.orphanLineOf(waiting), waitMs),
    within(() => lines.cardNotes({ project, input, since, at, desk: waiting, open }), waitMs),
  ]);
}

const FIRST_MATE_TITLE = 'Wheelhouse · First Mate';

// decide(input, deps) -> the context to add, or undefined.
//
// On an agent whose hooks only read (`writeVia: 'helper'`, ruling P5-20) nothing is written under the Wheelhouse
// home: no role, no visit, no prompt time, no unusual use raised. With no prompt time kept, a gap can't be told,
// so it adds no briefing and runs no learning: that agent's briefing comes with its session start. The board
// commands and the cards line are added as for any agent, read through the helper.
export async function decide(input, deps = {}) {
  const out = await context(input, deps);
  // A session that began as setup carries its title until setup is finished here; the first message after that gives the bar the
  // First Mate's, once (scripts/lib/setup-title.js).
  let retitle = false;
  try {
    retitle = (deps.writeVia ?? 'self') === 'self' && isRecord(input) && featureSlug(input.cwd) === null && beingSetUp(input.cwd) === null && projectOf(input.cwd, { dir: deps.dir }) !== null && (await import('../lib/setup-title.js')).takeSetupTitled(input.session_id);
  } catch { /* the title stays */ }
  if (!retitle) return out;
  const output = out?.hookSpecificOutput ?? { hookEventName: 'UserPromptSubmit' };
  return { ...out, hookSpecificOutput: { ...output, sessionTitle: FIRST_MATE_TITLE } };
}

async function context(input, deps = {}) {
  try {
    const {
      dir, now = () => new Date(), env = process.env, client, desk: givenDesk, waitMs = WAIT_MS + helperGrace(), learnWaitMs = LEARN_WAIT_MS + helperGrace(),
      briefingModel, markRaised: raiseMarked, writeVia = 'self',
    } = deps;
    const writes = writeVia === 'self';
    const markSeenHere = writes ? markSeen : () => {};
    // The usage module is read only when a briefing raised something to mark.
    const markRaised = writes ? raiseMarked ?? (async (...args) => (await import('../usage/figures.js')).markRaised(...args)) : () => {};
    if (!isRecord(input) || typeof input.cwd !== 'string' || typeof input.prompt !== 'string') return undefined;
    // While setup is unfinished here, setup comes first, whatever the prompt asks. A step the build engine started is
    // not the director arriving, so setup never comes first for it (the health trial runs in an unfinished folder).
    const setup = featureSlug(input.cwd) === null && env?.WHEELHOUSE_ENGINE_RUN !== '1' ? attempt(() => beingSetUp(input.cwd), null) : null;
    const found = projectOf(input.cwd, { dir });
    // The director's request is kept for the session that carries setup on, should setup need a new one.
    if (setup !== null && writes && typeof setup.folder === 'string') attempt(() => keepRequest(setup.folder, input.prompt, now), false);
    if (!found) return setup === null ? undefined : answer.context('UserPromptSubmit', SETUP_FIRST);
    const role = sessionRole({ sessionId: input.session_id, env, prompt: input.prompt, cwd: input.cwd });
    // An aside the seat made (another session holds it) is not recorded: the seat can change, a choice can't.
    const keep = role !== 'aside' || attempt(() => asideByChoice({ prompt: input.prompt, cwd: input.cwd }), false);
    const first = writes && keep ? attempt(() => recordRole(input.session_id, role), false) : false;
    // A builder Desktop started: its first prompt's marker line names the piece, and the worktree Desktop made is recorded for
    // it. Only a prompt that begins with the builder lead pays for the load, and only in a worktree Wheelhouse didn't make.
    if (writes && first && role === 'feature' && input.prompt.startsWith(BUILDER_PROMPT_LEAD) && madeFeatureSlug(input.cwd) === null) {
      try {
        const { adoptBuilder } = await import('../foreman/adopt.js');
        adoptBuilder({ project: found.project, checkout: found.record.folder, sessionId: input.session_id, prompt: input.prompt, cwd: input.cwd });
      } catch { /* the builder carries on; the foreman asks for the record and is told it is missing */ }
    }
    // The aside command typed after the session start took the seat: the record turns aside and the seat is given up.
    if (writes && role === 'aside' && keep) {
      attempt(() => recordAside(input.session_id));
      attempt(() => releaseSeat(found.project, input.session_id));
    }
    // Where hooks can't write, the helper records the choice, so a chat that chose to be an aside never takes a free seat.
    if (!writes && role === 'aside' && keep && typeof input.session_id === 'string' && input.session_id !== '') {
      const asker = client ?? helperClient({ timeout: WAIT_MS + helperGrace() });
      await within(() => asker.session.seat({ cwd: input.cwd, session: input.session_id, aside: true }), waitMs);
    }
    // A foreman known only from its first prompt was pointed at the front desk by the session start.
    if (role === 'foreman' && first && env?.WHEELHOUSE_ROLE !== 'foreman') return answer.context('UserPromptSubmit', FOREMAN_LINE);
    if (setup !== null && role === 'front-desk') return answer.context('UserPromptSubmit', SETUP_FIRST);
    if (writes && role === 'aside' && attempt(() => movedAway(found.project, input.session_id), false)) return answer.context('UserPromptSubmit', SEAT_MOVED_LINE);
    // Where hooks can't write, the helper keeps an aside chat's turn as well, so the take-over card finds a live chat to move the First Mate to.
    if (!writes && role === 'aside' && typeof input.session_id === 'string' && input.session_id !== '') {
      await within(() => helperTurnAt({ cwd: input.cwd, client, session: input.session_id }), waitMs);
    }
    if (role !== 'front-desk' || madeFeatureSlug(input.cwd) !== null) return undefined;
    const { project } = found;
    if (writes) attempt(() => refreshSeat(project, input.session_id));
    const at = clockOf(now);
    // What the visit's gap is made of (scripts/desk/visit.js) is read only where it is used: a hook that can't write keeps no
    // visit and gives no briefing on a gap, and a briefing is the one thing that asks for the survey's second look.
    const visitMod = () => import('../desk/visit.js');
    const gapOf = writes ? (await visitMod()).gapHours : null;
    const seen = readSeen(project, { now: at });
    const visits = attempt(() => readVisits(project, { now: at }), { visitAt: null, boardAsks: [] });
    const command = commandOf(input.prompt);
    // The gap runs from the director's last prompt or the last briefing given, whichever is later,
    // so a briefing /wheelhouse-digest gave counts as given: a prompt soon after it brings none.
    const due = writes && gapPassed(project, [seen.promptAt, seen.briefedAt].filter((t) => typeof t === 'string').sort().at(-1) ?? null, at, gapOf);
    const want = command?.watch ? null : command?.name ?? (due && writes ? 'briefing' : null);
    // A visit begins with the first prompt of any kind after a gap since the last one seen: the last
    // message, the last board command or the visit's own start.
    const lastSeen = [seen.promptAt, visits.visitAt, visits.boardAsks.at(-1)?.at].filter((t) => typeof t === 'string').sort().at(-1) ?? null;
    const visit = writes && gapPassed(project, lastSeen, at, gapOf) ? at : visits.visitAt;
    if (visit === at) attempt(() => markSeenHere(project, { visitAt: at }));
    if (command?.name === 'board' && !command.watch) attempt(() => markSeenHere(project, { boardAsk: { at, tab: command.tab ?? null, visit } }));
    if (!command && due && writes && !attempt(() => stopState().on, true)) {
      const asker = client ?? helperClient({ timeout: LEARN_WAIT_MS + helperGrace() });
      await within(async () => (await import('../desk/visit-learning.js')).visitLearning({ project, cwd: input.cwd, client: asker, at, boardAsks: visits.boardAsks }), learnWaitMs);
    }
    const desk = givenDesk ?? deskOf({ cwd: input.cwd, client, at });
    const sessionId = typeof input.session_id === 'string' ? input.session_id : null;
    // On an agent whose hooks can't write, no prompt time is kept here, so the helper keeps the session's last turn time and
    // the since line counts from it. With no helper there is none, and the hook writes nothing here.
    const turnAt = writes || sessionId === null ? null : await within(() => helperTurnAt({ cwd: input.cwd, client, session: sessionId }), waitMs);
    const sinceAt = writes ? seen.promptAt : turnAt ?? null;
    // A session's open.json is read once and cleared by this prompt, whatever comes of the lines.
    const open = sessionId === null ? null : attempt(() => readOpen(sessionId), null);
    if (writes && sessionId !== null) attempt(() => clearOpen(sessionId));
    // What the prompt hook makes of a reply (scripts/decisions/answer.js) it tells in its own context for this turn. Here the
    // reply is only read, under the same guards, to leave out the decision it answers.
    const typed = !writes || startedByScript(env) ? null : attempt(() => ownWords(input.prompt), null);
    // Every line the waiting view gives, from one read, each within its own wait: together they wait no longer than one does.
    const waiting = sharedWaiting(desk, { since: sinceAt, at });
    const [counted, decisionLine, stuck, helmNote, orphans, noted] = await waitingLines(waiting, { project, input, since: sinceAt, promptAt: seen.promptAt, at, open, typed, waitMs });
    const count = counted ?? 0;
    const cards = count > 0 ? cardsLine(count) : null;
    // The daily digest the watcher made waits for the director's next message and is shown once, here (scripts/digest/due.js). A hook that
    // only reads leaves it for one that can take it away.
    // A session a script started is no director arriving, so it never uses the digest up.
    const digest = writes && !startedByScript(env) ? attempt(() => readDigest(project), null) : null;
    const notes = [decisionLine, orphans, digest?.text ?? null, stuck, helmNote, ...(noted ?? [])].filter((line) => typeof line === 'string');
    const reserve = (cards === null ? 0 : cards.length + 2) + notes.reduce((sum, line) => sum + line.length + 2, 0);
    // A survey not worked out in time is left to the briefing view, which takes the record's latest.
    const survey = want === 'briefing' ? (await within(() => surveyOf({ project, client, desk }), learnWaitMs)) ?? undefined : null;
    // Offered once more, the survey's line about work in flight is said again, alone.
    const { earlierSurvey, offerAgainDue } = want === 'briefing' ? await visitMod() : {};
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
      if (built.raise.length > 0 && Number.isFinite(at.getTime())) {
        try {
          await markRaised(built.raise, { now: at });
        } catch {
          // Raised again at the next briefing.
        }
      }
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
