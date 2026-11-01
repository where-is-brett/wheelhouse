// tests/scripts/hooks/protected-tests-route.test.js
// The protected-tests guard against the helper's real routes, with a real ticket file in the run's artefacts: the hook
// has no ticket to show, so it reads the run's protected files from a route that needs none, and an unknown run is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { decide } from '../../../scripts/hooks/protected-tests.js';
import { tempFolder } from '../../helpers/homes.js';

const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
const engineEnv = (runId) => ({ WHEELHOUSE_ENGINE_RUN: '1', WORKFLOW_ID: runId, ARCHON_NODE_EXECUTION: JSON.stringify({ runId, path: ['implement'], invocation: 1, attempt: 1 }) });

async function setup() {
  const dir = tempFolder('wh-pt-route-');
  const engine = {
    name: 'archon',
    artefactsOf: (runId) => path.join(dir, 'art', runId),
    start: async () => ({ ok: true, runId: 'run-1', branch: 'wh/x' }),
    inspect: async () => ({ status: 'running', source: path.join(dir, 'capture') }),
    outputs: async () => ({}),
  };
  const made = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async () => {},
    now: () => new Date('2026-11-01T11:00:00.000Z'),
    digests: { installed: () => 'd'.repeat(64), captured: () => 'd'.repeat(64) },
    comment: async () => ({ id: 1 }),
    host: { push: async () => ({ ok: true }), open: async () => ({}), repo: () => 'acme/web', repoHost: () => null },
    provenance: async () => {},
    incidentOf: () => null,
    changesOf: async () => ({ paths: [], config: {} }),
    merge: async () => ({ ok: true }),
    goalViews: () => ({}),
  });
  const order = workOrder({ work: { id: 'card-1', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }], protectedFiles: ['tests/old.test.js'] } });
  await made.start({ project: 'p', order });
  assert.ok(fs.existsSync(path.join(engine.artefactsOf('run-1'), TICKET_FILE)), 'the run has a ticket file');
  // The hook's own call: no ticket in the body.
  const post = (name) => (body) => made.routes[name](body);
  return { client: { engine: { protectedFiles: post('/engine/protected-files'), order: post('/engine/order') } } };
}

function worktree() {
  const dir = tempFolder('wh-pt-wt-');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'old.test.js'), "test('old', () => {});\n");
  fs.writeFileSync(path.join(dir, 'tests', 'price.test.js'), "test('price', () => {});\n");
  return dir;
}
const rm = (cwd, file) => ({ tool_name: 'Bash', cwd, tool_input: { command: `rm ${file}` } });

test('a listed test file may be deleted, and an unlisted one is refused with the delete words', async () => {
  const { client } = await setup();
  const cwd = worktree();
  assert.equal(await decide(rm(cwd, 'tests/old.test.js'), { env: engineEnv('run-1'), client }), undefined);
  const out = await decide(rm(cwd, 'tests/price.test.js'), { env: engineEnv('run-1'), client });
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /delete the test tests\/price\.test\.js/);
});

test('an unlisted skip is refused with the skip words', async () => {
  const { client } = await setup();
  const cwd = worktree();
  const out = await decide({ tool_name: 'Edit', cwd, tool_input: { file_path: 'tests/price.test.js', old_string: "test('price'", new_string: "test.skip('price'" } }, { env: engineEnv('run-1'), client });
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /skip a test in tests\/price\.test\.js/);
});

test('a run the helper did not start is refused with the no-order words', async () => {
  const { client } = await setup();
  const out = await decide(rm(worktree(), 'tests/old.test.js'), { env: engineEnv('run-9'), client });
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /could not read this run's work order/);
});

test('the route tells only the protected files', async () => {
  const { client } = await setup();
  assert.deepEqual(await client.engine.protectedFiles({ runId: 'run-1' }), { ok: true, protectedFiles: ['tests/old.test.js'] });
  assert.equal((await client.engine.protectedFiles({ runId: 'run-9' })).ok, false);
  assert.equal((await client.engine.protectedFiles({})).ok, false);
});
