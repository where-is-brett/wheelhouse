// scripts/engine/goal-start.js
// What a goal needs before the director leaves (unattended goals design, sections 4.2, 5 and 11): the spend the First Mate
// proposes, the checks before leaving, the sheet's one card, composed from the sheet and nothing else, whether the Mac is
// on battery, and the Away a start sets. All pure but `onBattery`; the helper gathers the facts.
import { execFileSync } from 'node:child_process';
import { dataHash } from '../state/events.js';
import { composeCard, isTooLong } from '../cards/compose.js';
import { SUGGEST, NOT_NOW } from '../lib/calm-words.js';
import { limitsFor } from './caps.js';
import { onNewEngine } from './lanes.js';
import { cardHash } from '../lib/measures-clicks.js';
import { START_GOAL_LINE } from '../state/card-lines.js';
import { demoSlice, readSlices } from './feature.js';
import { checkSheet, lastEnded, startProblem, unfinishedOf, sheetHash, isWaived } from './goal.js';
import { FAILED_IN_A_ROW, READING_FRESH_MINUTES, REDS_TO_STOP, SHARE_OF_WHAT_IS_LEFT } from './goal-limits.js';

// Check 93 saw paid usage bill only through a stand-in, and no real limit was reached, so an account that may spill is told
// on the sheet and not refused. Once a real spill is seen, this turns to true and such an account is refused until it is off.
export const PAID_USAGE_BILLS = false;
const FRESH_MS = READING_FRESH_MINUTES * 60000;
const BATTERY = /Now drawing from 'Battery Power'/;

const flat = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');
const nameOf = (views, work) => flat(views?.work?.[work]?.work?.data?.title) || work;
const bare = (text) => flat(text).replace(/[.!?]+$/, '');
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// A reading that can be used at `now`: a share read within READING_FRESH_MINUTES.
function freshShare(reading, now) {
  const at = typeof reading?.shareAt === 'string' ? Date.parse(reading.shareAt) : Number.NaN;
  return Number.isFinite(reading?.share) && Number.isFinite(at) && now.getTime() - at <= FRESH_MS ? reading.share : null;
}

// The tokens the sheet starts from for `work`: its lane's cap, and for a feature with `slicesOf(work)` slices, each slice's cap
// and its last run's, since a piece starts only if its cap still fits.
export function pieceTokens(work, { views, config, slicesOf }) {
  const lane = views?.work?.[work]?.work?.data?.lane;
  const slices = lane === 'feature' ? slicesOf(work) : null;
  return slices === null ? limitsFor(lane, config).tokens : (slices + 1) * limitsFor('slice', config).tokens;
}

// The spend the First Mate proposes: { spend: { tokens, points? }, says }. `tokens` is the sum of the pieces' caps, and `points`
// a third of what's left of the week, rounded down (decision 4), from a fresh reading.
export function proposedSpend({ tokens, reading, now }) {
  const share = freshShare(reading, now);
  if (share === null) return { spend: { tokens }, says: 'I can\'t read your allowance just now, so the goal is held by its tokens alone.' };
  const points = Math.floor((100 - share) * SHARE_OF_WHAT_IS_LEFT);
  if (points < 1) return { spend: { tokens }, says: 'There is next to nothing left of this week\'s allowance, so the goal is held by its tokens alone.' };
  return { spend: { tokens, points }, says: `Up to ${points} points, a third of what's left of this week's allowance.` };
}

// The pieces a draft sheet lists, each with the hash of its record: those `asked`, or with none, what the last goal left,
// which is a Carry on's new sheet. { pieces: [{ work, hash }], left: { goal, ending, sheet } | null }.
export function draftPieces({ asked, views }) {
  const line = (work) => ({ work, hash: dataHash(views.work[work].work.data) });
  for (const work of asked) if (views?.work?.[work]?.work?.data === undefined) throw new Error(`There is no work called ${work}: record it first`);
  if (asked.length > 0) return { pieces: asked.map(line), left: null };
  const last = lastEnded(views);
  const left = last === null ? [] : unfinishedOf(last, views).filter((work) => views?.work?.[work]?.work?.data !== undefined);
  return left.length === 0 ? { pieces: [], left: null } : { pieces: left.map(line), left: { goal: last.id, ending: last.ended.ending, sheet: last.sheet } };
}

