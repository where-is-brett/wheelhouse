// tests/probes/71-gitlab-self-managed/run.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../../scripts/lib/run.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import {
  STEPS, planText, parseArgs, makeRecorder, makeContext, step3, whereToken, portFree, glabEnv, gitEnv, TOKEN_SETTING,
} from '../../../probes/71-gitlab-self-managed/run.js';
import { tokenShaped } from '../../../probes/71-gitlab-self-managed/scrub.js';

const SCRIPT = fileURLToPath(new URL('../../../probes/71-gitlab-self-managed/run.js', import.meta.url));
const PAT = `glpat-${'aB3_x9Zq'.repeat(3)}`;

const stands = standInTools();
after(() => stands.restore());

test('the plan names every step, the group, the project and the undo, and says nothing was run', () => {
  const text = planText({ dir: '/probe' });
  for (const step of STEPS) assert.ok(text.includes(`Step ${step.n}, ${step.title}`), step.title);
  assert.match(text, /wh71-probe\/trial/);
  assert.match(text, /Nothing was run/);
  assert.match(text, /leave the containers running/);
  assert.equal(STEPS.length, 8);
});

test('arguments: --yes, --dry-run, --steps, --keep, and nothing else', () => {
  assert.deepEqual(parseArgs([]), { yes: false, dryRun: false, steps: [1, 2, 3, 4, 5, 6, 7, 8], keep: false });
  assert.deepEqual(parseArgs(['--yes', '--steps', '3,4,99', '--keep']), { yes: true, dryRun: false, steps: [3, 4], keep: true });
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.throws(() => parseArgs(['--insecure']), /Unknown option/);
});

test('run with no --yes, or with --dry-run, starts no tool at all', async () => {
  stands.reset();
  for (const args of [[], ['--dry-run'], ['--yes', '--dry-run']]) {
    const done = await run(process.execPath, [SCRIPT, ...args], { timeoutMs: 30000 });
    assert.equal(done.code, 0, done.stderr);
    assert.match(done.stdout, /Nothing was run/);
  }
  assert.deepEqual(stands.calls(), [], 'no real gh, glab, copilot, docker-adjacent or system tool ran');
  const bad = await run(process.execPath, [SCRIPT, '--bogus'], { timeoutMs: 30000 });
  assert.equal(bad.code, 2);
  assert.deepEqual(stands.calls(), []);
});

