// tests/scripts/host/contract-github.test.js
// The two GitHub backends held to one contract: every case in contract/github-cases.js runs over a fake
// `gh` and over a fake `curl`, and must give the same adapter value or error. Then what only the REST
// backend does (how it sends, the key, the faults, the guards) and the method-list test, which fails when
// one backend lacks a method the other has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAdapter, adapterFrom } from '../../../scripts/host/adapter.js';
import { githubCommands } from '../../../scripts/host/github.js';
import { githubRestCommands, makeGithubRestAdapter } from '../../../scripts/host/github-rest.js';
import { makeFakeCurl } from '../../helpers/fake-curl.js';
import { tempFolder } from '../../helpers/homes.js';
import { cases, REPO, SHA, MOVED, rs } from './contract/github-cases.js';

// gh is run from Wheelhouse's tools folder when setup fetched it there; these tests name the bare tool.
process.env.WHEELHOUSE_HOME = tempFolder('wh-host-tools-');

const KEY = 'stand-in-github-key-0123456789';

function viaGh(answers) {
  const calls = [];
  const queue = [...answers];
  const run = async (file, args, options = {}) => {
    calls.push({ file, args, input: options.input, env: options.env });
    const a = queue.shift() ?? {};
    return { code: a.code ?? 0, stdout: a.stdout ?? '', stderr: a.stderr ?? '' };
  };
  return { adapter: makeAdapter({ host: 'github', repo: REPO, run, env: { GH_TOKEN: KEY } }), calls };
}

function viaCurl(answers, options = {}) {
  const fake = makeFakeCurl(answers.map((a) => ({ ...a, body: a.body === undefined ? undefined : String(a.body) })));
  const adapter = makeGithubRestAdapter({ repo: REPO, key: () => KEY, run: fake.run, curl: '/usr/bin/curl', platform: 'linux', baseEnv: {}, ...options });
  return { adapter, calls: fake.calls };
}

for (const c of cases) {
  for (const [backend, build, answers] of [['gh', viaGh, c.gh], ['curl', viaCurl, c.rest]]) {
    test(`contract (${backend}): ${c.name}`, async () => {
      const { adapter, calls } = build(answers);
      if (c.throws !== undefined) {
        await assert.rejects(() => c.call(adapter), (error) => {
          assert.match(error.message, c.throws);
          assert.ok(!error.message.includes(KEY));
          return true;
        });
      } else {
        const got = await c.call(adapter);
        if (c.expect !== undefined) assert.deepEqual(got, c.expect);
        if (c.check !== undefined) c.check(got);
      }
      assert.equal(calls.length, answers.length, 'the backend made as many calls as the host was ready to answer');
    });
  }
}

// ---- What only the REST backend does ----

const pair = (call, name) => call.pairs.filter(([key]) => key === name).map(([, value]) => value);
const bodyOf = (call) => JSON.parse(pair(call, 'data-binary')[0]);
const pullJson = (over = {}) => JSON.stringify({ number: 4, state: 'open', merged: false, node_id: 'PR_x', head: { sha: SHA, ref: 'b', repo: { full_name: REPO } }, base: { ref: 'main', repo: { full_name: REPO } }, ...over });

test('rest: the key goes in a bearer header on standard input, never in an argument or the environment', async () => {
  const { adapter, calls } = viaCurl([{ status: 200, body: JSON.stringify({ default_branch: 'main' }) }]);
  await adapter.defaultBranch();
  assert.ok(pair(calls[0], 'header').includes(`Authorization: Bearer ${KEY}`));
  assert.ok(pair(calls[0], 'header').includes('Accept: application/vnd.github+json'));
  assert.ok(pair(calls[0], 'header').includes('X-GitHub-Api-Version: 2022-11-28'));
  assert.ok(!calls[0].args.join(' ').includes(KEY));
  assert.ok(!JSON.stringify(calls[0].env ?? {}).includes(KEY));
  assert.deepEqual(pair(calls[0], 'url'), ['https://api.github.com/repos/a-director/product']);
});

test('rest: a merge is PUT with the sha alone as the guard, a merge commit, and given the merge time', async () => {
  const { adapter, calls } = viaCurl([{ status: 200, body: '{"merged":true}' }, { status: 200, body: pullJson({ state: 'closed', merged: true }) }]);
  await adapter.merge({ number: 4, sha: SHA });
  assert.deepEqual(pair(calls[0], 'request'), ['PUT']);
  assert.ok(pair(calls[0], 'url')[0].endsWith('/repos/a-director/product/pulls/4/merge'));
  assert.deepEqual(bodyOf(calls[0]), { sha: SHA, merge_method: 'merge' });
  assert.deepEqual(pair(calls[0], 'max-time'), ['300']);
  assert.deepEqual(pair(calls[1], 'max-time'), ['120']);
});

