// tests/scripts/host/gitlab-protection-ee.test.js
// Check 71, steps 4 to 6: GitLab's protection, pipelines and secrets read back from the recorded
// responses of a company-style GitLab at Free (tests/fixtures/gitlab-ee/free/). Nothing real is
// reached: the API is a stand-in that answers with the recorded bodies, and the glab tool is a fake.
// Premium's answers were not recorded (the licence is held for the director), so a Premium answer
// here is written from GitLab's documentation and says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readGitlabProtection, protectGitlabBranch, protectionStatus, switchOnProtection, FAKED_TESTS_LINE, fakedTestsGap,
} from '../../../scripts/host/protection.js';
import { hostApprovalReady } from '../../../scripts/host/approval-ready.js';
import { makeAdapter } from '../../../scripts/host/adapter.js';
import { tempFolder } from '../../helpers/homes.js';

// gh and glab are run from Wheelhouse's tools folder when setup fetched them there
// (scripts/lib/host-tools.js); these tests name the bare tools, so they run with an empty one.
process.env.WHEELHOUSE_HOME = tempFolder('wh-host-tools-');

const recorded = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/gitlab-ee/free/${name}`, import.meta.url), 'utf8'));
const step4 = recorded('step-4-protection-and-pipelines.json');
const step5 = recorded('step-5-protected-variables.json');
const exchange = (fixture, label, nth = 0) => fixture.exchanges.filter((e) => e.label === label)[nth].response;

// Recorded: main as GitLab kept it after Wheelhouse's own protection (push No one, merge
// Maintainers), the project's merge settings, and the approval rules call at Free (HTTP 403).
const MAIN = step4.exchanges[4].response;
const PROJECT = step4.exchanges[5].response;
const FREE_RULES = exchange(step4, 'maintainer: GET /projects/<ID>/approval_rules');
// Recorded: the list a Maintainer gets, which carries each variable's value (scrubbed to <VALUE> there).
const VARIABLES = exchange(step5, 'maintainer: GET /projects/<ID>/variables');
// Not recorded, written from GitLab's documentation: the rules call at Premium.
const PREMIUM_RULES = { status: 200, body: [] };

// A value that must appear nowhere in what Wheelhouse returns, logs or says.
const VALUE = 'zz-probe-value-4f2d9a71-never-shown';
const withValues = (list) => ({ status: 200, body: list.map((v) => ({ ...v, value: VALUE })) });

const level = (n, description) => [{ access_level: n, access_level_description: description }];
const developersPush = { status: 200, body: { ...MAIN.body, push_access_levels: level(30, 'Developers + Maintainers') } };

// A stand-in for GitLab's API: each path answers with what it is given. A path not named is a
// mistake in the test, so it throws.
function hostApi({ branches = {}, project = PROJECT, rules = FREE_RULES, variables = { status: 200, body: [] } } = {}) {
  const calls = [];
  const get = async (path) => {
    calls.push(`GET ${path}`);
    const branch = /^\/projects\/41\/protected_branches\/(.+)$/.exec(path);
    if (branch) return branches[decodeURIComponent(branch[1])] ?? { status: 404, body: {} };
    if (path === '/projects/41') return project;
    if (path === '/projects/41/approval_rules') {
      if (rules instanceof Error) throw rules;
      return rules;
    }
    if (path.startsWith('/projects/41/variables')) return variables;
    throw new Error(`unexpected GET ${path}`);
  };
  const never = async (...args) => { throw new Error(`unexpected write ${args[0]}`); };
  return { api: { get, post: never, put: never, delete: never }, calls };
}

const wholeProject = { main: MAIN, 'wheelhouse-state': developersPush, 'wheelhouse-lock': developersPush };

const STATE_BRANCH_GAP = (name) => `${name} is a project secret that a pipeline on Wheelhouse's own state branch could read`;
const MERGE_REQUEST_GAP = (name) => `${name} is a project secret that a merge request's pipeline could read`;

