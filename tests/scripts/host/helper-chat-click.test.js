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
import { composeCard } from '../../../scripts/cards/compose.js';
import { listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { CONFIRMED_STEPS } from '../../../scripts/agents/chat-clicks.js';
import { CONFIRMED_STEPS as COPILOT_CONFIRMED_STEPS } from '../../../scripts/agents/copilot/numbers.js';

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

test('pairing an app is a confirmed step on both lists, and no chat click pairs or unpairs one', async () => {
  assert.ok(CONFIRMED_STEPS.includes('pairing'));
  assert.deepEqual([...COPILOT_CONFIRMED_STEPS], [...CONFIRMED_STEPS], 'the two lists are the same');
  await withProject(async (client) => {
    for (const label of ['Pair it', 'Unpair it']) {
      for (const card of ['pairing', 'pairing-1']) {
        assert.equal((await client.cards.chatClick({ project: 'o__p', card, label, hash: HASH, proof: 'chat-click' })).ok, false, `${card} ${label}`);
      }
      // On any other card a click that would sign is refused too, as a Pair it or Unpair it signs on the card's own line.
      assert.equal((await client.cards.chatClick({ project: 'o__p', card: 'update-3', label, hash: HASH, proof: 'chat-click' })).ok, false, label);
    }
    assert.deepEqual(answers(), []);
  });
});

const base = { why: 'It changes what users see.', because: 'the checks passed.', meanwhile: 'Nothing is released.' };
const says = (label) => ({ label, says: `It ${label.toLowerCase()}s and goes ahead.` });
const SHA = 'a'.repeat(40);
const mergeCard = composeCard({ ...base, kind: 'approval', level: 3, recommend: 'Approve', what: 'Pull request #12 has everything else it needs to merge.', options: [says('Approve')], target: { pr: 12, sha: SHA } }).card;
const guardrailCard = composeCard({ ...base, kind: 'approval', level: 4, recommend: 'Approve', what: 'Pull request #13 changes a file that steers the agents.', checks: 'It changes no checks: the change is still checked before it is added.', options: [says('Approve')], target: { pr: 13, sha: SHA } }).card;
const shown = async (client, data) => {
  const made = await client.state.write({ project: 'o__p', kind: 'card', data });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.id;
};

test('a chat click that would sign is taken only on a plain merge approval, read from the live card and not from its id', async () => {
  await withProject(async (client) => {
    // A card of another kind, and a guardrail approval, whatever their ids: refused.
    assert.equal((await client.cards.chatClick({ project: 'o__p', card: 'update-3', label: 'Approve', hash: HASH, proof: 'chat-click' })).ok, false);
    assert.equal((await client.cards.chatClick({ project: 'o__p', card: 'merge-3', label: 'Approve', hash: HASH, proof: 'chat-click' })).ok, false, 'a name says nothing');
    const guardrail = await shown(client, guardrailCard);
    assert.equal((await client.cards.chatClick({ project: 'o__p', card: guardrail, label: 'Approve', hash: HASH, proof: 'chat-click' })).ok, false);
    assert.deepEqual(answers(), []);
    // The card the composer writes for a merge, under its real id: taken.
    const merge = await shown(client, mergeCard);
    assert.equal((await client.cards.chatClick({ project: 'o__p', card: merge, label: 'Approve', hash: HASH, commit: SHA, proof: 'chat-click' })).ok, true);
    assert.equal(answers().length, 1);
  });
});

test('/state/write refuses to record a click\'s proof, so no caller can forge one', async () => {
  await withProject(async (client) => {
    const got = await client.state.write({ project: 'o__p', kind: 'card-answer', data: { question: 'merge-12', label: 'Approve', hash: HASH, proof: 'chat-click' } });
    assert.equal(got.ok, false);
  });
});
