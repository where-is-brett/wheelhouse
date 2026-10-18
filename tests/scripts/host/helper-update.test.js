// tests/scripts/host/helper-update.test.js
// Bringing a branch up to date at the gate, and what carries over (design
// section 12): the helper merges the default branch into the pull request's
// branch in its own mirror and pushes the merge; a signed review of an
// earlier commit still counts when the feature's own changes did not move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper, patchIdOf, cleanUpdate } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, g } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const T0 = new Date('2026-10-19T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const BEHIND = 'the branch is not up to date with the default branch';
const short = (sha) => sha.slice(0, 7);

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// A commit of `files` on the branch checked out in `work`, pushed to the same branch on the host.
async function commit(work, files, message) {
  write(work, files);
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '--allow-empty', '-m', message);
  const branch = await g(work, 'rev-parse', '--abbrev-ref', 'HEAD');
  await g(work, 'push', '-q', 'origin', branch);
  return g(work, 'rev-parse', 'HEAD');
}

// The default branch moves on with `files`, as when another pull request merges.
async function mainMoves(work, files, message = 'Another feature merged') {
  await g(work, 'checkout', '-q', 'main');
  const sha = await commit(work, files, message);
  await g(work, 'checkout', '-q', 'feature');
  return sha;
}

// A host whose main holds `base`, and pull request 7 from the branch `feature`, which adds `change`.
async function remoteWithPr({ base = { 'README.md': 'r\n' }, change }) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = tempFolder('wh-work-');
  await g(work, 'init', '-q', '-b', 'main');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await commit(work, base, 'Base');
  await g(work, 'checkout', '-q', '-b', 'feature');
  const head = await commit(work, change, 'The feature');
  return { remote, work, head };
}

// The host's view of pull request 7: as GitHub does, its head ref follows the branch.
async function hostHead(remote) {
  const head = await g(remote.url, 'rev-parse', 'refs/heads/feature');
  await g(remote.url, 'update-ref', 'refs/pull/7/head', head);
  return head;
}

function fakeAdapter(remote) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: await hostHead(remote), headRef: 'feature', baseRef: 'main', mergeable: 'yes', state: 'open' }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
  };
}

async function project(remote) {
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder: path.join(home, 'work'), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await cloneState({ project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ project: 'o__p', push: plainPush, now: at(0) })).taken, true);
  });
  return home;
}

let tick = 0;
function record(kind, data) {
  tick += 1;
  const event = makeEvent({ kind, data, now: at(1000 * tick) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
const reviewed = (commitSha, verdict = 'CLEAN') => record('review', { pr: 7, commit: commitSha, verdict });
const approved = (commitSha) => record('approval', { pr: 7, commit: commitSha });

// One helper for the home, with the adapter for the host, and `options` for startHelper.
async function withHelper(home, adapter, fn, options = {}) {
  return as(home, async () => {
    const helper = await startHelper({ address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), ...options });
    try {
      return await fn(helperClient({ address: helper.address }));
    } finally { await helper.close(); }
  });
}

const merge = (client, extra = {}) => client.merge({ project: 'o__p', number: 7, stop: false, bypass: false, ...extra });
const update = (client) => client.updateBranch({ project: 'o__p', number: 7 });
const carried = (client) => client.carried({ project: 'o__p', number: 7 });
const NONE_FOUND = { guardrailPaths: [], criticalAreas: [] };

test('update-branch merges the default branch in and pushes the merge commit', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { 'app.js': 'feature\n' } });
  try {
    // A CI file arriving from the default branch is not the branch's own change: no click is needed.
    const main = await mainMoves(pr.work, { 'later.txt': 'later\n', '.github/workflows/ci.yml': 'on: push\n' });
    const home = await project(pr.remote);
    await withHelper(home, fakeAdapter(pr.remote), async (client) => {
      const answer = await update(client);
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.equal(answer.updated, true);
      assert.match(answer.head, /^[0-9a-f]{40}$/);
      assert.equal(await g(pr.remote.url, 'rev-parse', 'refs/heads/feature'), answer.head);
      assert.equal(await g(pr.remote.url, 'rev-parse', `${answer.head}^@`), `${pr.head}\n${main}`);
      assert.equal(await g(pr.remote.url, 'show', `${answer.head}:app.js`), 'feature');
      assert.equal(await g(pr.remote.url, 'show', `${answer.head}:later.txt`), 'later');
      assert.equal(await g(pr.remote.url, 'log', '-1', '--format=%an', answer.head), 'Wheelhouse');

      // Up to date already: nothing is pushed.
      assert.deepEqual(await update(client), { ok: true, updated: false, head: answer.head });

      // Under STOP nothing is pushed.
      await mainMoves(pr.work, { 'third.txt': 'x\n' });
      setStop({ by: 'prompt' });
      assert.deepEqual(await update(client), { ok: false, refused: 'STOP is on' });
      assert.equal(await g(pr.remote.url, 'rev-parse', 'refs/heads/feature'), answer.head);
    });
  } finally { pr.remote.cleanup(); }
});

