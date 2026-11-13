// tests/probes/haiku-trial/github-snapshot.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureGithub, CAPTURED } from '../../../probes/haiku-trial/github-snapshot.js';

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
    [`${R}/rulesets`, []],
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
  assert.deepEqual(settings.rulesets, []);
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
