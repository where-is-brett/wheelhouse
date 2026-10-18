// tests/scripts/host/protection.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGitlabProtection, protectGitlabBranch } from '../../../scripts/host/protection.js';

function fakeApi(...answers) {
  const calls = [];
  const call = (method) => async (path, body) => {
    calls.push({ method, path, body });
    return answers.shift();
  };
  return { api: { get: call('GET'), post: call('POST'), put: call('PUT'), delete: call('DELETE') }, calls };
}

const protectedMain = (push, merge, force = false) => ({
  status: 200,
  body: {
    name: 'main',
    push_access_levels: push,
    merge_access_levels: merge,
    allow_force_push: force,
  },
});
const noOne = [{ id: 1, access_level: 0, access_level_description: 'No one' }];
const maintainers = [{ id: 2, access_level: 40, access_level_description: 'Maintainers' }];
const project = (flag) => ({ status: 200, body: { id: 7, only_allow_merge_if_pipeline_succeeds: flag } });

test('readGitlabProtection reports push and merge access and the pipeline rule', async () => {
  const { api, calls } = fakeApi(protectedMain(noOne, maintainers), project(true));
  const result = await readGitlabProtection({ api, projectId: 'group/app', branch: 'main' });
  assert.deepEqual(result, { protected: true, pushAccess: ['No one'], mergeAccess: ['Maintainers'], allowForcePush: false, pipelinesMustSucceed: true });
  assert.equal(calls[0].path, '/projects/group%2Fapp/protected_branches/main');
  assert.equal(calls[1].path, '/projects/group%2Fapp');
});

test('readGitlabProtection names levels from their numbers when GitLab gives no description', async () => {
  const bare = (level) => [{ access_level: level }];
  const { api } = fakeApi(protectedMain(bare(30), bare(60)), project(false));
  const result = await readGitlabProtection({ api, projectId: 1, branch: 'main' });
  assert.deepEqual(result.pushAccess, ['Developers + Maintainers']);
  assert.deepEqual(result.mergeAccess, ['Administrators']);
  assert.equal(result.pipelinesMustSucceed, false);
});

test('readGitlabProtection says plainly when the branch is not protected', async () => {
  const { api } = fakeApi({ status: 404, body: {} }, project(false));
  const result = await readGitlabProtection({ api, projectId: 1, branch: 'release/1.0' });
  assert.deepEqual(result, { protected: false, pushAccess: [], mergeAccess: [], allowForcePush: false, pipelinesMustSucceed: false });
});

test('readGitlabProtection encodes the branch name', async () => {
  const { api, calls } = fakeApi({ status: 404, body: {} }, project(false));
  await readGitlabProtection({ api, projectId: 1, branch: 'release/1.0' });
  assert.equal(calls[0].path, '/projects/1/protected_branches/release%2F1.0');
});

test('readGitlabProtection reports a refusal rather than guessing', async () => {
  for (const [status, pattern] of [[401, /sign-in/], [403, /allowed|role/], [500, /500/]]) {
    const { api } = fakeApi({ status, body: {} });
    await assert.rejects(readGitlabProtection({ api, projectId: 1, branch: 'main' }), pattern);
  }
});

test('protectGitlabBranch sets push to no one, merge to Developers, no force-push, pipelines must pass', async () => {
  const { api, calls } = fakeApi(
    { status: 404, body: {} },
    { status: 201, body: {} },
    project(true),
  );
  await protectGitlabBranch({ api, projectId: 'group/app', branch: 'main' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    'GET /projects/group%2Fapp/protected_branches/main',
    'POST /projects/group%2Fapp/protected_branches',
    'PUT /projects/group%2Fapp',
  ]);
  assert.deepEqual(calls[1].body, { name: 'main', push_access_level: 0, merge_access_level: 30, allow_force_push: false });
  assert.deepEqual(calls[2].body, { only_allow_merge_if_pipeline_succeeds: true });
});

test('protectGitlabBranch leaves a branch that is already right alone, but still sets the pipeline rule', async () => {
  const developers = [{ id: 3, access_level: 30, access_level_description: 'Developers + Maintainers' }];
  const { api, calls } = fakeApi(protectedMain(noOne, developers), project(true));
  await protectGitlabBranch({ api, projectId: 1, branch: 'main' });
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PUT']);
});

