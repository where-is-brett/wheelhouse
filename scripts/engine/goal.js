// scripts/engine/goal.js
// The unattended goal's rules (unattended goals design, sections 4 to 6), pure: what a sheet must hold, how a sheet may
// be narrowed, how the state's records become `views.goals`, and what a goal lets start. Nothing here reads a file or a clock.
//
//   Sheet = { title, done: [Check], checksSay: [text], pieces: [{ work, hash, waived? }], areas: { may, wontTouch },
//             checkFiles: [path], spend: { tokens, points?, requests? }, until, stopEarly?: { failedInARow, reds } }
//   Check = { test } | { command, expect }           (the order's checks, without a page: scripts/engine/order.js)
// `hash` on a piece is the hash of that work's record (dataHash of its data), so a piece that changed is not covered.
// `until` is an ISO instant. The sheet's own hash (`sheetHash`) covers every key it holds, known or not, so a key a later
// part adds needs no second kind of signature.
//
// A `goal` record alone does nothing. A goal is in force only when a verified `start-goal` action names its id and the
// hash of its sheet (scripts/state/events.js); a later record of the same id signs nothing and changes nothing.
import { dataHash } from '../state/events.js';
import { matchGlob } from '../gate/glob.js';
import { SLUG } from '../lib/build-loop.js';
import { checkProblem } from './order.js';
import { endedBy } from '../foreman/queue.js';
import { MAX_PIECES, MAX_HOURS } from './goal-limits.js';

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const texts = (x) => Array.isArray(x) && x.every(isText);
const isCount = (x) => Number.isInteger(x) && x >= 1;
const isAmount = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const instant = (x) => (typeof x === 'string' ? Date.parse(x) : Number.NaN);
const HOUR = 3600000;
const FIX_LANE = 'fix-main';
// The ways back an answer of the director's makes: the director is back, so these aren't held once a goal has ended.
const ANSWERED = Object.freeze(['rework', 'more', 'try-again', 'build-again', 'carry', 'answer']);
// The lanes small enough for the sheet's tick to waive showing a piece first. A feature has its own switch-on.
const WAIVABLE = Object.freeze(['quick', 'small']);

// The hash of the whole sheet, unknown keys included: what the director's click signs.
export function sheetHash(sheet) {
  return dataHash(sheet);
}

// Why `sheet` can't be a goal at `now` (a Date), in a plain sentence, or null. Keys it doesn't know pass.
export function checkSheet(sheet, { now } = {}) {
  if (!isObject(sheet)) return 'A goal\'s sheet must be a record.';
  if (!isText(sheet.title)) return 'A goal needs a title.';

  const { done } = sheet;
  if (!Array.isArray(done) || done.length === 0) return 'A goal needs at least one done check.';
  for (const check of done) {
    if (isObject(check) && Object.hasOwn(check, 'page')) return 'A goal\'s checks are tests or commands, not a page: a page belongs to its piece.';
    const problem = checkProblem(check);
    if (problem) return `${problem.charAt(0).toUpperCase()}${problem.slice(1)}.`;
  }
  if (!Array.isArray(sheet.checksSay) || sheet.checksSay.length !== done.length || !texts(sheet.checksSay)) {
    return 'A goal says in a line what each of its checks proves, one line for each check.';
  }

  const { pieces } = sheet;
  if (!Array.isArray(pieces) || pieces.length < 1 || pieces.length > MAX_PIECES) return `A goal lists from 1 to ${MAX_PIECES} pieces of work.`;
  const seen = new Set();
  for (const piece of pieces) {
    const shaped = isObject(piece) && typeof piece.work === 'string' && SLUG.test(piece.work) && isText(piece.hash)
      && (piece.waived === undefined || typeof piece.waived === 'boolean');
    if (!shaped) return 'Each piece of a goal names its work, as a short slug, and the hash of that work\'s record.';
    if (seen.has(piece.work)) return `The piece ${piece.work} is listed twice.`;
    seen.add(piece.work);
  }

  const { areas } = sheet;
  if (!isObject(areas) || !texts(areas.may) || !texts(areas.wontTouch)) return 'A goal\'s areas are two lists of paths, what it may touch and what it won\'t.';

  const checkFiles = sheet.checkFiles ?? [];
  if (!texts(checkFiles)) return 'A goal\'s check files are a list of paths.';
  if (done.some((check) => Object.hasOwn(check, 'test')) && checkFiles.length === 0) return 'A goal with a test check lists the check file the test is in.';
  for (const file of checkFiles) {
    if (!areas.wontTouch.some((pattern) => matchGlob(pattern, file))) return `The check file ${file} is not under Won't touch, so a run could change it.`;
  }

  const { spend } = sheet;
  if (!isObject(spend) || !isCount(spend.tokens)) return 'A goal\'s spend needs a limit on tokens, a whole number above zero.';
  for (const key of ['points', 'requests']) {
    if (spend[key] !== undefined && !isAmount(spend[key])) return `A goal's spend on ${key} is a number above zero.`;
  }

  const until = instant(sheet.until);
  if (Number.isNaN(until)) return 'A goal needs `until`, the time it stops starting work.';
  if (until <= now.getTime()) return 'A goal\'s `until` must be later than now.';
  if (until - now.getTime() > MAX_HOURS * HOUR) return `A goal's \`until\` is at most ${MAX_HOURS} hours ahead.`;

  if (sheet.stopEarly !== undefined) {
    const stop = sheet.stopEarly;
    if (!isObject(stop) || (stop.failedInARow !== undefined && !isCount(stop.failedInARow)) || (stop.reds !== undefined && !isCount(stop.reds))) {
      return 'What makes a goal stop early is a number of pieces failing in a row and a number of reds, each a whole number above zero.';
    }
  }
  return null;
}

