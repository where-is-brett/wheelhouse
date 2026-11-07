// tests/scripts/host/undo.test.js
// Undo on GitHub and GitLab (design section 8 of the director's way of working): one reply takes a merged change back out, by a revert
// the helper makes, opens as a pull request and merges through the same gate as any merge. The director's click in the helper's window
// is the signed approval; a revert that clashes with later work forces nothing and becomes a decision.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { undoOnHost, undoBranch, UNDO_BRANCH, undoConflictCard } from '../../../scripts/host/undo.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { listEvents, dataHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const MERGE = 'a'.repeat(40);
const REVERT = 'b'.repeat(40);
const AFTER = 'c'.repeat(40);

// --- undoOnHost, against stand-ins for the two hosts ---
// Both hosts give the same adapter contract (openPr, prState); the stand-in is built once for each and must be driven the same.
function standIns({ history = [MERGE], revert = { ok: true, commit: REVERT, subject: 'Add tides' }, push = { ok: true }, through = { ok: true, merged: true }, kept = null, approvalOnRecord = false } = {}) {
  const calls = [];
  const adapter = (host) => ({
    host,
    openPr: async (x) => { calls.push(['openPr', x]); return { number: 12 }; },
    prState: async (n) => { calls.push(['prState', n]); return { state: 'open', headSha: REVERT }; },
  });
  const git = {
    base: async () => { calls.push(['base']); return { head: calls.some((c) => c[0] === 'through') ? AFTER : 'd'.repeat(40), history }; },
    revert: async (x) => { calls.push(['revert', x]); return revert; },
    push: async (x) => { calls.push(['push', x]); return push; },
  };
  const hooks = {
    keep: (e) => calls.push(['keep', e]),
    approve: async (x) => { calls.push(['approve', x]); return approvalOnRecord || x.approval !== null; },
    through: async (n) => { calls.push(['through', n]); return through; },
  };
  return { calls, adapter, git, hooks, kept };
}
const names = (calls) => calls.map((c) => c[0]);
const CLICK = { id: 'click-1' };

for (const host of ['github', 'gitlab']) {
  test(`undo on ${host === 'github' ? 'GitHub' : 'GitLab'} opens a revert and merges it through the gate`, async () => {
    const s = standIns();
    const got = await undoOnHost({ adapter: s.adapter(host), git: s.git, merge: MERGE, approval: CLICK, defaultBranch: 'main', kept: null, ...s.hooks });
    assert.deepEqual(got, { ok: true, pr: 12, merged: true, merge: AFTER });
    assert.deepEqual(names(s.calls), ['base', 'revert', 'push', 'openPr', 'keep', 'approve', 'through', 'base']);
    const branch = undoBranch(MERGE, REVERT);
    assert.match(branch, UNDO_BRANCH);
    assert.deepEqual(s.calls.find((c) => c[0] === 'push')[1], { branch, commit: REVERT });
    const opened = s.calls.find((c) => c[0] === 'openPr')[1];
    assert.deepEqual([opened.head, opened.base], [branch, 'main']);
    assert.deepEqual(s.calls.find((c) => c[0] === 'keep')[1], { merge: MERGE, pr: 12, head: REVERT, branch });
    assert.deepEqual(s.calls.find((c) => c[0] === 'approve')[1], { pr: 12, head: REVERT, approval: CLICK });
    assert.equal(s.calls.find((c) => c[0] === 'through')[1], 12);
  });
}

test('nothing is pushed or opened without the director\'s click', async () => {
  const s = standIns();
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: null, defaultBranch: 'main', kept: null, ...s.hooks });
  assert.deepEqual(got, { ok: false, reason: 'needs-approval' });
  assert.deepEqual(names(s.calls), ['base']);
});

test('a merge that is not in the default branch is not undone', async () => {
  const s = standIns({ history: ['e'.repeat(40)] });
  assert.deepEqual(await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: CLICK, defaultBranch: 'main', kept: null, ...s.hooks }), { ok: false, reason: 'not-merged' });
  assert.deepEqual(await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: 'main', approval: CLICK, defaultBranch: 'main', kept: null, ...s.hooks }), { ok: false, reason: 'not-merged' });
  assert.equal(names(s.calls).includes('push'), false);
});

test('a conflicting revert forces nothing: nothing is pushed, opened or merged', async () => {
  const s = standIns({ revert: { ok: false, reason: 'conflict' } });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: CLICK, defaultBranch: 'main', kept: null, ...s.hooks });
  assert.deepEqual(got, { ok: false, reason: 'conflict' });
  assert.deepEqual(names(s.calls), ['base', 'revert']);
  const card = undoConflictCard(MERGE);
  assert.equal(card.kind, 'question');
  assert.ok(card.options.length >= 2 && card.options.includes(card.recommend));
  assert.ok(card.question.includes(MERGE));
});

