// tests/scripts/state/data-route-record.test.js
// The director's approval of a read-only route to real data is the helper's alone to record: a process holding this computer's
// key can't send one through /state/record (checkRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkRecord, makeEvent } from '../../../scripts/state/events.js';
import { enrol, makeSigningKey, readEnrolled } from '../../../scripts/state/signing.js';
import { tempFolder } from '../../helpers/homes.js';

async function withHome(fn) {
  const home = path.join(tempFolder('wh-route-'), 'home');
  fs.mkdirSync(home, { recursive: true });
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-08T00:00:00.000Z' });
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

test('a data-route-approved record is refused through /state/record, though it is signed by this computer', () => withHome(() => {
  const event = makeEvent({ kind: 'data-route-approved', data: { command: 'node tools/print-tables.js' } });
  assert.match(checkRecord(event, { enrolled: readEnrolled() }), /only the helper records the approval of a route to the real data/);
  // A kind a caller may send is still taken, so the refusal is this kind's own.
  const decided = makeEvent({ kind: 'confirmation', data: { confirms: 'x', confirmsHash: 'y' } });
  assert.doesNotMatch(String(checkRecord(decided, { enrolled: readEnrolled() })), /real data/);
}));