test('a project with pipelines required and secrets protected has no gaps', async () => {
  // A project with no variables at all: protected variables are gaps now, since a pipeline on
  // Wheelhouse's own state branch (which takes its key's pushes) is given them.
  const { api } = hostApi({ branches: wholeProject });
  const read = await readGitlabProtection({ api, projectId: 41, branch: 'main' });
  assert.equal(read.protected, true);
  assert.deepEqual(read.pushAccess, ['No one']);
  assert.deepEqual(read.mergeAccess, ['Maintainers']);
  assert.equal(read.pipelinesMustSucceed, true);
  assert.equal(read.skippedPipelineCounts, false, 'a skipped pipeline does not count as passed (allow_merge_on_skipped_pipeline: null)');
  assert.deepEqual(read.variablesUnprotected, []);
  assert.deepEqual(read.variablesProtected, []);
  assert.equal(read.variablesKnown, true);
  const status = await protectionStatus({ host: 'gitlab', repo: 41, api });
  assert.equal(status.on, true);
  assert.deepEqual(status.gaps, []);
});

test('an unprotected variable is named, never its value', async () => {
  const { api } = hostApi({ branches: wholeProject, variables: withValues(VARIABLES.body) });
  const read = await readGitlabProtection({ api, projectId: 41, branch: 'main' });
  assert.deepEqual(read.variablesUnprotected, ['PROBE_PLAIN']);
  assert.deepEqual(read.variablesProtected, ['PROBE_SECRET']);
  const status = await protectionStatus({ host: 'gitlab', repo: 41, api });
  assert.deepEqual(status.gaps, [MERGE_REQUEST_GAP('PROBE_PLAIN'), STATE_BRANCH_GAP('PROBE_SECRET')]);
  assert.equal(JSON.stringify({ read, status }).includes(VALUE), false);
});

test('a protected variable is named as one that a pipeline on the state branch could read', async () => {
  const protectedOnly = withValues(VARIABLES.body.map((v) => ({ ...v, protected: true })));
  const status = await protectionStatus({ host: 'gitlab', repo: 41, api: hostApi({ branches: wholeProject, variables: protectedOnly }).api });
  assert.deepEqual(status.gaps, [STATE_BRANCH_GAP('PROBE_SECRET'), STATE_BRANCH_GAP('PROBE_PLAIN')]);
  assert.equal(JSON.stringify(status).includes(VALUE), false);
});

test('Free is told from Premium by the approval call', async () => {
  const planOf = async (rules) => (await readGitlabProtection({ api: hostApi({ branches: wholeProject, rules }).api, projectId: 41, branch: 'main' })).plan;
  assert.equal(await planOf(FREE_RULES), 'free', 'HTTP 403, as check 71 recorded');
  assert.equal(await planOf(PREMIUM_RULES), 'premium');
  // Any other failure is not read as Premium (or as Free): the plan is not known.
  // (404 is what GitLab's Community Edition answers: it has no approval rules.)
  for (const status of [401, 404, 500]) assert.equal(await planOf({ status, body: {} }), 'unknown', `HTTP ${status}`);
  // And a call that could not be made at all is a plain failure, not a guess.
  await assert.rejects(planOf(new Error('Could not reach GitLab')), /Could not reach GitLab/);
});