test('the probe and its scrubber use no way round certificate checks', () => {
  for (const file of ['run.js', 'scrub.js']) {
    const text = fs.readFileSync(path.join(path.dirname(SCRIPT), file), 'utf8');
    assert.doesNotMatch(text, /NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*['"]?0/, file);
    assert.doesNotMatch(text, /GIT_SSL_NO_VERIFY\s*[:=]\s*['"]?(?:1|true)/i, file);
    assert.doesNotMatch(text, /sslVerify\s*=\s*false/i, file);
    assert.doesNotMatch(text, /skip_tls_verify[^\n]*true/i, file);
    assert.doesNotMatch(text, /['"]-k['"]|--insecure['"]|rejectUnauthorized:\s*false/, file);
    assert.doesNotMatch(text, /use-keyring/, file);
  }
});

test('glab and git get environments of their own: no keys from the caller, no browser, no keyring flag', () => {
  const dir = tempFolder('wh71-env-');
  const ctx = makeContext({ dir, io: {} });
  const was = { GITLAB_TOKEN: process.env.GITLAB_TOKEN, GIT_SSL_NO_VERIFY: process.env.GIT_SSL_NO_VERIFY };
  process.env.GITLAB_TOKEN = 'the-callers-own-token';
  try {
    const env = glabEnv(ctx, path.join(dir, 'g'), { GITLAB_HOST: 'localhost:8929' });
    assert.equal(env.GITLAB_TOKEN, undefined);
    assert.equal(env.GLAB_CONFIG_DIR, path.join(dir, 'g'));
    assert.equal(env.GLAB_SEND_TELEMETRY, 'false');
    assert.ok(env.PATH.startsWith(path.join(dir, 'state', 'scratch', 'bin')));
    for (const name of ['open', 'xdg-open']) assert.match(fs.readFileSync(path.join(dir, 'state', 'scratch', 'bin', name), 'utf8'), /opened\.txt/);
    const git = gitEnv(ctx, { token: PAT, withCa: false });
    assert.equal(git.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(fs.readFileSync(git.GIT_CONFIG_GLOBAL, 'utf8'), '');
    const withCa = gitEnv(ctx, { token: PAT, withCa: true });
    assert.match(fs.readFileSync(withCa.GIT_CONFIG_GLOBAL, 'utf8'), /\[http "https:\/\/localhost:8929\/"\]\n\tsslCAInfo = .*ca\.pem/);
    assert.ok(ctx.rec.secrets.size > 0, 'the basic-auth text is held for scrubbing');
  } finally {
    if (was.GITLAB_TOKEN === undefined) delete process.env.GITLAB_TOKEN; else process.env.GITLAB_TOKEN = was.GITLAB_TOKEN;
  }
});

test('the recorder scrubs what it prints and what it saves, and refuses a fixture that still holds a token shape', () => {
  const fixtures = tempFolder('wh71-fix-');
  const lines = [];
  const rec = makeRecorder({ fixtureDir: fixtures, home: '/Users/someone', probe: '/probe', log: (line) => lines.push(line) });
  rec.hold('mysecretvalue1');
  rec.at(1);
  rec.trial('a trial', 'result with mysecretvalue1 and /Users/someone/x');
  rec.exchange('call', { as: 'maintainer', method: 'POST', path: '/projects/7/variables', body: { key: 'PROBE_SECRET', value: 'mysecretvalue1' } }, { status: 201, body: { id: 5, token: PAT, created_at: '2026-10-21T01:02:03Z' } });
  rec.command('a command', 'glab api user', { code: 0, stdout: `ok ${PAT}`, stderr: '' });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /mysecretvalue1|\/Users\/someone/);
  const file = rec.save({ n: 1, slug: 'certificates', title: 'Certificates' });
  const saved = fs.readFileSync(file, 'utf8');
  assert.deepEqual(tokenShaped(saved), []);
  assert.doesNotMatch(saved, /mysecretvalue1|glpat-|2026-10-21T01|\/Users\/someone/);
  assert.match(saved, /<TOKEN>/);
  assert.match(saved, /<VALUE>/);
  assert.match(saved, /<TIMESTAMP>/);

  // Something held as a secret that reached a fixture by a route that skipped the recorder's scrubbing
  // is caught on the way out.
  const other = makeRecorder({ fixtureDir: fixtures, log: () => {} });
  other.hold('anothersecret2');
  other.at(2);
  other.trial('x', 'fine');
  other.books.get(2).trials.push({ what: 'late', result: 'anothersecret2 leaked in' });
  assert.throws(() => other.save({ n: 2, slug: 'sign-in', title: 'Sign-in' }), /not written/);
  assert.equal(fs.existsSync(path.join(fixtures, 'step-2-sign-in.json')), false);
});

test('whereToken counts a token in a config folder, by key and mode', () => {
  const dir = tempFolder('wh71-where-');
  fs.writeFileSync(path.join(dir, 'config.yml'), `hosts:\n    h:\n        token: ${PAT}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'aliases.yml'), 'a: b\n');
  assert.deepEqual(whereToken(dir, PAT), [{ file: 'config.yml', count: 1, key: 'token', mode: '600' }]);
  assert.deepEqual(whereToken(dir, 'not-there-at-all'), []);
});

// Step 3 against a stand-in GitLab: the setting is switched by the console, and the key call is
// refused while it is off. No Docker, no network.
test('step 3 records the key, the setting switched off and the refusal, and prints no token', async () => {
  const dir = tempFolder('wh71-step3-');
  fs.mkdirSync(path.join(dir, 'state', 'people'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state', 'people', 'maintainer.token'), `${PAT}\n`);
  let allowed = true;
  const calls = { docker: [], api: [] };
  const fakeApi = () => {
    const send = (method) => async (apiPath, body) => {
      calls.api.push(`${method} ${apiPath}`);
      if (method === 'POST' && /\/access_tokens$/.test(apiPath)) {
        return allowed ? { status: 201, body: { id: 9, token: `glpat-${'Zz9_'.repeat(6)}`, expires_at: '2026-10-22' } } : { status: 400, body: { message: '400 Bad request - User does not have permission to create project access token' } };
      }
      if (method === 'GET' && /\/access_tokens$/.test(apiPath)) return { status: 200, body: [{ id: 9, user_id: 4 }] };
      if (method === 'GET' && apiPath === '/user') return { status: 200, body: { username: 'project_2_bot_x', bot: true } };
      if (method === 'GET' && /^\/groups\//.test(apiPath)) return { status: 200, body: { id: 1 } };
      if (method === 'PUT' && /^\/groups\//.test(apiPath)) return { status: 200, body: { id: 1 } };
      if (method === 'GET' && /^\/projects\/2$/.test(apiPath)) return { status: 200, body: { id: 2 } };
      return { status: 200, body: null };
    };
    return { get: send('GET'), post: send('POST'), put: send('PUT'), delete: send('DELETE') };
  };
  const fakeRun = async (file, args, options = {}) => {
    calls.docker.push(`${file} ${args[0]} ${args[2]}`);
    const statement = String(args[args.length - 1]);
    if (/SET resource_access_token_creation_allowed = false/.test(statement)) allowed = false;
    if (/SET resource_access_token_creation_allowed = true/.test(statement)) allowed = true;
    return { code: 0, stdout: `${allowed ? 't' : 'f'}\n`, stderr: '' };
  };
  const lines = [];
  const rec = makeRecorder({ probe: dir, fixtureDir: path.join(dir, 'fixtures'), log: (line) => lines.push(line) });
  const ctx = makeContext({ dir, rec, io: { run: fakeRun, apiFor: fakeApi, sleep: async () => {}, waitForReadiness: async () => 0 } });
  ctx.group = { id: 1 };
  ctx.project = { id: 2 };
  rec.at(3);
  await step3(ctx);
  const said = lines.join('\n');
  assert.match(said, new RegExp(`the group setting ${TOKEN_SETTING}, as the group stands \\| true`));
  assert.match(said, /makeProjectKey as the maintainer, setting on \| created/);
  assert.match(said, /setting off \| refused with Wheelhouse's message: GitLab refused the request for a project key \(HTTP 400\)/);
  assert.match(said, /User does not have permission to create project access token/);
  assert.match(said, /the setting switched back on \| true/);
  assert.deepEqual(tokenShaped(said), []);
  assert.equal(allowed, true, 'the setting is back on');
  assert.ok(calls.docker.length >= 3 && calls.docker.every((one) => one === 'docker exec gitlab-psql'), 'only the database was asked of Docker');
  assert.deepEqual(stands.calls(), [], 'no real tool ran');
  const file = rec.save({ n: 3, slug: 'project-key', title: 'The project key' });
  assert.deepEqual(tokenShaped(fs.readFileSync(file, 'utf8')), []);
});

test('portFree says whether something already listens on a port', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  assert.equal(await portFree(port), false);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await portFree(port), true);
});
