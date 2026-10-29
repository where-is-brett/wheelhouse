// tests/scripts/host/helper-engine-pr.test.js
// The pack's pull-request and mark-ready steps through the helper (Archon design, sections 7.2, 7.5 and 12.4): the
// helper pushes the worktree's own branch and opens its pull request, recording what built it first; it hands the
// pull request to the merge queue only once every lens that ran is signed CLEAN for its head, and, for work shown
// first, the director approved it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = '1111111a2b3c4d5e6f708192a3b4c5d6e7f80912';
const DIGEST = 'd'.repeat(64);
const clean = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 's', blocked: false, assumptions: [] });

function setup({ visible = false, outputs = {}, stop = false } = {}) {
  const dir = tempFolder('wh-pr-');
  const calls = [];
  let stopped = stop;
  const engine = {
    name: 'archon',
    start: async () => ({ ok: true, runId: 'run-1', branch: 'wh/card-1' }),
    inspect: async () => ({ status: 'running', source: path.join(dir, 'capture') }),
    outputs: async () => ({ 'open-pr': JSON.stringify({ branch: 'wh/card-1', pr: 14, head: HEAD }), 'review-standards': clean, 'review-spec': clean, ...outputs }),
    handOver: async (item) => { calls.push({ call: 'handOver', item }); return { ok: true }; },
  };
  const { routes, readyOf } = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async (project, kind, data) => { calls.push({ call: 'write', kind, data }); },
    held: () => stopped,
    now: () => new Date('2026-10-30T01:00:00.000Z'),
    digests: { installed: () => DIGEST, captured: () => DIGEST },
    comment: async () => ({ id: 900 }),
    host: {
      push: async (project, { dir: from }) => { calls.push({ call: 'push', from }); return { ok: true, branch: 'wh/card-1' }; },
      open: async (project, args) => { calls.push({ call: 'open', ...args }); return { pr: 14, url: 'https://github.com/acme/web/pull/14', head: HEAD }; },
      repo: () => 'acme/web',
    },
    provenance: async (project, args) => { calls.push({ call: 'provenance', ...args }); },
  });
  const order = workOrder({ work: { id: 'card-1', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }], visible } });
  return { routes, calls, readyOf, setStop: (v) => { stopped = v; }, start: () => routes['/engine/start']({ project: 'p', order }) };
}

test('the pull request is opened from the worktree, with what built it recorded first', async () => {
  const { routes, calls, start } = setup();
  await start();
  const got = await routes['/engine/open-pr']({ runId: 'run-1', cwd: '/p/.worktrees/wh-card-1', title: 'Show prices with two decimals\nmore', body: 'Body' });
  assert.deepEqual(got, { ok: true, branch: 'wh/card-1', pr: 14, head: HEAD });
  assert.deepEqual(calls.filter((c) => c.call !== 'write').map((c) => c.call), ['push', 'provenance', 'open']);
  assert.equal(calls.find((c) => c.call === 'open').title, 'Show prices with two decimals');
  assert.match((await routes['/engine/open-pr']({ runId: 'run-1', cwd: '/p', title: '', body: '' })).refused, /title and body/);
});

test('nothing is pushed or marked ready under All stop', async () => {
  const { routes, start, setStop } = setup();
  await start();
  setStop(true);
  assert.match((await routes['/engine/open-pr']({ runId: 'run-1', cwd: '/p', title: 't', body: 'b' })).refused, /All stop/);
  assert.match((await routes['/engine/ready']({ runId: 'run-1' })).refused, /All stop/);
});

test('work is handed to the merge queue only once every lens that ran is signed CLEAN for its head', async () => {
  const { routes, calls, start, readyOf } = setup();
  await start();
  assert.match((await routes['/engine/ready']({ runId: 'run-1' })).refused, /no signed CLEAN review/);
  await routes['/engine/review']({ runId: 'run-1', step: 'review-standards' });
  await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  assert.deepEqual(await routes['/engine/ready']({ runId: 'run-1' }), { ok: true, pr: 14, head: HEAD });
  const handed = calls.find((c) => c.call === 'handOver').item;
  assert.deepEqual(handed, { project: handed.project, repo: 'acme/web', pr: 14, url: 'https://github.com/acme/web/pull/14', runId: 'run-1', at: '2026-10-30T01:00:00.000Z' });
  assert.deepEqual(readyOf('p', 14), { head: HEAD, runId: 'run-1', showFirst: false, work: 'card-1' });
});

test('work shown first is handed over only once the director approved it', async () => {
  const { routes, start } = setup({ visible: true });
  await start();
  await routes['/engine/review']({ runId: 'run-1', step: 'review-standards' });
  await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  assert.match((await routes['/engine/ready']({ runId: 'run-1' })).refused, /shown first/);
  const approved = setup({ visible: true, outputs: { approval: JSON.stringify({ decision: 'approve', text: '' }) } });
  await approved.start();
  await approved.routes['/engine/review']({ runId: 'run-1', step: 'review-standards' });
  await approved.routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  assert.equal((await approved.routes['/engine/ready']({ runId: 'run-1' })).ok, true);
  assert.equal(approved.readyOf('p', 14).showFirst, true);
});
