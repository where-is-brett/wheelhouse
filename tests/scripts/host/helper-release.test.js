// tests/scripts/host/helper-release.test.js
// A pull request that only moves the project to a pins-only Wheelhouse release needs the signed
// review but not the director's approval; the helper works that out itself, from the changed
// file and from Wheelhouse's repository at the tag, and lowers nothing else.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { projectSettings } from '../../../scripts/protection/settings.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { releaseLine } from '../../../scripts/state/card-lines.js';
import { RELEASE_WHY, briefingLine, releaseBranch, releaseChange, settingsText, undoBranch } from '../../../scripts/lineage/release.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { matchingBody } from '../../helpers/provenance.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const BODY = matchingBody();
const T0 = new Date('2026-10-19T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const SETTINGS = '.claude/settings.json';

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// A stand-in for Wheelhouse's repository: on main, v1.1.0 (pins only, lineage passed) and
// v1.2.0 (a release that changes more); v1.3.0 is pins only but on a side branch, never merged.
async function wheelhouseRepo() {
  const remote = await makeBareRemote({ repo: 'where-is-brett/wheelhouse' });
  const work = tempFolder('wh-wheelhouse-');
  await g(work, 'init', '-q', '-b', 'main');
  const commit = async (files, tag) => {
    write(work, files);
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', tag);
    await g(work, 'tag', tag);
    return g(work, 'rev-parse', 'HEAD');
  };
  const pins = (lineage = 'passed') => `${JSON.stringify({ kind: 'pins-only', lineage })}\n`;
  const shas = {
    'v1.0.0': await commit({ 'README.md': 'Wheelhouse\n', 'lineage/release.json': pins() }, 'v1.0.0'),
    'v1.1.0': await commit({ 'lineage/release.json': pins(), 'lineage/manifest.json': '{"moved":1}\n' }, 'v1.1.0'),
    'v1.2.0': await commit({ 'lineage/release.json': `${JSON.stringify({ kind: 'changes', lineage: 'passed' })}\n` }, 'v1.2.0'),
    'v1.2.1': await commit({ 'lineage/release.json': pins('failed') }, 'v1.2.1'),
  };
  await g(work, 'push', '-q', remote.url, 'main', '--tags');
  await g(work, 'checkout', '-q', '-b', 'side', 'v1.0.0');
  shas['v1.3.0'] = await commit({ 'lineage/release.json': pins(), 'side.txt': 'x\n' }, 'v1.3.0');
  await g(work, 'push', '-q', remote.url, 'v1.3.0');
  return { url: pathToFileURL(remote.url).href, shas, cleanup: remote.cleanup };
}

const config = readConfig(null);
const settingsAt = (ref) => projectSettings(config, { release: { ref } });

// The project's remote: main holds the settings at `baseRef`, and pull request 7 changes `files`.
async function remoteWithPr({ baseRef = 'v1.0.0', files }) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-work-'));
  await g(work, 'init', '-q', '-b', 'main');
  write(work, { 'README.md': 'x\n', [SETTINGS]: settingsText(settingsAt(baseRef)) });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await g(work, 'push', '-q', 'origin', 'main');
  write(work, files);
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Release');
  const head = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'push', '-q', 'origin', `${head}:refs/pull/7/head`);
  return { remote, head, cleanup: () => { remote.cleanup(); fs.rmSync(work, { recursive: true, force: true }); } };
}

function record(kind, data) {
  const event = makeEvent({ kind, data, now: at(1000) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}

// Asks for the merge of pull request 7, on branch `headRef`, after `before()`; resolves with the answer and the merges made.
async function mergeRelease({ pr, headRef, repo, before = () => {}, ci = 'success', body = {} }) {
  const home = shortHome();
  const merges = [];
  try {
    return await as(home, async () => {
      writeProject('o__p', {
        folder: path.join(home, 'work'), remoteUrl: pr.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
      });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: pr.remote.url });
      assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(0) })).taken, true);
      before(pr.head);
      const adapter = {
        defaultBranch: async () => 'main',
        prState: async () => ({ headSha: pr.head, headRef, baseRef: 'main', mergeable: 'mergeable', state: 'open', body: BODY }),
        ciState: async (sha) => ({ sha, state: ci }),
        merge: async (args) => { merges.push(args); return { merged: true }; },
      };
      const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), wheelhouseRepo: repo.url });
      try {
        const answer = await helperClient({ address: helper.address }).merge({ project: 'o__p', number: 7, stop: false, bypass: false, ...body });
        return { answer, merges };
      } finally { await helper.close(); }
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