test('an undo of an undo is an undo like any other', async () => {
  const s = standIns({ history: [REVERT, MERGE] });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: REVERT, approval: CLICK, defaultBranch: 'main', kept: null, ...s.hooks });
  assert.equal(got.ok, true);
  assert.deepEqual(s.calls.find((c) => c[0] === 'revert')[1].merge, REVERT);
  assert.notEqual(undoBranch(REVERT, 'f'.repeat(40)), undoBranch(MERGE, REVERT), 'its branch is its own');
});

test('an undo still open is carried on, never made twice, and a refusal by the gate is passed on', async () => {
  const kept = { merge: MERGE, pr: 12, head: REVERT, branch: undoBranch(MERGE, REVERT) };
  const s = standIns({ kept, through: { ok: false, refused: 'CI has not passed on bbbbbbb' }, approvalOnRecord: true });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: null, defaultBranch: 'main', kept, ...s.hooks });
  assert.deepEqual(got, { ok: true, pr: 12, merged: false, refused: 'CI has not passed on bbbbbbb' });
  assert.deepEqual(names(s.calls), ['prState', 'approve', 'through']);
});

// --- through the helper, against a real remote ---
const ADDRESS = 'https://github.com/o/p.git';
const PROJECT = 'o__p';

function hostOver(remote, { forge = 'github' } = {}) {
  const prs = new Map();
  const merges = [];
  const opened = [];
  const ref = (n) => (forge === 'gitlab' ? `refs/merge-requests/${n}/head` : `refs/pull/${n}/head`);
  return {
    merges, opened, prs,
    defaultBranch: async () => 'main',
    login: async () => 'ann-oneil',
    requestsOn: async () => null,
    openRequests: async () => [],
    openPr: async ({ head, base, title, body }) => {
      const number = 8 + opened.length;
      const sha = await g(remote.url, 'rev-parse', `refs/heads/${head}`);
      await g(remote.url, 'update-ref', ref(number), sha);
      prs.set(number, { headSha: sha, headRef: head, baseRef: base, state: 'open', mergeable: 'mergeable', body, title });
      opened.push({ number, head, base, title, body });
      return { number, url: `https://example.test/pull/${number}` };
    },
    prState: async (number) => prs.get(number) ?? null,
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async ({ number, sha }) => {
      merges.push({ number, sha });
      await g(remote.url, 'update-ref', 'refs/heads/main', sha);
      prs.set(number, { ...prs.get(number), state: 'merged' });
      return { merged: true };
    },
  };
}

// A remote whose main holds a base commit and then a merge of a feature branch that edits a.txt and adds b.txt.
async function remoteWithMerge() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-work-'));
  await g(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'push', '-q', remote.url, 'main');
  const base = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(work, 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(work, 'b.txt'), 'new\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Add tides');
  await g(work, 'checkout', '-q', 'main');
  await g(work, 'merge', '--no-ff', '-q', 'feature', '-m', 'Merge pull request #1 from o/feature');
  await g(work, 'push', '-q', remote.url, 'main');
  const merge = await g(work, 'rev-parse', 'HEAD');
  return { remote, work, base, merge, cleanup: () => { remote.cleanup(); fs.rmSync(work, { recursive: true, force: true }); } };
}

async function working(fn, { forge = 'github', choice = 'Undo' } = {}) {
  const p = await remoteWithMerge();
  const home = shortHome();
  try {
    await as(home, async () => {
      const gitlab = forge === 'gitlab';
      writeProject(PROJECT, {
        folder: path.join(home, 'work'), remoteUrl: p.remote.url, host: forge, repo: 'o/p',
        connection: gitlab ? { host: 'gitlab', mode: 'as-is', project: 'o/p', baseUrl: 'https://gitlab.example.test' } : { host: 'github', mode: 'quick', project: 'o/p' },
      });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: PROJECT, remoteUrl: p.remote.url });
      assert.equal((await takeLock({ env: LOCAL_PATHS, project: PROJECT, push: plainPush, now: () => new Date('2026-11-08T01:00:00.000Z') })).taken, true);
      const adapter = hostOver(p.remote, { forge });
      const helper = await startHelper({
        run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), mirrorAddress: () => ADDRESS,
        askWindow: async () => ({ choice }),
      });
      try {
        await fn({ client: helperClient({ address: helper.address }), adapter, ...p });
      } finally { await helper.close(); }
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    p.cleanup();
  }
}

const events = (kind) => listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => e.kind === kind);
const cardById = (id) => events('card').find((e) => e.id === id);
const confirm = (client, id) => client.confirm({ project: PROJECT, card: id, hash: dataHash(cardById(id).data) });
const treeOf = (remote, rev) => g(remote.url, 'rev-parse', `${rev}^{tree}`);

