// tests/scripts/host/helper-lesson.test.js
// The pack's lesson step through the helper (Archon design, section 7.2): the lesson is read from the engine's own
// record, and a run writes at most one, none when it is empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { main } from '../../../scripts/engine/lesson.js';
import { tempFolder } from '../../helpers/homes.js';

function setup(lessonOutput) {
  const dir = tempFolder('wh-lesson-');
  const written = [];
  const engine = {
    name: 'archon',
    start: async () => ({ ok: true, runId: 'run-1', branch: 'wh/card-1' }),
    outputs: async () => (lessonOutput === undefined ? {} : { lesson: JSON.stringify(lessonOutput) }),
  };
  const { routes } = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'engine', 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async (project, kind, data) => { if (kind === 'lesson') written.push(data); },
    now: () => new Date('2026-10-30T02:00:00.000Z'),
  });
  const order = workOrder({ work: { id: 'card-1', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }] } });
  return { routes, written, start: () => routes['/engine/start']({ project: 'p', order }) };
}

test('a run writes at most one lesson', async () => {
  const { routes, written, start } = setup({ lesson: '  Prices are kept in cents; format them only at the edge.  ', blocked: false });
  await start();
  assert.deepEqual(await routes['/engine/lesson']({ runId: 'run-1' }), { ok: true, written: true });
  assert.deepEqual(await routes['/engine/lesson']({ runId: 'run-1' }), { ok: true, written: false });
  assert.deepEqual(written, [{ work: 'card-1', text: 'Prices are kept in cents; format them only at the edge.' }]);
});

test('an empty lesson, a blocked one or none writes nothing', async () => {
  for (const output of [{ lesson: '', blocked: false }, { lesson: 'x', blocked: true }, undefined]) {
    const { routes, written, start } = setup(output);
    await start();
    assert.deepEqual(await routes['/engine/lesson']({ runId: 'run-1' }), { ok: true, written: false });
    assert.deepEqual(written, []);
  }
  const { routes } = setup({ lesson: 'x', blocked: false });
  assert.match((await routes['/engine/lesson']({ runId: 'run-9' })).refused, /no work order/);
});

test('the lesson step says what it did, and a refusal exits 1', async () => {
  const lines = [];
  assert.equal(await main(['--run', 'run-1'], { client: { engine: { lesson: async () => ({ ok: true, written: true }) } }, out: (l) => lines.push(l) }), 0);
  assert.equal(await main(['--run', 'run-1'], { client: { engine: { lesson: async () => ({ ok: false, refused: 'nope' }) } }, out: (l) => lines.push(l) }), 1);
  assert.equal(await main([], { client: {}, out: () => {} }), 2);
  assert.deepEqual(lines, ['One lesson written for the next run.', "The lesson wasn't written: nope"]);
});
