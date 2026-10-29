// tests/scripts/engine/routes-start.test.js
// A run's start (Archon design, section 12.4): the engine reads the project only from the helper's fetch mirror, so
// the helper brings the mirror up to date before the engine starts a run, and starts none when it can't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';

function setup(refresh) {
  const dir = tempFolder('wh-start-route-');
  const calls = [];
  const engine = {
    name: 'archon',
    artefactsOf: (runId) => path.join(dir, 'art', runId),
    start: async () => { calls.push('start'); return { ok: true, runId: 'run-1', branch: 'wh/card-1' }; },
    act: async () => ({ ok: true }),
  };
  const routes = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async () => {},
    refresh: async (project) => { calls.push(`refresh ${project}`); return refresh(); },
  });
  return { routes, calls };
}
const order = workOrder({ work: { id: 'card-1', lane: 'small', goal: 'Add a subtract function', done: [{ command: 'node --test', expect: 0 }] }, config: { testCommand: 'node --test' } });

test('the fetch mirror is brought up to date before the engine starts a run', async () => {
  const { routes, calls } = setup(async () => ({ ok: true }));
  const started = await routes.start({ project: 'p', order });
  assert.equal(started.ok, true);
  assert.deepEqual(calls, ['refresh p', 'start']);
});

test("no run starts when the fetch mirror can't be brought up to date", async () => {
  const { routes, calls } = setup(async () => ({ ok: false, refused: "the host's branches could not be fetched" }));
  const started = await routes.start({ project: 'p', order });
  assert.equal(started.ok, false);
  assert.match(started.refused, /the host's branches could not be fetched/);
  assert.deepEqual(calls, ['refresh p']);
});