for (const forge of ['github', 'gitlab']) {
  test(`through the helper on ${forge}: the director's click undoes a merge by a revert that goes through the gate`, async () => {
    await working(async ({ client, adapter, remote, base, merge }) => {
      const asked = await client.undo({ project: PROJECT, merge });
      assert.equal(asked.needs, 'window', JSON.stringify(asked));
      assert.equal(typeof asked.card, 'string', JSON.stringify(asked));
      assert.deepEqual(adapter.opened, [], 'no click, no pull request');
      // The caller's say makes no click: a request carrying an approval of its own is no different.
      const forged = await client.undo({ project: PROJECT, merge, approval: { id: 'x', kind: 'action' }, approvalRequired: false, click: { id: 'x' }, review: { verdict: 'CLEAN' } });
      assert.equal(forged.needs, 'window');
      assert.deepEqual(adapter.opened, []);
      // Nor can a record of the click be written through the state route.
      const minted = await client.state.write({ project: PROJECT, kind: 'action', data: { action: 'undo-merge', merge, label: 'Undo', question: 'q', proof: 'window' } }).catch((e) => ({ ok: false, error: e.message }));
      assert.notEqual(minted.ok, true);
      assert.equal((await client.undo({ project: PROJECT, merge })).needs, 'window');
      assert.deepEqual(adapter.opened, []);

      const undone = await confirm(client, asked.card);
      assert.equal(undone.undone?.ok, true, JSON.stringify(undone));
      assert.equal(undone.undone.merged, true);
      assert.equal(adapter.merges.length, 1);
      const opened = adapter.opened[0];
      assert.match(opened.head, UNDO_BRANCH);
      assert.equal(await g(remote.url, 'rev-parse', 'refs/heads/main'), adapter.merges[0].sha);
      assert.equal(await treeOf(remote, 'refs/heads/main'), await treeOf(remote, base), 'the files are as they were before the merge');
      assert.equal(await g(remote.url, 'rev-parse', 'refs/heads/main^'), merge, 'a new commit on top: nothing deleted');
      // The approval is the director's click, signed by the helper; a change merged on approval is not one that merged by itself.
      const approval = events('approval').find((e) => e.data.pr === opened.number);
      assert.equal(approval.data.commit, adapter.merges[0].sha);
      assert.equal(approval.data.proof, 'window');
      assert.equal(events('self-merged').length, 0);
      // The click is used up: another undo of the same merge asks again.
      assert.equal((await client.undo({ project: PROJECT, merge })).needs, 'window');
    }, { forge });
  });
}

test('an undo of an undo works', async () => {
  await working(async ({ client, adapter, remote, base, merge }) => {
    const first = await confirm(client, (await client.undo({ project: PROJECT, merge })).card);
    assert.equal(first.undone.ok, true, JSON.stringify(first));
    const afterFirst = await g(remote.url, 'rev-parse', 'refs/heads/main');
    assert.equal(first.undone.merge, afterFirst);
    const again = await client.undo({ project: PROJECT, merge: afterFirst });
    assert.equal(again.needs, 'window', JSON.stringify(again));
    const second = await confirm(client, again.card);
    assert.equal(second.undone.ok, true, JSON.stringify(second));
    assert.equal(adapter.merges.length, 2);
    assert.notEqual(await treeOf(remote, 'refs/heads/main'), await treeOf(remote, base));
    assert.equal(await treeOf(remote, 'refs/heads/main'), await treeOf(remote, merge), 'the merge is back');
  });
});

test('a conflicting revert forces nothing and becomes a decision', async () => {
  await working(async ({ client, adapter, remote, work, merge }) => {
    // Later work touches the same file, so taking the merge out would clash.
    fs.writeFileSync(path.join(work, 'a.txt'), 'three\n');
    await g(work, 'commit', '-q', '-am', 'Later work');
    await g(work, 'push', '-q', remote.url, 'main');
    const main = await g(remote.url, 'rev-parse', 'refs/heads/main');
    const asked = await client.undo({ project: PROJECT, merge });
    const undone = await confirm(client, asked.card);
    assert.equal(undone.undone.ok, false, JSON.stringify(undone));
    assert.equal(undone.undone.reason, 'conflict');
    assert.deepEqual(adapter.opened, []);
    assert.deepEqual(adapter.merges, []);
    assert.equal(await g(remote.url, 'rev-parse', 'refs/heads/main'), main, 'nothing pushed to the default branch');
    assert.equal((await g(remote.url, 'for-each-ref', 'refs/heads/wheelhouse')).trim(), '', 'no branch pushed either');
    const decision = cardById(undone.undone.card);
    assert.equal(decision.data.line.includes(merge), true);
    assert.equal(decision.data.kind, 'question');
  });
});

test('a merge that is not in the main version is refused, and no card is asked for it', async () => {
  await working(async ({ client, adapter }) => {
    const answer = await client.undo({ project: PROJECT, merge: 'd'.repeat(40) });
    assert.equal(answer.ok, false);
    assert.notEqual(answer.needs, 'window', 'no card is asked for a merge that is not there');
    assert.deepEqual(adapter.opened, []);
  });
});
