// tests/probes/haiku-trial/github-snapshot.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureGithub, snapshotGh, rebuildGithub, protectionBody, NumberDrift, CAPTURED } from '../../../probes/haiku-trial/github-snapshot.js';

const R = 'repos/{owner}/{repo}';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-ghsnap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A small repository: three merged pull requests (#1, #2, #3), one open (#4), an issue #6, and two commits on main since the seed.
function fakeRepo({ protection = { required_status_checks: {} } } = {}) {
  const pull = (number, extra = {}) => ({ number, state: 'closed', title: `Piece ${number}`, body: `body ${number}`, draft: false, head: { ref: `feature-p${number}`, sha: `h${number}` }, base: { ref: 'main' }, merged_at: '2026-11-08T10:00:00Z', merge_commit_sha: `m${number}`, ...extra });
  const pulls = [pull(1), pull(2), pull(3), pull(4, { state: 'open', merged_at: null, merge_commit_sha: null, draft: true })];
  const served = new Map([
    [`${R}/pulls?state=all&per_page=100`, pulls],
    [`${R}/compare/seed...main`, { commits: [{ sha: 'm1' }, { sha: 'm2' }] }],
    [`${R}/actions/runs?per_page=100`, { workflow_runs: [{ id: 9, head_sha: 'm1' }] }],
    [`${R}/branches?per_page=100`, [{ name: 'main' }, { name: 'feature-p4' }]],
    [R, { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, allow_auto_merge: true, delete_branch_on_merge: true, default_branch: 'main', stars: 3 }],
    [`${R}/rulesets`, [{ id: 11, name: 'main' }]],
    [`${R}/rulesets/11`, { id: 11, name: 'main', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }] }],
    [`${R}/issues?state=all&per_page=1&sort=created&direction=desc`, [{ number: 6 }]],
  ]);
  for (const p of pulls) {
    served.set(`${R}/pulls/${p.number}`, p);
    served.set(`${R}/pulls/${p.number}/files?per_page=100`, [{ filename: `src/p${p.number}.js` }]);
    served.set(`${R}/pulls/${p.number}/commits?per_page=100`, [{ sha: `c${p.number}` }]);
  }
  for (const sha of ['c1', 'c2', 'c3', 'c4', 'm1', 'm2', 'm3', 'h4']) {
    served.set(`${R}/commits/${sha}`, { sha, files: [] });
    served.set(`${R}/commits/${sha}/status`, { state: 'success' });
    served.set(`${R}/commits/${sha}/statuses`, [{ context: 'ci', state: 'success' }]);
  }
  for (const sha of ['m1', 'm2']) served.set(`${R}/commits/${sha}/pulls`, [{ number: 1 }]);
  const asked = [];
  const gh = async (args) => {
    asked.push(args);
    const key = args[1];
    if (key === `${R}/branches/main/protection`) return protection;
    return served.has(key) ? served.get(key) : null;
  };
  const mirrored = [];
  const github = { mirror: async (x) => { mirrored.push(x); } };
  return { gh, github, asked, mirrored, served };
}

const readJson = (dest, name) => JSON.parse(fs.readFileSync(path.join(dest, 'github', name), 'utf8'));

test('capture.json holds every CAPTURED path the fake served', async (t) => {
  const dest = scratch(t);
  const repo = fakeRepo();
  await captureGithub({ gh: repo.gh, github: repo.github, slug: 'o/r', dest, seedSha: 'seed' });
  const capture = readJson(dest, 'capture.json');
  const keys = Object.keys(capture);
  for (const template of CAPTURED) {
    const stem = template.split('{')[0];
    assert.ok(keys.some((k) => k.startsWith(stem)), `a key for ${template}`);
  }
  assert.equal(capture[`${R}/pulls?state=all&per_page=100`].length, 4);
  assert.deepEqual(capture[`${R}/pulls/2/commits?per_page=100`], [{ sha: 'c2' }]);
  assert.equal(capture[`${R}/commits/c3/statuses`][0].context, 'ci');
  assert.equal(capture[`${R}/commits/m1/status`].state, 'success');
  assert.deepEqual(capture[`${R}/commits/m2/pulls`], [{ number: 1 }]);
  assert.equal(capture[`${R}/actions/runs?per_page=100`].workflow_runs.length, 1);
  assert.equal(capture[`${R}/commits/h1`], undefined, 'a path the fake did not serve is left out');
  assert.deepEqual(repo.mirrored, [{ slug: 'o/r', dir: path.join(dest, 'github', 'mirror.git') }]);
});

