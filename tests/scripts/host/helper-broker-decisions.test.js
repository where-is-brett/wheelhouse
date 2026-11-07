// tests/scripts/host/helper-broker-decisions.test.js
// The broker's permit holds a merge for the director's decisions on the piece (design section 6.4), the piece found from the
// pull request's branch as the host says and from the run that opened it: an engine branch, a feature branch, both, a branch named
// like a restore that is not one, and a host that can't say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksWorld, P } from '../../helpers/checks-world.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { makeEvent, writeEvent } from '../../../scripts/state/events.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';

waitLongerOnTheHelper();

const GOOD = 'export const price = (c) => (c / 100).toFixed(2);\n';
const orderOf = (id) => workOrder({ work: { id, lane: 'quick', goal: 'Show prices with two decimals', done: [{ test: 'prices' }], visible: false }, config: { pages: [] } });
const ask = (work, n = 1) => writeEvent({
  project: P,
  event: makeEvent({
    kind: 'question',
    data: { id: `q-${work}-${n}`, work, what: 'Which separator?', why: 'It changes the file', options: [{ label: 'Comma', says: 'Commas' }, { label: 'Tab', says: 'Tabs' }], recommendation: 'Comma', level: 2 },
  }),
});

test('a merge from an engine branch waits for a decision open on its work, and goes on when none is', { timeout: 300000 }, () => checksWorld(async ({ helper, open, sign, merge, forwarded }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-1') });
  const { pr, head, worktree, art } = await open(runId, 'wh/card-1', GOOD);
  await sign(runId, art);
  await helper.engine.tick();
  await ask('card-1');
  const held = await merge(pr, head, worktree);
  assert.match(held.stderr, /question open on card-1/);
  assert.equal(forwarded.some((line) => line.startsWith(`gh pr merge ${pr} `)), false);
}, { host: { checkContexts: async () => [{ name: 'test', state: 'success', startedAt: '2026-10-31T00:00:00Z' }] } }));

test('with no decision on the work the same merge is not refused for one', { timeout: 300000 }, () => checksWorld(async ({ helper, open, sign, merge }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-2') });
  const { pr, head, worktree, art } = await open(runId, 'wh/card-2', GOOD);
  await sign(runId, art);
  await helper.engine.tick();
  assert.doesNotMatch((await merge(pr, head, worktree)).stderr, /decision|question open/);
}, { host: { checkContexts: async () => [{ name: 'test', state: 'success', startedAt: '2026-10-31T00:00:00Z' }] } }));

test('a feature branch holds on its own work and on the run that opened it, when the two differ', { timeout: 300000 }, () => checksWorld(async ({ helper, open, sign, merge }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-3') });
  const { pr, head, worktree, art } = await open(runId, 'feature/other-piece', GOOD);
  await sign(runId, art);
  await helper.engine.tick();
  // The branch's own work.
  await ask('other-piece');
  assert.match((await merge(pr, head, worktree)).stderr, /question open on other-piece and card-3/);
  // The run's work: it holds too, with the branch's work asked nothing more.
  const second = await helper.engine.start({ project: P, order: orderOf('card-4') });
  const again = await open(second.runId, 'feature/third-piece', GOOD);
  await sign(second.runId, again.art);
  await helper.engine.tick();
  await ask('card-4');
  assert.match((await merge(again.pr, again.head, again.worktree)).stderr, /question open on third-piece and card-4/);
}, { host: { checkContexts: async () => [{ name: 'test', state: 'success', startedAt: '2026-10-31T00:00:00Z' }] } }));

test('a branch named like a restore, that no step 3 click stands behind, is not exempt', { timeout: 300000 }, () => checksWorld(async ({ helper, open, sign, merge }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-5') });
  const { pr, head, worktree, art } = await open(runId, 'wheelhouse-restore-aaaaaaaaaaaa', GOOD);
  await sign(runId, art);
  await helper.engine.tick();
  await ask('card-5');
  assert.match((await merge(pr, head, worktree)).stderr, /question open on card-5/);
}, { host: { checkContexts: async () => [{ name: 'test', state: 'success', startedAt: '2026-10-31T00:00:00Z' }] } }));

test('a host that cannot say what the pull request is refuses the merge', { timeout: 300000 }, () => checksWorld(async ({ helper, host, open, sign, merge }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-6') });
  const { pr, head, worktree, art } = await open(runId, 'wh/card-6', GOOD);
  await sign(runId, art);
  await helper.engine.tick();
  host.prState = async () => { throw new Error('GitHub did not answer'); };
  assert.match((await merge(pr, head, worktree)).stderr, /could not be checked/);
}, { host: { checkContexts: async () => [{ name: 'test', state: 'success', startedAt: '2026-10-31T00:00:00Z' }] } }));