const reviewed = (head) => record('review', { pr: 7, commit: head, verdict: 'CLEAN' });
const released = (ref) => ({ [SETTINGS]: settingsText(releaseChange(settingsAt('v1.0.0'), { ref, sha: 'f'.repeat(40) })) });

test('a pins-only release PR merges with a review and no approval', async () => {
  const repo = await wheelhouseRepo();
  const headRef = releaseBranch(repo.shas['v1.1.0']);
  // Each try is a new pull request on a new remote, since a try takes the project's lock.
  const tryMerge = async (options) => {
    const pr = await remoteWithPr({ files: released('v1.1.0') });
    try {
      return { ...(await mergeRelease({ pr, headRef, repo, ...options })), head: pr.head, short: pr.head.slice(0, 7) };
    } finally { pr.cleanup(); }
  };
  try {
    const merged = await tryMerge({ before: reviewed });
    assert.deepEqual(merged.answer, {
      ok: true, merged: true, sha: merged.head, guardrailPaths: [SETTINGS], criticalAreas: [],
      release: { kind: 'pins-only', ref: 'v1.1.0', sha: repo.shas['v1.1.0'] }, briefing: briefingLine('v1.1.0'),
    });
    assert.deepEqual(merged.merges, [{ number: 7, sha: merged.head }]);
    // An undo's branch names the earlier release the same way, and is weighed the same (R149).
    const pr = await remoteWithPr({ files: released('v1.1.0') });
    try {
      const undone = await mergeRelease({ pr, headRef: undoBranch(repo.shas['v1.1.0']), repo, before: reviewed });
      assert.equal(undone.answer.ok, true, JSON.stringify(undone.answer));
      assert.deepEqual(undone.answer.release, { kind: 'pins-only', ref: 'v1.1.0', sha: repo.shas['v1.1.0'] });
    } finally { pr.cleanup(); }

    // The exception lowers the approval only: the review, CI and a caller's raised condition still hold.
    const unreviewed = await tryMerge({});
    assert.deepEqual(unreviewed.answer.reasons, [`no CLEAN review of ${unreviewed.short}`]);
    assert.deepEqual(unreviewed.merges, []);
    const failing = await tryMerge({ before: reviewed, ci: 'failure' });
    assert.deepEqual(failing.answer.reasons, [`CI has not passed on ${failing.short}`]);
    const raised = await tryMerge({ before: reviewed, body: { approvalRequired: true } });
    assert.deepEqual(raised.answer.reasons, [`no approval of ${raised.short}`]);
    assert.deepEqual(raised.answer.needs, { approval: { pr: 7, commit: raised.head } });
    assert.deepEqual(raised.merges, []);
  } finally { repo.cleanup(); }
});

