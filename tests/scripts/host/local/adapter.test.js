// tests/scripts/host/local/adapter.test.js
// The local host adapter (spec 6): the same methods as makeAdapter, a row of the spec's table a test, and no host tool run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { git, commitIn, projectFolderWith, withKeyedHome } from '../../../helpers/local-home.js';
import { guardedRun, standInTools } from '../../../helpers/host-stand-ins.js';
import { run } from '../../../../scripts/lib/run.js';
import { makeAdapter } from '../../../../scripts/host/adapter.js';
import { adapterOf } from '../../../../scripts/host/adapter-for.js';
import { gitRoute, homeDir, makeHome } from '../../../../scripts/host/local/home.js';
import { makeLocalAdapter } from '../../../../scripts/host/local/adapter.js';
import { localChanges } from '../../../../scripts/host/local/changes.js';
import { commandDigest, writeCheck } from '../../../../scripts/checks/record.js';
import { keepQueue, readQueue } from '../../../../scripts/checks/standing.js';
import { makeEvent, writeEvent } from '../../../../scripts/state/events.js';
import { openProjectRecord } from '../../../../scripts/state/record.js';
import { readProject, writeProject } from '../../../../scripts/lib/projects.js';

const PROJECT = 'shop';
const DIGEST = commandDigest('npm test');

// No host tool runs: the PATH finds stand-ins first, and the adapter's git goes through a guard.
const shims = standInTools();
const hostLog = [];
const guarded = guardedRun(run, { log: hostLog });
test.afterEach(() => {
  assert.deepEqual(hostLog, []);
  assert.deepEqual(shims.calls(), []);
});
test.after(() => shims.restore());

// A home with feature/login one commit on from main, its adapter, and the commits.
async function world() {
  const folder = await projectFolderWith();
  const main = await git(folder, ['rev-parse', 'HEAD']);
  await git(folder, ['switch', '-q', '-c', 'feature/login']);
  const head = await commitIn(folder, 'login.txt', 'one\ntwo\n');
  await git(folder, ['switch', '-q', 'main']);
  await makeHome({ project: PROJECT, folder });
  await openProjectRecord(PROJECT, {});
  return { folder, main, head, adapter: makeLocalAdapter({ project: PROJECT, git: gitRoute({ run: guarded }) }) };
}
const opening = { head: 'feature/login', base: 'main', title: 'Add a login', body: 'Why it is wanted' };
const checked = (commit, result, extra = {}) => writeCheck(PROJECT, { commit, command: DIGEST, result, minutes: 1, tail: '', ...extra }, {
  write: ({ project, event }) => writeEvent({ project, event }),
});

const shape = (adapter) => Object.fromEntries(Object.entries(adapter).map(([k, v]) => [k, typeof v === 'object' ? shape(v) : typeof v]));

test('makeLocalAdapter has every method makeAdapter has', async () => {
  await withKeyedHome(async () => {
    const hosted = makeAdapter({ host: 'github', repo: 'a-director/product', run: async () => ({ code: 0, stdout: '', stderr: '' }), env: {} });
    assert.deepEqual(shape(makeLocalAdapter({ project: PROJECT })), shape(hosted));
  });
});

test('adapterOf reads a registered local project, and a hosted one as before', async () => {
  await withKeyedHome(async () => {
    const { folder, main } = await world();
    writeProject(PROJECT, { folder, remoteUrl: null, host: 'local', repo: `local/${PROJECT}`, connection: { mode: 'none' } });
    const adapter = adapterOf(readProject(PROJECT), { run: guarded });
    assert.equal(await adapter.branchHead(await adapter.defaultBranch()), main);
    const hosted = adapterOf({ host: 'github', repo: 'a-director/product' }, { run: async () => ({ code: 0, stdout: '{"defaultBranchRef":{"name":"trunk"}}', stderr: '' }) });
    assert.equal(await hosted.defaultBranch(), 'trunk');
  });
});

test('defaultBranch and branchHead read from the home', async () => {
  await withKeyedHome(async () => {
    const { folder, main, adapter } = await world();
    await commitIn(folder, 'only-in-the-folder.txt');
    assert.equal(await adapter.defaultBranch(), 'main');
    assert.equal(await adapter.branchHead('main'), main);
    await assert.rejects(adapter.branchHead('no-such-branch'), /no branch no-such-branch/);
  });
});

