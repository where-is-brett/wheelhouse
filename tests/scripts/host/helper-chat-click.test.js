// tests/scripts/host/helper-chat-click.test.js
// /cards/chat-click: a click in an agent's chat is recorded as the agent's own account (proof chat-click, not proven):
// unsigned, never binding. The steps a chat click may not decide are refused, so they go to the helper's window.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { CONFIRMED_STEPS } from '../../../scripts/agents/chat-clicks.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const HASH = 'a'.repeat(64);

async function withProject(fn) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  try {
    await as(home, async () => {
      writeProject('o__p', { folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const helper = await startHelper({ run: hostGuard, address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => ({ defaultBranch: async () => 'main' }), envFor: async () => ({}) });
      try { await fn(helperClient({ address: helper.address })); } finally { await helper.close(); }
    });
  } finally { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); }
}

const answers = () => listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'card-answer');

test('a stand-in click is recorded as chat-click, unsigned, and decides nothing', async () => {
  await withProject(async (client) => {
    const got = await client.cards.chatClick({ project: 'o__p', card: 'merge-12', label: 'Not now', hash: HASH, proof: 'chat-click' });
    assert.equal(got.ok, true);
    const [record] = answers();
    assert.equal(record.data.proof, 'chat-click');
    assert.equal(record.data.where, 'chat');
    assert.equal(record.sig, undefined, 'a chat click is never signed');
  });
});

test('a chat click names no proof but chat-click, and takes no hash but a sha256', async () => {
  await withProject(async (client) => {
    for (const proof of ['window', 'host', 'signed-hook', 'hook-click', undefined]) {
      assert.equal((await client.cards.chatClick({ project: 'o__p', card: 'merge-12', label: 'Not now', hash: HASH, proof })).ok, false, String(proof));
    }
    assert.equal((await client.cards.chatClick({ project: 'o__p', card: 'merge-12', label: 'Not now', hash: 'nope', proof: 'chat-click' })).ok, false);
    assert.deepEqual(answers(), []);
  });
});

test('every confirmed step refuses a signing click in the chat, so it goes to the helper\'s window', async () => {
  await withProject(async (client) => {
    for (const step of CONFIRMED_STEPS) {
      for (const card of [step, `${step}-1`]) {
        for (const label of ['Approve', 'Confirm', 'Lift STOP', 'Do it']) {
          const got = await client.cards.chatClick({ project: 'o__p', card, label, hash: HASH, proof: 'chat-click' });
          assert.equal(got.ok, false, `${card} ${label}`);
        }
      }
    }
    assert.deepEqual(answers(), []);
  });
});

test('a chat click that would sign is taken only on a merge card', async () => {
  await withProject(async (client) => {
    assert.equal((await client.cards.chatClick({ project: 'o__p', card: 'update-3', label: 'Approve', hash: HASH, proof: 'chat-click' })).ok, false);
    assert.equal((await client.cards.chatClick({ project: 'o__p', card: 'merge-3', label: 'Approve', hash: HASH, proof: 'chat-click' })).ok, true);
    assert.equal(answers().length, 1);
  });
});

test('/state/write refuses to record a click\'s proof, so no caller can forge one', async () => {
  await withProject(async (client) => {
    const got = await client.state.write({ project: 'o__p', kind: 'card-answer', data: { question: 'merge-12', label: 'Approve', hash: HASH, proof: 'chat-click' } });
    assert.equal(got.ok, false);
  });
});
