// tests/scripts/engine/areas.test.js
// A goal's areas (unattended goals design, sections 5 and 6): which changed paths fall outside them, which goal's areas a
// piece's order takes, and the dispatcher's card for a change held at mark ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { outsideAreas, areaQuestion, areaAnswer, ALLOW_ONCE } from '../../../scripts/engine/areas.js';
import { areasOf, fixAreas, checkSheet } from '../../../scripts/engine/goal.js';
import { checkOrder, workOrder } from '../../../scripts/engine/order.js';
import { dispatchRun, STOP_HERE } from '../../../scripts/engine/dispatch-run.js';
import { dataHash } from '../../../scripts/state/events.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-11-01T01:00:00.000Z');
const AREAS = { may: ['src/orders/**', 'tests/orders/**'], wontTouch: ['tests/orders/export.test.js', 'src/orders/billing/**'] };

test('a path is outside when it is out of may, or inside wontTouch', () => {
  assert.deepEqual(outsideAreas(['src/orders/a.js', 'src/users/b.js'], AREAS), ['src/users/b.js']);
  assert.deepEqual(outsideAreas(['tests/orders/export.test.js'], AREAS), ['tests/orders/export.test.js']);
  assert.deepEqual(outsideAreas(['src/orders/billing/c.js'], AREAS), ['src/orders/billing/c.js']);
});

test('names match in any case, as the shown-first check matches them', () => {
  assert.deepEqual(outsideAreas(['SRC/Orders/a.js', 'TESTS/orders/EXPORT.test.js'], AREAS), ['TESTS/orders/EXPORT.test.js']);
});

test('no areas leave every path free', () => {
  assert.deepEqual(outsideAreas(['anything.js'], null), []);
  assert.deepEqual(outsideAreas(['anything.js'], undefined), []);
});

test('an empty may allows nothing, so a narrowing can never turn into a widening', () => {
  assert.deepEqual(outsideAreas(['src/orders/a.js'], { may: [], wontTouch: [] }), ['src/orders/a.js']);
});

test('with no may at all only wontTouch holds, as on a fix for a red main line', () => {
  assert.deepEqual(outsideAreas(['src/users/b.js', 'tests/orders/export.test.js'], { wontTouch: ['tests/orders/export.test.js'] }), ['tests/orders/export.test.js']);
});

test('a guardrail path can\'t be listed in may', () => {
  const sheet = (may) => ({
    title: 'Export', done: [{ command: 'npm test', expect: 0 }], checksSay: ['the tests pass'], pieces: [{ work: 'card-1', hash: 'h' }],
    areas: { may, wontTouch: [] }, spend: { tokens: 1000 }, until: '2026-11-01T09:00:00.000Z',
  });
  assert.equal(checkSheet(sheet(['src/**', 'tests/**', 'docs/*.md']), { now: NOW }), null);
  for (const pattern of ['.claude/settings.json', '.claude/**', 'CLAUDE.md', 'src/CLAUDE.md', '.mcp.json', '.archon/**', 'engine/archon/pack/**', '.github/workflows/ci.yml', '.GITHUB/workflows/**', 'AGENTS.md', '**', '.claude/*', '*']) {
    assert.match(checkSheet(sheet(['src/**', pattern]), { now: NOW }), /guardrail/, pattern);
  }
});

const entry = (data) => ({ work: { data }, approved: false });
const goalNamed = (id, { pieces = [], ended = null, areas = AREAS, checkFiles = [], startedAt = '2026-11-01T00:00:00.000Z' } = {}) => ({
  [id]: { sheet: { pieces, areas, checkFiles }, hash: `hash-${id}`, startedAt, ended, endAsked: null },
});

test('a piece\'s order takes the areas of the goal its goalId names', () => {
  const views = { goals: goalNamed('g-1'), work: { 'card-1': entry({ id: 'card-1', goalId: 'g-1' }) } };
  assert.deepEqual(areasOf(views, 'card-1'), { goal: 'g-1', since: '2026-11-01T00:00:00.000Z', ...AREAS });
});

