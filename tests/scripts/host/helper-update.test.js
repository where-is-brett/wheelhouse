// tests/scripts/host/helper-update.test.js
// Bringing a branch up to date at the gate, and what carries over (design
// section 12): the helper merges the default branch into the pull request's
// branch in its own mirror and pushes the merge; a signed review of an
// earlier commit still counts when the feature's own changes did not move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper, patchIdOf, cleanUpdate } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { stopsAtPicture } from '../../../scripts/screens/shoot.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { matchingBody } from '../../helpers/provenance.js';
import { until as waitUntil } from '../../helpers/until.js';

// A pull request body stamped with what matches the installed manifest, so the gate's provenance condition passes.
const BODY = matchingBody();

const T0 = new Date('2026-10-19T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const BEHIND = 'the branch is not up to date with the default branch';
const short = (sha) => sha.slice(0, 7);
// The pull request's branch, named as the foreman names a feature's.
const BRANCH = 'feature/tweak';

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
  await g(work, 'checkout', '-q', BRANCH);
  return sha;
}

// A host whose main holds `base`, and pull request 7 from the branch `feature`, which adds `change`.
async function remoteWithPr({ base = { 'README.md': 'r\n' }, change }) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = tempFolder('wh-work-');
  await g(work, 'init', '-q', '-b', 'main');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await commit(work, base, 'Base');
  await g(work, 'checkout', '-q', '-b', BRANCH);
  const head = await commit(work, change, 'The feature');
  return { remote, work, head };
}

// The host's view of pull request 7: as GitHub does, its head ref follows the branch.
async function hostHead(remote) {
  const head = await g(remote.url, 'rev-parse', `refs/heads/${BRANCH}`);
  await g(remote.url, 'update-ref', 'refs/pull/7/head', head);
  return head;
}

// `over` changes what the host says of the pull request.
function fakeAdapter(remote, over = {}) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: await hostHead(remote), headRef: BRANCH, baseRef: 'main', mergeable: 'yes', state: 'open', body: BODY, ...over }),
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
    await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(0) })).taken, true);
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
      assert.equal(await g(pr.remote.url, 'rev-parse', `refs/heads/${BRANCH}`), answer.head);
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
      assert.equal(await g(pr.remote.url, 'rev-parse', `refs/heads/${BRANCH}`), answer.head);
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
      assert.equal(await g(pr.remote.url, 'rev-parse', `refs/heads/${BRANCH}`), pr.head);
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
      // The review names the head itself, so there is no earlier one.
      assert.deepEqual(await carried(client), { ok: true, review: 'clean', upToDate: false, earlier: false });

      const updated = await update(client);
      assert.equal(updated.updated, true, JSON.stringify(updated));
      // CI runs on the new head (the stand-in host says it passed); the review of the old head carries over.
      assert.deepEqual(await carried(client), { ok: true, review: 'clean', upToDate: true, earlier: true });
      assert.deepEqual(await merge(client), { ok: true, merged: true, sha: updated.head, ...NONE_FOUND });
      assert.deepEqual(adapter.merges, [{ number: 7, sha: updated.head }]);

      // /pr/carried only reads, so STOP lets it through.
      setStop({ by: 'prompt' });
      assert.deepEqual(await carried(client), { ok: true, review: 'clean', upToDate: true, earlier: true });
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
      // An earlier commit's CLEAN review is on record, so the watcher can ask for a review of the head (R119).
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: true, earlier: true });
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
    await g(pr.work, 'push', '-q', 'origin', BRANCH);
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
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: true, earlier: true });
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
    await g(side.work, 'checkout', '-q', BRANCH);
    await g(side.work, 'merge', '-q', '--no-ff', '--no-edit', 'side');
    await g(side.work, 'push', '-q', 'origin', BRANCH);
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
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: true, earlier: true });
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
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: false, earlier: false });
      await as(home, () => reviewed(pr.head, 'FINDINGS'));
      assert.deepEqual(await carried(client), { ok: true, review: 'none', upToDate: false, earlier: false });
      assert.deepEqual(fetches, []);
      // A CLEAN review to weigh: the mirror is read.
      await as(home, () => reviewed(pr.head));
      assert.deepEqual(await carried(client), { ok: true, review: 'clean', upToDate: true, earlier: false });
      assert.ok(fetches.length > 0);
    }, { run: counting });
  } finally { pr.remote.cleanup(); }
});

