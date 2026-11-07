// tests/scripts/engine/broker/decision-hold.test.js
// The broker's permit holds a merge for the director's decisions on the piece, as the gate does (design section 6.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCall, brokerDecision } from '../../../../scripts/engine/broker/rules.js';
import { makeEvent } from '../../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../../scripts/state/signing.js';
import { withHome } from '../../../helpers/homes.js';

const R = 'github.com/acme/web';
const HEAD = 'a'.repeat(40);
const merge = () => classifyCall(['pr', 'merge', '14', '--repo', R, '--squash', '--match-head-commit', HEAD]);

async function permit(extra, then) {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const enrolled = [{ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' }];
    const review = makeEvent({ kind: 'review', data: { pr: 14, commit: HEAD, verdict: 'CLEAN', findings: 0 } });
    then({ stop: false, lockHeld: true, incident: { open: false }, enrolled, review, shownFirst: false, ...extra });
  });
}

test('a merge with an open decision is refused, with a different answer not applied too', async () => {
  await permit({ decisions: { work: 'w-tide-1', waiting: [{ id: 'q-w-tide-1-1', why: 'open' }] } }, (ctx) => {
    assert.match(brokerDecision(merge(), ctx).reason, /question open on w-tide-1/);
  });
  await permit({ decisions: { work: 'w-tide-1', waiting: [{ id: 'q-w-tide-1-1', why: 'unapplied' }] } }, (ctx) => {
    assert.match(brokerDecision(merge(), ctx).reason, /chose something other than what w-tide-1 was built on/);
  });
});

test('a decision that cannot be read refuses the merge; none waiting, or none asked (a restore), lets it through', async () => {
  await permit({ decisions: null }, (ctx) => assert.match(brokerDecision(merge(), ctx).reason, /could not be checked/));
  await permit({ decisions: { work: 'w' } }, (ctx) => assert.equal(brokerDecision(merge(), ctx).allow, false));
  await permit({ decisions: { work: 'w-tide-1', waiting: [] } }, (ctx) => assert.deepEqual(brokerDecision(merge(), ctx), { allow: true }));
  await permit({}, (ctx) => assert.deepEqual(brokerDecision(merge(), ctx), { allow: true }));
});
