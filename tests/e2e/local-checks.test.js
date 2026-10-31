// tests/e2e/local-checks.test.js
// A hosted project with no CI from push to merge (spec 4): the helper reports each head at once, runs its check, signs the
// result and only then reports it, and the broker's permit asks for that record, never for the status it posted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checksWorld, P } from '../helpers/checks-world.js';
import { workOrder } from '../../scripts/engine/order.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { listEvents } from '../../scripts/state/events.js';
import { waitLongerOnTheHelper, until } from '../helpers/until.js';

waitLongerOnTheHelper();

const GOOD = 'export const price = (c) => (c / 100).toFixed(2);\n';
const BROKEN = 'export const price = () => "broken";\n';
const orderOf = (id) => workOrder({ work: { id, lane: 'quick', goal: 'Show prices with two decimals', done: [{ test: 'prices' }], visible: false }, config: { pages: [] } });
const records = (kind) => listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === kind);

const mergesThrough = (forwarded, pr) => forwarded.some((line) => line.startsWith(`gh pr merge ${pr} `));

test('a run goes from push to a merge the permit allows', { timeout: 300000 }, () => checksWorld(async ({ helper, statuses, forwarded, open, sign, merge, reported }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-1') });
  const { pr, head, worktree, art } = await open(runId, 'wh/card-1', GOOD);
  assert.deepEqual(statuses.filter((s) => s.sha === head).map((s) => s.state), ['pending'], 'pending before any check starts');
  await sign(runId, art);
  assert.match((await merge(pr, head, worktree)).stderr, /no passing check on this computer/);
  await reported(head, 'success');
  const check = records('check').find((e) => e.data.commit === head);
  assert.equal(check.data.result, 'passed');
  assert.equal(mergesThrough(forwarded, pr), false);
  assert.doesNotMatch((await merge(pr, head, worktree)).stderr, /broker refused/);
  assert.equal(mergesThrough(forwarded, pr), true);
}));

test('a run with a planted status and no record is refused', { timeout: 300000 }, () => checksWorld(async ({ helper, statuses, open, sign, merge }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-2') });
  const { pr, head, worktree, art } = await open(runId, 'wh/card-2', GOOD);
  await sign(runId, art);
  statuses.push({ sha: head, state: 'success', description: 'planted' });
  assert.match((await merge(pr, head, worktree)).stderr, /no passing check on this computer/);
}));

test('a red check sends it back and the next head merges', { timeout: 300000 }, () => checksWorld(async ({ helper, forwarded, open, sign, merge, reported }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-3') });
  const first = await open(runId, 'wh/card-3', BROKEN);
  await reported(first.head, 'failure');
  assert.equal(records('check').find((e) => e.data.commit === first.head).data.result, 'failed');
  await sign(runId, first.art);
  assert.match((await merge(first.pr, first.head, first.worktree)).stderr, /no passing check/);
  const sent = JSON.parse(fs.readFileSync(path.join(stateDir(P), '..', 'engine', 'dispatch.json'), 'utf8'));
  assert.deepEqual(sent.reds['card-3'].times, 1);
  assert.equal(typeof sent.reds['card-3'].tail, 'string');
  const next = await open(runId, 'wh/card-3', GOOD);
  await reported(next.head, 'success');
  await sign(runId, next.art);
  assert.doesNotMatch((await merge(next.pr, next.head, next.worktree)).stderr, /broker refused/);
  assert.equal(mergesThrough(forwarded, next.pr), true);
}));

test('the broken-CI card says the checks aren\'t running, and no word of billing', { timeout: 300000 }, async () => {
  const stuck = [{ name: 'test', state: 'failure', startedAt: null }];
  await checksWorld(async ({ helper, open }) => {
    const { runId } = await helper.engine.start({ project: P, order: orderOf('card-4') });
    await open(runId, 'wh/card-4', GOOD);
    const card = await until(async () => {
      await helper.engine.tick();
      return records('question').find((e) => e.data.work === 'checks');
    }, { what: 'the broken-CI card' });
    assert.match(card.data.what, /aren't running/);
    assert.doesNotMatch(JSON.stringify(card.data), /billing|budget|spending|pay/i);
  }, { files: { '.github/workflows/ci.yml': 'name: ci\n' }, host: { checkContexts: async () => stuck, setStatus: async () => { throw new Error('a project with host checks gets no status'); } } });
});