test('protectGitlabBranch replaces a protection that lets more people push', async () => {
  const { api, calls } = fakeApi(
    protectedMain(maintainers, maintainers, true),
    { status: 204, body: null },
    { status: 201, body: {} },
    project(true),
  );
  await protectGitlabBranch({ api, projectId: 1, branch: 'main' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    'GET /projects/1/protected_branches/main',
    'DELETE /projects/1/protected_branches/main',
    'POST /projects/1/protected_branches',
    'PUT /projects/1',
  ]);
});

test('protectGitlabBranch stops, and says which step, when GitLab refuses', async () => {
  const cases = [
    [[{ status: 404, body: {} }, { status: 403, body: { message: 'glpat-LEAKED' } }], /protect/],
    [[{ status: 404, body: {} }, { status: 201, body: {} }, { status: 403, body: { message: 'glpat-LEAKED' } }], /pipeline/],
  ];
  for (const [answers, pattern] of cases) {
    const { api } = fakeApi(...answers);
    await assert.rejects(protectGitlabBranch({ api, projectId: 1, branch: 'main' }), (error) => {
      assert.match(error.message, pattern);
      assert.doesNotMatch(error.message, /LEAKED/);
      return true;
    });
  }
});

test('protectGitlabBranch can keep merging to Maintainers, and can leave the pipeline rule alone', async () => {
  const { api, calls } = fakeApi({ status: 404, body: {} }, { status: 201, body: {} });
  await protectGitlabBranch({ api, projectId: 1, branch: 'main', mergeAccess: 40, pipelinesMustSucceed: false });
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST']);
  assert.equal(calls[1].body.merge_access_level, 40);
  await assert.rejects(protectGitlabBranch({ api: fakeApi().api, projectId: 1, branch: 'main', mergeAccess: 0 }), /Maintainers/);
});

test('protectGitlabBranch puts the old protection back when the new one is refused', async () => {
  const { api, calls } = fakeApi(
    protectedMain(maintainers, maintainers, true),
    { status: 204, body: null },
    { status: 403, body: { message: 'glpat-LEAKED' } },
    { status: 201, body: {} },
  );
  await assert.rejects(protectGitlabBranch({ api, projectId: 1, branch: 'main' }), (error) => {
    assert.match(error.message, /old protection was put back/);
    assert.doesNotMatch(error.message, /LEAKED/);
    return true;
  });
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'DELETE', 'POST', 'POST']);
  assert.deepEqual(calls[3].body, { name: 'main', push_access_level: 40, merge_access_level: 40, allow_force_push: true });
});

test('protectGitlabBranch says the branch is unprotected when the old protection cannot be put back', async () => {
  for (const second of [{ status: 500, body: {} }, new Error('network')]) {
    const calls = [];
    const answers = [protectedMain(maintainers, maintainers), { status: 204, body: null }, { status: 403, body: {} }];
    const next = async (method, path, body) => {
      calls.push(method);
      const answer = answers.shift() ?? second;
      if (answer instanceof Error) throw answer;
      return answer;
    };
    const api = { get: (p) => next('GET', p), post: (p, b) => next('POST', p, b), put: (p, b) => next('PUT', p, b), delete: (p) => next('DELETE', p) };
    await assert.rejects(protectGitlabBranch({ api, projectId: 1, branch: 'main' }), /now unprotected/);
    assert.deepEqual(calls, ['GET', 'DELETE', 'POST', 'POST']);
  }
});