test('maxNumber counts issues as well as pull requests', async (t) => {
  const dest = scratch(t);
  const repo = fakeRepo();
  const got = await captureGithub({ gh: repo.gh, github: repo.github, slug: 'o/r', dest, seedSha: 'seed' });
  assert.equal(got.maxNumber, 6);
  const quiet = fakeRepo();
  quiet.served.set(`${R}/issues?state=all&per_page=1&sort=created&direction=desc`, [{ number: 2 }]);
  assert.equal((await captureGithub({ gh: quiet.gh, github: quiet.github, slug: 'o/r', dest: scratch(t), seedSha: 'seed' })).maxNumber, 4);
});

test('a 404 for protection is stored as null', async (t) => {
  const dest = scratch(t);
  const repo = fakeRepo({ protection: null });
  await captureGithub({ gh: repo.gh, github: repo.github, slug: 'o/r', dest, seedSha: 'seed' });
  const settings = readJson(dest, 'settings.json');
  assert.equal(settings.protection, null);
  assert.deepEqual(settings.repo, { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, allow_auto_merge: true, delete_branch_on_merge: true, default_branch: 'main' });
  assert.deepEqual(settings.rulesets, [{ id: 11, name: 'main', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }] }]);
});

test('open.json holds only open pull requests with head, base, title, body and draft', async (t) => {
  const dest = scratch(t);
  const repo = fakeRepo();
  await captureGithub({ gh: repo.gh, github: repo.github, slug: 'o/r', dest, seedSha: 'seed' });
  assert.deepEqual(readJson(dest, 'open.json'), [{ number: 4, head: 'feature-p4', base: 'main', title: 'Piece 4', body: 'body 4', draft: true }]);
});

test('a list longer than a page is followed to its end', async (t) => {
  const dest = scratch(t);
  const repo = fakeRepo();
  const many = Array.from({ length: 100 }, (_, i) => ({ number: i + 10, state: 'closed', head: { ref: 'x' }, base: { ref: 'main' } }));
  repo.served.set(`${R}/pulls?state=all&per_page=100`, many);
  repo.served.set(`${R}/pulls?state=all&per_page=100&page=2`, [{ number: 200, state: 'closed', head: { ref: 'y' }, base: { ref: 'main' } }]);
  const got = await captureGithub({ gh: repo.gh, github: repo.github, slug: 'o/r', dest, seedSha: 'seed' });
  assert.equal(readJson(dest, 'capture.json')[`${R}/pulls?state=all&per_page=100`].length, 101);
  assert.equal(got.maxNumber, 200);
});

// --- snapshotGh ---

const PULLS = `${R}/pulls?state=all&per_page=100`;
const merged = (number, extra = {}) => ({ number, state: 'closed', merged_at: '2026-11-08T10:00:00Z', head: { ref: `feature-p${number}` }, title: `Piece ${number}`, ...extra });

// A live repository that holds only what was made after the snapshot, and records what it is asked.
function liveRepo(answers) {
  const asked = [];
  return { asked, gh: async (args) => { asked.push(args); const got = answers[args[1]]; return typeof got === 'function' ? got(args) : got ?? null; } };
}

test('the pulls list joins captured and new pull requests', async () => {
  const capture = { [PULLS]: [merged(3), merged(2), merged(1)] };
  const live = liveRepo({ [PULLS]: [merged(7, { state: 'open', merged_at: null }), merged(5), merged(4)] });
  const gh = snapshotGh(live.gh, { capture, maxNumber: 3, reopened: [] });
  assert.deepEqual((await gh(['api', PULLS])).map((p) => p.number), [7, 5, 4, 3, 2, 1]);
});

