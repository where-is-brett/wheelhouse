// scripts/watcher/routine.js
// The script's routine moves (director's way of working, design section 10). Starting the next piece, waking a session after
// an answer, closing a finished piece and opening the gate (merging) are a script's job. The foreman model wakes only for
// judgement: an ambiguous report, work that is stuck, or something no rule covers (JUDGEMENT).
//
// The moves are the foreman's own commands, `act start`, `plan-ready`, `build`, `resume`, `pause`, `question`, `extra-plan`,
// `stuck-note`, `amend`, `merge` and `close`, run through the helper's /foreman/run (the same route, and the same one-at-a-time
// queue, as the foreman's) so the script and a foreman session never run two of them at once. Inside a piece the feature
// session still runs Superpowers' own loop; this never splits a piece into calls. Nothing here is restored from Archon's
// dispatcher.
//
// `triage(state)` is pure: from what the watcher saw (events) and what the views say (facts) it gives the moves to make, the
// events that need no move, and the events that need the foreman with the reason. `makeRoutine(...).run({ events })` reads the
// facts, makes the moves and says which events are handled (the watcher routes those to its digest) and which still wake
// the foreman, each with its reason. A move that fails leaves its events to the foreman, for something no rule covers.
//
// State as `triage` reads it:
//   events   the foreman-bound events of this loop
//   halt     null, or `{ why, fixes, stop }` while All stop or an incident holds (wake.js haltOf)
//   lanes    { work: lane }
//   start    work that may open a session now: [{ work, lane, words }]; `words` is `{ goal, done, sessions, tokens }` where they
//            are set (work made by hand), and null where a model must read the approved document for them
//   build    [{ verb: 'build' | 'resume', work }] plans that clear the clash check and a slot
//   pause    [work] to pause for the five-hour window
//   merge    [{ work, pr }] pull requests ready to merge now
//   ready    [{ work, pr }] every pull request that is ready to merge, whether or not a hold lets it merge now
//   held     [work] features held on purpose (planned or paused), whose stillness is no trouble
//   readyPlans [work] features at the start whose session says its plan is ready but whose plan was never recorded (found again
//            when the watcher starts, so a plan held back by a hold is not lost to a restart)
import { FOREMAN_TYPES } from './core.js';
import { recordIncident } from './reliability.js';
import {
  FIVE_HOUR_TIGHT, ForemanError, NO_PLAN, PLANS_WHILE_HELD, builderCapOf, checkoutOf, clashFor, currentFeatureOf, haltFor, haltOf, laneOf, loadConfig,
  loadViews, mergeWait, openPrWait, pausedBy, queueToBuild, queueToStart, readyPrs, waitText, whyText, worktreeOf,
} from '../foreman/wake.js';
import { featurePaths, readStatus } from '../feature/files.js';
import { HAND_DONE, HAND_GOAL } from '../lib/by-hand-done.js';
import { HASH, LANE_APPETITE, questionIdOf } from '../lib/build-loop.js';

// The only reasons the foreman model is woken.
export const JUDGEMENT = Object.freeze(['ambiguous-report', 'stuck', 'unknown']);
// The queue is looked at again no sooner than this when no event came, and a move that failed is tried again no sooner.
export const QUEUE_MS = 60 * 1000;
export const RETRY_MS = 10 * 60 * 1000;
// A queue move that has failed this many times reaches the foreman, once.
export const FAILS_BEFORE_FOREMAN = 3;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const FOREMAN_ONLY = new Set(FOREMAN_TYPES);
const keyOf = (move) => [move.act, ...move.args].join(' ');

// The events that need no move and no foreman: they say what happened, and the script's own moves follow from the views.
const NOTED = ['clash', 'stop', 'incident', 'lift-incident', 'incident-fix', 'approval', 'ci-push'];

// The words and appetite `act start` takes for work whose goal and done lines are set (changes made by hand), or null.
export function startWordsOf(views, work) {
  const entry = views.work?.[work];
  const data = entry?.work?.data;
  const own = LANE_APPETITE[data?.lane];
  if (!own || entry?.approval?.byHand !== true || typeof data?.parent === 'string') return null;
  return { goal: HAND_GOAL, done: [...HAND_DONE], sessions: own.sessions, tokens: own.tokens };
}