test('a mirror that can\'t say whether the branch is up to date says so, not that it is behind', async () => {
  // M5: a filter named in the mirror's configuration is refused by the look, so the fact is not read.
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    await as(home, () => reviewed(pr.head));
    const adapter = fakeAdapter(pr.remote);
    await withHelper(home, adapter, async (client) => {
      // Reading what carries makes the mirror.
      assert.equal((await carried(client)).upToDate, true);
      await g(path.join(stateDir('o__p'), '..', 'mirror.git'), 'config', 'filter.x.clean', 'cat');
      const answer = await merge(client);
      // The look at the mirror refuses every read of it, so the changed files can't be read either.
      assert.equal(answer.ok, false);
      assert.deepEqual(answer.reasons, [
        `no approval of ${pr.head.slice(0, 7)}`,
        'whether the branch is up to date could not be checked',
        'the changed files couldn\'t be read, so this needs the director\'s approval',
      ]);
      assert.deepEqual(adapter.merges, []);
    });
  } finally { pr.remote.cleanup(); }
});

test('update-branch brings up to date only a feature branch of this repository, against the default branch', async () => {
  // M2. The default branch has moved, so each would otherwise be merged and pushed.
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { 'b.js': 'b\n' } });
  try {
    await mainMoves(pr.work, { 'a.js': 'a\n' });
    const home = await project(pr.remote);
    const refusedWith = async (adapter, refused) => withHelper(home, adapter, async (client) => {
      assert.deepEqual(await update(client), { ok: false, refused });
      assert.equal(await g(pr.remote.url, 'rev-parse', `refs/heads/${BRANCH}`), pr.head);
    });
    await refusedWith(fakeAdapter(pr.remote, { baseRef: 'release' }), 'only a pull request against the default branch is brought up to date');
    await refusedWith(fakeAdapter(pr.remote, { baseRef: undefined }), 'only a pull request against the default branch is brought up to date');
    for (const headRef of ['tweak', 'fix/tweak', 'feature/Tweak', 'feature/tweak/a/b']) {
      await refusedWith(fakeAdapter(pr.remote, { headRef }), 'only a pull request from a feature/<work> branch is brought up to date');
    }

    // A fork's pull request: its head is not this repository's branch of the same name.
    await g(pr.work, 'checkout', '-q', '--detach', pr.head);
    write(pr.work, { 'fork.js': 'fork\n' });
    await g(pr.work, 'add', '-A');
    await g(pr.work, 'commit', '-q', '-m', 'From a fork');
    const forkHead = await g(pr.work, 'rev-parse', 'HEAD');
    await g(pr.work, 'push', '-q', 'origin', `${forkHead}:refs/pull/7/head`);
    await g(pr.work, 'checkout', '-q', BRANCH);
    const fork = { ...fakeAdapter(pr.remote), prState: async () => ({ headSha: forkHead, headRef: BRANCH, baseRef: 'main', mergeable: 'yes', state: 'open', body: BODY }) };
    await refusedWith(fork, 'the pull request\'s head is not this repository\'s branch of that name, so it is not brought up to date: it may come from a fork');
  } finally { pr.remote.cleanup(); }
});

test('a branch that changes a CI file is brought up to date with the director\'s click on that exact merge (R118)', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n' }, change: { '.github/workflows/ci.yml': 'on: push\n', 'b.js': 'b\n' } });
  try {
    const main = await mainMoves(pr.work, { 'a.js': 'a\n' });
    const home = await project(pr.remote);
    // The helper's clock follows the records, so the click is a fresh one.
    const clock = () => new Date(T0.getTime() + 1000 * tick + 5000);
    const pending = () => JSON.parse(fs.readFileSync(path.join(stateDir('o__p'), '..', 'ci-pending.json'), 'utf8'));
    let sha;
    await withHelper(home, fakeAdapter(pr.remote), async (client) => {
      const refused = await update(client);
      assert.equal(refused.ok, false, JSON.stringify(refused));
      assert.equal(refused.refused, 'the branch changes a CI file, so it needs the director\'s click on its card');
      assert.deepEqual(Object.keys(refused.ciPush).sort(), ['branch', 'sha']);
      assert.equal(refused.ciPush.branch, BRANCH);
      sha = refused.ciPush.sha;
      assert.match(sha, /^[0-9a-f]{40}$/);
      // The card can be shown: the pending entry names that commit.
      await as(home, () => assert.equal(pending()[BRANCH].sha, sha));
      assert.equal(await g(pr.remote.url, 'rev-parse', `refs/heads/${BRANCH}`), pr.head);

      // Built again, the merge commit is the same commit, dated by its later parent.
      assert.deepEqual(await update(client), refused);
      assert.equal(await g(pr.remote.url, 'rev-parse', `refs/heads/${BRANCH}`), pr.head);

      // The director clicks the card for that commit; the next update pushes it.
      await as(home, () => record('action', { action: 'ci-push', branch: BRANCH, sha, question: 'the card as shown', label: 'Push it' }));
      assert.deepEqual(await update(client), { ok: true, updated: true, head: sha });
    }, { now: clock });
    assert.equal(await g(pr.remote.url, 'rev-parse', `refs/heads/${BRANCH}`), sha);
    assert.equal(await g(pr.remote.url, 'rev-parse', `${sha}^@`), `${pr.head}\n${main}`);
    const dates = await g(pr.remote.url, 'log', '-1', '--format=%at %ct %an %cn', sha);
    const later = Math.max(...(await g(pr.remote.url, 'log', '--no-walk', '--format=%ct', pr.head, main)).split('\n').map(Number));
    assert.equal(dates, `${later} ${later} Wheelhouse Wheelhouse`);
  } finally { pr.remote.cleanup(); }
});