test('a reopened pull request is read live', async () => {
  const capture = { [PULLS]: [merged(3), merged(2), merged(1)], [`${R}/pulls/2/commits?per_page=100`]: [{ sha: 'old' }], [`${R}/pulls/1/commits?per_page=100`]: [{ sha: 'c1' }] };
  const live = liveRepo({ [PULLS]: [merged(2, { state: 'open', merged_at: null, title: 'live two' })], [`${R}/pulls/2/commits?per_page=100`]: [{ sha: 'fresh' }] });
  const gh = snapshotGh(live.gh, { capture, maxNumber: 3, reopened: [2] });
  const list = await gh(['api', PULLS]);
  assert.deepEqual(list.map((p) => p.number), [3, 2, 1]);
  assert.equal(list.find((p) => p.number === 2).title, 'live two');
  assert.deepEqual(await gh(['api', `${R}/pulls/2/commits?per_page=100`]), [{ sha: 'fresh' }]);
  assert.deepEqual(await gh(['api', `${R}/pulls/1/commits?per_page=100`]), [{ sha: 'c1' }]);
});

test("a captured commit's statuses come from the capture", async () => {
  const capture = { [`${R}/commits/c1/statuses`]: [{ context: 'ci', state: 'success' }] };
  const live = liveRepo({});
  const gh = snapshotGh(live.gh, { capture, maxNumber: 3 });
  assert.deepEqual(await gh(['api', `${R}/commits/c1/statuses`]), [{ context: 'ci', state: 'success' }]);
  assert.equal(live.asked.length, 0);
  await gh(['api', `${R}/commits/new/statuses`]);
  assert.equal(live.asked.length, 1, 'a commit the capture does not hold is asked live');
});

test('runs join the captured ones with those made after the snapshot', async () => {
  const RUNS = `${R}/actions/runs?per_page=100`;
  const capture = { [RUNS]: { workflow_runs: [{ id: 1, created_at: '2026-11-08T09:00:00Z' }] } };
  const live = liveRepo({ [RUNS]: { workflow_runs: [{ id: 2, created_at: '2026-11-08T11:00:00Z' }, { id: 3, created_at: '2026-11-08T09:30:00Z' }] } });
  const gh = snapshotGh(live.gh, { capture, maxNumber: 3, since: '2026-11-08T10:00:00Z' });
  assert.deepEqual((await gh(['api', RUNS])).workflow_runs.map((r) => r.id), [2, 1]);
});

