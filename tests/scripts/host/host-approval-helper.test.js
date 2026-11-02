// tests/scripts/host/host-approval-helper.test.js
// The helper builds the person's approval on GitHub for both merge routes (Task B1): /merge and the broker's permit.
// A Copilot project with real users, GitHub's route switched on by the test; no host tool runs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { matchingBody } from '../../helpers/provenance.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const COMPUTER = 'abcd1234';
const T0 = new Date('2026-11-02T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);

// A remote whose main line names this computer as running Copilot, and pull request 7 changing one plain file.
async function remoteWithPr({ agents = { [COMPUTER]: 'copilot' } } = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-work-'));
  await g(work, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(work, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(work, '.claude', 'wheelhouse.json'), `${JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], agents })}\n`);
  fs.writeFileSync(path.join(work, 'README.md'), 'x\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await g(work, 'push', '-q', 'origin', 'main');
  await g(work, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(work, 'a.js'), 'a\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Change');
  const head = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'push', '-q', 'origin', `${head}:refs/pull/7/head`);
  return { remote, work, head, cleanup: () => { remote.cleanup(); fs.rmSync(work, { recursive: true, force: true }); } };
}

async function project(remote) {
  const home = shortHome();
  fs.writeFileSync(path.join(home, 'computer.json'), JSON.stringify({ id: COMPUTER }));
  const folder = path.join(home, 'work');
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  // Real users: the working copy says the project is launched.
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), `${JSON.stringify({ launched: true })}\n`);
  await as(home, async () => {
    writeProject('o__p', { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-02T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(0) })).taken, true);
  });
  return { home, folder };
}

function record(kind, data) {
  const event = makeEvent({ kind, data, now: at(1000) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}

function adapterOf(head, reviews) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: head, mergeable: 'mergeable', state: 'open', body: matchingBody() }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
    reviews: async () => (typeof reviews === 'function' ? reviews() : reviews),
  };
}

async function withHelper(pr, adapter, { ready = true } = {}, fn) {
  const { home, folder } = await project(pr.remote);
  try {
    await as(home, async () => {
      const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), approvalReady: () => ready, reviewModules: (agent) => (agent === 'copilot' ? { kinds: () => ['clean-session'] } : null) });
      try {
        await fn(helperClient({ address: helper.address }), folder);
      } finally { await helper.close(); }
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

const review = (head, state = 'APPROVED') => ({ login: 'o', type: 'User', state, commit: head, at: '2026-11-02T01:30:00Z' });
const merge = (client, extra = {}) => client.merge({ project: 'o__p', number: 7, stop: false, bypass: false, ...extra });

test('/merge refuses a Copilot project\'s merge until the person has approved the head', async () => {
  const pr = await remoteWithPr();
  try {
    const reviews = [];
    const adapter = adapterOf(pr.head, () => reviews);
    await withHelper(pr, adapter, {}, async (client) => {
      record('review', { pr: 7, commit: pr.head, verdict: 'CLEAN', reviewKind: 'clean-session' });
      const refused = await merge(client);
      assert.equal(refused.ok, false);
      assert.deepEqual(refused.reasons, [`the director's approval on GitHub of ${pr.head.slice(0, 7)} isn't there`]);
      reviews.push(review('c'.repeat(40)));
      assert.equal((await merge(client)).ok, false, 'a review of another head');
      reviews.push(review(pr.head));
      assert.equal((await merge(client)).ok, true);
      assert.deepEqual(adapter.merges, [{ number: 7, sha: pr.head }]);
    });
  } finally { pr.cleanup(); }
});

test('a failed review read refuses the merge on /merge', async () => {
  const pr = await remoteWithPr();
  try {
    const adapter = adapterOf(pr.head, () => { throw new Error('GitHub did not answer'); });
    await withHelper(pr, adapter, {}, async (client) => {
      record('review', { pr: 7, commit: pr.head, verdict: 'CLEAN', reviewKind: 'clean-session' });
      assert.equal((await merge(client)).ok, false);
      assert.deepEqual(adapter.merges, []);
    });
  } finally { pr.cleanup(); }
});

test('a Claude project\'s merge, and a Copilot one with the route not ready, are unchanged', async () => {
  for (const [agents, ready] of [[{ [COMPUTER]: 'claude-code' }, true], [{ [COMPUTER]: 'copilot' }, false]]) {
    const pr = await remoteWithPr({ agents });
    try {
      const adapter = adapterOf(pr.head, () => { throw new Error('the reviews are not read at all'); });
      await withHelper(pr, adapter, { ready }, async (client) => {
        record('review', { pr: 7, commit: pr.head, verdict: 'CLEAN', reviewKind: 'clean-session' });
        assert.equal((await merge(client)).ok, true);
      });
    } finally { pr.cleanup(); }
  }
});

test('the broker refuses the same merge without the person\'s approval, and never reaches gh', async () => {
  const pr = await remoteWithPr();
  try {
    await withHelper(pr, adapterOf(pr.head, []), {}, async (client, folder) => {
      record('review', { pr: 7, commit: pr.head, verdict: 'CLEAN', reviewKind: 'clean-session' });
      record('approval', { pr: 7, commit: pr.head });
      const got = await client.broker.gh({ argv: ['pr', 'merge', '7', '--merge', '--match-head-commit', pr.head], cwd: folder });
      assert.equal(got.code, 1);
      assert.match(got.stderr, /the director's approval on GitHub of .* isn't there/);
    });
  } finally { pr.cleanup(); }
});
