// tests/scripts/host/helper-sign-in.test.js
// The helper's part of the builder sign-in check: "Check again" and the hourly look while a sign-in fact stands (builders design, 10.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeSignInFact, readSignIn } from '../../../scripts/lib/sign-in-gate.js';
import { setStop, liftStop, stopState } from '../../../scripts/lib/stop.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { testAddress } from '../../helpers/homes.js';

const ROUTE = 'claude-code:background';
const fact = () => ({ kind: 'not-signed-in', since: new Date(2026, 10, 24, 14, 2).toISOString(), command: 'claude', excerpt: 'Not logged in', starts: 1 });

async function withHelper(signInCheck, fn) {
  const helper = await startHelper({
    address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => ({}), envFor: async () => ({}), signInCheck, dispatchMs: 3600 * 1000,
  });
  try {
    return await fn(helperClient({ address: helper.address }), helper);
  } finally {
    await helper.close();
  }
}

test('Check again clears the fact only when the check passes, and is refused under STOP', async () => {
  let pass = false;
  await withHelper(async () => (pass ? { ok: true } : { ok: false, kind: 'not-signed-in', line: "A builder started as `claude` couldn't sign in: it said it isn't logged in." }), async (client) => {
    writeSignInFact(wheelhouseHome(), ROUTE, fact());
    const failed = await client.setup.buildersCheck({});
    assert.equal(failed.ok, false);
    assert.equal(failed.kind, 'not-signed-in');
    assert.match(failed.refused, /isn't logged in/);
    assert.ok(readSignIn(wheelhouseHome()).facts[ROUTE], 'the fact stands');
    pass = true;
    setStop({ by: 'helper' });
    try {
      assert.equal((await client.setup.buildersCheck({})).refused, 'All stop is on');
      assert.ok(readSignIn(wheelhouseHome()).facts[ROUTE]);
    } finally {
      liftStop();
    }
    assert.equal(stopState().on, false);
    assert.deepEqual(await client.setup.buildersCheck({}), { ok: true, cleared: true });
    assert.deepEqual(readSignIn(wheelhouseHome()).facts, {});
    assert.equal((await client.setup.buildersCheck({ extra: 1 })).ok, false, 'it takes nothing');
  });
});

test('the hourly look runs only while a fact stands, and not under STOP', async () => {
  let calls = 0;
  await withHelper(async () => { calls += 1; return { ok: true }; }, async (client, helper) => {
    await helper.signIn.tick();
    assert.equal(calls, 0, 'no fact, no check');
    writeSignInFact(wheelhouseHome(), ROUTE, fact());
    setStop({ by: 'helper' });
    try {
      await helper.signIn.tick();
      assert.equal(calls, 0, 'STOP freezes it');
    } finally {
      liftStop();
    }
    await helper.signIn.tick();
    assert.equal(calls, 1);
    assert.deepEqual(readSignIn(wheelhouseHome()).facts, {}, 'a pass cleared the fact');
  });
});
