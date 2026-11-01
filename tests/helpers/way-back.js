// tests/helpers/way-back.js
// A project on the fake engine, with the dispatcher's runner and the card router joined as the helper joins them, for the
// tests of pieces parking and coming back. `pump` does what the continuation host does: asks to the router, and `run`
// records as the engine's events come in. `restart` builds both anew from the same files, as a helper started again does.
import path from 'node:path';
import { dispatchRun } from '../../scripts/engine/dispatch-run.js';
import { engineRunner } from '../../scripts/engine/runner.js';
import { fakeEngine } from '../../scripts/engine/fake.js';
import { cardsWaitingOf } from '../../scripts/state/views.js';
import { joinQuestions } from '../../scripts/state/joiners.js';
import { tempFolder } from './homes.js';

const ev = (over) => ({ runId: 'x', at: '2026-10-29T02:00:00.000Z', ...over });
// A run that stops at one ask, then ends. `pr` is the pull request it says it opened.
export const asking = (id, { kind = 'question', options = [{ id: 'a', label: 'Keep it small' }, { id: 'b', label: 'Do the whole page' }], pr = null, ...over } = {}) => [
  ev({ type: 'run-started' }),
  ev({ type: 'ask', id, kind, level: 3, recommend: 'b', options, ...over }),
  ev({ type: 'ask-resolved', id }),
  ev({ type: 'run-ended', outcome: 'completed', pr }),
];
// A run parked at a usage limit until the reset, which `lift` stands for, and then finished.
export const atLimit = (id, over = {}) => asking(id, { kind: 'usage-limit', level: 1, ...over });
// A run that stops at two asks in turn.
export const askingTwice = (one, two) => [...asking(one).slice(0, 3), ...asking(two).slice(1)];
// A run that fails with a kind of failure. Played after one another in a list, each leg is what a resume reaches next.
export const failing = (failure, over = {}) => [ev({ type: 'run-started' }), ev({ type: 'run-ended', outcome: 'failed', failure, ...over })];
// A leg of a resumed run that fails or finishes.
export const legFails = (failure, over = {}) => [ev({ type: 'run-ended', outcome: 'failed', failure, ...over })];
export const legFinishes = (over = {}) => [ev({ type: 'run-ended', outcome: 'completed', ...over })];
// A leg of a resumed run that goes on until it is cancelled.
export const legGoes = () => [ev({ type: 'step-finished', step: 'tests', role: 'reviewer', provider: 'claude', model: 'mid', minutes: 1, spend: { tokens: 1, dollars: 0, source: 'reported' } })];
// A run that goes on until it is cancelled.
export const forever = () => [ev({ type: 'run-started' })];
// A run that holds at no ask and ends at once.
export const quiet = () => [ev({ type: 'run-started' }), ev({ type: 'run-ended', outcome: 'completed' })];