test('update-branch on a conflicting branch refuses, naming the files', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n', 'b.js': 'b\n' }, change: { 'app.js': 'feature\n', 'b.js': 'B\n' } });
  try {
    await mainMoves(pr.work, { 'app.js': 'other\n' });
    const home = await project(pr.remote);
    await withHelper(home, fakeAdapter(pr.remote), async (client) => {
      assert.deepEqual(await update(client), { ok: false, refused: 'the branch conflicts with the default branch', conflicts: ['app.js'] });
      assert.equal(await g(pr.remote.url, 'rev-parse', 'refs/heads/feature'), pr.head);
    });
  } finally { pr.remote.cleanup(); }
});

test('A merges while B is ready: B is brought up to date and its review carries over', async () => {
  // Scenario 29: B's head has a signed CLEAN review; A's merge moves the default branch.
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    const adapter = fakeAdapter(pr.remote);
    await as(home, () => reviewed(pr.head));
    await mainMoves(pr.work, { 'a.js': 'a\n' }, 'Merge A');
    await withHelper(home, adapter, async (client) => {
      const behind = await merge(client);
      assert.deepEqual([behind.ok, behind.reasons], [false, [BEHIND]]);
      assert.deepEqual(await carried(client), { ok: true, review: 'clean', upToDate: false });

      const updated = await update(client);
      assert.equal(updated.updated, true, JSON.stringify(updated));
      // CI runs on the new head (the stand-in host says it passed); the review of the old head carries over.
      assert.deepEqual(await carried(client), { ok: true, review: 'clean', upToDate: true });
      assert.deepEqual(await merge(client), { ok: true, merged: true, sha: updated.head, ...NONE_FOUND });
      assert.deepEqual(adapter.merges, [{ number: 7, sha: updated.head }]);

      // /pr/carried only reads, so STOP lets it through.
      setStop({ by: 'prompt' });
      assert.deepEqual(await carried(client), { ok: true, review: 'clean', upToDate: true });
    });
  } finally { pr.remote.cleanup(); }
});

test('a review does not carry over when the feature\'s own changes moved', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    await as(home, () => reviewed(pr.head));
    // A commit of the feature's own after the review, then the default branch moves on.
    await commit(pr.work, { 'b.js': 'b changed\n' }, 'More of the feature');
    await mainMoves(pr.work, { 'a.js': 'a\n' });
    const adapter = fakeAdapter(pr.remote);
    await withHelper(home, adapter, async (client) => {
      const updated = await update(client);
      assert.equal(updated.updated, true, JSON.stringify(updated));
      const answer = await merge(client);
      assert.deepEqual([answer.ok, answer.reasons], [false, [`no CLEAN review of ${short(updated.head)}`]]);
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: true });
      assert.deepEqual(adapter.merges, []);
    });

    // An empty commit leaves the patch-id alone, but it is not a clean update merge either.
    const second = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { 'b.js': 'b\n' } });
    try {
      const other = await project(second.remote);
      await as(other, () => reviewed(second.head));
      const empty = await commit(second.work, {}, 'Nothing');
      await withHelper(other, fakeAdapter(second.remote), async (client) => {
        const answer = await merge(client);
        assert.deepEqual(answer.reasons, [`no CLEAN review of ${short(empty)}`]);
      });
    } finally { second.remote.cleanup(); }
  } finally { pr.remote.cleanup(); }
});

