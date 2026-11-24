// tests/scripts/host/helper-sign-in.test.js
// The helper's part of the builder sign-in check: "Check again" and the hourly look while a sign-in fact stands (builders design, 10.2).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome } from '../../helpers/homes.js';
import { SIGN_IN_OPTIONS } from '../../../scripts/lib/sign-in-gate.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeSignInFact, readSignIn } from '../../../scripts/lib/sign-in-gate.js';
import { setStop, liftStop, stopState } from '../../../scripts/lib/stop.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { testAddress } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const ROUTE = 'claude-code:background';
const fact = () => ({ kind: 'not-signed-in', since: new Date(2026, 10, 24, 14, 2).toISOString(), command: 'claude', excerpt: 'Not logged in', starts: 1 });

async function withHelper(signInCheck, fn) {
  const helper = await startHelper({
    run: hostGuard, address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => ({}), envFor: async () => ({}), signInCheck, dispatchMs: 3600 * 1000,
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

// A helper over a project with a record, for answers written through the state.
async function withProject(signInCheck, fn) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  try {
    await as(home, async () => {
      writeProject('o__p', { folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const helper = await startHelper({
        run: hostGuard, address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => ({ defaultBranch: async () => 'main' }), envFor: async () => ({}), signInCheck, dispatchMs: 3600 * 1000,
      });
      try { await fn(helperClient({ address: helper.address })); } finally { await helper.close(); }
    });
  } finally { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); }
}

const settle = async (until) => {
  for (let i = 0; i < 100 && !until(); i += 1) await new Promise((resolve) => { setTimeout(resolve, 20); });
};

test('the sign-in card\'s "check again" answer runs the check and clears the fact on a pass; other answers, and STOP, run nothing', async () => {
  let calls = 0;
  await withProject(async () => { calls += 1; return { ok: true }; }, async (client) => {
    const answer = (label) => client.state.write({ project: 'o__p', kind: 'card-answer', data: { question: 'sign-in', label } });
    assert.equal((await answer(SIGN_IN_OPTIONS.again)).ok, true);
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    assert.equal(calls, 0, 'no fact, no check');
    writeSignInFact(wheelhouseHome(), ROUTE, fact());
    assert.equal((await answer(SIGN_IN_OPTIONS.launch)).ok, true);
    setStop({ by: 'helper' });
    try {
      await answer(SIGN_IN_OPTIONS.again);
      await new Promise((resolve) => { setTimeout(resolve, 100); });
      assert.equal(calls, 0, 'another option, or STOP, runs nothing');
    } finally {
      liftStop();
    }
    assert.equal((await answer(SIGN_IN_OPTIONS.again)).ok, true);
    await settle(() => Object.keys(readSignIn(wheelhouseHome()).facts).length === 0);
    assert.equal(calls, 1);
    assert.deepEqual(readSignIn(wheelhouseHome()).facts, {}, 'the pass cleared the fact');
  });
});
