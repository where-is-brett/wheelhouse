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
function standIns({ history = [MERGE], revert = { ok: true, commit: REVERT, subject: 'Add tides' }, push = { ok: true }, through = { ok: true, merged: true }, kept = null, approvalOnRecord = false, update = { ok: true, current: true }, requests = [], pr = {}, ci = 'success', out = true } = {}) {
  const calls = [];
  const adapter = (host) => ({
    host,
    openPr: async (x) => { calls.push(['openPr', x]); return { number: 12 }; },
    prState: async (n) => { calls.push(['prState', n]); return { state: 'open', headSha: REVERT, baseRef: 'main', ...pr }; },
    ciState: async (sha) => { calls.push(['ciState', sha]); return { sha, state: ci }; },
    openRequests: async () => { calls.push(['openRequests']); return requests; },
  });
  const git = {
    base: async () => { calls.push(['base']); return { head: calls.some((c) => c[0] === 'through') ? AFTER : 'd'.repeat(40), history }; },
    revert: async (x) => { calls.push(['revert', x]); return revert; },
    update: async (x) => { calls.push(['update', x]); return update; },
    isOut: async (x) => { calls.push(['isOut', x]); return out; },
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
    // A pending record of the revert is kept before anything is pushed, so a crash after the push leaves no stray pull request.
    assert.deepEqual(names(s.calls), ['base', 'revert', 'keep', 'push', 'openPr', 'keep', 'approve', 'through', 'base']);
    const branch = undoBranch(MERGE, REVERT);
    assert.match(branch, UNDO_BRANCH);
    assert.deepEqual(s.calls.find((c) => c[0] === 'push')[1], { branch, commit: REVERT });
    const opened = s.calls.find((c) => c[0] === 'openPr')[1];
    assert.deepEqual([opened.head, opened.base], [branch, 'main']);
    assert.deepEqual(s.calls.filter((c) => c[0] === 'keep').map((c) => c[1]), [{ merge: MERGE, pr: 0, head: REVERT, branch }, { merge: MERGE, pr: 12, head: REVERT, branch }]);
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
  assert.deepEqual(names(s.calls), ['prState', 'base', 'update', 'approve', 'through']);
});

test('a crash after the push and before the pull request was kept leaves no stray pull request', async () => {
  const branch = undoBranch(MERGE, REVERT);
  const pending = { merge: MERGE, pr: 0, head: REVERT, branch };
  const s = standIns({ kept: pending, approvalOnRecord: true, requests: [{ number: 12, branch, head: REVERT, fork: false }] });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: null, defaultBranch: 'main', kept: pending, ...s.hooks });
  assert.equal(got.ok, true);
  assert.equal(got.pr, 12);
  assert.equal(names(s.calls).includes('revert'), false);
  assert.equal(names(s.calls).includes('openPr'), false);
  assert.deepEqual(s.calls.find((c) => c[0] === 'keep')[1], { ...pending, pr: 12 });
  // A request on that branch with other contents, or from a fork, is not the helper's revert.
  for (const other of [{ number: 13, branch, head: 'e'.repeat(40), fork: false }, { number: 14, branch, head: REVERT, fork: true }]) {
    const t = standIns({ kept: pending, requests: [other] });
    await undoOnHost({ adapter: t.adapter('github'), git: t.git, merge: MERGE, approval: CLICK, defaultBranch: 'main', kept: pending, ...t.hooks });
    assert.equal(names(t.calls).includes('revert'), true, 'a new revert is made');
    assert.equal(t.calls.find((c) => c[0] === 'approve')[1].pr, 12);
  }
});

test('an undo whose pull request is behind the main version is brought up to date on its own branch', async () => {
  const branch = undoBranch(MERGE, REVERT);
  const kept = { merge: MERGE, pr: 12, head: REVERT, branch };
  const NEW = '9'.repeat(40);
  const s = standIns({ kept, approvalOnRecord: true, update: { ok: true, commit: NEW } });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: null, defaultBranch: 'main', kept, ...s.hooks });
  assert.equal(got.ok, true);
  assert.deepEqual(s.calls.find((c) => c[0] === 'update')[1], { head: REVERT, base: 'd'.repeat(40) });
  assert.deepEqual(s.calls.find((c) => c[0] === 'push')[1], { branch, commit: NEW });
  // The new head is kept as pending before the push, so a stop between the two is found again.
  assert.deepEqual(s.calls.filter((c) => c[0] === 'keep').map((c) => c[1]), [{ ...kept, next: NEW }, { merge: MERGE, pr: 12, head: NEW, branch }]);
  assert.ok(names(s.calls).indexOf('keep') < names(s.calls).indexOf('push'));
  assert.deepEqual(s.calls.find((c) => c[0] === 'approve')[1], { pr: 12, head: NEW, approval: null });
  // Later work that clashes with the undo forces nothing: it is a conflict, and nothing is pushed.
  const c = standIns({ kept, approvalOnRecord: true, update: { ok: false, reason: 'conflict' } });
  assert.deepEqual(await undoOnHost({ adapter: c.adapter('github'), git: c.git, merge: MERGE, approval: null, defaultBranch: 'main', kept, ...c.hooks }), { ok: false, reason: 'conflict' });
  assert.equal(names(c.calls).includes('push'), false);
});