// A GitLab that keeps what it is given, so the protection can be switched on and read back.
function memoryHost(rules) {
  const kept = {};
  const posts = [];
  const levelsOf = (n) => level(n, { 0: 'No one', 30: 'Developers + Maintainers', 40: 'Maintainers' }[n]);
  const api = {
    get: async (path) => {
      const branch = /^\/projects\/41\/protected_branches\/(.+)$/.exec(path);
      if (branch) return kept[decodeURIComponent(branch[1])] ? { status: 200, body: kept[decodeURIComponent(branch[1])] } : { status: 404, body: {} };
      if (path === '/projects/41') return { status: 200, body: { ...PROJECT.body, only_allow_merge_if_pipeline_succeeds: true } };
      if (path === '/projects/41/approval_rules') return rules;
      if (path.startsWith('/projects/41/pipelines?')) return { status: 200, body: [{ id: 1 }] };
      if (path.startsWith('/projects/41/variables')) return { status: 200, body: [] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path, body) => {
      posts.push(body);
      kept[body.name] = { push_access_levels: levelsOf(body.push_access_level), merge_access_levels: levelsOf(body.merge_access_level), allow_force_push: body.allow_force_push };
      return { status: 201, body: {} };
    },
    put: async () => ({ status: 200, body: {} }),
    delete: async (path) => { delete kept[decodeURIComponent(path.split('/').at(-1))]; return { status: 204, body: null }; },
  };
  return { api, posts, mergeOf: (branch) => posts.find((b) => b.name === branch).merge_access_level };
}

test('a real-user project merges by Maintainers only, on every plan, until the host approval route is ready', async () => {
  assert.equal(hostApprovalReady({ host: 'gitlab', plan: 'premium' }), false, 'the stand-in Part 9 Task 5 replaces');
  const CE = { status: 404, body: {} };

  // Free: main takes Maintainers' merges and no pushes.
  const free = memoryHost(FREE_RULES);
  const done = await switchOnProtection({ host: 'gitlab', repo: 41, api: free.api, realUsers: true });
  assert.equal(free.mergeOf('main'), 40, 'main: Maintainers merge');
  assert.equal(free.posts.find((b) => b.name === 'main').push_access_level, 0, 'main: No one pushes');
  assert.equal(done.on, true);

  // Premium (a 200), and a plan that could not be told (Community Edition's 404): no relaxation.
  for (const [name, rules] of [['premium', PREMIUM_RULES], ['community edition', CE]]) {
    const host = memoryHost(rules);
    assert.equal((await switchOnProtection({ host: 'gitlab', repo: 41, api: host.api, realUsers: true })).on, true, name);
    assert.equal(host.mergeOf('main'), 40, name);
  }

  // Without real users nothing changes.
  const plain = memoryHost(FREE_RULES);
  await switchOnProtection({ host: 'gitlab', repo: 41, api: plain.api, realUsers: false });
  assert.equal(plain.mergeOf('main'), 30);

  // Read back, a real-user project whose main still lets Developers merge is not "on", whatever the plan.
  const loose = hostApi({ branches: { ...wholeProject, main: { status: 200, body: { ...MAIN.body, merge_access_levels: level(30, 'Developers + Maintainers') } } } });
  assert.equal((await protectionStatus({ host: 'gitlab', repo: 41, api: loose.api, realUsers: true })).on, false);
  const looseMain = { status: 200, body: { ...MAIN.body, merge_access_levels: level(30, 'Developers + Maintainers') } };
  const loosePremium = hostApi({ rules: PREMIUM_RULES, branches: { ...wholeProject, main: looseMain } });
  assert.equal((await protectionStatus({ host: 'gitlab', repo: 41, api: loosePremium.api, realUsers: true })).on, false);
  assert.equal((await protectionStatus({ host: 'gitlab', repo: 41, api: loose.api, realUsers: false })).on, true);
  assert.equal((await protectionStatus({ host: 'gitlab', repo: 41, api: hostApi({ branches: wholeProject }).api, realUsers: true })).on, true);

  // protectGitlabBranch itself takes Maintainers (and refuses any other level).
  const direct = memoryHost(FREE_RULES);
  await protectGitlabBranch({ api: direct.api, projectId: 41, branch: 'main', mergeAccess: 40 });
  assert.equal(direct.mergeOf('main'), 40);
  await assert.rejects(protectGitlabBranch({ api: direct.api, projectId: 41, branch: 'main', mergeAccess: 50 }), /Merge access/);
});

// The glab tool as the adapter runs it: the recorded list for a commit whose only pipeline is a
// status the project key posted (source "external"), as glab printed it.
const POSTED = step4.commands.find((c) => /"source":"external"/.test(c.output) && c.output.startsWith('[{'))
  .output.replace(/<ID>/g, '7').replace(/<TOKEN>|<TIMESTAMP>/g, 'x');
const SHA = '3f6c1a9e2b7d4c8f0a5e1b9d6c2f7a4e8b0d3c5f';
const REPO = 'wh71-probe/trial';

function glab(answerFor) {
  const run = async (file, args) => ({ code: 0, stdout: answerFor(args[1] ?? ''), stderr: '' });
  return makeAdapter({ host: 'gitlab', repo: REPO, run, env: { GITLAB_TOKEN: 'a-stand-in-key' } });
}

test('a head pipeline from a posted status reads as none (check 71)', async () => {
  // The commit's newest pipeline is the posted status.
  const posted = glab((path) => (path.includes('/pipelines?sha=') ? POSTED : '[]'));
  assert.equal(JSON.parse(POSTED)[0].source, 'external');
  assert.deepEqual(await posted.ciState(SHA), { sha: SHA, state: 'none' });

  // Or the merge request's head pipeline is.
  const external = { id: 9, sha: SHA, ref: 'noci-status', status: 'success', source: 'external' };
  const viaRequest = (head) => glab((path) => {
    if (path.includes('/pipelines?sha=')) return '[]';
    if (path.endsWith(`/repository/commits/${SHA}/merge_requests`)) return JSON.stringify([{ iid: 5, state: 'opened' }]);
    if (path.endsWith('/merge_requests/5')) return JSON.stringify({ iid: 5, head_pipeline: head });
    return '[]';
  });
  assert.deepEqual(await viaRequest(external).ciState(SHA), { sha: SHA, state: 'none' });

  // A pipeline that really ran still counts, whatever its result.
  const ran = { ...external, ref: 'refs/merge-requests/5/head', source: 'merge_request_event' };
  assert.equal((await viaRequest(ran).ciState(SHA)).state, 'success');
  assert.equal((await viaRequest({ ...ran, status: 'failed' }).ciState(SHA)).state, 'failure');
  const listed = glab((path) => (path.includes('/pipelines?sha=') ? JSON.stringify([{ ...JSON.parse(POSTED)[0], source: 'push' }]) : '[]'));
  assert.equal((await listed.ciState(SHA)).state, 'success');
});

test("a Maintainer's variable list gives names and never values", async () => {
  // The list as recorded, with a value in each variable, and a second page.
  const page = (from, count) => Array.from({ length: count }, (_, i) => ({
    key: `VAR_${from + i}`, value: VALUE, protected: (from + i) % 2 === 0, masked: true, environment_scope: '*',
  }));
  const pages = new Map([['1', page(0, 100)], ['2', page(100, 3)]]);
  const calls = [];
  const api = {
    get: async (path) => {
      calls.push(path);
      if (path === '/projects/41/protected_branches/main') return MAIN;
      if (path === '/projects/41') return PROJECT;
      if (path === '/projects/41/approval_rules') return FREE_RULES;
      const requested = /[?&]page=(\d+)/.exec(path)?.[1] ?? '1';
      return { status: 200, body: pages.get(requested) ?? [] };
    },
  };
  const read = await readGitlabProtection({ api, projectId: 41, branch: 'main' });
  assert.equal(read.variablesUnprotected.length, 51, 'every page is read');
  assert.equal(read.variablesProtected.length, 52);
  assert.ok(read.variablesUnprotected.every((name) => /^VAR_\d+$/.test(name)));
  assert.equal(JSON.stringify(read).includes(VALUE), false);
  const status = await protectionStatus({ host: 'gitlab', repo: 41, api: { ...hostApi({ branches: wholeProject, variables: { status: 200, body: page(1, 2) } }).api } });
  assert.equal(JSON.stringify(status).includes(VALUE), false);

  // A key that is only a Developer is refused the list: that is not "no unprotected variables".
  const refused = await readGitlabProtection({ api: hostApi({ branches: wholeProject, variables: { status: 403, body: { message: `403 Forbidden ${VALUE}` } } }).api, projectId: 41, branch: 'main' });
  assert.deepEqual(refused.variablesUnprotected, []);
  assert.equal(refused.variablesKnown, false);
  assert.equal(read.variablesKnown, true);
  assert.equal(JSON.stringify(refused).includes(VALUE), false);

  // A failing call says nothing of the values it was holding.
  const broken = hostApi({ branches: wholeProject });
  broken.api.get = async (path) => {
    if (path.startsWith('/projects/41/variables')) throw new Error(`Could not reach GitLab`);
    return hostApi({ branches: wholeProject }).api.get(path);
  };
  await assert.rejects(readGitlabProtection({ api: broken.api, projectId: 41, branch: 'main' }), (error) => !error.message.includes(VALUE));
});

test("the board says the host's tests could be faked, for a real-user project on Free", async () => {
  assert.equal(FAKED_TESTS_LINE, "the project's tests on the host could be faked with Wheelhouse's key");
  const gaps = async (rules, realUsers) => (await protectionStatus({
    host: 'gitlab', repo: 41, api: hostApi({ branches: wholeProject, rules }).api, realUsers,
  })).gaps;
  const said = await gaps(FREE_RULES, true);
  assert.equal(said.length, 1);
  assert.ok(said[0].includes(FAKED_TESTS_LINE), said[0]);
  assert.deepEqual(await gaps(FREE_RULES, false), [], 'no real users yet: nothing to say');
  assert.deepEqual(await gaps(PREMIUM_RULES, true), [], 'at Premium the approval route is the answer');

  // A plan that could not be told (Community Edition has no approval rules: HTTP 404) is not Premium.
  const unknown = await gaps({ status: 404, body: {} }, true);
  assert.equal(unknown.length, 1);
  assert.match(unknown[0], /^Wheelhouse could not tell GitLab's plan/);
  assert.ok(unknown[0].includes(FAKED_TESTS_LINE), unknown[0]);
  assert.equal(fakedTestsGap('premium'), null);
  assert.equal(fakedTestsGap(undefined), null, 'GitHub has no plan to tell');
});

test("the director's own read says when it could not look at the project's secrets", async () => {
  const refused = { status: 403, body: {} };
  const asDirector = async (director) => (await protectionStatus({ host: 'gitlab', repo: 41, api: hostApi({ branches: wholeProject, variables: refused }).api, director })).gaps;
  assert.deepEqual(await asDirector(true), ["Wheelhouse could not look at the project's secrets, so it cannot say which ones a pipeline could read"]);
  // The project key's own read (the board's) is always refused the list, and says nothing of it.
  assert.deepEqual(await asDirector(false), []);
  // When the director's read does see the list, there is nothing to say.
  const seen = await protectionStatus({ host: 'gitlab', repo: 41, api: hostApi({ branches: wholeProject }).api, director: true });
  assert.deepEqual(seen.gaps, []);
});

test('Wheelhouse\'s own state and lock branches keep taking its pushes on Free, and main takes none', async () => {
  // The state is pushed with the project key, a Developer; "Maintainers" push would lock it out.
  // The read-back calls are answered, so an unexpected failure anywhere fails the test.
  const host = memoryHost(FREE_RULES);
  const done = await switchOnProtection({ host: 'gitlab', repo: 41, api: host.api, realUsers: true });
  assert.equal(done.on, true);
  assert.deepEqual(host.posts.map((b) => [b.name, b.push_access_level, b.merge_access_level, b.allow_force_push]), [
    ['main', 0, 40, false], ['wheelhouse-state', 30, 30, false], ['wheelhouse-lock', 30, 30, false],
  ]);
  await assert.rejects(protectGitlabBranch({ api: host.api, projectId: 41, branch: 'wheelhouse-state', pushAccess: 40 }), /Push access/);
});