// Whether the account may spill into paid usage, from Claude Code's own account file: true, false, or null when it can't be
// read. It is that program's private note (check 93), so it is a guide, not a promise.
export function paidUsageOf(account) {
  const on = account?.oauthAccount?.hasExtraUsageEnabled;
  return typeof on === 'boolean' ? on : null;
}

// What stands in the way of the goal `id` starting, and what the director should know. `refused` lines stop the card;
// `warns` go on it. A check that can't be read says so and doesn't refuse, so a project with no checks of its own can run a goal.
//   health: { engine: { ok, findings }, stop, mainGreen (true, false or null), mainHead (or null), testCommand, midpoints: [work] }
//   power: { battery } (true, false or null); sessions: the First Mate sessions ticking; reading: as `weeklyShare` gives it;
//   paid: `paidUsageOf`'s answer, false where the account isn't Claude's.
export function checksBeforeLeaving({ id, sheet, views, health, power, sessions, reading, paid, billable = PAID_USAGE_BILLS, now }) {
  const refused = [];
  const warns = [];
  const { engine, stop, mainGreen, mainHead, testCommand, midpoints = [] } = health;
  if (engine?.ok !== true) refused.push(`The build engine isn't well: ${engine?.findings?.[0] ?? 'its health couldn\'t be read'}.`);
  if (stop === true) refused.push('All stop is on.');
  if ((views.incidents?.open?.length ?? 0) > 0) refused.push('An incident is open.');
  if (mainGreen === false) refused.push('The main line is red.');
  if (typeof testCommand !== 'string' || testCommand.trim() === '') refused.push('This project has no test command known yet.');
  for (const { work } of sheet.pieces) {
    if (!onNewEngine(views, work, { now })) refused.push(`${nameOf(views, work)} is in a lane the build engine doesn't take on this project.`);
    else if (views.work[work].work.data.lane === 'feature' && views.work[work].approved !== true) refused.push(`The design of ${nameOf(views, work)} isn't approved yet.`);
  }
  if (sheet.areas.may.length === 0) refused.push('The sheet\'s May touch is empty, so no piece could change anything.');

  const hash = sheetHash(sheet);
  const problem = startProblem({ id, hash, sheet, goals: views.goals, work: views.work, goalChecks: views.goalChecks, now });
  if (problem !== null) refused.push(`${problem}.`);
  const baseline = (views.goalChecks?.[id] ?? []).filter((c) => c.when === 'before' && c.hash === hash).at(-1);
  if (baseline !== undefined && typeof mainHead === 'string' && baseline.head !== mainHead) refused.push('The main line has moved since the goal\'s checks ran, so they need running again.');

  if (paid === true && billable) refused.push('This account has paid usage on, and at a limit that would bill you: turn it off first.');
  else if (paid !== false) warns.push('If this account has paid usage on, a limit may bill you and not pause, and I can\'t see it happen.');
  if (mainGreen === null) warns.push('I couldn\'t read the main line\'s checks.');
  if (power?.battery === true) warns.push('The Mac is on battery, so it may sleep.');
  if (sessions === 0) warns.push('No First Mate is left open, so no phone alerts and no stop from the phone.');
  const waiting = (views.waiting ?? []).filter((c) => c?.data?.kind !== 'start-goal').length;
  if (waiting > 0) warns.push(`${plural(waiting, 'card')} still ${waiting === 1 ? 'waits' : 'wait'} on you, which could hold up a piece.`);
  for (const work of midpoints) warns.push(`${nameOf(views, work)} stops half way for its demo, and that part waits for you.`);
  const share = freshShare(reading, now);
  if (share !== null && Number.isFinite(sheet.spend.points) && sheet.spend.points > 100 - share) warns.push('Less of the week\'s allowance is left than the goal may spend.');
  return { refused, warns };
}

