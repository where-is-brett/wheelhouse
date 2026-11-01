// tests/scripts/host/helper-rules.test.js
// A rule through the helper: no caller writes one, or sends one along with a confirmation, and the director's signed
// click on its confirm line puts it in force. Stand-ins only: no session starts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { listEvents, makeEvent, writeEvent, confirmationFor } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { earned } from '../../../scripts/hooks/prompt-record.js';
import { confirmLine } from '../../../scripts/state/card-lines.js';
import { composeRule } from '../../../scripts/delegation/composer.js';
import { SUGGEST } from '../../../scripts/lib/calm-words.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const adapter = { defaultBranch: async () => 'main' };
const P = 'o__p';
const rule = composeRule({
  answer: { label: SUGGEST, words: 'Take the proper long-term option' }, card: { kind: 'question', level: 3 },
  facts: { readable: true, paths: ['src/a.js'], depsChanged: false, schemaChanged: false, guardrail: false, secrets: false, critical: false },
  lane: 'small', project: P, now: () => new Date('2026-11-01T02:00:00.000Z'),
});

async function computer() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = tempFolder('wh-project-');
  fs.mkdirSync(path.join(folder, '.claude'));
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] }));
  await as(home, async () => {
    writeProject(P, { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const { computer: id, publicKey } = makeSigningKey();
    enrol({ computer: id, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: P, remoteUrl: remote.url });
  });
  const withHelper = (fn) => as(home, async () => {
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), evalsFolder: tempFolder('wh-evals-') });
    try { return await fn(helperClient({ address: helper.address })); } finally { await helper.close(); }
  });
  const events = () => listEvents(stateDir(P), { report: () => {} });
  return { withHelper, events, views: () => buildViews(events(), readEnrolled()), cleanup: () => remote.cleanup() };
}

test('an agent can\'t write a rule', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      const got = await client.state.write({ project: P, kind: 'rule', data: rule });
      assert.equal(got.ok, false);
      assert.match(got.refused, /only the helper itself records/);
      assert.deepEqual(c.events().filter((e) => e.kind === 'rule'), []);
    });
  } finally {
    await c.cleanup();
  }
});

test('a rule can\'t come along with a confirmation, even a signed one', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      const target = makeEvent({ kind: 'rule', data: rule });
      const got = await client.state.record({ project: P, event: makeEvent({ ...confirmationFor(target) }), target });
      assert.equal(got.ok, false);
      assert.match(got.refused, /only a ruling or a setting comes with its confirmation/);
      assert.deepEqual(c.views().rules, {});
    });
  } finally {
    await c.cleanup();
  }
});

test('a rule the helper proposed is confirmed by a signed click and reads back at stage 0, deciding nothing', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      const event = makeEvent({ kind: 'rule', data: rule });
      await writeEvent({ project: P, event });
      assert.deepEqual(c.views().rules, {});
      const question = `Same answer for this kind of thing from now on?\n${confirmLine(event)}`;
      const got = await earned({ project: P, question, label: 'Confirm', card: { question } });
      const click = makeEvent({ ...got.made });
      const taken = await client.state.record({ project: P, event: click });
      assert.equal(taken.ok, true, taken.refused);
      assert.deepEqual(c.views().rules, { [rule.id]: { rule, stage: 0, signedAt: click.at } });
    });
  } finally {
    await c.cleanup();
  }
});
