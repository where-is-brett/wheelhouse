// tests/scripts/host/adapter-history.test.js
// The adapter's read-only history calls, for the audit report (scripts/audit/report.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeAdapter, HISTORY_GITLAB_ONLY } from '../../../scripts/host/adapter.js';
import { compareProtection } from '../../../scripts/host/gitlab-history.js';
import { tempFolder } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';

// glab is run from Wheelhouse's tools folder when setup fetched it there; these tests name the bare tool.
process.env.WHEELHOUSE_HOME = tempFolder('wh-host-history-');
const tools = standInTools();

const REPO = 'a-director/product';
const PROJECT = 'projects/a-director%2Fproduct';
const SHA = '46322a2e182ab8e1bcace1b058b1818f5c93f61f';
const OTHER = '3f6c1a9e2b7d4c8f0a5e1b9d6c2f7a4e8b0d3c5f';
const ENV = { GITLAB_TOKEN: 'glpat-FAKEKEY0123456789', GITLAB_HOST: 'git.example.org' };
const SINCE = '2026-10-01T00:00:00.000Z';
const NOW = new Date('2026-10-22T00:00:00.000Z');

const recorded = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/gitlab-ee/free/${name}`, import.meta.url), 'utf8'));
const exchange = (file, label) => recorded(file).exchanges.find((e) => e.label === label);

// A run that answers by the path glab api is given: the first route whose text the path contains.
function routed(routes) {
  const calls = [];
  const run = async (file, args, options = {}) => {
    calls.push({ file, args, env: options.env });
    const path = args[1] ?? '';
    const route = routes.find(([text]) => path.includes(text));
    if (!route) return { code: 1, stdout: '', stderr: `glab: 500 Unexpected call ${path}` };
    const answer = typeof route[1] === 'function' ? route[1](path) : route[1];
    return { code: answer.code ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' };
  };
  return { run, calls };
}
const json = (value) => ({ stdout: JSON.stringify(value) });
const NO_ACCESS = { code: 1, stderr: 'glab: 403 Forbidden (HTTP 403)' };

function adapter(host, routes) {
  const { run, calls } = routed(routes);
  return { a: makeAdapter({ host, repo: REPO, run, env: ENV, base: 'https://git.example.org' }), calls };
}

const mr = (iid, extra = {}) => ({
  id: iid + 1000, iid, title: `Change ${iid}`, description: 'THE HOST\'S LONG TEXT', state: 'merged', merged_at: '2026-10-10T02:00:00.000Z',
  merged_by: { id: 5, username: 'wh-maintainer', name: 'A Name', avatar_url: 'https://x' }, author: { username: 'wh-bot' }, target_branch: 'main', source_branch: `work-${iid}`,
  sha: SHA, merge_commit_sha: OTHER, web_url: `https://git.example.org/a-director/product/-/merge_requests/${iid}`, labels: ['secret-label'], ...extra,
});

// --- merged requests ---

test('mergedRequests reads the merged merge requests since a time, keeping only the fields the report needs', async () => {
  const { a, calls } = adapter('gitlab', [['merge_requests?state=merged', json([mr(7), mr(8, { merged_at: '2026-09-01T00:00:00.000Z' })])]]);
  const got = await a.mergedRequests({ since: SINCE });
  assert.deepEqual(got, [{
    number: 7, title: 'Change 7', url: 'https://git.example.org/a-director/product/-/merge_requests/7', mergedAt: '2026-10-10T02:00:00.000Z',
    mergedBy: 'wh-maintainer', author: 'wh-bot', target: 'main', sha: SHA, mergeCommit: OTHER,
  }], 'one merged before the period is left out, and nothing else of the host\'s answer is passed on');
  assert.equal(calls[0].file, 'glab');
  assert.deepEqual(calls[0].args, ['api', `${PROJECT}/merge_requests?state=merged&updated_after=${encodeURIComponent(SINCE)}&order_by=updated_at&sort=desc&per_page=100&page=1`]);
  assert.equal(calls[0].env, ENV);
  assert.ok(!JSON.stringify(got).includes('LONG TEXT'));
});