test('the areas still govern after the goal ends', () => {
  const views = { goals: goalNamed('g-1', { ended: { ending: 'time', at: '2026-11-01T08:00:00.000Z' } }), work: { 'card-1': entry({ id: 'card-1', goalId: 'g-1' }) } };
  assert.deepEqual(areasOf(views, 'card-1').may, AREAS.may);
});

test('a piece the sheet lists is governed with no goalId, while its record stands', () => {
  const data = { id: 'card-1' };
  const views = { goals: goalNamed('g-1', { pieces: [{ work: 'card-1', hash: dataHash(data) }] }), work: { 'card-1': entry(data) } };
  assert.equal(areasOf(views, 'card-1').goal, 'g-1');
  const changed = { ...views, work: { 'card-1': entry({ id: 'card-1', title: 'Another' }) } };
  assert.equal(areasOf(changed, 'card-1'), null);
});

test('work of no goal has no areas', () => {
  const views = { goals: goalNamed('g-1'), work: { 'card-1': entry({ id: 'card-1' }) } };
  assert.equal(areasOf(views, 'card-1'), null);
  assert.equal(areasOf({ work: views.work }, 'card-1'), null);
  assert.equal(areasOf({ ...views, work: { 'card-1': entry({ id: 'card-1', goalId: 'another' }) } }, 'card-1'), null);
});

test('a fix for a red main line is held only by the check files of the goal in force', () => {
  const views = { goals: goalNamed('g-1', { checkFiles: ['tests/orders/export.test.js'] }) };
  assert.deepEqual(fixAreas(views), { goal: 'g-1', wontTouch: ['tests/orders/export.test.js'] });
  assert.equal(fixAreas({ goals: goalNamed('g-1') }), null);
  assert.equal(fixAreas({ goals: goalNamed('g-1', { checkFiles: ['x.test.js'], ended: { ending: 'time', at: 'x' } }) }), null);
  assert.equal(fixAreas({}), null);
});

test('an order holds its areas, and refuses them badly formed', () => {
  const order = workOrder({ work: { id: 'card-1', lane: 'small', goal: 'Add it', done: [{ command: 'npm test', expect: 0 }] }, config: { testCommand: 'npm test' } });
  assert.equal(checkOrder({ ...order, areas: { goal: 'g-1', since: '2026-11-01T00:00:00.000Z', ...AREAS } }), null);
  assert.equal(checkOrder({ ...order, areas: { goal: 'g-1', wontTouch: ['a.js'] } }), null);
  assert.match(checkOrder({ ...order, areas: { may: 'src' } }), /areas/);
  assert.match(checkOrder({ ...order, areas: { goal: 'g-1', may: ['src/**'] } }), /areas/);
});

// The dispatcher's half: what the routes hold is read through `areasHeld`, and each answer settles through `settleAreas`.
function world({ held = {}, local = false, questions = {}, reports = {} } = {}) {
  const dir = tempFolder('wh-areas-');
  const written = [];
  const settled = [];
  const handed = [];
  const ready = {};
  const views = {
    work: { 'card-1': { work: { id: 'w-1', at: '2026-11-01T00:00:00.000Z', data: { id: 'card-1', title: 'The export page', lane: 'small', visible: false, dependsOn: [] } }, approved: true, since: '2026-11-01T00:00:00.000Z' } },
    runs: { 'card-1': [{ data: { runId: 'run-1', work: 'card-1', state: 'ended', outcome: 'completed', pr: 7 }, at: '2026-11-01T01:00:00.000Z' }] },
    questions, reports,
  };
  const engine = { ...fakeEngine(), handOver: async (args) => { handed.push(args); return { ok: true }; } };
  const d = dispatchRun({
    engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => views, config: () => ({ testCommand: 'npm test' }),
    start: async () => ({ ok: false, refused: 'not here' }), write: async (kind, data) => {
      written.push({ kind, data });
      if (kind === 'question') views.questions[data.id] = { question: { key: data.id, data }, answer: null };
    },
    areasHeld: () => held, settleAreas: (pr, how) => { settled.push([pr, how]); if (how === 'ready') ready[pr] = held[pr]; delete held[pr]; }, isLocal: () => local, localQueue: local ? async () => {} : null,
    repoOf: () => ({ host: 'github.com' }), repoName: () => 'acme/web', readyOf: () => ready, now: () => NOW,
  });
  return { d, views, written, settled, handed, engine };
}
const HELD = () => ({ 7: { head: HEAD, runId: 'run-1', showFirst: false, work: 'card-1', paths: ['src/users/b.js'] } });
const asked = (t) => t.written.filter((w) => w.kind === 'question');