function tokensInWords(tokens) {
  if (tokens < 1000000) return `${tokens.toLocaleString('en-AU')} tokens`;
  return `${Math.round(tokens / 100000) / 10} million tokens`;
}

function spendLine({ tokens, points, requests }) {
  const bounds = [
    ...(points === undefined ? [] : [`${points} points of this week's allowance`]),
    ...(requests === undefined ? [] : [plural(requests, 'request')]),
    tokensInWords(tokens),
  ];
  return bounds.length === 1 ? `Spend: up to ${bounds[0]}.` : `Spend: up to ${bounds.slice(0, -1).join(', ')} or ${bounds.at(-1)}, whichever comes first.`;
}

// A time as the director reads it, on this computer's clock: "6:00 PM", with its day when it isn't today.
function clockOf(instant, now, timeZone) {
  const at = new Date(instant);
  const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(at).replace(/\s/g, ' ');
  const day = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone }).format(d);
  return day(at) === day(now) ? clock : `${clock} on ${day(at)}`;
}

function stopLine(stopEarly) {
  const failed = stopEarly?.failedInARow ?? FAILED_IN_A_ROW;
  const reds = stopEarly?.reds ?? REDS_TO_STOP;
  const pieces = failed === 1 ? 'a piece fails' : `${failed === 2 ? SMALL[2] : failed} pieces fail in a row`;
  const red = reds === 1 ? 'once' : reds === 2 ? 'twice' : `${reds} times`;
  return `It stops early if: ${pieces}, or the main line goes red ${red}.`;
}

// What proves each piece, for a sheet that says, pages too: a line on the card, or nothing.
function pieceChecksLine(sheet, views, named) {
  const proven = sheet.pieces.filter((line) => line.done?.length > 0);
  if (proven.length === 0) return [];
  const said = (check) => (Object.hasOwn(check, 'page') ? `${check.page} shows "${check.mustShow}"` : check.test ?? check.command);
  const name = (line) => (named === 'titles' ? nameOf(views, line.work) : line.work);
  return [`Each piece proves itself: ${proven.map((line) => `${name(line)}: ${line.done.map(said).join(', ')}`).join('; ')}.`];
}

// How the card names the work: `named` is `titles`, `ids` or `count`.
function workLine(sheet, views, named) {
  const ids = sheet.pieces.map((p) => p.work);
  const list = named === 'titles' ? ids.map((work) => nameOf(views, work)) : ids;
  const many = ids.length > 1 ? `${ids.length} pieces` : 'one piece';
  const shown = sheet.pieces.filter((line) => {
    const data = views?.work?.[line.work]?.work?.data;
    return data?.visible === true && !isWaived(line, data);
  }).length;
  const seen = shown === 0 ? '' : ` You see ${shown === 1 ? '1 of them before it goes in' : `${shown} of them before they go in`}.`;
  const waived = sheet.pieces.filter((line) => {
    const data = views?.work?.[line.work]?.work?.data;
    return data !== undefined && isWaived(line, data);
  }).map((line) => (named === 'titles' ? nameOf(views, line.work) : line.work));
  const unseen = waived.length === 0 ? '' : ` Not shown to you first: ${waived.join(' · ')}.`;
  return `The work: ${named === 'count' ? many : `${many}: ${list.join(' · ')}`}.${seen}${unseen}`;
}

