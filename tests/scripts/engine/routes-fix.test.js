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
import { areaQuestion, ALLOW_ONCE } from '../../../scripts/engine/areas.js';
import { STOP_HERE } from '../../../scripts/engine/dispatch-run.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = '6060606a2b3c4d5e6f708192a3b4c5d6e7f80912';
const DIGEST = 'd'.repeat(64);
const INCIDENT = { id: 'red-main-0123456789', what: 'red', kind: 'red-main', suspect: 12, work: 'fix-main-red-main-0123456789', fixes: [] };
const CLEAN = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 's', blocked: false, assumptions: [] });
const config = { paths: ['src/total.js'], config: { ciFiles: [], criticalAreas: [], plugin: false } };

function setup({ outputs = {}, changes = config, open = [INCIDENT], merge, views = {} } = {}) {
  const dir = tempFolder('wh-fix-route-');
  const calls = [];
  const world = { open, changes, views };
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
    goalViews: () => world.views,
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
  assert.deepEqual(t.made.openedOf('p', 60), { runId: 'run-1', head: HEAD, at: '2026-10-30T11:00:00.000Z', showFirst: false, work: INCIDENT.work, level: 1, lane: 'fix-main', incident: INCIDENT.id });
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

// A goal's areas (unattended goals design, section 6): the change is compared with them at mark ready, and on a fix at its merge.
const AREAS = { goal: 'g-1', since: '2026-10-30T10:00:00.000Z', may: ['src/orders/**'], wontTouch: ['tests/check.test.js'] };
const quick = (areas) => ({ ...workOrder({ work: { id: 'card-1', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }] }, config: { testCommand: 'npm test' } }), ...(areas ? { areas } : {}) });
const outside = { paths: ['src/users/b.js'], config: config.config };
const inside = { paths: ['src/orders/a.js'], config: config.config };

function handing(t) {
  const handed = [];
  t.engine.handOver = async (item) => { handed.push(item); return { ok: true }; };
  return handed;
}
const allowed = (label, work = 'card-1') => ({ questions: { [areaQuestion(work, HEAD)]: { answer: { label } } } });

test('/engine/ready holds a change outside the areas, hands nothing to the queue and writes no ready record', async () => {
  const t = setup({ changes: outside });
  const handed = handing(t);
  await t.startFix(quick(AREAS));
  await t.reach();
  assert.deepEqual(await t.routes['/engine/ready']({ runId: 'run-1' }), { ok: true, held: 'areas', pr: 60, head: HEAD });
  assert.equal(handed.length, 0);
  assert.deepEqual(t.made.readyAll('p'), {});
  assert.deepEqual(t.made.areasHeld('p')[60], { head: HEAD, runId: 'run-1', showFirst: false, work: 'card-1', paths: ['src/users/b.js'] });
});

test('/engine/ready passes a change inside the areas', async () => {
  const t = setup({ changes: inside });
  const handed = handing(t);
  await t.startFix(quick(AREAS));
  await t.reach();
  assert.deepEqual(await t.routes['/engine/ready']({ runId: 'run-1' }), { ok: true, pr: 60, head: HEAD });
  assert.equal(handed.length, 1);
  assert.deepEqual(t.made.areasHeld('p'), {});
});

test('a run with no areas reads no changes at mark ready', async () => {
  const t = setup({ changes: outside });
  handing(t);
  await t.startFix(quick());
  await t.reach();
  assert.equal((await t.routes['/engine/ready']({ runId: 'run-1' })).held, undefined);
  assert.equal(t.calls.filter((c) => c.call === 'changes').length, 0);
});

test('a pull request opened before the goal isn\'t held', async () => {
  const t = setup({ changes: outside });
  handing(t);
  await t.startFix(quick({ ...AREAS, since: '2026-10-30T12:00:00.000Z' }));
  await t.reach();
  assert.equal((await t.routes['/engine/ready']({ runId: 'run-1' })).held, undefined);
});

