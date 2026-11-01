// tests/scripts/engine/routes-fix.test.js
// The fix-main lane's merge route (Archon design, section 7.7): the helper adds a fix to the main line through its own
// gate only for the run's own pull request, at the head it opened, for the open red-main incident its order names,
// signed CLEAN, not weakening the checks, and once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { fixOrder } from '../../../scripts/engine/fix-main.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = '6060606a2b3c4d5e6f708192a3b4c5d6e7f80912';
const DIGEST = 'd'.repeat(64);
const INCIDENT = { id: 'red-main-0123456789', what: 'red', kind: 'red-main', suspect: 12, work: 'fix-main-red-main-0123456789', fixes: [] };
const CLEAN = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 's', blocked: false, assumptions: [] });
const config = { paths: ['src/total.js'], config: { ciFiles: [], criticalAreas: [], plugin: false } };

function setup({ outputs = {}, changes = config, open = [INCIDENT], merge } = {}) {
  const dir = tempFolder('wh-fix-route-');
  const calls = [];
  const world = { open, changes };
  const engine = {
    name: 'archon',
    artefactsOf: (runId) => path.join(dir, 'art', runId),
    start: async () => ({ ok: true, runId: `run-${calls.filter((c) => c.call === 'start').length}`, branch: 'wh/fix' }),
    inspect: async () => ({ status: 'running', source: path.join(dir, 'capture') }),
    outputs: async () => ({
      'open-pr': JSON.stringify({ branch: 'wh/fix', pr: 60, head: HEAD }),
      lenses: JSON.stringify({ security: false, design: false, head: HEAD, clean: true }),
      tests: JSON.stringify({ clean: true, findings: '' }),
      'review-standards': CLEAN, 'review-spec': CLEAN,
      ...outputs,
    }),
  };
  const made = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async (project, kind, data) => { calls.push({ call: 'write', kind, data }); },
    now: () => new Date('2026-10-30T11:00:00.000Z'),
    digests: { installed: () => DIGEST, captured: () => DIGEST },
    comment: async () => ({ id: 1 }),
    host: {
      push: async () => ({ ok: true, branch: 'wh/fix' }),
      open: async () => ({ pr: 60, url: 'https://github.com/acme/web/pull/60', head: HEAD }),
      repo: () => 'acme/web',
      repoHost: () => world.repoHost ?? null,
    },
    provenance: async () => {},
    incidentOf: (project, id) => world.open.find((i) => i.id === id && i.kind === 'red-main') ?? null,
    changesOf: async (project, { pr, head }) => { calls.push({ call: 'changes', pr, head }); return world.changes; },
    merge: merge ?? (async (project, args) => { calls.push({ call: 'merge', ...args }); return { ok: true }; }),
  });
  const { routes } = ticketedRoutes(made, engine, 'acme/web');
  const startFix = async (order = fixOrder(INCIDENT, { config: { testCommand: 'npm test' } })) => {
    calls.push({ call: 'start' });
    await routes['/engine/start']({ project: 'p', order });
  };
  // The run's steps before the merge: open the pull request and sign its reviews.
  const reach = async (runId = 'run-1') => {
    await routes['/engine/open-pr']({ runId, cwd: '/p/.worktrees/wh-fix', title: 'Mend the totals', body: 'Body' });
    for (const step of ['review-standards', 'review-spec']) await routes['/engine/review']({ runId, step });
  };
  return { routes, made, engine, calls, world, startFix, reach };
}
const merges = (t) => t.calls.filter((c) => c.call === 'merge');

test('a hand-over to the merge queue names the project\'s own host', async () => {
  const t = setup();
  t.world.repoHost = 'git.example.org';
  let item = null;
  t.engine.handOver = async (given) => { item = given; return { ok: true }; };
  await t.startFix();
  await t.reach();
  assert.equal((await t.routes['/engine/ready']({ runId: 'run-1' })).ok, true);
  assert.equal(item.url, 'https://git.example.org/acme/web/pull/60');
});

test('mergeFix merges the run\'s own fix for the open incident', async () => {
  const t = setup();
  await t.startFix();
  await t.reach();
  const got = await t.routes['/engine/merge-fix']({ runId: 'run-1' });
  assert.deepEqual(got, { ok: true, pr: 60, head: HEAD });
  assert.deepEqual(merges(t).map(({ call, ...rest }) => rest), [{ pr: 60, head: HEAD, incident: INCIDENT.id, runId: 'run-1' }]);
  assert.deepEqual(t.made.openedOf('p', 60), { runId: 'run-1', head: HEAD, showFirst: false, work: INCIDENT.work, level: 1, lane: 'fix-main', incident: INCIDENT.id });
  assert.deepEqual(t.made.fixedRuns('p'), ['run-1']);
  assert.ok(t.calls.some((c) => c.call === 'write' && c.kind === 'note' && /fix for the red main line/.test(c.data.words)));
});