// --- an approval across an update: the screenshots (front desk plan, Task 12) ---

// The project's configuration on the default branch, listing `pages` (none when left out).
const configWith = (pages) => ({
  '.claude/wheelhouse.json': `${JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], ...(pages === undefined ? {} : { pages }) })}\n`,
});
const PAGES = ['/', '/pricing'];
const BROWSER = '/fake/Google Chrome';
const previewOf = (sha) => `https://preview-${short(sha)}.example.app/`;
const screensDir = () => path.join(stateDir('o__p'), '..', 'screens');
// The hashes kept for a commit, and the address they came from.
const savedFor = (sha) => {
  try { return JSON.parse(fs.readFileSync(path.join(screensDir(), `${sha}.json`), 'utf8')); } catch { return null; }
};
const keptFor = (sha) => savedFor(sha)?.shots ?? null;
const SIZES = ['1280x800', '390x844'];
const DAY_MS = 24 * 60 * 60 * 1000;

// The adapter with each commit's preview at an address of its own, as hosts give one per
// deployment, unless `previews` names another (null for none). Each commit asked is listed.
function previewing(adapter, previews = {}) {
  const asked = [];
  adapter.previewUrl = async (sha) => { asked.push(sha); return Object.hasOwn(previews, sha) ? previews[sha] : previewOf(sha); };
  adapter.previewsAsked = asked;
  return adapter;
}

// A stand-in for scripts/screens/shoot.js: a picture's hash is made from its page, its size and
// what `look(url, size)` says ('same' unless told otherwise), so two commits look the same unless
// `look` tells them apart. No browser runs; every picture asked for is listed.
const hashOf = (pagePath, size, look = 'same') => crypto.createHash('sha256').update(`${pagePath} ${size} ${look}`).digest('hex');
function fakeShoot(look = () => 'same') {
  const shots = [];
  const shoot = async ({ browser, url, size }) => {
    shots.push({ browser, url, size: `${size.width}x${size.height}` });
    return { ok: true, hash: hashOf(new URL(url).pathname, `${size.width}x${size.height}`, look(url, size)) };
  };
  return { shoot, shots };
}
// An address a host gives every commit of the branch: it shows whatever is newest.
const BRANCH_ADDRESS = 'https://product-git-feature-tweak.example.app/';
// The approved commit's pictures of every page at every size, kept from `address` as recording its
// approval keeps them (they look 'same').
function keepPictures(sha, address = previewOf(sha)) {
  const shots = Object.fromEntries(PAGES.flatMap((page) => SIZES.map((size) => [`${page} ${size}`, hashOf(page, size)])));
  fs.mkdirSync(screensDir(), { recursive: true });
  fs.writeFileSync(path.join(screensDir(), `${sha}.json`), `${JSON.stringify({ address, shots })}\n`);
}

const until = (check, what) => waitUntil(check, { what });

// Pull request 7 with a CLEAN review and the director's approval of its first head, brought up
// to date after the default branch moved on. `base` is the default branch's first commit.
async function approvedAndUpdated(base, { approve = true } = {}) {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n', ...base }, change: { 'b.js': 'b\n' } });
  const home = await project(pr.remote);
  await as(home, () => { reviewed(pr.head); if (approve) approved(pr.head); });
  await mainMoves(pr.work, { 'a.js': 'a\n' });
  return { pr, home };
}

