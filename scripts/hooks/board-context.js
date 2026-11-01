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
// Two kinds of prompt are left alone, recording no time and adding nothing: the mod's own commands
// (/wheelhouse-go, /wheelhouse-digest, /wheelhouse), whose answer starts no turn, so a briefing added to one would be
// lost (a classic hook isn't shown a mod command's typed line, so this is a second line of
// defence), and the courier's wake, which is not the director arriving: its line, which brings the wake's
// instructions as context (courierContext), or a prompt in the earlier form (LEADS.courier). A pane
// press (LEADS.pane) is the director's, as their press made it, and is handled like any prompt.
//
// A command is matched as typed, in any case, with white space around it ignored:
// /wheelhouse:logbook or /wheelhouse:board (optionally "build" or "director"), /wheelhouse:briefing,
// /wheelhouse:settings and /wheelhouse:sources. The short forms (/board) are left to whoever owns them.
import { answer, runAndExit, projectOf, beingSetUp } from './kit.js';
import { featureSlug, SETUP_FIRST } from './session-start.js';
import { briefingModel as realBriefingModel } from '../briefing/model.js';
import { readSeen, readSurveyAt, markSeen, readVisits } from '../briefing/seen.js';
import { markRaised as realMarkRaised } from '../usage/figures.js';
import { sessionRole, recordRole } from '../lib/role.js';
import { cardsLineFor } from '../agents/card-words.js';
import { existingCard } from '../cards/visit.js';
import { controlFilesDue, gateAsksDue, holdsDue, premiumFailuresDue } from '../cards/build-loop.js';
import { questionProblem } from '../cards/compose.js';
import { answerLine } from '../state/card-lines.js';
import { helperClient } from '../host/helper-client.js';
import { stopState } from '../lib/stop.js';
import { CARD } from '../lib/front-desk.js';
import { LEADS } from '../lib/mod-numbers.js';
import { courierContext } from '../mod/courier.js';
import { HELPER_WAIT_MS } from '../lib/core-numbers.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { HEADINGS, NOT_CHECKED, NONE_CHANGED, briefingIn, reviewOf } from '../desk/context.js';
import { deskClient, unreached } from '../desk/client.js';
import { gapHours, visitLearning, earlierSurvey, offerAgainDue, OFFER_AGAIN_MS } from '../desk/visit.js';

export { HEADINGS, NOT_CHECKED, NONE_CHANGED, briefingIn, reviewOf, OFFER_AGAIN_MS };
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
// The line that tells the front desk to ask the cards waiting, after the briefing, in Claude Code's words; an
// agent with words of its own gets its line from scripts/agents/card-words.js (ruling P5-54).
export const cardsLine = (n) => `Cards to ask this visit: ${n}. Run \`cli.js cards\` and ask them in one AskUserQuestion call, after the briefing.`;
const TABS = ['director', 'build'];
// The mod's own commands, whose answer starts no turn.
const MOD_COMMAND = /^\/(?:wheelhouse-go|wheelhouse-digest|wheelhouse)(?:[ \t]+.*)?$/i;

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

// Whether the prompt isn't the director arriving: one of the mod's commands, or the courier's wake.
function isOwnPrompt(prompt) {
  const text = prompt.replace(/\p{Cf}/gu, '').trim();
  return MOD_COMMAND.test(text) || text.startsWith(LEADS.courier);
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
  const fresh = new Set(waiting.filter((card) => card.asked === null || card.asked === undefined).map((card) => card.id));
  const questions = Object.entries(isRecord(views.questions) ? views.questions : {})
    .filter(([id, entry]) => isRecord(entry) && !entry.answer && existingCard({ waiting }, answerLine(id)) === null
      && questionProblem(entry.question?.data) === null).length;
  const gate = gateAsksDue(views, at);
  for (const due of gate) if (due.again !== undefined) fresh.add(due.again);
  const made = gate.filter((due) => due.make).length + holdsDue(views).length + controlFilesDue(views).length + premiumFailuresDue(views).length;
  return Math.min(CARD.questions, fresh.size + questions + made);
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
      briefingModel = realBriefingModel, markRaised: raiseMarked = realMarkRaised, writeVia = 'self', agent,
    } = deps;
    const writes = writeVia === 'self';
    const markSeenHere = writes ? markSeen : () => {};
    const markRaised = writes ? raiseMarked : () => {};
    if (!isRecord(input) || typeof input.cwd !== 'string' || typeof input.prompt !== 'string') return undefined;
    // While setup is unfinished here, setup comes first, whatever the prompt asks.
    const setup = featureSlug(input.cwd) === null && !isOwnPrompt(input.prompt) ? attempt(() => beingSetUp(input.cwd), null) : null;
    const found = projectOf(input.cwd, { dir });
    if (!found) return setup === null ? undefined : answer.context('UserPromptSubmit', SETUP_FIRST);
    const role = sessionRole({ sessionId: input.session_id, env, prompt: input.prompt, cwd: input.cwd });
    const first = writes ? attempt(() => recordRole(input.session_id, role), false) : false;
    // A foreman known only from its first prompt was pointed at the front desk by the session start.
    if (role === 'foreman' && first && env?.WHEELHOUSE_ROLE !== 'foreman') return answer.context('UserPromptSubmit', FOREMAN_LINE);
    if (setup !== null && role === 'front-desk') return answer.context('UserPromptSubmit', SETUP_FIRST);
    if (role !== 'front-desk' || featureSlug(input.cwd) !== null) return undefined;
    // The courier's line (design section 17.1): the director sees one plain line, and its instructions reach the front
    // desk here, as context, never in the chat.
    const woke = attempt(() => courierContext({ project: found.project, session: input.session_id, prompt: input.prompt, now }), null);
    if (woke !== null) return answer.context('UserPromptSubmit', woke);
    if (isOwnPrompt(input.prompt)) return undefined;
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
    const cards = count > 0
      ? (attempt(() => cardsLineFor(agent, { count, lean: found.lean === true, stop: stopState().on })) ?? cardsLine(count))
      : null;
    const reserve = cards === null ? 0 : cards.length + 2;
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
    const text = [cards, built?.text].filter((part) => typeof part === 'string').join('\n\n');
    return text === '' ? undefined : answer.context('UserPromptSubmit', text);
  } catch {
    return undefined;
  }
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'UserPromptSubmit' });
}