test('mergeFix refuses a run that isn\'t fix-main', async () => {
  const t = setup();
  await t.startFix(workOrder({ work: { id: 'card-1', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }] } }));
  await t.reach();
  assert.match((await t.routes['/engine/merge-fix']({ runId: 'run-1' })).refused, /fix for a red main line/);
  assert.equal(merges(t).length, 0);
});

test('mergeFix refuses when the incident is closed', async () => {
  const t = setup();
  await t.startFix();
  await t.reach();
  t.world.open = [];
  assert.match((await t.routes['/engine/merge-fix']({ runId: 'run-1' })).refused, /incident .* isn't open/);
  assert.equal(merges(t).length, 0);
});

test('mergeFix refuses without a signed CLEAN review of the head', async () => {
  const t = setup({ outputs: { 'review-spec': JSON.stringify({ verdict: 'FINDINGS', findings: [{ severity: 'HIGH', file: 'a', line: 1, repro: 'r', fix: 'f' }], summary: 's', blocked: false, assumptions: [] }) } });
  await t.startFix();
  await t.reach();
  assert.match((await t.routes['/engine/merge-fix']({ runId: 'run-1' })).refused, /signed CLEAN review/);
  assert.equal(merges(t).length, 0);
});

test('mergeFix refuses before the run opened its pull request', async () => {
  const t = setup({ outputs: { 'open-pr': undefined } });
  await t.startFix();
  assert.match((await t.routes['/engine/merge-fix']({ runId: 'run-1' })).refused, /opened its pull request/);
});

test('mergeFix refuses a fix that deletes a test, naming why', async () => {
  const t = setup({ outputs: { tests: JSON.stringify({ clean: false, findings: 'deletes the test tests/total.test.js' }) } });
  await t.startFix();
  await t.reach();
  const got = await t.routes['/engine/merge-fix']({ runId: 'run-1' });
  assert.match(got.refused, /deletes the test tests\/total\.test\.js/);
  assert.ok(Array.isArray(got.weakens) && got.weakens.length > 0);
  assert.equal(merges(t).length, 0);
});

test('mergeFix refuses a fix that changes CI files, .archon policy, or test settings', async () => {
  for (const file of ['.github/workflows/ci.yml', '.archon/sdlc/policy/maintainers.json', 'jest.config.js', '.c8rc.json']) {
    const t = setup({ changes: { ...config, paths: ['src/total.js', file] } });
    await t.startFix();
    await t.reach();
    const got = await t.routes['/engine/merge-fix']({ runId: 'run-1' });
    assert.match(got.refused ?? '', new RegExp(file.replace(/[.]/g, '\\.')), file);
    assert.equal(merges(t).length, 0, file);
  }
});

test('mergeFix refuses when the changes can\'t be read', async () => {
  const t = setup({ changes: null });
  await t.startFix();
  await t.reach();
  assert.match((await t.routes['/engine/merge-fix']({ runId: 'run-1' })).refused, /couldn't be read/);
  assert.equal(merges(t).length, 0);
});

test('a second mergeFix after a merge is refused', async () => {
  const t = setup();
  await t.startFix();
  await t.reach();
  assert.equal((await t.routes['/engine/merge-fix']({ runId: 'run-1' })).ok, true);
  assert.match((await t.routes['/engine/merge-fix']({ runId: 'run-1' })).refused, /already added/);
  assert.equal(merges(t).length, 1);
});

test('a gate refusal is passed back, and the run may try again', async () => {
  let tries = 0;
  const t = setup({ merge: async () => { tries += 1; return tries === 1 ? { ok: false, refused: 'CI is still running at the head' } : { ok: true }; } });
  await t.startFix();
  await t.reach();
  assert.match((await t.routes['/engine/merge-fix']({ runId: 'run-1' })).refused, /CI is still running/);
  assert.equal((await t.routes['/engine/merge-fix']({ runId: 'run-1' })).ok, true);
});

test('mergeFix refuses a call without the run\'s ticket', async () => {
  const t = setup();
  await t.startFix();
  await t.reach();
  assert.match((await t.made.routes['/engine/merge-fix']({ runId: 'run-1' })).refused, /ticket/);
  assert.equal(merges(t).length, 0);
});