// The own-tests count reads merged pull requests and the latest CI run through `gh pr list` and `gh run list`, not the API.
const PR_LIST = ['pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '200', '--json', 'number,mergeCommit,files'];
const RUN_LIST = ['run', 'list', '--branch', 'main', '--status', 'completed', '--limit', '1', '--json', 'conclusion'];
const liveAnswers = (answers) => {
  const asked = [];
  return { asked, gh: async (args) => { asked.push(args); const got = answers[args.slice(0, 2).join(' ')]; return got === undefined ? null : got; } };
};

test('a merged pull request list joins the captured merges with the new ones', async () => {
  const capture = {
    [PULLS]: [merged(3), merged(2, { base: { ref: 'main' }, merge_commit_sha: 'm2' }), merged(1, { base: { ref: 'main' }, merge_commit_sha: 'm1' }), merged(9, { merged_at: null, state: 'open' })],
    [`${R}/pulls/1/files?per_page=100`]: [{ filename: 'src/a.js' }, { filename: 'tests/a.test.js' }],
    [`${R}/pulls/2/files?per_page=100`]: [{ filename: 'src/b.js' }],
  };
  capture[PULLS][0] = merged(3, { base: { ref: 'main' }, merge_commit_sha: 'm3' });
  const live = liveAnswers({ 'pr list': [{ number: 5, mergeCommit: { oid: 'm5' }, files: [{ path: 'src/c.js' }] }, { number: 4, mergeCommit: { oid: 'm4' }, files: [] }] });
  const gh = snapshotGh(live.gh, { capture, maxNumber: 3, reopened: [] });
  const got = await gh(PR_LIST);
  assert.deepEqual(got.map((p) => p.number), [5, 4, 3, 2, 1], 'the open pull request is not a merge');
  assert.deepEqual(got.find((p) => p.number === 1), { number: 1, mergeCommit: { oid: 'm1' }, files: [{ path: 'src/a.js' }, { path: 'tests/a.test.js' }] });
  assert.deepEqual(got.find((p) => p.number === 3).files, [], 'a pull request with no captured files has none');
  assert.deepEqual((await gh([...PR_LIST.slice(0, 7), '2', ...PR_LIST.slice(8)])).map((p) => p.number), [5, 4], 'the limit applies to the joined list');
});

test('a reopened pull request that merged is read live and not twice', async () => {
  const capture = { [PULLS]: [merged(2, { base: { ref: 'main' }, merge_commit_sha: 'old' })] };
  const live = liveAnswers({ 'pr list': [{ number: 2, mergeCommit: { oid: 'fresh' }, files: [] }] });
  const gh = snapshotGh(live.gh, { capture, maxNumber: 3, reopened: [2] });
  assert.deepEqual(await gh(PR_LIST), [{ number: 2, mergeCommit: { oid: 'fresh' }, files: [] }]);
});

test('a list the live repository could not read is passed on as it came', async () => {
  const gh = snapshotGh(liveAnswers({}).gh, { capture: { [PULLS]: [merged(1, { base: { ref: 'main' }, merge_commit_sha: 'm1' })] }, maxNumber: 3 });
  assert.equal(await gh(PR_LIST), null);
});

test('the latest completed run on main comes from the live repository, then from the capture', async () => {
  const RUNS = `${R}/actions/runs?per_page=100`;
  const capture = { [RUNS]: { workflow_runs: [
    { id: 3, status: 'completed', conclusion: 'success', head_branch: 'main', created_at: '2026-11-08T09:30:00Z' },
    { id: 2, status: 'completed', conclusion: 'failure', head_branch: 'feature', created_at: '2026-11-08T09:40:00Z' },
    { id: 1, status: 'in_progress', conclusion: null, head_branch: 'main', created_at: '2026-11-08T09:50:00Z' },
  ] } };
  const fresh = snapshotGh(liveAnswers({ 'run list': [{ conclusion: 'failure' }] }).gh, { capture, maxNumber: 3 });
  assert.deepEqual(await fresh(RUN_LIST), [{ conclusion: 'failure' }], 'a run made since is the latest');
  const none = snapshotGh(liveAnswers({ 'run list': [] }).gh, { capture, maxNumber: 3 });
  assert.deepEqual(await none(RUN_LIST), [{ conclusion: 'success' }], 'with none live, the last completed run on main in the capture');
});

test('a pr or run list with other fields or flags goes live as it is', async () => {
  const live = liveAnswers({ 'pr list': [{ number: 8 }], 'run list': [] });
  const gh = snapshotGh(live.gh, { capture: { [PULLS]: [merged(1, { base: { ref: 'main' } })] }, maxNumber: 3 });
  assert.deepEqual(await gh(['pr', 'list', '--state', 'merged', '--json', 'number,title']), [{ number: 8 }]);
  assert.deepEqual(await gh(['pr', 'list', '--state', 'open', '--json', 'number']), [{ number: 8 }]);
  assert.equal(live.asked.length, 2);
});

test('writes always go live', async () => {
  const capture = { [`${R}/pulls/1`]: { number: 1 }, [PULLS]: [merged(1)] };
  const live = liveRepo({});
  const gh = snapshotGh(live.gh, { capture, maxNumber: 3 });
  await gh(['api', `${R}/pulls/1`, '-X', 'PATCH', '-f', 'state=closed']);
  await gh(['pr', 'merge', 'trial/spare-bug', '--squash']);
  await gh(['api', `${R}/pulls/1`, '-H', 'Accept: application/vnd.github.v3.diff']);
  await gh(['pr', 'create', '--head', 'x']);
  assert.equal(live.asked.length, 4);
});

// --- rebuildGithub ---

function fakeGithub({ drift } = {}) {
  const calls = [];
  let next = 0;
  const number = () => { next += 1; return drift?.at === next ? next + 1 : next; };
  return {
    calls,
    create: async (x) => { calls.push(['create', x]); },
    pushMirror: async (x) => { calls.push(['pushMirror', x]); },
    openPull: async (x) => { calls.push(['openPull', x]); return { number: number() }; },
    placeholder: async (x) => { calls.push(['placeholder', x]); return { number: number() }; },
    applySettings: async (x) => { calls.push(['applySettings', x]); },
  };
}
const OPEN = [{ number: 4, head: 'feature-p4', base: 'main', title: 'Piece 4', body: 'body 4', draft: true }];

test('rebuildGithub numbers placeholders and reopened pull requests in order', async (t) => {
  const src = scratch(t);
  fs.writeFileSync(path.join(src, 'settings.json'), JSON.stringify({ repo: { allow_squash_merge: true }, protection: null, rulesets: [] }));
  const github = fakeGithub();
  const slept = [];
  const got = await rebuildGithub({ github, slug: 'o/r', src, maxNumber: 5, open: OPEN, attempt: 2, snapshot: '02-after-w2-audit', sleep: async (ms) => { slept.push(ms); } });
  assert.deepEqual(got, { reopened: [4] });
  assert.deepEqual(github.calls.map((c) => c[0]), ['create', 'pushMirror', 'placeholder', 'placeholder', 'placeholder', 'openPull', 'placeholder', 'applySettings']);
  assert.equal(github.calls[0][1].public, true);
  assert.deepEqual(github.calls[1][1], { dir: path.join(src, 'mirror.git'), remote: 'https://github.com/o/r.git' });
  assert.equal(github.calls[2][1].title, 'Stands for #1 in attempt 2, resumed from 02-after-w2-audit');
  assert.deepEqual(github.calls[5][1], { slug: 'o/r', head: 'feature-p4', base: 'main', title: 'Piece 4', body: 'body 4', draft: true });
  assert.deepEqual(slept, [1000, 1000, 1000, 1000, 1000]);
});

test('a number out of step stops the rebuild', async (t) => {
  const src = scratch(t);
  const github = fakeGithub({ drift: { at: 3 } });
  await assert.rejects(rebuildGithub({ github, slug: 'o/r', src, maxNumber: 5, open: [], attempt: 1, snapshot: '01-x' }), (error) => error instanceof NumberDrift && /number 3 came back as 4: the fresh repository is out of step/.test(error.message));
  assert.equal(github.calls.some((c) => c[0] === 'applySettings'), false);
});

test('settings are applied after the pushes and the numbers', async (t) => {
  const src = scratch(t);
  const settings = { repo: { allow_squash_merge: true }, protection: { enforce_admins: { enabled: true } }, rulesets: [] };
  fs.writeFileSync(path.join(src, 'settings.json'), JSON.stringify(settings));
  const github = fakeGithub();
  await rebuildGithub({ github, slug: 'o/r', src, maxNumber: 2, open: [], attempt: 1, snapshot: '01-x' });
  assert.deepEqual(github.calls.map((c) => c[0]), ['create', 'pushMirror', 'placeholder', 'placeholder', 'applySettings']);
  assert.deepEqual(github.calls.at(-1)[1], { slug: 'o/r', settings });
});

test('protectionBody turns a protection read into the body that sets it', () => {
  assert.equal(protectionBody(null), null);
  const got = protectionBody({ url: 'x', required_status_checks: { url: 'y', strict: true, contexts: ['ci'], checks: [{ context: 'ci' }] }, enforce_admins: { url: 'z', enabled: true }, required_pull_request_reviews: { url: 'q', required_approving_review_count: 0, dismiss_stale_reviews: false }, restrictions: null });
  assert.deepEqual(got, { required_status_checks: { strict: true, contexts: ['ci'] }, enforce_admins: true, required_pull_request_reviews: { required_approving_review_count: 0, dismiss_stale_reviews: false, require_code_owner_reviews: false }, restrictions: null });
});