test('an approval carries over a clean update when every page looks the same', async () => {
  const { pr, home } = await approvedAndUpdated(configWith(PAGES), { approve: false });
  try {
    const adapter = previewing(fakeAdapter(pr.remote));
    const { shoot, shots } = fakeShoot();
    await withHelper(home, adapter, async (client) => {
      // Recording the approval photographs the approved commit.
      assert.equal((await client.state.record({ project: 'o__p', event: makeEvent({ kind: 'approval', data: { pr: 7, commit: pr.head } }) })).ok, true);
      await until(() => Object.keys(keptFor(pr.head) ?? {}).length === 4, 'the approved commit\'s pictures');
      const { head } = await update(client);
      // The watcher's read never weighs the approval, so it opens no browser.
      assert.equal((await carried(client)).review, 'clean');
      assert.equal(shots.length, 4);

      assert.deepEqual(await merge(client, { approvalRequired: true }), { ok: true, merged: true, sha: head, ...NONE_FOUND });
      // Every page at every size, at both commits, each on its own commit's preview, in the browser
      // given: the approved commit's when its approval was recorded, the head's at the gate.
      assert.equal(shots.length, 8);
      assert.ok(shots.every((s) => s.browser === BROWSER));
      const urls = (sha) => PAGES.map((page) => new URL(page.slice(1), previewOf(sha)).href);
      assert.deepEqual([...new Set(shots.slice(0, 4).map((s) => s.url))].sort(), urls(pr.head).sort());
      assert.deepEqual([...new Set(shots.slice(4).map((s) => s.url))].sort(), urls(head).sort());
      // The pictures' hashes are kept beside the mirror, one file per commit, with the address they came from.
      for (const sha of [pr.head, head]) {
        assert.equal(savedFor(sha).address, previewOf(sha));
        assert.deepEqual(Object.keys(keptFor(sha)).sort(), PAGES.flatMap((page) => SIZES.map((size) => `${page} ${size}`)).sort());
      }
    }, { screens: { shoot, browser: BROWSER } });
  } finally { pr.remote.cleanup(); }
});

test('one page looking different asks the director again', async () => {
  const { pr, home } = await approvedAndUpdated(configWith(PAGES));
  try {
    const previews = {};
    const adapter = previewing(fakeAdapter(pr.remote), previews);
    let head;
    const { shoot, shots } = fakeShoot((url, size) => (url.includes(short(head)) && size.width === 1280 ? 'changed' : 'same'));
    const askedAgain = async (client) => {
      const answer = await merge(client, { approvalRequired: true });
      assert.deepEqual([answer.ok, answer.reasons], [false, [`no approval of ${short(head)}`]]);
    };
    await withHelper(home, adapter, async (client) => {
      ({ head } = await update(client));
      keepPictures(pr.head);
      await askedAgain(client);
      // The first page's first size differs, so nothing more is photographed.
      assert.equal(shots.length, 1);

      // A head with no preview, or a preview at the address the approved commit had (one not
      // its own commit's, such as a branch's), is no comparison either.
      for (const preview of [null, previewOf(pr.head)]) {
        previews[head] = preview;
        await askedAgain(client);
      }
      assert.equal(shots.length, 1);
      assert.deepEqual(adapter.merges, []);
    }, { screens: { shoot, browser: BROWSER } });
  } finally { pr.remote.cleanup(); }
});

test('one address for both commits never carries an approval over, however often the gate asks', async () => {
  const { pr, home } = await approvedAndUpdated(configWith(PAGES));
  try {
    const previews = {};
    const adapter = previewing(fakeAdapter(pr.remote), previews);
    const { shoot, shots } = fakeShoot();
    await withHelper(home, adapter, async (client) => {
      const { head } = await update(client);
      // The host gives the branch's address for both commits, then, once the approved commit's
      // deployment has gone, for the head alone. The foreman asks at every wake.
      for (const old of [BRANCH_ADDRESS, null]) {
        Object.assign(previews, { [pr.head]: old, [head]: BRANCH_ADDRESS });
        for (let attempt = 1; attempt <= 10; attempt += 1) {
          const answer = await merge(client, { approvalRequired: true });
          assert.deepEqual([answer.ok, answer.reasons], [false, [`no approval of ${short(head)}`]], `${old} ${attempt}`);
        }
      }
      // Nothing was photographed, so nothing is kept under the approved commit.
      assert.deepEqual(shots, []);
      assert.equal(savedFor(pr.head), null);
      assert.deepEqual(adapter.merges, []);
    }, { screens: { shoot, browser: BROWSER } });
  } finally { pr.remote.cleanup(); }
});

test('an approval photographed on an address the head is given later never carries over', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n', ...configWith(PAGES) }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    await as(home, () => reviewed(pr.head));
    const previews = { [pr.head]: BRANCH_ADDRESS };
    const adapter = previewing(fakeAdapter(pr.remote), previews);
    const { shoot, shots } = fakeShoot();
    await withHelper(home, adapter, async (client) => {
      assert.equal((await client.state.record({ project: 'o__p', event: makeEvent({ kind: 'approval', data: { pr: 7, commit: pr.head } }) })).ok, true);
      await until(() => Object.keys(keptFor(pr.head) ?? {}).length === 4, 'the approved commit\'s pictures');
      assert.equal(savedFor(pr.head).address, BRANCH_ADDRESS);

      await mainMoves(pr.work, { 'a.js': 'a\n' });
      const { head } = await update(client);
      Object.assign(previews, { [pr.head]: null, [head]: BRANCH_ADDRESS });
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const answer = await merge(client, { approvalRequired: true });
        assert.deepEqual([answer.ok, answer.reasons], [false, [`no approval of ${short(head)}`]]);
      }
      assert.equal(shots.length, 4, 'the head was never photographed');
    }, { screens: { shoot, browser: BROWSER } });
  } finally { pr.remote.cleanup(); }
});