test('protectGitlabBranch treats a dropped connection on the new protection like a refusal', async () => {
  // POST throws, and the old protection is put back.
  let posts = 0;
  const calls = [];
  const api = {
    get: async () => protectedMain(maintainers, maintainers),
    delete: async () => ({ status: 204, body: null }),
    post: async (path, body) => {
      calls.push(body);
      posts += 1;
      if (posts === 1) throw new Error('connect failed, PRIVATE-TOKEN glpat-LEAKED');
      return { status: 201, body: {} };
    },
    put: async () => ({ status: 200, body: {} }),
  };
  await assert.rejects(protectGitlabBranch({ api, projectId: 1, branch: 'main' }), (error) => {
    assert.match(error.message, /old protection was put back/);
    assert.doesNotMatch(error.message, /LEAKED/);
    return true;
  });
  assert.deepEqual(calls[1], { name: 'main', push_access_level: 40, merge_access_level: 40, allow_force_push: false });

  // POST throws, and so does the restore.
  const failing = {
    ...api,
    post: async () => { throw new Error('connect failed, PRIVATE-TOKEN glpat-LEAKED'); },
  };
  await assert.rejects(protectGitlabBranch({ api: failing, projectId: 1, branch: 'main' }), (error) => {
    assert.match(error.message, /now unprotected/);
    assert.doesNotMatch(error.message, /LEAKED/);
    return true;
  });
});

test('protectGitlabBranch on a branch that was not protected just reports a dropped connection', async () => {
  const api = {
    get: async () => ({ status: 404, body: {} }),
    post: async () => { throw new Error('glpat-LEAKED'); },
    delete: async () => { throw new Error('not called'); },
    put: async () => ({ status: 200, body: {} }),
  };
  await assert.rejects(protectGitlabBranch({ api, projectId: 1, branch: 'main' }), (error) => {
    assert.match(error.message, /could not be reached/);
    assert.doesNotMatch(error.message, /LEAKED/);
    return true;
  });
});

// ---- Server-side protection through the board (Task 15) -------------------
import { readFileSync } from 'node:fs';
import { protectionStatus, switchOnProtection } from '../../../scripts/host/protection.js';

const gh = (name) => readFileSync(new URL(`../../fixtures/host/github/${name}`, import.meta.url), 'utf8');
const FREE_LINE = "GitHub's free plan doesn't protect private projects; Wheelhouse's helper and checks hold the line.";

// A fake `gh`: routes by "METHOD path"; each route gives { code, stdout, stderr }.
function fakeGh(routes) {
  const calls = [];
  const run = async (file, args, options) => {
    assert.equal(file, 'gh');
    const path = args[1];
    const method = args[args.indexOf('--method') + 1];
    calls.push({ method, path, args, input: options.input ? JSON.parse(options.input) : undefined, env: options.env });
    const route = routes[`${method} ${path}`];
    assert.ok(route, `unexpected gh call: ${method} ${path}`);
    const answer = typeof route === 'function' ? route(calls.at(-1)) : route;
    return { code: 0, stdout: '', stderr: '', ...answer };
  };
  return { run, calls };
}
const ok = (stdout) => ({ code: 0, stdout });
const refusedFree = () => ({ code: 1, stderr: gh('ruleset-refused-free.txt') });

test('a private GitHub repository on the free plan is reported unavailable, and nothing is written', async () => {
  const { run, calls } = fakeGh({
    'GET repos/a-director/product': ok(gh('repo-private-free.json')),
    'GET user': ok(gh('user-free.json')),
  });
  const expected = { available: false, on: false, line: FREE_LINE };
  assert.deepEqual(await protectionStatus({ host: 'github', repo: 'a-director/product', run }), expected);
  assert.deepEqual(await switchOnProtection({ host: 'github', repo: 'a-director/product', run }), { on: false, line: FREE_LINE });
  assert.ok(calls.every((c) => c.method === 'GET'));
});

test('when the plan cannot be read, GitHub refusing rulesets with its upgrade message means unavailable', async () => {
  const { run } = fakeGh({
    'GET repos/a-director/product': ok(gh('repo-private-free.json')),
    'GET user': { code: 1, stderr: 'gh: Not Found (HTTP 404)' },
    'GET repos/a-director/product/rulesets': refusedFree(),
  });
  assert.deepEqual(await protectionStatus({ host: 'github', repo: 'a-director/product', run }), { available: false, on: false, line: FREE_LINE });
});

