// tests/scripts/engine/dispatch-run.test.js
// The dispatcher's runner (scripts/engine/dispatch-run.js): the order each piece starts with carries the project's
// model bindings and test command; work for a project whose tests Wheelhouse can't run waits, said once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dispatchRun, orderFor, NO_TESTS_WORDS, TRY_AGAIN, STOP_HERE, BUILD_AGAIN } from '../../../scripts/engine/dispatch-run.js';
import { LIMIT_HOLD_WORDS } from '../../../scripts/engine/words.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { tempFolder } from '../../helpers/homes.js';
import { wayBack, asking, askingTwice, forever, quiet, atLimit, failing, legFinishes } from '../../helpers/way-back.js';
import { running } from '../../eval/build-loop/engine-recordings.js';
import { dataHash } from '../../../scripts/state/events.js';

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
  let views = { work: {}, runs: {}, reports: {} };
  const d = dispatchRun({
    engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => views,
    now: () => at, start: async () => ({ ok: false }), readyOf: () => ({ 7: { work: 'card-7', head: 'a'.repeat(40) } }), repoOf: () => repo,
    queueFolder: async () => { prepared.push(engine.queueRuns({ folder: dir }).length); return { ok: true, folder: dir }; }, queuePlace: () => dir,
  });
  // Archon's ruling step starting a queue run by itself, which the helper never hears of.
  const ownStart = (folder = dir) => engine.start({ lane: 'merge', project: folder, repo, running: true }).runId;
  return { dir, engine, d, ownStart, prepared, setViews: (next) => { views = next; }, starts: () => engine.calls.filter((c) => c.call === 'start' && c.order.lane === 'merge').length };
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