test('a stop between the update\'s push and its keep is found again: the host\'s head is the pending one', async () => {
  const branch = undoBranch(MERGE, REVERT);
  const NEW = '9'.repeat(40);
  const kept = { merge: MERGE, pr: 12, head: REVERT, branch, next: NEW };
  const s = standIns({ kept, approvalOnRecord: true, pr: { headSha: NEW } });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: null, defaultBranch: 'main', kept, ...s.hooks });
  assert.equal(got.ok, true);
  assert.deepEqual(names(s.calls), ['prState', 'keep', 'base', 'update', 'approve', 'through', 'base']);
  assert.deepEqual(s.calls.find((c) => c[0] === 'keep')[1], { merge: MERGE, pr: 12, head: NEW, branch });
  assert.equal(s.calls.find((c) => c[0] === 'approve')[1].head, NEW);
});

test('a pull request adopted after a stop must target the default branch', async () => {
  const branch = undoBranch(MERGE, REVERT);
  const pending = { merge: MERGE, pr: 0, head: REVERT, branch };
  const s = standIns({ kept: pending, requests: [{ number: 12, branch, head: REVERT, fork: false }], pr: { baseRef: 'release' } });
  await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: CLICK, defaultBranch: 'main', kept: pending, ...s.hooks });
  assert.equal(names(s.calls).includes('revert'), true, 'it is not the helper\'s: a new revert is made');
});

test('an undo is not brought up to date while its checks for the current head are pending', async () => {
  const branch = undoBranch(MERGE, REVERT);
  const kept = { merge: MERGE, pr: 12, head: REVERT, branch };
  const s = standIns({ kept, approvalOnRecord: true, update: { ok: true, commit: '9'.repeat(40) }, ci: 'pending' });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: null, defaultBranch: 'main', kept, ...s.hooks });
  assert.equal(got.ok, true);
  assert.equal(names(s.calls).includes('push'), false);
  assert.equal(s.calls.find((c) => c[0] === 'approve')[1].head, REVERT);
  assert.deepEqual(s.calls.find((c) => c[0] === 'ciState')[1], REVERT);
});

test('a merge whose undo already merged is already undone: no new revert, no new card', async () => {
  const kept = { merge: MERGE, pr: 12, head: REVERT, branch: undoBranch(MERGE, REVERT) };
  const s = standIns({ kept, pr: { state: 'merged' } });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: null, defaultBranch: 'main', kept, ...s.hooks });
  assert.deepEqual(got, { ok: false, reason: 'already-undone' });
  assert.deepEqual(names(s.calls), ['prState', 'base', 'isOut']);
  assert.deepEqual(s.calls.find((c) => c[0] === 'isOut')[1], { merge: MERGE, head: 'd'.repeat(40) });
});

test('a merge whose undo merged but was itself undone is not already undone: a call with no click asks', async () => {
  const kept = { merge: MERGE, pr: 12, head: REVERT, branch: undoBranch(MERGE, REVERT) };
  const s = standIns({ kept, pr: { state: 'merged' }, out: false });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: null, defaultBranch: 'main', kept, ...s.hooks });
  assert.deepEqual(got, { ok: false, reason: 'needs-approval' });
  assert.equal(names(s.calls).includes('revert'), false);
});

test('a git too old to make the revert is said plainly, not read as a conflict', async () => {
  const s = standIns({ revert: { ok: false, reason: 'old-git', refused: 'Undo needs git 2.40 or later; this computer has 2.39.0' } });
  const got = await undoOnHost({ adapter: s.adapter('github'), git: s.git, merge: MERGE, approval: CLICK, defaultBranch: 'main', kept: null, ...s.hooks });
  assert.deepEqual(got, { ok: false, reason: 'old-git', refused: 'Undo needs git 2.40 or later; this computer has 2.39.0' });
  assert.deepEqual(names(s.calls), ['base', 'revert']);
});

// --- through the helper, against a real remote ---
const ADDRESS = 'https://github.com/o/p.git';
const PROJECT = 'o__p';