test('a cache file from before addresses were kept is no picture', async () => {
  const { pr, home } = await approvedAndUpdated(configWith(PAGES));
  try {
    const previews = {};
    const adapter = previewing(fakeAdapter(pr.remote), previews);
    const { shoot, shots } = fakeShoot();
    // The hashes the approved commit's pages would have, with the host's deployment of it gone.
    const shots0 = Object.fromEntries(PAGES.flatMap((page) => SIZES.map((size) => [`${page} ${size}`, hashOf(page, size)])));
    previews[pr.head] = null;
    await withHelper(home, adapter, async (client) => {
      const { head } = await update(client);
      fs.mkdirSync(screensDir(), { recursive: true });
      fs.writeFileSync(path.join(screensDir(), `${pr.head}.json`), `${JSON.stringify(shots0)}\n`);
      const answer = await merge(client, { approvalRequired: true });
      assert.deepEqual([answer.ok, answer.reasons], [false, [`no approval of ${short(head)}`]]);
      assert.deepEqual(shots, []);
      // The same hashes, kept with the address they came from, count.
      fs.writeFileSync(path.join(screensDir(), `${pr.head}.json`), `${JSON.stringify({ address: previewOf(pr.head), shots: shots0 })}\n`);
      assert.deepEqual(await merge(client, { approvalRequired: true }), { ok: true, merged: true, sha: head, ...NONE_FOUND });
      assert.equal(shots.length, 4);
    }, { screens: { shoot, browser: BROWSER } });
  } finally { pr.remote.cleanup(); }
});

test('STOP halts photographing between pictures, and the gate compares nothing under it', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n', ...configWith(PAGES) }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    await as(home, () => reviewed(pr.head));
    await mainMoves(pr.work, { 'a.js': 'a\n' });
    const adapter = previewing(fakeAdapter(pr.remote));
    const { shoot: quick, shots } = fakeShoot();
    let started = 0;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const shoot = async (args) => { started += 1; await held; return quick(args); };
    await withHelper(home, adapter, async (client) => {
      const { head } = await update(client);
      assert.equal((await client.state.record({ project: 'o__p', event: makeEvent({ kind: 'approval', data: { pr: 7, commit: pr.head } }) })).ok, true);
      await until(() => started === 1, 'the first picture');
      setStop({ by: 'prompt' });
      release();
      const answer = await merge(client, { approvalRequired: true });
      assert.equal(answer.ok, false);
      assert.ok(answer.reasons.includes('STOP is on') && answer.reasons.includes(`no approval of ${short(head)}`), JSON.stringify(answer));
    }, { screens: { shoot, browser: BROWSER } });
    // Only the picture under way when STOP came was taken: none after it, and none for the gate.
    assert.equal(shots.length, 1);
    await as(home, () => assert.equal(Object.keys(keptFor(pr.head)).length, 1));
  } finally { pr.remote.cleanup(); }
});

test('the gate never photographs the approved commit: with none of its pictures kept, the director is asked again', async () => {
  // The approval was written without the helper, so nothing was photographed when it was recorded.
  const { pr, home } = await approvedAndUpdated(configWith(PAGES));
  try {
    const adapter = previewing(fakeAdapter(pr.remote));
    const { shoot, shots } = fakeShoot();
    await withHelper(home, adapter, async (client) => {
      const { head } = await update(client);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const answer = await merge(client, { approvalRequired: true });
        assert.deepEqual([answer.ok, answer.reasons], [false, [`no approval of ${short(head)}`]]);
      }
      // No picture, and no preview asked for, of either commit.
      assert.deepEqual([shots, adapter.previewsAsked, savedFor(pr.head)], [[], [], null]);
      assert.deepEqual(adapter.merges, []);
    }, { screens: { shoot, browser: BROWSER } });
  } finally { pr.remote.cleanup(); }
});

test('with no approval needed, nothing is compared and no browser is opened', async () => {
  const { pr, home } = await approvedAndUpdated(configWith(PAGES));
  try {
    const adapter = previewing(fakeAdapter(pr.remote));
    const { shoot, shots } = fakeShoot();
    await withHelper(home, adapter, async (client) => {
      const { head } = await update(client);
      keepPictures(pr.head);
      assert.deepEqual(await merge(client), { ok: true, merged: true, sha: head, ...NONE_FOUND });
    }, { screens: { shoot, browser: BROWSER } });
    assert.deepEqual([shots, adapter.previewsAsked], [[], []]);
  } finally { pr.remote.cleanup(); }
});