test('the tick gives dispatch what waits and what is reserved, so a waiting piece frees its place', async () => {
  const t = parking({ pieces: { a: ['one.js'], b: [], c: [] } });
  t.world.waiting = new Set(['a', 'b', 'c']);
  await t.d.tick();
  assert.deepEqual(t.d.reserved().a, ['one.js', 'built.js']);
  const w = wayBack({ recordings: { a: asking('qa'), b: quiet() }, pace: 1 });
  w.put('a', { place: 0 });
  w.put('b', { place: 1, files: ['free.js'] });
  await w.tick(2);
  assert.equal(w.runsOf('b').length, 1, 'b starts once a parks');
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

test('each path asks: pace full means no start, and a free place one start', async () => {
  const SLICES = { text: `# F\n\n\`\`\`wheelhouse-slices\n${JSON.stringify({ goal: 'F', flag: { name: 'f' }, demo: 'end', slices: [{ title: 'One', goal: 'One', done: [{ test: 'one' }] }, { title: 'Two', goal: 'Two', done: [{ test: 'two' }] }] })}\n\`\`\`\n` };
  const blocked = asking('qa', { kind: 'blocked', options: [{ id: 'rework', label: 'Send it back' }, { id: 'stop', label: 'Stop' }], context: { question: 'Which?' } });
  // A piece running in the one place, by the record alone.
  const fill = (w) => {
    w.put('filler', { place: 9 });
    w.runs.filler = [{ at: w.clock.now.toISOString(), data: { work: 'filler', runId: 'run-filler', lane: 'quick', state: 'started' } }];
  };
  const free = (w) => w.runs.filler.push({ at: w.clock.now.toISOString(), data: { work: 'filler', runId: 'run-filler', lane: 'quick', state: 'ended', outcome: 'completed' } });
  const paths = {
    rework: { recordings: { a: [blocked, quiet()] }, go: async (w) => {
      await w.tick();
      w.answer('a', 'Send it back');
      while (w.answers().length === 0) await w.tick();
      fill(w);
    } },
    requeue: { recordings: { a: quiet() }, go: async (w) => {
      await w.tick(2);
      fill(w);
      w.dispatcher.sentBack('a');
    } },
    'Try again': { recordings: { a: quiet() }, go: async (w) => {
      await w.tick(2);
      w.dispatcher.sentBack('a');
      await w.tick(2);
      w.dispatcher.sentBack('a');
      await w.tick();
      fill(w);
      w.answer('a', TRY_AGAIN);
    } },
    'Give it more': { recordings: { a: forever() }, go: async (w) => {
      await w.tick();
      const runId = w.runsOf('a')[0];
      w.engine.act(runId, { cancel: { reason: 'its cap' } });
      await w.pump();
      await w.runner.capped({ runId, work: 'a', lane: 'quick', branch: 'wh/a', reached: { cap: 'tokens', limit: 10 } });
      fill(w);
      w.answer('a', 'Give it more');
    } },
    'Build it again': { lane: 'feature', recordings: { a: forever() }, go: async (w) => {
      await w.tick();
      w.engine.act(w.runsOf('a')[0], { cancel: { reason: 'stopped' } });
      await w.tick(2);
      fill(w);
      w.answer('a', BUILD_AGAIN);
    } },
  };
  for (const [name, { recordings, go, lane = 'quick' }] of Object.entries(paths)) {
    const w = wayBack({ recordings, pace: 1, designOf: () => SLICES });
    w.put('a', { lane });
    await go(w);
    const before = w.starts.length;
    await w.tick(2);
    assert.equal(w.starts.length, before, `${name}: pace full`);
    free(w);
    await w.tick(3);
    assert.equal(w.starts.length, before + 1, `${name}: a place free`);
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

test('a run on record since the start was marked counts as started, though it has since ended', async () => {
  const w = await uncertainStart({ live: async () => null });
  const before = w.starts.length;
  // A crash after the start, and the run ending while the helper was down.
  w.startAs = async (args, real) => {
    const { runId } = await real(args);
    w.engine.act(runId, { cancel: { reason: 'it ended' } });
    return { ok: false, refused: 'no reply in time', uncertain: true };
  };
  await w.tick();
  w.startAs = null;
  w.restart();
  await w.tick(3);
  assert.equal(w.starts.length, before + 1, 'the work isn\'t done over');
});

test('a card that couldn\'t be written is written on the next tick', async () => {
  const w = await uncertainStart({});
  w.refuse = () => 'no';
  await w.tick();
  const put = w.questions;
  w.questions = {};
  await w.tick();
  const id = entered(w).returning[0].asked;
  assert.ok(id, 'the entry is waiting on its card');
  w.questions = put;
  delete w.questions[id];
  await w.tick();
  assert.equal(w.cardOf('a')?.id, id, 'the same card comes');
  assert.deepEqual(w.dispatcher.waitingWork(), new Set(['a']));
});

test('a kept card that was never written isn\'t waited on', async () => {
  const w = await uncertainStart({});
  assert.deepEqual(w.dispatcher.waitingWork(), new Set());
});

test('a piece stopped with nothing to move it on, holding files, brings one card', async () => {
  const w = wayBack({ recordings: { a: asking('qa'), b: quiet() }, branchPaths: async () => ['x.js'], pace: 3 });
  w.put('a', { place: 0 });
  await w.tick(2);
  w.answer('a', 'Do the whole page');
  await w.tick(3);
  assert.equal(w.stateOf('a'), 'ended');
  w.put('b', { place: 1, files: ['x.js'] });
  await w.tick(2);
  assert.equal(w.runsOf('b').length, 0, 'its files are still held');
  const card = w.cardOf('a');
  assert.deepEqual(card.options.map((o) => o.label), [TRY_AGAIN, STOP_HERE]);
  await w.tick(2);
  assert.equal(w.cards().filter((c) => c.work === 'a' && c.id === card.id).length, 1, 'one card');
  w.answer('a', STOP_HERE);
  await w.tick(2);
  assert.deepEqual(w.dispatcher.reserved(), {});
  assert.equal(w.runsOf('b').length, 1, 'the files go, so the work behind them starts');
});

test('a Carry on with no reply in time is settled, and keeps what it carries', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 1 });
  w.put('a');
  w.startAs = async () => ({ ok: false, refused: 'no reply in time', uncertain: true });
  w.engine.liveRunOf = async () => undefined;
  await w.tick();
  w.startAs = null;
  await w.tick(2);
  assert.equal(w.starts.length, 1, 'no second start on a guess');
  assert.deepEqual(w.cardOf('a').options.map((o) => o.label), [TRY_AGAIN, STOP_HERE]);
});

test('two answers kept for Carry on both stand', async () => {
  const w = wayBack({});
  w.dispatcher.carryOver('a', { branch: 'wh/a', answers: [{ question: 'One?', answer: 'Yes' }] });
  w.dispatcher.carryOver('a', { branch: 'wh/a', answers: [{ question: 'One?', answer: 'Yes' }, { question: 'Two?', answer: 'No' }] });
  assert.deepEqual(entered(w).carryOver.a.answers.map((a) => a.question), ['One?', 'Two?']);
});

// A project on a host with pull request 7 ready, and the queue due.
function queueSetUp({ parked = {}, queueRuns, ready = { work: 'card-7', head: 'a'.repeat(40), runId: 'r7' }, reports = {}, prState = null, repoOf = () => ({ host: 'github.com', path: 'o/p' }) } = {}) {
  const dir = tempFolder('wh-dr-');
  const engine = fakeEngine();
  if (queueRuns) engine.queueRuns = queueRuns;
  const seen = { ready };
  const entry = { work: { id: 'w-7', at: '2026-10-29T08:00:00.000Z', data: { id: 'card-7', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] } } };
  const d = dispatchRun({
    engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => ({ work: { 'card-7': entry }, runs: {}, reports }), config: () => ({ testCommand: 'node --test' }),
    start: async () => ({ ok: false, refused: 'not here' }), now: () => new Date('2026-10-29T10:00:00.000Z'), isLocal: () => false, prState,
    readyOf: () => ({ 7: seen.ready }), repoOf, repoName: () => 'o/p',
    queueFolder: async () => ({ ok: true, folder: dir }), queuePlace: () => dir,
  });
  d.onParked(() => parked);
  return { d, engine, dir, seen };
}

test('a pull request parked at its head doesn\'t make the queue due', async () => {
  const t = queueSetUp({ parked: { 7: 'a'.repeat(40) } });
  const got = await t.d.tick();
  assert.equal(got.startMergeQueue, false);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('a pull request the queue brought up to date stays left alone, however the heads differ', async () => {
  const t = queueSetUp({ parked: { 7: 'b'.repeat(40) } });
  assert.equal((await t.d.tick()).startMergeQueue, false, 'the record of what was readied names an older head');
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('a pull request readied again at a new head is the queue\'s again', async () => {
  const t = queueSetUp({ parked: { 7: 'a'.repeat(40) } });
  await t.d.tick();
  t.seen.ready = { ...t.seen.ready, head: 'c'.repeat(40) };
  assert.equal((await t.d.tick()).startMergeQueue, true);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('handBack hands the pull request to the queue again', async () => {
  const t = queueSetUp();
  assert.deepEqual(await t.d.handBack({ pr: 7, head: 'a'.repeat(40) }), { ok: true });
  const { item } = t.engine.calls.find((c) => c.call === 'handOver');
  assert.equal(item.project, t.dir);
  assert.equal(item.repo, 'o/p');
  assert.equal(item.pr, 7);
  assert.equal(item.url, 'https://github.com/o/p/pull/7');
  assert.equal(item.runId, 'r7');
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('handBack waits while a queue run is live, whoever started it, so its claim isn\'t written over', async () => {
  const t = queueSetUp({ queueRuns: async () => ['theirs'] });
  assert.deepEqual(await t.d.handBack({ pr: 7, head: 'a'.repeat(40) }), { ok: false, waiting: true });
  assert.equal(t.engine.calls.filter((c) => c.call === 'handOver').length, 0);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('handBack takes the head the queue asked about, though the record of what was readied is older', async () => {
  const t = queueSetUp();
  assert.deepEqual(await t.d.handBack({ pr: 7, head: 'b'.repeat(40) }), { ok: true });
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('handBack hands nothing over for work the director stopped, or a pull request closed or merged', async () => {
  for (const over of [{ reports: { 'card-7': { at: '2026-10-29T09:00:00.000Z', data: { work: 'card-7', outcome: 'closed' } } } }, { prState: async () => 'closed' }, { prState: async () => 'merged' }]) {
    const t = queueSetUp(over);
    assert.deepEqual(await t.d.handBack({ pr: 7, head: 'a'.repeat(40) }), { ok: false, gone: true }, JSON.stringify(Object.keys(over)));
    assert.equal(t.engine.calls.filter((c) => c.call === 'handOver').length, 0);
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('handBack says so when nothing records the pull request as ready', async () => {
  const t = queueSetUp({ ready: null });
  const got = await t.d.handBack({ pr: 7, head: 'a'.repeat(40) });
  assert.equal(got.ok, false);
  assert.ok(got.refused);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

// What the delegated decisions build left open.
test('a hand-over names the host the project is on', async () => {
  const t = queueSetUp({ repoOf: () => ({ host: 'git.example.org', path: 'o/p' }) });
  assert.deepEqual(await t.d.handBack({ pr: 7 }), { ok: true });
  assert.equal(t.engine.calls.find((c) => c.call === 'handOver').item.url, 'https://git.example.org/o/p/pull/7');
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('a project whose host can\'t be named hands nothing over', async () => {
  const t = queueSetUp({ repoOf: () => null });
  assert.equal((await t.d.handBack({ pr: 7 })).ok, false);
  assert.equal(t.engine.calls.filter((c) => c.call === 'handOver').length, 0);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('a start of any path carries what All stop kept, so a stranded Try again doesn\'t lose the answer', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 2 });
  w.put('a');
  await w.tick(2);
  const kept = { question: 'Which page?', answer: 'The first' };
  w.dispatcher.carryOver('a', { branch: 'wh/a', answers: [kept] });
  w.dispatcher.enter({ work: 'a', lane: 'quick', via: 'try-again', key: 'stranded:r' });
  await w.tick(2);
  const last = w.starts.at(-1);
  assert.equal(last.branch, 'wh/a');
  assert.equal(last.carryOn, true);
  assert.deepEqual(last.order.answers, [kept]);
  assert.deepEqual(entered(w).carryOver, {});
});

test('an answer an entry already carries goes once beside what All stop kept', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 2 });
  w.put('a');
  await w.tick(2);
  const kept = { question: 'Which page?', answer: 'The first' };
  w.dispatcher.carryOver('a', { branch: 'wh/a', answers: [kept] });
  w.dispatcher.enter({ work: 'a', lane: 'quick', via: 'rework', key: 'k', branch: 'wh/a', carryOn: true, answers: [kept, { question: 'How big?', answer: 'Small' }] });
  await w.tick(2);
  assert.deepEqual(w.starts.at(-1).order.answers.map((a) => a.question), ['Which page?', 'How big?']);
});

test('work on its way back with no test command says why once', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 2, testCommand: '' });
  w.put('a', { approved: false });
  w.dispatcher.enter({ work: 'a', lane: 'quick', via: 'rework', key: 'k', branch: 'wh/a', carryOn: true });
  await w.tick(3);
  assert.equal(w.starts.length, 0);
  assert.equal(w.notes().filter((n) => n === NO_TESTS_WORDS).length, 1);
});

test('new work is marked before it starts, so a crash during the start doesn\'t double it', async () => {
  const w = wayBack({ recordings: { a: forever() }, pace: 2 });
  w.put('a');
  const file = path.join(w.dir, 'dispatch.json');
  const atCrash = `${file}.at-crash`;
  w.startAs = async (args, real) => {
    const got = await real(args);
    fs.copyFileSync(file, atCrash);
    return got;
  };
  await w.tick();
  w.startAs = null;
  assert.equal(entered(w).admitted.length, 0, 'a start with an answer leaves no mark');
  fs.copyFileSync(atCrash, file);
  assert.equal(entered(w).admitted[0].starting, true);
  w.restart();
  await w.tick(2);
  assert.equal(w.starts.length, 1, 'the run on record counts as started');
  assert.equal(entered(w).admitted.length, 0);
});

test('a run that can\'t be read keeps its entry until it can', async () => {
  const w = wayBack({ recordings: { a: [quiet(), forever()] }, pace: 2 });
  w.put('a');
  await w.tick(2);
  const inspect = w.engine.inspect.bind(w.engine);
  w.engine.inspect = () => ({ status: 'unknown', unread: true, steps: [], branch: null, pr: null });
  w.dispatcher.enter({ work: 'a', lane: 'quick', via: 'rework', key: 'k', branch: 'wh/a', carryOn: true });
  await w.tick(3);
  assert.equal(entered(w).admitted.length, 1, 'not seen yet');
  w.engine.inspect = inspect;
  await w.tick();
  assert.equal(entered(w).admitted.length, 0);
});

test('a start that twice gives no clear answer comes to a card', async () => {
  const w = await uncertainStart({ live: async () => null });
  w.startAs = async () => ({ ok: false, refused: 'garbled', uncertain: true });
  await w.tick(8);
  const card = w.cards().at(-1);
  assert.deepEqual(card.options.map((o) => o.label), [TRY_AGAIN, STOP_HERE]);
  const starts = w.starts.length;
  await w.tick(3);
  assert.equal(w.starts.length, starts, 'nothing more starts until the director says');
});

test('an answer to work that has ended goes nowhere, and its paused run gives its place up', async () => {
  const w = wayBack({ recordings: { a: [quiet(), asking('qa2').slice(0, 3)], b: quiet() }, pace: 1 });
  w.put('a', { place: 0 });
  await w.tick(2);
  w.runs.a.at(-1).data.pr = 7;
  w.dispatcher.sentBack('a');
  await w.tick(3);
  assert.equal(w.stateOf('a'), 'paused');
  w.seenPr[7] = 'merged';
  await w.tick(2);
  assert.equal(w.reports.a.data.outcome, 'merged');
  w.answer('a', 'Do the whole page');
  await w.tick(2);
  assert.equal(w.answers().length, 0);
  assert.equal(w.stateOf('a'), 'ended');
  assert.ok(w.engine.calls.some((c) => c.call === 'act' && c.action.cancel));
  assert.equal(w.notes().filter((n) => /wasn't sent: that work has ended/.test(n ?? '')).length, 1);
  w.put('b', { place: 1 });
  await w.tick(3);
  assert.equal(w.runsOf('b').length, 1, 'its place is free');
});

test('a cap card left open across a Carry on doesn\'t hold the new run\'s answer', async () => {
  const w = wayBack({ recordings: { a: [forever(), asking('qa2').slice(0, 3)] }, pace: 2, settings: { capMinutes: { quick: 1 }, capTokens: {} } });
  w.put('a');
  await w.tick(2);
  w.clock.now = new Date(w.clock.now.getTime() + 10 * 60000);
  await w.tick(2);
  assert.match(w.cardOf('a').what, /cap/);
  w.work.a.work.at = new Date(w.clock.now.getTime() + 500).toISOString();
  w.work.a.since = w.work.a.work.at;
  await w.tick(3);
  assert.equal(w.runsOf('a').length, 2);
  w.answer('a', 'Do the whole page');
  await w.tick(4);
  assert.deepEqual(w.answers().map((c) => c.action.answer.ask), ['qa2']);
});

test('an answer the engine never heard, on work that has since ended, gives the run\'s place up', async () => {
  const w = wayBack({ recordings: { a: asking('qa').slice(0, 2) }, pace: 2 });
  w.put('a');
  await w.tick(2);
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => { if (action.answer) throw new Error('no answer from the engine'); return act(runId, action); };
  w.answer('a', 'Do the whole page');
  await w.tick(3);
  assert.equal(w.stateOf('a'), 'paused');
  w.clock.now = new Date(w.clock.now.getTime() + 1000);
  w.reports.a = { at: w.clock.now.toISOString(), data: { work: 'a', outcome: 'closed' } };
  await w.tick(2);
  assert.equal(w.stateOf('a'), 'ended');
});

test('takeBack says a parked pull request can go back while its work and pull request stand', async () => {
  const t = queueSetUp({ prState: async () => 'open' });
  assert.deepEqual(await t.d.takeBack({ pr: 7, work: 'card-7' }), { ok: true });
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('takeBack says gone for work that ended or a pull request closed or merged, and waits when the host can\'t say', async () => {
  for (const over of [{ reports: { 'card-7': { at: '2026-10-29T09:00:00.000Z', data: { work: 'card-7', outcome: 'closed' } } } }, { prState: async () => 'closed' }, { prState: async () => 'merged' }]) {
    const t = queueSetUp(over);
    assert.deepEqual(await t.d.takeBack({ pr: 7, work: 'card-7' }), { ok: false, gone: true }, JSON.stringify(Object.keys(over)));
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
  const t = queueSetUp({ prState: async () => null });
  assert.deepEqual(await t.d.takeBack({ pr: 7, work: 'card-7' }), { ok: false });
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('takeBack says gone for work the record no longer holds', async () => {
  const t = queueSetUp({ prState: async () => 'open' });
  assert.deepEqual(await t.d.takeBack({ pr: 7, work: 'someone-else' }), { ok: false, gone: true });
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('a pull request taken back leaves what the queue is due for, and only a project in git alone reads a change here', async () => {
  const left = [];
  const dir = tempFolder('wh-dr-');
  const ready = { 7: { work: 'card-7', head: 'a'.repeat(40), runId: 'r7' } };
  const on = (local) => dispatchRun({
    engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => ({}), readyOf: () => ready, notReady: (pr) => left.push(pr),
    localQueue: async () => {}, isLocal: () => local, start: async () => ({ ok: false }),
  });
  on(false).notReady(7);
  assert.deepEqual(left, [7]);
  assert.equal(on(false).localChange(7), null, 'a host\'s pull request has its own queue');
  assert.deepEqual(on(true).localChange(7), ready[7]);
  assert.equal(on(true).localChange(8), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a limit stops new starts, and they start once it lifts', async () => {
  const w = wayBack({ recordings: { a: atLimit('lim-a'), b: quiet() } });
  w.put('a', { place: 0 });
  await w.tick(2);
  assert.equal(w.stateOf('a'), 'paused');
  w.put('b', { place: 1 });
  await w.tick(3);
  assert.deepEqual(w.runsOf('b'), []);
  w.lift('a', 'lim-a');
  await w.tick(3);
  assert.equal(w.runsOf('b').length, 1);
});

test('an answer waits out a limit, and goes back once it lifts', async () => {
  const w = wayBack({ recordings: { a: atLimit('lim-a'), b: asking('ask-b') } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  w.answer('b', 'Keep it small');
  await w.tick(3);
  assert.equal(w.answers().filter((c) => c.action.answer.ask === 'ask-b').length, 0);
  assert.equal(w.stateOf('b'), 'paused');
  w.lift('a', 'lim-a');
  await w.tick(3);
  assert.equal(w.answers().filter((c) => c.action.answer.ask === 'ask-b').length, 1);
});

test('what was admitted before a limit starts nothing until it lifts', async () => {
  const w = wayBack({ recordings: { a: quiet(), b: forever() } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  const begun = w.starts.length;
  const run = w.runs.b.at(-1).data;
  w.asks.b = [{ at: '2026-10-29T10:01:00.000Z', data: { id: 'lim-b', runId: run.runId, work: 'b', kind: 'usage-limit', level: 1, options: [] } }];
  w.runs.b.push({ at: '2026-10-29T10:01:00.000Z', data: { ...run, state: 'paused' } });
  const inspect = w.engine.inspect.bind(w.engine);
  w.engine.inspect = async (id) => (id === run.runId ? { status: 'paused' } : inspect(id));
  w.dispatcher.enter({ work: 'a', lane: 'quick', via: 'try-again', key: 'k', branch: 'wh/a', carryOn: true });
  fs.writeFileSync(path.join(w.dir, 'dispatch.json'), JSON.stringify((() => { const kept = JSON.parse(fs.readFileSync(path.join(w.dir, 'dispatch.json'), 'utf8')); kept.admitted = kept.returning; kept.returning = []; return kept; })()));
  w.restart();
  await w.tick(2);
  assert.equal(w.starts.length, begun);
  assert.ok(w.dispatcher.admittedTo('a'), 'it keeps its place');
  w.runs.b.push({ at: '2026-10-29T10:03:00.000Z', data: { ...run, state: 'started' } });
  await w.tick(2);
  assert.equal(w.starts.length, begun + 1);
});

test('a hold for a limit counts as moving, so no top card rises and no noCardBehind note is written', async () => {
  const w = wayBack({ recordings: { a: atLimit('lim-a'), b: asking('ask-b'), c: quiet() }, pace: 2 });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  w.put('c', { place: 2, files: ['x.js'] });
  await w.pass(5 * 60 * 1000);
  const tops = w.written.filter((x) => x.kind === 'note' && x.data.about === 'top-card');
  assert.ok(tops.every((x) => x.data.id === null), 'nothing rises');
  assert.ok(!w.notes().some((words) => /no card stands behind/.test(words ?? '')));
});

test('a limit counts as moving when its run holds no place of its own, as a fix\'s doesn\'t', async () => {
  const w = wayBack({ recordings: { a: atLimit('lim-a'), b: asking('ask-b') } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  delete w.work.a;
  await w.pass(3 * 60 * 1000);
  assert.ok(w.written.filter((x) => x.kind === 'note' && x.data.about === 'top-card').every((x) => x.data.id === null), 'nothing rises');
});

test('the Logbook says once that a limit holds new work, and again for a later limit', async () => {
  const held = (w) => w.notes().filter((words) => words === LIMIT_HOLD_WORDS).length;
  const w = wayBack({ recordings: { a: atLimit('lim-a'), b: forever() } });
  w.put('b', { place: 0 });
  w.put('a', { place: 1 });
  await w.tick(4);
  assert.equal(held(w), 1);
  w.lift('a', 'lim-a');
  await w.tick(2);
  const run = w.runs.b.at(-1).data;
  w.asks.b = [{ at: '2026-10-29T10:01:00.000Z', data: { id: 'lim-b', runId: run.runId, work: 'b', kind: 'usage-limit', level: 1, options: [] } }];
  w.runs.b.push({ at: '2026-10-29T10:01:00.000Z', data: { ...run, state: 'paused' } });
  await w.tick(2);
  assert.equal(held(w), 2);
  w.restart();
  await w.tick(2);
  assert.equal(held(w), 2, 'a helper started again doesn\'t say it twice');
});

test('a limit hides a requests hold and ends none, so an answered card isn\'t asked again', async () => {
  const world = { limited: false };
  const dir = tempFolder('wh-dr-');
  const written = [];
  const questions = {};
  const work = { 'card-1': { work: { id: 'w-1', at: '2026-10-29T08:00:00.000Z', data: { id: 'card-1', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] } }, approved: false, since: '2026-10-29T08:00:00.000Z' } };
  const limited = { runs: { other: [{ at: '2026-10-29T09:00:00.000Z', data: { work: 'other', runId: 'r1', lane: 'quick', state: 'paused' } }] }, asks: { other: [{ at: '2026-10-29T09:00:00.000Z', data: { id: 'lim', runId: 'r1', work: 'other', kind: 'usage-limit', level: 1, options: [] } }] } };
  const d = dispatchRun({
    engine: { ...fakeEngine(), countsRequests: () => true, requestsConfirmed: true }, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'),
    readViews: () => ({ work, runs: {}, questions, reports: {}, ...(world.limited ? limited : {}) }),
    config: () => ({ routing: {}, testCommand: 'node --test' }), settings: () => ({ engineLanes: ['quick'] }), spentThisMonth: () => 0,
    start: async () => ({ ok: false, refused: 'not here' }), write: async (kind, data) => { written.push({ kind, data }); if (kind === 'question') questions[data.id] = { question: { data } }; },
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  await d.tick();
  const asked = written.filter((x) => x.kind === 'question');
  assert.equal(asked.length, 1);
  questions[asked[0].data.id].answer = { label: 'Keep it off' };
  world.limited = true;
  await d.tick();
  world.limited = false;
  await d.tick();
  assert.equal(written.filter((x) => x.kind === 'question').length, 1);
});

// A goal in force, and the gate every start passes (unattended goals design, section 6; build plan, choice 9).
const MINUTE = 60 * 1000;
const goalOver = (w, pieces, { id = 'g', until = '2026-10-29T18:00:00.000Z', ended = null, waived = [], spend = { tokens: 100000000 } } = {}) => {
  w.goals[id] = {
    sheet: { title: 'A goal', until, spend, pieces: pieces.map((work) => ({ work, hash: dataHash(w.work[work].work.data), ...(waived.includes(work) ? { waived: true } : {}) })) },
    hash: 'signed', startedAt: '2026-10-29T09:00:00.000Z', ended, endAsked: null,
  };
};
const ENDED = { ending: 'time', at: '2026-10-29T10:00:00.000Z', spent: {} };
const resumes = (w) => w.engine.calls.filter((c) => c.call === 'act' && c.action.resume);
const entryFor = (work, via) => ({ work, lane: 'quick', via, key: `${via}:1`, branch: `wh/${work}`, carryOn: true });

test('work outside the goal waits, and a piece of the goal starts with no approval', async () => {
  const w = wayBack({ recordings: { in: forever(), out: forever() } });
  w.put('out', { approved: true, place: 0 });
  w.put('in', { approved: false, lane: 'bug' });
  goalOver(w, ['in']);
  await w.tick();
  assert.deepEqual(w.starts.map((s) => s.order.work), ['in']);
  assert.equal(w.starts[0].order.goalId, 'g');
});

test('a start held at a bound raises no card', async () => {
  const w = wayBack({ recordings: { a: quiet() } });
  w.put('a');
  goalOver(w, ['a'], { until: '2026-10-29T10:05:00.000Z' });
  await w.tick(2);
  w.dispatcher.enter(entryFor('a', 'rework'));
  w.clock.now = new Date('2026-10-29T10:06:00.000Z');
  const before = w.starts.length;
  await w.tick(5);
  assert.equal(w.starts.length, before);
  assert.deepEqual(w.cards(), []);
  assert.equal(w.dispatcher.comingBack('a'), true, 'it keeps its place in the list');
  assert.equal(w.notes().filter((n) => /until|time/i.test(n)).length, 1, 'the Logbook says so once');
});

test('a rework, a next slice and a Try again all pass the gate', async () => {
  for (const via of ['rework', 'slice', 'try-again']) {
    const w = wayBack({ recordings: { a: quiet() } });
    w.put('a');
    goalOver(w, ['a']);
    await w.tick(2);
    w.goals.g.sheet.until = '2026-10-29T10:00:00.000Z';
    const before = w.starts.length;
    w.dispatcher.enter(entryFor('a', via));
    await w.tick(3);
    assert.equal(w.starts.length, before, via);
    assert.equal(w.dispatcher.comingBack('a'), true, via);
  }
});

test('a new sheet listing a held piece clears it', async () => {
  const w = wayBack({ recordings: { a: quiet() } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  w.goals.g.sheet.until = '2026-10-29T10:00:00.000Z';
  const before = w.starts.length;
  w.dispatcher.enter(entryFor('a', 'requeue'));
  await w.tick(2);
  assert.equal(w.starts.length, before);
  w.goals.g.ended = ENDED;
  await w.tick(2);
  assert.equal(w.starts.length, before, 'still held once the goal has ended');
  goalOver(w, ['a'], { id: 'g2' });
  await w.tick(2);
  assert.equal(w.starts.length, before + 1);
  assert.equal(w.starts.at(-1).order.goalId, 'g2');
});

test('a held piece of no goal goes on once the goal ends', async () => {
  const w = wayBack({ recordings: { out: quiet(), in: forever() } });
  w.put('out', { place: 0 });
  await w.tick(2);
  w.put('in');
  goalOver(w, ['in']);
  await w.tick();
  const before = w.starts.filter((s) => s.order.work === 'out').length;
  w.dispatcher.enter(entryFor('out', 'rework'));
  await w.tick(2);
  assert.equal(w.starts.filter((s) => s.order.work === 'out').length, before);
  w.goals.g.ended = ENDED;
  await w.tick(2);
  assert.equal(w.starts.filter((s) => s.order.work === 'out').length, before + 1);
});

test('the fix lane passes the time bound', async () => {
  const w = wayBack({ recordings: {} });
  w.put('a');
  goalOver(w, ['a'], { until: '2026-10-29T09:30:00.000Z' });
  w.green = false;
  w.incidents.open = [{ id: 'red-main-0123456789', what: 'The main line\'s checks are red.', kind: 'red-main', suspect: 12, work: 'fix-main-red-main-0123456789', at: '2026-10-29T09:40:00.000Z', fixes: [] }];
  await w.tick();
  assert.deepEqual(w.starts.map((s) => s.order.lane), ['fix-main']);
});

test('after the goal\'s end an answered piece starts, and a next slice doesn\'t', async () => {
  const w = wayBack({ recordings: { a: quiet(), b: quiet() } });
  w.put('a');
  w.put('b');
  goalOver(w, ['a', 'b']);
  await w.tick(2);
  w.goals.g.ended = ENDED;
  const before = w.starts.length;
  w.dispatcher.enter(entryFor('a', 'slice'));
  await w.tick(2);
  assert.equal(w.starts.length, before);
  w.dispatcher.enter(entryFor('b', 'rework'));
  await w.tick(2);
  assert.deepEqual(w.starts.slice(before).map((s) => s.order.work), ['b']);
  assert.equal(w.starts.at(-1).order.goalId, 'g', 'its areas still govern it');
});

test('a piece not in the goal\'s list with a live run keeps going', async () => {
  const w = wayBack({ recordings: { out: forever(), in: forever() } });
  w.put('out');
  await w.tick(2);
  w.put('in');
  goalOver(w, ['in']);
  await w.tick(3);
  assert.equal(w.stateOf('out'), 'started');
  assert.equal(w.engine.calls.filter((c) => c.call === 'act').length, 0);
});

test('a retry is a start: it asks the gate', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes()] } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(3);
  await w.pass(7 * MINUTE);
  assert.equal(resumes(w).length, 1, 'in force and inside its bounds, it is resumed');
});

test('a retry that a goal\'s gate would hold parks the piece', async () => {
  const w = wayBack({ recordings: { a: failing('connection') } });
  w.put('a');
  goalOver(w, ['a'], { until: '2026-10-29T10:01:00.000Z' });
  await w.tick(3);
  await w.pass(10 * MINUTE);
  assert.equal(resumes(w).length, 0);
  const card = w.cardOf('a');
  assert.deepEqual(card.options.map((o) => o.label), [TRY_AGAIN, STOP_HERE]);
  assert.equal(w.dispatcher.retrying(w.runsOf('a')[0]), false);
});

test('a retry on the list when the gate closes leaves it, and comes to its card', async () => {
  const w = wayBack({ recordings: { a: failing('connection'), b: forever() }, pace: 1 });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  goalOver(w, ['a', 'b']);
  await w.tick(3);
  await w.pass(6 * MINUTE);
  assert.ok(w.dispatcher.comingBack('a'), 'it waits for a place');
  w.goals.g.sheet.until = w.clock.now.toISOString();
  await w.pass(3 * MINUTE);
  assert.equal(w.cardOf('a')?.recommendation, TRY_AGAIN);
  assert.deepEqual(w.dispatcher.retryingWork(w.views()), new Set());
  assert.equal(resumes(w).length, 0);
});

test('a retry admitted when the gate closes isn\'t resumed by the runner', async () => {
  const w = wayBack({ recordings: { a: failing('connection') } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(3);
  w.goals.g.sheet.until = '2026-10-29T10:03:00.000Z';
  await w.pass(7 * MINUTE);
  assert.equal(resumes(w).length, 0);
});

test('a waived piece\'s order doesn\'t show first, and an unwaived visible piece\'s does', async () => {
  const w = wayBack({ recordings: { small: forever(), plain: forever() } });
  w.put('small', { visible: true, approved: false, place: 0 });
  w.put('plain', { visible: true, approved: false, place: 1 });
  goalOver(w, ['small', 'plain'], { waived: ['small'] });
  await w.tick();
  const shown = Object.fromEntries(w.starts.map((s) => [s.order.work, s.order.showFirst]));
  assert.deepEqual(shown, { small: false, plain: true });
});

test('an order names no goal with none in force', async () => {
  const t = setUp({ testCommand: 'node --test' });
  await t.d.tick();
  assert.equal(Object.hasOwn(t.starts[0].order, 'goalId'), false);
});

// The spend meter at the gate (unattended goals design, section 5).
const spent = (w, work, tokens, runId = `old-${work}`) => {
  (w.runs[work] ??= []).push({ at: '2026-10-29T09:30:00.000Z', data: { work, lane: 'quick', runId, state: 'started' } }, { at: '2026-10-29T09:40:00.000Z', data: { work, lane: 'quick', runId, state: 'ended' } });
  (w.costs[work] ??= []).push({ at: '2026-10-29T09:40:00.000Z', data: { runId, work, tokens, source: 'reported' } });
};
const keptOf = (w) => JSON.parse(fs.readFileSync(path.join(w.dir, 'dispatch.json'), 'utf8'));
const goalBack = (dispatchExtra = {}) => wayBack({ recordings: { a: forever(), b: forever(), big: forever() }, dispatchExtra, settings: { engineLanes: ['quick', 'small'] } });

test('a spend reached holds a goal\'s piece with no card, and a narrower sheet can\'t hide it', async () => {
  const w = goalBack();
  w.put('a');
  goalOver(w, ['a'], { spend: { tokens: 1000 } });
  spent(w, 'gone', 1000);
  await w.tick(3);
  assert.equal(w.starts.length, 0);
  assert.deepEqual(w.cards(), []);
});

test('a piece whose cap doesn\'t fit waits, and one that fits starts', async () => {
  const w = goalBack();
  w.put('big', { lane: 'small' });
  w.put('a');
  goalOver(w, ['big', 'a'], { spend: { tokens: 2000000 } });
  await w.tick(3);
  assert.deepEqual(w.starts.map((s) => s.order.work), ['a']);
  assert.deepEqual(w.cards(), []);
});

test('a rework the meter holds keeps its place, and a sheet with room lets it go', async () => {
  const w = wayBack({ recordings: { a: quiet() } });
  w.put('a');
  goalOver(w, ['a'], { spend: { tokens: 5000000 } });
  await w.tick(2);
  w.goals.g.sheet.spend = { tokens: 1000 };
  spent(w, 'gone', 1000);
  const before = w.starts.length;
  w.dispatcher.enter(entryFor('a', 'rework'));
  await w.tick(3);
  assert.equal(w.starts.length, before);
  assert.equal(w.dispatcher.comingBack('a'), true);
  assert.equal(w.notes().filter((n) => /spend/.test(n)).length, 1, 'the Logbook says so once');
  w.goals.g.sheet.spend = { tokens: 5000000 };
  await w.tick(3);
  assert.equal(w.starts.length, before + 1);
});

test('a limit met mid-run holds what comes next, and the run goes on', async () => {
  const w = wayBack({ recordings: { a: running('a', 1000000), b: forever() }, pace: 1 });
  w.put('a');
  w.put('b');
  goalOver(w, ['a', 'b'], { spend: { tokens: 1000000 } });
  await w.tick(4);
  assert.deepEqual(w.starts.map((s) => s.order.work), ['a']);
  assert.equal(keptOf(w).goalSpend.meter.reached, 'tokens', 'read from the live run');
  assert.equal(w.engine.calls.filter((c) => c.call === 'act').length, 0, 'ending it is the wind-down\'s');
  w.endRun('a');
  await w.tick(3);
  assert.deepEqual(w.starts.map((s) => s.order.work), ['a'], 'its place freed, the next piece still holds');
});

test('the share at Start is kept beside the goal, once, and points hold a piece', async () => {
  const reading = { share: 40, shareAt: '2026-10-29T09:05:00.000Z', resetsAt: '2026-11-03T00:00:00.000Z' };
  const w = goalBack({ allowance: () => ({ ...reading }) });
  w.put('a');
  goalOver(w, ['a'], { spend: { tokens: 100000000, points: 5 } });
  w.clock.now = new Date('2026-10-29T09:10:00.000Z');
  await w.tick(1);
  assert.deepEqual(keptOf(w).goalSpend.shareAtStart, { share: 40, shareAt: '2026-10-29T09:05:00.000Z', resetsAt: '2026-11-03T00:00:00.000Z' });
  Object.assign(reading, { share: 46, shareAt: w.clock.now.toISOString() });
  await w.tick(2);
  const { goalSpend } = keptOf(w);
  assert.equal(goalSpend.shareAtStart.share, 40);
  assert.equal(goalSpend.meter.points, 6);
  assert.equal(goalSpend.meter.reached, 'points');
});

test('a helper started again keeps the meter and the share at Start', async () => {
  const reading = { share: 40, shareAt: '2026-10-29T09:05:00.000Z', resetsAt: '2026-11-03T00:00:00.000Z' };
  let read = reading;
  const w = goalBack({ allowance: () => read });
  w.put('a');
  goalOver(w, ['a'], { spend: { tokens: 1000 } });
  spent(w, 'gone', 1000);
  await w.tick(1);
  read = { ...reading, share: 45, shareAt: '2026-10-29T10:00:00.000Z' };
  w.restart();
  await w.tick(1);
  assert.equal(keptOf(w).goalSpend.shareAtStart.share, 40);
  assert.equal(w.starts.length, 0);
});

test('a new goal starts its meter afresh', async () => {
  const w = goalBack();
  w.put('a');
  goalOver(w, ['a'], { spend: { tokens: 1000 } });
  await w.tick(1);
  const first = keptOf(w).goalSpend;
  assert.equal(first.goal, 'g');
  w.goals.g.ended = ENDED;
  goalOver(w, ['a'], { id: 'g2' });
  await w.tick(1);
  assert.equal(keptOf(w).goalSpend.goal, 'g2');
});

test('counted requests are those since Start, and a new month starts from what it has', async () => {
  let used = 200;
  const w = goalBack({ spentThisMonth: () => used });
  w.engine.countsRequests = () => true;
  w.engine.requestsConfirmed = true;
  w.put('a');
  goalOver(w, ['a'], { spend: { tokens: 100000000, requests: 10 } });
  await w.tick(1);
  assert.equal(keptOf(w).goalSpend.meter.requests, 0);
  used = 207;
  await w.tick(1);
  assert.equal(keptOf(w).goalSpend.meter.requests, 7);
  used = 4;
  await w.tick(1);
  assert.equal(keptOf(w).goalSpend.meter.requests, 4);
});

test('a project that counts no requests reads none', async () => {
  const w = goalBack();
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(1);
  assert.equal(keptOf(w).goalSpend.meter.requests, null);
});

test('with no goal in force nothing is metered', async () => {
  const w = goalBack();
  w.put('a');
  await w.tick(2);
  assert.equal(keptOf(w).goalSpend, null);
  assert.equal(w.starts.length, 1);
});

test('a merge-queue run during a goal is kept once and counted, and read no more once it has ended', async () => {
  const t = queueWorld();
  const work = { work: { at: '2026-10-30T05:00:00.000Z', data: { id: 'a', title: 'A', lane: 'quick', visible: false, dependsOn: [] } }, approved: true };
  const live = { work: { a: work }, runs: {}, reports: {}, goals: { g: { sheet: { until: '2026-10-30T18:00:00.000Z', spend: { tokens: 1000 }, pieces: [{ work: 'a', hash: dataHash(work.work.data) }] }, hash: 'signed', startedAt: '2026-10-30T05:00:00.000Z', ended: null, endAsked: null } } };
  t.setViews(live);
  const theirs = t.ownStart();
  t.d.queueDue();
  await t.d.tick();
  await t.d.tick();
  const kept = JSON.parse(fs.readFileSync(path.join(t.dir, 'dispatch.json'), 'utf8'));
  assert.deepEqual(kept.goalQueueRuns, [theirs]);
  t.engine.act(theirs, { cancel: {} });
  await t.d.tick();
  await t.d.tick();
  const reads = t.engine.calls.length;
  let read = 0;
  const { inspect } = t.engine;
  t.engine.inspect = (id) => { if (id === theirs) read += 1; return inspect(id); };
  await t.d.tick();
  await t.d.tick();
  assert.equal(read, 0, `read again after it ended (${reads} calls before)`);
});
