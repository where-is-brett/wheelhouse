// scripts/engine/dispatch-run.js
// The dispatcher's runner, in the helper: reads the record's views, asks `dispatch` what to start, and starts it
// through the helper's own start (no route starts a run). Each piece gets its work order, with the project's caps and
// the work's decision level; the merge queue is started from here too, one run at a time. Work held because it would
// use the plan's counted requests brings one card, once, in the engine's own words. A red main line's incident comes
// first each tick (section 7.7, fix-main.js): one fix run for it, the incident closed once the main line reads green,
// and one card when a fix didn't make it green. A feature runs its slices one after another (feature.js): each next one
// starts once the slice before has merged, and the feature's own run once every slice has. What it keeps (the merge queue's run and when it last started, the
// pull requests already seen ready, the clashes, the fixes) is in `file`.
import fs from 'node:fs';
import path from 'node:path';
import { dispatch } from './dispatcher.js';
import { workOrder } from './order.js';
import { limitsFor } from './caps.js';
import { ENGINE_QUESTIONS } from './router.js';
import { openRedMain, fixDecision, fixOrder } from './fix-main.js';
import { readSlices, featureProgress, featureNext, currentStep, sliceOrder, finishOrder, featureCap } from './feature.js';
import { since, endedBy } from '../foreman/queue.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const EMPTY = () => ({ mergeRun: null, mergeRuns: [], lastStart: null, seenReady: [], sentBack: {}, acted: {}, clashAsked: {}, requestsAsked: null, noTestsSaid: false, fixes: {}, features: {} });
// The dispatcher's own questions take numbers from here, apart from the card router's.
const OWN_QUESTIONS = ENGINE_QUESTIONS + 90000;
// The work the merge queue's own runs stand for, which no work record names: their asks are routed under it.
export const MERGE_WORK = 'merge-queue';
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
// The fix card's numbers, after the clash cards' and the requests card's.
const FIX_QUESTIONS = OWN_QUESTIONS + 5000;
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

// The Logbook's line when no work can start because Wheelhouse can't run the project's tests.
export const NO_TESTS_WORDS = 'Build work waits: Wheelhouse doesn\'t know how to run this project\'s tests, so it couldn\'t tell when a change is done. Setup can add the command.';

// The words of the card for work held for the plan's counted requests, when the engine gives none of its own.
export const REQUESTS_WORDS = 'Some work would use your AI plan\'s counted requests, and the cap on them is 0, so that work waits until you allow some.';

// The order for one piece of work from its record: the title is its goal; the done checks are the record's own, or
// the project's tests passing when it has none. `config` is { routing (the pack's bindings), testCommand, pages? };
// `answers` the director's answers to the work's earlier questions, from the helper's own record.
export function orderFor(entry, { settings = {}, raised = false, config = {}, answers = [] } = {}) {
  const data = entry.work.data;
  const done = Array.isArray(data.done) && data.done.length > 0 ? data.done : [{ command: config.testCommand, expect: 0 }];
  return workOrder({
    work: { id: data.id ?? entry.work.key, lane: data.lane, goal: data.goal ?? data.title, done, visible: data.visible === true, level: data.level, notInScope: data.notInScope ?? [], protectedFiles: data.protectedFiles ?? [] },
    config,
    routing: config.routing ?? {},
    caps: limitsFor(data.lane, settings, { raised }),
    answers,
  });
}