// A shoot held at its first picture until `release()`, then answering as `fakeShoot` does.
function heldShoot() {
  const { shoot: quick, shots } = fakeShoot();
  const held = {};
  held.started = 0;
  const gate = new Promise((resolve) => { held.release = resolve; });
  held.shoot = async (args) => { held.started += 1; await gate; return quick(args); };
  held.shots = shots;
  return held;
}

// Starts a helper for `home`, runs `fn(client, helper)`, and closes the helper if `fn` did not.
async function withOpenHelper(home, adapter, fn, options) {
  return as(home, async () => {
    const helper = await startHelper({ address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), ...options });
    let closed = false;
    const close = async () => { closed = true; await helper.close(); };
    try {
      return await fn(helperClient({ address: helper.address }), close);
    } finally { if (!closed) await helper.close(); }
  });
}

test('closing the helper stops a comparison after the picture under way, and the director is asked again', async () => {
  const { pr, home } = await approvedAndUpdated(configWith(PAGES));
  try {
    const adapter = previewing(fakeAdapter(pr.remote));
    const held = heldShoot();
    await withOpenHelper(home, adapter, async (client, close) => {
      await update(client);
      keepPictures(pr.head);
      const merging = merge(client, { approvalRequired: true }).catch(() => null);
      await until(() => held.started === 1, 'the head\'s first picture');
      const closing = close();
      held.release();
      await closing;
      await merging;
    }, { screens: { shoot: held.shoot, browser: BROWSER } });
    // Close waited for one picture, not the head's four, and nothing merged.
    assert.equal(held.shots.length, 1);
    assert.deepEqual(adapter.merges, []);
  } finally { pr.remote.cleanup(); }
});

test('closing the helper stops photographing an approved commit after the picture under way', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n', ...configWith(PAGES) }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    await as(home, () => reviewed(pr.head));
    const adapter = previewing(fakeAdapter(pr.remote));
    const held = heldShoot();
    await withOpenHelper(home, adapter, async (client, close) => {
      assert.equal((await client.state.record({ project: 'o__p', event: makeEvent({ kind: 'approval', data: { pr: 7, commit: pr.head } }) })).ok, true);
      await until(() => held.started === 1, 'the first picture');
      const closing = close();
      held.release();
      await closing;
    }, { screens: { shoot: held.shoot, browser: BROWSER } });
    assert.equal(held.shots.length, 1);
    await as(home, () => assert.equal(Object.keys(keptFor(pr.head)).length, 1));
  } finally { pr.remote.cleanup(); }
});

test('the browser is looked for again until Chrome is found, and only Chrome is kept', async () => {
  const { pr, home } = await approvedAndUpdated(configWith(PAGES));
  try {
    const adapter = previewing(fakeAdapter(pr.remote));
    const { shoot: quick, shots } = fakeShoot();
    // As the real shoot does: only Chrome's pictures count.
    const shoot = async (args) => (stopsAtPicture(args.browser) ? quick(args) : { ok: false, why: 'only Chrome\'s pictures are trusted so far' });
    // None at first, then only Edge, then the director installs Chrome.
    const found = [null, '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', BROWSER];
    let looked = 0;
    const findBrowser = () => { looked += 1; return found[Math.min(looked, found.length) - 1]; };
    await withHelper(home, adapter, async (client) => {
      const { head } = await update(client);
      keepPictures(pr.head);
      for (const tries of [1, 2]) {
        const answer = await merge(client, { approvalRequired: true });
        assert.deepEqual([answer.ok, answer.reasons, looked], [false, [`no approval of ${short(head)}`], tries]);
      }
      assert.deepEqual(await merge(client, { approvalRequired: true }), { ok: true, merged: true, sha: head, ...NONE_FOUND });
      assert.equal(looked, 3);
      assert.ok(shots.length > 0 && shots.every((s) => s.browser === BROWSER));
      // Chrome, once found, is kept: recording another approval does not look again.
      assert.equal((await client.state.record({ project: 'o__p', event: makeEvent({ kind: 'approval', data: { pr: 7, commit: head } }) })).ok, true);
    }, { screens: { shoot, findBrowser } });
    assert.equal(looked, 3);
  } finally { pr.remote.cleanup(); }
});