// The sheet `change` makes, or null when `change` does anything but narrow it. A change is a plain record holding
// only `until`, `spend`, `areas` or `pieces`; one thing that widens refuses the whole change. The sheet isn't changed.
export function narrowed(sheet, change) {
  if (!isObject(sheet) || !isObject(change)) return null;
  const keys = Object.keys(change);
  if (keys.length === 0 || keys.some((k) => !['until', 'spend', 'areas', 'pieces'].includes(k))) return null;
  const next = structuredClone(sheet);

  if (keys.includes('until')) {
    const was = instant(sheet.until);
    const to = instant(change.until);
    if (Number.isNaN(was) || Number.isNaN(to) || to >= was) return null;
    next.until = change.until;
  }

  if (keys.includes('spend')) {
    const spend = change.spend;
    if (!isObject(spend) || Object.keys(spend).length === 0 || Object.keys(spend).some((k) => !['tokens', 'points', 'requests'].includes(k))) return null;
    next.spend = { ...(isObject(sheet.spend) ? sheet.spend : {}) };
    for (const [key, value] of Object.entries(spend)) {
      if (!isAmount(value) || (key === 'tokens' && !Number.isInteger(value))) return null;
      if (next.spend[key] !== undefined && value > next.spend[key]) return null;
      next.spend[key] = value;
    }
  }

  if (keys.includes('areas')) {
    const areas = change.areas;
    const held = isObject(sheet.areas) ? sheet.areas : null;
    if (!isObject(areas) || held === null || Object.keys(areas).length === 0 || Object.keys(areas).some((k) => !['may', 'wontTouch'].includes(k))) return null;
    next.areas = { ...held };
    if (areas.may !== undefined) {
      if (!texts(areas.may) || !texts(held.may) || !areas.may.every((x) => held.may.includes(x))) return null;
      next.areas.may = [...areas.may];
    }
    if (areas.wontTouch !== undefined) {
      if (!texts(areas.wontTouch) || !texts(held.wontTouch) || !held.wontTouch.every((x) => areas.wontTouch.includes(x))) return null;
      next.areas.wontTouch = [...areas.wontTouch];
    }
  }

  if (keys.includes('pieces')) {
    const ids = change.pieces;
    if (!Array.isArray(ids) || ids.length === 0 || !Array.isArray(sheet.pieces)) return null;
    const listed = new Set(sheet.pieces.map((p) => p.work));
    if (!ids.every((id) => typeof id === 'string' && listed.has(id))) return null;
    next.pieces = sheet.pieces.filter((p) => ids.includes(p.work)).map((p) => structuredClone(p));
  }
  return next;
}