test('a change held at mark ready raises one card, at level 3, offering Allow this once or Stop here', async () => {
  const t = world({ held: HELD() });
  await t.d.tick();
  await t.d.tick();
  assert.equal(asked(t).length, 1);
  const { data } = asked(t)[0];
  assert.equal(data.id, areaQuestion('card-1', HEAD));
  assert.equal(data.level, 3);
  assert.deepEqual(data.options.map((o) => o.label), [ALLOW_ONCE, STOP_HERE]);
  assert.match(data.what, /src\/users\/b\.js/);
  assert.equal(data.recommendation, STOP_HERE);
  assert.deepEqual(t.settled, []);
});

test('the piece waits on the director while its card is open', async () => {
  const t = world({ held: HELD() });
  await t.d.tick();
  assert.ok(t.d.waitingWork().has('card-1'));
});

test('the card names no more than a few paths, and says how many others there are', async () => {
  const held = HELD();
  held[7].paths = Array.from({ length: 9 }, (_, i) => `src/users/${i}.js`);
  const t = world({ held });
  await t.d.tick();
  assert.match(asked(t)[0].data.what, /and 4 more/);
});

const answered = (label) => ({ [areaQuestion('card-1', HEAD)]: { question: { data: { id: areaQuestion('card-1', HEAD), work: 'card-1' } }, answer: { label, at: '2026-11-01T01:30:00.000Z' } } });

test('Allow this once on a host marks it ready and hands it to the queue again', async () => {
  const t = world({ held: HELD(), questions: answered(ALLOW_ONCE) });
  await t.d.tick();
  assert.deepEqual(t.settled, [['7', 'ready']]);
  assert.deepEqual(t.handed.map((h) => [h.pr, h.url]), [[7, 'https://github.com/acme/web/pull/7']]);
  await t.d.tick();
  assert.equal(t.handed.length, 1);
});

test('a hand-over the queue refuses is tried again on each tick, said once, until it is taken', async () => {
  const t = world({ held: HELD(), questions: answered(ALLOW_ONCE) });
  const refusing = [{ ok: false, refused: 'the queue\'s record moved' }, { ok: false, refused: 'the queue\'s record moved' }, { ok: true }];
  t.engine.handOver = async (args) => { t.handed.push(args); return refusing.shift(); };
  for (let i = 0; i < 4; i += 1) await t.d.tick();
  assert.equal(t.handed.length, 3);
  assert.equal(t.written.filter((w) => w.kind === 'note' && /keeps trying/.test(w.data.words)).length, 1);
});

test('Allow this once in git alone leaves a ready record, which the local queue reads', async () => {
  const t = world({ held: HELD(), local: true, questions: answered(ALLOW_ONCE) });
  await t.d.tick();
  assert.deepEqual(t.settled, [['7', 'ready']]);
  assert.equal(t.handed.length, 0);
});

test('Stop here ends the piece, and nothing goes to the queue', async () => {
  const t = world({ held: HELD(), questions: answered(STOP_HERE) });
  await t.d.tick();
  assert.deepEqual(t.settled, [['7', 'stop']]);
  assert.equal(t.written.filter((w) => w.kind === 'report' && w.data.outcome === 'closed' && w.data.work === 'card-1').length, 1);
  assert.equal(t.handed.length, 0);
});

