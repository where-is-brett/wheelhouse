// scripts/engine/dispatch-run.js
// The dispatcher's runner, in the helper: reads the record's views, asks `dispatch` what to start, and starts it
// through the helper's own start (no route starts a run). Each piece gets its work order, with the project's caps and
// the work's decision level; the merge queue is started from here too, one run at a time, and a queue run Archon's own
// ruling step started counts as that run: the helper folds its start into it. Work held because it would
// use the plan's counted requests brings one card, once, in the engine's own words. A red main line's incident comes
// first each tick (section 7.7, fix-main.js): one fix run for it, the incident closed once the main line reads green,
// and one card when a fix didn't make it green. A feature runs its slices one after another (feature.js): each next one
// starts once the slice before has merged, and the feature's own run once every slice has. A feature held up with
// nothing to move it on (a pull request closed unmerged, a run rejected or cancelled with no card of its own) brings one
// card; Stop here ends it with a `closed` report, which frees its place. Other work whose run's pull request merged
// gets its `merged` report. A piece waiting on the director keeps its files reserved: what it was expected to touch and
// what its branch has changed, read each time it parks, until its work merges or ends or the runner says it has. What
// it keeps (the merge queue's run and when it last started, the pull requests already seen ready, the clashes, the
// fixes, the reservations, the work on its way back) is in `file`. Every way back asks for a place in one list (delegated
// decisions design, section 8.3): an entry stays on `returning` until `dispatch` admits it, and on `admitted`, holding its
// place, until its run is seen running. The runner wakes a paused run once admitted; a new run is started from here. A
// start is marked before it is called, so one that timed out or a crash during it is settled before anything starts again.
import fs from 'node:fs';
import path from 'node:path';
import { dispatch, MERGE_WORK } from './dispatcher.js';
import { reservedUnreadWords, noCardBehindWords, restartRefusedWords, restartCardWords, restartUnsureWords, restartStrandedWords, wakeLateWords, STOPPED_RESTART_WORDS, ORPHAN_LEFT_WORDS } from './words.js';
import { workOrder } from './order.js';
import { limitsFor } from './caps.js';
import { ENGINE_QUESTIONS } from './router.js';
import { openRedMain, fixDecision, fixOrder } from './fix-main.js';
import { readSlices, featureProgress, featureNext, currentStep, sliceOrder, finishOrder, featureCap, demoSlice } from './feature.js';
import { ownWaiting, ownCards } from './waiting.js';
import { topCard, holdsUpCount, noCardBehind } from './stuck.js';
import { STOP_LABEL } from './runner.js';
import { since, endedBy } from '../foreman/queue.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const EMPTY = () => ({ mergeRun: null, mergeRuns: [], lastStart: null, seenReady: [], queueDue: false, sentBack: {}, acted: {}, clashAsked: {}, reds: {}, redActed: {}, redAsked: {}, redNoted: {}, requestsAsked: null, noTestsSaid: false, fixes: {}, features: {}, shipped: {}, closedPrs: [], reserved: {}, released: {}, stranded: {}, topCard: null, noCardSaid: {}, returning: [], admitted: [], carryOver: {}, restartCards: 0 });
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
// What wakes a paused run, which the runner carries out once admitted. Every other `via` starts a new run from here.
const WAKES = Object.freeze(['answer', 'resume', 'more']);
// What an entry's run may read as for it to give its entry up. `unknown` is a run the engine no longer has, with nothing to wait for.
const SEEN = Object.freeze(['running', 'ended', 'unknown']);
// How long an answered run may sit paused before the Logbook says so: only the engine's waker carries it on (check 85).
export const WAKE_LATE_MS = 5 * 60 * 1000;
// The summary of the report for quick, small and bug work whose pull request merged.
export const MERGED_WORDS = 'Added to the main line.';
// On every merge while a project's tests aren't counting (ruling 2): it rests on review and the work's own done checks.
export const NOT_COUNTING_WORDS = 'Tests aren\'t counting yet';
export const CLOSED_WORDS = 'Its pull request was closed without being added.';
// The fix card's numbers, after the clash cards' and the requests card's.
const FIX_QUESTIONS = OWN_QUESTIONS + 5000;
// The second-red cards' numbers, after the clash cards'.
const RED_QUESTIONS = OWN_QUESTIONS + 3000;
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
// `answers` the director's answers to the work's earlier questions, from the helper's own record.
export function orderFor(entry, { settings = {}, raised = false, config = {}, answers = [] } = {}) {
  const data = entry.work.data;
  const done = Array.isArray(data.done) && data.done.length > 0 ? data.done : config.testsNotCounting === true ? [] : [{ command: config.testCommand, expect: 0 }];
  return workOrder({
    work: { id: data.id ?? entry.work.key, lane: data.lane, goal: data.goal ?? data.title, done, visible: data.visible === true, level: data.level, notInScope: data.notInScope ?? [], protectedFiles: data.protectedFiles ?? [] },
    config,
    routing: config.routing ?? {},
    caps: limitsFor(data.lane, settings, { raised }),
    answers,
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
// - `engine.liveRunOf({ work, since })`, where the engine has it, says of a start that may have happened: { runId },
//   null for none, undefined when it can't say. Without it the answer is undefined, so a card comes and not a second start.
export function dispatchRun({ engine, project, folder, file, readViews, settings = () => ({}), stopped: allStop = () => false, moving = () => false, now = () => new Date(), start, write = async () => {}, readyOf = () => ({}), config = () => ({}), spentThisMonth = () => 0, mainGreen = async () => null, stoppedRuns = () => [], fixedRuns = () => [], prMerged = async () => null, prState = null, designOf = () => null, orderOf = () => null, repoOf = () => null, repoName = () => null, queueFolder = async () => ({ ok: false, refused: 'no folder for the merge queue' }), queuePlace = null, openedBy = () => null, localQueue = null, isLocal = () => true, onCard = () => {}, branchPaths = async () => [] } = {}) {
  const stopped = () => allStop() || moving();
  let state = readState(file);
  // The pieces with a card of the card router's open, from the runner, which is built after this.
  let routerPieces = () => new Set();
  let parkedPrs = () => ({});
  const waitingNow = (views) => {
    const pieces = new Set(ownWaiting({ state, views }));
    try { for (const work of routerPieces()) pieces.add(work); } catch { /* it reads as none, so each keeps its place */ }
    return pieces;
  };
  let routerCardsNow = () => [];
  const cardsNow = (views) => {
    let theirs = [];
    try { theirs = routerCardsNow(); } catch { /* it reads as none, so a hold shows as having no card */ }
    return [...ownCards({ state, views }), ...theirs];
  };
  // A question of the dispatcher's own, and then a word to the seals, whose trouble is never the card's.
  async function askDirector(kind, data) {
    await write('question', data);
    try { onCard({ id: data.id, kind, work: data.work, level: data.level }); } catch { /* it costs a seal, never a card */ }
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

  async function startPiece({ work, lane, branch = null, carryOn = false, raised = false, answers = [], checkTail = null }) {
    const views = readViews() ?? {};
    const entry = views.work?.[work];
    if (!isPlain(entry?.work?.data)) return { ok: false, refused: 'there is no such work', gone: true };
    if (!canTest(config())) return { ok: false, refused: 'Wheelhouse doesn\'t know how to run the project\'s tests' };
    if (entry.work.data.lane === 'feature') return startFeature({ views, entry, work, lane, branch, carryOn, raised, answers, checkTail });
    let order;
    try { order = orderFor({ ...entry, work: { ...entry.work, key: work } }, { settings: settings() ?? {}, raised, config: config() ?? {}, answers }); } catch (error) { return { ok: false, refused: error.message }; }
    if (order.lane !== lane) return { ok: false, refused: 'the work\'s lane changed' };
    return start({ project, order: withTail(order, checkTail), ...(branch ? { branch } : {}), carryOn });
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
    return { refused: `the feature's design ${problem}` };
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
    if (found.refused) return { ok: false, refused: found.refused };
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
    const args = { entry: { ...entry, work: { ...entry.work, key: work } }, design, config: config() ?? {}, settings: settings() ?? {}, raised, answers };
    try { order = step.finish ? finishOrder({ ...args, progress }) : sliceOrder({ ...args, n: step.slice }); } catch (error) { return { ok: false, refused: error.message }; }
    const got = await start({ project, order: withTail(order, checkTail), ...(branch ? { branch } : {}), carryOn });
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
      if (onTheWay(work)) continue;
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
  async function endFeature(work, kept, words) {
    if (kept.ended) return;
    await write('report', { work, outcome: 'closed', summary: FEATURE_STOPPED, rulings: [] });
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

  // A feature whose current step's latest run ended and nothing moves it on: its pull request was closed unmerged, or
  // the run was cancelled (a rejected demo or switch-on, or a cancel in the engine itself) with no card of its own and
  // not by All stop. One card for that run; Build it again carries the step on from its branch, Stop here ends the
  // feature.
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
    if (stopped()) return;
    const what = step.finish ? 'its switch-on run' : `slice ${step.slice} of ${design.slices.length}`;
    let why = null;
    if (Number.isInteger(run.pr) && kept.closed?.[run.pr]) why = 'closed';
    else if (run.outcome === 'cancelled' && !(stoppedRuns() ?? []).includes(run.runId) && !namedByCard(views, run.runId)) why = 'cancelled';
    else if (run.outcome === 'failed' && !Number.isInteger(run.pr) && !namedByCard(views, run.runId) && !onTheWay(work) && state.sentBack[work] === state.acted[work] && state.reds[work]?.times === state.redActed[work]) {
      // Looked at again on the next tick: the runner may yet have an answer that starts it again.
      if (kept.failedSeen !== run.runId) {
        kept.failedSeen = run.runId;
        keep();
        return;
      }
      why = 'failed';
    }
    if (!why) return;
    kept.stallCards = (kept.stallCards ?? 0) + 1;
    const id = `q-${work}-${STALL_QUESTIONS + kept.stallCards}`;
    const demo = !step.finish && demoSlice(design) === step.slice;
    const happened = why === 'closed'
      ? `Pull request #${run.pr} for ${what} of ${title} was closed without being added, so the feature waits.`
      : why === 'failed'
        ? `The run building ${what} of ${title} failed before it was added, so the feature waits.`
      : step.finish
        ? `${title}'s switch-on wasn't approved, so the feature stays off and waits.`
        : demo
          ? `The midpoint demo of ${title} (${what}) wasn't approved, so the feature waits.`
          : `The run building ${what} of ${title} was stopped before it was added, so the feature waits.`;
    const options = [
      { label: BUILD_AGAIN, says: `It builds ${what} again from its branch, with a new pull request${step.finish || demo ? ', and shows it to you again' : ''}.` },
      { label: STOP_HERE, says: 'The feature ends here; the slices already added stay behind their switch, and its place is free for other work.' },
    ];
    await askDirector('stall', {
      id, work, level: 3,
      what: `${happened} Nothing more of it starts until you say.`,
      why: 'Whether a feature goes on when one of its steps was turned down is yours to decide, at level 3.',
      options,
      recommendation: why === 'closed' ? STOP_HERE : BUILD_AGAIN,
    });
    kept.stalls[run.runId] = { id, done: false };
    keep();
  }
  // Whether a card already speaks for this run's end: the runner's cap card for it, or a question about it still
  // waiting for the director. A question answered earlier in the run doesn't.
  function namedByCard(views, runId) {
    return Object.values(isPlain(views.questions) ? views.questions : {}).some((q) => {
      const engineRef = q?.question?.data?.engine;
      // A piece that left its bundle has no card to speak for it.
      return engineRef?.runId === runId && q.gone !== true && (engineRef.ask === `cap:${runId}` || !isPlain(q.answer));
    });
  }

  // The features that stay stopped: the latest run ended by All stop, or at its cap by the director's Stop. Each is taken
  // up by a Carry on, so none holds a place meanwhile. A question at a run's cap names the run as `cap:<run>`.
  function stoppedFeaturesOf(views, reports) {
    const stops = new Set(stoppedRuns() ?? []);
    for (const q of Object.values(isPlain(views.questions) ? views.questions : {})) {
      const engineRef = q?.question?.data?.engine;
      if (engineRef?.ask === `cap:${engineRef?.runId}` && q.answer?.label === STOP_LABEL) stops.add(engineRef.runId);
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
    const decided = fixDecision({ incident, runs, green, stop: stopped(), stopped: stoppedRuns() ?? [], merged: fixedRuns() ?? [], kept });
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
    } else if (decided.act === 'start') {
      let order;
      try { order = fixOrder(incident, { config: config() ?? {}, settings: settings() ?? {}, revert: decided.revert === true }); } catch { return; }
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
  }
  // One start at a time, and none beside a live queue run the helper didn't start, which is taken as the queue's run
  // instead: what is due stays due, so a run that started without the project's models is followed once it ends. An
  // engine that can't say what is live starts nothing this tick.
  let startingQueue = null;
  async function startQueue(waiting) {
    if (await mergeQueueRunning()) return;
    // Asked before `queueFolder()`, which resets the folder a live run would be working in.
    const place = queuePlace?.() ?? null;
    if (place !== null && typeof engine.queueRuns === 'function') {
      let live = null;
      try { live = await engine.queueRuns({ folder: place }); } catch { live = null; }
      if (!Array.isArray(live)) return;
      if (live.length > 0) {
        ownQueueRun(live[0]);
        keep();
        return;
      }
    }
    let where = null;
    try { where = await queueFolder(); } catch { where = null; }
    if (where?.ok !== true) return;
    const got = await engine.start({ lane: 'merge', project: where.folder, repo: repoOf() });
    if (got?.ok) {
      ownQueueRun(got.runId);
      state.lastStart = now().toISOString();
      state.seenReady = waiting.map(([pr]) => pr);
      state.queueDue = false;
      keep();
    }
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
    const pieces = waitingNow(views);
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
  async function askAboutRestart(entry, what) {
    state.admitted = state.admitted.filter((e) => e !== entry);
    if (!state.returning.includes(entry)) state.returning.push(entry);
    state.restartCards += 1;
    const id = `q-${entry.work}-${RESTART_QUESTIONS + state.restartCards}`;
    delete entry.starting;
    delete entry.uncertain;
    Object.assign(entry, { asked: id, askedWhat: what });
    keep();
    await restartCard(entry);
  }
  // Kept before it is written, so a write that fails is tried again on the next tick and the piece isn't left unasked.
  async function restartCard(entry) {
    await askDirector('restart', {
      id: entry.asked, work: entry.work, level: 3, what: entry.askedWhat,
      why: 'Whether work goes on when it can\'t be started again is yours to decide, at level 3.',
      options: [
        { label: TRY_AGAIN, says: 'It asks for a place and is started again.' },
        { label: STOP_HERE, says: 'Nothing more starts; what it has done so far is kept on its branch, and its files are free for other work.' },
      ],
      recommendation: TRY_AGAIN,
    }).catch(() => {});
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
    entry.refusals = (entry.refusals ?? 0) + 1;
    if (entry.refusals >= 2) {
      await askAboutRestart(entry, restartCardWords(titleOf(views, entry.work), why));
      return;
    }
    delete entry.starting;
    state.admitted = state.admitted.filter((e) => e !== entry);
    if (!state.returning.includes(entry)) state.returning.push(entry);
    keep();
    if (entry.reason === 'red') await redRefused(entry.work, got);
    else await write('note', { about: 'engine', work: entry.work, words: restartRefusedWords(titleOf(views, entry.work), why) });
  }

  async function startEntry(entry) {
    Object.assign(entry, { starting: true, startAt: now().toISOString() });
    keep();
    const { work, lane, branch = null, carryOn = false, raised = false, answers = [], reason } = entry;
    let got;
    try {
      got = await startPiece({ work, lane, branch, carryOn, raised, answers, ...(reason === 'red' ? { checkTail: state.reds[work]?.tail } : {}) });
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
    } else if (got?.capped === true || got?.gone === true) leave(entry); // The feature's cap card, or nothing left to start.
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
    const unsure = () => askAboutRestart(entry, restartUnsureWords(titleOf(views, entry.work)));
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
    delete entry.uncertain;
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
    for (const entry of [...state.returning]) {
      if (entry.asked && isPlain(views.questions) && !views.questions[entry.asked]) await restartCard(entry);
      const label = entry.asked ? views.questions?.[entry.asked]?.answer?.label : null;
      if (label === TRY_AGAIN) {
        delete entry.asked;
        entry.refusals = 0;
        keep();
      } else if (label === STOP_HERE) {
        // The feature's report first: one that fails keeps the entry, so the director's Stop is acted on next tick.
        const feature = views.work?.[entry.work]?.work?.data?.lane === 'feature';
        const current = views.work?.[entry.work]?.work;
        // Work with no run on record would read as queued, so it needs its report to stay stopped.
        const unstarted = !feature && isPlain(current) && !runsOfWork(views, entry.work).some((r) => since(r, current));
        const orphan = unstarted ? await endOrphan(entry) : false;
        if (feature) await endFeature(entry.work, state.features[entry.work] ??= {}, STOPPED_RESTART_WORDS(titleOf(views, entry.work)));
        else {
          if (unstarted) await write('report', { work: entry.work, outcome: 'closed', summary: STOPPED_RESTART_WORDS(titleOf(views, entry.work)), rulings: [] });
          release(entry.work, views);
        }
        leave(entry);
        if (!feature) await write('note', { about: 'engine', work: entry.work, words: `${STOPPED_RESTART_WORDS(titleOf(views, entry.work))}${orphan ? ` ${ORPHAN_LEFT_WORDS}` : ''}` });
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
      try { status = (await engine.inspect(entry.runId))?.status ?? null; } catch { status = null; }
      if (SEEN.includes(status) || records.at(-1)?.data?.state === 'ended' || pieces.has(entry.work)) {
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
  // A piece whose files hold other work up, with nothing to move it on: every run ended, no card, no way back and no pull
  // request still open, or left by the director. Nothing lets its files go by itself, so the director is asked once for that run.
  async function strandedTick(views, decided) {
    const waitingOn = waitingNow(views);
    for (const work of new Set(decided.hold.filter((h) => h.why === 'clash').flatMap((h) => h.by ?? []))) {
      if (state.reserved[work] === undefined || onTheWay(work) || waitingOn.has(work)) continue;
      // The director's Leave it: nothing was done to it, as the card said, and now its files hold other work.
      const left = [state.clashAsked[work], state.redAsked[work]].some((id) => views.questions?.[id]?.answer?.label === LEAVE_IT);
      if (!left && state.sentBack[work] !== state.acted[work] && state.sentBack[work] !== undefined) continue;
      if (!left && state.reds[work] !== undefined && state.reds[work].times !== state.redActed[work]) continue;
      const runs = new Map(runsOfWork(views, work).map((r) => [r.data.runId, { ...r.data }]));
      const last = [...runs.values()].at(-1);
      if (!last || [...runs.values()].some((r) => r.state !== 'ended')) continue;
      const prs = [...runs.values()].map((r) => r.pr).filter((pr) => Number.isInteger(pr) && !state.closedPrs.includes(pr));
      if (prs.length > 0 && !left) continue;
      const key = `stranded:${last.runId}`;
      if (state.stranded[work] === key) continue;
      state.stranded[work] = key;
      const entry = { work, lane: views.work?.[work]?.work?.data?.lane ?? last.lane, via: 'try-again', key, at: now().toISOString(), queued: views.work?.[work]?.work?.at ?? null, ...(isText(last.branch) ? { branch: last.branch, carryOn: true } : {}) };
      state.returning.push(entry);
      await askAboutRestart(entry, restartStrandedWords(titleOf(views, work)));
    }
  }

  // Each tick, what stands behind work that can't start (scripts/engine/stuck.js). The note is written when the answer
  // changes; anything that moves or is about to means there is no top card, and All stop or an incident has its own.
  async function topTick(views, decided, { queueStatus, ready, started }) {
    const cards = cardsNow(views);
    const waitingOn = waitingNow(views);
    // What a card holds isn't going, so neither a pull request of a piece on a card nor a merge queue paused on one counts.
    const moving = (work) => !waitingOn.has(work);
    const queueGoing = queueStatus === 'running' || (queueStatus === 'paused' && cards.length === 0);
    const running = [
      ...decided.live, ...started.filter((s) => s.ok === true || s.uncertain === true).map((s) => s.work),
      ...[...state.admitted, ...state.returning].filter((e) => !e.asked && moving(e.work)).map((e) => e.work),
      ...ready.map(([, r]) => r.work).filter(moving), ...(queueGoing ? [MERGE_WORK] : []),
    ];
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

  async function tick() {
    await fixTick();
    // Trouble with a reservation or an entry costs a tick nothing: each is looked at again on the next.
    await returnTick(readViews() ?? {}).catch(() => {});
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
    const waiting = Object.entries(ready).filter(([pr, r]) => !ended(r.work) && !closedPrs.has(Number(pr)) && leftAt[pr] !== r.head);
    const newReady = waiting.some(([pr]) => !state.seenReady.includes(pr));
    const requests = typeof engine.countsRequests === 'function'
      ? { counts: () => engine.countsRequests(config()?.routing ?? {}) === true, used: await spentThisMonth(), cap: Number.isFinite(s.capRequests) ? s.capRequests : 0, confirmed: engine.requestsConfirmed === true }
      : null;
    const queueStatus = await mergeQueueStatus();
    const decided = dispatch({
      work: views.work ?? {}, runs: views.runs ?? {}, reports, features: views.features ?? {}, settings: s, stop: stopped(),
      incident: Array.isArray(views.incidents?.open) && views.incidents.open.length > 0,
      capsReached: false,
      mergeQueue: { running: queueHolds(queueStatus), lastStart: state.lastStart, waiting: waiting.length, newReady: newReady || state.queueDue === true },
      requests, sentBack: [
        ...Object.entries(state.sentBack).filter(([work, times]) => state.acted[work] !== times).map(([work, times]) => ({ work, times })),
        ...Object.entries(state.reds).filter(([work, red]) => state.redActed[work] !== red.times).map(([work, red]) => ({ work, times: red.times, reason: 'red' })),
      ], waiting: [...waitingNow(views)], reserved: reservedFiles(), returning: state.returning, admitted: state.admitted, stoppedFeatures: stoppedFeaturesOf(views, reports), now: now(),
    });
    // What it admitted holds its place from here. A piece has one start at a time; each answer of it goes along.
    for (const { work } of decided.admit) {
      let starts = 0;
      for (const entry of state.returning.filter((e) => e.work === work && !e.asked)) {
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
    if (pieces.length > 0 && !canTest(config())) {
      decided.hold.push(...pieces.map((p) => ({ work: p.work, why: 'no-tests' })));
      decided.start = [];
      decided.requeue = [];
      pieces = [];
      if (!state.noTestsSaid) {
        state.noTestsSaid = true;
        keep();
        await write('note', { about: 'engine', words: NO_TESTS_WORDS });
      }
    } else if (state.noTestsSaid && pieces.length > 0) {
      state.noTestsSaid = false;
      keep();
    }
    await strandedTick(views, decided).catch(() => {});
    // A requeue has its place, so it goes straight onto `admitted`; what was sent back and acting on it are kept as one.
    for (const { work, lane, branch, reason } of decided.requeue) {
      const times = reason === 'red' ? state.reds[work].times : state.sentBack[work];
      if (reason === 'red') state.redActed[work] = times;
      state.acted[work] = state.sentBack[work];
      state.admitted.push({ work, lane, via: 'requeue', key: `requeue:${reason ?? 'clash'}:${times}`, at: now().toISOString(), queued: views.work?.[work]?.work?.at ?? null, branch, carryOn: true, ...(reason ? { reason } : {}) });
      keep();
    }
    // Returning work goes first. Under an incident what is admitted keeps its place and waits for the close.
    if (canTest(config()) && !incidentOpen(views)) {
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
      const got = await startPiece({ work, lane, ...args });
      if (carry && got?.ok === true) {
        delete state.carryOver[work];
        keep();
      }
      // No reply in time: settled as any start is, before anything starts it again.
      if (got?.uncertain === true) {
        state.admitted.push({ work, lane, via: 'try-again', key: `start:${startAt}`, at: startAt, queued: views.work?.[work]?.work?.at ?? null, ...args, starting: true, startAt, uncertain: true });
        keep();
      }
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
    // Work held for the plan's counted requests: one card, once, in the engine's own words.
    const held = decided.hold.find((h) => h.why === 'requests' || h.why === 'requests-unconfirmed');
    if (held && !state.requestsAsked) {
      const id = `q-${held.work}-${OWN_QUESTIONS}`;
      state.requestsAsked = id;
      keep();
      await askDirector('requests', {
        id, work: held.work, level: 3,
        what: engine.words?.requestsHeld ?? REQUESTS_WORDS,
        why: 'Spending your plan\'s requests is yours to allow; nothing is spent without your yes.',
        options: [
          { label: KEEP_OFF, says: 'That work keeps waiting, and nothing of the plan\'s requests is used.' },
          { label: ALLOW_SOME, says: 'The settings show how many requests a month the build may use; you choose the number there.' },
        ],
        recommendation: KEEP_OFF,
      });
    }
    await topTick(views, decided, { queueStatus, ready: waiting, started }).catch(() => {});
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
    // And of the cards themselves: the runner's `openCards`.
    onCards(fn) { if (typeof fn === 'function') routerCardsNow = fn; },
    // Who tells this of the pull requests the queue has left alone, { [pr]: head }: the runner.
    onParked(fn) { if (typeof fn === 'function') parkedPrs = fn; },
    // A parked pull request the director approved goes to the queue again. A hand-over writes a fresh work item, with no
    // `park` in its record, so the queue judges it as new; where it asks, the approval answers for the head it was given.
    // Never beside a live run, whose claim on the item this would write over, and never for work that has ended.
    async handBack({ pr }) {
      if (await queueLive()) return { ok: false, waiting: true };
      const kept = (readyOf() ?? {})[pr];
      if (!isPlain(kept)) return { ok: false, refused: 'nothing records it as ready' };
      const views = readViews() ?? {};
      const reports = isPlain(views.reports) ? views.reports : {};
      if (endedBy(reports, kept.work, views.work?.[kept.work]?.work) || ['merged', 'closed'].includes(await stateOf(pr))) return { ok: false, gone: true };
      if (typeof engine.handOver !== 'function') return { ok: false, refused: 'the engine has no merge queue to hand it to' };
      const repo = repoName();
      const got = await engine.handOver({ project: folder, repo, pr, url: `https://github.com/${repo}/pull/${pr}`, runId: kept.runId, at: now().toISOString() });
      return got?.ok === true ? { ok: true } : { ok: false, refused: got?.refused ?? 'the engine didn\'t take it' };
    },
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