test('a refusal on create (the upgrade message) is on:false with the free-plan line', async () => {
  const { run } = fakeGh({
    'GET repos/a-director/product': ok(gh('repo-private-free.json')),
    'GET user': ok(gh('user-pro.json')),
    'GET repos/a-director/product/rulesets': ok(gh('rulesets-empty.json')),
    'POST graphql': ok(gh('ci-contexts-none.json')),
    'POST repos/a-director/product/rulesets': refusedFree(),
  });
  assert.deepEqual(await switchOnProtection({ host: 'github', repo: 'a-director/product', run }), { on: false, line: FREE_LINE });
});

// A stateful fake of a public repository's rulesets.
function publicRepo({ checks = gh('ci-contexts-none.json') } = {}) {
  const store = [];
  const routes = {
    'GET repos/a-director/product': ok(gh('repo-public.json')),
    'POST graphql': ok(checks),
    'GET repos/a-director/product/rulesets': () => ok(JSON.stringify(store.map(({ id, name }) => ({ id, name })))),
    'POST repos/a-director/product/rulesets': (c) => { store.push({ id: 100 + store.length, ...c.input }); return ok(gh('ruleset-created.json')); },
  };
  for (let id = 100; id < 104; id += 1) {
    routes[`GET repos/a-director/product/rulesets/${id}`] = () => ok(JSON.stringify(store.find((r) => r.id === id)));
    routes[`PUT repos/a-director/product/rulesets/${id}`] = (c) => { store[id - 100] = { id, ...c.input }; return ok('{}'); };
  }
  return { store, ...fakeGh(routes) };
}

test('on a public repository, switching on makes the two rulesets with the agreed rules and no bypass', async () => {
  const { run, calls, store } = publicRepo();
  const before = await protectionStatus({ host: 'github', repo: 'a-director/product', run });
  assert.deepEqual(before.on, false);
  assert.equal(before.available, true);
  const result = await switchOnProtection({ host: 'github', repo: 'a-director/product', run, env: { GH_TOKEN: 'secret-token' } });
  assert.equal(result.on, true);
  assert.match(result.line, /the project has no checks yet, so Wheelhouse won't merge anything until it has CI\.$/);
  assert.doesNotMatch(result.line, /isn't required/);
  const [main, side] = store;
  assert.equal(main.name, 'Wheelhouse: default branch');
  assert.deepEqual(main.conditions.ref_name.include, ['refs/heads/main']);
  assert.deepEqual(main.rules.map((r) => r.type), ['pull_request', 'deletion', 'non_fast_forward']);
  assert.equal(main.rules[0].parameters.required_approving_review_count, 0);
  assert.equal(side.name, 'Wheelhouse: state and lock');
  assert.deepEqual(side.conditions.ref_name.include, ['refs/heads/wheelhouse-state', 'refs/heads/wheelhouse-lock']);
  assert.deepEqual(side.rules.map((r) => r.type), ['deletion', 'non_fast_forward']);
  for (const r of store) { assert.deepEqual(r.bypass_actors, []); assert.equal(r.enforcement, 'active'); }
  assert.ok(calls.every((c) => c.env?.GH_TOKEN === undefined || c.env.GH_TOKEN === 'secret-token'));
  assert.ok(calls.every((c) => !JSON.stringify(c.args).includes('secret-token')));
  const after = await protectionStatus({ host: 'github', repo: 'a-director/product', run });
  assert.deepEqual(after, { available: true, on: true, line: result.line });
});

test('switching on again updates the same rulesets rather than adding more', async () => {
  const { run, calls, store } = publicRepo();
  await switchOnProtection({ host: 'github', repo: 'a-director/product', run });
  await switchOnProtection({ host: 'github', repo: 'a-director/product', run });
  assert.equal(store.length, 2);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 2);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.path !== 'graphql').length, 2);
});