export function wayBack({ dispatchExtra = {}, recordings = {}, pace = 3, settings = {}, testCommand = 'node --test', designOf = () => null, branchPaths = async () => [], reads = {}, opened = {} } = {}) {
  const dir = tempFolder('wh-way-back-');
  const engine = fakeEngine({ recordings });
  const clock = { now: new Date('2026-10-29T10:00:00.000Z') };
  const world = {
    engine, clock, work: {}, runs: {}, asks: {}, reports: {}, questions: {}, approvals: {}, incidents: { open: [] }, costs: {}, goals: {},
    stop: false, written: [], shown: {}, starts: [], refuse: null, startAs: null, ready: {}, seenPr: {},
  };
  const at = () => clock.now.toISOString();
  const tock = () => { clock.now = new Date(clock.now.getTime() + 1000); };
  const notes = () => world.written.filter((w) => w.kind === 'note').map((w) => ({ kind: 'note', data: w.data }));
  const ended = (data) => (world.runs[data.work] ?? []).filter((r) => r.data.runId === data.engine?.runId).at(-1)?.data.state === 'ended';
  const shownBy = (lead) => Object.values(world.questions).filter((c) => c.question.data.joins === lead && (world.shown[lead] ?? []).includes(c.question.data.work)).map((c) => c.question.data.id);
  const views = () => (joinQuestions(world.questions, { ended, shown: shownBy }), {
    work: world.work, runs: world.runs, asks: world.asks, reports: world.reports, questions: world.questions, approvals: world.approvals, incidents: world.incidents, costs: world.costs, goals: world.goals, levels: {}, cardsWaiting: cardsWaitingOf(notes()), sendBacks: world.sendBacks ?? [],
  });
  const record = (data) => { (world.runs[data.work] ??= []).push({ at: at(), data: { engine: 'fake', ...data } }); };
  const realStart = async ({ order, branch, carryOn }) => {
    const got = engine.start({ work: order.work, lane: order.lane, ...(branch ? { branch } : {}), recording: order.work, carryOn, folder: `/work/${order.work}` });
    if (!got.ok) return got;
    (world.orders ??= {})[got.runId] = order;
    const runBranch = got.branch ?? branch ?? `wh/${order.work}`;
    record({ work: order.work, lane: order.lane, runId: got.runId, state: 'started', branch: runBranch });
    return { ok: true, runId: got.runId };
  };
  const start = async (args) => {
    world.starts.push(args);
    if (world.startAs) return world.startAs(args, realStart);
    const refused = world.refuse?.(args);
    return refused ? { ok: false, refused } : realStart(args);
  };
  const write = async (kind, data) => {
    if (world.refuseWrite?.(kind, data)) throw new Error('the record was refused');
    world.written.push({ kind, data });
    if (kind === 'question') world.questions[data.id] = { question: { data } };
    else if (kind === 'report') world.reports[data.work] = { at: at(), data };
    else if (kind === 'run') record(data);
  };
  const build = () => {
    const dispatcher = dispatchRun({
      engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: views, write, start, branchPaths, designOf,
      settings: () => ({ engineLanes: ['quick', 'bug', 'feature'], pace, ...settings }), stopped: () => world.stop, now: () => clock.now,
      config: () => world.config ?? ({ routing: {}, testCommand }), mainGreen: async () => world.green ?? null, ...dispatchExtra, readyOf: () => world.ready, prState: async (pr) => world.seenPr[pr] ?? 'open', orderOf: (runId) => world.orders?.[runId] ?? null, stoppedRuns: () => world.stoppedIds ?? [], notReady: (pr) => { delete world.ready[pr]; },
    });
    const runner = engineRunner({
      engine, file: path.join(dir, 'router.json'), readViews: views, write, stopped: () => world.stop, now: () => clock.now,
      settings: () => ({ cardsPerDay: 50, bundleApprovals: false, ...settings }), titleOf: (work) => world.work[work]?.work?.data?.title ?? work,
      workOf: (runId) => {
        for (const [work, list] of Object.entries(world.runs)) {
          const found = list.find((r) => r.data.runId === runId);
          if (found) return { work, lane: found.data.lane, branch: found.data.branch ?? null };
        }
        return dispatcher.workOf(runId);
      },
      release: (work) => dispatcher.release(work),
      admittedTo: (work, key) => dispatcher.admittedTo(work, key),
      delivered: (work, key) => dispatcher.delivered(work, key),
      drop: (work, key) => dispatcher.drop(work, key),
      startAdmitted: (args) => dispatcher.startAdmitted(args),
      carryOver: (work, kept) => dispatcher.carryOver(work, kept),
      comingBack: (work) => dispatcher.comingBack(work),
      retrying: (runId) => dispatcher.retrying(runId),
      retriesAdmitted: () => dispatcher.retriesAdmitted(),
      openedOf: (pr) => opened[pr] ?? null,
      takeBack: (args) => dispatcher.takeBack(args),
      notReady: (pr) => dispatcher.notReady(pr),
      localChange: (pr) => dispatcher.localChange(pr),
      lostCleared: (work, key) => dispatcher.lostCleared(work, key),
      stoppedRuns: () => world.stoppedIds ?? [],
      endLeft: async (folder) => { (world.endedFolders ??= []).push(folder); return { ended: [], survivors: world.survivors ?? [] }; },
      ...reads,
    });
    runner.onEnter((args) => dispatcher.enter(args));
    dispatcher.onStarted((runId, carried) => runner.started(runId, carried));
    dispatcher.onWaiting(() => runner.waitingWork());
    dispatcher.onOwed(() => runner.owedWork());
    dispatcher.onReworks(() => runner.reworkWork());
    dispatcher.onCards(() => runner.openCards());
    dispatcher.onParked(() => runner.parkedHeads());
    dispatcher.onLost(() => runner.lostNow());
    return { dispatcher, runner };
  };
  let joined = build();
  let cursor = '0';
  const latest = (runId) => Object.values(world.runs).flat().filter((r) => r.data.runId === runId).at(-1)?.data;
  async function pump() {
    const { events, cursor: next } = engine.watch(cursor);
    cursor = next;
    for (const event of events) {
      const run = latest(event.runId);
      if (!run) continue;
      if (event.type === 'ask') {
        (world.asks[run.work] ??= []).push({ at: at(), data: { id: event.id, runId: event.runId, work: run.work, kind: event.kind, level: event.level, options: event.options, ...(event.resetAt ? { resetAt: event.resetAt } : {}) } });
        record({ ...run, state: 'paused' });
        await joined.runner.onAsk(event);
      } else if (event.type === 'ask-resolved') record({ ...run, state: 'started' });
      else if (event.type === 'run-ended' && run.state !== 'ended') record({ ...run, state: 'ended', outcome: event.outcome, ...(event.pr ? { pr: event.pr } : {}), ...(event.outcome === 'failed' ? { failure: event.failure ?? 'other', ...(event.failedAt ? { step: event.failedAt } : {}) } : {}) });
    }
  }
  return Object.assign(world, {
    dir,
    views,
    put(id, { lane = 'quick', files = [], place, approved = true, title = id, visible = false } = {}) {
      world.work[id] = { work: { id: `w-${id}`, at: '2026-10-29T08:00:00.000Z', data: { id, title, lane, visible, dependsOn: [], ...(place === undefined ? {} : { place }) } }, approved, since: '2026-10-29T08:00:00.000Z', files };
    },
    // The helper's one look: the router, then the dispatcher, then what the engine said.
    async tick(times = 1) {
      for (let n = 0; n < times; n += 1) {
        tock();
        await pump();
        await joined.runner.tick();
        await joined.dispatcher.tick();
        await pump();
      }
    },
    pump,
    cardOf: (work) => Object.values(world.questions).filter((q) => q.question.data.work === work && !q.answer).map((q) => q.question.data).at(-1) ?? null,
    // A click. `shown` names the pieces whose joiners its card listed, as the views read them from the card clicked.
    answer(work, label, { shown = [] } = {}) {
      const q = Object.values(world.questions).filter((c) => c.question.data.work === work && !c.answer).at(-1);
      q.answer = { label, at: at() };
      world.shown[q.question.data.id] = shown;
      return q.question.data;
    },
    // A run the engine ended, as the host records it.
    endRun(work) {
      const last = (world.runs[work] ?? []).at(-1)?.data;
      record({ ...last, state: 'ended', outcome: 'cancelled' });
    },
    // The reset: the wake process takes a run on from its usage limit.
    lift: (work, id) => engine.act(world.runsOf(work).at(-1), { answer: { ask: id, choice: 'a' } }),
    answers: () => engine.calls.filter((c) => c.call === 'act' && c.action.answer),
    runsOf: (work) => [...new Set((world.runs[work] ?? []).map((r) => r.data.runId))],
    stateOf: (work) => (world.runs[work] ?? []).at(-1)?.data?.state ?? null,
    restart() { joined = build(); },
    // Time passing with the helper awake, a beat of `beat` milliseconds at a time.
    async pass(ms, beat = 60 * 1000) {
      for (let left = ms; left > 0; left -= beat) {
        clock.now = new Date(clock.now.getTime() + beat - 1000);
        await world.tick();
      }
    },
    notes: () => world.written.filter((w) => w.kind === 'note').map((w) => w.data.words),
    cards: () => world.written.filter((w) => w.kind === 'question').map((w) => w.data),
    // How many pieces hold a place now, by the rule the dispatcher counts.
    running: () => Object.keys(world.runs).filter((work) => world.stateOf(work) === 'started').length,
  }) && Object.defineProperties(world, {
    // Getters of their own: `Object.assign` would copy the first pair, and a restart would change nothing.
    dispatcher: { get() { return joined.dispatcher; } },
    runner: { get() { return joined.runner; } },
  });
}