// A file of three identical blocks. The feature adds a line after the first; moved after the
// second, the line has the same context, so only its line numbers differ, which patch-id ignores.
const BLOCK = 'one\ntwo\nthree\nfour\n';
const BLOCKS = { 'blocks.txt': BLOCK.repeat(3) };
const ADDED = { 'blocks.txt': `${BLOCK}added\n${BLOCK}${BLOCK}` };
const MOVED = { 'blocks.txt': `${BLOCK}${BLOCK}added\n${BLOCK}` };
const gitIn = (dir) => (args, options = {}) => run('git', args, { cwd: dir, ...options });

test('a review does not carry over when the update merge changed code itself', async () => {
  // Review Focus 4. The update merge's resolution moves the feature's line, so the feature's
  // patch-id is unchanged, but the merge's tree is not the automatic merge's.
  const pr = await remoteWithPr({ base: BLOCKS, change: ADDED });
  try {
    const home = await project(pr.remote);
    await as(home, () => reviewed(pr.head));
    await mainMoves(pr.work, { 'later.txt': 'later\n' });
    await g(pr.work, 'merge', '-q', '--no-ff', '--no-edit', 'main');
    write(pr.work, MOVED);
    await g(pr.work, 'commit', '-q', '-a', '--amend', '--no-edit');
    await g(pr.work, 'push', '-q', 'origin', 'feature');
    const head = await g(pr.work, 'rev-parse', 'HEAD');

    // The control: the patch-ids match, and the merge is not a clean update.
    const git = gitIn(pr.work);
    assert.equal(await patchIdOf({ git, base: 'main', head }), await patchIdOf({ git, base: 'main', head: pr.head }));
    assert.notEqual(await patchIdOf({ git, base: 'main', head }), '');
    assert.equal(await cleanUpdate({ git, commit: head }), false);
    await g(pr.work, 'checkout', '-q', '-b', 'auto', pr.head);
    await g(pr.work, 'merge', '-q', '--no-ff', '--no-edit', 'main');
    const auto = await g(pr.work, 'rev-parse', 'HEAD');
    assert.equal(await cleanUpdate({ git, commit: auto }), true);
    assert.equal(await cleanUpdate({ git, commit: auto, first: pr.head, base: 'main' }), true);
    assert.equal(await cleanUpdate({ git, commit: pr.head }), false, 'a commit with one parent is no update');

    const adapter = fakeAdapter(pr.remote);
    await withHelper(home, adapter, async (client) => {
      const answer = await merge(client);
      assert.deepEqual([answer.ok, answer.reasons], [false, [`no CLEAN review of ${short(head)}`]]);
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: true });
      assert.deepEqual(adapter.merges, []);
    });
  } finally { pr.remote.cleanup(); }

  // The same change of the feature's own, made on a side branch and merged in: the merge is
  // clean, and the patch-id unchanged, but its second parent is not from the default branch.
  const side = await remoteWithPr({ base: BLOCKS, change: ADDED });
  try {
    const home = await project(side.remote);
    await as(home, () => reviewed(side.head));
    await g(side.work, 'checkout', '-q', '-b', 'side');
    await commit(side.work, MOVED, 'Move the line');
    await g(side.work, 'checkout', '-q', 'feature');
    await g(side.work, 'merge', '-q', '--no-ff', '--no-edit', 'side');
    await g(side.work, 'push', '-q', 'origin', 'feature');
    const merged = await g(side.work, 'rev-parse', 'HEAD');
    await mainMoves(side.work, { 'later.txt': 'later\n' });

    const git = gitIn(side.work);
    assert.equal(await patchIdOf({ git, base: 'main', head: merged }), await patchIdOf({ git, base: 'main', head: side.head }));
    assert.equal(await cleanUpdate({ git, commit: merged }), true, 'clean as a merge');
    assert.equal(await cleanUpdate({ git, commit: merged, first: side.head }), true);
    assert.equal(await cleanUpdate({ git, commit: merged, first: side.head, base: 'main' }), false, 'but not an update from the default branch');

    const adapter = fakeAdapter(side.remote);
    await withHelper(home, adapter, async (client) => {
      const updated = await update(client);
      assert.equal(updated.updated, true, JSON.stringify(updated));
      const answer = await merge(client);
      assert.deepEqual([answer.ok, answer.reasons], [false, [`no CLEAN review of ${short(updated.head)}`]]);
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: true });
      assert.deepEqual(adapter.merges, []);
    });
  } finally { side.remote.cleanup(); }
});