// Why the goal `id`, whose sheet is `sheet` and signed hash `hash`, can't start now, in a plain sentence, or null. `goals` is
// the goals view so far, `work` is shaped as `views.work`, `now` a Date. Later checks (a baseline that holds, a must-pass
// list) join here, so every way of starting a goal asks them: the view, the desk's act and the click itself.
export function startProblem({ id, hash, sheet, goals, work, stopped = false, now }) {
  if (stopped) return 'All stop is on';
  const held = isObject(goals) ? goals : {};
  for (const [other, goal] of Object.entries(held)) {
    if (goal.ended === null || Date.parse(goal.ended.at) > now.getTime()) return `The goal ${other} is running, and only one goal runs at a time`;
  }
  if (Object.hasOwn(held, id)) return `The goal ${id} was started before, so it isn't started again`;
  const problem = checkSheet(sheet, { now });
  if (problem !== null) return problem;
  const entry = { hash, sheet };
  for (const piece of sheet.pieces) {
    if (!pieceCovered(entry, piece.work, { work })) return `The work ${piece.work} changed since the goal's sheet was made, so the goal wasn't started`;
  }
  return null;
}

// The goal in force, from the views: the entry of `views.goals` that hasn't ended, or null.
export function goalInForce(views) {
  const goals = isObject(views?.goals) ? views.goals : {};
  for (const [id, goal] of Object.entries(goals)) {
    if (goal.ended === null) return { id, hash: goal.hash, sheet: goal.sheet, state: 'running', startedAt: goal.startedAt, until: goal.sheet.until };
  }
  return null;
}

// Whether `goal` (an entry with its sheet) covers `work`: the sheet lists it, and its work record is the one the sheet's
// line was made from. A piece with no work record isn't covered.
export function pieceCovered(goal, work, views) {
  const line = goal?.sheet?.pieces?.find((p) => p.work === work);
  const data = views?.work?.[work]?.work?.data;
  return line !== undefined && data !== undefined && dataHash(data) === line.hash;
}

// The goals of `views`, newest ending last, that have ended.
function endedGoals(views) {
  const goals = isObject(views?.goals) ? views.goals : {};
  return Object.entries(goals).filter(([, goal]) => goal.ended !== null).sort(([, a], [, b]) => Date.parse(a.ended.at) - Date.parse(b.ended.at));
}

// What a goal says of starts at `now` (a Date), for `dispatch` and `gateStart`, or null when none says anything.
//   In force: { id, pieces, only: true, startsStopped, until, state }. `pieces` are those still covered, in the sheet's order;
//   `startsStopped` says `until` has passed, so its pieces hold too.
//   After its end, until a new sheet: { id, pieces, only: false, startsStopped: true }, `pieces` being what is unfinished.
export function goalRule(views, now) {
  const live = goalInForce(views);
  if (live !== null) {
    const pieces = live.sheet.pieces.map((p) => p.work).filter((work) => pieceCovered(live, work, views));
    return { id: live.id, pieces, only: true, startsStopped: now.getTime() >= Date.parse(live.until), until: live.until, state: live.state };
  }
  const last = endedGoals(views).at(-1);
  if (last === undefined) return null;
  const [id, goal] = last;
  const unfinished = goal.sheet.pieces.map((p) => p.work).filter((work) => {
    const report = views?.reports?.[work];
    return report?.data?.outcome !== 'merged' && !endedBy(views?.reports, work, views?.work?.[work]?.work);
  });
  return unfinished.length === 0 ? null : { id, pieces: unfinished, only: false, startsStopped: true };
}