// The composer's input for the sheet's card, every word of it from the sheet (section 5). `warns` are the checks' warnings.
// `revises` is the id of the waiting card of this goal it replaces. `named` says how the work is named.
export function sheetCardInput({ id, sheet, views, warns, now, timeZone, revises, named = 'titles' }) {
  const stops = clockOf(sheet.until, now, timeZone);
  const lines = [
    `Goal: ${id}.`,
    `Done means: ${sheet.checksSay.map(bare).join('; ')}.`,
    workLine(sheet, views, named),
    ...pieceChecksLine(sheet, views, named),
    `May touch: ${sheet.areas.may.join(', ')}.`,
    `Won't touch: ${sheet.areas.wontTouch.join(', ')}.`,
    spendLine(sheet.spend),
    `Time: stops starting work at ${stops}.`,
    'If it has a question: that piece waits and the rest goes on.',
    stopLine(sheet.stopEarly),
    'Ready to leave? The Mac is plugged in, its lid is open, and the First Mate stays open for your phone.',
    ...(warns.length === 0 ? [] : [`Check first: ${warns.join(' ')}`]),
  ];
  return {
    kind: 'start-goal',
    level: 3,
    ask: `Start this goal: ${bare(sheet.title)}?`,
    what: lines.join('\n'),
    why: `The goal ${id} runs on its own while you're away, inside these bounds, so only you can start it.`,
    options: [
      { label: 'Start', says: `It starts now, and carries on without you until ${stops}.` },
      { label: SUGGEST, says: 'Tell me what to change; I\'ll check a new sheet and come back with it.' },
      { label: NOT_NOW, says: 'Nothing starts, and this waits for you.' },
    ],
    recommend: 'Start',
    because: 'at least one of its checks fails today, so passing them will mean something',
    meanwhile: 'Nothing starts until you click Start, and other work carries on.',
    target: { goal: id, hash: sheetHash(sheet) },
    ...(revises === undefined ? {} : { revises, changed: 'The goal\'s sheet.' }),
  };
}

// The sheet's card, its work named as fully as a card can carry. Throws, in words the First Mate can act on, when none fits.
export function composeSheetCard(args) {
  for (const named of ['titles', 'ids', 'count']) {
    try {
      return composeCard(sheetCardInput({ ...args, named }));
    } catch (error) {
      if (!isTooLong(error)) throw error;
    }
  }
  throw new Error('The sheet is too long for its card: make its check lines and areas shorter');
}