test('a project with no pages listed always asks again', async () => {
  for (const base of [{}, configWith(undefined), configWith([])]) {
    const { pr, home } = await approvedAndUpdated(base);
    try {
      const compared = [];
      const { shoot, shots } = fakeShoot();
      const adapter = previewing(fakeAdapter(pr.remote));
      await withHelper(home, adapter, async (client) => {
        const { head } = await update(client);
        const answer = await merge(client, { approvalRequired: true });
        assert.deepEqual([answer.ok, answer.reasons], [false, [`no approval of ${short(head)}`]], JSON.stringify(base));
        // Nothing to compare: neither the comparison nor a browser is asked, nor any preview.
        assert.equal(fs.existsSync(path.join(stateDir('o__p'), '..', 'screens')), false);
      }, { screens: { shoot, browser: BROWSER } });
      await withHelper(home, adapter, async (client) => {
        assert.equal((await merge(client, { approvalRequired: true })).ok, false);
      }, { screenshotsMatch: async (args) => { compared.push(args); return true; } });
      assert.deepEqual([compared, shots, adapter.previewsAsked], [[], [], []]);
    } finally { pr.remote.cleanup(); }
  }
});

test('the comparison is asked with the project, both commits and the pages, and an error in it asks again', async () => {
  const { pr, home } = await approvedAndUpdated(configWith(PAGES));
  try {
    const adapter = previewing(fakeAdapter(pr.remote));
    let head;
    await withHelper(home, adapter, async (client) => { ({ head } = await update(client)); keepPictures(pr.head); });
    const askedAgain = async (options) => withHelper(home, adapter, async (client) => {
      const answer = await merge(client, { approvalRequired: true });
      assert.deepEqual([answer.ok, answer.reasons], [false, [`no approval of ${short(head)}`]]);
    }, options);
    await askedAgain({ screenshotsMatch: async () => { throw new Error('the comparison failed'); } });
    await askedAgain({ screenshotsMatch: async () => 'yes' });
    await askedAgain({ screens: { shoot: async () => { throw new Error('the browser crashed'); }, browser: BROWSER } });
    await askedAgain({ screens: { shoot: async () => ({ ok: false, why: 'the browser timed out' }), browser: BROWSER } });
    // No browser on this computer: nothing can be photographed.
    await askedAgain({ screens: { shoot: fakeShoot().shoot, browser: null } });
    // The host can't say where the previews are.
    const failing = { ...adapter, previewUrl: async () => { throw new Error('gh api failed'); } };
    await withHelper(home, failing, async (client) => {
      assert.equal((await merge(client, { approvalRequired: true })).ok, false);
    }, { screens: { shoot: fakeShoot().shoot, browser: BROWSER } });
    assert.deepEqual(adapter.merges, []);

    const compared = [];
    await withHelper(home, adapter, async (client) => {
      assert.deepEqual(await merge(client, { approvalRequired: true }), { ok: true, merged: true, sha: head, ...NONE_FOUND });
    }, { screenshotsMatch: async (args) => { compared.push(args); return true; } });
    assert.deepEqual(compared, [{ project: 'o__p', before: pr.head, after: head, pages: PAGES }]);
  } finally { pr.remote.cleanup(); }
});