function hostOver(remote, { forge = 'github' } = {}) {
  const prs = new Map();
  const merges = [];
  const opened = [];
  const ref = (n) => (forge === 'gitlab' ? `refs/merge-requests/${n}/head` : `refs/pull/${n}/head`);
  const host = {
    merges, opened, prs,
    ci: 'success',
    // A promise the next pull request to open waits for, and whether one is waiting.
    hold: null,
    opening: false,
    defaultBranch: async () => 'main',
    login: async () => 'ann-oneil',
    requestsOn: async () => null,
    openRequests: async () => [...prs].filter(([, p]) => p.state === 'open').map(([number, p]) => ({ number, branch: p.headRef, head: p.headSha, fork: false })),
    openPr: async ({ head, base, title, body }) => {
      if (host.hold !== null) { host.opening = true; await host.hold; }
      const number = 8 + opened.length;
      const sha = await g(remote.url, 'rev-parse', `refs/heads/${head}`);
      await g(remote.url, 'update-ref', ref(number), sha);
      prs.set(number, { headSha: sha, headRef: head, baseRef: base, state: 'open', mergeable: 'mergeable', body, title });
      opened.push({ number, head, base, title, body });
      return { number, url: `https://example.test/pull/${number}` };
    },
    // A pull request's head follows its branch on the remote, as a host's does.
    prState: async (number) => {
      const p = prs.get(number);
      if (p === undefined) return null;
      if (p.state === 'open') {
        const sha = await g(remote.url, 'rev-parse', `refs/heads/${p.headRef}`);
        if (sha !== p.headSha) { await g(remote.url, 'update-ref', ref(number), sha); prs.set(number, { ...p, headSha: sha }); }
      }
      return prs.get(number);
    },
    ciState: async (sha) => ({ sha, state: host.ci }),
    merge: async ({ number, sha }) => {
      merges.push({ number, sha });
      await g(remote.url, 'update-ref', 'refs/heads/main', sha);
      prs.set(number, { ...prs.get(number), state: 'merged' });
      return { merged: true };
    },
  };
  return host;
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

async function working(fn, { forge = 'github', choice = 'Undo', gitHook = () => undefined } = {}) {
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
      // A test's own answer for a call, if it gives one; every other call goes through the guard.
      const hooked = (file, args, options) => {
        const said = gitHook(file, args, options);
        return said !== undefined ? said : hostGuard(file, args, options);
      };
      const helper = await startHelper({
        run: guardedRun(hooked, { log: hostLog }),
        address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), mirrorAddress: () => ADDRESS,
        askWindow: async () => ({ choice }),
      });
      try {
        await fn({ client: helperClient({ address: helper.address }), helper, adapter, ...p });
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
      // The click is used up, and the merge is already undone: another undo says so and asks nothing.
      const twice = await client.undo({ project: PROJECT, merge });
      assert.equal(twice.reason, 'already-undone', JSON.stringify(twice));
      assert.equal(twice.card, undefined);
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

test('one click makes one revert, however many undo calls race on it', async () => {
  await working(async ({ client, adapter, merge }) => {
    const asked = await client.undo({ project: PROJECT, merge });
    let release;
    adapter.hold = new Promise((resolve) => { release = resolve; });
    // The click's own undo reaches the host and waits there; the second call comes in while it waits.
    const clicked = confirm(client, asked.card);
    for (let i = 0; i < 200 && !adapter.opening; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(adapter.opening, true, 'the first undo is waiting at the host');
    const second = client.undo({ project: PROJECT, merge });
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    const [first, again] = await Promise.all([clicked, second]);
    assert.equal(first.undone.ok, true, JSON.stringify(first));
    assert.equal(again.ok === false && again.reason === 'already-undone' && again.card === undefined, true, JSON.stringify(again));
    assert.equal(adapter.opened.length, 1, 'one pull request');
    assert.equal(adapter.merges.length, 1, 'one revert merged');
  });
});

test('an undo waiting on its checks is brought up to date when the main version moves, and merges', async () => {
  await working(async ({ client, helper, adapter, remote, work, base, merge }) => {
    adapter.ci = 'pending';
    const asked = await client.undo({ project: PROJECT, merge });
    const waiting = await confirm(client, asked.card);
    assert.equal(waiting.undone.ok, true, JSON.stringify(waiting));
    assert.equal(waiting.undone.merged, false);
    assert.equal(adapter.merges.length, 0);
    const [number] = [...adapter.prs.keys()];
    const oldHead = adapter.prs.get(number).headSha;
    // Later work lands on main meanwhile, on files the undo does not touch.
    fs.writeFileSync(path.join(work, 'c.txt'), 'later\n');
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'Later work');
    await g(work, 'push', '-q', remote.url, 'main');
    const moved = await g(remote.url, 'rev-parse', 'refs/heads/main');
    adapter.ci = 'success';
    await helper.undo.tick();
    assert.equal(adapter.merges.length, 1, JSON.stringify(adapter.merges));
    assert.notEqual(adapter.merges[0].sha, oldHead, 'the branch was updated');
    assert.equal(await g(remote.url, 'rev-parse', `${adapter.merges[0].sha}^@`).then((x) => x.split('\n').includes(moved)), true, 'it holds the moved main version');
    assert.equal(await g(remote.url, 'show', 'refs/heads/main:c.txt'), 'later');
    assert.equal(await g(remote.url, 'show', 'refs/heads/main:a.txt'), 'one', 'the merge is out');
    assert.equal(base.length, 40);
  });
});

test('a git older than 2.40 is said plainly, and a failing merge-tree is not read as a conflict', async () => {
  let mode = null;
  const hook = (file, args) => {
    if (mode === 'old' && args.includes('--version')) return { code: 0, stdout: 'git version 2.39.0\n', stderr: '' };
    if (mode === 'broken' && args.includes('merge-tree')) return { code: 128, stdout: '', stderr: 'fatal: broken\n' };
    return undefined;
  };
  await working(async ({ client, adapter, merge }) => {
    const asked = await client.undo({ project: PROJECT, merge });
    mode = 'old';
    const old = await confirm(client, asked.card);
    assert.equal(old.undone.ok, false);
    assert.match(old.undone.refused, /Undo needs git 2\.40 or later; this computer has 2\.39\.0/);
    assert.notEqual(old.undone.reason, 'conflict');
    mode = 'broken';
    // The click was not used up by a revert that was never made, so it stands for the next try.
    const broken = await client.undo({ project: PROJECT, merge });
    assert.equal(broken.ok, false);
    assert.notEqual(broken.reason, 'conflict');
    assert.equal(broken.card, undefined, 'no decision for the director');
    assert.deepEqual(adapter.opened, []);
  }, { gitHook: hook });
});

// The helper's own check that a merge is out of the main version, run against a real remote. It is seen through what a call with no
// click answers for a merge whose kept undo already merged: "already undone" only while the merge is out.
test('a merge is called already undone only while its change is out of the main version', async () => {
  const { engineDirOf } = await import('../../../scripts/engine/routes.js');
  await working(async ({ client, adapter, remote, work, merge }) => {
    const out = async () => (await client.undo({ project: PROJECT, merge })).reason === 'already-undone';
    const later = async (name) => {
      await g(work, 'fetch', '-q', remote.url, 'main');
      await g(work, 'reset', '-q', '--hard', 'FETCH_HEAD');
      fs.writeFileSync(path.join(work, name), 'later\n');
      await g(work, 'add', '-A');
      await g(work, 'commit', '-q', '-m', `Add ${name}`);
      await g(work, 'push', '-q', remote.url, 'main');
    };
    // A kept undo that merged, though nothing was taken out: the merge is in.
    const branch = `wheelhouse/undo-${merge.slice(0, 12)}-${'b'.repeat(12)}`;
    fs.mkdirSync(engineDirOf(stateDir(PROJECT)), { recursive: true });
    fs.writeFileSync(path.join(engineDirOf(stateDir(PROJECT)), 'undos.json'), `${JSON.stringify({ undos: [{ merge, pr: 99, head: 'b'.repeat(40), branch }] })}\n`);
    adapter.prs.set(99, { headSha: 'b'.repeat(40), headRef: branch, baseRef: 'main', state: 'merged', mergeable: 'mergeable', body: '' });
    assert.equal(await out(), false, 'just merged');
    await later('c.txt');
    assert.equal(await out(), false, 'merged with later work on top');
    // The real undo: the merge is out.
    const asked = await client.undo({ project: PROJECT, merge });
    const undone = await confirm(client, asked.card);
    assert.equal(undone.undone.ok, true, JSON.stringify(undone));
    assert.equal(await out(), true, 'after the revert');
    await later('d.txt');
    assert.equal(await out(), true, 'after the revert and more work');
    // The revert itself undone: the merge is in again.
    const revert = adapter.merges[0].sha;
    const again = await client.undo({ project: PROJECT, merge: revert });
    const restored = await confirm(client, again.card);
    assert.equal(restored.undone.ok, true, JSON.stringify(restored));
    assert.equal(await out(), false, 'after the revert was itself reverted');
  });
});
