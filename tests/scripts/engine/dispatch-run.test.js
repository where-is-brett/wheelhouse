// tests/scripts/engine/dispatch-run.test.js
// The dispatcher's runner (scripts/engine/dispatch-run.js): the order each piece starts with carries the project's
// model bindings and test command; work for a project whose tests Wheelhouse can't run waits, said once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dispatchRun, orderFor, TRY_AGAIN } from '../../../scripts/engine/dispatch-run.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { tempFolder } from '../../helpers/homes.js';

const views = () => ({
  work: { 'card-1': { work: { id: 'w-1', at: '2026-10-29T08:00:00.000Z', data: { id: 'card-1', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] } }, approved: false, since: '2026-10-29T08:00:00.000Z' } },
  runs: {}, questions: {},
});

function setUp(config) {
  const dir = tempFolder('wh-dr-');
  const starts = [];
  const written = [];
  const d = dispatchRun({
    engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: views, config: () => config,
    start: async (args) => { starts.push(args); return { ok: true, runId: `run-${starts.length}` }; },
    write: async (kind, data) => { written.push({ kind, data }); },
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  return { d, starts, written };
}

test('a move to a host holds new work', async () => {
  const dir = tempFolder('wh-dr-');
  let moving = true;
  const starts = [];
  const d = dispatchRun({
    engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: views, config: () => ({ testCommand: 'node --test' }), moving: () => moving,
    start: async (args) => { starts.push(args); return { ok: true, runId: `run-${starts.length}` }; },
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  await d.tick();
  assert.equal(starts.length, 0);
  moving = false;
  await d.tick();
  assert.equal(starts.length, 1);
});

test('a project that has moved to a host no longer sweeps the local queue', async () => {
  const dir = tempFolder('wh-dr-');
  let local = true;
  let sweeps = 0;
  const d = dispatchRun({
    engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => ({ work: {}, runs: {}, questions: {} }), config: () => ({ testCommand: 'node --test' }),
    readyOf: () => ({ 7: { head: 'a'.repeat(40), runId: 'r', showFirst: false, work: 'w' } }), isLocal: () => local, localQueue: async () => { sweeps += 1; },
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  await d.tick();
  assert.equal(sweeps, 1);
  local = false;
  await d.tick();
  assert.equal(sweeps, 1);
});

test('the order carries the project\'s model bindings and its test command', async () => {
  const t = setUp({ routing: { tiers: { large: 'model-a', medium: 'model-b' } }, testCommand: 'node --test' });
  await t.d.tick();
  assert.equal(t.starts.length, 1);
  const { order } = t.starts[0];
  assert.deepEqual(order.bindings, { tiers: { large: 'model-a', medium: 'model-b' } });
  assert.equal(order.testCommand, 'node --test');
  assert.deepEqual(order.done, [{ command: 'node --test', expect: 0 }]);
});

test('with no test command Wheelhouse can run, no work starts, and the Logbook says why once', async () => {
  for (const config of [{ routing: {} }, null]) {
    const t = setUp(config);
    await t.d.tick();
    await t.d.tick();
    assert.equal(t.starts.length, 0, JSON.stringify(config));
    const said = t.written.filter((w) => w.kind === 'note');
    assert.equal(said.length, 1);
    assert.match(said[0].data.words, /waits/);
  }
});

const ranOnce = () => ({
  ...views(),
  runs: { 'card-1': [{ at: '2026-10-29T09:00:00.000Z', data: { work: 'card-1', runId: 'run-0', lane: 'quick', state: 'started', branch: 'wh/card-1' } }, { at: '2026-10-29T09:05:00.000Z', data: { work: 'card-1', runId: 'run-0', lane: 'quick', state: 'ended', branch: 'wh/card-1', outcome: 'completed', pr: 3 } }] },
});

function sentBackWorld({ refuse = () => false } = {}) {
  const dir = tempFolder('wh-dr-');
  const starts = [];
  const written = [];
  let seen = ranOnce();
  const d = dispatchRun({
    engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => seen,
    config: () => ({ routing: {}, testCommand: 'node --test' }), settings: () => ({ engineLanes: ['quick'] }),
    start: async (args) => { starts.push(args); return refuse() ? { ok: false, refused: 'the mirror could not be read' } : { ok: true, runId: `run-${starts.length}` }; },
    write: async (kind, data) => { written.push({ kind, data }); },
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  return { d, starts, written, see: (v) => { seen = v; } };
}

test('a red head goes back with its tail in the order, reason red', async () => {
  const t = sentBackWorld();
  t.d.sentBack('card-1', 'red', 'a test failed');
  await t.d.tick();
  assert.equal(t.starts.length, 1);
  assert.equal(t.starts[0].order.checkTail, 'a test failed');
  assert.equal(t.starts[0].carryOn, true);
  assert.equal(t.starts[0].branch, 'wh/card-1');
  await t.d.tick();
  assert.equal(t.starts.length, 1, 'started once for each red');
});

test('a red whose start is refused is tried again, with one line in the Logbook', async () => {
  let refusing = true;
  const t = sentBackWorld({ refuse: () => refusing });
  t.d.sentBack('card-1', 'red', 'a test failed');
  await t.d.tick();
  await t.d.tick();
  assert.equal(t.starts.length, 2);
  assert.equal(t.written.filter((w) => w.kind === 'note').length, 1);
  refusing = false;
  await t.d.tick();
  await t.d.tick();
  assert.equal(t.starts.length, 3);
});

test('a second red raises a card', async () => {
  const t = sentBackWorld();
  t.d.sentBack('card-1', 'red', 'one');
  await t.d.tick();
  t.d.sentBack('card-1', 'red', 'two');
  await t.d.tick();
  await t.d.tick();
  assert.equal(t.starts.length, 1);
  const cards = t.written.filter((w) => w.kind === 'question');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].data.level, 3);
  assert.match(cards[0].data.what, /tests/);
  assert.doesNotMatch(JSON.stringify(cards[0].data), /commit status|pull request/);
});

test('a head that passes wipes the slate, so a later slice\'s first red goes back with no card', async () => {
  const t = sentBackWorld();
  t.d.sentBack('card-1', 'red', 'one');
  await t.d.tick();
  t.d.passed('card-1');
  t.d.sentBack('card-1', 'red', 'a later piece');
  await t.d.tick();
  assert.equal(t.starts.length, 2);
  assert.equal(t.written.filter((w) => w.kind === 'question').length, 0);
});

test('Try again on that card starts it with the newest tail', async () => {
  const t = sentBackWorld();
  t.d.sentBack('card-1', 'red', 'one');
  await t.d.tick();
  t.d.sentBack('card-1', 'red', 'two');
  await t.d.tick();
  const id = t.written.find((w) => w.kind === 'question').data.id;
  t.see({ ...ranOnce(), questions: { [id]: { answer: { label: TRY_AGAIN } } } });
  await t.d.tick();
  await t.d.tick();
  assert.equal(t.starts.length, 2);
  assert.equal(t.starts[1].order.checkTail, 'two');
});

test('a clash still re-queues as before, with no tail', async () => {
  const t = sentBackWorld();
  t.d.sentBack('card-1');
  await t.d.tick();
  assert.equal(t.starts.length, 1);
  assert.equal(Object.hasOwn(t.starts[0].order, 'checkTail'), false);
});

test('work started again carries the director\'s answers in its order, and no others', async () => {
  const t = setUp({ routing: {}, testCommand: 'node --test' });
  const answers = [{ question: 'Task 2, Show refunds: Should a part refund show as its own line?', answer: 'Its own line' }];
  assert.equal((await t.d.startAgain({ work: 'card-1', lane: 'quick', branch: 'wh/card-1', carryOn: true, answers })).ok, true);
  assert.deepEqual(t.starts[0].order.answers, answers);
  assert.equal(t.starts[0].carryOn, true);
  await t.d.startAgain({ work: 'card-1', lane: 'quick', branch: 'wh/card-1', carryOn: true });
  assert.deepEqual(t.starts[1].order.answers, []);
});

test('work routed to a provider that counts requests waits while the count the cap reads, given in its own time, is at the cap', async () => {
  const dir = tempFolder('wh-dr-');
  const starts = [];
  const engine = { ...fakeEngine(), countsRequests: () => true, requestsConfirmed: true };
  let used = 0;
  const d = dispatchRun({
    engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: views,
    config: () => ({ routing: { tiers: { medium: 'counted/model' } }, testCommand: 'node --test' }),
    settings: () => ({ capRequests: 5 }),
    // The provider's own figure is read in its own time, so the count may come as a promise.
    spentThisMonth: async () => used,
    start: async (args) => { starts.push(args); return { ok: true, runId: `run-${starts.length}` }; },
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  used = 5;
  await d.tick();
  assert.equal(starts.length, 0, 'at the cap');
  used = 4;
  await d.tick();
  assert.equal(starts.length, 1);
});

test("the merge queue starts in the folder the helper gives it, never the project's, and not at all when that folder can't be made (check 81)", async () => {
  for (const [given, want] of [[{ ok: true, folder: '/engine/queues/p' }, '/engine/queues/p'], [{ ok: false, refused: 'no mirror' }, null]]) {
    const dir = tempFolder('wh-dr-');
    const engine = fakeEngine();
    const d = dispatchRun({
      engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => ({ work: {}, runs: {}, questions: {} }),
      config: () => ({ routing: {}, testCommand: 'node --test' }), start: async () => ({ ok: false }),
      readyOf: () => ({ 7: { work: 'card-7', head: 'a'.repeat(40) } }), repoOf: () => ({ host: 'github.com', path: 'o/p' }),
      queueFolder: async () => given, now: () => new Date('2026-10-29T10:00:00.000Z'),
    });
    await d.tick();
    const starts = engine.calls.filter((c) => c.call === 'start' && c.order.lane === 'merge');
    assert.deepEqual(starts.map((c) => c.order.project), want === null ? [] : [want]);
  }
});

test('a ruled merge starts the queue on the first tick after the ruling\'s run ends, not at the next sweep', async () => {
  let status = 'paused';
  const starts = [];
  const dir = tempFolder('wh-due-');
  const at = new Date('2026-10-30T06:00:00Z');
  const run = dispatchRun({
    engine: { inspect: async () => ({ status }), start: async (order) => { starts.push(order); return { ok: true, runId: `queue-${starts.length}` }; } },
    project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => ({ work: {}, runs: {}, reports: {} }),
    settings: () => ({}), now: () => at, start: async () => ({ ok: false }), write: async () => {},
    readyOf: () => ({ 7: { work: 'card-7', head: 'a'.repeat(40) } }), repoOf: () => ({ host: 'github.com', path: 'o/p' }),
    queueFolder: async () => ({ ok: true, folder: dir }),
  });
  await run.tick();
  assert.equal(starts.length, 1, 'the first sweep');
  run.queueDue();
  await run.tick();
  assert.equal(starts.length, 1, 'the answered run hasn\'t ended, so its ruling isn\'t recorded yet');
  status = 'completed';
  await run.tick();
  assert.equal(starts.length, 2, 'started at once, well inside the fifteen minutes');
  await run.tick();
  assert.equal(starts.length, 2, 'once');
});

// The merge queue's world over the fake engine, which holds a run at its ask as a paused queue does.
function queueWorld({ queueRuns } = {}) {
  const dir = tempFolder('wh-one-queue-');
  const engine = fakeEngine({ recordings: { merge: [{ type: 'run-started', runId: 'x', at: '2026-10-30T06:00:00.000Z' }, { type: 'ask', runId: 'x', at: '2026-10-30T06:00:01.000Z', id: 'a1', kind: 'question', level: 3, recommend: 'b', options: [{ id: 'b', label: 'B' }] }] } });
  if (queueRuns) engine.queueRuns = queueRuns;
  const at = new Date('2026-10-30T06:00:00Z');
  const repo = { host: 'github.com', path: 'o/p' };
  // How many queue runs were live each time the folder was reset for a start.
  const prepared = [];
  const d = dispatchRun({
    engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => ({ work: {}, runs: {}, reports: {} }),
    now: () => at, start: async () => ({ ok: false }), readyOf: () => ({ 7: { work: 'card-7', head: 'a'.repeat(40) } }), repoOf: () => repo,
    queueFolder: async () => { prepared.push(engine.queueRuns({ folder: dir }).length); return { ok: true, folder: dir }; }, queuePlace: () => dir,
  });
  // Archon's ruling step starting a queue run by itself, which the helper never hears of.
  const ownStart = (folder = dir) => engine.start({ lane: 'merge', project: folder, repo, running: true }).runId;
  return { dir, engine, d, ownStart, prepared, starts: () => engine.calls.filter((c) => c.call === 'start' && c.order.lane === 'merge').length };
}

test('a queue run Archon started itself folds the helper\'s start: one live run, known to the helper, its place taken after it ends', async () => {
  const t = queueWorld();
  const theirs = t.ownStart();
  t.d.queueDue();
  await t.d.tick();
  assert.equal(t.starts(), 1, 'the helper started none beside it');
  assert.equal(t.d.workOf(theirs).work, 'merge-queue', 'its asks are the queue\'s');
  await t.d.tick();
  assert.equal(t.starts(), 1, 'nor on the next tick');
  assert.deepEqual(t.prepared, [], 'its folder wasn\'t reset under it');
  t.engine.act(theirs, { cancel: {} });
  await t.d.tick();
  assert.equal(t.starts(), 2, 'the ruling is still due, so the helper starts the queue once that run has ended');
  await t.d.tick();
  assert.equal(t.starts(), 2, 'and once');
});

test('two ticks at once start one queue run', async () => {
  const t = queueWorld();
  await Promise.all([t.d.tick(), t.d.tick()]);
  assert.equal(t.starts(), 1);
});

test('a queue run in another project\'s folder doesn\'t hold this project\'s', async () => {
  const t = queueWorld();
  t.ownStart('/engine/queues/another');
  await t.d.tick();
  assert.equal(t.starts(), 2);
});

test('no queue run starts while the engine can\'t say what is live, and it starts once it can', async () => {
  let listing = null;
  const t = queueWorld({ queueRuns: async () => listing });
  await t.d.tick();
  assert.equal(t.starts(), 0);
  listing = [];
  await t.d.tick();
  assert.equal(t.starts(), 1);
});

// --- while tests aren't counting ---

test('the order has no default test check while not counting', () => {
  const entry = { work: { key: 'card-1', data: { id: 'card-1', lane: 'quick', title: 'A title', done: [] } } };
  const order = orderFor(entry, { config: { testCommand: 'npm test', testsNotCounting: true, routing: {} } });
  assert.deepEqual(order.done, []);
  assert.equal(order.testsNotCounting, true);
  const counted = orderFor(entry, { config: { testCommand: 'npm test', routing: {} } });
  assert.deepEqual(counted.done, [{ command: 'npm test', expect: 0 }]);
});

test('a project with no host sweeps its own queue, and starts no merge run', async () => {
  const dir = tempFolder('wh-dr-');
  const engine = fakeEngine();
  let swept = 0;
  const started = [];
  const d = dispatchRun({
    engine: { ...engine, start: async (args) => { started.push(args); return { ok: true, runId: 'r' }; } }, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => ({ work: {}, runs: {} }), config: () => ({ testCommand: 'npm test' }),
    start: async () => ({ ok: true, runId: 'x' }), readyOf: () => ({ 1: { work: 'a', head: 'h' } }), localQueue: async () => { swept += 1; },
  });
  await d.tick();
  await d.tick();
  assert.equal(swept, 2, 'every tick, so a check that comes back is seen at once');
  assert.deepEqual(started, []);
});

test('nothing waiting, or All stop, sweeps nothing', async () => {
  const dir = tempFolder('wh-dr-');
  let swept = 0;
  const common = { engine: fakeEngine(), project: 'p', folder: dir, readViews: () => ({ work: {}, runs: {} }), config: () => ({ testCommand: 'npm test' }), localQueue: async () => { swept += 1; } };
  await dispatchRun({ ...common, file: path.join(dir, 'a.json') }).tick();
  await dispatchRun({ ...common, file: path.join(dir, 'b.json'), readyOf: () => ({ 1: { work: 'a', head: 'h' } }), stopped: () => true }).tick();
  assert.equal(swept, 0);
});

test('a project with a host still starts Archon\'s queue', async () => {
  const dir = tempFolder('wh-dr-');
  const starts = [];
  const engine = fakeEngine();
  await dispatchRun({
    engine: { ...engine, start: async (args) => { starts.push(args); return { ok: true, runId: 'q' }; } }, project: 'p', folder: dir, file: path.join(dir, 'q.json'), readViews: () => ({ work: {}, runs: {} }), config: () => ({ testCommand: 'npm test' }),
    readyOf: () => ({ 1: { work: 'a', head: 'h' } }), repoOf: () => ({ host: 'github.com', path: 'o/p' }), queueFolder: async () => ({ ok: true, folder: dir }),
  }).tick();
  assert.equal(starts[0]?.lane, 'merge');
});

test('each card the dispatcher writes is told to the seals, after it is written, and a failure there costs nothing', async () => {
  const dir = tempFolder('wh-dr-');
  const written = [];
  const told = [];
  const held = { ...fakeEngine(), countsRequests: () => true, requestsConfirmed: true };
  const d = dispatchRun({
    engine: held, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: views,
    config: () => ({ routing: {}, testCommand: 'node --test' }), settings: () => ({ engineLanes: ['quick'] }),
    start: async () => ({ ok: true, runId: 'run-1' }), spentThisMonth: () => 0,
    write: async (kind, data) => { written.push({ kind, data }); },
    onCard: (card) => { told.push({ ...card, written: written.some((w) => w.kind === 'question' && w.data.id === card.id) }); throw new Error('the seal broke'); },
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  await d.tick();
  const card = written.find((w) => w.kind === 'question');
  assert.ok(card, 'the requests card is written');
  assert.deepEqual(told, [{ id: card.data.id, kind: 'requests', work: 'card-1', level: 3, written: true }]);
});