test('a page list the configuration can\'t hold makes it unreadable: nothing is photographed and the director is asked again', async () => {
  const { pr, home } = await approvedAndUpdated(configWith(['pricing']));
  try {
    const { shoot, shots } = fakeShoot();
    const adapter = previewing(fakeAdapter(pr.remote));
    // update-branch reads the configuration too, and refuses, so the branch is brought up to date by hand.
    await g(pr.work, 'merge', '-q', '--no-ff', '--no-edit', 'main');
    await g(pr.work, 'push', '-q', 'origin', BRANCH);
    const head = await g(pr.work, 'rev-parse', 'HEAD');
    await withHelper(home, adapter, async (client) => {
      const answer = await merge(client, { approvalRequired: true });
      assert.equal(answer.ok, false);
      assert.ok(answer.reasons.includes(`no approval of ${short(head)}`), JSON.stringify(answer));
      assert.ok(answer.reasons.some((r) => /couldn't be read/.test(r)), JSON.stringify(answer));
      assert.equal((await client.state.record({ project: 'o__p', event: makeEvent({ kind: 'approval', data: { pr: 7, commit: head } }) })).ok, true);
    }, { screens: { shoot, browser: BROWSER } });
    assert.deepEqual([shots, adapter.previewsAsked], [[], []]);
  } finally { pr.remote.cleanup(); }
});

test('recording an approval photographs that commit\'s pages without delaying the answer', async () => {
  const pr = await remoteWithPr({ base: { 'app.js': 'one\n', ...configWith(PAGES) }, change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    await as(home, () => reviewed(pr.head));
    const previews = {};
    const adapter = previewing(fakeAdapter(pr.remote), previews);
    const { shoot: quick, shots } = fakeShoot();
    let started = 0;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const shoot = async (args) => { started += 1; await held; return quick(args); };
    let main;
    await withHelper(home, adapter, async (client) => {
      // Pictures not touched for 30 days are cleared out first; newer ones are kept.
      fs.mkdirSync(screensDir(), { recursive: true });
      const [stale, recent] = ['a', 'b'].map((c) => path.join(screensDir(), `${c.repeat(40)}.json`));
      for (const [file, days] of [[stale, 31], [recent, 29]]) {
        fs.writeFileSync(file, '{}\n');
        fs.utimesSync(file, new Date(Date.now() - days * DAY_MS), new Date(Date.now() - days * DAY_MS));
      }

      const answer = await client.state.record({ project: 'o__p', event: makeEvent({ kind: 'approval', data: { pr: 7, commit: pr.head } }) });
      // Answered while the first picture is still being taken.
      assert.equal(answer.ok, true, JSON.stringify(answer));
      await until(() => started === 1, 'the first picture');
      assert.equal(shots.length, 0);
      release();
      await until(() => Object.keys(keptFor(pr.head) ?? {}).length === 4, 'the approved commit\'s pictures');
      assert.deepEqual(shots.map((s) => s.url), PAGES.flatMap((page) => SIZES.map(() => new URL(page.slice(1), previewOf(pr.head)).href)));
      assert.deepEqual([fs.existsSync(stale), fs.existsSync(recent)], [false, true]);

      // The host takes the approved commit's preview down once the branch moves on: its pictures
      // are kept, so only the new head is photographed.
      previews[pr.head] = null;
      main = await mainMoves(pr.work, { 'a.js': 'a\n' });
      const { head } = await update(client);
      assert.deepEqual(await merge(client, { approvalRequired: true }), { ok: true, merged: true, sha: head, ...NONE_FOUND });
      assert.equal(shots.length, 8);
      assert.ok(shots.slice(4).every((s) => s.url.startsWith(previewOf(head))));

      // Under STOP nothing is photographed.
      setStop({ by: 'prompt' });
      await client.state.record({ project: 'o__p', event: makeEvent({ kind: 'approval', data: { pr: 7, commit: main } }) });
    }, { screens: { shoot, browser: BROWSER } });
    // Closing the helper waits for any photographing left.
    assert.equal(shots.length, 8);
    await as(home, () => assert.equal(keptFor(main), null));
  } finally { pr.remote.cleanup(); }
});

test('photographing an approved commit is skipped when the project lists no pages', async () => {
  const pr = await remoteWithPr({ change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    const { shoot, shots } = fakeShoot();
    const adapter = previewing(fakeAdapter(pr.remote));
    await withHelper(home, adapter, async (client) => {
      const answer = await client.state.record({ project: 'o__p', event: makeEvent({ kind: 'approval', data: { pr: 7, commit: pr.head } }) });
      assert.equal(answer.ok, true, JSON.stringify(answer));
    }, { screens: { shoot, browser: BROWSER } });
    assert.deepEqual([shots, adapter.previewsAsked], [[], []]);
    await as(home, () => assert.equal(fs.existsSync(screensDir()), false));
  } finally { pr.remote.cleanup(); }
});

test('/pr/preview gives the head\'s preview, or null', async () => {
  const pr = await remoteWithPr({ change: { 'b.js': 'b\n' } });
  try {
    const home = await project(pr.remote);
    const previews = {};
    await withHelper(home, previewing(fakeAdapter(pr.remote), previews), async (client) => {
      assert.deepEqual(await client.preview({ project: 'o__p', number: 7 }), { ok: true, url: previewOf(pr.head) });
      // From the front desk's folder, which the helper places, and under STOP, since it only reads.
      const folder = path.join(home, 'work');
      fs.mkdirSync(folder, { recursive: true });
      setStop({ by: 'prompt' });
      assert.deepEqual(await client.preview({ cwd: folder, number: 7 }), { ok: true, url: previewOf(pr.head) });
      assert.equal((await client.preview({ cwd: home, number: 7 })).ok, false, 'a folder in no project');
      previews[pr.head] = null;
      assert.deepEqual(await client.preview({ cwd: folder, number: 7 }), { ok: true, url: null });
      for (const number of [0, '7', 1.5]) assert.equal((await client.preview({ project: 'o__p', number })).ok, false);
    });
    // A pull request that isn't open has no preview to show.
    for (const state of ['merged', 'closed', 'unknown']) {
      await withHelper(home, previewing(fakeAdapter(pr.remote, { state })), async (client) => {
        assert.deepEqual(await client.preview({ project: 'o__p', number: 7 }), { ok: true, url: null });
      });
    }
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