test('rest: an approval is POSTed to the reviews with the commit it was read at', async () => {
  const { adapter, calls } = viaCurl([{ status: 200, body: pullJson() }, { status: 200, body: rs('review-approved.json') }]);
  assert.deepEqual(await adapter.approve({ number: 4, sha: SHA }), { approved: true });
  assert.deepEqual(pair(calls[1], 'request'), ['POST']);
  assert.ok(pair(calls[1], 'url')[0].endsWith('/pulls/4/reviews'));
  assert.deepEqual(bodyOf(calls[1]), { event: 'APPROVE', commit_id: SHA });
  assert.deepEqual(pair(calls[1], 'max-time'), ['300']);
});

test('rest: a 409 to the approval says the head has moved', async () => {
  const { adapter } = viaCurl([{ status: 200, body: pullJson() }, { status: 409, body: '{"message":"conflict"}' }]);
  const got = await adapter.approve({ number: 4, sha: SHA });
  assert.equal(got.approved, false);
  assert.match(got.reason, /head .* moved/);
});

test('gh: an approval reads the head, then posts the review with the commit', async () => {
  const { adapter, calls } = viaGh([{ stdout: JSON.stringify({ headRefOid: SHA }) }, { stdout: '{}' }]);
  await adapter.approve({ number: 4, sha: SHA });
  assert.deepEqual(calls[0].args.slice(0, 3), ['pr', 'view', '4']);
  assert.deepEqual(calls[1].args, ['api', '--method', 'POST', 'repos/a-director/product/pulls/4/reviews', '--input', '-']);
  assert.deepEqual(JSON.parse(calls[1].input), { event: 'APPROVE', commit_id: SHA });
});

test('both: a merge always carries the sha guard', async () => {
  const rest = viaCurl([{ status: 200, body: '{}' }, { status: 200, body: pullJson({ state: 'closed', merged: true }) }]);
  await rest.adapter.merge({ number: 4, sha: SHA });
  assert.equal(bodyOf(rest.calls[0]).sha, SHA);
  const cli = viaGh([{ stdout: '' }, { stdout: JSON.stringify({ state: 'MERGED' }) }]);
  await cli.adapter.merge({ number: 4, sha: SHA });
  assert.ok(cli.calls[0].args.join(' ').includes(`--match-head-commit ${SHA}`));
});

test('both: approve and merge refuse a missing or short commit before anything runs', async () => {
  for (const build of [viaGh, viaCurl]) {
    const { adapter, calls } = build([]);
    await assert.rejects(() => adapter.approve({ number: 4, sha: 'abc' }), /full commit ID/);
    await assert.rejects(() => adapter.approve({ number: 0, sha: SHA }), /whole number/);
    await assert.rejects(() => adapter.merge({ number: 4 }), /full commit ID/);
    await assert.rejects(() => adapter.approvalsNeeded('x'), /whole number/);
    assert.equal(calls.length, 0);
  }
});

test('rest: a merge that GitHub queued is taken back with the pull request\'s own id', async () => {
  const { adapter, calls } = viaCurl([{ status: 200, body: '{}' }, { status: 200, body: pullJson() }, { status: 200, body: '{"data":{}}' }]);
  const got = await adapter.merge({ number: 4, sha: SHA });
  assert.equal(got.queued, true);
  assert.ok(pair(calls[2], 'url')[0].endsWith('/graphql'));
  const sent = bodyOf(calls[2]);
  assert.match(sent.query, /disablePullRequestAutoMerge/);
  assert.deepEqual(sent.variables, { id: 'PR_x' });
});

test('rest: the GraphQL queries go to /graphql with the owner, name and commit', async () => {
  const { adapter, calls } = viaCurl([{ status: 200, body: rs('review-approved.json').replace(/.*/s, '{"data":{"repository":{"object":null}}}') }]);
  assert.deepEqual(await adapter.ciState(SHA), { sha: SHA, state: 'none' });
  assert.ok(pair(calls[0], 'url')[0].endsWith('/graphql'));
  assert.deepEqual(pair(calls[0], 'request'), ['POST']);
  assert.deepEqual(bodyOf(calls[0]).variables, { owner: 'a-director', name: 'product', sha: SHA });
});

test('rest: a merge that cannot reach GitHub says so, in GitHub\'s name', async () => {
  const { adapter } = viaCurl([{ exit: 6 }]);
  const got = await adapter.merge({ number: 4, sha: SHA });
  assert.equal(got.merged, false);
  assert.equal(got.unreachable, true);
  assert.match(got.reason, /GitHub/);
  assert.doesNotMatch(got.reason, /GitLab/);
});

test('rest: a read that cannot reach GitHub throws with its code and names GitHub', async () => {
  const { adapter } = viaCurl([{ exit: 6 }]);
  await assert.rejects(() => adapter.defaultBranch(), (error) => { assert.equal(error.code, 'HOST_UNREACHABLE'); assert.match(error.message, /GitHub/); assert.doesNotMatch(error.message, /GitLab/); return true; });
});

