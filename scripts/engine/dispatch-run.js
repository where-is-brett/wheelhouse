// scripts/engine/dispatch-run.js
// The dispatcher's runner, in the helper: reads the record's views, asks `dispatch` what to start, and starts it
// through the helper's own start (no route starts a run). Each piece gets its work order, with the project's caps and
// the work's decision level; the merge queue is started from here too, one run at a time, and a queue run Archon's own
// ruling step started counts as that run: the helper folds its start into it. A queue that stays unable to start brings
// one card. Work held because it would use the plan's counted requests brings one card for each hold. New work whose
// start is refused keeps its turn, is tried once more after a while, and then brings one card. A red main line's incident
// comes first each tick (section 7.7, fix-main.js): one fix run for it, the incident closed once the main line reads green,
// and one card when a fix didn't make it green or can't start. A feature runs its slices one after another (feature.js): each next one
// starts once the slice before has merged, and the feature's own run once every slice has. A feature held up with
// nothing to move it on (a pull request closed unmerged, a run rejected or cancelled with no card of its own) brings one
// card; Stop here ends it with a `closed` report, which frees its place. A run that failed is resumed at 5, 15 and 30
// minutes where its kind allows (recovery.js), through the same list as an answered piece, and the fix lane by its own
// `fixDecision`. A run that lost its process carries on once on its branch, by the same list, or for a fix by the same
// decision; the runner gives the word that the run has gone (`lostCleared`). Past those, or for any other kind, or cancelled in the engine, a piece outside a feature gets one card; a
// feature keeps its own, after the retries too. Other work whose run's pull request merged gets its `merged` report. A piece waiting on the director keeps its files reserved: what it was expected to touch and
// what its branch has changed, read each time it parks, until its work merges or ends or the runner says it has. What
// it keeps (the merge queue's run and when it last started, the pull requests already seen ready, the clashes, the
// fixes, the reservations, the work on its way back) is in `file`. Every way back asks for a place in one list (delegated
// decisions design, section 8.3): an entry stays on `returning` until `dispatch` admits it, and on `admitted`, holding its
// place, until its run is seen running. The runner wakes a paused run once admitted; a new run is started from here. A
// start is marked before it is called, so one that timed out or a crash during it is settled before anything starts again.
// While a goal runs, every start passes one gate (goal.js): one held there keeps its place on the list with `heldBy` and
// raises no card, until the gate lets it by. A retry the gate would hold isn't kept for it, and comes to its card.
import fs from 'node:fs';
import path from 'node:path';
import { dispatch, MERGE_WORK, MERGE_QUEUE_EVERY_MS } from './dispatcher.js';
import { goalRule, goalInForce, gateStart, goalDoneOf, orderGoal, areasOf, fixAreas } from './goal.js';
import { goalMeter, shareAtStart } from './goal-meter.js';
import { goalHeldWords, reservedUnreadWords, LIMIT_HOLD_WORDS, noCardBehindWords, restartRefusedWords, restartCardWords, restartUnsureWords, restartStrandedWords, failedCardWords, prLeftOpenWords, areasInScopeWords, areaCardWords, AREA_CARD_WHY, ALLOW_ONCE_SAYS, areaStoppedWords, wakeLateWords, STOPPED_RESTART_WORDS, ORPHAN_LEFT_WORDS, RESTART_UNSURE_AGAIN, START_ANYWAY, cutOffStoppedWords, cutOffWords, waitsOnItselfWords, startAnywayWords, startRefusedWords, startCardWords, unmarkedPrWords, START_STOP_SAYS, NO_FIX_TESTS, NO_FIX_ORDER, noFixWords, queueStuckWords, QUEUE_STUCK_WHY, QUEUE_PASSED_WORDS, requestsUsedWords, REQUESTS_UNCONFIRMED_WORDS, requestsStoppedWords } from './words.js';
import { workOrder, ORDER_LANES } from './order.js';
import { limitsFor } from './caps.js';
import { ENGINE_QUESTIONS } from './router.js';
import { openRedMain, fixDecision, fixOrder } from './fix-main.js';
import { readSlices, featureProgress, featureNext, currentStep, sliceOrder, finishOrder, featureCap, demoSlice } from './feature.js';
import { ownWaiting, ownCards, limitedRuns, limitedWork } from './waiting.js';
import { topCard, holdsUpCount, noCardBehind, deadEnds, waitsOnItself } from './stuck.js';
import { STOP_LABEL, MORE } from './runner.js';
import { OWNER_LOST, retryDue, resumeRun, triedList } from './recovery.js';
import { since, endedBy } from '../foreman/queue.js';
import { areaAnswer, areaQuestion, ALLOW_ONCE } from './areas.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const EMPTY = () => ({ areas: {}, allowed: {}, mergeRun: null, mergeRuns: [], lastStart: null, seenReady: [], queueDue: false, sentBack: {}, acted: {}, clashAsked: {}, reds: {}, redActed: {}, redAsked: {}, redNoted: {}, requestsAsked: null, requestsFor: null, queueFault: null, unmarkedSeen: {}, noTestsSaid: false, fixes: {}, features: {}, shipped: {}, closedPrs: [], reserved: {}, released: {}, stranded: {}, topCard: null, noCardSaid: {}, quietSeen: {}, owed: {}, cutOffAsked: {}, cutOffFor: {}, waived: {}, returning: [], admitted: [], carryOver: {}, restartCards: 0, limitSaid: false, goalSpend: null, goalQueueRuns: [] });
// The dispatcher's own questions take numbers from here, apart from the card router's.
const OWN_QUESTIONS = ENGINE_QUESTIONS + 90000;
export { MERGE_WORK };
const KEPT_MERGE_RUNS = 20;
export const TRY_AGAIN = 'Try again';
export const LEAVE_IT = 'Leave it';
export const KEEP_OFF = 'Keep it off';
export const ALLOW_SOME = 'Allow some';
export const FIX_FORWARD = 'Fix it forward';
export const LEAVE_RED = 'Leave it';
export const undoLabel = (pr) => `Undo #${pr}`;
export const KEEP_GOING = 'Keep going';
export const STOP_HERE = 'Stop here';
// The feature cap card's numbers, after the fix cards'.
const FEATURE_QUESTIONS = OWN_QUESTIONS + 7000;
export const FEATURE_DONE = 'Switched on, with every slice added.';
export const BUILD_AGAIN = 'Build it again';
// The cards for a feature held up with nothing to move it on, after the cap cards'.
const STALL_QUESTIONS = FEATURE_QUESTIONS + 500;
export const FEATURE_STOPPED = 'Stopped before it was switched on; the slices already added stay behind their switch.';
// The cards for a piece that couldn't start again, after the stall cards'.
const RESTART_QUESTIONS = STALL_QUESTIONS + 500;
// What wakes a paused run or resumes a failed one, which the runner carries out once admitted. Every other `via` starts a
// new run from here.
const WAKES = Object.freeze(['answer', 'resume', 'more', 'retry']);
// The ways back that carry on a piece's own branch after an answer or a lost process.
const REWORKING = Object.freeze(['answer', 'rework', 'carry-on']);
// What an entry's run may read as for it to give its entry up. `unknown` is a run the engine no longer has, with nothing to wait for.
const SEEN = Object.freeze(['running', 'ended', 'unknown']);
// How long an answered run may sit paused before the Logbook says so: only the engine's waker carries it on (check 85).
export const WAKE_LATE_MS = 5 * 60 * 1000;
// How long new work waits between a refused start and its one more try: a fault that passes costs no card, and one that
// stays costs no start every tick.
export const REFUSED_RETRY_MS = 5 * 60 * 1000;
// How long a merge queue that can't start gets to clear by itself: one of its own beats, the longest a ready pull request
// waits for it when all is well, so the director hears of nothing that costs more than an ordinary wait.
export const QUEUE_FAULT_MS = MERGE_QUEUE_EVERY_MS;
// The summary of the report for quick, small and bug work whose pull request merged.
export const MERGED_WORDS = 'Added to the main line.';
// On every merge while a project's tests aren't counting (ruling 2): it rests on review and the work's own done checks.
export const NOT_COUNTING_WORDS = 'Tests aren\'t counting yet';
export const CLOSED_WORDS = 'Its pull request was closed without being added.';
// The fix card's numbers, after the clash cards' and the requests card's.
const FIX_QUESTIONS = OWN_QUESTIONS + 5000;
// The second-red cards' numbers, after the clash cards'.
const RED_QUESTIONS = OWN_QUESTIONS + 3000;
// The cards for a red main line no fix can start for, after the fix cards'.
const NO_FIX_QUESTIONS = FIX_QUESTIONS + 1000;
export const STARTED_FIX_WORDS = 'The main line is red, so Wheelhouse started fixing it; other work waits until it is green.';
export const GREEN_WORDS = 'The main line is green again, so held work goes on.';
const WHY_FIX = {
  failed: 'The fix for the red main line stopped without adding a fix.',
  cancelled: 'The fix for the red main line was stopped before it added a fix (it reached its cap, or was cancelled).',
  'still-red': 'A fix was added, but the main line\'s checks are still red.',
};

function readState(file) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isPlain(kept) ? { ...EMPTY(), ...kept } : EMPTY();
  } catch {
    return EMPTY();
  }
}

// Whether work can start: it needs a command to tell when it is done, unless the project's tests aren't counting yet.
const canTest = (config) => isText(config?.testCommand) || config?.testsNotCounting === true;

// The Logbook's line when no work can start because Wheelhouse can't run the project's tests.
export const NO_TESTS_WORDS = 'Build work waits: Wheelhouse doesn\'t know how to run this project\'s tests, so it couldn\'t tell when a change is done. Setup can add the command.';

// The words of the card for work held for the plan's counted requests, when the engine gives none of its own.
export const REQUESTS_WORDS = 'Some work would use your AI plan\'s counted requests, and the cap on them is 0, so that work waits until you allow some.';

// The order for one piece of work from its record: the title is its goal; the done checks are the record's own, or
// the project's tests passing when it has none. `config` is { routing (the pack's bindings), testCommand, pages? };
// `answers` the director's answers to the work's earlier questions, from the helper's own record; `goal` what its goal
// gives the order (`orderGoal`).
export function orderFor(entry, { settings = {}, raised = false, config = {}, answers = [], tried = [], goal = {} } = {}) {
  const data = entry.work.data;
  const done = Array.isArray(data.done) && data.done.length > 0 ? data.done : config.testsNotCounting === true ? [] : [{ command: config.testCommand, expect: 0 }];
  return workOrder({
    work: { id: data.id ?? entry.work.key, lane: data.lane, goal: data.goal ?? data.title, done, visible: data.visible === true, level: data.level, notInScope: data.notInScope ?? [], protectedFiles: data.protectedFiles ?? [] },
    config,
    routing: config.routing ?? {},
    caps: limitsFor(data.lane, settings, { raised }),
    answers,
    extra: { ...(tried.length > 0 ? { tried } : {}), ...(goal.goalId !== undefined ? { goalId: goal.goalId } : {}), ...(goal.waived === true ? { showFirst: false } : {}) },
  });
}

