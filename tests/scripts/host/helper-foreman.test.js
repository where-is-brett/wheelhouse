// tests/scripts/host/helper-foreman.test.js
// The helper runs the foreman's commands (ruling R156): /foreman/run takes the main checkout's
// folder, the script and its arguments, runs scripts/foreman/runner.js there outside the
// sandbox with no key or secret in its environment, and gives back the exit code and output.
// And a feature session's push names its worktree, from which the helper places the project
// (ruling R157).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { FOREMAN_RUNNER, SIGN_IN_NAMES, foremanEnv, foremanRequestRefusal } from '../../../scripts/host/foreman-run.js';
import { sessionEnv } from '../../../scripts/watcher/waker.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { liftStop, setStop } from '../../../scripts/lib/stop.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { enrol, makeSigningKey } from '../../../scripts/state/signing.js';
import { makeBareRemote, g, push as plainPush } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const P = 'o__p';
const NOT_MAIN = { ok: false, refused: 'the foreman\'s commands run only in the project\'s main checkout' };

// A host with `main`, the project's main checkout cloned from it, and a home whose record names
// that checkout, with the state cloned and the lock taken.
async function project() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const seed = tempFolder('wh-seed-');
  await g(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), 'The product.\n');
  await g(seed, 'add', '-A');
  await g(seed, 'commit', '-q', '-m', 'The product');
  await g(seed, 'push', '-q', remote.url, 'HEAD:refs/heads/main');
  const checkout = fs.realpathSync.native(tempFolder('wh-main-'));
  await g(path.dirname(checkout), 'clone', '-q', remote.url, checkout);
  const home = shortHome();
  await as(home, async () => {
    writeProject(P, {
      folder: checkout, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
    await cloneState({ project: P, remoteUrl: remote.url });
    assert.equal((await takeLock({ project: P, push: plainPush })).taken, true);
  });
  return { remote, checkout, home };
}

const adapter = { defaultBranch: async () => 'main' };

async function withHelper(home, fn, options = {}) {
  return as(home, async () => {
    const helper = await startHelper({ address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), ...options });
    try {
      return await fn(helperClient({ address: helper.address }), helper);
    } finally {
      await helper.close();
    }
  });
}

test('the foreman\'s command runs in the main checkout outside the sandbox, and its output and exit code come back', async () => {
  const p = await project();
  try {
    await withHelper(p.home, async (client) => {
      assert.deepEqual(await client.foreman.run({ folder: p.checkout, script: 'wake', argv: ['measures'] }), {
        ok: true, code: 0, stdout: 'Idle wakes: 0 of 0 (0%). Conflicts per merge: 0.\n', stderr: '',
      });
      // A refusal is the script's own, in one line, with its exit code.
      const refused = await client.foreman.run({ folder: p.checkout, script: 'act', argv: ['merge', 'Not A Work Id'] });
      assert.deepEqual(refused, { ok: true, code: 1, stdout: '', stderr: 'Give the work id: lower-case letters, digits and hyphens, at most 40\n' });
      // Answered under STOP: the scripts say their own STOP holds.
      setStop({ by: 'prompt' });
      try {
        assert.equal((await client.foreman.run({ folder: p.checkout, script: 'wake', argv: ['measures'] })).code, 0);
      } finally { liftStop(); }
    });
  } finally { p.remote.cleanup(); }
});

test('the foreman\'s command runs only from the project\'s main checkout, and only act or wake', async () => {
  const p = await project();
  try {
    await withHelper(p.home, async (client) => {
      const worktree = path.join(p.checkout, '.claude', 'worktrees', 'export');
      fs.mkdirSync(worktree, { recursive: true });
      const inside = path.join(p.checkout, 'src');
      fs.mkdirSync(inside);
      for (const folder of [worktree, inside]) {
        assert.deepEqual(await client.foreman.run({ folder, script: 'wake', argv: ['measures'] }), NOT_MAIN, folder);
      }
      // A project the request names counts for nothing: the folder is placed from the records.
      assert.deepEqual(await client.foreman.run({ folder: worktree, project: P, script: 'wake', argv: ['measures'] }), NOT_MAIN);
      const elsewhere = fs.realpathSync.native(tempFolder('wh-elsewhere-'));
      assert.match((await client.foreman.run({ folder: elsewhere, script: 'wake', argv: ['measures'] })).refused, /not inside a Wheelhouse project/);
      assert.match((await client.foreman.run({ folder: 'main', script: 'wake', argv: ['measures'] })).refused, /full path/);
      for (const [script, argv] of [['runner', []], ['../act', []], ['act', 'merge x'], ['act', [1]], ['act', ['a\0b']], ['wake', Array(257).fill('x')]]) {
        const answer = await client.foreman.run({ folder: p.checkout, script, argv });
        assert.equal(answer.ok, false, JSON.stringify(script));
        assert.equal(answer.refused, foremanRequestRefusal({ script, argv }));
      }
    });
  } finally { p.remote.cleanup(); }
});