const startArgs = (s) => [
  s.work, '--goal', s.words.goal, ...s.words.done.flatMap((d) => ['--done', d]),
  '--appetite-sessions', String(s.words.sessions), '--appetite-tokens', String(s.words.tokens),
];

// What `state` calls for: `{ moves, handled, wake, defer }`.
//   moves    [{ act, args, for }]: `for` lists the ids of the events a move answers. `wake-session` is the answer that wakes its
//            feature's session, which the watcher's own routing already does, so nothing is run for it.
//   handled  ids of events that need no move
//   wake     [{ event, reason }] the events the foreman is woken for
//   defer    events to run again once a hold lifts
export function triage(state) {
  const {
    events = [], halt = null, lanes = {}, start = [], build = [], pause = [], merge = [], held = [], ready = [], queue = true,
  } = state ?? {};
  const moves = [];
  const handled = [];
  const wake = [];
  const defer = [];
  const heldBack = (lane) => haltFor(halt, lane ?? null) !== null;
  const add = (move, id) => {
    const found = moves.find((m) => keyOf(m) === keyOf(move));
    if (found) {
      if (id) found.for.push(id);
      return;
    }
    moves.push({ ...move, for: id ? [id] : [] });
  };
  const ask = (e, reason) => wake.push({ event: e, reason });

  for (const e of events) {
    if (!isPlain(e) || !FOREMAN_ONLY.has(e.type)) continue;
    const d = isPlain(e.detail) ? e.detail : {};
    const work = e.work;
    const lane = lanes[work] ?? null;
    switch (e.type) {
      case 'work-ready': {
        const s = start.find((x) => x.work === work);
        // Startable and its words are the document's to read: a model's. Anything else (started, held, unapproved, or under a hold)
        // needs nothing now; the queue is looked at again.
        if (s !== undefined && s.words === null && !heldBack(s.lane)) ask(e, 'unknown');
        else handled.push(e.id);
        break;
      }
      case 'amended':
        if (typeof d.hash === 'string' && HASH.test(d.hash)) add({ act: 'amend', args: [work, d.hash] }, e.id);
        else ask(e, 'unknown');
        break;
      case 'question': add({ act: 'question', args: [work, e.id] }, e.id); break;
      case 'extra-plan': add({ act: 'extra-plan', args: [work, e.id] }, e.id); break;
      case 'stuck-note':
        if (typeof d.at === 'string') add({ act: 'stuck-note', args: [work, d.at] }, e.id);
        else handled.push(e.id);
        break;
      case 'answer':
        if (questionIdOf(d.questionId)?.foreman === true) ask(e, 'unknown');
        else add({ act: 'wake-session', args: [work] }, e.id);
        break;
      case 'merge-ready':
        if (mergeWait(halt, e.pr) !== null) handled.push(e.id);
        else add({ act: 'merge', args: [work] }, e.id);
        break;
      case 'plan-ready':
        if (NO_PLAN.includes(lane)) handled.push(e.id);
        else if (heldBack(lane)) {
          handled.push(e.id);
          defer.push(e);
        } else add({ act: 'plan-ready', args: [work] }, e.id);
        break;
      case 'report': add({ act: 'close', args: [work] }, e.id); break;
      case 'stuck':
        // A piece waiting on purpose is not trouble: one planned or paused, one with a ready pull request whose merge a hold freezes,
        // and, under All stop, every piece, since nothing runs. An incident freezes only starts and merges: a piece that is still
        // building and stalls is stuck, and is asked about.
        // A plan held back by an incident leaves its session at ready-to-build, still at its start: held on purpose, like planned.
        if (held.includes(work) || (halt !== null && (halt.stop === true || ready.some((r) => r.work === work && mergeWait(halt, r.pr) !== null)
          || (d.phase === 'ready-to-build' && heldBack(lane))))) handled.push(e.id);
        else ask(e, 'stuck');
        break;
      case 'review-overdue': ask(e, 'stuck'); break;
      default:
        if (NOTED.includes(e.type)) handled.push(e.id);
        else ask(e, 'unknown'); // over-appetite, brief-tampered, and anything no rule covers
    }
  }

  if (queue && !(halt !== null && halt.stop === true)) {
    for (const s of start) {
      if (s.words !== null && !heldBack(s.lane)) add({ act: 'start', args: startArgs(s) });
    }
    if (halt === null) {
      for (const b of build) add({ act: b.verb, args: [b.work] });
      for (const w of pause) add({ act: 'pause', args: [w] });
    } else {
      // During an incident only bug work goes on (wake.js haltFor); plans of any other lane wait.
      for (const b of build) if (!heldBack(lanes[b.work] ?? null)) add({ act: b.verb, args: [b.work] });
    }
    for (const m of merge) if (mergeWait(halt, m.pr) === null) add({ act: 'merge', args: [m.work] });
  }
  return { moves, handled, wake, defer };
}