// dispatchRun({ engine, project, folder, file, readViews, settings, stopped, now, start, write, readyOf, mainGreen,
//   stoppedRuns, fixedRuns, prMerged, designOf, orderOf, repoOf, queueFolder, queuePlace, openedBy, onCard }) -> { tick, workOf, sentBack(work, reason, tail), queueDue, enter, admittedTo, delivered, drop, startAdmitted, onStarted, carryOver, ... }.
// - `start({ project, order, branch?, carryOn? })` the helper's own start; `readyOf()` the pull requests marked ready,
//   { [pr]: { work, head } }; `settings()` the project's settings in force; `write(kind, data)` a record;
// - `mainGreen()` whether the main line's checks read green: true, false, or null when they can't be read (or are
//   still running); `stoppedRuns()` the runs All stop cancelled; `fixedRuns()` the runs whose fix the helper added;
// - `prMerged(pr)` whether the host says a pull request merged (null when it can't say); `designOf(work)` the work's
//   approved design, { text } or { problem } (or null when it names none); `orderOf(runId)` the order a run was given;
// - `prState(pr)` what the host says of a pull request, 'merged', 'open' or 'closed' (null when it can't say); without
//   it, `prMerged` gives merged or open; `repoOf()` the repository the merge queue merges in, { host, path }, or null;
//   `repoName()` that repository as a hand-over names it.
// - `openedBy(runId)` the pull request the helper's record says a run opened, or null: an engine that doesn't say so
//   at a run's end (Archon) is read through it, for records already written without one (check 81);
// - `queueFolder()` the folder the merge queue runs in, Wheelhouse's own and never the project's (check 81):
//   { ok, folder } or { ok: false, refused }; the queue doesn't start without it. `queuePlace()` that folder's path,
//   touching nothing, for asking the engine what is live there.
// - `localQueue()` one sweep of the local queue, for a project with no host, which has no merge queue to start. It runs on
//   every tick while a change waits, since its own table says what is ready. `isLocal()` says whether the project still has
//   no host, and `moving()` whether a move to a host is under way, which holds new work as All stop does.
// - `branchPaths({ runId, branch })` every path a run's branch has changed so far, or null when it can't be read.
// - `notReady(pr)` takes a pull request off what `readyOf` lists: the director sent it back, so only its rework marks it again.
// - `areasHeld()` the pull requests a goal's areas hold back, { [pr]: { head, runId, showFirst, work, paths, fix? } }; and
//   `settleAreas(pr, how)` lets go of one: 'ready' marks it ready, and 'stop', 'fix' and 'gone' only take it off the list.
// - `engine.liveRunOf({ work, since })`, where the engine has it, says of a start that may have happened: { runId },
//   null for none, undefined when it can't say. Without it the answer is undefined, so a card comes and not a second start.
export function dispatchRun({ engine, project, folder, file, readViews, settings = () => ({}), stopped: allStop = () => false, moving = () => false, now = () => new Date(), start, write = async () => {}, readyOf = () => ({}), config = () => ({}), spentThisMonth = () => 0, mainGreen = async () => null, stoppedRuns = () => [], fixedRuns = () => [], prMerged = async () => null, prState = null, designOf = () => null, orderOf = () => null, repoOf = () => null, repoName = () => null, queueFolder = async () => ({ ok: false, refused: 'no folder for the merge queue' }), queuePlace = null, openedBy = () => null, localQueue = null, isLocal = () => true, onCard = () => {}, branchPaths = async () => [], notReady = () => {}, areasHeld = () => ({}), settleAreas = () => {}, allowance = () => null } = {}) {
  const stopped = () => allStop() || moving();
  let state = readState(file);
  // The pieces with a card of the card router's open, from the runner, which is built after this.
  let routerPieces = () => new Set();
  let parkedPrs = () => ({});
  // The pieces with a cap card of the card router's still to be written.
  let routerOwed = () => new Set();
  const waitingNow = (views) => {
    const pieces = new Set(ownWaiting({ state, views }));
    try { for (const work of routerPieces()) pieces.add(work); } catch { /* it reads as none, so each keeps its place */ }
    return pieces;
  };
  // The pieces whose run an answer is ending, to start again on the same branch: the runner's.
  let reworkingNow = () => [];
  // What the runner is doing about runs that lost their process: { pieces, clearing, carried }.
  let lostNow = () => ({});
  const lostPieces = () => lostNow()?.pieces ?? [];
  let routerCardsNow = () => [];
  const cardsNow = (views) => {
    let theirs = [];
    try { theirs = routerCardsNow(); } catch { /* it reads as none, so a hold shows as having no card */ }
    return [...ownCards({ state, views }), ...theirs];
  };
  // A question of the dispatcher's own, and then a word to the seals, whose trouble is never the card's. Owed until it is
  // written, so a record that refuses it costs a tick and never the card (`owedTick`).
  async function askDirector(kind, data) {
    state.owed[data.id] = { kind, data };
    keep();
    await write('question', data);
    delete state.owed[data.id];
    keep();
    try { onCard({ id: data.id, kind, work: data.work, level: data.level }); } catch { /* it costs a seal, never a card */ }
  }
  async function owedTick() {
    const views = readViews() ?? {};
    if (!isPlain(views.questions)) return;
    for (const [id, { kind, data }] of Object.entries(state.owed)) {
      if (isPlain(views.questions[id])) {
        delete state.owed[id];
        keep();
      } else await askDirector(kind, data).catch(() => {});
    }
  }
  // Whole or not at all, since the way back rests on what is here after a crash.
  const keep = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  };
  // Told when a run on the way back starts, with what it carries.
  let carriedBy = () => {};

  async function stateOf(pr) {
    try {
      if (typeof prState === 'function') return await prState(pr);
      const merged = await prMerged(pr);
      return merged === true ? 'merged' : merged === false ? 'open' : null;
    } catch {
      return null;
    }
  }

  async function mergeQueueStatus() {
    if (!state.mergeRun) return null;
    try {
      return (await engine.inspect(state.mergeRun))?.status ?? null;
    } catch {
      return null;
    }
  }
  const queueHolds = (status) => status === 'running' || status === 'paused';
  async function mergeQueueRunning() {
    return queueHolds(await mergeQueueStatus());
  }

  // The end of a red check's output, as data for the run that goes back: kept by the helper, never by the run.
  const withTail = (order, checkTail) => (isText(checkTail) ? { ...order, checkTail } : order);
  // One Logbook line for a red that couldn't go back, however many ticks it takes.
  async function redRefused(work, got) {
    const times = state.reds[work]?.times;
    if (state.redNoted[work] === times) return;
    state.redNoted[work] = times;
    keep();
    await write('note', { about: 'engine', words: `${work} failed its tests and couldn't go back to be mended yet: ${got?.refused ?? 'no answer'}. It is tried again shortly.` });
  }

  // The gate at the start of a run of `work`, read now: null, or what holds it.
  function goalGate(views, { work, lane, via }) {
    const goal = goalRule(views, now());
    return gateStart({ goal, work, lane, via, state: goal?.state, meter: meterOf(goal), cap: capOf(lane).tokens, now: now() });
  }
  const capOf = (lane) => limitsFor(lane, settings() ?? {});
  // The meter's reading for `goal`, kept so a restart holds what it held: none for a goal it hasn't read.
  const meterOf = (goal) => (state.goalSpend !== null && state.goalSpend.goal === goal?.id ? state.goalSpend.meter : null);
  // `goalRule`'s answer as `dispatch` takes it: while a goal runs, the lanes its spend leaves no room for, so that a piece held
  // by spend spends no place and one that fits can start.
  function goalNow(views) {
    const goal = goalRule(views, now());
    const meter = meterOf(goal);
    if (goal?.only !== true || meter === null) return goal;
    return { ...goal, spendHolds: ORDER_LANES.filter((lane) => typeof meter.reached === 'string' || meter.left < capOf(lane).tokens) };
  }
  // A queue run that has ended spends no more, and a goal may run many: each is read until then.
  const queueRead = new Map();
  async function readForMeter(runId) {
    if (queueRead.has(runId)) return queueRead.get(runId);
    const record = await engine.inspect(runId);
    if (record?.status === 'ended' && state.goalQueueRuns.includes(runId)) queueRead.set(runId, record);
    return record;
  }
  // Reads the goal's spend, ahead of every start of the tick, and keeps it beside what it was at Start. The share at Start
  // is taken from the first reading fresh at Start; counted requests start from the month's count when the goal is first seen.
  async function meterTick(views) {
    const goal = goalInForce(views);
    if (goal === null) return;
    if (state.goalSpend?.goal !== goal.id) {
      state.goalSpend = { goal: goal.id, shareAtStart: null, requestsAtStart: null, meter: null };
      state.goalQueueRuns = [];
      queueRead.clear();
    }
    const kept = state.goalSpend;
    let reading = null;
    try { reading = allowance(); } catch { /* the tokens stand alone */ }
    kept.shareAtStart ??= shareAtStart(reading, goal);
    let used = null;
    try { if (engine.countsRequests?.(config()?.routing ?? {}) === true) used = await spentThisMonth(); } catch { /* the tokens still count */ }
    if (used !== null) kept.requestsAtStart ??= used;
    // A count below the one at Start is a new month's, or the provider's correction: it counts from there.
    if (used !== null && used < kept.requestsAtStart) kept.requestsAtStart = 0;
    const requests = used === null ? null : used - kept.requestsAtStart;
    kept.meter = await goalMeter({ goal, views, inspect: readForMeter, queueRuns: state.goalQueueRuns, capOf, reading, shareAtStart: kept.shareAtStart, requests, now: now() });
    keep();
  }

  async function startPiece({ work, lane, via = 'start', branch = null, carryOn = false, raised = false, answers = [], checkTail = null }) {
    const views = readViews() ?? {};
    const entry = views.work?.[work];
    if (!isPlain(entry?.work?.data)) return { ok: false, refused: 'there is no such work', gone: true };
    const held = goalGate(views, { work, lane, via });
    if (held) return { ok: false, ...held };
    if (!canTest(config())) return { ok: false, refused: 'Wheelhouse doesn\'t know how to run the project\'s tests' };
    if (entry.work.data.lane === 'feature') return startFeature({ views, entry, work, lane, branch, carryOn, raised, answers, checkTail });
    let order;
    try { order = orderFor({ ...entry, work: { ...entry.work, key: work } }, { settings: settings() ?? {}, raised, config: config() ?? {}, answers, tried: carryOn ? triedBefore(views, work) : [], goal: orderGoal(views, work) }); } catch (error) { return { ok: false, refused: error.message }; }
    if (order.lane !== lane) return { ok: false, refused: 'the work\'s lane changed' };
    return start({ project, order: withAreas(withTail(order, checkTail), views), ...(branch ? { branch } : {}), carryOn });
  }

  // An order with the areas of the goal its piece belongs to, in the guard's terms and in the run's words.
  function withAreas(order, views) {
    const areas = areasOf(views, order.work);
    return areas === null ? order : { ...order, areas, notInScope: [...order.notInScope, areasInScopeWords(areas)] };
  }

  // What this piece's earlier runs failed at, for a fresh run on its branch. An order that can't be read costs only its checks.
  function triedBefore(views, work) {
    const read = (runId) => { try { return orderOf(runId); } catch { return null; } };
    return triedList({ runs: views.runs?.[work] ?? [], orderOf: read });
  }

  // A feature's approved design read into its slices, or { refused }, said on the Logbook once for each problem.
  async function designFor(work, entry) {
    const kept = (state.features[work] ??= { merged: {}, started: [], said: null, asked: null, raised: false, reported: false });
    // Queued again (the First Mate's Carry on): the merges seen stay; the starts, the cap's card and its answer are
    // those of the new queueing.
    const queued = entry?.work?.at ?? null;
    if (kept.queued !== queued) {
      Object.assign(kept, { queued, started: [], asked: null, raised: false, reported: false, ended: false, stalls: {}, carry: null, cards: (kept.cards ?? 0) + (kept.asked ? 1 : 0) });
      keep();
    }
    let design = null;
    let problem = null;
    const got = designOf(work);
    if (!got) problem = 'names no document';
    else if (got.problem) problem = got.problem;
    else {
      try { design = readSlices(got.text); } catch (error) { problem = `can't be built from: ${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}`; }
    }
    if (design) return { design, kept };
    if (kept.said !== problem) {
      kept.said = problem;
      keep();
      await write('note', { about: 'engine', words: `${entry.work.data.title ?? work} waits: its approved design ${problem}, so it needs approving again.` });
    }
    return { refused: `the feature's design ${problem}`, said: true };
  }
  // The feature's progress from its runs (what merged from all of them, what has run from those since it was queued),
  // the orders the helper kept and the merges seen.
  // A work's run records, each naming the pull request its run opened where the engine's record didn't.
  const runsOfWork = (views, work) => (views.runs?.[work] ?? []).map((r) => {
    if (Number.isInteger(r?.data?.pr) || typeof r?.data?.runId !== 'string') return r;
    const pr = openedBy(r.data.runId);
    return Number.isInteger(pr) ? { ...r, data: { ...r.data, pr } } : r;
  });
  function progressFor(views, work, entry, kept, design) {
    const all = runsOfWork(views, work);
    const now = all.filter((r) => since(r, entry.work));
    return featureProgress({ design, all, now, orderOf, merged: new Map(Object.entries(kept.merged).map(([pr, head]) => [Number(pr), head])) });
  }
  // Starts the feature's next run: slice 1 from the dispatcher, a later slice or its own run from featureTick, or the
  // run under way again on a carry-on (Give it more, or an answer), on its branch.
  async function startFeature({ views, entry, work, lane, branch, carryOn, raised, answers, checkTail }) {
    if (!['feature', 'slice'].includes(lane)) return { ok: false, refused: 'the work\'s lane changed' };
    const found = await designFor(work, entry);
    if (found.refused) return { ok: false, refused: found.refused, said: found.said };
    const { design, kept } = found;
    // Past the feature's cap, nothing more starts without the director's say, however the start came.
    const s = settings() ?? {};
    const spent = (views.costs?.[work] ?? []).reduce((n, c) => n + (Number.isFinite(c?.data?.tokens) ? c.data.tokens : 0), 0);
    if (spent >= featureCap(design, s, { raised: kept.raised }) && !(await featureCapAnswered(views, work, entry, kept, spent, design, s))) {
      // A carry-on held here (Build it again, Give it more, a rework) goes on once the director says Keep going.
      if (carryOn) {
        kept.carry = { branch: branch ?? null };
        keep();
      }
      return { ok: false, refused: 'the feature has used the tokens set aside for it', capped: true };
    }
    const progress = progressFor(views, work, entry, kept, design);
    let step = currentStep({ design, progress });
    if (!carryOn) {
      const next = featureNext({ design, progress, live: false });
      if (next.act !== 'start') return { ok: false, refused: 'the feature has nothing to start now', gone: true };
      step = next;
      // A slice that ran before the work was queued again (the First Mate's Carry on) carries on from its branch.
      const before = step.slice ? progress.slices[step.slice]?.branch : null;
      if (before) {
        branch = before;
        carryOn = true;
      }
    }
    let order;
    const args = { entry: { ...entry, work: { ...entry.work, key: work } }, design, config: config() ?? {}, settings: settings() ?? {}, raised, answers, tried: carryOn ? triedBefore(views, work) : [], goalId: orderGoal(views, work).goalId };
    try { order = step.finish ? finishOrder({ ...args, progress, goalDone: goalDoneOf(views, work) }) : sliceOrder({ ...args, n: step.slice }); } catch (error) { return { ok: false, refused: error.message }; }
    const got = await start({ project, order: withAreas(withTail(order, checkTail), views), ...(branch ? { branch } : {}), carryOn });
    if (got?.ok && typeof got.runId === 'string') {
      kept.started.push(got.runId);
      keep();
    }
    return got;
  }

  // Each feature under way: the merges of its runs' pull requests, a line for each slice added, its next run once the
  // one before merged, one card when its spend reaches the feature's cap, and its report once it is switched on.
  async function featureTick() {
    const views = readViews() ?? {};
    const s = settings() ?? {};
    const lanes = Array.isArray(s.engineLanes) ? s.engineLanes : ['quick'];
    if (!lanes.includes('feature')) return;
    const reports = isPlain(views.reports) ? views.reports : {};
    for (const [work, entry] of Object.entries(isPlain(views.work) ? views.work : {})) {
      if (entry?.work?.data?.lane !== 'feature' || endedBy(reports, work, entry.work)) continue;
      const runs = (views.runs?.[work] ?? []).filter((r) => since(r, entry.work));
      if (runs.length === 0) continue;
      const found = await designFor(work, entry);
      if (found.refused) continue;
      const { design, kept } = found;
      // A start the record doesn't show yet is still under way.
      const recorded = new Set(runs.map((r) => r?.data?.runId));
      if (kept.started.some((runId) => !recorded.has(runId))) continue;
      const ready = readyOf() ?? {};
      // A pull request seen closed isn't asked about again.
      kept.closed ??= {};
      for (const pr of new Set(runsOfWork(views, work).map((r) => r?.data?.pr).filter((pr) => Number.isInteger(pr) && !Object.hasOwn(kept.merged, pr) && !kept.closed[pr]))) {
        const got = await stateOf(pr);
        if (got === 'closed') {
          kept.closed[pr] = true;
          keep();
        }
        if (got !== 'merged') continue;
        kept.merged[pr] = typeof ready[pr]?.head === 'string' ? ready[pr].head : null;
        keep();
        const n = progressFor(views, work, entry, kept, design);
        const slice = Object.entries(n.slices).find(([, got]) => got.pr === pr);
        if (slice) await write('note', { about: 'engine', words: `Slice ${slice[0]} of ${design.slices.length} of ${entry.work.data.title ?? work} is added, behind its switch.` });
      }
      const progress = progressFor(views, work, entry, kept, design);
      const latest = new Map(runs.map((r) => [r.data.runId, r.data]));
      const live = [...latest.values()].some((r) => r.state !== 'ended');
      const next = featureNext({ design, progress, live });
      if (next.act === 'done') {
        // Written before it is marked, so a write that fails is tried again on the next tick.
        if (!kept.reported) {
          await write('report', { work, outcome: 'merged', pr: next.pr, summary: FEATURE_DONE, rulings: [] });
          kept.reported = true;
          keep();
        }
        continue;
      }
      // A stall card's Stop here, though a newer run has started since: that run ends first, and nothing more of it starts.
      const stall = Object.values(kept.stalls ?? {}).find((held) => !held.done && views.questions?.[held.id]?.answer?.label === STOP_HERE);
      if (stall) {
        if (await windDown(work, [...latest.values()].filter((r) => r.state !== 'ended'))) {
          await endFeature(work, kept, stoppedHereWords(entry.work.data.title ?? work));
          stall.done = true;
          keep();
        }
        continue;
      }
      // The cap card's answer, whatever start it held: Stop here ends the feature; Keep going carries on a held carry-on.
      const capLabel = kept.asked ? views.questions?.[kept.asked]?.answer?.label : null;
      if (!live && capLabel === STOP_HERE) {
        await endFeature(work, kept, stoppedHereWords(entry.work.data.title ?? work));
        continue;
      }
      // On its way back already: what comes next is settled once that run has started.
      if (onTheWay(work) || lostPieces().includes(work)) continue;
      if (!live && capLabel === KEEP_GOING && kept.carry && !stopped() && (views.incidents?.open?.length ?? 0) === 0) {
        const { branch } = kept.carry;
        kept.carry = null;
        enter({ work, lane: 'feature', via: 'carry', key: `carry:${kept.asked}`, branch, carryOn: true });
        continue;
      }
      if (!live && next.act === 'wait') {
        await heldUp({ views, work, entry, kept, design, progress });
        continue;
      }
      if (next.act !== 'start' || stopped() || (views.incidents?.open?.length ?? 0) > 0 || waitingNow(views).has(work)) continue;
      enter({ work, lane: 'feature', via: 'slice', key: `slice:${next.finish ? 'finish' : next.slice}:${kept.queued}` });
    }
  }
  // The feature's cap card: asked once; Keep going raises the cap by half, once. Gives whether the next run may start.
  async function featureCapAnswered(views, work, entry, kept, spent, design, s) {
    const title = entry.work.data.title ?? work;
    if (kept.asked) {
      const label = views.questions?.[kept.asked]?.answer?.label;
      if (label === KEEP_GOING && !kept.raised) {
        kept.raised = true;
        keep();
      }
      if (label === STOP_HERE) await endFeature(work, kept, stoppedHereWords(title));
      // endFeature writes its report once a queueing, so a write that fails is tried again on the next tick.
      if (kept.raised && spent >= featureCap(design, s, { raised: true })) {
        await endFeature(work, kept, `${title} has stopped: it has used its raised cap too, so its next slice doesn't start. The First Mate's Carry on asks you again.`);
      }
      return kept.raised && spent < featureCap(design, s, { raised: true });
    }
    kept.asked = `q-${work}-${FEATURE_QUESTIONS + (kept.cards ?? 0)}`;
    keep();
    await askDirector('cap', {
      id: kept.asked, work, level: 3,
      what: `${title} has used the tokens set aside for the whole feature, so its next slice waits.`,
      why: 'Spending more on a feature than was set aside for it is yours to decide, at level 3.',
      options: [
        { label: KEEP_GOING, says: 'The next slice starts, with the feature\'s cap raised by half, once.' },
        { label: STOP_HERE, says: 'Nothing more starts; the slices already added stay, behind their switch.' },
      ],
      recommendation: STOP_HERE,
    });
    return false;
  }

  // Ends a feature before its switch-on: a `closed` report, which frees its place in the feature lane, and `words` on the
  // Logbook. Once for each queueing.
  async function endFeature(work, kept, words, summary = FEATURE_STOPPED) {
    if (kept.ended) return;
    await write('report', { work, outcome: 'closed', summary, rulings: [] });
    kept.ended = true;
    keep();
    await write('note', { about: 'engine', words });
  }

  const stoppedHereWords = (title) => `${title} stops here, as you chose: the slices already added stay behind their switch, and the feature's place is free for other work. The First Mate's Carry on takes it up again.`;

  // What is left of a stopped feature: its way back given up and each run going cancelled. Whether nothing is left, for
  // the next tick to ask again; a start still in hand settles first.
  async function windDown(work, going) {
    const entries = [...state.returning, ...state.admitted].filter((e) => e.work === work);
    if (entries.some((e) => e.starting)) return false;
    for (const entry of entries) leave(entry);
    for (const run of going) {
      try { await engine.act(run.runId, { cancel: { reason: 'the director stopped the feature' } }); } catch { /* asked again on the next tick */ }
    }
    return going.length === 0;
  }

  // A feature whose current step's latest run ended and nothing moves it on: its pull request was closed unmerged, the
  // run was cancelled (a rejected demo or switch-on, or a cancel in the engine itself) with no card of its own and not by
  // All stop, it failed with no pull request the merge queue has, or it finished with no pull request at all. One card for that run; Build it again carries
  // the step on from its branch, Stop here ends the feature.
  async function heldUp({ views, work, entry, kept, design, progress }) {
    const step = currentStep({ design, progress });
    const runs = step.finish ? progress.finish?.runs ?? [] : progress.slices?.[step.slice]?.runs ?? [];
    const run = runs.at(-1);
    if (run?.state !== 'ended' || typeof run.runId !== 'string') return;
    kept.stalls ??= {};
    const title = entry.work.data.title ?? work;
    const held = kept.stalls[run.runId];
    if (held) {
      const label = views.questions?.[held.id]?.answer?.label;
      if (held.done || typeof label !== 'string') return;
      if (label === STOP_HERE) {
        await endFeature(work, kept, stoppedHereWords(title));
        held.done = true;
        keep();
      } else if (label === BUILD_AGAIN && !stopped() && (views.incidents?.open?.length ?? 0) === 0) {
        held.done = true;
        const branch = step.finish ? run.branch ?? null : progress.slices[step.slice]?.branch ?? run.branch ?? null;
        enter({ work, lane: 'feature', via: 'build-again', key: `build-again:${run.runId}`, branch, carryOn: true });
      }
      return;
    }
    if (stopped() || cardOwed(work)) return;
    const what = step.finish ? 'its switch-on run' : `slice ${step.slice} of ${design.slices.length}`;
    let why = null;
    // Its Carry on may be about to take this up: looked at again on the next tick.
    if (run.outcome === 'cancelled' && lostAnswered(views, run.runId) && kept.endSeen !== run.runId) {
      kept.endSeen = run.runId;
      keep();
      return;
    }
    if (Number.isInteger(run.pr) && kept.closed?.[run.pr]) why = 'closed';
    else if (run.outcome === 'cancelled' && !(stoppedRuns() ?? []).includes(run.runId) && !namedByCard(views, run.runId, run.outcome)) why = 'cancelled';
    else if ((run.outcome === 'failed' ? !(readyOf() ?? {})[run.pr] && !retryFor(views, work) : run.outcome === 'completed' && !Number.isInteger(run.pr)) && !namedByCard(views, run.runId, run.outcome) && !waitingNow(views).has(work) && !onTheWay(work) && state.sentBack[work] === state.acted[work] && state.reds[work]?.times === state.redActed[work]) {
      if (Number.isInteger(run.pr) && await stateOf(run.pr) !== 'open') return;
      // Looked at again on the next tick: the runner may yet have an answer that starts it again.
      if (kept.endSeen !== run.runId) {
        kept.endSeen = run.runId;
        keep();
        return;
      }
      why = run.outcome === 'failed' ? 'failed' : 'no-pr';
    }
    if (!why) return;
    kept.stallCards = (kept.stallCards ?? 0) + 1;
    const id = `q-${work}-${STALL_QUESTIONS + kept.stallCards}`;
    kept.stalls[run.runId] = { id, done: false };
    keep();
    const demo = !step.finish && demoSlice(design) === step.slice;
    const happened = why === 'closed'
      ? `Pull request #${run.pr} for ${what} of ${title} was closed without being added, so the feature waits.`
      : why === 'failed'
        ? `The run building ${what} of ${title} failed before it was added, so the feature waits.`
      : why === 'no-pr'
        ? `The run building ${what} of ${title} finished with no pull request, so nothing of it can be added and the feature waits.`
      : step.finish
        ? `${title}'s switch-on wasn't approved, so the feature stays off and waits.`
        : demo
          ? `The midpoint demo of ${title} (${what}) wasn't approved, so the feature waits.`
          : `The run building ${what} of ${title} was stopped before it was added, so the feature waits.`;
    const stillOpen = why !== 'closed' && Number.isInteger(run.pr);
    const options = [
      { label: BUILD_AGAIN, says: `It builds ${what} again from its branch${stillOpen ? '' : ', with a new pull request'}${step.finish || demo ? ', and shows it to you again' : ''}.` },
      { label: STOP_HERE, says: `The feature ends here; the slices already added stay behind their switch, and its place is free for other work.${stillOpen ? ` ${prLeftOpenWords(run.pr)}` : ''}` },
    ];
    await askDirector('stall', {
      id, work, level: 3,
      what: `${happened} Nothing more of it starts until you say.`,
      why: 'Whether a feature goes on when one of its steps can\'t be added is yours to decide, at level 3.',
      options,
      recommendation: why === 'closed' ? STOP_HERE : BUILD_AGAIN,
    });
  }
  // Whether a card already speaks for this run's end: the runner's cap card for it, or a question about it still
  // waiting for the director. A question answered earlier in the run doesn't, nor does a Give it more on a run that then
  // failed (`outcome`): it went on from that, so its ending is a new one.
  function namedByCard(views, runId, outcome) {
    return Object.values(isPlain(views.questions) ? views.questions : {}).some((q) => {
      const engineRef = q?.question?.data?.engine;
      // A piece that left its bundle has no card to speak for it.
      return engineRef?.runId === runId && q.gone !== true && ((engineRef.ask === `cap:${runId}` && !(outcome === 'failed' && q.answer?.label === MORE)) || !isPlain(q.answer) || lostStop(q, runId));
    });
  }
  // The director's Stop on the card for a run that lost its process, and that card's other answer, which the runner hasn't
  // taken up on this tick yet.
  const lostStop = (q, runId) => q?.question?.data?.engine?.ask === `${runId}:${OWNER_LOST}` && q.answer?.label === STOP_LABEL;
  const lostAnswered = (views, runId) => Object.values(isPlain(views.questions) ? views.questions : {}).some((q) => q?.question?.data?.engine?.ask === `${runId}:${OWNER_LOST}` && isPlain(q.answer));
  // A run the director stopped, by Stop at its cap or by letting its piece go.
  function stoppedByDirector(views, work, runId) {
    if (Object.hasOwn(state.released, work) && state.released[work] === runId) return true;
    return Object.values(isPlain(views.questions) ? views.questions : {}).some((q) => q?.question?.data?.engine?.ask === `cap:${runId}` && q.answer?.label === STOP_LABEL);
  }

  // The latest run of a piece since it was queued: its latest record's fields with `records`, all of that run's, or null.
  function latestRun(views, work) {
    const current = views.work?.[work]?.work;
    if (!isPlain(current)) return null;
    const byRun = new Map();
    for (const r of runsOfWork(views, work)) if (isPlain(r?.data) && since(r, current)) (byRun.get(r.data.runId) ?? byRun.set(r.data.runId, []).get(r.data.runId)).push(r);
    const records = [...byRun.values()].at(-1);
    return records ? { ...records.at(-1).data, records } : null;
  }
  // The same, while its work hasn't ended.
  function runOfOpenWork(views, work) {
    const reports = isPlain(views.reports) ? views.reports : {};
    const current = views.work?.[work]?.work;
    return !isPlain(current) || reports[work]?.data?.outcome === 'merged' || endedBy(reports, work, current) ? null : latestRun(views, work);
  }
  // The try a piece's failed run still has, as `retryDue` gives it, with the run, or null: its failure allows one, and it is
  // still the piece's to take. What only delays a try (a card, the merge queue) doesn't count here, so the piece stays held. A
  // retry is a start, so one the goal's gate would hold is no try to come: the piece goes to its card, and the runner resumes nothing.
  function retryFor(views, work) {
    const run = runOfOpenWork(views, work);
    const due = run ? retryDue({ records: run.records, now: now() }) : null;
    if (!due || (stoppedRuns() ?? []).includes(run.runId) || stoppedByDirector(views, work, run.runId) || leftByDirector(views, work) || goalGate(views, { work, lane: run.lane, via: 'retry' })) return null;
    return { ...due, run };
  }
  // Every piece with a try to come, or one on its way. Its files stay held, and nothing raises a card over it.
  function retryingWork(views) {
    const pieces = new Set([...state.returning, ...state.admitted].filter((e) => e.via === 'retry').map((e) => e.work));
    for (const work of Object.keys(isPlain(views.work) ? views.work : {})) if (retryFor(views, work)) pieces.add(work);
    return pieces;
  }

  // Each failed run due a try asks for a place, in the list every way back uses, so no retry passes pace. Nothing asks under
  // All stop, an incident or a limit, and the wait runs on; the runner looks at the run before it resumes it. A pull request with the
  // merge queue is left to it: all that can be left of such a run comes after `ready`.
  function retryTick(views) {
    for (const entry of state.returning.filter((e) => e.via === 'retry')) if (goalGate(views, { work: entry.work, lane: entry.lane, via: 'retry' })) leave(entry);
    if (stopped() || incidentOpen(views) || atLimit(views)) return;
    const ready = readyOf() ?? {};
    for (const work of Object.keys(isPlain(views.work) ? views.work : {})) {
      const got = retryFor(views, work);
      if (!got?.due || onTheWay(work) || waitingNow(views).has(work) || namedByCard(views, got.run.runId, 'failed')) continue;
      if (state.sentBack[work] !== state.acted[work] || state.reds[work]?.times !== state.redActed[work]) continue;
      if (Number.isInteger(got.run.pr) && isPlain(ready[got.run.pr])) continue;
      enter({ work, lane: got.run.lane, via: 'retry', key: `retry:${got.run.runId}:${got.tries + 1}`, runId: got.run.runId });
    }
  }

  // The features that stay stopped: the latest run ended by All stop, or at its cap by the director's Stop. Each is taken
  // up by a Carry on, so none holds a place meanwhile. A question at a run's cap names the run as `cap:<run>`.
  function stoppedFeaturesOf(views, reports) {
    const stops = new Set(stoppedRuns() ?? []);
    for (const q of Object.values(isPlain(views.questions) ? views.questions : {})) {
      const engineRef = q?.question?.data?.engine;
      if ((engineRef?.ask === `cap:${engineRef?.runId}` && q.answer?.label === STOP_LABEL) || lostStop(q, engineRef?.runId)) stops.add(engineRef.runId);
    }
    return Object.entries(isPlain(views.work) ? views.work : {}).filter(([work, entry]) => {
      if (entry?.work?.data?.lane !== 'feature' || endedBy(reports, work, entry.work) || onTheWay(work)) return false;
      const last = (views.runs?.[work] ?? []).filter((r) => since(r, entry.work)).at(-1)?.data;
      return last?.state === 'ended' && stops.has(last.runId);
    }).map(([work]) => work);
  }

  // Quick, small and bug work whose run's pull request merged: its `merged` report, once (the briefing's shipped line,
  // the board and dependent work read it). A feature has its own (featureTick); a pull request seen closed isn't asked
  // about again.
  async function mergedTick() {
    const views = readViews() ?? {};
    const reports = isPlain(views.reports) ? views.reports : {};
    for (const [work, entry] of Object.entries(isPlain(views.work) ? views.work : {})) {
      const lane = entry?.work?.data?.lane;
      if (!isText(lane) || lane === 'feature' || endedBy(reports, work, entry.work)) continue;
      const queued = entry.work.at ?? null;
      if (Object.hasOwn(state.shipped, work) && state.shipped[work] === queued) continue;
      const latest = new Map();
      for (const r of views.runs?.[work] ?? []) if (isPlain(r?.data) && since(r, entry.work)) latest.set(r.data.runId, r.data);
      const prs = [...new Set([...latest.values()].filter((r) => r.state === 'ended' && Number.isInteger(r.pr)).map((r) => r.pr))];
      let merged = false;
      for (const pr of prs.filter((n) => !state.closedPrs.includes(n)).reverse()) {
        const got = await stateOf(pr);
        if (got === 'closed') {
          state.closedPrs = [...state.closedPrs, pr].slice(-200);
          keep();
        }
        if (got !== 'merged') continue;
        await write('report', { work, outcome: 'merged', pr, summary: config()?.testsNotCounting === true ? `${MERGED_WORDS} ${NOT_COUNTING_WORDS}.` : MERGED_WORDS, rulings: [] });
        state.shipped[work] = queued;
        keep();
        merged = true;
        break;
      }
      // Every run ended, and the newest pull request was closed unmerged: the work has stopped, so it gets a `closed`
      // report, which takes it off the board's work under way, and the Logbook says so, once. Queued again, it starts
      // afresh. A newer run still going, or a newer pull request open, ends nothing.
      const newest = [...latest.values()].filter((r) => Number.isInteger(r.pr)).at(-1)?.pr;
      if (!merged && Number.isInteger(newest) && state.closedPrs.includes(newest) && [...latest.values()].every((r) => r.state === 'ended')) {
        await write('report', { work, outcome: 'closed', pr: newest, summary: CLOSED_WORDS, rulings: [] });
        state.shipped[work] = queued;
        keep();
        await write('note', { about: 'engine', work, words: `${entry.work.data.title ?? work}: its pull request #${newest} was closed without being added, so the work has stopped. Queue it again to build it afresh.` });
      }
    }
  }

  // A red main line's incident: its fix, its close and its card (fix-main.js). One at a time.
  let fixing = null;
  function fixTick() {
    fixing ??= fixNow().finally(() => { fixing = null; });
    return fixing;
  }
  async function fixNow() {
    const views = readViews() ?? {};
    const incident = openRedMain(views);
    if (!incident) return;
    // The director's own incident holds the fix too, until they close it.
    if (views.incidents.open.some((i) => i !== incident)) return;
    const kept = (state.fixes[incident.id] ??= { carried: [], carded: [], next: null, started: [], asked: {} });
    let green = null;
    try { green = await mainGreen(); } catch { green = null; }
    const runs = views.runs?.[incident.work] ?? [];
    const recorded = new Set(runs.map((r) => r?.data?.runId));
    // A start the record doesn't show yet is still under way.
    if (kept.started.some((runId) => !recorded.has(runId)) && green !== true) return;
    answerFixCard(views, incident, kept);
    const decided = fixDecision({ incident, runs, green, stop: stopped(), stopped: stoppedRuns() ?? [], merged: fixedRuns() ?? [], kept, retry: fixRetry(runs), lost: lostNow()?.carried ?? [], clearing: lostNow()?.clearing ?? [] });
    if (decided.act === 'close') {
      await write('incident-closed', { incident: incident.id, why: 'the main line\'s checks are green' });
      await write('note', { about: 'engine', words: GREEN_WORDS });
      // A fix the main line no longer needs: one still running is stopped, and one whose pull request wasn't added is
      // named, since the merge gate refuses it once the incident is closed.
      const merged = new Set(fixedRuns() ?? []);
      const fixes = new Map();
      for (const r of runs) if (isPlain(r?.data) && typeof r.data.runId === 'string') fixes.set(r.data.runId, { ...(fixes.get(r.data.runId) ?? {}), ...r.data });
      for (const runId of kept.started) if (!fixes.has(runId)) fixes.set(runId, { runId, state: 'started' });
      for (const fix of fixes.values()) {
        if (fix.state !== 'ended') {
          let got = null;
          try { got = await engine.act(fix.runId, { cancel: { reason: 'the main line turned green by itself' } }); } catch { got = null; }
          await write('note', { about: 'engine', words: got?.ok === true
            ? 'The main line turned green by itself, so the fix still running for it was stopped.'
            : 'The main line turned green by itself, but the fix still running for it couldn\'t be stopped; what it does is no longer needed.' });
        } else if (Number.isInteger(fix.pr) && !merged.has(fix.runId)) {
          await write('note', { about: 'engine', words: `The main line turned green by itself, so the fix's pull request #${fix.pr} isn't needed and won't be added; it can be closed.` });
        }
      }
      delete state.fixes[incident.id];
      keep();
    } else if (decided.act === 'resume') {
      // Nothing is admitted under an incident, so it goes by its own decision, after a look at the run. A refusal is on the
      // record, and the card follows.
      const records = runs.filter((r) => r?.data?.runId === decided.run);
      let seen = null;
      try { seen = await engine.inspect(decided.run); } catch { seen = null; }
      if (seen === null || seen.unread === true || ['running', 'paused'].includes(seen.status)) return;
      if (seen.status === 'ended' && seen.outcome !== 'failed') await write('run', { ...Object.fromEntries(Object.entries(records.at(-1).data).filter(([key]) => key !== 'failure')), outcome: seen.outcome ?? 'cancelled' });
      else await resumeRun({ engine, runId: decided.run, write, records, now });
    } else if (decided.act === 'start') {
      const toldNoFix = kept.noFix ? views.questions?.[kept.noFix]?.answer?.label : null;
      if (toldNoFix === LEAVE_RED) return;
      let order;
      try {
        order = fixOrder(incident, { config: config() ?? {}, settings: settings() ?? {}, revert: decided.revert === true });
        const areas = fixAreas(views);
        if (areas !== null) order = { ...order, areas, notInScope: [...order.notInScope, areasInScopeWords(areas)] };
      } catch {
        if (!kept.noFix || toldNoFix === FIX_FORWARD) await noFixCard(incident, kept);
        return;
      }
      // The fix lane passes every bound but spend, and a goal that reached its spend is about to end.
      if (goalGate(views, { work: incident.work, lane: order.lane, via: 'start' })) return;
      delete kept.noFix;
      const answered = isPlain(kept.next) ? kept.next : null;
      kept.next = null;
      if (decided.after) kept.carried.push(decided.after);
      keep();
      const got = await start({ project, order, ...(decided.carryOn ? { branch: decided.branch, carryOn: true } : {}) });
      if (got?.ok && typeof got.runId === 'string') {
        kept.started.push(got.runId);
        delete kept.refusedSaid;
        keep();
        if (kept.started.length === 1) await write('note', { about: 'engine', words: STARTED_FIX_WORDS });
      } else {
        // Tried again on the next tick, the director's answer kept; the Logbook says why, once.
        if (answered) kept.next = answered;
        const said = kept.refusedSaid === true;
        kept.refusedSaid = true;
        keep();
        if (!said) {
          const why = got?.refused ?? 'the build engine didn\'t start it';
          const chose = answered ? (answered.revert === true && incident.suspect ? undoLabel(incident.suspect) : FIX_FORWARD) : null;
          await write('note', { about: 'engine', words: chose
            ? `You chose ${chose} for the red main line, but the fix didn't start: ${why}. Your answer is kept, and it is tried again.`
            : `The fix for the red main line didn't start: ${why}. It is tried again, and other work waits until the main line is green.` });
        }
      }
    } else if (decided.act === 'card') {
      kept.carded.push(decided.run);
      const id = `q-${incident.work}-${FIX_QUESTIONS + kept.carded.length}`;
      kept.asked[id] = decided.run;
      keep();
      const options = [
        ...(incident.suspect ? [{ label: undoLabel(incident.suspect), says: `It undoes pull request #${incident.suspect}, which the merge queue suspects broke the main line, and checks the main line again.` }] : []),
        { label: FIX_FORWARD, says: 'It tries again to make the main line\'s checks pass, with a fresh run.' },
        { label: LEAVE_RED, says: 'Nothing more is tried; all other work keeps waiting until the main line is green.' },
      ];
      await askDirector('fix', {
        id, work: incident.work, level: 3,
        what: `${WHY_FIX[decided.why] ?? WHY_FIX.failed} Nothing else is added until the main line is green again.`,
        why: 'A red main line holds up all work, and how to mend it when the first fix didn\'t is yours to decide, at level 3.',
        options, recommendation: options[0].label,
      });
    }
  }
  // The latest fix run's try, as `fixDecision` takes it: { due, waiting }, or null.
  function fixRetry(runs) {
    const runId = [...new Set(runs.map((r) => r?.data?.runId))].at(-1);
    const got = retryDue({ records: runs.filter((r) => r?.data?.runId === runId), now: now() });
    return got ? { due: got.due, waiting: !got.due } : null;
  }
  // No order for a fix, which needs the project's tests for its done check: all work is held, and nothing else can speak under
  // an incident. One card; an order that can be made later starts the fix by itself, and that card's late answer means nothing.
  async function noFixCard(incident, kept) {
    kept.noFixCards = (kept.noFixCards ?? 0) + 1;
    kept.noFix = `q-${incident.work}-${NO_FIX_QUESTIONS + kept.noFixCards}`;
    keep();
    await askDirector('fix', {
      id: kept.noFix, work: incident.work, level: 3,
      what: noFixWords(isText(config()?.testCommand) ? NO_FIX_ORDER : NO_FIX_TESTS),
      why: 'A red main line holds up all work, and what to do when no fix can start is yours to decide, at level 3.',
      options: [
        { label: FIX_FORWARD, says: 'It tries again to start a fix. If it still can\'t, you get a new card.' },
        { label: LEAVE_RED, says: 'Nothing more is tried; all other work keeps waiting until the main line is green.' },
      ],
      recommendation: FIX_FORWARD,
    }).catch(() => {});
  }
  // The director's answer to a fix card: the next attempt, once.
  function answerFixCard(views, incident, kept) {
    for (const id of Object.keys(kept.asked)) {
      const label = views.questions?.[id]?.answer?.label;
      if (typeof label !== 'string') continue;
      delete kept.asked[id];
      if (label === FIX_FORWARD) kept.next = { revert: false };
      else if (incident.suspect && label === undoLabel(incident.suspect)) kept.next = { revert: true };
      keep();
    }
  }

  // Keeps a merge-queue run as the project's one queue run.
  function ownQueueRun(runId) {
    state.mergeRun = runId;
    state.mergeRuns = [...state.mergeRuns, runId].slice(-KEPT_MERGE_RUNS);
    // `mergeRuns` is cut short, and the spend of each of a goal's queue runs counts.
    if (goalInForce(readViews() ?? {}) !== null && !state.goalQueueRuns.includes(runId)) state.goalQueueRuns.push(runId);
  }
  // One start at a time, and none beside a live queue run the helper didn't start, which is taken as the queue's run
  // instead: what is due stays due, so a run that started without the project's models is followed once it ends. An
  // engine that can't say what is live starts nothing this tick.
  let startingQueue = null;
  async function startQueue(waiting) {
    if (await mergeQueueRunning()) {
      await queuePassed();
      return;
    }
    // Asked before `queueFolder()`, which resets the folder a live run would be working in.
    const place = queuePlace?.() ?? null;
    if (place !== null && typeof engine.queueRuns === 'function') {
      let live = null;
      try { live = await engine.queueRuns({ folder: place }); } catch { live = null; }
      if (!Array.isArray(live)) {
        queueCantStart('the build engine can\'t say what is running');
        return;
      }
      if (live.length > 0) {
        ownQueueRun(live[0]);
        keep();
        await queuePassed();
        return;
      }
    }
    let where = null;
    try { where = await queueFolder(); } catch { where = null; }
    if (where?.ok !== true) {
      queueCantStart(where?.refused ?? 'it has no folder to run in');
      return;
    }
    let got = null;
    try { got = await engine.start({ lane: 'merge', project: where.folder, repo: repoOf() }); } catch { got = { ok: false, refused: 'the build engine gave no clear answer' }; }
    if (got?.ok) {
      ownQueueRun(got.runId);
      state.lastStart = now().toISOString();
      state.seenReady = waiting.map(([pr]) => pr);
      state.queueDue = false;
      keep();
      await queuePassed();
    } else queueCantStart(got?.refused ?? 'the build engine didn\'t start it');
  }

  // A queue that couldn't start, kept from the first try that failed. It is tried on every tick, so a gap of the fault's whole
  // time is a computer that slept, which says nothing of how long the fault has lasted.
  function queueCantStart(why) {
    const at = now().toISOString();
    const fault = state.queueFault;
    const lasted = fault && now().getTime() - Date.parse(fault.last) < QUEUE_FAULT_MS;
    state.queueFault = { asked: null, works: [], ...fault, why, since: lasted ? fault.since : at, last: at };
    keep();
  }
  async function queuePassed() {
    const fault = state.queueFault;
    if (!fault) return;
    state.queueFault = null;
    keep();
    const views = readViews() ?? {};
    if (fault.asked && !isPlain(views.questions?.[fault.asked]?.answer)) await write('note', { about: 'engine', words: QUEUE_PASSED_WORDS }).catch(() => {});
  }
  // The card for a queue that stays unable to start: every piece with a ready pull request waits on it, and it is tried on
  // each tick whatever the answer, so it asks only whether the director wants to hear again.
  async function queueFaultTick(views, waiting, queueStatus) {
    const fault = state.queueFault;
    if (queueHolds(queueStatus)) {
      await queuePassed();
      return;
    }
    // Nothing waiting says nothing of the queue, so the fault and any answer stand for what is next ready.
    fault.works = [...new Set(waiting.map(([, r]) => r.work))];
    keep();
    if (waiting.length === 0) return;
    const label = views.questions?.[fault.asked]?.answer?.label;
    if (label === TRY_AGAIN) {
      Object.assign(fault, { asked: null, since: now().toISOString() });
      keep();
      return;
    }
    if (fault.asked || stopped() || incidentOpen(views) || now().getTime() - Date.parse(fault.since) < QUEUE_FAULT_MS) return;
    state.restartCards += 1;
    fault.asked = `q-${fault.works[0]}-${RESTART_QUESTIONS + state.restartCards}`;
    keep();
    await askDirector('trouble', {
      id: fault.asked, work: fault.works[0], level: 3,
      what: queueStuckWords(fault.why),
      why: QUEUE_STUCK_WHY,
      options: [
        { label: TRY_AGAIN, says: 'It carries on trying, and you get a new card if it still can\'t start in a while.' },
        { label: LEAVE_IT, says: 'It carries on trying, and finished work keeps waiting. You aren\'t asked about this again.' },
      ],
      recommendation: TRY_AGAIN,
    });
  }

  // Whether a queue run is live, whoever started it. An engine that can't say counts as one.
  async function queueLive() {
    if (await mergeQueueRunning()) return true;
    const place = queuePlace?.() ?? null;
    if (place === null || typeof engine.queueRuns !== 'function') return false;
    try {
      const live = await engine.queueRuns({ folder: place });
      return !Array.isArray(live) || live.length > 0;
    } catch {
      return true;
    }
  }

  // What each piece keeps while it waits. A parking is read once, and a read that fails is tried again on each tick; only
  // the piece's end or `release` takes anything away, so nothing here lets go by itself.
  async function reserveTick(views) {
    const reports = isPlain(views.reports) ? views.reports : {};
    // A piece going back on an answer may have no card left to park it, and its next run isn't under way, so nothing else speaks
    // for its files. Nor for one whose card is a look or two away.
    const between = [...state.returning, ...state.admitted].filter((e) => REWORKING.includes(e.via)).map((e) => e.work);
    const pieces = new Set([...waitingNow(views), ...between, ...reworkingNow(), ...lostPieces(), ...retryingWork(views), ...Object.keys(isPlain(views.work) ? views.work : {}).filter((work) => lonePiece(views, work))]);
    // A cut-off piece has not begun, so it has no files to keep.
    for (const work of Object.keys(state.cutOffAsked)) pieces.delete(work);
    for (const entry of state.returning) if (unbegun(views, entry)) pieces.delete(entry.work);
    for (const [work, kept] of Object.entries(state.reserved)) {
      if (endedBy(reports, work, views.work?.[work]?.work)) {
        delete state.reserved[work];
        delete state.released[work];
        keep();
      } else if (!pieces.has(work) && kept.read) {
        kept.read = false;
        keep();
      }
    }
    for (const work of pieces) {
      const entry = views.work?.[work];
      if (!isPlain(entry?.work?.data) || endedBy(reports, work, entry.work)) continue;
      const runs = views.runs?.[work] ?? [];
      const runId = runs.at(-1)?.data?.runId;
      // Let go of: another card still open on that run doesn't take the files back, and a new run may.
      if (Object.hasOwn(state.released, work)) {
        if (state.released[work] === (runId ?? null)) continue;
        delete state.released[work];
        keep();
      }
      const kept = (state.reserved[work] ??= { files: [], read: false });
      if (kept.read) continue;
      kept.files = [...new Set([...kept.files, ...(entry.files ?? [])])];
      let paths = [];
      if (typeof runId === 'string') {
        const branch = runs.filter((r) => r?.data?.runId === runId).map((r) => r.data.branch).filter(isText).at(-1) ?? null;
        try { paths = await branchPaths({ runId, branch }); } catch { paths = null; }
      }
      // Released while it was read: its files are free.
      if (state.reserved[work] !== kept) continue;
      if (Array.isArray(paths)) Object.assign(kept, { files: [...new Set([...kept.files, ...paths])], read: true, said: false });
      const say = !Array.isArray(paths) && kept.said !== true;
      if (say) kept.said = true;
      keep();
      if (say) await write('note', { about: 'engine', work, words: reservedUnreadWords(entry.work.data.title ?? work) });
    }
  }

  // --- The way back (delegated decisions design, section 8.3) ---
  const onTheWay = (work) => [...state.returning, ...state.admitted].some((e) => e.work === work);
  const wakes = (entry) => WAKES.includes(entry.via) && entry.startsRun !== true;
  const titleOf = (views, work) => views.work?.[work]?.work?.data?.title ?? work;
  const incidentOpen = (views) => (views.incidents?.open?.length ?? 0) > 0;
  const atLimit = (views) => limitedRuns(views, now()).length > 0;
  const retriesLater = (entry) => Date.parse(entry.retryAt) > now().getTime();
  // Asks for no place yet: a try still to fall due, a carry-on whose lost run the runner hasn't seen gone, or a start a goal holds.
  const notYet = (entry) => retriesLater(entry) || entry.cancelling === true || entry.heldBy !== undefined;
  // A carry-on that ended with nothing done: the worktree's lock turned it away, and it says so only by that (check 92).
  const turnedAway = (entry, seen) => entry.via === 'carry-on' && seen?.status === 'ended' && seen.outcome === 'cancelled' && (seen.steps ?? []).length === 0 && !(stoppedRuns() ?? []).includes(entry.runId);
  // New work refused at its first start, with nothing of it on record: nothing of it has been done.
  const unbegun = (views, entry) => entry.firstStart === true && !isText(entry.branch) && (views.runs?.[entry.work] ?? []).length === 0;
  function leave(entry) {
    state.returning = state.returning.filter((e) => e !== entry);
    state.admitted = state.admitted.filter((e) => e !== entry);
    keep();
  }
  function enter({ work, lane, via, key, ...rest }) {
    const same = (e) => e.work === work && e.key === key;
    if (state.returning.some(same) || state.admitted.some(same)) return;
    const queued = (readViews() ?? {}).work?.[work]?.work?.at ?? null;
    const named = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
    state.returning.push({ work, lane, via, key, at: now().toISOString(), queued, ...named });
    keep();
  }

  // A card for a piece that can't go on by itself: it gives its place back and starts nothing until the director says.
  async function askAboutRestart(entry, what, marks = {}) {
    state.admitted = state.admitted.filter((e) => e !== entry);
    if (!state.returning.includes(entry)) state.returning.push(entry);
    state.restartCards += 1;
    const id = `q-${entry.work}-${RESTART_QUESTIONS + state.restartCards}`;
    delete entry.starting;
    delete entry.uncertain;
    // Its Stop here takes this pull request out of the merge queue's reach, so the card says so.
    const merged = state.features[entry.work]?.merged ?? {};
    const prLeft = runsOfWork(readViews() ?? {}, entry.work).map((r) => r?.data?.pr).filter((pr) => Number.isInteger(pr) && !state.closedPrs.includes(pr) && !Object.hasOwn(merged, pr)).at(-1);
    Object.assign(entry, { asked: id, askedWhat: what, prLeft, ...marks });
    keep();
    await restartCard(entry);
  }
  // Kept before it is written, so a write that fails is tried again on the next tick and the piece isn't left unasked.
  async function restartCard(entry) {
    await askDirector('restart', {
      id: entry.asked, work: entry.work, level: 3, what: entry.askedWhat,
      why: 'Whether work goes on when it can\'t be started again is yours to decide, at level 3.',
      options: [
        { label: TRY_AGAIN, says: entry.unsure === true ? RESTART_UNSURE_AGAIN : 'It asks for a place and is started again.' },
        { label: STOP_HERE, says: entry.fresh === true ? START_STOP_SAYS : `Nothing more starts; what it has done so far is kept on its branch, and its files are free for other work.${Number.isInteger(entry.prLeft) ? ` ${prLeftOpenWords(entry.prLeft)}` : ''}` },
      ],
      recommendation: TRY_AGAIN,
    }).catch(() => {});
  }

  function refusedTwice(views, entry, why) {
    const fresh = unbegun(views, entry);
    const title = titleOf(views, entry.work);
    return askAboutRestart(entry, fresh ? startCardWords(title, why) : restartCardWords(title, why), fresh ? { fresh } : {});
  }
  // A refusal from before the engine was called: the place goes back and the entry stays, said once, and a card the second time.
  async function refusedStart(entry, got) {
    const views = readViews() ?? {};
    const why = got?.refused ?? 'the build engine didn\'t start it';
    if (stopped()) {
      delete entry.starting;
      state.admitted = state.admitted.filter((e) => e !== entry);
      if (!state.returning.includes(entry)) state.returning.push(entry);
      keep();
      return;
    }
    const fresh = unbegun(views, entry);
    const title = titleOf(views, entry.work);
    entry.refusals = (entry.refusals ?? 0) + 1;
    if (entry.refusals >= 2) {
      await refusedTwice(views, entry, why);
      return;
    }
    delete entry.starting;
    state.admitted = state.admitted.filter((e) => e !== entry);
    if (!state.returning.includes(entry)) state.returning.push(entry);
    if (entry.firstStart === true) entry.retryAt = new Date(now().getTime() + REFUSED_RETRY_MS).toISOString();
    keep();
    if (entry.reason === 'red') await redRefused(entry.work, got);
    else if (got?.said !== true) await write('note', { about: 'engine', work: entry.work, words: fresh ? startRefusedWords(title, why) : restartRefusedWords(title, why) });
  }

  // What a start carries: its entry's own, and whatever All stop kept for Carry on, which any start takes up (`afterStart`).
  function carried({ work, branch = null, carryOn = false, answers = [] }) {
    const carry = state.carryOver[work];
    if (!carry) return { branch, carryOn, answers };
    const said = new Set(answers.map((a) => JSON.stringify(a)));
    const from = branch ?? carry.branch ?? null;
    return { branch: from, carryOn: carryOn || isText(from), answers: [...(carry.answers ?? []).filter((a) => !said.has(JSON.stringify(a))), ...answers] };
  }

  // The way a start came, as the goal's gate reads it. A first start and a carry-on are the director's answer only when a
  // card made them so, and each keeps the `via` of its kind: `answered` says it was.
  const viaOf = (entry) => (entry.answered === true ? 'answer' : entry.firstStart === true ? 'start' : entry.via);
  // Held at a goal's gate: the place goes back, nothing is asked, and it waits on the list until the gate lets it by.
  async function heldAtGate(entry, got) {
    delete entry.starting;
    delete entry.uncertain;
    state.admitted = state.admitted.filter((e) => e !== entry);
    if (!state.returning.includes(entry)) state.returning.push(entry);
    entry.heldBy = got.goal;
    const said = entry.heldSaid === got.why;
    entry.heldSaid = got.why;
    keep();
    if (!said) await write('note', { about: 'engine', work: entry.work, words: goalHeldWords(titleOf(readViews() ?? {}, entry.work), got.why) });
  }
  // Each entry a goal holds is asked again: a new sheet, or the end of the goal, may let it by.
  function heldTick(views) {
    for (const entry of state.returning.filter((e) => e.heldBy !== undefined)) {
      const held = goalGate(views, { work: entry.work, lane: entry.lane, via: viaOf(entry) });
      if (held) entry.heldBy = held.goal;
      else {
        delete entry.heldBy;
        delete entry.heldSaid;
      }
      keep();
    }
  }

  async function startEntry(entry) {
    Object.assign(entry, { starting: true, startAt: now().toISOString() });
    keep();
    const { work, lane, raised = false, reason } = entry;
    let got;
    try {
      got = await startPiece({ work, lane, via: viaOf(entry), ...carried(entry), raised, ...(reason === 'red' ? { checkTail: state.reds[work]?.tail } : {}) });
    } catch (error) {
      got = { ok: false, refused: error instanceof Error ? error.message : 'unknown', uncertain: true };
    }
    await afterStart(entry, got);
    return got;
  }
  async function afterStart(entry, got) {
    if (got?.ok === true) {
      delete state.carryOver[entry.work];
      if (typeof got.runId !== 'string') {
        leave(entry);
        return;
      }
      delete entry.starting;
      delete entry.uncertain;
      entry.runId = got.runId;
      keep();
      try { carriedBy(got.runId, entry.carried); } catch { /* the spend before it goes uncounted, never the start */ }
    } else if (got?.goalHeld === true) await heldAtGate(entry, got);
    else if (got?.capped === true || got?.gone === true) leave(entry); // The feature's cap card, or nothing left to start.
    else if (got?.uncertain === true) {
      entry.uncertain = true;
      keep();
    } else await refusedStart(entry, got);
  }

  // A start that timed out, or a crash while `starting`. Nothing starts again until the engine has answered: a run on
  // record counts as started; a run with no record never got its order or ticket, so it is cancelled and confirmed ended.
  async function settleStart(entry, views) {
    if (stopped()) return;
    // On record since the start was marked: it began, though it may have ended since and no longer be live.
    const begun = (views.runs?.[entry.work] ?? []).find((r) => typeof r?.data?.runId === 'string' && typeof r.at === 'string' && r.at >= entry.startAt);
    if (begun) {
      await afterStart(entry, { ok: true, runId: begun.data.runId });
      return;
    }
    let found;
    if (typeof engine.liveRunOf === 'function') {
      try { found = await engine.liveRunOf({ work: entry.work, since: entry.startAt }); } catch { found = undefined; }
    }
    const unsure = () => askAboutRestart(entry, restartUnsureWords(titleOf(views, entry.work)), { unsure: true });
    if (found === undefined) {
      await unsure();
      return;
    }
    if (found !== null) {
      if ((views.runs?.[entry.work] ?? []).some((r) => r?.data?.runId === found.runId)) {
        await afterStart(entry, { ok: true, runId: found.runId });
        return;
      }
      let over = false;
      try {
        const got = await engine.act(found.runId, { cancel: { reason: 'it started without its order, so it starts again' } });
        over = got?.ok === true && (await engine.inspect(found.runId))?.status === 'ended';
      } catch { over = false; }
      if (!over) {
        await unsure();
        return;
      }
    }
    delete entry.starting;
    // Settled again on a card's Try again: nothing is left of it, so it asks for a place as any piece coming back does.
    if (entry.settling === true) {
      delete entry.settling;
      state.admitted = state.admitted.filter((e) => e !== entry);
      if (!state.returning.includes(entry)) state.returning.push(entry);
    }
    // Nothing began. One that keeps giving no clear answer comes to a card, as a refusal does, and doesn't go round each tick.
    if (entry.uncertain === true) {
      delete entry.uncertain;
      entry.refusals = (entry.refusals ?? 0) + 1;
      if (entry.refusals >= 2) {
        await refusedTwice(views, entry, 'the build engine gave no clear answer');
        return;
      }
    }
    keep();
  }

  // A run the engine may have started with no order, on the director's Stop here. Whether one is left going.
  async function endOrphan(entry) {
    if (typeof entry.startAt !== 'string' || typeof engine.liveRunOf !== 'function') return false;
    let found;
    try { found = await engine.liveRunOf({ work: entry.work, since: entry.startAt }); } catch { found = undefined; }
    if (found === null || found === undefined) return found === undefined;
    try {
      const got = await engine.act(found.runId, { cancel: { reason: 'the director stopped it before it began' } });
      return !(got?.ok === true && (await engine.inspect(found.runId))?.status === 'ended');
    } catch {
      return true;
    }
  }

  // Before `dispatch`: what has ended or been queued again leaves, cards are answered, starts are settled, and a run seen
  // running gives its entry up. So does one paused again on a newer ask, which waits on the director again.
  async function returnTick(views) {
    pruneReturning(views);
    // Lifting All stop starts no run: a carry-on not yet under way gives up, and its piece comes to its card after the lift.
    if (stopped()) for (const entry of [...state.returning, ...state.admitted]) if (entry.via === 'carry-on' && !entry.starting && !entry.asked) leave(entry);
    for (const entry of [...state.returning]) {
      if (entry.asked && isPlain(views.questions) && !views.questions[entry.asked]) await restartCard(entry);
      const label = entry.asked ? views.questions?.[entry.asked]?.answer?.label : null;
      if (label === TRY_AGAIN) {
        delete entry.asked;
        delete entry.retryAt;
        entry.refusals = 0;
        entry.answered = true;
        // A start that couldn't be told: what began is settled first, so nothing starts beside it.
        if (entry.unsure === true) {
          delete entry.unsure;
          Object.assign(entry, { starting: true, settling: true });
          state.returning = state.returning.filter((e) => e !== entry);
          state.admitted.push(entry);
        }
        keep();
      } else if (label === STOP_HERE) {
        // The report first: one that fails keeps the entry, so the director's Stop is acted on next tick.
        const feature = views.work?.[entry.work]?.work?.data?.lane === 'feature';
        const current = views.work?.[entry.work]?.work;
        const title = titleOf(views, entry.work);
        const unstarted = !feature && isPlain(current) && !runsOfWork(views, entry.work).some((r) => since(r, current));
        const orphan = unstarted || entry.unsure === true ? await endOrphan(entry) : false;
        const stoppedWords = entry.fresh === true ? cutOffStoppedWords(title) : STOPPED_RESTART_WORDS(title);
        const words = `${stoppedWords}${orphan ? ` ${ORPHAN_LEFT_WORDS}` : ''}`;
        if (feature) await endFeature(entry.work, state.features[entry.work] ??= {}, words, entry.fresh === true ? stoppedWords : undefined);
        else {
          await write('report', { work: entry.work, outcome: 'closed', summary: stoppedWords, rulings: [] });
          release(entry.work, views);
        }
        leave(entry);
        if (!feature) await write('note', { about: 'engine', work: entry.work, words });
      }
    }
    for (const entry of [...state.admitted]) if (entry.starting) await settleStart(entry, views);
    const pieces = waitingNow(views);
    for (const entry of [...state.admitted]) {
      if (entry.starting || entry.asked) continue;
      if (wakes(entry) && !entry.delivered) {
        // A card opened since it was admitted: the place goes back until that is answered.
        if (pieces.has(entry.work)) {
          state.admitted = state.admitted.filter((e) => e !== entry);
          state.returning.push(entry);
          keep();
        }
        continue;
      }
      if (typeof entry.runId !== 'string') continue;
      const records = (views.runs?.[entry.work] ?? []).filter((r) => r?.data?.runId === entry.runId);
      let status = null;
      let seen = null;
      try {
        seen = await engine.inspect(entry.runId);
        // An engine that gave no answer says nothing of the run.
        status = seen?.unread === true ? null : seen?.status ?? null;
      } catch { status = null; }
      if (turnedAway(entry, seen)) {
        delete entry.runId;
        await refusedStart(entry, { refused: 'the engine turned it away' });
      } else if (SEEN.includes(status) || records.at(-1)?.data?.state === 'ended' || pieces.has(entry.work)) {
        leave(entry);
      } else if (wakes(entry) && status !== 'running' && !entry.lateSaid && now().getTime() - Date.parse(entry.deliveredAt) >= WAKE_LATE_MS) {
        entry.lateSaid = true;
        keep();
        await write('note', { about: 'engine', work: entry.work, words: wakeLateWords(titleOf(views, entry.work)) });
      }
    }
  }

  // What has ended or been queued again has nothing to come back to.
  function pruneReturning(views) {
    const reports = isPlain(views.reports) ? views.reports : {};
    for (const entry of [...state.returning, ...state.admitted]) {
      const current = views.work?.[entry.work]?.work;
      if (!isPlain(current)) continue;
      const again = entry.queued !== null && entry.queued !== undefined && current.at !== entry.queued;
      if (!again && !endedBy(reports, entry.work, current)) continue;
      // Queued again (the First Mate's Carry on): it starts as new work, with what this entry was to carry on from.
      if (again && !wakes(entry) && isText(entry.branch)) state.carryOver[entry.work] ??= { branch: entry.branch, answers: entry.answers ?? [] };
      leave(entry);
    }
  }

  const reservedFiles = () => Object.fromEntries(Object.entries(state.reserved).map(([work, kept]) => [work, kept.files]));
  const cardOwed = (work) => Object.values(state.owed).some((o) => o.data.work === work) || routerOwed().has(work);
  // Whether nothing moves a piece on by itself: every run ended, no card and none owed, no way back, nothing sent back, and
  // no pull request with the merge queue or waiting to be merged. The director's Leave it counts too: nothing was done to it, as the card said.
  const leftByDirector = (views, work) => [state.clashAsked[work], state.redAsked[work]].some((id) => views.questions?.[id]?.answer?.label === LEAVE_IT);
  const prGone = (views, work, pr) => state.closedPrs.includes(pr) || state.features[work]?.closed?.[pr] === true || Object.hasOwn(state.features[work]?.merged ?? {}, pr) || (views.sendBacks ?? []).some((b) => b.pr === pr);
  function restsQuiet(views, work, ready) {
    if (onTheWay(work) || waitingNow(views).has(work) || cardOwed(work) || reworkingNow().includes(work) || lostPieces().includes(work) || retryFor(views, work)) return false;
    const left = leftByDirector(views, work);
    if (!left && state.sentBack[work] !== state.acted[work] && state.sentBack[work] !== undefined) return false;
    if (!left && state.reds[work] !== undefined && state.reds[work].times !== state.redActed[work]) return false;
    const runs = [...new Map(runsOfWork(views, work).map((r) => [r.data.runId, r.data])).values()];
    if (runs.length === 0 || runs.some((r) => r.state !== 'ended')) return false;
    if (left) return true;
    const last = runs.at(-1);
    // A finished run's open pull request is for merging, unless the director sent it back or it has gone.
    const toMerge = last.outcome === 'completed' && Number.isInteger(last.pr) && !prGone(views, work, last.pr);
    return !toMerge && !ready.some(([, r]) => r.work === work) && !runs.some((r) => Object.hasOwn(parkedPrs() ?? {}, r.pr));
  }
  // What is going or about to, for what stands behind a hold. A feature holds its place between slices, but one that rests
  // quiet has nothing going.
  function goingNow(views, decided, { queueStatus, ready, started }) {
    // A ready pull request is going only if a queue can take it.
    const stuck = new Set(state.queueFault ? ready.map(([, r]) => r.work) : []);
    const moving = (work) => !waitingNow(views).has(work);
    const queueGoing = queueStatus === 'running' || (queueStatus === 'paused' && cardsNow(views).length === 0);
    return [
      ...decided.live.filter((work) => !restsQuiet(views, work, ready) && !stuck.has(work)), ...started.filter((s) => s.ok === true || s.uncertain === true).map((s) => s.work),
      ...[...state.admitted, ...state.returning].filter((e) => !e.asked && !retriesLater(e) && e.heldBy === undefined && moving(e.work)).map((e) => e.work),
      ...ready.map(([, r]) => r.work).filter((work) => moving(work) && !stuck.has(work) && !leftByDirector(views, work)), ...(queueGoing ? [MERGE_WORK] : []),
      ...retryingWork(views), ...limitedWork(views, now()),
    ];
  }

  // When nothing runs, a card the director can act on (delegated decisions plan, invariant 6): a piece at the far end of a
  // hold, or a feature keeping its place, that rests quiet is asked about once for that run, on the second look, since
  // what ended a moment ago may yet move on by itself.
  async function strandedTick(views, decided, going) {
    if (stopped() || incidentOpen(views)) return;
    const reports = isPlain(views.reports) ? views.reports : {};
    const { ready } = going;
    const ends = deadEnds({ hold: decided.hold, running: goingNow(views, decided, going), cards: cardsNow(views) });
    const places = decided.live.filter((work) => !ends.has(work)).map((work) => [work, 'place']);
    const named = new Set([...ends.keys(), ...places.map(([work]) => work)]);
    const alone = Object.keys(isPlain(views.work) ? views.work : {}).filter((work) => !named.has(work) && lonePiece(views, work)).map((work) => [work, 'alone']);
    for (const [work, why] of [...ends, ...places, ...alone]) {
      const current = views.work?.[work]?.work;
      if (!isPlain(current) || reports[work]?.data?.outcome === 'merged' || endedBy(reports, work, current) || !restsQuiet(views, work, ready)) {
        delete state.quietSeen[work];
        continue;
      }
      const runs = [...new Map(runsOfWork(views, work).map((r) => [r.data.runId, r.data])).values()];
      const last = runs.at(-1);
      const key = `stranded:${last.runId}`;
      if (state.stranded[work] === key) continue;
      if (state.quietSeen[work] !== key) {
        state.quietSeen[work] = key;
        keep();
        continue;
      }
      state.stranded[work] = key;
      delete state.quietSeen[work];
      const carried = { raised: false, runs: runs.map((r) => r.runId) };
      const entry = { work, lane: current.data?.lane ?? last.lane, via: 'try-again', key, at: now().toISOString(), queued: current.at ?? null, carried, ...(isText(last.branch) ? { branch: last.branch, carryOn: true } : {}) };
      state.returning.push(entry);
      await askAboutRestart(entry, why === 'alone' ? failedCardWords(titleOf(views, work), last.outcome === 'cancelled' ? 'cancelled' : last.failure) : restartStrandedWords(titleOf(views, work), why));
    }
  }
  // Quick, small or bug work whose last run failed or was cancelled, with no hold behind it and no place kept, which no other
  // card asks about: past its retries, or a kind that has none. All stop's own cancels wait for a Carry on, and a run the
  // director stopped stays stopped.
  function lonePiece(views, work) {
    if (views.work[work]?.work?.data?.lane === 'feature') return false;
    const run = latestRun(views, work);
    if (run?.state !== 'ended' || !['failed', 'cancelled'].includes(run.outcome)) return false;
    return !(stoppedRuns() ?? []).includes(run.runId) && !stoppedByDirector(views, work, run.runId) && !namedByCard(views, run.runId, run.outcome) && !leftByDirector(views, work);
  }

  // Work whose dependency can't be added: closed, not on the record, or waiting on the work itself.
  // No piece at the far end can be asked about, so the card is the held piece's own, once for each queueing.
  async function cutOffTick(views, decided, going) {
    if (stopped() || incidentOpen(views)) return;
    const reports = isPlain(views.reports) ? views.reports : {};
    const cannot = (dep) => {
      const current = views.work?.[dep]?.work;
      return !isPlain(current) || (reports[dep]?.data?.outcome !== 'merged' && endedBy(reports, dep, current));
    };
    for (const { work, why, by } of noCardBehind({ hold: decided.hold, running: goingNow(views, decided, going), cards: cardsNow(views) })) {
      const current = views.work?.[work]?.work;
      if (why !== 'dependency' || !isPlain(current) || state.cutOffFor[work] === current.at) continue;
      // Queued again with its card still open: that card stands for this queueing too.
      if (state.cutOffAsked[work] !== undefined) {
        state.cutOffFor[work] = current.at;
        keep();
        continue;
      }
      const lost = by.filter(cannot);
      const circle = lost.length === 0 && waitsOnItself({ hold: decided.hold, work });
      if (lost.length === 0 && !circle) continue;
      state.restartCards += 1;
      const id = `q-${work}-${RESTART_QUESTIONS + state.restartCards}`;
      state.cutOffAsked[work] = id;
      state.cutOffFor[work] = current.at;
      keep();
      const title = titleOf(views, work);
      const names = (circle ? by : lost).map((dep) => titleOf(views, dep));
      await askDirector('restart', {
        id, work, level: 3,
        what: circle ? waitsOnItselfWords(title, names) : cutOffWords(title, names),
        why: 'Whether work goes on without what it was to follow is yours to decide, at level 3.',
        options: [
          { label: START_ANYWAY, says: startAnywayWords(names) },
          { label: STOP_HERE, says: 'It ends here and nothing of it starts. Any work that depends on it comes to you next.' },
        ],
        recommendation: STOP_HERE,
      });
    }
  }
  // Its answer: a waiver for this queueing, or the piece ended, with its dependents then asked about in their turn.
  async function cutOffAnswers(views) {
    for (const [work, id] of Object.entries(state.cutOffAsked)) {
      const label = views.questions?.[id]?.answer?.label;
      const current = views.work?.[work]?.work;
      // Begun or ended meanwhile: the card has nothing left to decide.
      const settled = !isPlain(current) || runsOfWork(views, work).some((r) => since(r, current));
      if (!settled && label === START_ANYWAY) state.waived[work] = current.at;
      else if (!settled && label === STOP_HERE) {
        const words = cutOffStoppedWords(titleOf(views, work));
        await write('report', { work, outcome: 'closed', summary: words, rulings: [] });
        await write('note', { about: 'engine', work, words });
      } else if (!settled) continue;
      delete state.cutOffAsked[work];
      keep();
    }
  }

  // Each pull request a goal's areas hold back: one card for its head, and then what its answer asks. Allow this once is
  // answered by a signed record, kept by head, so a new head asks again. The card's id says which head it is for, so an
  // older card decides nothing here. A fix's own step carries its merge on the answer.
  async function areaTick(views) {
    if (stopped()) return;
    await handAllowed(views);
    const reports = isPlain(views.reports) ? views.reports : {};
    const held = areasHeld() ?? {};
    for (const pr of Object.keys(state.areas)) {
      if (held[pr] === undefined) {
        delete state.areas[pr];
        keep();
      }
    }
    for (const [pr, hold] of Object.entries(held)) {
      const { work, head, paths, fix } = hold;
      if (fix !== true && (reports[work]?.data?.outcome === 'merged' || endedBy(reports, work, views.work?.[work]?.work))) {
        settleAreas(pr, 'gone');
        continue;
      }
      const id = areaQuestion(work, head);
      if (state.areas[pr]?.id !== id) {
        state.areas[pr] = { id, work, head };
        keep();
      }
      if (views.questions?.[id] === undefined) {
        await askDirector('restart', {
          id, work, level: 3, what: areaCardWords(titleOf(views, work), pr, paths), why: AREA_CARD_WHY,
          options: [
            { label: ALLOW_ONCE, says: ALLOW_ONCE_SAYS },
            { label: STOP_HERE, says: `Nothing of it is added, and its files are free for other work. ${prLeftOpenWords(pr)}` },
          ],
          recommendation: STOP_HERE,
        });
        continue;
      }
      const label = areaAnswer(views, work, head);
      if (fix === true && [ALLOW_ONCE, STOP_HERE].includes(label)) settleAreas(pr, 'fix');
      else if (label === STOP_HERE) {
        const words = areaStoppedWords(titleOf(views, work));
        if (views.work?.[work]?.work?.data?.lane === 'feature') await endFeature(work, state.features[work] ??= {}, words);
        else {
          await write('report', { work, outcome: 'closed', summary: words, rulings: [] });
          release(work, views);
        }
        settleAreas(pr, 'stop');
      } else if (label === ALLOW_ONCE) {
        // Kept before it is marked ready, so a crash between the two still hands it over.
        if (!isLocal()) state.allowed[pr] = { work, said: false };
        keep();
        settleAreas(pr, 'ready');
      }
    }
    await handAllowed(views);
  }
  // Each pull request allowed on a host goes to the queue again, as an approved parked one does, and is tried on each tick
  // until the queue takes it or its work has gone, as a marked-ready change the queue never holds would be lost unseen. A
  // project in git alone needs only its ready record.
  async function handAllowed(views) {
    for (const [pr, kept] of Object.entries(state.allowed)) {
      const got = await handBack({ pr: Number(pr) });
      if (got?.ok === true || got?.gone === true) delete state.allowed[pr];
      else if (got?.waiting !== true && !kept.said) {
        kept.said = true;
        await write('note', { about: 'engine', work: kept.work, words: `${titleOf(views, kept.work)}: ${got?.refused ?? 'the merge queue didn\'t take it'}. Wheelhouse keeps trying.` });
      }
      keep();
    }
  }

  // Each tick, what stands behind work that can't start (scripts/engine/stuck.js). The note is written when the answer
  // changes; anything that moves or is about to means there is no top card, and All stop or an incident has its own.
  async function topTick(views, decided, going) {
    const cards = cardsNow(views);
    // What a card holds isn't going, so neither a pull request of a piece on a card nor a merge queue paused on one counts.
    const running = goingNow(views, decided, going);
    const top = stopped() || incidentOpen(views) ? null : topCard({ hold: decided.hold, running, cards });
    const counts = holdsUpCount({ hold: decided.hold });
    const holding = {};
    for (const { id, work } of cards) if (counts[work] > 0) holding[id] = Math.max(holding[id] ?? 0, counts[work]);
    const said = { id: top?.card.id ?? null, holdsUp: top?.holdsUp ?? 0, holding };
    const words = JSON.stringify(said);
    if (words !== (state.topCard ?? JSON.stringify({ id: null, holdsUp: 0, holding: {} }))) {
      await write('note', { about: 'top-card', ...said });
      state.topCard = words;
      keep();
    }
    const bare = noCardBehind({ hold: decided.hold, running, cards });
    for (const work of Object.keys(state.noCardSaid)) if (!bare.some((h) => h.work === work)) delete state.noCardSaid[work];
    for (const { work, why, by } of bare) {
      const key = `${why}:${[...by].sort().join(',')}`;
      if (state.noCardSaid[work] === key) continue;
      await write('note', { about: 'engine', work, words: noCardBehindWords(titleOf(views, work), why, by.map((b) => titleOf(views, b))) });
      state.noCardSaid[work] = key;
      keep();
    }
    await unmarkedTick(views, decided, going);
  }

  // A finished run's pull request, open and never marked ready, of a piece keeping a place that other work waits for. It may
  // yet be marked, so the Logbook says so only after a while, once for that pull request.
  async function unmarkedTick(views, decided, { ready }) {
    const waitedOn = decided.hold.some((h) => h.why === 'pace');
    for (const work of Object.keys(state.unmarkedSeen)) if (!decided.live.includes(work)) delete state.unmarkedSeen[work];
    for (const work of decided.live) {
      const last = [...new Map(runsOfWork(views, work).map((r) => [r.data.runId, r.data])).values()].at(-1);
      const open = last?.state === 'ended' && last.outcome === 'completed' && Number.isInteger(last.pr) && !prGone(views, work, last.pr) && !ready.some(([, r]) => r.work === work) && !Object.hasOwn(parkedPrs() ?? {}, last.pr) && !waitingNow(views).has(work);
      const seen = state.unmarkedSeen[work];
      if (!open) {
        if (seen) delete state.unmarkedSeen[work];
        continue;
      }
      if (seen?.pr !== last.pr) {
        state.unmarkedSeen[work] = { pr: last.pr, at: now().toISOString(), said: false };
        keep();
      } else if (waitedOn && !seen.said && now().getTime() - Date.parse(seen.at) >= WAKE_LATE_MS) {
        seen.said = true;
        keep();
        await write('note', { about: 'engine', work, words: unmarkedPrWords(titleOf(views, work), last.pr) });
      }
    }
  }

  // Ends a piece's reservation and remembers the run it was for, so an open card of that run can't take it back.
  function release(work, views = readViews() ?? {}) {
    state.released[work] = views.runs?.[work]?.at(-1)?.data?.runId ?? null;
    delete state.reserved[work];
    keep();
  }

  // { [pr]: the head marked ready } for what the queue has left alone. The queue brings a change up to date itself, so the
  // head it left needn't be the one marked ready: what makes one the queue's again is being marked ready at a new head.
  function leftAlone(ready) {
    const left = parkedPrs() ?? {};
    const kept = (state.leftAt ??= {});
    let changed = false;
    for (const pr of Object.keys(kept)) if (left[pr] !== kept[pr].left) { delete kept[pr]; changed = true; }
    for (const [pr, head] of Object.entries(left)) {
      if (kept[pr] === undefined && typeof ready[pr]?.head === 'string') { kept[pr] = { left: head, ready: ready[pr].head }; changed = true; }
    }
    if (changed) keep();
    return Object.fromEntries(Object.entries(kept).map(([pr, k]) => [pr, k.ready]));
  }

  // Work held for the plan's counted requests: one card for each hold, in the engine's own words where the cap is none. A
  // hold ends when nothing is held and its card has been answered, or when what holds it changes, answered or not, since the
  // card's words no longer stand: a new cap, or the count confirmed. All stop, an incident and a limit hide a hold, and end none. An unconfirmed count holds whatever the cap, so that card
  // offers no number: it can only keep the work or end it.
  async function requestsTick(views, held, s) {
    const label = views.questions?.[state.requestsAsked]?.answer?.label;
    const answered = typeof label === 'string';
    const forget = () => {
      Object.assign(state, { requestsAsked: null, requestsFor: null });
      keep();
    };
    if (held.length === 0) {
      if (answered && !stopped() && !incidentOpen(views) && !atLimit(views)) forget();
      return;
    }
    const unconfirmed = held.some((h) => h.why === 'requests-unconfirmed');
    const cap = Number.isFinite(s.capRequests) ? s.capRequests : 0;
    const key = unconfirmed ? 'unconfirmed' : `cap:${cap}`;
    // A card from the version before kept no key, and said the cap was none.
    if (state.requestsAsked && (state.requestsFor ?? 'cap:0') === key) {
      if (unconfirmed && label === STOP_HERE) {
        for (const { work } of held) {
          const words = requestsStoppedWords(titleOf(views, work));
          await write('report', { work, outcome: 'closed', summary: words, rulings: [] });
          await write('note', { about: 'engine', work, words });
        }
        forget();
      }
      return;
    }
    state.restartCards += 1;
    const id = `q-${held[0].work}-${RESTART_QUESTIONS + state.restartCards}`;
    Object.assign(state, { requestsAsked: id, requestsFor: key });
    keep();
    await askDirector('requests', {
      id, work: held[0].work, level: 3,
      what: unconfirmed ? engine.words?.requestsUnconfirmed ?? REQUESTS_UNCONFIRMED_WORDS : cap > 0 ? requestsUsedWords(cap) : engine.words?.requestsHeld ?? REQUESTS_WORDS,
      why: unconfirmed ? 'Whether that work waits or ends is yours to decide; nothing of the plan\'s requests is used either way.' : 'Spending your plan\'s requests is yours to allow; nothing is spent without your yes.',
      options: [
        { label: KEEP_OFF, says: 'That work keeps waiting, and nothing of the plan\'s requests is used.' },
        unconfirmed
          ? { label: STOP_HERE, says: 'The work held now ends here, and nothing of it starts.' }
          : { label: ALLOW_SOME, says: 'The settings show how many requests a month the build may use; you choose the number there.' },
      ],
      recommendation: KEEP_OFF,
    });
  }

  // A limit that holds other work is said once, until it has lifted.
  async function limitTick(limited) {
    if (limited === state.limitSaid) return;
    if (limited) await write('note', { about: 'engine', words: LIMIT_HOLD_WORDS });
    state.limitSaid = limited;
    keep();
  }

  // A parked pull request the director approved goes to the queue again. A hand-over writes a fresh work item, with no
  // `park` in its record, so the queue judges it as new; where it asks, the approval answers for the head it was given.
  // Never beside a live run, whose claim on the item this would write over, and never for work that has ended.
  async function handBack({ pr }) {
    if (await queueLive()) return { ok: false, waiting: true };
    const kept = (readyOf() ?? {})[pr];
    if (!isPlain(kept)) return { ok: false, refused: 'nothing records it as ready' };
    const views = readViews() ?? {};
    const reports = isPlain(views.reports) ? views.reports : {};
    if (endedBy(reports, kept.work, views.work?.[kept.work]?.work) || ['merged', 'closed'].includes(await stateOf(pr))) return { ok: false, gone: true };
    if (typeof engine.handOver !== 'function') return { ok: false, refused: 'the engine has no merge queue to hand it to' };
    const where = repoOf();
    if (!isText(where?.host)) return { ok: false, refused: 'the project\'s host can\'t be named' };
    const repo = repoName();
    const got = await engine.handOver({ project: folder, repo, pr, url: `https://${where.host}/${repo}/pull/${pr}`, runId: kept.runId, at: now().toISOString() });
    return got?.ok === true ? { ok: true } : { ok: false, refused: got?.refused ?? 'the engine didn\'t take it' };
  }

  async function tick() {
    await meterTick(readViews() ?? {}).catch(() => {});
    await owedTick();
    await fixTick();
    // Trouble with a reservation or an entry costs a tick nothing: each is looked at again on the next.
    await returnTick(readViews() ?? {}).catch(() => {});
    await areaTick(readViews() ?? {}).catch(() => {});
    try { heldTick(readViews() ?? {}); } catch { /* looked at again on the next tick */ }
    try { retryTick(readViews() ?? {}); } catch { /* looked at again on the next tick */ }
    await cutOffAnswers(readViews() ?? {}).catch(() => {});
    await featureTick();
    await mergedTick();
    const views = readViews() ?? {};
    pruneReturning(views);
    await reserveTick(views).catch(() => {});
    const s = settings() ?? {};
    const ready = readyOf() ?? {};
    const reports = isPlain(views.reports) ? views.reports : {};
    // A pull request whose work has ended, or one seen closed, no longer waits for the merge queue.
    const closedPrs = new Set([...state.closedPrs, ...Object.values(state.features).flatMap((f) => Object.keys(f?.closed ?? {}).map(Number))]);
    const ended = (work) => reports[work]?.data?.outcome === 'merged' || endedBy(reports, work, views.work?.[work]?.work);
    const leftAt = leftAlone(ready);
    const waiting = Object.entries(ready).filter(([pr, r]) => !ended(r.work) && !closedPrs.has(Number(pr)) && !Object.hasOwn(state.features[r.work]?.merged ?? {}, pr) && leftAt[pr] !== r.head);
    const newReady = waiting.some(([pr]) => !state.seenReady.includes(pr));
    const requests = typeof engine.countsRequests === 'function'
      ? { counts: () => engine.countsRequests(config()?.routing ?? {}) === true, used: await spentThisMonth(), cap: Number.isFinite(s.capRequests) ? s.capRequests : 0, confirmed: engine.requestsConfirmed === true }
      : null;
    const queueStatus = await mergeQueueStatus();
    const limited = atLimit(views);
    await limitTick(limited).catch(() => {});
    const decided = dispatch({
      work: views.work ?? {}, runs: views.runs ?? {}, reports, features: views.features ?? {}, settings: s, stop: stopped(),
      incident: Array.isArray(views.incidents?.open) && views.incidents.open.length > 0,
      capsReached: false, limited,
      mergeQueue: { running: queueHolds(queueStatus), lastStart: state.lastStart, waiting: waiting.length, newReady: newReady || state.queueDue === true },
      requests, sentBack: [
        ...Object.entries(state.sentBack).filter(([work, times]) => state.acted[work] !== times).map(([work, times]) => ({ work, times })),
        ...Object.entries(state.reds).filter(([work, red]) => state.redActed[work] !== red.times).map(([work, red]) => ({ work, times: red.times, reason: 'red' })),
      ], waiting: [...waitingNow(views)], reserved: reservedFiles(), returning: state.returning.map((e) => ({ ...e, ...(notYet(e) ? { asked: e.asked ?? e.key } : {}), ...(e.fresh === true ? { filesFree: true } : {}) })), admitted: state.admitted, stoppedFeatures: stoppedFeaturesOf(views, reports), waived: Object.keys(state.waived).filter((work) => state.waived[work] === views.work?.[work]?.work?.at), goal: goalNow(views), now: now(),
    });
    // What it admitted holds its place from here. A piece has one start at a time; each answer of it goes along.
    for (const { work } of decided.admit) {
      let starts = 0;
      for (const entry of state.returning.filter((e) => e.work === work && !e.asked && !notYet(e))) {
        if (!wakes(entry) && (starts += 1) > 1) continue;
        state.returning = state.returning.filter((e) => e !== entry);
        state.admitted.push(entry);
      }
      keep();
    }
    // An answer of a piece that already has its place goes along with it.
    for (const entry of state.returning.filter((e) => wakes(e) && !e.asked && state.admitted.some((a) => a.work === e.work))) {
      state.returning = state.returning.filter((e) => e !== entry);
      state.admitted.push(entry);
      keep();
    }
    const started = [];
    // The project's configuration and test command: without one Wheelhouse can run, nothing starts (a run would have
    // no done check), and the Logbook says so once.
    let pieces = [...decided.requeue, ...decided.start];
    const toStart = state.admitted.some((e) => !wakes(e) && !e.starting && !e.asked && typeof e.runId !== 'string');
    if ((pieces.length > 0 || toStart) && !canTest(config())) {
      decided.hold.push(...pieces.map((p) => ({ work: p.work, why: 'no-tests' })));
      decided.start = [];
      decided.requeue = [];
      pieces = [];
      if (!state.noTestsSaid) {
        state.noTestsSaid = true;
        keep();
        await write('note', { about: 'engine', words: NO_TESTS_WORDS });
      }
    } else if (state.noTestsSaid && (pieces.length > 0 || toStart)) {
      state.noTestsSaid = false;
      keep();
    }
    // A requeue has its place, so it goes straight onto `admitted`; what was sent back and acting on it are kept as one.
    for (const { work, lane, branch, reason } of decided.requeue) {
      const times = reason === 'red' ? state.reds[work].times : state.sentBack[work];
      if (reason === 'red') state.redActed[work] = times;
      state.acted[work] = state.sentBack[work];
      state.admitted.push({ work, lane, via: 'requeue', key: `requeue:${reason ?? 'clash'}:${times}`, at: now().toISOString(), queued: views.work?.[work]?.work?.at ?? null, branch, carryOn: true, ...(reason ? { reason } : {}) });
      keep();
    }
    // Returning work goes first. Under an incident or a limit what is admitted keeps its place and waits for it to end.
    if (canTest(config()) && !incidentOpen(views) && !limited) {
      for (const entry of [...state.admitted]) {
        if (stopped()) break;
        if (wakes(entry) || entry.starting || entry.asked || typeof entry.runId === 'string') continue;
        const got = await startEntry(entry);
        started.push({ work: entry.work, lane: entry.lane, ...got });
      }
    }
    for (const { work, lane } of pieces.filter((p) => decided.start.includes(p))) {
      if (stopped()) break;
      // Carry on after All stop has the answer and the branch, kept until a start takes them.
      const carry = state.carryOver[work];
      const args = carry ? { branch: carry.branch ?? null, carryOn: isText(carry.branch), answers: carry.answers ?? [] } : {};
      const startAt = now().toISOString();
      // Marked before it is called: a crash during it, or no reply in time, is settled as any start is. One with an answer has done with the mark.
      const entry = { work, lane, via: 'try-again', key: `start:${startAt}`, at: startAt, queued: views.work?.[work]?.work?.at ?? null, ...args, starting: true, startAt, firstStart: true };
      state.admitted.push(entry);
      keep();
      const got = await startPiece({ work, lane, ...args });
      if (carry && got?.ok === true) delete state.carryOver[work];
      // Held at the gate, it is still queued, so it keeps its place there and nothing need come back.
      if (got?.goalHeld === true) decided.hold.push({ work, why: got.why });
      if (got?.uncertain === true) {
        entry.uncertain = true;
        keep();
      } else if (got?.ok === true || got?.capped === true || got?.gone === true || got?.goalHeld === true || stopped()) leave(entry);
      else await refusedStart(entry, got);
      started.push({ work, lane, ...got });
    }
    // A second clash on the same work: one card, level 3. Try again brings it up to date once more.
    for (const { work } of decided.clashCards) {
      const times = state.sentBack[work];
      const id = `q-${work}-${OWN_QUESTIONS + times}`;
      if (state.clashAsked[work] === id) {
        const label = views.questions?.[id]?.answer?.label;
        if (label === TRY_AGAIN && state.acted[work] !== times && !stopped()) {
          const last = (views.runs?.[work] ?? []).at(-1)?.data;
          state.acted[work] = times;
          enter({ work, lane: last?.lane ?? views.work?.[work]?.work?.data?.lane, via: 'try-again', key: `clash:${times}`, branch: last?.branch ?? null, carryOn: true });
        }
        continue;
      }
      state.clashAsked[work] = id;
      keep();
      const title = views.work?.[work]?.work?.data?.title ?? work;
      await askDirector('clash', {
        id, work, level: 3,
        what: `${title} clashed with other changes twice when it was to be added, so it waits.`,
        why: 'Work that keeps clashing may need a different plan, which is yours to decide at level 3.',
        options: [
          { label: TRY_AGAIN, says: 'It brings the change up to date with the main line once more, and checks it again.' },
          { label: LEAVE_IT, says: 'It waits; nothing more is done to it until you say.' },
        ],
        recommendation: TRY_AGAIN,
      });
    }
    // A second red on the same work: one card, level 3. Try again goes back once more with the newest tail.
    for (const { work } of decided.redCards) {
      const { times } = state.reds[work];
      const id = `q-${work}-${RED_QUESTIONS + times}`;
      if (state.redAsked[work] === id) {
        const label = views.questions?.[id]?.answer?.label;
        if (label === TRY_AGAIN && state.redActed[work] !== times && !stopped()) {
          const last = (views.runs?.[work] ?? []).at(-1)?.data;
          state.redActed[work] = times;
          enter({ work, lane: views.work?.[work]?.work?.data?.lane, via: 'try-again', key: `red:${times}`, branch: last?.branch ?? null, carryOn: true, reason: 'red' });
        }
        continue;
      }
      state.redAsked[work] = id;
      keep();
      const title = views.work?.[work]?.work?.data?.title ?? work;
      await askDirector('red', {
        id, work, level: 3,
        what: `${title} failed the project's tests on this computer twice, so it waits and nothing of it is added.`,
        why: 'Work that keeps failing the tests may need a different plan, which is yours to decide at level 3.',
        options: [
          { label: TRY_AGAIN, says: 'It goes back to be mended once more, with what the tests said.' },
          { label: LEAVE_IT, says: 'It waits; nothing more is done to it until you say.' },
        ],
        recommendation: TRY_AGAIN,
      });
    }
    if (localQueue !== null && isLocal()) {
      if (waiting.length > 0 && !stopped()) await localQueue();
    } else if (decided.startMergeQueue && !stopped()) {
      startingQueue ??= startQueue(waiting).finally(() => { startingQueue = null; });
      await startingQueue;
    }
    if (state.queueFault) await queueFaultTick(views, waiting, queueStatus).catch(() => {});
    await requestsTick(views, decided.hold.filter((h) => h.why === 'requests' || h.why === 'requests-unconfirmed'), s).catch(() => {});
    const going = { queueStatus, ready: waiting, started };
    await strandedTick(readViews() ?? {}, decided, going).catch(() => {});
    await cutOffTick(readViews() ?? {}, decided, going).catch(() => {});
    await topTick(readViews() ?? {}, decided, going).catch(() => {});
    return { ...decided, started };
  }

  return {
    tick,
    // The work a merge-queue run the dispatcher started stands for ({ work: MERGE_WORK, lane: 'merge' }), or null: no
    // `run` record names it, so its asks are found from here.
    workOf: (runId) => (state.mergeRuns.includes(runId) ? { work: MERGE_WORK, lane: 'merge', branch: null } : null),
    // A ruling to merge: the queue starts on the first tick after the answered run ends, not at the next sweep. Archon's
    // ruling step tries to start it too, but from there it lacks the project and the run's models, and the helper
    // wouldn't know the run (docs/engine/archon-upstream-note.md); if that start works, the helper folds its own into it.
    queueDue() {
      state.queueDue = true;
      keep();
    },
    // Asks for a place back: idempotent by `work` and `key`, and kept until its run is seen to start.
    enter,
    // Whether a piece has been given its place and may be sent its answer.
    admittedTo: (work, key) => state.admitted.some((e) => e.work === work && (key === undefined || e.key === key)),
    // Whether a failed run may yet be resumed, so its spend and reviews wait: its piece hasn't ended or moved on, and for a
    // fix, its incident is still open and it is the latest fix. Views that can't be read leave it as it is.
    retrying(runId) {
      try {
        const views = readViews() ?? {};
        const [work, list] = Object.entries(isPlain(views.runs) ? views.runs : {}).find(([, records]) => (records ?? []).some((r) => r?.data?.runId === runId)) ?? [];
        if (work === undefined) return false;
        if (openRedMain(views)?.work === work) return list.at(-1)?.data?.runId === runId;
        // A resume cut short by a crash reads as started, and is still its piece's to finish.
        const run = runOfOpenWork(views, work);
        return run?.runId === runId && (run.state !== 'ended' || retryFor(views, work) !== null);
      } catch {
        return true;
      }
    },
    retryingWork,
    // The retries with a place, for the runner to carry out: [{ work, key, runId, delivered }].
    retriesAdmitted: () => state.admitted.filter((e) => e.via === 'retry').map(({ work, key, runId, delivered: told }) => ({ work, key, runId, delivered: told === true })),
    // The runner's word that a lost run has gone, so its carry-on may ask for a place. Whether it is still on the list.
    lostCleared(work, key) {
      const entry = state.returning.find((e) => e.work === work && e.key === key);
      if (!entry) return false;
      delete entry.cancelling;
      keep();
      return true;
    },
    // Whether a piece waits for a place. One admitted holds its place.
    comingBack: (work) => state.returning.some((e) => e.work === work),
    // The runner's mark that an answer went back: its entry then waits for the run to be seen running.
    delivered(work, key) {
      const entry = state.admitted.find((e) => e.work === work && e.key === key);
      if (!entry || entry.delivered) return;
      Object.assign(entry, { delivered: true, deliveredAt: now().toISOString() });
      keep();
    },
    // An answer refused or not used: nothing is on its way back for it.
    drop(work, key) {
      for (const entry of [...state.returning, ...state.admitted].filter((e) => e.work === work && e.key === key)) leave(entry);
    },
    // Give it more's fallback: a run that can't be resumed starts on the place already held, as a start from here.
    startAdmitted({ work, key, ...args }) {
      const entry = state.admitted.find((e) => e.work === work && e.key === key);
      if (!entry) return { ok: false, refused: 'it has no place yet', noPlace: true };
      // In hand already, after a crash part way: `returnTick` settles it, and nothing starts a second run.
      if (entry.startsRun === true) return { ok: false, refused: 'it is starting already' };
      delete entry.runId;
      Object.assign(entry, args, { startsRun: true });
      return startEntry(entry);
    },
    // `fn(runId, carried)`, for the runner's spend carried over.
    onStarted(fn) { if (typeof fn === 'function') carriedBy = fn; },
    // What All stop left for Carry on: the branch and the answers so far, until a start takes them.
    carryOver(work, { branch = null, answers = [] }) {
      const before = state.carryOver[work]?.answers ?? [];
      const said = new Set(before.map((a) => JSON.stringify(a)));
      state.carryOver[work] = { branch: branch ?? state.carryOver[work]?.branch ?? null, answers: [...before, ...answers.filter((a) => !said.has(JSON.stringify(a)))] };
      keep();
    },
    // A pull request sent back, by the merge gate for a clash or by the check runner for a red head, with the end of the
    // check's output: started again on the next tick, or a card the second time. Reds and clashes count apart.
    sentBack(work, reason = 'clash', tail = null) {
      if (reason === 'red') state.reds[work] = { times: (state.reds[work]?.times ?? 0) + 1, tail };
      else state.sentBack[work] = (state.sentBack[work] ?? 0) + 1;
      keep();
    },
    // Who tells this of the card router's cards: the runner, through its `waitingWork`.
    onWaiting(fn) { if (typeof fn === 'function') routerPieces = fn; },
    onOwed(fn) { if (typeof fn === 'function') routerOwed = fn; },
    // And of the pieces going back to work on an answer: the runner's `reworkWork`.
    onReworks(fn) { if (typeof fn === 'function') reworkingNow = fn; },
    // And of the runs that lost their process: the runner's `lostNow`.
    onLost(fn) { if (typeof fn === 'function') lostNow = fn; },
    // And of the cards themselves: the runner's `openCards`.
    onCards(fn) { if (typeof fn === 'function') routerCardsNow = fn; },
    // Who tells this of the pull requests the queue has left alone, { [pr]: head }: the runner.
    onParked(fn) { if (typeof fn === 'function') parkedPrs = fn; },
    handBack,
    // Whether a pull request the director sent back can go to its piece: { ok }, { ok: false, gone } for work that has ended or
    // a pull request closed or merged, and { ok: false } when the host can't say, to be asked again on the next tick.
    async takeBack({ pr, work }) {
      const views = readViews() ?? {};
      const current = views.work?.[work]?.work;
      if (!isPlain(current) || endedBy(isPlain(views.reports) ? views.reports : {}, work, current)) return { ok: false, gone: true };
      const seen = await stateOf(pr);
      if (seen === 'open') return { ok: true };
      return seen === null ? { ok: false } : { ok: false, gone: true };
    },
    notReady: (pr) => notReady(pr),
    // A change marked ready on a project in git alone, whose local queue parks nothing: { head, work, ... }, or null.
    localChange: (pr) => (localQueue !== null && isLocal() ? (readyOf() ?? {})[pr] ?? null : null),
    // Every piece that waits on the director, by a card of the router's or one of these.
    waitingWork: () => waitingNow(readViews() ?? {}),
    // The files held for each piece, { [work]: paths }.
    reserved: () => reservedFiles(),
    // Ends a piece's reservation, for an end that writes no report.
    release: (work) => release(work),
    // A head of `work` passed: its reds are behind it, so a later slice's first red is a first red.
    passed(work) {
      if (state.reds[work] === undefined) return;
      for (const kept of [state.reds, state.redActed, state.redAsked, state.redNoted]) delete kept[work];
      keep();
    },
  };
}