test('openPr, updatePr, closePr and prState work a local change', async () => {
  await withKeyedHome(async () => {
    const { head, adapter } = await world();
    assert.deepEqual(await adapter.openPr(opening), { number: 1, url: null });
    assert.deepEqual(await adapter.prState(1), { headSha: head, title: 'Add a login', headRef: 'feature/login', baseRef: 'main', mergeable: 'yes', state: 'open', body: 'Why it is wanted' });
    await adapter.updatePr({ number: 1, title: 'A login page' });
    assert.equal((await adapter.prState(1)).title, 'A login page');
    await adapter.closePr(1);
    const closed = await adapter.prState(1);
    assert.equal(closed.state, 'closed');
    assert.equal(closed.mergeable, 'unknown');
    await assert.rejects(adapter.prState(2), /no change 2/);
    await assert.rejects(adapter.updatePr({ number: 0 }), /whole number/);
  });
});

test('prState says when a change no longer merges', async () => {
  await withKeyedHome(async () => {
    const { folder, adapter } = await world();
    await git(folder, ['switch', '-q', 'feature/login']);
    await commitIn(folder, 'a.txt', 'the branch\n');
    await git(folder, ['switch', '-q', 'main']);
    await commitIn(folder, 'a.txt', 'the main line\n');
    await git(homeDir(PROJECT), ['fetch', '-q', folder, '+main:main', '+feature/login:feature/login']);
    await adapter.openPr(opening);
    assert.equal((await adapter.prState(1)).mergeable, 'no');
  });
});

test('ciState reads the check records, newest first', async () => {
  await withKeyedHome(async () => {
    const { head, adapter } = await world();
    assert.deepEqual(await adapter.ciState(head), { sha: head, state: 'none' });
    await checked(head, 'could-not-run');
    assert.equal((await adapter.ciState(head)).state, 'pending');
    await checked(head, 'failed');
    assert.equal((await adapter.ciState(head)).state, 'failure');
    await checked(head, 'timed-out');
    assert.equal((await adapter.ciState(head)).state, 'failure');
    await checked(head, 'passed');
    assert.deepEqual(await adapter.ciState(head), { sha: head, state: 'success' });
    assert.deepEqual((await adapter.checkContexts(head)).map((c) => [c.name, c.state]), [['wheelhouse/checks', 'success']]);
  });
});

test('ciState reads not-counted as success', async () => {
  await withKeyedHome(async () => {
    const { head, adapter } = await world();
    await checked(head, 'not-counted');
    assert.equal((await adapter.ciState(head)).state, 'success');
  });
});

test('a head waiting for its check reads pending', async () => {
  await withKeyedHome(async () => {
    const { head, adapter } = await world();
    keepQueue(PROJECT, { ...readQueue(PROJECT), heads: [{ commit: head, work: 'login' }] });
    assert.equal((await adapter.ciState(head)).state, 'pending');
  });
});

test('a check nobody here signed counts for nothing', async () => {
  await withKeyedHome(async () => {
    const { head, adapter } = await world();
    const event = makeEvent({ kind: 'check', data: { commit: head, command: DIGEST, result: 'passed', minutes: 1, tail: '' } });
    await writeEvent({ project: PROJECT, event: { ...event, sig: { ...event.sig, value: 'AAAA' } } });
    assert.equal((await adapter.ciState(head)).state, 'none');
    assert.deepEqual(await adapter.checkContexts(head), []);
  });
});

test('only a clean check speaks for the main line', async () => {
  await withKeyedHome(async () => {
    const { main, adapter } = await world();
    await checked(main, 'passed');
    assert.equal((await adapter.ciState(main)).state, 'none');
    await checked(main, 'failed', { clean: true });
    assert.equal((await adapter.ciState(main)).state, 'failure');
    await checked(main, 'passed');
    assert.equal((await adapter.ciState(main)).state, 'failure');
  });
});

