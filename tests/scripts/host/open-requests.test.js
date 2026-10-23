// tests/scripts/host/open-requests.test.js
// The adapter's reading of a project's open pull and merge requests, with fake `gh` and `glab`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAdapter } from '../../../scripts/host/adapter.js';
import { tempFolder } from '../../helpers/homes.js';

// gh and glab are run from Wheelhouse's tools folder when setup fetched them there
// (scripts/lib/host-tools.js); these tests name the bare tools, so they run with an empty one.
process.env.WHEELHOUSE_HOME = tempFolder('wh-host-tools-');

const REPO = 'a-director/product';
const HEAD_A = '46322a2e182ab8e1bcace1b058b1818f5c93f61f';
const HEAD_B = '3f6c1a9e2b7d4c8f0a5e1b9d6c2f7a4e8b0d3c5f';

// A fake run: records each call and answers from a queue of { code, stdout, stderr }.
function adapter(host, ...answers) {
  const calls = [];
  const run = async (file, args, options = {}) => {
    calls.push({ file, args, input: options.input });
    const answer = answers.shift() ?? {};
    return { code: answer.code ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' };
  };
  return { a: makeAdapter({ host, repo: REPO, run, env: {} }), calls };
}
const say = (value) => ({ stdout: typeof value === 'string' ? value : JSON.stringify(value) });

test('GitHub open requests: listed by number, with the fork and draft flags', async () => {
  const { a, calls } = adapter('github', say([
    { number: 9, title: 'Second', body: null, headRefName: 'two', headRefOid: HEAD_B, isDraft: true, isCrossRepository: true },
    { number: 4, title: 'First', body: 'Words', headRefName: 'one', headRefOid: HEAD_A, isDraft: false, isCrossRepository: false },
  ]));
  assert.deepEqual(await a.openRequests(), [
    { number: 4, title: 'First', body: 'Words', branch: 'one', head: HEAD_A, draft: false, fork: false },
    { number: 9, title: 'Second', body: '', branch: 'two', head: HEAD_B, draft: true, fork: true },
  ]);
  assert.equal(calls[0].file, 'gh');
  assert.deepEqual(calls[0].args, ['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'number,title,body,headRefName,headRefOid,isDraft,isCrossRepository', '--limit', '100']);
});

test('GitHub open requests: none, a non-JSON answer and a bad head', async () => {
  assert.deepEqual(await adapter('github', say([])).a.openRequests(), []);
  await assert.rejects(adapter('github', say('not json')).a.openRequests(), /gh pr list did not answer in JSON/);
  await assert.rejects(adapter('github', say([{ number: 1, title: 't', body: '', headRefName: 'b', headRefOid: 'abc', isDraft: false, isCrossRepository: false }])).a.openRequests(), /head/);
  await assert.rejects(adapter('github', say({})).a.openRequests(), /did not list the open pull requests/);
});

test('GitHub request details: files and commit subjects, oldest first, at most 50', async () => {
  const commits = Array.from({ length: 60 }, (_, i) => ({ oid: 'x', messageHeadline: `Step ${i}`, messageBody: 'body' }));
  const { a, calls } = adapter('github', say({ files: [{ path: 'a.js', additions: 3, deletions: 1, extra: 1 }], commits }));
  const details = await a.requestDetails(4);
  assert.deepEqual(details.files, [{ path: 'a.js', additions: 3, deletions: 1 }]);
  assert.equal(details.commits.length, 50);
  assert.equal(details.commits[0], 'Step 0');
  assert.deepEqual(calls[0].args, ['pr', 'view', '4', '--repo', REPO, '--json', 'files,commits']);
  await assert.rejects(a.requestDetails(0), /whole number/);
  await assert.rejects(adapter('github', say('nope')).a.requestDetails(4), /gh pr view did not answer in JSON/);
});

test('GitLab open requests: listed by number, a fork told by its source project', async () => {
  const { a, calls } = adapter('gitlab', say([
    { iid: 9, title: 'Second', description: null, source_branch: 'two', sha: HEAD_B, draft: true, source_project_id: 7, target_project_id: 5 },
    { iid: 4, title: 'First', description: 'Words', source_branch: 'one', sha: HEAD_A, draft: false, source_project_id: 5, target_project_id: 5 },
  ]));
  assert.deepEqual(await a.openRequests(), [
    { number: 4, title: 'First', body: 'Words', branch: 'one', head: HEAD_A, draft: false, fork: false },
    { number: 9, title: 'Second', body: '', branch: 'two', head: HEAD_B, draft: true, fork: true },
  ]);
  assert.equal(calls[0].file, 'glab');
  assert.deepEqual(calls[0].args, ['mr', 'list', '-R', REPO, '--per-page', '100', '--output', 'json']);
  await assert.rejects(adapter('gitlab', say('not json')).a.openRequests(), /glab mr list did not answer in JSON/);
  await assert.rejects(adapter('gitlab', say([{ iid: 1, title: 't', source_branch: 'b', sha: 'zz', source_project_id: 1, target_project_id: 1 }])).a.openRequests(), /head/);
});

test('GitLab request details: lines counted from each diff, commits oldest first', async () => {
  const diff = '@@ -1,3 +1,4 @@\n keep\n-old\n+new\n+newer\n+++ not a header in a hunk\n';
  const { a, calls } = adapter('gitlab',
    say({ changes: [{ new_path: 'src/a.js', diff }, { new_path: 'b.md', diff: '' }] }),
    say([{ title: 'Newest' }, { title: 'Oldest' }]));
  assert.deepEqual(await a.requestDetails(4), {
    files: [{ path: 'src/a.js', additions: 3, deletions: 1 }, { path: 'b.md', additions: 0, deletions: 0 }],
    commits: ['Oldest', 'Newest'],
  });
  assert.deepEqual(calls[0].args, ['api', 'projects/a-director%2Fproduct/merge_requests/4/changes']);
  assert.deepEqual(calls[1].args, ['api', 'projects/a-director%2Fproduct/merge_requests/4/commits?per_page=50']);
});

test('The pull ref is the host\'s own name for a request\'s head', () => {
  assert.equal(adapter('github').a.pullRef(12), 'refs/pull/12/head');
  assert.equal(adapter('gitlab').a.pullRef(12), 'refs/merge-requests/12/head');
  assert.throws(() => adapter('github').a.pullRef(1.5), /whole number/);
});
