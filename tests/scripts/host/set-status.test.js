// tests/scripts/host/set-status.test.js
// Reporting a check to the host (spec 4.3, steps 2, 9 and 10), and reading what else reports there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAdapter } from '../../../scripts/host/adapter.js';

const SHA = 'a'.repeat(40);

function adapter(answers, host = 'github') {
  const calls = [];
  const run = async (file, args, options) => {
    calls.push({ file, args, options });
    return answers.shift() ?? { code: 0, stdout: '{}', stderr: '' };
  };
  return { adapter: makeAdapter({ host, repo: 'o/p', run, env: {} }), calls };
}

test('setStatus posts the context and state', async () => {
  const { adapter: a, calls } = adapter([]);
  assert.deepEqual(await a.setStatus({ sha: SHA, state: 'pending', description: 'Checking on this computer' }), { ok: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['api', '--method', 'POST', `repos/o/p/statuses/${SHA}`, '-f', 'state=pending', '-f', 'context=wheelhouse/checks', '-f', 'description=Checking on this computer']);
});

test('a 403 reads permission', async () => {
  const { adapter: a } = adapter([{ code: 1, stdout: '', stderr: 'gh: Resource not accessible by integration (HTTP 403)' }]);
  assert.deepEqual(await a.setStatus({ sha: SHA, state: 'success', description: 'Passed' }), { refused: 'permission' });
});

test('another failure reads as a refusal in plain words, not a throw', async () => {
  const { adapter: a } = adapter([{ code: 1, stdout: '', stderr: 'gh: Server Error (HTTP 502)' }]);
  const got = await a.setStatus({ sha: SHA, state: 'success', description: 'Passed' });
  assert.equal(typeof got.refused, 'string');
  assert.notEqual(got.refused, 'permission');
});

test('a state the host has no word for is refused before anything runs', async () => {
  const { adapter: a, calls } = adapter([]);
  await assert.rejects(a.setStatus({ sha: SHA, state: 'error', description: 'x' }));
  await assert.rejects(a.setStatus({ sha: 'short', state: 'success', description: 'x' }));
  assert.equal(calls.length, 0);
});

test('a long description is cut to what the host keeps', async () => {
  const { adapter: a, calls } = adapter([]);
  await a.setStatus({ sha: SHA, state: 'failure', description: 'x'.repeat(300) });
  assert.equal(calls[0].args.at(-1).length, 'description='.length + 140);
});

test('GitLab refuses setStatus', async () => {
  const { adapter: a, calls } = adapter([], 'gitlab');
  const got = await a.setStatus({ sha: SHA, state: 'success', description: 'Passed' });
  assert.equal(typeof got.refused, 'string');
  assert.equal(calls.length, 0);
});

test('checkContexts reads each check run and status with whether a job started', async () => {
  const nodes = [
    { __typename: 'CheckRun', name: 'build', status: 'QUEUED', conclusion: null, startedAt: null, completedAt: null, checkSuite: { app: { slug: 'github-actions' } } },
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-10-31T01:00:00Z', completedAt: '2026-10-31T01:05:00Z', checkSuite: { app: { slug: 'github-actions' } } },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-10-31T01:00:00Z', completedAt: '2026-10-31T01:00:00Z', checkSuite: { app: { slug: 'github-actions' } } },
    { __typename: 'CheckRun', name: 'start', status: 'COMPLETED', conclusion: 'STARTUP_FAILURE', startedAt: '2026-10-31T01:00:00Z', completedAt: '2026-10-31T01:00:09Z', checkSuite: { app: null } },
    { __typename: 'StatusContext', context: 'wheelhouse/checks', state: 'PENDING', createdAt: '2026-10-31T01:00:00Z', creator: { login: 'someone' } },
  ];
  const { adapter: a } = adapter([{ code: 0, stdout: JSON.stringify({ data: { repository: { object: { statusCheckRollup: { contexts: { nodes } } } } } }), stderr: '' }]);
  assert.deepEqual(await a.checkContexts(SHA), [
    { name: 'build', state: 'queued', startedAt: null, app: 'github-actions' },
    { name: 'test', state: 'success', startedAt: '2026-10-31T01:00:00Z', app: 'github-actions' },
    { name: 'lint', state: 'failure', startedAt: null, app: 'github-actions' },
    { name: 'start', state: 'failure', startedAt: null, app: null },
    { name: 'wheelhouse/checks', state: 'pending', startedAt: null, app: 'someone' },
  ]);
});

test('a commit with no rollup has no contexts, and an answer with errors is thrown', async () => {
  const none = adapter([{ code: 0, stdout: JSON.stringify({ data: { repository: { object: { statusCheckRollup: null } } } }), stderr: '' }]);
  assert.deepEqual(await none.adapter.checkContexts(SHA), []);
  const bad = adapter([{ code: 0, stdout: JSON.stringify({ errors: [{ message: 'x' }], data: null }), stderr: '' }]);
  await assert.rejects(bad.adapter.checkContexts(SHA));
});

test('requiredChecks reads the names from the branch\'s rules', async () => {
  const rules = [{ type: 'deletion' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'wheelhouse/checks' }, { context: 'ci' }] } }];
  const { adapter: a, calls } = adapter([{ code: 0, stdout: JSON.stringify(rules), stderr: '' }]);
  assert.deepEqual(await a.requiredChecks('main'), ['wheelhouse/checks', 'ci']);
  assert.ok(calls[0].args.join(' ').includes('repos/o/p/rules/branches/main'));
});

test('requiredChecks is empty where a plan has no rules, and null where they can\'t be read', async () => {
  const read = (answer) => adapter([answer]).adapter.requiredChecks('main');
  assert.deepEqual(await read({ code: 1, stdout: '', stderr: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)' }), []);
  assert.equal(await read({ code: 1, stdout: '', stderr: 'gh: Bad gateway (HTTP 502)' }), null);
  assert.equal(await read({ code: 0, stdout: '{ not json', stderr: '' }), null);
});
