// scripts/engine/dispatch-run.js
// The dispatcher's runner, in the helper: reads the record's views, asks `dispatch` what to start, and starts it
// through the helper's own start (no route starts a run). Each piece gets its work order, with the project's caps and
// the work's decision level; the merge queue is started from here too, one run at a time. Work held because it would
// use the plan's counted requests brings one card, once, in the engine's own words. What it keeps (the merge queue's
// run and when it last started, the pull requests already seen ready, the clashes) is in `file`.
import fs from 'node:fs';
import path from 'node:path';
import { dispatch } from './dispatcher.js';
import { workOrder } from './order.js';
import { limitsFor } from './caps.js';
import { ENGINE_QUESTIONS } from './router.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const EMPTY = () => ({ mergeRun: null, mergeRuns: [], lastStart: null, seenReady: [], sentBack: {}, acted: {}, clashAsked: {}, requestsAsked: null, noTestsSaid: false });
// The dispatcher's own questions take numbers from here, apart from the card router's.
const OWN_QUESTIONS = ENGINE_QUESTIONS + 90000;
// The work the merge queue's own runs stand for, which no work record names: their asks are routed under it.
export const MERGE_WORK = 'merge-queue';
const KEPT_MERGE_RUNS = 20;
export const TRY_AGAIN = 'Try again';
export const LEAVE_IT = 'Leave it';
export const KEEP_OFF = 'Keep it off';
export const ALLOW_SOME = 'Allow some';

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
// the project's tests passing when it has none. `config` is { routing (the pack's bindings), testCommand, pages? }.
export function orderFor(entry, { settings = {}, raised = false, config = {} } = {}) {
  const data = entry.work.data;
  const done = Array.isArray(data.done) && data.done.length > 0 ? data.done : [{ command: config.testCommand, expect: 0 }];
  return workOrder({
    work: { id: data.id ?? entry.work.key, lane: data.lane, goal: data.goal ?? data.title, done, visible: data.visible === true, level: data.level, notInScope: data.notInScope ?? [], protectedFiles: data.protectedFiles ?? [] },
    config,
    routing: config.routing ?? {},
    caps: limitsFor(data.lane, settings, { raised }),
  });
}

// dispatchRun({ engine, project, folder, file, readViews, settings, stopped, now, start, write, readyOf }) -> { tick, workOf, startAgain, sentBack }.
// - `start({ project, order, branch?, carryOn? })` the helper's own start; `readyOf()` the pull requests marked ready,
//   { [pr]: { work, head } }; `settings()` the project's settings in force; `write(kind, data)` a record.
export function dispatchRun({ engine, project, folder, file, readViews, settings = () => ({}), stopped = () => false, now = () => new Date(), start, write = async () => {}, readyOf = () => ({}), config = () => ({}), spentThisMonth = () => 0 } = {}) {
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

  async function startPiece({ work, lane, branch = null, carryOn = false, raised = false }) {
    const views = readViews() ?? {};
    const entry = views.work?.[work];
    if (!isPlain(entry?.work?.data)) return { ok: false, refused: 'there is no such work' };
    if (!isText(config()?.testCommand)) return { ok: false, refused: 'Wheelhouse doesn\'t know how to run the project\'s tests' };
    let order;
    try { order = orderFor({ ...entry, work: { ...entry.work, key: work } }, { settings: settings() ?? {}, raised, config: config() ?? {} }); } catch (error) { return { ok: false, refused: error.message }; }
    if (order.lane !== lane) return { ok: false, refused: 'the work\'s lane changed' };
    return start({ project, order, ...(branch ? { branch } : {}), carryOn });
  }

  async function tick() {
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