test('a fix\'s hold is settled by its answer, and its own step carries the merge', async () => {
  const held = HELD();
  held[7].fix = true;
  const t = world({ held, questions: answered(ALLOW_ONCE) });
  await t.d.tick();
  assert.deepEqual(t.settled, [['7', 'fix']]);
  assert.equal(t.written.filter((w) => w.kind === 'report').length, 0);
});

test('a card for an older head decides nothing for a new one', async () => {
  const old = 'b'.repeat(40);
  const questions = { [areaQuestion('card-1', old)]: { question: { data: {} }, answer: { label: ALLOW_ONCE, at: '2026-11-01T00:30:00.000Z' } } };
  assert.equal(areaAnswer({ questions }, 'card-1', old), ALLOW_ONCE);
  assert.equal(areaAnswer({ questions }, 'card-1', HEAD), null);
  const t = world({ held: HELD(), questions });
  await t.d.tick();
  assert.equal(asked(t).length, 1);
  assert.deepEqual(t.settled, []);
});

test('work that has ended lets go of its hold', async () => {
  const t = world({ held: HELD(), reports: { 'card-1': { at: '2026-11-01T02:00:00.000Z', data: { work: 'card-1', outcome: 'closed' } } } });
  await t.d.tick();
  assert.deepEqual(t.settled, [['7', 'gone']]);
  assert.equal(asked(t).length, 0);
});

test('nothing is asked or acted on under All stop', async () => {
  const t = world({ held: HELD(), questions: answered(ALLOW_ONCE) });
  const stopped = dispatchRun({ engine: fakeEngine(), project: 'p', folder: tempFolder('wh-areas-'), file: path.join(tempFolder('wh-areas-'), 'dispatch.json'), readViews: () => t.views, config: () => ({ testCommand: 'npm test' }), stopped: () => true, areasHeld: HELD, settleAreas: (...args) => t.settled.push(args), now: () => NOW });
  await stopped.tick();
  assert.deepEqual(t.settled, []);
});

test("a piece of a goal starts with its areas, in the guard's terms and in the run's words", async () => {
  const dir = tempFolder('wh-areas-');
  const starts = [];
  const views = {
    work: { 'card-1': { work: { id: 'w-1', at: '2026-11-01T00:00:00.000Z', data: { id: 'card-1', title: 'The export page', lane: 'quick', visible: false, dependsOn: [], goalId: 'g-1' } }, approved: false, since: '2026-11-01T00:00:00.000Z' } },
    runs: {}, questions: {}, goals: goalNamed('g-1'),
  };
  const d = dispatchRun({ engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => views, config: () => ({ testCommand: 'npm test' }), start: async (args) => { starts.push(args); return { ok: true, runId: 'run-1' }; }, now: () => NOW });
  await d.tick();
  assert.deepEqual(starts[0].order.areas, { goal: 'g-1', since: '2026-11-01T00:00:00.000Z', ...AREAS });
  assert.match(starts[0].order.notInScope.at(-1), /src\/orders\/\*\*.*tests\/orders\/export\.test\.js/);
  assert.equal(checkOrder(starts[0].order), null);
});

test('work of no goal starts as before', async () => {
  const dir = tempFolder('wh-areas-');
  const starts = [];
  const views = { work: { 'card-1': { work: { id: 'w-1', at: '2026-11-01T00:00:00.000Z', data: { id: 'card-1', title: 'The export page', lane: 'quick', visible: false, dependsOn: [] } }, approved: false, since: '2026-11-01T00:00:00.000Z' } }, runs: {}, questions: {} };
  const d = dispatchRun({ engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => views, config: () => ({ testCommand: 'npm test' }), start: async (args) => { starts.push(args); return { ok: true, runId: 'run-1' }; }, now: () => NOW });
  await d.tick();
  assert.equal(starts[0].order.areas, undefined);
  assert.deepEqual(starts[0].order.notInScope, []);
});