// What the helper does for the First Mate's sheet, from the facts it hands in, so a route is a line:
//   views()      the project's views, with `engineOn`; events() its records
//   health()     the engine's { ok, findings }; config() its checks' settings, with `testCommand`; settings() the project's, for the
//                lanes' caps; designOf(work) an approved design, { text }, or null
//   mainGreen(), mainHead(), stopped(), reading(), paid(), sessions(), battery() as `checksBeforeLeaving` takes them
//   offer(kind, data) keeps a record the helper signs and resolves with its id
export function sheetDesk({ views, events, health, config, settings, designOf, mainGreen, mainHead, stopped, reading, paid, sessions, battery = onBattery, offer, now, timeZone }) {
  const designs = (work) => {
    try {
      const text = designOf(work)?.text;
      return typeof text === 'string' ? readSlices(text) : null;
    } catch {
      return null;
    }
  };
  const safely = async (ask, otherwise) => {
    try {
      return await ask();
    } catch {
      return otherwise;
    }
  };

  // The pieces a sheet may list, each with its record's hash, and the spend to propose for them.
  async function draft({ pieces }) {
    const held = views();
    const { pieces: lines, left } = draftPieces({ asked: pieces, views: held });
    const slicesOf = (work) => designs(work)?.slices?.length ?? null;
    const tokens = lines.reduce((sum, { work }) => sum + pieceTokens(work, { views: held, config: settings() ?? {}, slicesOf }), 0);
    return { ok: true, pieces: lines, ...(left === null ? {} : { left }), ...(lines.length === 0 ? {} : proposedSpend({ tokens, reading: reading(), now: now() })) };
  }

  // The latest sheet of `goal` and its checks before leaving, or a refusal, or `waiting` for a baseline.
  async function leaving(goal) {
    const held = views();
    const sheet = events().filter((e) => e.kind === 'goal' && e.data?.id === goal).at(-1)?.data.sheet;
    if (sheet === undefined) return { ok: false, refused: `There is no sheet for the goal ${goal}` };
    const shape = checkSheet(sheet, { now: now() });
    if (shape !== null) return { ok: false, refused: shape };
    const hash = sheetHash(sheet);
    const baseline = (held.goalChecks?.[goal] ?? []).filter((c) => c.when === 'before' && c.hash === hash).at(-1);
    if (baseline === undefined) return { waiting: true };
    const results = baseline.said === undefined ? baseline.results : baseline.said;
    const at = now();
    const midpoints = sheet.pieces.map((p) => p.work).filter((work) => {
      const design = held.work?.[work]?.work?.data?.lane === 'feature' ? designs(work) : null;
      return design !== null && demoSlice(design) !== null;
    });
    const { refused, warns } = checksBeforeLeaving({
      id: goal, sheet, views: held, now: at,
      health: {
        engine: await safely(health, { ok: false, findings: [] }), stop: stopped(), midpoints, testCommand: (config() ?? {}).testCommand ?? null,
        mainGreen: await safely(mainGreen, null), mainHead: await safely(mainHead, null),
      },
      power: { battery: battery() }, sessions: sessions(), reading: reading(), paid: paid(),
    });
    return { held, sheet, hash, at, results, refused, warns };
  }

  // The checks again as the director clicks Start, since a card can wait: what stops it now.
  async function recheck({ goal, hash }) {
    const got = await leaving(goal);
    if (got.ok === false) return got;
    if (got.waiting === true || got.hash !== hash) return { ok: true, refused: ['The goal\'s sheet has changed since this card was made.'] };
    return { ok: true, refused: got.refused };
  }

  // The sheet's checks and their results, then what refuses it or the card itself.
  async function card({ goal }) {
    const got = await leaving(goal);
    if (got.ok === false || got.waiting === true) return got.waiting === true ? { ok: true, offered: false, waiting: true } : got;
    const { held, sheet, hash, at, results, refused, warns } = got;
    if (refused.length > 0) return { ok: true, offered: false, refused, results };
    const others = (held.waiting ?? []).filter((c) => c?.data?.kind === 'start-goal' && START_GOAL_LINE.exec(String(c.data.line))?.[1] === goal);
    const last = others.at(-1);
    const args = { id: goal, sheet, views: held, warns, now: at, timeZone };
    let plain;
    let revised;
    try {
      plain = composeSheetCard(args);
      revised = last === undefined ? plain : composeSheetCard({ ...args, revises: last.id });
    } catch (error) {
      return { ok: true, offered: false, refused: [`${error.message}.`], results };
    }
    // The card already waiting, where nothing on it has changed; otherwise a new one in its place.
    const same = [plain, revised].find((c) => c.question.question === last?.data?.question);
    const { question } = same ?? revised;
    const id = same === undefined ? await offer('card', revised.card) : last.id;
    await offer('goal-card', { goal, sheet: hash, at: at.toISOString(), hash: cardHash(question) });
    return { ok: true, offered: true, question, id, warns, results };
  }

  return { draft, card, recheck };
}

// Whether the Mac is on battery, from `pmset -g batt`: true, false, or null where that can't be said.
export function onBattery({ platform = process.platform, run = () => execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8', timeout: 5000 }) } = {}) {
  if (platform !== 'darwin') return null;
  try {
    return BATTERY.test(run());
  } catch {
    return null;
  }
}

// The Away a goal's start sets, as a setting, or null: Do not disturb stands, and so does an Away in force, nearer or not,
// since a later end still covers the goal and an Away is the director's own to shorten (section 11).
export function awayForGoal({ presence, until, now }) {
  const ends = typeof presence?.until === 'string' ? Date.parse(presence.until) : Number.NaN;
  const over = Number.isFinite(ends) && ends <= now.getTime();
  if (['away', 'dnd'].includes(presence?.value) && !over) return null;
  return { key: 'presence', value: 'away', until };
}