test('where the default branch already has checks, they are required', async () => {
  const { run, store } = publicRepo({ checks: gh('ci-contexts.json') });
  const result = await switchOnProtection({ host: 'github', repo: 'a-director/product', run });
  const rule = store[0].rules.find((r) => r.type === 'required_status_checks');
  assert.deepEqual(rule.parameters.required_status_checks, [{ context: 'test' }, { context: 'ci/legacy' }]);
  assert.match(result.line, /requires its checks to pass/);
  assert.doesNotMatch(result.line, /isn't required/);
});

test('a paid-plan private repository is available', async () => {
  const { run } = fakeGh({
    'GET repos/a-director/product': ok(gh('repo-private-free.json')),
    'GET user': ok(gh('user-pro.json')),
    'GET repos/a-director/product/rulesets': ok(gh('rulesets-empty.json')),
  });
  const status = await protectionStatus({ host: 'github', repo: 'a-director/product', run });
  assert.deepEqual([status.available, status.on], [true, false]);
});

// GitLab through the board.
const ladder = (access, desc) => [{ access_level: access, access_level_description: desc }];
const glProject = (flag = false) => ({ status: 200, body: { id: 7, default_branch: 'trunk', only_allow_merge_if_pipeline_succeeds: flag } });
const glBranch = (push, desc, force = false) => ({ status: 200, body: { push_access_levels: ladder(push, desc), merge_access_levels: ladder(30, 'Developers + Maintainers'), allow_force_push: force } });
const notFound = { status: 404, body: {} };

test('GitLab status is on when the default branch takes no pushes and state and lock take Developers without force-push', async () => {
  const { api } = fakeApi(
    glProject(true),
    glBranch(0, 'No one'), glProject(true),
    glBranch(30, 'Developers + Maintainers'), glProject(true),
    glBranch(30, 'Developers + Maintainers'), glProject(true),
  );
  const status = await protectionStatus({ host: 'gitlab', repo: 'group/app', api });
  assert.equal(status.available, true);
  assert.equal(status.on, true);
  assert.match(status.line, /requires pipelines to pass/);
});

test('GitLab status is off when the branches are unprotected', async () => {
  const { api } = fakeApi(glProject(), notFound, glProject(), notFound, glProject(), notFound, glProject());
  const status = await protectionStatus({ host: 'gitlab', repo: 'group/app', api });
  assert.deepEqual([status.available, status.on], [true, false]);
});

test('GitLab switch-on protects the default branch (no pushes) and state and lock (Developers), leaving pipelines alone with no CI', async () => {
  const { api, calls } = fakeApi(
    glProject(),                       // default branch
    { status: 200, body: [] },         // pipelines: none
    notFound, { status: 201, body: {} },   // main
    notFound, { status: 201, body: {} },   // state
    notFound, { status: 201, body: {} },   // lock
    glProject(),                       // status: project
    glBranch(0, 'No one'), glProject(),
    glBranch(30, 'Developers + Maintainers'), glProject(),
    glBranch(30, 'Developers + Maintainers'), glProject(),
  );
  const result = await switchOnProtection({ host: 'gitlab', repo: 'group/app', api });
  assert.equal(result.on, true);
  assert.match(result.line, /the project has no checks yet, so Wheelhouse won't merge anything until it has CI\.$/);
  assert.doesNotMatch(result.line, /isn't required/);
  assert.match(calls[1].path, /pipelines\?ref=trunk&per_page=1/);
  const posts = calls.filter((c) => c.method === 'POST').map((c) => c.body);
  assert.deepEqual(posts.map((b) => [b.name, b.push_access_level, b.merge_access_level, b.allow_force_push]), [
    ['trunk', 0, 30, false], ['wheelhouse-state', 30, 30, false], ['wheelhouse-lock', 30, 30, false],
  ]);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
});

test('GitLab switch-on requires pipelines where the default branch already has one', async () => {
  const { api, calls } = fakeApi(
    glProject(),
    { status: 200, body: [{ id: 1 }] },
    notFound, { status: 201, body: {} }, { status: 200, body: {} },
    notFound, { status: 201, body: {} },
    notFound, { status: 201, body: {} },
    glProject(true),
    glBranch(0, 'No one'), glProject(true),
    glBranch(30, 'Developers + Maintainers'), glProject(true),
    glBranch(30, 'Developers + Maintainers'), glProject(true),
  );
  const result = await switchOnProtection({ host: 'gitlab', repo: 'group/app', api });
  assert.match(result.line, /requires pipelines to pass/);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 1);
});
