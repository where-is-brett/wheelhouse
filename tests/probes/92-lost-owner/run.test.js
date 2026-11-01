// tests/probes/92-lost-owner/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyActive, ownerSocket, tallyU2, turnedAway } from '../../../probes/92-lost-owner/run.js';

const good = () => ({
  ownerLost: true,
  blockedBefore: true,
  cancel: { ok: true },
  status: 'cancelled',
  kept: [{ file: 'uncommitted.txt', there: true }],
  fresh: { status: 'completed', samePath: true, turnedAway: false },
});

test('tallyU2 passes only when every leg was measured', () => {
  assert.deepEqual(tallyU2(good()), { pass: true, failures: [] });
  assert.equal(tallyU2({}).pass, false);
  assert.equal(tallyU2().failures.length, 6);
});

test('tallyU2 fails on a lost file, a refused cancel and a fresh run turned away', () => {
  assert.match(tallyU2({ ...good(), kept: [{ file: 'uncommitted.txt', there: false }] }).failures.join(), /not kept/);
  assert.match(tallyU2({ ...good(), kept: [] }).failures.join(), /not kept/);
  assert.match(tallyU2({ ...good(), cancel: { ok: false } }).failures.join(), /did not take it/);
  assert.match(tallyU2({ ...good(), fresh: { status: 'completed', samePath: true, turnedAway: true } }).failures.join(), /fresh run/);
});

test('turnedAway needs the cancelled row, no step run and the log line', () => {
  const log = 'Error: Workflow already active on this path (running): u2-talks';
  assert.equal(alreadyActive(log), true);
  assert.equal(turnedAway({ status: 'cancelled', nodes: [], logs: [log] }), true);
  assert.equal(turnedAway({ status: 'cancelled', nodes: [{ id: 'first' }], logs: [log] }), false);
  assert.equal(turnedAway({ status: 'cancelled', nodes: [], logs: ['Started'] }), false);
  assert.equal(turnedAway({ status: 'completed', nodes: [], logs: [log] }), false);
  assert.equal(turnedAway(), false);
});

test('ownerSocket is the run id hashed under the user\'s folder', () => {
  assert.equal(ownerSocket('abc', 501), '/tmp/archon-501/ba7816bf8f01cfea414140de5dae2223.sock');
});