test('mergedRequests reads the recorded merge of check 71 (the merged head is the commit the person had not looked at)', async () => {
  const merge = exchange('step-6-merge-by-maintainers.json', 'maintainer: PUT /projects/<ID>/merge_requests/<ID>/merge').response.body;
  const sha = 'a1'.repeat(20);
  const { a } = adapter('gitlab', [['merge_requests?state=merged', json([{ ...merge, iid: 7, sha, merge_commit_sha: sha, merged_at: '2026-10-21T05:00:00.000Z', merged_by: { username: 'wh-maintainer' } }])]]);
  const [one] = await a.mergedRequests({ since: SINCE });
  assert.equal(one.number, 7);
  assert.equal(one.title, 'The second change');
  assert.equal(one.sha, sha);
  assert.equal(one.target, 'main');
});

test('mergedRequests reads every page, and says when there are too many to read', async () => {
  const page = (n) => Array.from({ length: 100 }, (_, i) => mr(n * 100 + i + 1));
  const two = adapter('gitlab', [['&page=1', json(page(0))], ['&page=2', json([mr(901)])]]);
  assert.equal((await two.a.mergedRequests({ since: SINCE })).length, 101);
  const endless = adapter('gitlab', [['merge_requests?state=merged', json(page(0))]]);
  await assert.rejects(endless.a.mergedRequests({ since: SINCE }), /more than/);
});

test('mergedRequests checks its argument before anything runs', async () => {
  const { a, calls } = adapter('gitlab', []);
  await assert.rejects(a.mergedRequests({ since: 'last week' }), /time/);
  await assert.rejects(a.mergedRequests({}), /time/);
  assert.equal(calls.length, 0);
});

test('a host that cannot be reached throws HOST_UNREACHABLE, and the history is never read as empty', async () => {
  const { a } = adapter('gitlab', [['merge_requests', { code: 1, stderr: 'ERROR Get "https://git.example.org/api/v4/projects": dial tcp 10.0.0.1:443: connect: connection refused' }]]);
  const error = await a.mergedRequests({ since: SINCE }).catch((e) => e);
  assert.equal(error.code, 'HOST_UNREACHABLE');
  assert.ok(!error.message.includes('dial tcp'));
});

// --- pipelines ---

const step4 = recorded('step-4-protection-and-pipelines.json');
// The list of a commit's pipelines glab printed after the project key posted a status: one pipeline,
// source "external" (check 71, step 4).
const POSTED = step4.commands.find((c) => /"source":"external"/.test(c.output) && c.output.startsWith('[{')).output.replace(/<ID>/g, '7').replace(/<TOKEN>|<TIMESTAMP>/g, 'x');

test('pipelinesFor gives the commit\'s pipelines and each merge request\'s head pipeline, newest first', async () => {
  const { a, calls } = adapter('gitlab', [
    ['/pipelines?sha=', json([{ id: 4, status: 'failed', source: 'merge_request_event', ref: 'refs/merge-requests/7/head', sha: SHA, web_url: 'https://x', user: { username: 'x' } }])],
    [`/repository/commits/${SHA}/merge_requests`, json([{ iid: 7, state: 'merged' }])],
    ['/merge_requests/7', json({ iid: 7, head_pipeline: { id: 9, status: 'success', source: 'external', ref: 'refs/heads/work-7', sha: SHA, detailed_status: { text: 'x' } } })],
  ]);
  const got = await a.pipelinesFor(SHA);
  assert.deepEqual(got, [
    { id: 9, status: 'success', source: 'external', ref: 'refs/heads/work-7', sha: SHA },
    { id: 4, status: 'failed', source: 'merge_request_event', ref: 'refs/merge-requests/7/head', sha: SHA },
  ]);
  assert.equal(calls.length, 3);
  assert.ok(!JSON.stringify(got).includes('web_url'));
  await assert.rejects(a.pipelinesFor('--help'), /commit/);
});

test('a status the project key posted reads as a pipeline whose source is external (the recorded answer)', async () => {
  const { a } = adapter('gitlab', [['/pipelines?sha=', { stdout: POSTED }], ['/commits/', json([])]]);
  const [posted] = await a.pipelinesFor(SHA);
  assert.equal(posted.source, 'external');
  assert.equal(posted.status, 'success');
  assert.deepEqual(Object.keys(posted).sort(), ['id', 'ref', 'sha', 'source', 'status']);
});

test('pipelinesFor throws when it could not look, so a failed read is not "no pipeline"', async () => {
  const { a } = adapter('gitlab', [['/pipelines?sha=', { code: 1, stderr: 'glab: 500 Internal Server Error (HTTP 500)' }]]);
  await assert.rejects(a.pipelinesFor(SHA), /failed/);
  const lost = adapter('gitlab', [['/pipelines?sha=', json([])], ['/commits/', { code: 1, stderr: 'glab: 500 Internal Server Error (HTTP 500)' }]]);
  await assert.rejects(lost.a.pipelinesFor(SHA), /failed/);
});