// The one gate every start passes (unattended goals design, section 6): null, or { goalHeld: true, goal, why }, `why` being
// `goal` (not this goal's work), `time`, `winding-down`, `spend` or `goal-ended`. `goal` is `goalRule`'s answer; `via` the way
// the start came, `start` for a first one; `state` the goal's state; `meter` the spend meter's reading, where there is one, and
// `cap` the tokens a run of `lane` may spend, which must still fit. The fix lane is held by a spend reached alone: a red main
// line must be mended. After the end only the goal's own pieces hold, and an answer of the director's goes on as ordinary work.
export function gateStart({ goal, work, lane, via, state = 'running', meter = null, cap = 0, now }) {
  if (!isObject(goal)) return null;
  const held = (why) => ({ goalHeld: true, goal: goal.id, why });
  if (goal.only !== true) return goal.pieces.includes(work) && !ANSWERED.includes(via) ? held('goal-ended') : null;
  if (lane !== FIX_LANE) {
    if (!goal.pieces.includes(work)) return held('goal');
    if (state !== 'running') return held('winding-down');
    if (now.getTime() >= Date.parse(goal.until)) return held('time');
    if (meter?.left < cap) return held('spend');
  }
  return typeof meter?.reached === 'string' ? held('spend') : null;
}

// What an order of `work` takes from its goal: { goalId?, waived? }. The goal is the one covering the piece, in force or the
// latest to end, whose areas still govern its pull request. `waived` is the sheet's tick, honoured only on a small visible
// piece, and only while the goal is in force: after it, the piece is ordinary work.
export function orderGoal(views, work) {
  const live = goalInForce(views);
  if (live !== null && pieceCovered(live, work, views)) {
    const data = views.work[work].work.data;
    const line = live.sheet.pieces.find((p) => p.work === work);
    return { goalId: live.id, ...(line.waived === true && data.visible === true && WAIVABLE.includes(data.lane) ? { waived: true } : {}) };
  }
  const ended = endedGoals(views).reverse().find(([, goal]) => pieceCovered(goal, work, views));
  return ended === undefined ? {} : { goalId: ended[0] };
}

// `views.goals`: { [id]: { sheet, hash, startedAt, ended, endAsked } }, from `sorted` (the events in order) and `starts`
// (the verified start-goal actions in order). Only a signed goal appears.
//   sheet: the signed sheet less what the notes narrowed. hash: the signed hash. ended: { ending, at, spent, words? } from
//   the first goal-end (the helper's own record), or null. endAsked: { at, now } from end-goal notes, or null.
export function goalsView(sorted, starts) {
  const goals = {};
  for (const start of starts) {
    const id = start.data?.goal;
    if (typeof id !== 'string' || Object.hasOwn(goals, id)) continue;
    // Any record of the id whose sheet has the signed hash: the latest isn't assumed, so a later record can't unsign it.
    const record = sorted.find((e) => e.kind === 'goal' && e.data?.id === id && isObject(e.data.sheet) && sheetHash(e.data.sheet) === start.data.hash);
    if (record === undefined) continue;
    const startedAt = Date.parse(start.at);
    // The work as it stood at the signature: a piece changed before it keeps the goal out, one changed after doesn't unsign it.
    const work = {};
    for (const e of sorted) {
      if (e.kind === 'work' && typeof e.data?.id === 'string' && Date.parse(e.at) <= startedAt) work[e.data.id] = { work: { data: e.data } };
    }
    if (startProblem({ id, hash: start.data.hash, sheet: record.data.sheet, goals, work, now: new Date(start.at) }) !== null) continue;

    const endRecord = sorted.find((e) => e.kind === 'goal-end' && e.data?.goal === id);
    const ended = endRecord === undefined ? null : {
      ending: endRecord.data.ending, at: endRecord.data.at, spent: endRecord.data.spent,
      ...(endRecord.data.words !== undefined ? { words: endRecord.data.words } : {}),
    };
    let sheet = structuredClone(record.data.sheet);
    let endAsked = null;
    for (const e of sorted) {
      if (e.kind !== 'note' || e.data?.goal !== id) continue;
      const when = Date.parse(e.at);
      if (when < startedAt || (ended !== null && when > Date.parse(ended.at))) continue;
      if (e.data.about === 'narrow-goal') {
        sheet = narrowed(sheet, e.data.change) ?? sheet;
      } else if (e.data.about === 'end-goal') {
        const now = e.data.now === true;
        if (endAsked === null || (now && !endAsked.now)) endAsked = { at: e.at, now };
      }
    }
    goals[id] = { sheet, hash: start.data.hash, startedAt: start.at, ended, endAsked };
  }
  return goals;
}
