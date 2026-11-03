// tests/scripts/host/contract-gitlab.test.js
// The two GitLab backends held to one contract: every case in contract/gitlab-cases.js runs over a fake
// `glab` and over a fake `curl`, and must give the same adapter value or error. Then what only the REST
// backend does (how it sends, the key, the time a merge may take) and the method-list test, which fails when
// one backend lacks a method the other has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAdapter, adapterFrom } from '../../../scripts/host/adapter.js';
import { gitlabCommands } from '../../../scripts/host/gitlab.js';
import { gitlabRestCommands, makeGitlabRestAdapter } from '../../../scripts/host/gitlab-rest.js';
import { makeFakeCurl } from '../../helpers/fake-curl.js';
import { tempFolder } from '../../helpers/homes.js';
import { cases, REPO, SHA, rs } from './contract/gitlab-cases.js';

// glab is run from Wheelhouse's tools folder when setup fetched it there; these tests name the bare tool.
process.env.WHEELHOUSE_HOME = tempFolder('wh-host-tools-');

const KEY = 'glpat-FAKEKEY0123456789abcd';

function viaGlab(answers) {
  const calls = [];
  const queue = [...answers];
  const run = async (file, args, options = {}) => {
    calls.push({ file, args, input: options.input, env: options.env });
    const a = queue.shift() ?? {};
    return { code: a.code ?? 0, stdout: a.stdout ?? '', stderr: a.stderr ?? '' };
  };
  return { adapter: makeAdapter({ host: 'gitlab', repo: REPO, run, env: { GITLAB_TOKEN: KEY } }), calls };
}

function viaCurl(answers, options = {}) {
  const fake = makeFakeCurl(answers.map((a) => ({ ...a, body: a.body === undefined ? undefined : String(a.body) })));
  const adapter = makeGitlabRestAdapter({ repo: REPO, key: () => KEY, run: fake.run, curl: '/usr/bin/curl', platform: 'linux', baseEnv: {}, ...options });
  return { adapter, calls: fake.calls };
}

