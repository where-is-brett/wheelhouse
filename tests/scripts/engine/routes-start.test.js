// tests/scripts/engine/routes-start.test.js
// A run's start (Archon design, section 12.4): the engine reads the project only from the helper's fetch mirror, so
// the helper brings the mirror up to date before the engine starts a run, and starts none when it can't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';

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
  return { routes, calls, engine };
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

test('a run whose ticket failed and that couldn\'t be stopped is uncertain', async () => {
  for (const [cancel, uncertain] of [[{ ok: false, refused: 'no reply' }, true], [{ ok: true }, undefined]]) {
    const { routes, engine } = setup(async () => ({ ok: true }));
    engine.artefactsOf = () => null;
    engine.act = async () => cancel;
    assert.equal((await routes.start({ project: 'p', order })).uncertain, uncertain);
  }
});

test('a start with no reply in time says so, and a plain refusal doesn\'t', async () => {
  const { routes, engine } = setup(async () => ({ ok: true }));
  engine.start = async () => ({ ok: false, refused: 'no reply', uncertain: true });
  assert.deepEqual(await routes.start({ project: 'p', order }), { ok: false, refused: 'no reply', uncertain: true });
  engine.start = async () => ({ ok: false, refused: 'no' });
  assert.deepEqual(await routes.start({ project: 'p', order }), { ok: false, refused: 'no' });
});

const fresh = async () => ({ ok: true });

// The commit a run's worktree is made from is read where no builder reaches, kept with the run, and given in its order.
function withBase(baseOf) {
  const t = setup(fresh);
  const dir = tempFolder('wh-start-base-');
  const calls = [];
  const engine = { ...t.engine, start: async () => { calls.push('start'); return { ok: true, runId: 'run-1', branch: 'wh/card-1' }; }, artefactsOf: (runId) => path.join(dir, 'art', runId) };
  const routes = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }], engineFor: () => engine, ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'), write: async () => {}, refresh: fresh, baseOf,
  });
  return { routes, calls, tickets: ticketedRoutes(routes, engine, 'o/p').routes };
}

test('a run keeps the commit its worktree starts from, and its order gives it', async () => {
  const sha = 'a'.repeat(40);
  const t = withBase(async () => sha);
  assert.equal((await t.routes.start({ project: 'p', order })).ok, true);
  assert.equal((await t.tickets['/engine/order']({ runId: 'run-1' })).order.startCommit, sha);
});

test('no run starts when the commit it would start from cannot be read', async () => {
  for (const baseOf of [async () => null, async () => { throw new Error('no'); }, async () => 'main']) {
    const t = withBase(baseOf);
    const got = await t.routes.start({ project: 'p', order });
    assert.equal(got.ok, false);
    assert.match(got.refused, /the commit the run would start from/);
    assert.deepEqual(t.calls, []);
  }
});