test('rest: the key is scrubbed from an error, including one the key function throws', async () => {
  const leaking = makeGithubRestAdapter({ repo: REPO, key: () => { throw new Error('no store for ghu_FAKE0123456789abcd'); }, run: makeFakeCurl().run, curl: '/usr/bin/curl', baseEnv: {} });
  await assert.rejects(() => leaking.defaultBranch(), (error) => { assert.ok(!error.message.includes('ghu_FAKE')); return true; });
  const { adapter } = viaCurl([{ status: 500, body: `oops ${KEY}` }]);
  await assert.rejects(() => adapter.defaultBranch(), (error) => { assert.ok(!error.message.includes(KEY)); assert.match(error.message, /HTTP 500/); return true; });
});

test('rest: a missing key is a plain error and nothing is sent', async () => {
  const fake = makeFakeCurl();
  const adapter = makeGithubRestAdapter({ repo: REPO, key: () => '  ', run: fake.run, curl: '/usr/bin/curl', baseEnv: {} });
  await assert.rejects(() => adapter.defaultBranch(), /no key for GitHub/);
  assert.equal(fake.calls.length, 0);
});

test('rest: a read refused with 401 says the key was not accepted', async () => {
  const { adapter } = viaCurl([{ status: 401, body: '{"message":"Bad credentials"}' }]);
  await assert.rejects(() => adapter.defaultBranch(), (error) => { assert.match(error.message, /did not accept the key/); assert.equal(error.status, 401); return true; });
});

test('rest: curl missing is NO_CURL, and the words are about GitHub', async () => {
  const adapter = makeGithubRestAdapter({ repo: REPO, key: () => KEY, run: makeFakeCurl().run, curl: null, baseEnv: {} });
  await assert.rejects(() => adapter.defaultBranch(), (error) => { assert.equal(error.code, 'NO_CURL'); assert.doesNotMatch(error.message, /GitLab/); return true; });
});

test('rest: the changed files are paged until a short page', async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}`, additions: 1, deletions: 0 }));
  const { adapter, calls } = viaCurl([
    { status: 200, body: JSON.stringify(page) },
    { status: 200, body: JSON.stringify([{ filename: 'last', additions: 1, deletions: 0 }]) },
    { status: 200, body: '[]' },
  ]);
  const details = await adapter.requestDetails(4);
  assert.equal(details.files.length, 101);
  assert.ok(pair(calls[1], 'url')[0].includes('/pulls/4/files?per_page=100&page=2'));
});

test('rest: the repository must be written owner/name', () => {
  assert.throws(() => makeGithubRestAdapter({ repo: 'product', key: () => KEY }), /owner\/name/);
  assert.throws(() => makeGithubRestAdapter({ repo: REPO }), /function that gives the key/);
});

test('the adapters name their backend', () => {
  assert.equal(viaGh([]).adapter.backend, 'cli');
  assert.equal(viaCurl([]).adapter.backend, 'rest');
});

test('an approval at a head that is not the pull request\'s posts nothing (the moved head is read, not guessed)', async () => {
  const { adapter, calls } = viaCurl([{ status: 200, body: pullJson({ head: { sha: MOVED, ref: 'b', repo: { full_name: REPO } } }) }]);
  const got = await adapter.approve({ number: 4, sha: SHA });
  assert.equal(got.approved, false);
  assert.equal(calls.length, 1);
});

// ---- The two backends have the same methods ----

const names = (commands, prefix = '') => Object.entries(commands).flatMap(([key, value]) => (
  typeof value === 'function' ? [`${prefix}${key}`] : names(value, `${prefix}${key}.`)));

test('method list: neither GitHub backend lacks a method the other has', () => {
  const stub = new Proxy({}, { get: () => () => {} });
  const cli = names(githubCommands({ ...stub, repo: REPO }));
  const rest = names(githubRestCommands({ send: async () => ({}), repo: REPO }));
  assert.deepEqual(cli.filter((n) => !rest.includes(n)), [], 'in gh only');
  assert.deepEqual(rest.filter((n) => !cli.includes(n)), [], 'in REST only');
});

test('method list: both backends carry every method the adapter calls', () => {
  const wanted = names(adapterFrom({})).filter((n) => !['pushTarget', 'followBranch', 'pullRef'].includes(n));
  const stub = new Proxy({}, { get: () => () => {} });
  for (const commands of [githubCommands({ ...stub, repo: REPO }), githubRestCommands({ send: async () => ({}), repo: REPO })]) {
    const have = names(commands);
    // History is GitLab-only; the adapter says so for GitHub.
    assert.deepEqual(wanted.filter((n) => !have.includes(n) && !['mergedRequests', 'pipelinesFor', 'protectionEvents'].includes(n)), []);
  }
  assert.ok(wanted.includes('approve') && wanted.includes('approvalsNeeded'));
});