test('changes that can\'t be read are refused, never passed', async () => {
  const t = setup({ changes: null });
  handing(t);
  await t.startFix(quick(AREAS));
  await t.reach();
  assert.match((await t.routes['/engine/ready']({ runId: 'run-1' })).refused, /couldn't be read/);
});

test('Allow this once at a head lets that head through, and a new head asks again', async () => {
  const t = setup({ changes: outside, views: allowed(ALLOW_ONCE) });
  const handed = handing(t);
  await t.startFix(quick(AREAS));
  await t.reach();
  assert.equal((await t.routes['/engine/ready']({ runId: 'run-1' })).held, undefined);
  assert.equal(handed.length, 1);
  assert.deepEqual(t.made.areasOutside('p', { pr: 60, paths: outside.paths }), ['src/users/b.js']);
  assert.equal(t.made.areasAllowed('p', 60, HEAD), true);
  assert.equal(t.made.areasAllowed('p', 60, 'b'.repeat(40)), false);
});

test('a held change settles to ready, or goes', async () => {
  const t = setup({ changes: outside });
  handing(t);
  await t.startFix(quick(AREAS));
  await t.reach();
  await t.routes['/engine/ready']({ runId: 'run-1' });
  t.made.settleAreas('p', 60, 'ready');
  assert.deepEqual(t.made.areasHeld('p'), {});
  assert.deepEqual(t.made.readyAll('p')[60], { head: HEAD, runId: 'run-1', showFirst: false, work: 'card-1' });
  t.made.notReady('p', 60);
  t.made.holdAreas('p', { pr: 60, head: HEAD, paths: ['a.js'] });
  assert.deepEqual(t.made.areasHeld('p'), {}, 'nothing is held for what isn\'t ready');
});

test('a merge refused at a new head goes back to a card', async () => {
  const t = setup({ changes: outside, views: allowed(ALLOW_ONCE) });
  handing(t);
  await t.startFix(quick(AREAS));
  await t.reach();
  await t.routes['/engine/ready']({ runId: 'run-1' });
  const head = 'b'.repeat(40);
  t.made.holdAreas('p', { pr: 60, head, paths: ['src/users/b.js'] });
  assert.deepEqual(t.made.readyAll('p'), {});
  assert.equal(t.made.areasHeld('p')[60].head, head);
});

test('a narrowing reaches a run already going: its order is read afresh', async () => {
  const t = setup({ changes: inside, views: { goals: { 'g-1': { sheet: { areas: { may: ['src/lists/**'], wontTouch: ['tests/check.test.js'] } } } } } });
  handing(t);
  await t.startFix(quick(AREAS));
  await t.reach();
  assert.deepEqual((await t.routes['/engine/areas']({ runId: 'run-1' })).areas.may, ['src/lists/**']);
  assert.equal((await t.routes['/engine/ready']({ runId: 'run-1' })).held, 'areas');
});

test('the areas route needs no ticket, tells only the areas, and says none for a run with no order', async () => {
  const t = setup();
  await t.startFix(quick(AREAS));
  assert.deepEqual(await t.made.routes['/engine/areas']({ runId: 'run-1' }), { ok: true, areas: AREAS });
  assert.deepEqual(await t.made.routes['/engine/areas']({ runId: 'no-such-run' }), { ok: true, areas: null });
  assert.equal((await t.made.routes['/engine/areas']({})).ok, false);
});

test('the fix lane isn\'t held by the areas, and is by a goal\'s check file', async () => {
  const held = setup({ changes: { paths: ['tests/check.test.js'], config: config.config } });
  const areas = { goal: 'g-1', wontTouch: ['tests/check.test.js'] };
  await held.startFix({ ...fixOrder(INCIDENT, { config: { testCommand: 'npm test' } }), areas });
  await held.reach();
  const waiting = await held.routes['/engine/merge-fix']({ runId: 'run-1' });
  assert.equal(waiting.waiting, true);
  assert.equal(merges(held).length, 0);
  assert.equal(held.made.areasHeld('p')[60].fix, true);

  held.world.views = allowed(STOP_HERE, INCIDENT.work);
  const stopped = await held.routes['/engine/merge-fix']({ runId: 'run-1' });
  assert.equal(stopped.waiting, undefined);
  assert.match(stopped.refused, /check file/);

  held.world.views = allowed(ALLOW_ONCE, INCIDENT.work);
  assert.equal((await held.routes['/engine/merge-fix']({ runId: 'run-1' })).ok, true);

  const free = setup({ changes: { paths: ['src/users/b.js'], config: config.config } });
  await free.startFix({ ...fixOrder(INCIDENT, { config: { testCommand: 'npm test' } }), areas });
  await free.reach();
  assert.equal((await free.routes['/engine/merge-fix']({ runId: 'run-1' })).ok, true);
});