// --- protection ---

const AUDIT = [
  { id: 1, created_at: '2026-10-12T03:00:00.000Z', details: { author_name: 'A Maintainer', custom_message: 'Changed the protected branch main', ip_address: '10.0.0.9' } },
  { id: 2, created_at: '2026-10-13T03:00:00.000Z', details: { author_name: 'A Maintainer', custom_message: 'Project archived' } },
  { id: 3, created_at: '2026-10-14T03:00:00.000Z', event_name: 'approval_rule_updated', details: { author_name: 'Someone', custom_message: 'Changed an approval rule' } },
];

test('on Premium, protectionEvents reads the project\'s audit events and keeps only the protection ones', async () => {
  const { a, calls } = adapter('gitlab', [['/audit_events', json(AUDIT)]]);
  const got = await a.protectionEvents({ since: SINCE, now: NOW });
  assert.equal(got.source, 'audit-events');
  assert.deepEqual(got.events, [
    { at: '2026-10-12T03:00:00.000Z', by: 'A Maintainer', what: 'Changed the protected branch main' },
    { at: '2026-10-14T03:00:00.000Z', by: 'Someone', what: 'Changed an approval rule' },
  ]);
  assert.deepEqual(calls[0].args, ['api', `${PROJECT}/audit_events?created_after=${encodeURIComponent(SINCE)}&per_page=100&page=1`]);
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(got).includes('10.0.0.9'));
});

const BRANCHES = [{ id: 1, name: 'main', push_access_levels: [{ access_level: 0 }], merge_access_levels: [{ access_level: 40 }], allow_force_push: false, extra: 'x' }];
const SETTINGS = { id: 3, only_allow_merge_if_pipeline_succeeds: true, allow_merge_on_skipped_pipeline: null, description: 'THE HOST\'S TEXT' };
const FREE = (branches = BRANCHES, settings = SETTINGS) => [
  ['/audit_events', NO_ACCESS],
  ['/protected_branches', json(branches)],
  [`${PROJECT}`, json(settings)],
];

test('at Free, audit events are refused (check 71) and the protection read now is the reading to keep', async () => {
  const refused = exchange('step-5-protected-variables.json', 'maintainer: GET /projects/<ID>/audit_events');
  assert.equal(refused.response.status, 403, 'the refusal this stand-in copies is the recorded one');
  const { a } = adapter('gitlab', FREE());
  const got = await a.protectionEvents({ since: SINCE, last: null, now: NOW });
  assert.equal(got.source, 'compared');
  assert.equal(got.first, true);
  assert.deepEqual(got.events, []);
  assert.deepEqual(got.snapshot, {
    at: NOW.toISOString(),
    branches: { main: { push: [0], merge: [40], force: false } },
    pipelinesMustSucceed: true,
    skippedPipelineCounts: false,
  });
  assert.ok(!JSON.stringify(got).includes('THE HOST\'S TEXT'));
});

test('at Free, a change since the last reading is named, and nothing changed names nothing', async () => {
  const last = { at: '2026-10-05T00:00:00.000Z', branches: { main: { push: [0], merge: [40], force: false } }, pipelinesMustSucceed: true, skippedPipelineCounts: false };
  const same = await adapter('gitlab', FREE()).a.protectionEvents({ since: SINCE, last, now: NOW });
  assert.deepEqual(same.events, []);
  assert.equal(same.first, false);

  const looser = [{ ...BRANCHES[0], merge_access_levels: [{ access_level: 30 }], allow_force_push: true }];
  const off = { ...SETTINGS, only_allow_merge_if_pipeline_succeeds: false, allow_merge_on_skipped_pipeline: true };
  const changed = await adapter('gitlab', FREE(looser, off)).a.protectionEvents({ since: SINCE, last, now: NOW });
  assert.deepEqual(changed.events.map((e) => e.what), [
    'main: who may merge changed from Maintainers to Developers + Maintainers',
    'main: force-push is now allowed',
    '"pipelines must succeed" was switched off',
    'a skipped pipeline now counts as passed',
  ]);
  assert.deepEqual(changed.events[0].between, ['2026-10-05T00:00:00.000Z', NOW.toISOString()]);
  assert.equal(changed.events[0].at, null);

  const gone = await adapter('gitlab', FREE([])).a.protectionEvents({ since: SINCE, last, now: NOW });
  assert.deepEqual(gone.events.map((e) => e.what), ['main is no longer protected']);
});