test('the foreman\'s command gets no key or secret, and none comes back in its output', async () => {
  const p = await project();
  const seen = [];
  const KEY = 'ghs_STANDINKEY0123456789abcdef';
  const run = async (file, args, options = {}) => {
    if (file !== process.execPath) return realRun(file, args, options);
    seen.push({ args, options });
    return { code: 0, stdout: `the key ${KEY}\n`, stderr: '' };
  };
  const planted = {
    GH_TOKEN: 'ghp_x', GITHUB_TOKEN: 'ghp_y', GITLAB_TOKEN: 'glpat_z', MY_SERVICE_SECRET: 's', DB_PASSWORD: 'p', AWS_SECRET_ACCESS_KEY: 'k',
    SSH_AUTH_SOCK: '/tmp/agent', GIT_DIR: '/x', GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic x', CLAUDECODE: '1', CLAUDE_CODE_SSE_PORT: '1', WHEELHOUSE_ROLE: 'feature',
  };
  const before = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  Object.assign(process.env, planted);
  try {
    await withHelper(p.home, async (client, helper) => {
      const answer = await client.foreman.run({ folder: p.checkout, script: 'act', argv: ['merge', 'export'] });
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.equal(answer.stdout.includes(KEY), false, 'the connection\'s key is scrubbed from the answer');
      assert.equal(seen.length, 1);
      const [{ args, options }] = seen;
      assert.deepEqual(args, [FOREMAN_RUNNER, helper.address, 'act', 'merge', 'export']);
      assert.equal(options.cwd, p.checkout);
      for (const name of Object.keys(planted)) assert.equal(name in options.baseEnv, false, name);
      assert.equal(options.baseEnv.WHEELHOUSE_HOME, p.home);
      assert.equal(options.baseEnv.PATH, process.env.PATH);
    }, { run, envFor: async () => ({ mode: 'narrow', env: { GH_TOKEN: KEY } }) });
  } finally {
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    p.remote.cleanup();
  }
  assert.deepEqual(foremanEnv({ PATH: '/bin', HOME: '/h', Wheelhouse_Role: 'x', npm_config__authToken: 't', LANG: 'en_AU.UTF-8' }), {
    PATH: '/bin', HOME: '/h', LANG: 'en_AU.UTF-8',
  });
});

test('a feature session\'s push names its worktree, and the helper places the project from it (R157)', async () => {
  const p = await project();
  try {
    const worktree = path.join(p.checkout, '.claude', 'worktrees', 'export');
    await g(p.checkout, 'worktree', 'add', '-q', '-b', 'feature/export', worktree, 'origin/main');
    fs.writeFileSync(path.join(worktree, 'export.js'), 'export const csv = true;\n');
    await g(worktree, 'add', '-A');
    await g(worktree, 'commit', '-q', '-m', 'The export');
    const head = await g(worktree, 'rev-parse', 'HEAD');
    await withHelper(p.home, async (client) => {
      assert.deepEqual(await client.push({ cwd: worktree, dir: worktree, refspec: 'feature/export' }), { ok: true });
      assert.equal(await g(p.remote.url, 'rev-parse', 'refs/heads/feature/export'), head);
      // The push rules still hold, and a name can't send the push to another project.
      assert.equal((await client.push({ cwd: worktree, dir: worktree, refspec: 'feature/export:main' })).ok, false);
      assert.deepEqual(await client.push({ cwd: worktree, project: 'o__other', dir: worktree, refspec: 'feature/export' }), {
        ok: false, refused: 'the folder given is not inside the project named',
      });
      const elsewhere = fs.realpathSync.native(tempFolder('wh-elsewhere-'));
      assert.match((await client.push({ cwd: elsewhere, dir: worktree, refspec: 'feature/export' })).refused, /not inside a Wheelhouse project/);
    });
  } finally { p.remote.cleanup(); }
});

test('the foreman\'s child keeps Claude Code\'s sign-in, as started sessions get it, and drops host keys and other secrets (R159)', () => {
  const signIn = Object.fromEntries(SIGN_IN_NAMES.map((name) => [name, `value-of-${name}`]));
  const env = {
    PATH: '/bin', ...signIn, GH_TOKEN: 'ghp_x', GITLAB_TOKEN: 'glpat_y', OTHER_SECRET: 'z',
    CLAUDE_CODE_OAUTH_TOKEN: 'host', anthropic_api_key: 'a spelling not kept',
  };
  assert.deepEqual(foremanEnv(env), { PATH: '/bin', ...signIn });
  // Each one kept is one the waker gives the sessions it starts: none is the host session's own.
  for (const name of SIGN_IN_NAMES) assert.equal(sessionEnv(env)[name], signIn[name], name);
  assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in sessionEnv(env), false, 'dropped for started sessions too');
});