test('a release PR changing anything else under .claude/ needs the director\'s approval', async () => {
  const repo = await wheelhouseRepo();
  const sha = repo.shas['v1.1.0'];
  const why = (text) => `release pull request, so it needs the director's approval: ${text}`;
  const more = `it changes more than the Wheelhouse marketplace's ref in ${SETTINGS}`;
  const cases = [
    // Another setting changed beside the ref.
    { files: { [SETTINGS]: settingsText({ ...releaseChange(settingsAt('v1.0.0'), { ref: 'v1.1.0', sha }), autoCompactWindow: 100000 }) }, headRef: releaseBranch(sha), reason: why(more) },
    // The marketplace pointed at another repository.
    { files: { [SETTINGS]: settingsText((() => { const s = settingsAt('v1.1.0'); s.extraKnownMarketplaces.wheelhouse.source.repo = 'someone/else'; return s; })()) }, headRef: releaseBranch(sha), reason: why(more) },
    // Another file under .claude/ beside the release.
    { files: { ...released('v1.1.0'), '.claude/hooks/x.js': 'x\n' }, headRef: releaseBranch(sha), reason: why(more) },
    // The branch names another commit than the tag's.
    { files: released('v1.1.0'), headRef: releaseBranch(repo.shas['v1.0.0']), reason: why(RELEASE_WHY.commit) },
    // A release that changes more than the pins, an undo to one (ruling R140), or one whose lineage job failed.
    { files: released('v1.2.0'), headRef: releaseBranch(repo.shas['v1.2.0']), reason: why(RELEASE_WHY.file) },
    { files: released('v1.2.1'), headRef: releaseBranch(repo.shas['v1.2.1']), reason: why(RELEASE_WHY.file) },
    // A tag that is not on Wheelhouse's default branch.
    { files: released('v1.3.0'), headRef: releaseBranch(repo.shas['v1.3.0']), reason: why(RELEASE_WHY.branch) },
    // A tag Wheelhouse's repository does not have.
    { files: released('v9.9.9'), headRef: releaseBranch(sha), reason: why(RELEASE_WHY.fetch) },
    // The same change on a branch that names no release is an ordinary guardrail change.
    { files: released('v1.1.0'), headRef: 'feature/sign-in', reason: null },
  ];
  try {
    for (const c of cases) {
      const pr = await remoteWithPr({ files: c.files });
      try {
        const { answer, merges } = await mergeRelease({ pr, headRef: c.headRef, repo, before: reviewed });
        const short = pr.head.slice(0, 7);
        assert.equal(answer.ok, false, c.reason);
        // Why the release needs the approval is its own field: the approval is the one reason, so
        // the foreman waits for the director's click (R117, R148).
        assert.deepEqual(answer.reasons, [`no approval of ${short}`]);
        assert.equal(answer.releaseApproval, c.reason ?? undefined);
        assert.deepEqual(answer.needs, { approval: { pr: 7, commit: pr.head } });
        assert.equal(answer.refused, [...(c.reason ? [c.reason] : []), `no approval of ${short}`].join('; '));
        assert.equal(answer.release, undefined);
        assert.deepEqual(merges, []);
      } finally { pr.cleanup(); }
    }
    // Wheelhouse's repository can't be reached: not pins-only, so the approval is needed.
    const pr = await remoteWithPr({ files: released('v1.1.0') });
    try {
      const gone = { url: pathToFileURL(path.join(os.tmpdir(), 'wh-no-such-repo.git')).href };
      const { answer } = await mergeRelease({ pr, headRef: releaseBranch(sha), repo: gone, before: reviewed });
      assert.deepEqual(answer.reasons, [`no approval of ${pr.head.slice(0, 7)}`]);
      assert.equal(answer.releaseApproval, why(RELEASE_WHY.fetch));
    } finally { pr.cleanup(); }
  } finally { repo.cleanup(); }
});

// --- The update's own reviewed change (update design, section 6.2) ---

test('the update opens its change through its own route, which records only that the update opened it', async () => {
  const repo = await wheelhouseRepo();
  const sha = repo.shas['v1.2.0'];
  const pr = await remoteWithPr({ files: released('v1.2.0') });
  const home = shortHome();
  const openedPrs = [];
  try {
    await as(home, async () => {
      writeProject('o__p', {
        folder: path.join(home, 'work'), remoteUrl: pr.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
      });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: pr.remote.url });
      const adapter = { defaultBranch: async () => 'main', openPr: async (args) => { openedPrs.push(args); return { number: 7 }; } };
      const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), wheelhouseRepo: repo.url });
      try {
        const client = helperClient({ address: helper.address });
        const ask = (over) => client.openReleasePr({ project: 'o__p', release: 'v1.2.0', commit: sha, head: releaseBranch(sha), title: 'Move', body: 'Body', ...over });
        // Only the release's or the undo's branch for that very commit.
        assert.equal((await ask({ head: 'feature/sign-in' })).ok, false);
        assert.equal((await ask({ head: releaseBranch(repo.shas['v1.1.0']) })).ok, false);
        assert.equal((await ask({ release: '../x' })).ok, false);
        assert.equal((await ask({ commit: 'abc' })).ok, false);
        assert.deepEqual(openedPrs, []);
        const got = await ask({});
        assert.equal(got.ok, true, JSON.stringify(got));
        assert.deepEqual(openedPrs, [{ head: releaseBranch(sha), base: 'main', title: 'Move', body: 'Body' }]);
        assert.equal((await ask({ head: undoBranch(sha) })).ok, true);
      } finally { await helper.close(); }
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); pr.cleanup(); repo.cleanup(); }
});