// The moves alone, as the plan names it: `[{ act, args }]`.
export function routineMoves(state) {
  return triage(state).moves.map(({ act, args }) => ({ act, args }));
}

// Reads the facts `triage` needs from the views and configuration, through the helper. Throws when they can't be had.
export async function readFacts({
  project, client, now = () => new Date(), stopped, readyPlans: wantPlans = false,
}) {
  const { views } = await loadViews(project, client);
  const config = await loadConfig(project, client);
  const t = now();
  const halt = haltOf(views, stopped ? { stopped } : undefined);
  const builderCap = builderCapOf(views, config, t);
  const lanes = Object.fromEntries(Object.keys(views.work).map((id) => [id, laneOf(views, id)]));
  const recorded = (id) => currentFeatureOf(views, id) !== null;

  // What may open a session now: the queue's free slots, and small or feature work held for pace or a dependency, which may open
  // a session to plan (wake.js PLANS_WHILE_HELD).
  const toStart = queueToStart(views, { now: t, builderCap });
  const start = toStart.start.filter((id) => !recorded(id)).map((id) => ({ work: id, lane: lanes[id], words: startWordsOf(views, id) }));
  for (const { work, why } of toStart.hold) {
    if (recorded(work) || !['pace', 'dependency'].includes(why) || !PLANS_WHILE_HELD.includes(lanes[work])) continue;
    start.push({ work, lane: lanes[work], words: startWordsOf(views, work), held: whyText(why) });
  }

  // Recorded plans that may build (or resume from a five-hour pause) now, by the same checks as the foreman's queue.
  const toBuild = queueToBuild(views, { now: t, builderCap });
  const build = [];
  const heldOn = [];
  const readyPlans = [];
  for (const [id, f] of Object.entries(views.features)) {
    const step = f?.data?.step;
    if (wantPlans && step === 'started' && !NO_PLAN.includes(lanes[id])) {
      try {
        if (readStatus(featurePaths(worktreeOf(project, views, id)).status)?.phase === 'ready-to-build') readyPlans.push(id);
      } catch (error) {
        if (!(error instanceof ForemanError)) throw error;
      }
    }
    if (step !== 'planned' && step !== 'paused') continue;
    heldOn.push(id);
    if (step === 'paused' && (pausedBy(f.data) === 'director' || FIVE_HOUR_TIGHT)) continue;
    // The same waits as the foreman's queue lines: a clash with running work, no free slot, or the piece's own pull request still open.
    let own = null;
    try {
      own = step === 'planned' ? openPrWait(worktreeOf(project, views, id)) : null;
    } catch (error) {
      if (!(error instanceof ForemanError)) throw error;
    }
    const slot = toBuild.start.includes(id) ? { ok: true } : { ok: false, why: toBuild.hold.find((h) => h.work === id)?.why ?? 'unknown' };
    const clash = clashFor(views, config, id, Array.isArray(f.data.files) ? f.data.files : []);
    if (own !== null || waitText(clash, slot) !== null) continue;
    build.push({ verb: step === 'paused' ? 'resume' : 'build', work: id });
  }
  const ready = readyPrs(project).map(({ pr, work }) => ({ work, pr }));
  return {
    halt, lanes, start, build, pause: toBuild.pause, merge: ready, ready, held: heldOn, readyPlans, views,
  };
}

