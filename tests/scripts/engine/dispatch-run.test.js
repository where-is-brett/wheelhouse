// tests/scripts/engine/dispatch-run.test.js
// The dispatcher's runner (scripts/engine/dispatch-run.js): the order each piece starts with carries the project's
// model bindings and test command; work for a project whose tests Wheelhouse can't run waits, said once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dispatchRun, orderFor, TRY_AGAIN, STOP_HERE } from '../../../scripts/engine/dispatch-run.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { tempFolder } from '../../helpers/homes.js';
import { wayBack, asking, askingTwice, forever, quiet } from '../../helpers/way-back.js';

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

test('a red whose start is refused is tried again with one line in the Logbook, and a second refusal brings a card', async () => {
  let refusing = true;
  const t = sentBackWorld({ refuse: () => refusing });
  t.d.sentBack('card-1', 'red', 'a test failed');
  await t.d.tick();
  await t.d.tick();
  assert.equal(t.starts.length, 2);
  assert.equal(t.written.filter((w) => w.kind === 'note').length, 1);
  const card = t.written.find((w) => w.kind === 'question').data;
  assert.deepEqual(card.options.map((o) => o.label), [TRY_AGAIN, STOP_HERE]);
  await t.d.tick();
  assert.equal(t.starts.length, 2, 'nothing starts until the director says');
  refusing = false;
  t.see({ ...ranOnce(), questions: { [card.id]: { answer: { label: TRY_AGAIN } } } });
  await t.d.tick();
  assert.equal(t.starts.length, 3);
  assert.equal(t.starts[2].order.checkTail, 'a test failed');
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
  t.d.enter({ work: 'card-1', lane: 'quick', via: 'rework', key: 'first', branch: 'wh/card-1', carryOn: true, answers });
  await t.d.tick();
  assert.deepEqual(t.starts[0].order.answers, answers);
  assert.equal(t.starts[0].carryOn, true);
  t.d.enter({ work: 'card-1', lane: 'quick', via: 'rework', key: 'second', branch: 'wh/card-1', carryOn: true });
  await t.d.tick();
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

test('waitingWork joins the card router\'s pieces and the dispatcher\'s own cards', async () => {
  const dir = tempFolder('wh-dr-');
  const file = path.join(dir, 'dispatch.json');
  fs.writeFileSync(file, JSON.stringify({ clashAsked: { 'card-2': 'q-card-2-1' }, features: { f: { asked: 'q-f-1' } } }));
  const seen = { questions: { 'q-card-2-1': { question: {} }, 'q-f-1': { question: {}, answer: { label: 'Stop here' } } } };
  const d = dispatchRun({ engine: fakeEngine(), project: 'p', folder: dir, file, readViews: () => seen, config: () => ({ testCommand: 'node --test' }) });
  assert.deepEqual([...d.waitingWork()], ['card-2']);
  d.onWaiting(() => new Set(['card-1']));
  assert.deepEqual([...d.waitingWork()].sort(), ['card-1', 'card-2']);
  d.onWaiting(() => { throw new Error('the router can\'t say'); });
  assert.deepEqual([...d.waitingWork()], ['card-2']);
});

// A project with `pieces` queued, for what a piece keeps while it waits. `world.waiting` is what the runner says.
function parking({ pieces = { a: ['expected.js'] }, reads = () => ['built.js'] } = {}) {
  const dir = tempFolder('wh-dr-');
  const file = path.join(dir, 'dispatch.json');
  const at = '2026-10-29T08:00:00.000Z';
  const world = {
    now: new Date('2026-10-29T10:00:00.000Z'), reads: [], written: [], waiting: new Set(), reports: {}, runs: Object.fromEntries(Object.keys(pieces).map((id) => [id, [{ at: '2026-10-29T09:00:00.000Z', data: { work: id, runId: `run-${id}`, lane: 'quick', state: 'paused', branch: `wh/${id}` } }]])),
  };
  const work = Object.fromEntries(Object.entries(pieces).map(([id, files]) => [id, { work: { id: `w-${id}`, at, data: { id, title: `Piece ${id}`, lane: 'quick', visible: false, dependsOn: [] } }, approved: false, since: at, files }]));
  const make = () => {
    const d = dispatchRun({
      engine: fakeEngine(), project: 'p', folder: dir, file, readViews: () => ({ work, runs: world.runs, questions: {}, reports: world.reports }), config: () => ({ testCommand: 'node --test' }),
      start: async () => ({ ok: true, runId: 'new' }), write: async (kind, data) => { world.written.push({ kind, data }); }, now: () => world.now,
      branchPaths: async (args) => { world.reads.push(args); return reads(world.reads.length); },
    });
    d.onWaiting(() => world.waiting);
    return d;
  };
  return { d: make(), make, world, file };
}
const notesOf = (t) => t.world.written.filter((w) => w.kind === 'note').map((w) => w.data.words);

test('a piece parks with its expected files and every path its branch changed', async () => {
  const t = parking();
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  assert.deepEqual(t.world.reads, [{ runId: 'run-a', branch: 'wh/a' }]);
  assert.deepEqual(t.d.reserved(), { a: ['expected.js', 'built.js'] });
});

test('a parking is read once, and a later parking adds to what is reserved', async () => {
  const t = parking({ reads: (n) => [`built-${n}.js`] });
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  await t.d.tick();
  assert.equal(t.world.reads.length, 1);
  t.world.waiting = new Set();
  await t.d.tick();
  assert.deepEqual(t.d.reserved(), { a: ['expected.js', 'built-1.js'] }, 'what parked stays reserved through the gap');
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  assert.deepEqual(t.d.reserved(), { a: ['expected.js', 'built-1.js', 'built-2.js'] });
});

test('an unreadable branch keeps the expected files and is read again', async () => {
  const t = parking({ reads: (n) => (n < 3 ? null : ['built.js']) });
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  assert.deepEqual(t.d.reserved(), { a: ['expected.js'] });
  await t.d.tick();
  assert.equal(t.world.reads.length, 2, 'read again on the next tick');
  assert.deepEqual(notesOf(t).filter((w) => /couldn't be read/.test(w)).length, 1, 'one Logbook line');
  assert.match(notesOf(t)[0], /Piece a/);
  await t.d.tick();
  assert.deepEqual(t.d.reserved(), { a: ['expected.js', 'built.js'] });
  await t.d.tick();
  assert.equal(t.world.reads.length, 3, 'read, so not read again');
});

test('a read that throws counts as unreadable, and costs the tick nothing', async () => {
  const t = parking({ reads: () => { throw new Error('no folder'); } });
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  assert.deepEqual(t.d.reserved(), { a: ['expected.js'] });
});

test('a reservation ends with the piece\'s merge or end, and never by time', async () => {
  for (const outcome of ['merged', 'closed']) {
    const t = parking();
    t.world.waiting = new Set(['a']);
    await t.d.tick();
    t.world.waiting = new Set();
    t.world.now = new Date('2027-10-29T10:00:00.000Z');
    await t.d.tick();
    assert.deepEqual(t.d.reserved(), { a: ['expected.js', 'built.js'] }, 'a year on, it stands');
    t.world.reports = { a: { at: '2027-10-29T09:00:00.000Z', data: { work: 'a', outcome } } };
    await t.d.tick();
    assert.deepEqual(t.d.reserved(), {}, outcome);
  }
});

test('a blocked report ends no reservation', async () => {
  const t = parking();
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  t.world.reports = { a: { at: '2026-10-29T09:30:00.000Z', data: { work: 'a', outcome: 'blocked' } } };
  await t.d.tick();
  assert.deepEqual(Object.keys(t.d.reserved()), ['a']);
});

test('release ends a reservation at once, and one that lands during a read isn\'t put back', async () => {
  const t = parking();
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  t.d.release('a');
  assert.deepEqual(t.d.reserved(), {});
  t.d.release('never-reserved');

  const during = parking({ reads: () => { during.d.release('a'); return ['built.js']; } });
  during.world.waiting = new Set(['a']);
  await during.d.tick();
  assert.deepEqual(during.d.reserved(), {});
});

test('reservations are kept across a restart', async () => {
  const t = parking();
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  const again = t.make();
  assert.deepEqual(again.reserved(), { a: ['expected.js', 'built.js'] });
  await again.tick();
  assert.equal(t.world.reads.length, 1, 'that parking was read already');
});

test('a dispatch.json with no reservations reads as none', async () => {
  const t = parking();
  fs.writeFileSync(t.file, JSON.stringify({ features: {}, clashAsked: {} }));
  assert.deepEqual(t.make().reserved(), {});
});

test('nothing is reserved for work that has gone or ended', async () => {
  const t = parking();
  t.world.waiting = new Set(['gone']);
  await t.d.tick();
  t.world.reports = { a: { at: '2026-10-29T09:30:00.000Z', data: { work: 'a', outcome: 'merged' } } };
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  assert.deepEqual(t.d.reserved(), {});
  assert.deepEqual(t.world.reads, []);
});

test('a piece with no run yet reserves its expected files, with nothing to read', async () => {
  const t = parking();
  t.world.runs = {};
  t.world.waiting = new Set(['a']);
  await t.d.tick();
  assert.deepEqual(t.d.reserved(), { a: ['expected.js'] });
  assert.deepEqual(t.world.reads, []);
  assert.deepEqual(notesOf(t), []);
});

test('the tick still gives dispatch no waiting and no reservations', async () => {
  const t = parking({ pieces: { a: ['one.js'], b: [], c: [] } });
  t.world.waiting = new Set(['a', 'b', 'c']);
  const { start, hold } = await t.d.tick();
  assert.deepEqual([start, hold], [[], []], 'three paused runs keep their places until the wiring');
  assert.deepEqual(t.d.reserved().a, ['one.js', 'built.js']);
});

// Delegated decisions design, section 8.3: every way back passes one check, at most once.
// A piece whose run has ended, asking to go back; `live` is the engine's word on a start that may have happened.
async function uncertainStart({ live }) {
  const w = wayBack({ recordings: { a: quiet(), forever: forever() }, pace: 1 });
  w.put('a');
  await w.tick(2);
  if (live) w.engine.liveRunOf = live;
  w.dispatcher.enter({ work: 'a', lane: 'quick', via: 'rework', key: 'k', branch: 'wh/a', carryOn: true });
  return w;
}
const parked = async (over = {}) => {
  const w = wayBack({ recordings: { a: asking('qa'), busy: asking('qbusy') }, pace: 1, ...over });
  w.put('a', { place: 0 });
  w.put('busy', { place: 1 });
  await w.tick(3);
  return w;
};
const entered = (w) => JSON.parse(fs.readFileSync(path.join(w.dir, 'dispatch.json'), 'utf8'));

test('the click is recorded and the card closes at once, and delivery waits for a place', async () => {
  const w = await parked({ recordings: { a: asking('qa'), busy: forever() } });
  w.answer('a', 'Do the whole page');
  await w.tick(3);
  assert.equal(w.cardOf('a'), null, 'the card has closed');
  assert.equal(w.answers().length, 0, 'the answer waits for a place');
  assert.equal(entered(w).returning.length, 1);
  w.engine.act(w.runsOf('busy')[0], { cancel: { reason: 'done' } });
  await w.tick(2);
  assert.deepEqual(w.answers().map((c) => c.action.answer.ask), ['qa']);
});

test('a path\'s entry stays until its run is seen to start', async () => {
  const w = await uncertainStart({});
  w.refuse = () => 'no';
  await w.tick();
  assert.equal(entered(w).returning.length, 1, 'refused: still on returning');
});

test('each path asks for a place: pace full means no start, and a free place one start', async () => {
  for (const via of ['rework', 'slice', 'carry', 'requeue', 'try-again', 'build-again']) {
    const w = wayBack({ recordings: { a: quiet(), busy: forever() }, pace: 1 });
    w.put('busy', { place: 0 });
    w.put('a', { place: 1 });
    await w.tick();
    w.work.a.approved = true;
    (w.runs.a ??= []).push({ at: '2026-10-29T09:00:00.000Z', data: { work: 'a', runId: 'old', lane: 'quick', state: 'ended', outcome: 'completed', branch: 'wh/a' } });
    w.dispatcher.enter({ work: 'a', lane: 'quick', via, key: 'k', branch: 'wh/a', carryOn: true });
    await w.tick(2);
    assert.equal(w.starts.filter((s) => s.order.work === 'a').length, 0, `${via}: pace full`);
    w.engine.act(w.runsOf('busy')[0], { cancel: { reason: 'done' } });
    await w.tick(3);
    assert.equal(w.starts.filter((s) => s.order.work === 'a').length, 1, `${via}: a place free`);
  }
});

test('a second clash\'s Try again asks for a place and starts once', async () => {
  const t = sentBackWorld();
  t.d.sentBack('card-1');
  await t.d.tick();
  t.d.sentBack('card-1');
  await t.d.tick();
  const id = t.written.find((w) => w.kind === 'question').data.id;
  t.see({ ...ranOnce(), questions: { [id]: { answer: { label: TRY_AGAIN } } } });
  await t.d.tick();
  await t.d.tick();
  assert.equal(t.starts.length, 2);
  assert.equal(t.starts[1].carryOn, true);
});


test('an entry marked starting is never started twice', async () => {
  // The start times out, the run having begun with a run record; a restart on the same files finds it.
  let begun = null;
  const w = await uncertainStart({ live: async () => ({ runId: begun }) });
  const before = w.starts.length;
  w.startAs = async (args, real) => { begun = (await real(args)).runId; return { ok: false, refused: 'no reply in time', uncertain: true }; };
  await w.tick();
  assert.equal(w.starts.length, before + 1);
  assert.equal(w.dispatcher.admittedTo('a'), true, 'it keeps its place while it is settled');
  w.restart();
  await w.tick(3);
  assert.equal(w.starts.length, before + 1, 'no second start');
  assert.equal(w.notes().filter((n) => /couldn't go back/.test(n)).length, 0, 'an uncertain start is no refusal');
});

test('a crash while starting is settled the same way', async () => {
  const w = await uncertainStart({ live: async () => null });
  w.startAs = async () => new Promise(() => {});
  w.tick();
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  assert.equal(entered(w).admitted.some((e) => e.starting), true, 'marked before the start is called');
  const before = w.starts.length;
  w.startAs = null;
  w.restart();
  await w.tick();
  assert.equal(w.starts.length, before + 1, 'no run: started once more');
  await w.tick(3);
  assert.equal(w.starts.length, before + 1);
});

test('an orphan with no run record is cancelled, confirmed ended, then started once', async () => {
  const w = await uncertainStart({ live: async () => (w.orphan ? { runId: w.orphan } : null) });
  const before = w.starts.length;
  w.startAs = async () => { w.orphan = w.engine.start({ recording: 'forever', work: 'a' }).runId; return { ok: false, refused: 'no reply in time', uncertain: true }; };
  await w.tick();
  w.startAs = null;
  await w.tick();
  assert.ok(w.engine.calls.some((c) => c.call === 'act' && c.runId === w.orphan && c.action.cancel), 'cancelled');
  assert.equal(w.engine.inspect(w.orphan).status, 'ended');
  assert.equal(w.starts.length, before + 2, 'started again, once');
  await w.tick(3);
  assert.equal(w.starts.length, before + 2);
});

test('a certain refusal goes straight back, with no liveRunOf and no card', async () => {
  let asked = 0;
  const w = await uncertainStart({ live: async () => { asked += 1; return null; } });
  w.refuse = () => 'no';
  await w.tick();
  assert.equal(asked, 0);
  assert.equal(w.cards().filter((c) => c.options[0].label === TRY_AGAIN).length, 0);
  assert.equal(w.dispatcher.admittedTo('a'), false);
});

test('when liveRunOf can\'t say, or the cancel can\'t be confirmed, a card comes, not a second start', async () => {
  for (const kind of ['can\'t say', 'no method', 'no cancel']) {
    const w = await uncertainStart({ live: async () => (kind === 'no cancel' ? { runId: 'gone' } : undefined) });
    if (kind === 'no method') delete w.engine.liveRunOf;
    const before = w.starts.length;
    w.startAs = async () => ({ ok: false, refused: 'no reply in time', uncertain: true });
    await w.tick();
    w.startAs = null;
    await w.tick(3);
    assert.equal(w.starts.length, before + 1, kind);
    assert.deepEqual(w.cardOf('a').options.map((o) => o.label), [TRY_AGAIN, STOP_HERE], kind);
    assert.equal(w.dispatcher.admittedTo('a'), false, 'the place goes back');
  }
});

test('a refused start gives the place back, says so once, and raises Try again and Stop on the second', async () => {
  const w = await uncertainStart({});
  w.refuse = () => 'the mirror could not be read';
  await w.tick();
  assert.equal(w.dispatcher.admittedTo('a'), false);
  assert.equal(w.notes().filter((n) => /the mirror could not be read/.test(n)).length, 1);
  await w.tick();
  assert.equal(w.notes().filter((n) => /the mirror could not be read/.test(n)).length, 1);
  assert.deepEqual(w.cardOf('a').options.map((o) => o.label), [TRY_AGAIN, STOP_HERE]);
  w.answer('a', STOP_HERE);
  await w.tick();
  assert.deepEqual(entered(w).returning, []);
});

test('a run that pauses on a new ask before it is seen running gives its place up', async () => {
  const w = wayBack({ recordings: { a: askingTwice('one', 'two') }, pace: 1 });
  w.put('a');
  await w.tick();
  w.answer('a', 'Do the whole page');
  await w.tick(2);
  assert.equal(w.answers().length, 1);
  assert.ok(w.cardOf('a'), 'the second ask has its card');
  await w.tick();
  assert.equal(w.dispatcher.admittedTo('a'), false, 'it waits on the director again');
});

test('an answered run the engine hasn\'t carried on keeps its place, and the Logbook says so once', async () => {
  const w = wayBack({ recordings: { a: asking('qa') }, pace: 1 });
  w.put('a');
  await w.tick();
  w.answer('a', 'Do the whole page');
  // No waker: the answer is taken, and the run sits paused (check 85).
  w.engine.act = (runId, action) => { w.engine.calls.push({ call: 'act', runId, action }); return { ok: true }; };
  await w.tick(2);
  assert.equal(w.answers().length, 1);
  w.clock.now = new Date(w.clock.now.getTime() + 10 * 60 * 1000);
  await w.tick(3);
  assert.equal(w.notes().filter((n) => /hasn't carried it on yet/.test(n)).length, 1);
  assert.equal(w.dispatcher.admittedTo('a'), true, 'it keeps its place');
  assert.equal(w.answers().length, 1, 'and nothing is sent twice');
});

test('under an incident answers wait, and go once it closes, even one already admitted', async () => {
  const w = await parked();
  w.engine.act(w.runsOf('busy')[0], { cancel: { reason: 'done' } });
  w.answer('a', 'Do the whole page');
  await w.pump();
  await w.runner.tick();
  await w.dispatcher.tick();
  assert.equal(w.dispatcher.admittedTo('a'), true);
  w.incidents.open = [{ id: 'i-1', kind: 'other' }];
  await w.tick(3);
  assert.equal(w.answers().length, 0);
  w.incidents.open = [];
  await w.tick();
  assert.equal(w.answers().length, 1);
});

test('under All stop nothing admitted starts, and it starts once the stop lifts', async () => {
  const w = await uncertainStart({});
  await w.pump();
  w.stop = true;
  await w.tick(2);
  const before = w.starts.length;
  w.stop = false;
  await w.tick();
  assert.equal(w.starts.length, before + 1);
});

test('queued again by Carry on, an entry leaves and the new start carries on from its branch', async () => {
  const w = await uncertainStart({});
  w.stop = true;
  await w.tick();
  w.work.a.work.at = '2026-10-29T12:00:00.000Z';
  w.stop = false;
  await w.tick();
  const last = w.starts.at(-1);
  assert.equal(last.order.work, 'a');
  assert.equal(last.branch, 'wh/a');
  assert.deepEqual(entered(w).returning, []);
});

test('a Stop beside another open card keeps the files let go of', async () => {
  const w = wayBack({ recordings: { a: asking('qa') }, branchPaths: async () => ['x.js'] });
  w.put('a', { files: ['a.js'] });
  await w.tick(2);
  assert.deepEqual(w.dispatcher.reserved(), { a: ['a.js', 'x.js'] });
  w.dispatcher.release('a');
  await w.tick();
  assert.deepEqual(w.dispatcher.reserved(), {}, 'its other card doesn\'t take the files back');
});
