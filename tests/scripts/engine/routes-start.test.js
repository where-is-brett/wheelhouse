// tests/scripts/engine/routes-start.test.js
// A run's start (Archon design, section 12.4): the engine reads the project only from the helper's fetch mirror, so
// the helper brings the mirror up to date before the engine starts a run, and starts none when it can't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';

function setup(refresh, { stepAgent, projectAgents, recheckCopies } = {}) {
  const dir = tempFolder('wh-start-route-');
  const calls = [];
  const engine = {
    name: 'archon',
    ...(stepAgent ? { stepAgent } : {}),
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
    ...(projectAgents ? { projectAgents } : {}),
    ...(recheckCopies ? { recheckCopies: async (...args) => { calls.push('recheck'); return recheckCopies(...args); } } : {}),
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

const fresh = async () => ({ ok: true });
const copilot = async () => ({ branch: 'copilot', checkout: 'copilot' });

test('a run on an agent that reads Wheelhouse\'s own copies re-checks the hold where it starts, and a match starts it', async () => {
  const { routes, calls } = setup(fresh, { stepAgent: () => 'copilot', projectAgents: copilot, recheckCopies: async () => ({ ok: true }) });
  assert.equal((await routes.start({ project: 'p', order })).ok, true);
  assert.deepEqual(calls, ['refresh p', 'recheck', 'start']);
});

test('copies that differ start no run', async () => {
  const { routes, calls } = setup(fresh, { stepAgent: () => 'copilot', projectAgents: copilot, recheckCopies: async () => ({ ok: false }) });
  const got = await routes.start({ project: 'p', order });
  assert.equal(got.ok, false);
  assert.match(got.refused, /own skill copies differ/);
  assert.ok(!calls.includes('start'));
});

test('a working copy that alone names the agent lifts nothing: a Claude project\'s hold stands', async () => {
  for (const projectAgents of [
    async () => ({ branch: 'claude-code', checkout: 'copilot' }),
    async () => ({ branch: 'copilot', checkout: 'claude-code' }),
    async () => ({ branch: null, checkout: 'copilot' }),
    async () => { throw new Error('no mirror'); },
  ]) {
    const { routes, calls } = setup(fresh, { stepAgent: () => 'copilot', projectAgents, recheckCopies: async () => assert.fail('never re-checked') });
    await routes.start({ project: 'p', order });
    assert.ok(!calls.includes('recheck'));
  }
});

test('a run on the kits is not re-checked here', async () => {
  const { routes, calls } = setup(fresh, { stepAgent: () => null, projectAgents: copilot, recheckCopies: async () => assert.fail('not here') });
  assert.equal((await routes.start({ project: 'p', order })).ok, true);
  assert.deepEqual(calls, ['refresh p', 'start']);
});
