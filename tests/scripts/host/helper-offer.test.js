// tests/scripts/host/helper-offer.test.js
// The one click end to end: an answer that left the recommendation, the helper's own rule read from the piece's change,
// the front desk's card, and the director's signed Confirm. Stand-ins only: no session starts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { dataHash, listEvents, makeEvent, writeEvent } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { earned } from '../../../scripts/hooks/prompt-record.js';
import { cards } from '../../../scripts/frontdesk/cli.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { decisionKey } from '../../../scripts/delegation/asked.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const P = 'o__p';
const WHAT = 'Keep the old export?';
const QUESTION = {
  id: 'q-w1-1', work: 'w1', what: WHAT, why: 'It is a choice of yours.', level: 3, recommendation: 'Keep', key: decisionKey('w1', WHAT),
  options: [{ label: 'Keep', says: 'It stays.' }, { label: 'Replace', says: 'A new one.' }],
};

function repository() {
  const folder = tempFolder('wh-project-');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: folder, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(folder, '.claude'));
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] }));
  git('add', '.');
  git('commit', '-q', '-m', 'start');
  const main = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'feature/w1');
  fs.mkdirSync(path.join(folder, 'src'));
  fs.writeFileSync(path.join(folder, 'src', 'a.js'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'work');
  return { folder, main };
}

function stubSpawn() {
  return () => {
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    return child;
  };
}

test('an answer that earns it brings one line offering a rule, and a Confirm signs it', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const { folder, main } = repository();
  try {
    await as(home, async () => {
      writeProject(P, { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: P, remoteUrl: remote.url });
      await writeEvent({ project: P, event: makeEvent({ kind: 'work', data: { id: 'w1', title: 'The export', lane: 'small', visible: true, dependsOn: [] } }) });
      await writeEvent({ project: P, event: makeEvent({ kind: 'run', data: { work: 'w1', lane: 'small', engine: 'fake', runId: 'run-1', state: 'started', branch: 'feature/w1' } }) });
      await writeEvent({ project: P, event: makeEvent({ kind: 'question', data: QUESTION }) });
      await writeEvent({ project: P, event: makeEvent({ kind: 'action', data: { action: 'answer', question: 'the card as shown', questionId: QUESTION.id, questionHash: dataHash(QUESTION), label: 'Replace' } }) });

      const engine = { ...fakeEngine({ recordings: {} }), inspect: async () => ({ status: 'ended', branch: 'feature/w1', folder, steps: [] }) };
      const adapter = { defaultBranch: async () => 'main', branchHead: async () => main };
      const helper = await startHelper({
        run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), evalsFolder: tempFolder('wh-evals-'),
        spawn: stubSpawn(), refreshMirror: async () => ({ ok: true }), engineFor: () => engine, dispatchMs: 60 * 60 * 1000,
      });
      try {
        const client = helperClient({ address: helper.address });
        const events = () => listEvents(stateDir(P), { report: () => {} });
        const got = await cards({ client, cwd: folder, now: () => new Date() });
        const offer = got.questions.find((q) => q.question.startsWith('Same answer for this kind of thing from now on?'));
        assert.ok(offer, JSON.stringify(got));
        assert.match(offer.question, /take Replace\. Only in this project, in the small lane, for src\/a\.js/);
        assert.deepEqual(buildViews(events(), readEnrolled()).rules, {});

        const again = await cards({ client, cwd: folder, now: () => new Date() });
        assert.equal(events().filter((e) => e.kind === 'rule').length, 1, 'one offer a sitting');
        assert.equal(again.questions.some((q) => q.question.startsWith('Same answer')), false);

        const card = events().find((e) => e.kind === 'card' && e.data.line?.startsWith('Confirm rule'));
        const click = makeEvent({ ...(await earned({ project: P, question: card.data.question, label: 'Confirm', card: { question: card.data.question } })).made });
        assert.equal((await client.state.record({ project: P, event: click })).ok, true);
        const views = buildViews(events(), readEnrolled());
        const [signed] = Object.values(views.rules);
        assert.deepEqual(signed.rule.paths, ['src/a.js']);
        assert.equal(signed.stage, 0);
        assert.equal(views.waiting.some((c) => c.id === card.id), false);
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
  }
});