for (const c of cases) {
  for (const [backend, build, answers] of [['glab', viaGlab, c.glab], ['curl', viaCurl, c.rest]]) {
    test(`contract (${backend}): ${c.name}`, async () => {
      const { adapter, calls } = build(answers);
      if (c.throws !== undefined) {
        await assert.rejects(() => c.call(adapter), (error) => {
          assert.match(error.message, c.throws);
          if (c.code !== undefined) assert.equal(error.code, c.code);
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

const mergeAnswers = [{ status: 200, body: '{}' }, { status: 200, body: JSON.stringify({ state: 'merged' }) }];
const pair = (call, name) => call.pairs.filter(([key]) => key === name).map(([, value]) => value);

test('rest: the key goes in a header on standard input, never in an argument or the environment', async () => {
  const { adapter, calls } = viaCurl([{ status: 200, body: JSON.stringify({ default_branch: 'main' }) }]);
  await adapter.defaultBranch();
  assert.ok(pair(calls[0], 'header').includes(`PRIVATE-TOKEN: ${KEY}`));
  assert.ok(!calls[0].args.join(' ').includes(KEY));
  assert.ok(!JSON.stringify(calls[0].env ?? {}).includes(KEY));
  assert.deepEqual(pair(calls[0], 'url'), ['https://gitlab.com/api/v4/projects/a-director%2Fproduct']);
});

test('rest: a company GitLab is reached at its own address', async () => {
  const { adapter, calls } = viaCurl([{ status: 200, body: JSON.stringify({ default_branch: 'main' }) }], { base: 'https://gitlab.example.org' });
  await adapter.defaultBranch();
  assert.deepEqual(pair(calls[0], 'url'), ['https://gitlab.example.org/api/v4/projects/a-director%2Fproduct']);
});

test('rest: a merge is PUT with the sha alone, and given the merge time', async () => {
  const { adapter, calls } = viaCurl(mergeAnswers);
  await adapter.merge({ number: 4, sha: SHA });
  assert.deepEqual(pair(calls[0], 'request'), ['PUT']);
  assert.ok(pair(calls[0], 'url')[0].endsWith('/merge_requests/4/merge'));
  const body = JSON.parse(pair(calls[0], 'data-binary')[0]);
  assert.deepEqual(body, { sha: SHA });
  assert.deepEqual(pair(calls[0], 'max-time'), ['300']);
  assert.deepEqual(pair(calls[1], 'max-time'), ['120']);
});

test('rest: an approval is POSTed with the sha and shares the merge time', async () => {
  const { adapter, calls } = viaCurl([{ status: 201, body: rs('approve-ok.json') }]);
  assert.deepEqual(await adapter.approve({ number: 4, sha: SHA }), { approved: true });
  assert.deepEqual(pair(calls[0], 'request'), ['POST']);
  assert.ok(pair(calls[0], 'url')[0].endsWith('/merge_requests/4/approve'));
  assert.deepEqual(JSON.parse(pair(calls[0], 'data-binary')[0]), { sha: SHA });
});

test('glab: an approval is `glab mr approve --sha`', async () => {
  const { adapter, calls } = viaGlab([{ stdout: '' }]);
  await adapter.approve({ number: 4, sha: SHA });
  assert.deepEqual(calls[0].args, ['mr', 'approve', '4', '-R', REPO, '--sha', SHA]);
});

test('both: a merge always carries the sha guard', async () => {
  const rest = viaCurl(mergeAnswers);
  await rest.adapter.merge({ number: 4, sha: SHA });
  assert.equal(JSON.parse(pair(rest.calls[0], 'data-binary')[0]).sha, SHA);
  const cli = viaGlab([{ stdout: '' }, { stdout: JSON.stringify({ state: 'merged' }) }]);
  await cli.adapter.merge({ number: 4, sha: SHA });
  assert.ok(cli.calls[0].args.join(' ').includes(`--sha ${SHA}`));
});

test('both: approve and merge refuse a missing or short commit before anything runs', async () => {
  for (const build of [viaGlab, viaCurl]) {
    const { adapter, calls } = build([]);
    await assert.rejects(() => adapter.approve({ number: 4, sha: 'abc' }), /full commit ID/);
    await assert.rejects(() => adapter.approve({ number: 0, sha: SHA }), /whole number/);
    await assert.rejects(() => adapter.merge({ number: 4 }), /full commit ID/);
    await assert.rejects(() => adapter.approvalsNeeded('x'), /whole number/);
    assert.equal(calls.length, 0);
  }
});

test('rest: the key is scrubbed from an error, including one the key function throws', async () => {
  const leaking = makeGitlabRestAdapter({ repo: REPO, key: () => { throw new Error(`no store for ${KEY}`); }, run: makeFakeCurl().run, curl: '/usr/bin/curl', baseEnv: {} });
  await assert.rejects(() => leaking.defaultBranch(), (error) => { assert.ok(!error.message.includes(KEY)); return true; });
  const { adapter } = viaCurl([{ status: 500, body: `oops ${KEY}` }]);
  await assert.rejects(() => adapter.defaultBranch(), (error) => { assert.ok(!error.message.includes(KEY)); assert.match(error.message, /HTTP 500/); return true; });
});

test('rest: a missing key is a plain error and nothing is sent', async () => {
  const fake = makeFakeCurl();
  const adapter = makeGitlabRestAdapter({ repo: REPO, key: () => '  ', run: fake.run, curl: '/usr/bin/curl', baseEnv: {} });
  await assert.rejects(() => adapter.defaultBranch(), /no key for GitLab/);
  assert.equal(fake.calls.length, 0);
});

test('rest: a read refused with 401 says the key was not accepted', async () => {
  const { adapter } = viaCurl([{ status: 401, body: rs('unauthorized.json') }]);
  await assert.rejects(() => adapter.defaultBranch(), (error) => { assert.match(error.message, /did not accept the key/); assert.equal(error.status, 401); return true; });
});

test('rest: curl missing is NO_CURL', async () => {
  const adapter = makeGitlabRestAdapter({ repo: REPO, key: () => KEY, run: makeFakeCurl().run, curl: null, baseEnv: {} });
  await assert.rejects(() => adapter.defaultBranch(), (error) => error.code === 'NO_CURL');
});

test('rest: requestDetails pages the diffs until a short page', async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ new_path: `f${i}`, diff: '+a' }));
  const { adapter, calls } = viaCurl([
    { status: 200, body: JSON.stringify(page) },
    { status: 200, body: JSON.stringify([{ new_path: 'last', diff: '+b' }]) },
    { status: 200, body: '[]' },
  ]);
  const details = await adapter.requestDetails(4);
  assert.equal(details.files.length, 101);
  assert.ok(pair(calls[1], 'url')[0].includes('/diffs?per_page=100&page=2'));
});

test('the adapters name their backend', () => {
  assert.equal(viaGlab([]).adapter.backend, 'cli');
  assert.equal(viaCurl([]).adapter.backend, 'rest');
});

// ---- The two backends have the same methods ----

const names = (commands, prefix = '') => Object.entries(commands).flatMap(([key, value]) => (
  typeof value === 'function' ? [`${prefix}${key}`] : names(value, `${prefix}${key}.`)));

test('method list: neither GitLab backend lacks a method the other has', () => {
  const stub = new Proxy({}, { get: () => () => {} });
  const cli = names(gitlabCommands({ ...stub, repo: REPO }));
  const rest = names(gitlabRestCommands({ send: async () => ({}), repo: REPO }));
  assert.deepEqual(cli.filter((n) => !rest.includes(n)), [], 'in glab only');
  assert.deepEqual(rest.filter((n) => !cli.includes(n)), [], 'in REST only');
});

test('method list: both backends carry every method the adapter calls', () => {
  // The adapter's own methods, less the two a host may leave to the adapter (push target, following a branch).
  const wanted = names(adapterFrom({})).filter((n) => !['pushTarget', 'followBranch', 'pullRef'].includes(n));
  const stub = new Proxy({}, { get: () => () => {} });
  for (const commands of [gitlabCommands({ ...stub, repo: REPO }), gitlabRestCommands({ send: async () => ({}), repo: REPO })]) {
    const have = names(commands);
    assert.deepEqual(wanted.filter((n) => !have.includes(n)), []);
  }
  assert.ok(wanted.includes('approve') && wanted.includes('approvalsNeeded'));
});