// Whether a failed move's own words say the director is the one to ask (the foreman's `act close` ends "ask the director" when a
// report can't be taken as it stands).
const asksDirector = (reply) => /ask the director/i.test(`${reply?.stderr ?? ''}\n${reply?.stdout ?? ''}`);

// The act command through the helper, run in the project's main checkout: `{ code, stdout, stderr }`.
export function helperAct({ project, client }) {
  return async (argv) => {
    let answer;
    try {
      answer = await client.foreman.run({ folder: checkoutOf(project), script: 'act', argv });
    } catch (error) {
      return { code: 1, stdout: '', stderr: error instanceof Error ? error.message : 'the helper gave no answer' };
    }
    if (answer?.ok !== true || !Number.isInteger(answer.code)) {
      return { code: 1, stdout: '', stderr: typeof answer?.refused === 'string' ? answer.refused : 'the helper gave no answer' };
    }
    return { code: answer.code, stdout: String(answer.stdout ?? ''), stderr: String(answer.stderr ?? '') };
  };
}

// What the foreman is told about a queue move that kept failing: the event of the kind that move answers, so its wake reads
// where things stand and what to do.
function stood(move, n, lanes, merges) {
  const work = move.args[0];
  const id = `routine:${keyOf(move).replace(/\s+/g, '-').slice(0, 120)}:${n}`;
  if (move.act === 'start') return { type: 'work-ready', work, id, detail: { lane: lanes[work], routine: true }, reason: 'unknown' };
  if (move.act === 'merge') {
    const pr = merges.find((m) => m.work === work)?.pr;
    return { type: 'merge-ready', work, id, ...(Number.isInteger(pr) ? { pr } : {}), detail: { routine: true }, reason: 'unknown' };
  }
  return { type: 'plan-ready', work, id, detail: { phase: 'ready-to-build', routine: true }, reason: 'unknown' };
}