test('a review does not carry over when the feature\'s only change since is whitespace', async () => {
  // Ruling R111: patch-ids are taken verbatim, since indentation can be code.
  const pr = await remoteWithPr({ base: { 'app.py': 'x = 1\n' }, change: { 'run.py': 'if ready:\n    start()\n' } });
  try {
    const home = await project(pr.remote);
    await as(home, () => reviewed(pr.head));
    const head = await commit(pr.work, { 'run.py': 'if ready:\nstart()\n' }, 'Indentation only');
    const git = gitIn(pr.work);
    assert.notEqual(await patchIdOf({ git, base: 'main', head }), await patchIdOf({ git, base: 'main', head: pr.head }));

    const adapter = fakeAdapter(pr.remote);
    await withHelper(home, adapter, async (client) => {
      const answer = await merge(client);
      assert.deepEqual([answer.ok, answer.reasons], [false, [`no CLEAN review of ${short(head)}`]]);
      assert.deepEqual(adapter.merges, []);
    });
  } finally { pr.remote.cleanup(); }
});

test('with no CLEAN review to weigh, /pr/carried reads nothing from the host', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    const fetches = [];
    const counting = (file, args, options) => {
      if (args.includes('fetch')) fetches.push(args);
      return run(file, args, options);
    };
    const adapter = fakeAdapter(pr.remote);
    await withHelper(home, adapter, async (client) => {
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: false });
      await as(home, () => reviewed(pr.head, 'FINDINGS'));
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: false });
      assert.deepEqual(fetches, []);
      // A CLEAN review to weigh: the mirror is read.
      await as(home, () => reviewed(pr.head));
      assert.deepEqual(await carried(client), { ok: true, review: 'clean', upToDate: true });
      assert.ok(fetches.length > 0);
    }, { run: counting });
  } finally { pr.remote.cleanup(); }
});

test('an approval does not carry over until screenshots can be compared', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    await as(home, () => { reviewed(pr.head); approved(pr.head); });
    await mainMoves(pr.work, { 'a.js': 'a\n' });
    const adapter = fakeAdapter(pr.remote);
    let head;
    await withHelper(home, adapter, async (client) => {
      head = (await update(client)).head;
      // The review carries over; the approval does not, so the director is asked again.
      const answer = await merge(client, { approvalRequired: true });
      assert.deepEqual([answer.ok, answer.reasons], [false, [`no approval of ${short(head)}`]]);
    });
    // Once the front desk can compare the screenshots, and they match, it carries over too.
    const compared = [];
    const screenshotsMatch = async (from, to) => { compared.push([from, to]); return true; };
    await withHelper(home, adapter, async (client) => {
      assert.deepEqual(await merge(client, { approvalRequired: true }), { ok: true, merged: true, sha: head, ...NONE_FOUND });
    }, { screenshotsMatch });
    assert.deepEqual(compared, [[pr.head, head]]);
  } finally { pr.remote.cleanup(); }
});

test('a branch behind the default branch cannot merge', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    await as(home, () => reviewed(pr.head));
    const adapter = fakeAdapter(pr.remote);
    await mainMoves(pr.work, { 'a.js': 'a\n' });
    await withHelper(home, adapter, async (client) => {
      const answer = await merge(client);
      assert.equal(answer.ok, false);
      assert.deepEqual(answer.reasons, [BEHIND]);
      assert.deepEqual(adapter.merges, []);
    });
  } finally { pr.remote.cleanup(); }
});