// dispatchRun({ engine, project, folder, file, readViews, settings, stopped, now, start, write, readyOf, mainGreen,
//   stoppedRuns, fixedRuns, prMerged, designOf, orderOf }) -> { tick, workOf, startAgain, sentBack }.
// - `start({ project, order, branch?, carryOn? })` the helper's own start; `readyOf()` the pull requests marked ready,
//   { [pr]: { work, head } }; `settings()` the project's settings in force; `write(kind, data)` a record;
// - `mainGreen()` whether the main line's checks read green: true, false, or null when they can't be read (or are
//   still running); `stoppedRuns()` the runs All stop cancelled; `fixedRuns()` the runs whose fix the helper added;
// - `prMerged(pr)` whether the host says a pull request merged (null when it can't say); `designOf(work)` the work's
//   approved design, { text } or { problem } (or null when it names none); `orderOf(runId)` the order a run was given.
export function dispatchRun({ engine, project, folder, file, readViews, settings = () => ({}), stopped = () => false, now = () => new Date(), start, write = async () => {}, readyOf = () => ({}), config = () => ({}), spentThisMonth = () => 0, mainGreen = async () => null, stoppedRuns = () => [], fixedRuns = () => [], prMerged = async () => null, designOf = () => null, orderOf = () => null } = {}) {
  let state = readState(file);
  const keep = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  };

  async function mergeQueueRunning() {
    if (!state.mergeRun) return false;
    try {
      const got = await engine.inspect(state.mergeRun);
      return got?.status === 'running' || got?.status === 'paused';
    } catch {
      return false;
    }
  }

  async function startPiece({ work, lane, branch = null, carryOn = false, raised = false, answers = [] }) {
    const views = readViews() ?? {};
    const entry = views.work?.[work];
    if (!isPlain(entry?.work?.data)) return { ok: false, refused: 'there is no such work' };
    if (!isText(config()?.testCommand)) return { ok: false, refused: 'Wheelhouse doesn\'t know how to run the project\'s tests' };
    if (entry.work.data.lane === 'feature') return startFeature({ views, entry, work, lane, branch, carryOn, raised, answers });
    let order;
    try { order = orderFor({ ...entry, work: { ...entry.work, key: work } }, { settings: settings() ?? {}, raised, config: config() ?? {}, answers }); } catch (error) { return { ok: false, refused: error.message }; }
    if (order.lane !== lane) return { ok: false, refused: 'the work\'s lane changed' };
    return start({ project, order, ...(branch ? { branch } : {}), carryOn });
  }

  // A feature's approved design read into its slices, or { refused }, said on the Logbook once for each problem.
  async function designFor(work, entry) {
    const kept = (state.features[work] ??= { merged: {}, started: [], said: null, asked: null, raised: false, reported: false });
    // Queued again (the First Mate's Carry on): the merges seen stay; the starts, the cap's card and its answer are
    // those of the new queueing.
    const queued = entry?.work?.at ?? null;
    if (kept.queued !== queued) {
      Object.assign(kept, { queued, started: [], asked: null, raised: false, stopped: false, reported: false, cards: (kept.cards ?? 0) + (kept.asked ? 1 : 0) });
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
  function progressFor(views, work, entry, kept, design) {
    const all = views.runs?.[work] ?? [];
    const now = all.filter((r) => since(r, entry.work));
    return featureProgress({ design, all, now, orderOf, merged: new Map(Object.entries(kept.merged).map(([pr, head]) => [Number(pr), head])) });
  }
  // Starts the feature's next run: slice 1 from the dispatcher, a later slice or its own run from featureTick, or the
  // run under way again on a carry-on (Give it more, or an answer), on its branch.
  async function startFeature({ views, entry, work, lane, branch, carryOn, raised, answers }) {
    if (!['feature', 'slice'].includes(lane)) return { ok: false, refused: 'the work\'s lane changed' };
    const found = await designFor(work, entry);
    if (found.refused) return { ok: false, refused: found.refused };
    const { design, kept } = found;
    // Past the feature's cap, nothing more starts without the director's say, however the start came.
    const s = settings() ?? {};
    const spent = (views.costs?.[work] ?? []).reduce((n, c) => n + (Number.isFinite(c?.data?.tokens) ? c.data.tokens : 0), 0);
    if (spent >= featureCap(design, s, { raised: kept.raised }) && !(await featureCapAnswered(views, work, entry, kept, spent, design, s))) {
      return { ok: false, refused: 'the feature has used the tokens set aside for it' };
    }
    const progress = progressFor(views, work, entry, kept, design);
    let step = currentStep({ design, progress });
    if (!carryOn) {
      const next = featureNext({ design, progress, live: false });
      if (next.act !== 'start') return { ok: false, refused: 'the feature has nothing to start now' };
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
    const got = await start({ project, order, ...(branch ? { branch } : {}), carryOn });
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
      for (const pr of new Set((views.runs?.[work] ?? []).map((r) => r?.data?.pr).filter((pr) => Number.isInteger(pr) && !Object.hasOwn(kept.merged, pr)))) {
        let merged = null;
        try { merged = await prMerged(pr); } catch { merged = null; }
        if (merged !== true) continue;
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
        if (!kept.reported) {
          kept.reported = true;
          keep();
          await write('report', { work, outcome: 'merged', pr: next.pr, summary: FEATURE_DONE, rulings: [] });
        }
        continue;
      }
      if (next.act !== 'start' || stopped() || (views.incidents?.open?.length ?? 0) > 0) continue;
      await startPiece({ work, lane: 'feature' });
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
      if (kept.raised && spent >= featureCap(design, s, { raised: true }) && !kept.stopped) {
        kept.stopped = true;
        keep();
        await write('note', { about: 'engine', words: `${title} has stopped: it has used its raised cap too, so its next slice doesn't start. The First Mate's Carry on asks you again.` });
      }
      return kept.raised && spent < featureCap(design, s, { raised: true });
    }
    kept.asked = `q-${work}-${FEATURE_QUESTIONS + (kept.cards ?? 0)}`;
    keep();
    await write('question', {
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
      delete state.fixes[incident.id];
      keep();
    } else if (decided.act === 'start') {
      let order;
      try { order = fixOrder(incident, { config: config() ?? {}, settings: settings() ?? {}, revert: decided.revert === true }); } catch { return; }
      kept.next = null;
      if (decided.after) kept.carried.push(decided.after);
      keep();
      const got = await start({ project, order, ...(decided.carryOn ? { branch: decided.branch, carryOn: true } : {}) });
      if (got?.ok && typeof got.runId === 'string') {
        kept.started.push(got.runId);
        keep();
        if (kept.started.length === 1) await write('note', { about: 'engine', words: STARTED_FIX_WORDS });
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
      await write('question', {
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

  async function tick() {
    await fixTick();
    await featureTick();
    const views = readViews() ?? {};
    const s = settings() ?? {};
    const ready = readyOf() ?? {};
    const reports = isPlain(views.reports) ? views.reports : {};
    const waiting = Object.entries(ready).filter(([, r]) => reports[r.work]?.data?.outcome !== 'merged');
    const newReady = waiting.some(([pr]) => !state.seenReady.includes(pr));
    const requests = typeof engine.countsRequests === 'function'
      ? { counts: () => engine.countsRequests(config()?.routing ?? {}) === true, used: spentThisMonth(), cap: Number.isFinite(s.capRequests) ? s.capRequests : 0, confirmed: engine.requestsConfirmed === true }
      : null;
    const decided = dispatch({
      work: views.work ?? {}, runs: views.runs ?? {}, reports, features: views.features ?? {}, settings: s, stop: stopped(),
      incident: Array.isArray(views.incidents?.open) && views.incidents.open.length > 0,
      capsReached: false,
      mergeQueue: { running: await mergeQueueRunning(), lastStart: state.lastStart, waiting: waiting.length, newReady },
      requests, sentBack: Object.entries(state.sentBack).filter(([work, times]) => state.acted[work] !== times).map(([work, times]) => ({ work, times })), now: now(),
    });
    const started = [];
    // The project's configuration and test command: without one Wheelhouse can run, nothing starts (a run would have
    // no done check), and the Logbook says so once.
    let pieces = [...decided.requeue.map((r) => ({ ...r, carryOn: true, again: true })), ...decided.start];
    if (pieces.length > 0 && !isText(config()?.testCommand)) {
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
    for (const piece of pieces) {
      if (stopped()) break;
      const { again, ...args } = piece;
      const got = await startPiece(args);
      if (again) {
        state.acted[piece.work] = state.sentBack[piece.work];
        keep();
      }
      started.push({ ...args, ...got });
    }
    // A second clash on the same work: one card, level 3. Try again brings it up to date once more.
    for (const { work } of decided.clashCards) {
      const times = state.sentBack[work];
      const id = `q-${work}-${OWN_QUESTIONS + times}`;
      if (state.clashAsked[work] === id) {
        const label = views.questions?.[id]?.answer?.label;
        if (label === TRY_AGAIN && state.acted[work] !== times && !stopped()) {
          const last = (views.runs?.[work] ?? []).at(-1)?.data;
          await startPiece({ work, lane: last?.lane ?? views.work?.[work]?.work?.data?.lane, branch: last?.branch ?? null, carryOn: true });
          state.acted[work] = times;
          keep();
        }
        continue;
      }
      state.clashAsked[work] = id;
      keep();
      const title = views.work?.[work]?.work?.data?.title ?? work;
      await write('question', {
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
    if (decided.startMergeQueue && !stopped()) {
      const got = await engine.start({ lane: 'merge', project: folder });
      if (got?.ok) {
        state.mergeRun = got.runId;
        state.mergeRuns = [...state.mergeRuns, got.runId].slice(-KEPT_MERGE_RUNS);
        state.lastStart = now().toISOString();
        state.seenReady = waiting.map(([pr]) => pr);
        keep();
      }
    }
    // Work held for the plan's counted requests: one card, once, in the engine's own words.
    const held = decided.hold.find((h) => h.why === 'requests' || h.why === 'requests-unconfirmed');
    if (held && !state.requestsAsked) {
      const id = `q-${held.work}-${OWN_QUESTIONS}`;
      state.requestsAsked = id;
      keep();
      await write('question', {
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
    return { ...decided, started };
  }

  return {
    tick,
    // The work a merge-queue run the dispatcher started stands for ({ work: MERGE_WORK, lane: 'merge' }), or null: no
    // `run` record names it, so its asks are found from here.
    workOf: (runId) => (state.mergeRuns.includes(runId) ? { work: MERGE_WORK, lane: 'merge', branch: null } : null),
    // Starts a piece again, carrying on from what is there (Give it more), with its cap raised once.
    startAgain: (args) => startPiece(args),
    // A pull request the merge gate sent back for a clash: started again on the next tick, or a card the second time.
    sentBack(work) {
      state.sentBack[work] = (state.sentBack[work] ?? 0) + 1;
      keep();
    },
  };
}
