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
// A run that stops at two asks in turn.
export const askingTwice = (one, two) => [...asking(one).slice(0, 3), ...asking(two).slice(1)];
// A run that goes on until it is cancelled.
export const forever = () => [ev({ type: 'run-started' })];
// A run that holds at no ask and ends at once.
export const quiet = () => [ev({ type: 'run-started' }), ev({ type: 'run-ended', outcome: 'completed' })];

export function wayBack({ recordings = {}, pace = 3, settings = {}, testCommand = 'node --test', designOf = () => null, branchPaths = async () => [] } = {}) {
  const dir = tempFolder('wh-way-back-');
  const engine = fakeEngine({ recordings });
  const clock = { now: new Date('2026-10-29T10:00:00.000Z') };
  const world = {
    engine, clock, work: {}, runs: {}, reports: {}, questions: {}, approvals: {}, incidents: { open: [] }, costs: {},
    stop: false, written: [], shown: {}, starts: [], refuse: null, startAs: null, ready: {}, seenPr: {},
  };
  const at = () => clock.now.toISOString();
  const tock = () => { clock.now = new Date(clock.now.getTime() + 1000); };
  const notes = () => world.written.filter((w) => w.kind === 'note').map((w) => ({ kind: 'note', data: w.data }));
  const ended = (data) => (world.runs[data.work] ?? []).filter((r) => r.data.runId === data.engine?.runId).at(-1)?.data.state === 'ended';
  const shownBy = (lead) => Object.values(world.questions).filter((c) => c.question.data.joins === lead && (world.shown[lead] ?? []).includes(c.question.data.work)).map((c) => c.question.data.id);
  const views = () => (joinQuestions(world.questions, { ended, shown: shownBy }), {
    work: world.work, runs: world.runs, reports: world.reports, questions: world.questions, approvals: world.approvals, incidents: world.incidents, costs: world.costs, levels: {}, cardsWaiting: cardsWaitingOf(notes()),
  });
  const record = (data) => { (world.runs[data.work] ??= []).push({ at: at(), data: { engine: 'fake', ...data } }); };
  const realStart = async ({ order, branch, carryOn }) => {
    const got = engine.start({ work: order.work, lane: order.lane, ...(branch ? { branch } : {}), recording: order.work, carryOn });
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
      config: () => ({ routing: {}, testCommand }), readyOf: () => world.ready, prState: async (pr) => world.seenPr[pr] ?? 'open', orderOf: (runId) => world.orders?.[runId] ?? null,
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
      admittedTo: (work) => dispatcher.admittedTo(work),
      delivered: (work, key) => dispatcher.delivered(work, key),
      drop: (work, key) => dispatcher.drop(work, key),
      startAdmitted: (args) => dispatcher.startAdmitted(args),
      carryOver: (work, kept) => dispatcher.carryOver(work, kept),
    });
    runner.onEnter((args) => dispatcher.enter(args));
    dispatcher.onStarted((runId, carried) => runner.started(runId, carried));
    dispatcher.onWaiting(() => runner.waitingWork());
    dispatcher.onCards(() => runner.openCards());
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
        record({ ...run, state: 'paused' });
        await joined.runner.onAsk(event);
      } else if (event.type === 'ask-resolved') record({ ...run, state: 'started' });
      else if (event.type === 'run-ended' && run.state !== 'ended') record({ ...run, state: 'ended', outcome: event.outcome, ...(event.pr ? { pr: event.pr } : {}) });
    }
  }
  return Object.assign(world, {
    dir,
    views,
    get dispatcher() { return joined.dispatcher; },
    get runner() { return joined.runner; },
    put(id, { lane = 'quick', files = [], place, approved = true, title = id } = {}) {
      world.work[id] = { work: { id: `w-${id}`, at: '2026-10-29T08:00:00.000Z', data: { id, title, lane, visible: false, dependsOn: [], ...(place === undefined ? {} : { place }) } }, approved, since: '2026-10-29T08:00:00.000Z', files };
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
    answers: () => engine.calls.filter((c) => c.call === 'act' && c.action.answer),
    runsOf: (work) => [...new Set((world.runs[work] ?? []).map((r) => r.data.runId))],
    stateOf: (work) => (world.runs[work] ?? []).at(-1)?.data?.state ?? null,
    restart() { joined = build(); },
    notes: () => world.written.filter((w) => w.kind === 'note').map((w) => w.data.words),
    cards: () => world.written.filter((w) => w.kind === 'question').map((w) => w.data),
    // How many pieces hold a place now, by the rule the dispatcher counts.
    running: () => Object.keys(world.runs).filter((work) => world.stateOf(work) === 'started').length,
  });
}