test('hasCi is always true, setStatus and verdictComment do nothing, previewUrl is null and login is this computer', async () => {
  await withKeyedHome(async () => {
    const { head, adapter } = await world();
    assert.equal(await adapter.hasCi(head, 'main'), true);
    assert.deepEqual(await adapter.setStatus({ sha: head, state: 'success', description: 'passed' }), { ok: true });
    assert.deepEqual(await adapter.verdictComment({ number: 3, body: 'CLEAN' }), { id: 3 });
    assert.deepEqual(await adapter.verdictComment({ number: 3, id: 7, body: 'CLEAN' }), { id: 7 });
    assert.equal(await adapter.previewUrl(head), null);
    assert.equal(await adapter.login(), 'this computer');
    assert.deepEqual(await adapter.requiredChecks('main'), []);
  });
});

test('merge adds an open change to the main version, and a head that moved is refused', async () => {
  await withKeyedHome(async () => {
    const { head, adapter } = await world();
    await adapter.openPr(opening);
    assert.equal((await adapter.merge({ number: 1, sha: 'b'.repeat(40) })).merged, false);
    const { merged, commit } = await adapter.merge({ number: 1, sha: head });
    assert.equal(merged, true);
    assert.equal(await adapter.branchHead('main'), commit);
    assert.equal((await adapter.prState(1)).state, 'merged');
  });
});

test('openRequests, requestDetails and pullRef read changes and the home', async () => {
  await withKeyedHome(async () => {
    const { head, adapter } = await world();
    await adapter.openPr(opening);
    assert.deepEqual(await adapter.openRequests(), [{ number: 1, title: 'Add a login', body: 'Why it is wanted', branch: 'feature/login', head, draft: false, fork: false }]);
    assert.deepEqual(await adapter.requestDetails(1), { files: [{ path: 'login.txt', additions: 2, deletions: 0 }], commits: ['add login.txt'] });
    assert.equal(adapter.pullRef(1), 'refs/pull/1/head');
    assert.equal(await git(homeDir(PROJECT), ['rev-parse', adapter.pullRef(1)]), head);
  });
});

test('mergedRequests and pipelinesFor read the home\'s history and the check records', async () => {
  await withKeyedHome(async () => {
    const { folder, head, adapter } = await world();
    await adapter.openPr(opening);
    await git(folder, ['switch', '-q', 'main']);
    await git(folder, ['merge', '-q', '--ff-only', 'feature/login']);
    await git(homeDir(PROJECT), ['fetch', '-q', folder, '+main:main']);
    await localChanges({ project: PROJECT }).markMerged({ n: 1, commit: head });
    const [merged, ...more] = await adapter.mergedRequests({ since: '2026-01-01T00:00:00.000Z' });
    assert.deepEqual(more, []);
    assert.deepEqual([merged.number, merged.title, merged.target, merged.mergeCommit, merged.mergedBy], [1, 'Add a login', 'main', head, 'this computer']);
    assert.deepEqual(await adapter.mergedRequests({ since: '2999-01-01T00:00:00.000Z' }), []);
    await checked(head, 'failed');
    await checked(head, 'passed');
    const pipelines = await adapter.pipelinesFor(head, { number: 1 });
    assert.deepEqual(pipelines.map((p) => [p.status, p.head]), [['success', true], ['failed', false]]);
    assert.deepEqual(await adapter.pipelinesFor('a'.repeat(40)), []);
  });
});

test('a merged record the home doesn\'t hold isn\'t listed', async () => {
  await withKeyedHome(async () => {
    const { head, adapter } = await world();
    await adapter.openPr(opening);
    await localChanges({ project: PROJECT }).markMerged({ n: 1, commit: head });
    assert.deepEqual(await adapter.mergedRequests({ since: '2026-01-01T00:00:00.000Z' }), []);
  });
});

test('protectionEvents has none to give', async () => {
  await withKeyedHome(async () => {
    const { adapter } = await world();
    assert.deepEqual(await adapter.protectionEvents({ since: '2026-01-01T00:00:00.000Z' }), { source: 'none', compared: false, events: [] });
  });
});

test('a refused issue call says so plainly', async () => {
  await withKeyedHome(async () => {
    const { adapter } = await world();
    const plainly = /kept on this computer/;
    await assert.rejects(adapter.issue.create({ title: 'x', body: '' }), plainly);
    await assert.rejects(adapter.issue.update({ number: 1, body: '' }), plainly);
    await assert.rejects(adapter.issue.list({ label: 'x' }), plainly);
  });
});
