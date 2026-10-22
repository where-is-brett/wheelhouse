// tests/scripts/host/helper-answer.test.js
// /state/answer: the label of a question's verified answer, from the views alone,
// and null for anything else. Read-only, so STOP lets it through.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { dataHash, eventPath, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (n) => () => new Date(T0.getTime() + n * 1000);
const ID = 'q-export-csv-1';
const QUESTION = {
  id: ID, work: 'export-csv', what: 'Which separator?', why: 'It changes the file',
  options: [{ label: 'Comma', says: 'Commas' }, { label: 'Tab', says: 'Tabs' }], recommendation: 'Comma', level: 2,
};

const fakeAdapter = () => ({ defaultBranch: async () => 'main' });

async function project() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
  });
  return { home, cleanup: () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); } };
}

function keep(event, { unsigned = false } = {}) {
  const { sig, ...bare } = event;
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(unsigned ? bare : event, null, 2)}\n`);
}

const asked = (n = 1) => makeEvent({ kind: 'question', data: QUESTION, now: at(n) });
const click = (n, extra = {}) => makeEvent({
  kind: 'action',
  data: { action: 'answer', question: 'the card as shown', questionId: ID, questionHash: dataHash(QUESTION), label: 'Tab', ...extra },
  now: at(n),
});

async function withHelper(fn) {
  const helper = await startHelper({ run: hostGuard, address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => fakeAdapter(), envFor: async () => ({}) });
  try {
    return await fn(helperClient({ address: helper.address }));
  } finally {
    await helper.close();
  }
}

test('/state/answer gives a label only from a verified answer to the question as it was shown', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      await withHelper(async (client) => {
        const ask = (questionId = ID) => client.state.answer({ project: 'o__p', questionId });
        keep(asked());
        assert.deepEqual(await ask(), { ok: true, answer: null }, 'asked and not answered');

        // A card's answer, an unsigned answer, an answer to other words, and a label that is no option answer nothing.
        keep(makeEvent({ kind: 'card-answer', data: { question: 'Answer question q-export-csv-1', label: 'Comma' }, now: at(2) }));
        keep(click(3, { label: 'Comma' }), { unsigned: true });
        keep(click(4, { questionHash: dataHash({ ...QUESTION, what: 'Another question?' }) }));
        keep(click(5, { label: 'Semicolon' }));
        assert.deepEqual(await ask(), { ok: true, answer: null });

        keep(click(6));
        assert.deepEqual(await ask(), { ok: true, answer: 'Tab' });
        assert.deepEqual(await ask('q-export-csv-2'), { ok: true, answer: null });
        for (const odd of ['__proto__', 'constructor', 'toString']) assert.deepEqual(await ask(odd), { ok: true, answer: null }, odd);
        assert.equal((await client.state.answer({ project: 'o__p' })).ok, false);
        assert.equal((await client.state.answer({ project: 'o__p', questionId: 7 })).ok, false);
      });
    });
  } finally { p.cleanup(); }
});

test('/state/answer is answered under STOP', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      keep(asked());
      keep(click(2, { label: 'Comma' }));
      setStop({ by: 'prompt', now: at(3) });
      await withHelper(async (client) => {
        assert.deepEqual(await client.state.answer({ project: 'o__p', questionId: ID }), { ok: true, answer: 'Comma' });
      });
    });
  } finally { p.cleanup(); }
});
