// tests/scripts/host/helper-checks.test.js
// What the helper reads for checks on this computer: the permit fails closed, a project on the host's checks goes as before,
// and the fix lane is told the main line's result where there is no job on the host to run again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksWorld, P } from '../../helpers/checks-world.js';
import { redMainIncident, fixOrder } from '../../../scripts/engine/fix-main.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { withTicket } from '../../../scripts/engine/ticket.js';
import { makeEvent, writeEvent } from '../../../scripts/state/events.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';

waitLongerOnTheHelper();

const GOOD = 'export const price = (c) => (c / 100).toFixed(2);\n';
const orderOf = (id) => workOrder({ work: { id, lane: 'quick', goal: 'Show prices with two decimals', done: [{ test: 'prices' }], visible: false }, config: { pages: [] } });

test('what the host says can\'t be read, so a merge is refused', { timeout: 300000 }, () => checksWorld(async ({ helper, open, sign, merge }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-1') });
  const { pr, head, worktree, art } = await open(runId, 'wh/card-1', GOOD);
  await sign(runId, art);
  assert.match((await merge(pr, head, worktree)).stderr, /no passing check on this computer/);
}, { host: { checkContexts: async () => { throw new Error('GitHub did not answer'); } } }));

test('a project whose checks run on the host is unchanged', { timeout: 300000 }, () => checksWorld(async ({ helper, statuses, forwarded, open, sign, merge }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-2') });
  const { pr, head, worktree, art } = await open(runId, 'wh/card-2', GOOD);
  await sign(runId, art);
  await helper.engine.tick();
  assert.doesNotMatch((await merge(pr, head, worktree)).stderr, /broker refused/);
  assert.ok(forwarded.some((line) => line.startsWith(`gh pr merge ${pr} `)));
  assert.deepEqual(statuses, [], 'nothing is reported');
}, { host: { checkContexts: async () => [{ name: 'test', state: 'success', startedAt: '2026-10-31T00:00:00Z' }] } }));

test('the main line\'s result comes from its clean check, and never from gh', { timeout: 300000 }, () => checksWorld(async ({ helper, client, engine, stand, reported }) => {
  const { runId } = await helper.engine.start({ project: P, order: orderOf('card-3') });
  const steps = withTicket(client, ['--artefacts', engine.artefactsOf(runId)]);
  assert.deepEqual(await steps.engine.mainCheck({ runId }), { ok: true, here: true, green: false, rerun: false }, 'no check yet');
  assert.equal((await client.engine.mainCheck({ runId })).ok, false, 'a call needs the run\'s ticket');
  await reported(await stand.branchHead('main'), 'success');
  assert.deepEqual(await steps.engine.mainCheck({ runId }), { ok: true, here: true, green: true, rerun: false });
}));

test('the fix\'s merge needs its signed check', { timeout: 300000 }, () => checksWorld(async ({ helper, client, engine, statuses, open, sign, reported, project = P }) => {
  const incident = redMainIncident({ id: 'ask-1' });
  await writeEvent({ project, event: makeEvent({ kind: 'incident', data: incident }) });
  const { runId } = await helper.engine.start({ project, order: fixOrder(incident, { config: { testCommand: 'npm test' } }) });
  const { head, art } = await open(runId, 'wh/fix', GOOD);
  await sign(runId, art);
  engine.setOutput(runId, 'tests', JSON.stringify({ clean: true }));
  const steps = withTicket(client, ['--artefacts', art]);
  const before = await steps.engine.mergeFix({ runId });
  assert.equal(before.ok, false);
  assert.equal(before.waiting, true, before.refused);
  assert.match(before.refused, /no passing check on this computer/);
  await reported(head, 'success');
  const after = await steps.engine.mergeFix({ runId });
  assert.doesNotMatch(String(after.refused), /no passing check/);
  assert.ok(statuses.length > 0);
}));