const opened = (release, commit, branch = releaseBranch(commit)) => record('provenance', { branch, provenance: { update: { release, commit } } });
const answered = (release, commit) => record('action', { action: 'approve-release', release, commit, label: 'Approve', question: `Words.\n${releaseLine(release, commit)}` });
const headApproved = (head) => record('approval', { pr: 7, commit: head, words: 'Approve', question: 'Approve pull request #7' });

test('the update\'s change: a pins-only release merges on review alone, with no card', async () => {
  const repo = await wheelhouseRepo();
  const sha = repo.shas['v1.1.0'];
  const pr = await remoteWithPr({ files: released('v1.1.0') });
  try {
    const { answer, merges } = await mergeRelease({ pr, headRef: releaseBranch(sha), repo, before: (head) => { opened('v1.1.0', sha); reviewed(head); } });
    assert.equal(answer.ok, true, JSON.stringify(answer));
    assert.deepEqual(merges, [{ number: 7, sha: pr.head }]);
  } finally { pr.cleanup(); repo.cleanup(); }
});

test('the update\'s change: a release that is not pins-only merges only with the signed card answer for that commit', async () => {
  const repo = await wheelhouseRepo();
  const sha = repo.shas['v1.2.0'];
  const other = repo.shas['v1.1.0'];
  const reason = `no approval of release v1.2.0 (${sha.slice(0, 7)}) from the director's card for it`;
  const tryMerge = async ({ setup = () => {}, files = released('v1.2.0'), commit = sha, tag = 'v1.2.0' }) => {
    const pr = await remoteWithPr({ files });
    try {
      return await mergeRelease({ pr, headRef: releaseBranch(commit), repo, before: (head) => { opened(tag, commit); reviewed(head); setup(head); } });
    } finally { pr.cleanup(); }
  };
  try {
    // No card answer: refused, and the foreman is told what would meet it.
    const none = await tryMerge({});
    assert.equal(none.answer.ok, false);
    assert.ok(none.answer.reasons.includes(reason), JSON.stringify(none.answer));
    assert.deepEqual(none.answer.needs, { releaseApproval: { release: 'v1.2.0', commit: sha } });
    assert.deepEqual(none.merges, []);
    // An approval of the pull request's head is not the release's card.
    const head = await tryMerge({ setup: headApproved });
    assert.equal(head.answer.ok, false);
    assert.ok(head.answer.reasons.includes(reason));
    assert.deepEqual(head.merges, []);
    // An answer for another commit, or for another tag at this commit, doesn't count.
    const wrong = await tryMerge({ setup: () => answered('v1.1.0', other) });
    assert.equal(wrong.answer.ok, false);
    assert.deepEqual(wrong.merges, []);
    const tag = await tryMerge({ setup: () => answered('v1.2.1', sha) });
    assert.equal(tag.answer.ok, false);
    // The answer for this release at this commit merges it.
    const merged = await tryMerge({ setup: () => answered('v1.2.0', sha) });
    assert.equal(merged.answer.ok, true, JSON.stringify(merged.answer));
    assert.equal(merged.merges.length, 1);
    // The answer lowers the approval only: a change of more than the ref is refused, and so is a tag that isn't at the commit.
    const more = await tryMerge({ setup: () => answered('v1.2.0', sha), files: { [SETTINGS]: settingsText({ ...releaseChange(settingsAt('v1.0.0'), { ref: 'v1.2.0', sha }), autoCompactWindow: 100000 }) } });
    assert.equal(more.answer.ok, false);
    assert.match(more.answer.refused, /changes more than the Wheelhouse marketplace's ref, to v1\.2\.0/);
    assert.deepEqual(more.merges, []);
    const moved = await tryMerge({ setup: () => answered('v1.2.0', other), files: released('v1.2.0'), commit: other, tag: 'v1.2.0' });
    assert.equal(moved.answer.ok, false);
    assert.deepEqual(moved.merges, []);
  } finally { repo.cleanup(); }
});
