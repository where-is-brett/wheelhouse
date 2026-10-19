// tests/scripts/host/helper-foreman.test.js
// The helper runs the foreman's commands (ruling R156): /foreman/run takes the main checkout's
// folder, the script and its arguments, runs scripts/foreman/runner.js there outside the
// sandbox with no key or secret in its environment, and gives back the exit code and output.
// And a feature session's push and pull name its worktree, from which the helper places the
// project (ruling R157); a pull hands back the host's branch as a bundle (final review, I1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pull as cliPull } from '../../../scripts/feature/cli.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { envForConnection, startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { FOREMAN_RUNNER, SIGN_IN_NAMES, foremanEnv, foremanRequestRefusal } from '../../../scripts/host/foreman-run.js';
import { sessionEnv } from '../../../scripts/watcher/waker.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
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

test('the foreman\'s commands for one project wait their turn: a retry sent while the first runs starts once it ends (I2)', async () => {
  const p = await project();
  const spans = [];
  let running = 0;
  const run = async (file, args, options = {}) => {
    if (file !== process.execPath) return realRun(file, args, options);
    running += 1;
    const span = { argv: args.slice(2), overlapped: running > 1 };
    spans.push(span);
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    running -= 1;
    return { code: 0, stdout: `${args.slice(3).join(' ')}\n`, stderr: '' };
  };
  try {
    await withHelper(p.home, async (client) => {
      const ask = (argv) => client.foreman.run({ folder: p.checkout, script: 'act', argv });
      const answers = await Promise.all([ask(['start', 'export']), ask(['start', 'export']), ask(['merge', 'export'])]);
      assert.deepEqual(answers.map((a) => a.stdout), ['start export\n', 'start export\n', 'merge export\n']);
      assert.equal(spans.length, 3);
      assert.deepEqual(spans.map((sp) => sp.overlapped), [false, false, false], 'no command ran while another did');
      assert.deepEqual(spans.map((sp) => sp.argv), [['act', 'start', 'export'], ['act', 'start', 'export'], ['act', 'merge', 'export']], 'in the order they came');
    }, { run });
  } finally { p.remote.cleanup(); }
});