test('compareProtection names a branch newly protected, and ignores a damaged earlier reading\'s missing fields', () => {
  const now = { at: 'x', branches: { main: { push: [0], merge: [40], force: false }, 'wheelhouse-state': { push: [30], merge: [30], force: false } }, pipelinesMustSucceed: true, skippedPipelineCounts: false };
  const last = { at: 'y', branches: { main: { push: [0], merge: [40], force: false } }, pipelinesMustSucceed: true, skippedPipelineCounts: false };
  assert.deepEqual(compareProtection(last, now), ['wheelhouse-state is now protected: pushes by Developers + Maintainers, merges by Developers + Maintainers, force-push not allowed']);
  assert.doesNotThrow(() => compareProtection({ branches: { main: {} } }, now));
  assert.deepEqual(compareProtection(null, now), []);
});

test('a refusal that is not Free\'s, or a key that cannot read the protection, is thrown, never read as no change', async () => {
  await assert.rejects(adapter('gitlab', [['/audit_events', { code: 1, stderr: 'glab: 500 Internal Server Error (HTTP 500)' }]]).a.protectionEvents({ since: SINCE, now: NOW }), /500/);
  await assert.rejects(adapter('gitlab', [['/audit_events', NO_ACCESS], ['/protected_branches', NO_ACCESS], [PROJECT, json(SETTINGS)]]).a.protectionEvents({ since: SINCE, now: NOW }), /failed/);
  const away = await adapter('gitlab', [['/audit_events', { code: 1, stderr: 'dial tcp: i/o timeout' }]]).a.protectionEvents({ since: SINCE, now: NOW }).catch((e) => e);
  assert.equal(away.code, 'HOST_UNREACHABLE');
});

test('an edition with no audit events at all (not found) is compared like Free', async () => {
  const gone = { code: 1, stderr: 'glab: 404 Not Found (HTTP 404)' };
  const { a } = adapter('gitlab', [['/audit_events', gone], ['/protected_branches', json(BRANCHES)], [PROJECT, json(SETTINGS)]]);
  assert.equal((await a.protectionEvents({ since: SINCE, now: NOW })).source, 'compared');
});

test('the earlier reading must be an object or null', async () => {
  const { a, calls } = adapter('gitlab', []);
  await assert.rejects(a.protectionEvents({ since: SINCE, last: 'x' }), /object or null/);
  await assert.rejects(a.protectionEvents({ since: SINCE, last: [] }), /object or null/);
  assert.equal(calls.length, 0);
});

// --- GitHub, and what ran ---

test('for GitHub the history calls say plainly the report is for GitLab, and run nothing', async () => {
  const { run, calls } = routed([]);
  const a = makeAdapter({ host: 'github', repo: REPO, run, env: {} });
  for (const ask of [() => a.mergedRequests({ since: SINCE }), () => a.pipelinesFor(SHA), () => a.protectionEvents({ since: SINCE })]) {
    await assert.rejects(ask(), (error) => error.message === HISTORY_GITLAB_ONLY);
  }
  assert.match(HISTORY_GITLAB_ONLY, /GitLab/);
  assert.equal(calls.length, 0);
});

test('every history call only reads, and no key is in an argument', async () => {
  const { a, calls } = adapter('gitlab', [
    ['merge_requests?state=merged', json([])],
    ['/pipelines?sha=', json([])],
    ['/commits/', json([])],
    ['/audit_events', json([])],
  ]);
  await a.mergedRequests({ since: SINCE });
  await a.pipelinesFor(SHA);
  await a.protectionEvents({ since: SINCE, now: NOW });
  for (const call of calls) {
    assert.equal(call.args[0], 'api');
    assert.ok(!call.args.includes('--method'), 'no write: glab api reads unless it is given a method');
    assert.ok(!call.args.includes('--field') && !call.args.includes('-f') && !call.args.includes('--raw-field'));
    for (const arg of call.args) assert.ok(!arg.includes(ENV.GITLAB_TOKEN));
  }
  assert.deepEqual(tools.calls(), [], 'no real gh or glab ran');
});
