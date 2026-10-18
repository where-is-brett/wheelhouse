// tests/scripts/host/adapter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeAdapter, detectHost } from '../../../scripts/host/adapter.js';

const fixture = (host, name) => readFileSync(new URL(`../../fixtures/host/${host}/${name}`, import.meta.url), 'utf8');
const gh = (name) => fixture('github', name);
const gl = (name) => fixture('gitlab', name);

const REPO = 'a-director/product';
const SHA = '46322a2e182ab8e1bcace1b058b1818f5c93f61f';
const GL_SHA = '3f6c1a9e2b7d4c8f0a5e1b9d6c2f7a4e8b0d3c5f';
const ENV = { GH_TOKEN: 'ghs_FAKEKEY0123456789abcdef', GITLAB_TOKEN: 'glpat-FAKEKEY0123456789' };

// A fake run: records each call and answers from a queue of { code, stdout, stderr }.
function fakeRun(...answers) {
  const calls = [];
  const run = async (file, args, options = {}) => {
    calls.push({ file, args, env: options.env, input: options.input });
    const answer = answers.shift() ?? {};
    return { code: answer.code ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' };
  };
  return { run, calls };
}

function adapter(host, ...answers) {
  const { run, calls } = fakeRun(...answers);
  return { a: makeAdapter({ host, repo: REPO, run, env: ENV }), calls };
}

// --- detectHost ---

test('detectHost knows github.com and gitlab.com, over https and ssh', () => {
  assert.equal(detectHost('https://github.com/a-director/product.git'), 'github');
  assert.equal(detectHost('git@github.com:a-director/product.git'), 'github');
  assert.equal(detectHost('ssh://git@github.com/a-director/product.git'), 'github');
  assert.equal(detectHost('https://gitlab.com/group/sub/product.git'), 'gitlab');
  assert.equal(detectHost('git@gitlab.com:group/product.git'), 'gitlab');
  assert.equal(detectHost('https://x-access-token@GitHub.com/a-director/product'), 'github');
});

test('detectHost takes another GitLab address only when the project setting names it', () => {
  assert.equal(detectHost('https://git.example.org/team/product.git', { gitlabHosts: ['git.example.org'] }), 'gitlab');
  assert.equal(detectHost('git@git.example.org:team/product.git', { gitlabHosts: ['git.example.org'] }), 'gitlab');
  assert.throws(() => detectHost('https://git.example.org/team/product.git'), /git\.example\.org/);
  assert.throws(() => detectHost('https://git.example.org/team/product.git', { gitlabHosts: ['other.example.org'] }), /not GitHub or GitLab/);
  assert.throws(() => detectHost('not an address'), /address/);
});

test('makeAdapter refuses an unknown host or a malformed repository', () => {
  const { run } = fakeRun();
  assert.throws(() => makeAdapter({ host: 'bitbucket', repo: REPO, run, env: ENV }), /github or gitlab/);
  assert.throws(() => makeAdapter({ host: 'github', repo: 'product', run, env: ENV }), /owner\/name/);
  assert.throws(() => makeAdapter({ host: 'github', repo: '-x/product', run, env: ENV }), /owner\/name/);
});

// --- GitHub ---

test('GitHub defaultBranch reads defaultBranchRef', async () => {
  const { a, calls } = adapter('github', { stdout: gh('repo-view.json') });
  assert.equal(await a.defaultBranch(), 'main');
  assert.deepEqual(calls[0].file, 'gh');
  assert.deepEqual(calls[0].args, ['repo', 'view', REPO, '--json', 'defaultBranchRef']);
  assert.equal(calls[0].env, ENV);
});

test('GitHub openPr passes the body on standard input and reads the number from the address', async () => {
  const { a, calls } = adapter('github', { stdout: gh('pr-create.txt') });
  const pr = await a.openPr({ head: 'wheelhouse/welcome-page', base: 'main', title: 'Add the welcome page', body: 'Body text' });
  assert.deepEqual(pr, { number: 4, url: 'https://github.com/a-director/product/pull/4' });
  assert.deepEqual(calls[0].args, [
    'pr', 'create', '--repo', REPO, '--head=wheelhouse/welcome-page', '--base=main', '--title=Add the welcome page', '--body-file', '-',
  ]);
  assert.equal(calls[0].input, 'Body text');
});

test('GitHub updatePr changes only what is given', async () => {
  const { a, calls } = adapter('github', { stdout: gh('pr-edit.txt') }, { stdout: gh('pr-edit.txt') });
  assert.deepEqual(await a.updatePr({ number: 4, title: 'New title' }), { number: 4 });
  assert.deepEqual(calls[0].args, ['pr', 'edit', '4', '--repo', REPO, '--title=New title']);
  assert.equal(calls[0].input, undefined);
  await a.updatePr({ number: 4, body: 'New body' });
  assert.deepEqual(calls[1].args, ['pr', 'edit', '4', '--repo', REPO, '--body-file', '-']);
  assert.equal(calls[1].input, 'New body');
});

test('GitHub prState reads the recorded pull request', async () => {
  const { a, calls } = adapter('github', { stdout: gh('pr-view-open.json') });
  assert.deepEqual(await a.prState(3), { headSha: SHA, mergeable: 'yes', state: 'open' });
  assert.deepEqual(calls[0].args, ['pr', 'view', '3', '--repo', REPO, '--json', 'number,url,headRefOid,headRefName,baseRefName,mergeable,state']);
});

test('GitHub prState names the head branch when GitHub does', async () => {
  const text = JSON.stringify({ ...JSON.parse(gh('pr-view-open.json')), headRefName: 'wheelhouse-restore-0123456789ab', baseRefName: 'main' });
  const { a } = adapter('github', { stdout: text });
  assert.deepEqual(await a.prState(3), { headSha: SHA, headRef: 'wheelhouse-restore-0123456789ab', baseRef: 'main', mergeable: 'yes', state: 'open' });
});

test('GitHub prState: CONFLICTING is no, and a merged pull request is merged', async () => {
  const { a } = adapter('github', { stdout: gh('pr-view-conflicting.json') }, { stdout: gh('pr-view-merged.json') });
  assert.equal((await a.prState(3)).mergeable, 'no');
  const merged = await a.prState(2);
  assert.equal(merged.state, 'merged');
  assert.equal(merged.headSha, '08f742cd5db57550dbef50119bf11c20a421723c');
});

test('mergeability unknown is reported as unknown, not yes', async () => {
  const { a } = adapter('github', { stdout: gh('pr-view-merged.json') });
  assert.equal((await a.prState(2)).mergeable, 'unknown');
  const lab = adapter('gitlab', { stdout: gl('mr-view-checking.json') });
  assert.equal((await lab.a.prState(1)).mergeable, 'unknown');
  const odd = adapter('github', { stdout: JSON.stringify({ ...JSON.parse(gh('pr-view-open.json')), mergeable: 'SOMETHING_NEW' }) });
  assert.equal((await odd.a.prState(3)).mergeable, 'unknown');
});

test('GitHub ciState asks for the commit status rollup in one GraphQL call', async () => {
  const { a, calls } = adapter('github', { stdout: gh('ci-success.json') });
  assert.deepEqual(await a.ciState(SHA), { sha: SHA, state: 'success' });
  const args = calls[0].args;
  assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
  assert.ok(args.includes('owner=a-director') && args.includes('name=product') && args.includes(`sha=${SHA}`));
  assert.match(args[args.indexOf('-f') + 1], /^query=.*statusCheckRollup/s);
});

test('GitHub ciState: pending, failure, no checks and an unknown commit', async () => {
  const { a } = adapter('github',
    { stdout: gh('ci-pending.json') }, { stdout: gh('ci-failure.json') },
    { stdout: gh('ci-none.json') }, { stdout: gh('ci-unknown-commit.json') });
  assert.equal((await a.ciState(SHA)).state, 'pending');
  assert.equal((await a.ciState(SHA)).state, 'failure');
  assert.deepEqual(await a.ciState('5f1842f1c07ffb04536a44003dfd9bfa970016c7'), { sha: '5f1842f1c07ffb04536a44003dfd9bfa970016c7', state: 'none' });
  assert.equal((await a.ciState(SHA)).state, 'none');
});

test('merge asks GitHub to match the head commit', async () => {
  const { a, calls } = adapter('github', { stdout: '' }, { stdout: gh('pr-view-merged.json') });
  assert.deepEqual(await a.merge({ number: 3, sha: SHA }), { merged: true });
  assert.deepEqual(calls[0].args, ['pr', 'merge', '3', '--repo', REPO, '--merge', '--match-head-commit', SHA]);
});

test('GitHub merge reports a refusal rather than throwing', async () => {
  const { a } = adapter('github', { code: 1, stderr: gh('merge-refused.txt') });
  const result = await a.merge({ number: 3, sha: SHA });
  assert.equal(result.merged, false);
  assert.match(result.reason, /head .* moved/i);
});

test('GitHub issues: create, update and list by label', async () => {
  const { a, calls } = adapter('github',
    { stdout: gh('issue-create.txt') }, { stdout: gh('issue-edit.txt') }, { stdout: gh('issue-list.json') }, { stdout: gh('issue-list-empty.json') });
  assert.deepEqual(await a.issue.create({ title: 'Wheelhouse checklist', body: 'List', labels: ['wheelhouse', 'state'] }),
    { number: 7, url: 'https://github.com/a-director/product/issues/7' });
  assert.deepEqual(calls[0].args, ['issue', 'create', '--repo', REPO, '--title=Wheelhouse checklist', '--body-file', '-', '--label=wheelhouse', '--label=state']);
  assert.equal(calls[0].input, 'List');

  assert.deepEqual(await a.issue.update({ number: 7, body: 'New list' }), { number: 7 });
  assert.deepEqual(calls[1].args, ['issue', 'edit', '7', '--repo', REPO, '--body-file', '-']);
  assert.equal(calls[1].input, 'New list');

  assert.deepEqual(await a.issue.list({ label: 'wheelhouse' }), [{
    number: 7, title: 'Wheelhouse checklist', body: '- [ ] Add the welcome page\n- [x] Set up the project',
    url: 'https://github.com/a-director/product/issues/7', labels: ['wheelhouse'], state: 'open',
  }]);
  assert.deepEqual(calls[2].args, ['issue', 'list', '--repo', REPO, '--label=wheelhouse', '--state', 'open', '--limit', '100', '--json', 'number,title,body,url,labels,state']);
  assert.deepEqual(await a.issue.list({ label: 'wheelhouse' }), []);
});

// --- GitLab ---

test('GitLab defaultBranch reads default_branch from the project', async () => {
  const { a, calls } = adapter('gitlab', { stdout: gl('project.json') });
  assert.equal(await a.defaultBranch(), 'main');
  assert.equal(calls[0].file, 'glab');
  assert.deepEqual(calls[0].args, ['api', 'projects/a-director%2Fproduct']);
  assert.equal(calls[0].env, ENV);
});

test('GitLab openPr opens a merge request with the description on standard input', async () => {
  const { a, calls } = adapter('gitlab', { stdout: gl('mr-create.txt') });
  const pr = await a.openPr({ head: 'wheelhouse/welcome-page', base: 'main', title: 'Add the welcome page', body: 'Body text' });
  assert.deepEqual(pr, { number: 4, url: 'https://gitlab.com/a-director/product/-/merge_requests/4' });
  assert.deepEqual(calls[0].args, [
    'mr', 'create', '-R', REPO, '--source-branch=wheelhouse/welcome-page', '--target-branch=main', '--title=Add the welcome page',
    '--description-file', '-', '--yes',
  ]);
  assert.equal(calls[0].input, 'Body text');
});

test('GitLab updatePr changes only what is given', async () => {
  const { a, calls } = adapter('gitlab', { stdout: gl('mr-update.txt') }, { stdout: gl('mr-update.txt') });
  assert.deepEqual(await a.updatePr({ number: 4, title: 'New title' }), { number: 4 });
  assert.deepEqual(calls[0].args, ['mr', 'update', '4', '-R', REPO, '--title=New title', '--yes']);
  await a.updatePr({ number: 4, body: 'New body' });
  assert.deepEqual(calls[1].args, ['mr', 'update', '4', '-R', REPO, '--description-file', '-', '--yes']);
  assert.equal(calls[1].input, 'New body');
});

test('GitLab prState reads the recorded merge request', async () => {
  const { a, calls } = adapter('gitlab', { stdout: gl('mr-view-closed.json') });
  assert.deepEqual(await a.prState(1), { headSha: GL_SHA, headRef: 'wheelhouse/welcome-page', baseRef: 'main', mergeable: 'no', state: 'closed' });
  assert.deepEqual(calls[0].args, ['mr', 'view', '1', '-R', REPO, '--output', 'json']);
});

test('GitLab prState maps detailed_merge_status and state', async () => {
  const { a } = adapter('gitlab', { stdout: gl('mr-view-open.json') }, { stdout: gl('mr-view-conflict.json') }, { stdout: gl('mr-view-merged.json') });
  assert.deepEqual(await a.prState(1), { headSha: GL_SHA, headRef: 'wheelhouse/welcome-page', baseRef: 'main', mergeable: 'yes', state: 'open' });
  assert.equal((await a.prState(1)).mergeable, 'no');
  assert.equal((await a.prState(1)).state, 'merged');
});

test('GitLab ciState reads the newest pipeline for the commit', async () => {
  const { a, calls } = adapter('gitlab', { stdout: gl('pipelines.json') }, { stdout: gl('pipelines-none.json') });
  assert.deepEqual(await a.ciState(GL_SHA), { sha: GL_SHA, state: 'pending' });
  assert.deepEqual(calls[0].args, ['api', `projects/a-director%2Fproduct/pipelines?sha=${GL_SHA}&per_page=1&order_by=id&sort=desc`]);
  assert.deepEqual(await a.ciState(GL_SHA), { sha: GL_SHA, state: 'none' });
});

test('GitLab ciState maps each pipeline status', async () => {
  const expected = {
    success: 'success', failed: 'failure', canceled: 'failure', canceling: 'failure', running: 'pending', pending: 'pending',
    created: 'pending', preparing: 'pending', waiting_for_resource: 'pending', scheduled: 'pending', manual: 'pending',
    waiting_for_callback: 'pending', skipped: 'none',
  };
  for (const [status, state] of Object.entries(expected)) {
    const { a } = adapter('gitlab', { stdout: JSON.stringify([{ ...JSON.parse(gl('pipelines.json'))[0], status }]) });
    assert.equal((await a.ciState(GL_SHA)).state, state, status);
  }
});

test('merge on GitLab passes --sha and --auto-merge=false', async () => {
  const { a, calls } = adapter('gitlab', { stdout: '' }, { stdout: gl('mr-view-merged.json') });
  assert.deepEqual(await a.merge({ number: 1, sha: GL_SHA }), { merged: true });
  assert.deepEqual(calls[0].args, ['mr', 'merge', '1', '-R', REPO, '--sha', GL_SHA, '--auto-merge=false', '--yes']);
});

test('GitLab merge reports a refusal rather than throwing', async () => {
  const { a } = adapter('gitlab', { code: 1, stderr: gl('merge-refused.txt') });
  const result = await a.merge({ number: 1, sha: GL_SHA });
  assert.equal(result.merged, false);
  assert.match(result.reason, /head .* moved/i);
});

test('GitLab issues: create, update and list by label', async () => {
  const { a, calls } = adapter('gitlab',
    { stdout: gl('issue-create.txt') }, { stdout: gl('issue-update.txt') }, { stdout: gl('issue-list.json') }, { stdout: gl('issue-list-empty.json') });
  assert.deepEqual(await a.issue.create({ title: 'Wheelhouse checklist', body: 'List', labels: ['wheelhouse'] }),
    { number: 7, url: 'https://gitlab.com/a-director/product/-/issues/7' });
  assert.deepEqual(calls[0].args, ['issue', 'create', '-R', REPO, '--title=Wheelhouse checklist', '--description-file', '-', '--label=wheelhouse', '--yes']);
  assert.equal(calls[0].input, 'List');

  assert.deepEqual(await a.issue.update({ number: 7, body: 'New list' }), { number: 7 });
  assert.deepEqual(calls[1].args, ['issue', 'update', '7', '-R', REPO, '--description-file', '-']);

  assert.deepEqual(await a.issue.list({ label: 'wheelhouse' }), [{
    number: 7, title: 'Wheelhouse checklist', body: '- [ ] Add the welcome page\n- [x] Set up the project',
    url: 'https://gitlab.com/a-director/product/-/issues/7', labels: ['wheelhouse'], state: 'open',
  }]);
  assert.deepEqual(calls[2].args, ['issue', 'list', '-R', REPO, '--label=wheelhouse', '--per-page', '100', '--output', 'json']);
  assert.deepEqual(await a.issue.list({ label: 'wheelhouse' }), []);
});

// --- across both ---

test('a key in the environment never appears in an argument', async () => {
  for (const host of ['github', 'gitlab']) {
    const f = host === 'github' ? gh : gl;
    const { a, calls } = adapter(host,
      { stdout: f(host === 'github' ? 'repo-view.json' : 'project.json') },
      { stdout: f(host === 'github' ? 'pr-create.txt' : 'mr-create.txt') },
      { stdout: f(host === 'github' ? 'pr-edit.txt' : 'mr-update.txt') },
      { stdout: f(host === 'github' ? 'pr-view-open.json' : 'mr-view-open.json') },
      { stdout: f(host === 'github' ? 'ci-success.json' : 'pipelines.json') },
      { stdout: '' },
      { stdout: f(host === 'github' ? 'pr-view-merged.json' : 'mr-view-merged.json') },
      { stdout: f('issue-create.txt') },
      { stdout: f(host === 'github' ? 'issue-edit.txt' : 'issue-update.txt') },
      { stdout: f('issue-list.json') });
    await a.defaultBranch();
    await a.openPr({ head: 'h', base: 'main', title: 't', body: 'b' });
    await a.updatePr({ number: 4, title: 't', body: 'b' });
    await a.prState(4);
    await a.ciState(SHA);
    await a.merge({ number: 4, sha: SHA });
    await a.issue.create({ title: 't', body: 'b', labels: ['x'] });
    await a.issue.update({ number: 7, body: 'b' });
    await a.issue.list({ label: 'x' });
    assert.equal(calls.length, 10);
    for (const call of calls) {
      assert.equal(call.env, ENV, 'every call gets the adapter environment');
      for (const arg of call.args) {
        for (const key of Object.values(ENV)) assert.ok(!arg.includes(key), `${host}: ${call.args.join(' ')}`);
      }
    }
  }
});

test('a failing command throws a plain error naming the command, with keys scrubbed from its output', async () => {
  // Built from fragments, so no committed literal has a real key's shape.
  const labKey = ['glpat', 'abcdefghijklmnopqrst'].join('-');
  const stderr = `HTTP 401: Bad credentials ${ENV.GH_TOKEN} also ${labKey} and Authorization: Bearer abc.def.ghi\n`;
  const { a } = adapter('github', { code: 1, stderr });
  const error = await a.prState(3).catch((e) => e);
  assert.ok(error instanceof Error);
  assert.match(error.message, /gh pr view/);
  assert.match(error.message, /Bad credentials/);
  assert.ok(!error.message.includes(ENV.GH_TOKEN));
  assert.ok(!error.message.includes(labKey));
  assert.ok(!error.message.includes('abc.def.ghi'));
  assert.ok(!error.message.includes('GH_TOKEN'), 'the environment is not named');

  const lab = adapter('gitlab', { code: 1, stderr: '{"error":{"message":"404 Not Found"}}\n' });
  await assert.rejects(lab.a.prState(999), /glab mr view.*404 Not Found/s);
});

test('output that is not what was asked for throws', async () => {
  const { a } = adapter('github', { stdout: 'not json' }, { stdout: 'Created something\n' });
  await assert.rejects(a.prState(3), /gh pr view/);
  await assert.rejects(a.openPr({ head: 'h', base: 'main', title: 't', body: 'b' }), /address/);
});

test('arguments are checked before anything runs', async () => {
  const { a, calls } = adapter('github');
  await assert.rejects(a.prState(0), /number/);
  await assert.rejects(a.prState('3'), /number/);
  await assert.rejects(a.merge({ number: 3, sha: 'abc' }), /commit/);
  await assert.rejects(a.ciState('--help'), /commit/);
  await assert.rejects(a.openPr({ head: '', base: 'main', title: 't', body: '' }), /head/);
  await assert.rejects(a.issue.list({ label: '' }), /label/);
  assert.equal(calls.length, 0);
});

// --- Task 16: unknown is unknown, and refusals say what they are ---

const QUEUE_LINE = "This project's host queues merges; Wheelhouse merges only directly for now";
const openPr = (extra = {}) => JSON.stringify({ ...JSON.parse(gh('pr-view-open.json')), ...extra });
const openMr = () => gl('mr-view-open.json');

test('a merge is read back: merged is merged, whatever the success line says', async () => {
  const titled = adapter('github',
    { stdout: '✓ Merged pull request #3 (Turn on auto-merge for releases)\n' }, { stdout: gh('pr-view-merged.json') });
  assert.deepEqual(await titled.a.merge({ number: 3, sha: SHA }), { merged: true });
  assert.deepEqual(titled.calls[1].args.slice(0, 3), ['pr', 'view', '3']);
  const lab = adapter('gitlab', { stdout: 'Merged !1: Turn on auto-merge for releases\n' }, { stdout: gl('mr-view-merged.json') });
  assert.deepEqual(await lab.a.merge({ number: 1, sha: GL_SHA }), { merged: true });
});

test('a merge queued by the host is not reported as merged, and is taken back out of the queue', async () => {
  const hub = adapter('github', { stdout: 'will be added to the merge queue\n' }, { stdout: openPr() }, { stdout: '' });
  const answer = await hub.a.merge({ number: 3, sha: SHA });
  assert.deepEqual(answer, { merged: false, queued: true, reason: QUEUE_LINE });
  assert.deepEqual(hub.calls[2].args, ['pr', 'merge', '3', '--repo', REPO, '--disable-auto']);

  const lab = adapter('gitlab', { stdout: '' }, { stdout: openMr() }, { stdout: '{}' });
  assert.deepEqual(await lab.a.merge({ number: 1, sha: GL_SHA }), { merged: false, queued: true, reason: QUEUE_LINE });
  assert.deepEqual(lab.calls[2].args, ['api', '--method', 'POST', 'projects/a-director%2Fproduct/merge_requests/1/cancel_merge_when_pipeline_succeeds']);

  // If taking it back fails, that is said too.
  const stuck = adapter('github', { stdout: '' }, { stdout: openPr() }, { code: 1, stderr: 'boom ghu_LEAKED0123456789' });
  const failed = await stuck.a.merge({ number: 3, sha: SHA });
  assert.equal(failed.merged, false);
  assert.equal(failed.queued, true);
  assert.ok(failed.reason.startsWith(QUEUE_LINE));
  assert.match(failed.reason, /could not be taken back out of the queue/);
  assert.doesNotMatch(failed.reason, /boom|LEAKED/);
});

test('a merge that cannot be read back is refused as unknown', async () => {
  for (const reply of [{ stdout: openPr({ state: 'SOMETHING_NEW' }) }, { stdout: 'not json' }, { code: 1, stderr: 'gone' }]) {
    const { a, calls } = adapter('github', { stdout: '' }, reply);
    const answer = await a.merge({ number: 3, sha: SHA });
    assert.equal(answer.merged, false);
    assert.match(answer.reason, /could not confirm/);
    assert.equal(calls.length, 2, 'nothing is cancelled when the state is not known to be open');
  }
});

test('GitLab "CI still running" is unknown, not no', async () => {
  const { a } = adapter('gitlab',
    { stdout: JSON.stringify({ ...JSON.parse(gl('mr-view-open.json')), detailed_merge_status: 'ci_still_running' }) },
    { stdout: JSON.stringify({ ...JSON.parse(gl('mr-view-open.json')), detailed_merge_status: 'ci_must_pass' }) });
  assert.equal((await a.prState(1)).mergeable, 'unknown');
  assert.equal((await a.prState(1)).mergeable, 'no');
});

test('an unknown pull request state is reported as unknown', async () => {
  const hub = adapter('github', { stdout: JSON.stringify({ ...JSON.parse(gh('pr-view-open.json')), state: 'SOMETHING_NEW' }) });
  assert.equal((await hub.a.prState(3)).state, 'unknown');
  const lab = adapter('gitlab', { stdout: JSON.stringify({ ...JSON.parse(gl('mr-view-open.json')), state: 'something_new' }) });
  assert.equal((await lab.a.prState(1)).state, 'unknown');
  const missing = adapter('github', { stdout: JSON.stringify({ number: 3 }) });
  assert.equal((await missing.a.prState(3)).state, 'unknown');
  const closed = adapter('github', { stdout: JSON.stringify({ ...JSON.parse(gh('pr-view-open.json')), state: 'CLOSED' }) });
  assert.equal((await closed.a.prState(3)).state, 'closed');
});

test('a GraphQL answer with errors is not read as no checks', async () => {
  const errors = JSON.stringify({ errors: [{ message: 'Something broke, token ghu_LEAKED' }], data: { repository: null } });
  const { a } = adapter('github', { stdout: errors }, { stdout: JSON.stringify({ errors: [] , data: null }) });
  await assert.rejects(a.ciState(SHA), (error) => { assert.doesNotMatch(error.message, /LEAKED/); return true; });
  await assert.rejects(a.ciState(SHA));
});

test('merged-results pipelines count as the head\'s pipeline', async () => {
  const MERGE_SHA = 'a'.repeat(40);
  const BASE_SHA = 'b'.repeat(40);
  const route = (state) => async (file, args) => {
    const path = args[1] ?? '';
    const reply = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
    if (path.includes('/pipelines?sha=')) return reply([]);
    if (path.endsWith(`/repository/commits/${GL_SHA}/merge_requests`)) return reply([{ iid: 5, state: 'opened' }]);
    if (path.endsWith('/merge_requests/5')) return reply({ iid: 5, head_pipeline: null });
    if (path.includes('/merge_requests/5/pipelines')) return reply([{ id: 9, sha: MERGE_SHA, ref: 'refs/merge-requests/5/merge', status: state }]);
    if (path.endsWith(`/repository/commits/${MERGE_SHA}`)) return reply({ id: MERGE_SHA, parent_ids: [BASE_SHA, GL_SHA] });
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const lab = makeAdapter({ host: 'gitlab', repo: REPO, run: route('success'), env: ENV });
  assert.deepEqual(await lab.ciState(GL_SHA), { sha: GL_SHA, state: 'success' });
  const running = makeAdapter({ host: 'gitlab', repo: REPO, run: route('running'), env: ENV });
  assert.equal((await running.ciState(GL_SHA)).state, 'pending');
  // A merged-results commit that does not have this head as a parent is some other head's.
  const other = makeAdapter({ host: 'gitlab', repo: REPO, env: ENV, run: async (file, args) => (args[1].endsWith(`/repository/commits/${MERGE_SHA}`)
    ? { code: 0, stdout: JSON.stringify({ parent_ids: [BASE_SHA, 'c'.repeat(40)] }), stderr: '' }
    : route('success')(file, args)) });
  assert.equal((await other.ciState(GL_SHA)).state, 'none');
});

test('merge refusals are told apart: conflict, checks, not allowed', async () => {
  const cases = [
    ['GraphQL: Pull Request is not mergeable: merge conflict (mergePullRequest)', /conflict/i],
    ['ERROR: 405 Method Not Allowed {message: Branch cannot be merged}', /not .*merge|cannot/i],
    ['GraphQL: Required status check "test" is expected. (mergePullRequest)', /checks/i],
    ['ERROR: 406 Not Acceptable {message: Pipeline must succeed}', /checks/i],
    ['GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)', /head .* moved/i],
    ['GraphQL: Resource not accessible by integration (mergePullRequest)', /not allowed/i],
    ['ERROR: 403 Forbidden {message: You are not allowed to merge}', /not allowed/i],
    ['GraphQL: At least 1 approving review is required by reviewers with write access. (mergePullRequest)', /needs an approving review on the pull request/],
    ['something nobody has seen ghu_FAKE0123456789', /did not merge/i],
  ];
  const reasons = new Set();
  for (const [stderr, pattern] of cases) {
    for (const host of ['github', 'gitlab']) {
      const { a } = adapter(host, { code: 1, stderr });
      const answer = await a.merge({ number: 3, sha: host === 'github' ? SHA : GL_SHA });
      assert.equal(answer.merged, false);
      assert.match(answer.reason, pattern, `${host}: ${stderr}`);
      for (const quoted of ['Pull Request is', 'Branch cannot', 'nobody has seen', 'Resource not accessible', 'Method Not Allowed', 'reviewers with write']) {
        assert.ok(!answer.reason.includes(quoted), `the host's words are not quoted: ${answer.reason}`);
      }
      reasons.add(answer.reason);
    }
  }
  assert.ok(reasons.size >= 5, 'the kinds are told apart');
});

test('the scrub hides a key\'s value and not ordinary words', async () => {
  const { scrub } = await import('../../../scripts/host/adapter.js');
  // Env values alone: a long value is hidden; a short one is not, so words survive.
  assert.equal(scrub('bad ghz1234567890 here', { TOKEN_X: 'ghz1234567890' }), 'bad [hidden] here');
  assert.equal(scrub('on main, 1 of 1 failed', { A: 'main', B: '1', C: '' }), 'on main, 1 of 1 failed');
  assert.equal(scrub('seven77 stays', { A: 'seven77' }), 'seven77 stays');
  assert.equal(scrub('eight888 goes', { A: 'eight888' }), '[hidden] goes');
  // Settings that are not secrets are not blanked.
  assert.equal(scrub('could not reach gitlab.example.com', { GITLAB_HOST: 'gitlab.example.com', GIT_CONFIG_COUNT: '1' }), 'could not reach gitlab.example.com');
  // Ordinary words next to the words "token", "password" or "Bearer".
  for (const plain of ['token expired, ask again', 'Basic authentication is not enabled', 'password required for this project', 'secret scanning found nothing']) {
    assert.equal(scrub(plain), plain);
  }
  // Key-shaped text still goes.
  assert.equal(scrub('Authorization: Bearer abc.def.ghi'), 'Authorization: Bearer [hidden]');
  assert.equal(scrub('GH_TOKEN=abc12345'), 'GH_TOKEN=[hidden]');
  assert.equal(scrub('token ghp_abcdefghijkl'), 'token [hidden]');
  assert.equal(scrub('password: hunter22'), 'password: [hidden]');
  // After these, the value goes whatever its letters.
  assert.equal(scrub('Authorization: Bearer abcdefgh'), 'Authorization: Bearer [hidden]');
  for (const name of ['password', 'token', 'access_token', 'private_token']) {
    assert.equal(scrub(`${name}=abcdefgh`), `${name}=[hidden]`, name);
    assert.equal(scrub(`${name} = abc`), `${name} = [hidden]`, name);
  }
});

test('merged results: the merge request\'s head pipeline is used first, then the list', async () => {
  const MERGE_SHA = 'a'.repeat(40);
  const BASE_SHA = 'b'.repeat(40);
  const reply = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
  const build = (headPipeline, extra = () => null) => makeAdapter({ host: 'gitlab', repo: REPO, env: ENV, run: async (file, args) => {
    const path = args[1] ?? '';
    if (path.includes('/pipelines?sha=')) return reply([]);
    if (path.endsWith(`/repository/commits/${GL_SHA}/merge_requests`)) return reply([{ iid: 5, state: 'opened' }]);
    if (path.endsWith('/merge_requests/5')) return reply({ iid: 5, head_pipeline: headPipeline });
    if (path.endsWith(`/repository/commits/${MERGE_SHA}`)) return reply({ parent_ids: [BASE_SHA, GL_SHA] });
    const other = extra(path);
    if (other) return other;
    throw new Error(`unexpected ${args.join(' ')}`); // the list is not reachable
  } });
  // The head pipeline is the head's own.
  assert.equal((await build({ id: 1, sha: GL_SHA, ref: 'refs/merge-requests/5/head', status: 'failed' }).ciState(GL_SHA)).state, 'failure');
  // Or a merged-results pipeline on a commit that has the head as a parent.
  assert.equal((await build({ id: 2, sha: MERGE_SHA, ref: 'refs/merge-requests/5/merge', status: 'success' }).ciState(GL_SHA)).state, 'success');
  // A head pipeline for another commit is not used; the list is.
  const listed = build({ id: 3, sha: 'c'.repeat(40), ref: 'refs/heads/x', status: 'success' },
    (path) => (path.includes('/merge_requests/5/pipelines') ? reply([{ id: 9, sha: MERGE_SHA, ref: 'refs/merge-requests/5/merge', status: 'running' }]) : null));
  assert.equal((await listed.ciState(GL_SHA)).state, 'pending');
});

test('when the merged-results lookup throws, CI reads none and the gate refuses', async () => {
  const lab = makeAdapter({ host: 'gitlab', repo: REPO, env: ENV, run: async (file, args) => {
    if ((args[1] ?? '').includes('/pipelines?sha=')) return { code: 0, stdout: '[]', stderr: '' };
    throw new Error('the lookup blew up');
  } });
  const ci = await lab.ciState(GL_SHA);
  assert.deepEqual(ci, { sha: GL_SHA, state: 'none' });
  const { gateDecision } = await import('../../../scripts/gate/conditions.js');
  const decision = gateDecision({ stop: false, bypass: false, holdsLock: true, headSha: GL_SHA, ci });
  assert.equal(decision.allow, false);
  assert.ok(decision.reasons.some((r) => /CI has not passed/.test(r)));
});