test('the foreman\'s commands still run once the narrow key is gone: the route uses no connection (m2)', async () => {
  const p = await project();
  try {
    await as(p.home, () => {
      writeProject(P, { ...readProject(P), connection: { host: 'github', mode: 'narrow', project: 'o/p' } });
    });
    const noFetch = async () => { throw new Error('no host in tests'); };
    const envFor = envForConnection((project) => readProject(project).connection, { fetch: noFetch });
    await withHelper(p.home, async (client) => {
      // No key file: the connection's environment can't be made.
      assert.equal((await client.push({ cwd: p.checkout, dir: p.checkout, refspec: 'feature/x' })).ok, false);
      const answer = await client.foreman.run({ folder: p.checkout, script: 'wake', argv: ['measures'] });
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.equal(answer.code, 0, answer.stderr);
    }, { envFor });
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
    GH_TOKEN: 'ghp_x', GITHUB_TOKEN: 'ghp_y', GITLAB_TOKEN: 'glpat_z', MY_SERVICE_SECRET: 's', DB_PASSWORD: 'p', CLOUDFLARE_API_TOKEN: 'k',
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

// A clone of the host on `branch`, standing in for whatever else moves the host's branch on:
// the gate bringing it up to date, or another push.
async function elsewhereOn(p, branch) {
  const other = fs.realpathSync.native(tempFolder('wh-other-'));
  await g(path.dirname(other), 'clone', '-q', '-b', branch, p.remote.url, other);
  return other;
}

async function commitIn(dir, file, text, message) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  await g(dir, 'add', '-A');
  await g(dir, 'commit', '-q', '-m', message);
  return g(dir, 'rev-parse', 'HEAD');
}

test('a feature session\'s pull brings the host\'s branch into its own, by fast-forward or a plain merge made by the helper, and refuses a conflict (I1)', async () => {
  const p = await project();
  const KEY = 'ghs_STANDINPULLKEY0123456789abcdef';
  try {
    const worktree = path.join(p.checkout, '.claude', 'worktrees', 'export');
    await g(p.checkout, 'worktree', 'add', '-q', '-b', 'feature/export', worktree, 'origin/main');
    fs.mkdirSync(featurePaths(worktree).dir, { recursive: true });
    const first = await commitIn(worktree, 'export.js', 'export const csv = true;\n', 'The export');
    await g(worktree, 'push', '-q', 'origin', 'feature/export');
    const other = await elsewhereOn(p, 'feature/export');
    await withHelper(p.home, async (client) => {
      const ask = (extra = {}) => client.pull({ cwd: worktree, dir: worktree, branch: 'feature/export', ...extra });
      // Nothing new on the host: nothing to bring in.
      assert.deepEqual(await ask(), { ok: true, already: true });

      // The host's branch moves on: a fast-forward, handed back as a bundle and brought in by the
      // session's own git.
      const moved = await commitIn(other, 'b.js', 'b\n', 'On the host');
      await g(other, 'push', '-q', 'origin', 'feature/export');
      const answer = await ask();
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.deepEqual({ ...answer, bundle: typeof answer.bundle }, { ok: true, already: false, merged: false, from: first, sha: moved, bundle: 'string' });
      assert.equal(JSON.stringify(answer).includes(KEY), false, 'no key comes back');
      assert.deepEqual(await cliPull({ client, worktree }), { branch: 'feature/export', already: false, merged: false, sha: moved });
      assert.equal(await g(worktree, 'rev-parse', 'HEAD'), moved);
      assert.equal(fs.readdirSync(featurePaths(worktree).dir).length, 0, 'the bundle is not left behind');

      // Both move on, as when the gate merges main in and the session commits a fix: the helper
      // makes the merge in its mirror, Wheelhouse its author, the session's commit first.
      await g(other, 'pull', '-q', '--ff-only');
      const onHost = await commitIn(other, 'c.js', 'c\n', 'On the host again');
      await g(other, 'push', '-q', 'origin', 'feature/export');
      const fix = await commitIn(worktree, 'export.js', 'export const csv = false;\n', 'A fix');
      const merged = await cliPull({ client, worktree });
      assert.equal(merged.merged, true);
      const head = await g(worktree, 'rev-parse', 'HEAD');
      assert.equal(merged.sha, head);
      assert.equal(await g(worktree, 'rev-parse', `${head}^@`), `${fix}\n${onHost}`);
      assert.equal(await g(worktree, 'log', '-1', '--format=%an <%ae>'), 'Wheelhouse <wheelhouse@invalid>');
      assert.equal(await g(worktree, 'status', '--porcelain'), '');
      // The host is unchanged: a pull only reads it.
      assert.equal(await g(p.remote.url, 'rev-parse', 'refs/heads/feature/export'), onHost);
      await g(worktree, 'push', '-q', 'origin', 'feature/export');

      // Both change the same line: nothing is brought in, and the files are named.
      await g(other, 'pull', '-q', '--ff-only');
      await commitIn(other, 'export.js', 'export const csv = 1;\n', 'One way');
      await g(other, 'push', '-q', 'origin', 'feature/export');
      const mine = await commitIn(worktree, 'export.js', 'export const csv = 2;\n', 'The other way');
      const conflict = await ask();
      assert.equal(conflict.ok, false);
      assert.match(conflict.refused, /the host's branch and this one change the same lines/);
      assert.deepEqual(conflict.conflicts, ['export.js']);
      await assert.rejects(cliPull({ client, worktree }), /export\.js/);
      assert.equal(await g(worktree, 'rev-parse', 'HEAD'), mine, 'nothing was brought in');

      // Only the worktree's own feature branch, from a folder in the project, and not under STOP.
      assert.match((await ask({ branch: 'feature/other' })).refused, /not the branch this folder is on/);
      assert.equal((await ask({ branch: 'main' })).ok, false);
      assert.equal((await ask({ branch: 'feature/export:main' })).ok, false);
      assert.deepEqual(await ask({ project: 'o__other' }), { ok: false, refused: 'the folder given is not inside the project named' });
      const elsewhere = fs.realpathSync.native(tempFolder('wh-elsewhere-'));
      assert.match((await client.pull({ cwd: elsewhere, dir: worktree, branch: 'feature/export' })).refused, /not inside a Wheelhouse project/);
      assert.match((await ask({ dir: p.checkout, branch: 'main' })).refused, /default branch|feature/);
      setStop({ by: 'prompt' });
      try {
        assert.deepEqual(await ask(), { ok: false, refused: 'STOP is on' });
      } finally { liftStop(); }

      // A branch the host doesn't hold yet.
      const fresh = path.join(p.checkout, '.claude', 'worktrees', 'fresh');
      await g(p.checkout, 'worktree', 'add', '-q', '-b', 'feature/fresh', fresh, 'origin/main');
      assert.match((await client.pull({ cwd: fresh, dir: fresh, branch: 'feature/fresh' })).refused, /has no branch feature\/fresh yet/);
    }, { envFor: async () => ({ mode: 'narrow', env: { GH_TOKEN: KEY } }) });
  } finally { p.remote.cleanup(); }
});

test('the foreman\'s child keeps Claude Code\'s sign-in, as started sessions get it, and drops host keys and other secrets (R159)', () => {
  const signIn = Object.fromEntries(SIGN_IN_NAMES.map((name) => [name, `value-of-${name}`]));
  const env = {
    PATH: '/bin', ...signIn, GH_TOKEN: 'ghp_x', GITLAB_TOKEN: 'glpat_y', OTHER_SECRET: 'z',
    CLAUDE_CODE_OAUTH_TOKEN: 'host', anthropic_api_key: 'a spelling not kept',
  };
  assert.deepEqual(foremanEnv(env), { PATH: '/bin', ...signIn });
  // Each one kept that the host session doesn't set is one the waker gives the sessions it starts.
  for (const name of SIGN_IN_NAMES.filter((n) => !/^claude/i.test(n))) assert.equal(sessionEnv(env)[name], signIn[name], name);
  assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in sessionEnv(env), false, 'dropped for started sessions too');
});

test('the foreman\'s child keeps the sign-in Claude Code uses for Bedrock and Vertex, and still no host key or Wheelhouse secret (m3)', () => {
  const cloud = {
    CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_MANTLE: '1', CLAUDE_CODE_USE_VERTEX: '1',
    AWS_ACCESS_KEY_ID: 'AKIA-stand-in', AWS_SECRET_ACCESS_KEY: 'secret-stand-in', AWS_SESSION_TOKEN: 'session-stand-in',
    AWS_PROFILE: 'work', AWS_REGION: 'ap-southeast-2', AWS_DEFAULT_REGION: 'ap-southeast-2',
    AWS_SHARED_CREDENTIALS_FILE: '/h/.aws/credentials', AWS_CONFIG_FILE: '/h/.aws/config', AWS_BEARER_TOKEN_BEDROCK: 'bearer-stand-in',
    ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock.example.com', CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
    GOOGLE_APPLICATION_CREDENTIALS: '/h/adc.json', ANTHROPIC_VERTEX_PROJECT_ID: 'p', CLOUD_ML_REGION: 'global',
    GOOGLE_CLOUD_PROJECT: 'p', VERTEX_REGION_CLAUDE_HAIKU_4_5: 'us-east5', CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
  };
  for (const name of Object.keys(cloud).filter((n) => !n.startsWith('VERTEX_REGION_'))) assert.ok(SIGN_IN_NAMES.includes(name), name);
  const env = {
    PATH: '/bin', ...cloud,
    GH_TOKEN: 'ghp_x', GITHUB_TOKEN: 'ghp_y', GITLAB_TOKEN: 'glpat_z', SSH_AUTH_SOCK: '/tmp/agent', WHEELHOUSE_SIGNING_SECRET: 's',
    MY_SERVICE_TOKEN: 't', CLAUDECODE: '1', CLAUDE_CODE_OAUTH_TOKEN: 'host', ANTHROPIC_BASE_URL: 'https://gateway.example.com',
    aws_secret_access_key: 'a spelling not kept',
  };
  assert.deepEqual(foremanEnv(env), { PATH: '/bin', ...cloud });
});