// The routine for one project. `act(argv)` runs an act command (default: through the helper), `facts()` reads the state
// (default: readFacts). `record` records an incident (default: the reliability file).
export function makeRoutine({
  project, client, now = () => new Date(), log = () => {}, act = null, facts = null, record = recordIncident, stopped,
}) {
  const run = act ?? helperAct({ project, client });
  const read = facts ?? ((options) => readFacts({ project, client, now, stopped, ...options }));
  const failed = new Map();
  const deferred = new Map();
  // Startable pieces whose words need their document read, already put to the foreman; forgotten once the piece is no longer startable.
  const asked = new Set();
  let lastQueue = null;
  let first = true;

  const attempt = async (move, out, ranKeys) => {
    const key = keyOf(move);
    if (ranKeys.has(key)) return null;
    ranKeys.add(key);
    if (move.act === 'wake-session') return { code: 0, stdout: '', stderr: '' };
    let reply;
    try {
      reply = await run([move.act, ...move.args]);
    } catch (error) {
      reply = { code: 1, stdout: '', stderr: error instanceof Error ? error.message : 'unknown error' };
    }
    out.moves.push({ act: move.act, args: move.args, code: reply.code });
    return reply;
  };

  return {
    async run({ events = [], queue = true } = {}) {
      const out = {
        handled: new Set(), reasons: new Map(), extra: [], moves: [],
      };
      const mine = (Array.isArray(events) ? events : []).filter((e) => isPlain(e) && FOREMAN_ONLY.has(e.type));
      let state;
      const wasFirst = first;
      try {
        state = await read({ readyPlans: wasFirst });
      } catch (error) {
        log(`The routine moves couldn't be made, the foreman is left the events: ${error.message}`);
        return out;
      }
      if (!isPlain(state)) return out;

      // A plan held back by a hold is run once the hold lifts.
      const again = [];
      // Once, at the start: plans the session said were ready that no record shows, as a plan held back in memory would have been.
      if (first) {
        first = false;
        for (const work of Array.isArray(state.readyPlans) ? state.readyPlans : []) {
          if (!mine.some((e) => e.type === 'plan-ready' && e.work === work)) {
            deferred.set(`routine:plan-ready:${work}`, { type: 'plan-ready', work, id: `routine:plan-ready:${work}`, detail: { phase: 'ready-to-build', routine: true } });
          }
        }
      }
      for (const [id, e] of deferred) {
        if (haltFor(state.halt ?? null, state.lanes?.[e.work] ?? null) === null) {
          again.push(e);
          deferred.delete(id);
        }
      }
      const t = triage({ ...state, events: [...again, ...mine], queue: false });
      for (const id of t.handled) out.handled.add(id);
      for (const e of t.defer) deferred.set(e.id, e);
      for (const { event, reason } of t.wake) {
        out.reasons.set(event.id, reason);
        if (event.type === 'stuck' && typeof event.work === 'string') {
          try {
            record({ kind: 'stalled', project, work: event.work, at: now().toISOString(), key: `stalled:${project}:${event.id}` });
          } catch (error) {
            log(`A stalled piece couldn't be recorded: ${error.message}`);
          }
        }
      }

      const ranKeys = new Set();
      let made = 0;
      for (const move of t.moves) {
        const reply = await attempt(move, out, ranKeys);
        if (reply === null) continue;
        if (reply.code === 0) {
          made += 1;
          for (const id of move.for) out.handled.add(id);
        } else {
          for (const id of move.for) {
            const reason = move.act === 'close' && asksDirector(reply) ? 'ambiguous-report' : 'unknown';
            out.reasons.set(id, reason);
            // A plan the script held back or found again itself isn't among the loop's events, so the foreman is given it here.
            const own = again.find((e) => e.id === id);
            if (own !== undefined) out.extra.push({ ...own, reason });
          }
        }
      }

      // The queue: what may start, build or merge now, from the views as they stand after those moves.
      const at = now().getTime();
      const due = lastQueue === null || at - lastQueue >= QUEUE_MS || at < lastQueue;
      if (queue && (mine.length > 0 || again.length > 0 || due)) {
        lastQueue = at;
        let after = state;
        if (made > 0) {
          try {
            after = await read({ readyPlans: false });
          } catch (error) {
            log(`The queue couldn't be read again: ${error.message}`);
          }
        }
        // A piece a close, a merge or the end of a hold has just freed to start, whose goal and done lines a model must read from its
        // document, is put to the foreman once, so it isn't left for the periodic look.
        const startable = new Set();
        for (const sx of Array.isArray(after.start) ? after.start : []) {
          if (sx.words !== null || haltFor(after.halt ?? null, sx.lane ?? null) !== null) continue;
          startable.add(sx.work);
          if (asked.has(sx.work)) continue;
          asked.add(sx.work);
          if (mine.some((e) => e.type === 'work-ready' && e.work === sx.work)) continue; // its own event already puts it to the foreman
          out.extra.push({
            type: 'work-ready', work: sx.work, id: `routine:needs-document:${sx.work}:${at}`, detail: { lane: sx.lane, routine: true }, reason: 'unknown',
          });
        }
        for (const w of asked) if (!startable.has(w)) asked.delete(w);
        for (const move of triage({ ...after, events: [], queue: true }).moves) {
          const key = keyOf(move);
          const was = failed.get(key);
          if (was !== undefined && at - was.at < RETRY_MS) continue;
          const reply = await attempt(move, out, ranKeys);
          if (reply === null) continue;
          if (reply.code === 0) {
            failed.delete(key);
          } else {
            const n = (was?.n ?? 0) + 1;
            failed.set(key, { n, at });
            log(`${move.act} ${move.args[0]} wasn't made by the routine: ${String(reply.stderr || reply.stdout).trim().split('\n')[0]}`);
            if (n === FAILS_BEFORE_FOREMAN) out.extra.push(stood(move, n, state.lanes ?? {}, state.merge ?? []));
          }
        }
      }
      return out;
    },
  };
}
