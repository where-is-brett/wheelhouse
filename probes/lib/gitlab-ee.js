// probes/lib/gitlab-ee.js
// A GitLab Enterprise Edition container on this computer, standing in for a company's own
// GitLab behind its own certificate authority (check 71). It runs only on 127.0.0.1.
// Secrets (the root token, the runner's token, people's passwords and tokens) are kept in
// `<dir>/state/`, mode 600, and are never printed or put in a program's arguments: they reach a
// child through standard input, a file, or its environment. The functions return the names of
// those files, never the secrets.
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { run } from '../../scripts/lib/run.js';
import { gitlabApi } from '../../scripts/host/gitlab-key.js';
import { makeTestCa } from './test-ca.js';

export const GITLAB_EE_TAG = '19.4.2-ee.0';
export const GITLAB_EE_IMAGE = `gitlab/gitlab-ee:${GITLAB_EE_TAG}`;
export const RUNNER_IMAGE = 'gitlab/gitlab-runner:alpine-v19.4.1';
export const DEFAULT_PORT = 8929;

const LABEL = 'wheelhouse-probe=gitlab-ee';
const MINUTE = 60 * 1000;

// Names of everything the instance makes on Docker, so stopGitlab can find them.
export function names(port = DEFAULT_PORT) {
  const base = `wheelhouse-gitlab-ee-${port}`;
  return {
    gitlab: base,
    runner: `${base}-runner`,
    volumes: ['config', 'data', 'logs', 'runner'].map((kind) => `${base}-${kind}`),
  };
}

export const stateDir = (dir) => path.join(dir, 'state');

// Writes a secret to a file only its owner can read.
export function writeSecret(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

const readSecret = (file) => fs.readFileSync(file, 'utf8').trim();

// Every call is bounded: two minutes, or more where the caller says (`run` may pull an image).
const SHORT = 2 * MINUTE;
const LONG = 30 * MINUTE;

async function docker(args, options = {}) {
  return run('docker', args, { timeoutMs: SHORT, ...options });
}

// The failure text names the step only: Docker's own output could quote a secret.
async function mustDocker(step, args, options) {
  const result = await docker(args, options);
  if (result.code !== 0) throw new Error(`Docker could not ${step} (exit ${result.code})`);
  return result;
}

// The omnibus settings: HTTPS on `port` with the throwaway certificate, no Let's Encrypt, and
// the smallest memory the instance runs in.
export function omnibusConfig(port) {
  return [
    `external_url 'https://localhost:${port}'`,
    "letsencrypt['enable'] = false",
    "nginx['ssl_certificate'] = '/etc/gitlab/ssl/localhost.crt'",
    "nginx['ssl_certificate_key'] = '/etc/gitlab/ssl/localhost.key'",
    "gitlab_rails['monitoring_whitelist'] = ['0.0.0.0/0', '::/0']",
    "puma['worker_processes'] = 0",
    "sidekiq['max_concurrency'] = 5",
    "prometheus_monitoring['enable'] = false",
    "gitlab_kas['enable'] = false",
    "postgresql['shared_buffers'] = '128MB'",
    "gitlab_rails['usage_ping_enabled'] = false",
    '',
  ].join('\n');
}

// A fetch (just enough for gitlabApi: `status` and `text()`) that trusts the throwaway authority.
export function fetchTrusting(caFile) {
  const ca = fs.readFileSync(caFile);
  return (url, { method = 'GET', headers = {}, body, timeoutMs = 60000 } = {}) => new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers, ca, timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, text: async () => text });
      });
    });
    request.on('timeout', () => request.destroy(new Error('timed out')));
    request.on('error', reject);
    request.end(body);
  });
}

// Polls /-/readiness until it answers 200, giving up after `limitMs` or when the container stops.
export async function waitForReadiness({ baseUrl, caFile, container, limitMs = 20 * MINUTE, intervalMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const fetch = fetchTrusting(caFile);
  const started = Date.now();
  for (;;) {
    try {
      const answer = await fetch(`${baseUrl}/-/readiness`, { timeoutMs: 10000 });
      if (answer.status === 200) return Date.now() - started;
    } catch { /* not listening yet */ }
    if (Date.now() - started > limitMs) throw new Error('GitLab was not ready in time');
    const state = await docker(['inspect', '--format', '{{.State.Running}}', container]);
    // A container that can't be inspected is gone, which is as good as stopped.
    if (state.code !== 0 || state.stdout.trim() === 'false') throw new Error('The GitLab container stopped before it was ready');
    await sleep(intervalMs);
  }
}

const ROOT_TOKEN_SCRIPT = [
  "user = User.find_by_username('root')",
  "token = user.personal_access_tokens.build(name: 'wheelhouse-probe', scopes: [:api, :sudo], expires_at: 300.days.from_now)",
  'token.save!',
  'puts "WHEELHOUSE_TOKEN=#{token.token}"',
  '',
].join('\n');

// Starts the instance: certificate, container, readiness, and the root's token. Returns
// { baseUrl, rootToken, rootTokenFile, caFile, readyAfterMs }; `rootToken` is the path of the
// file holding the token, never the token. `wait` is for tests.
export async function startGitlab({ dir, port = DEFAULT_PORT, wait } = {}) {
  const state = stateDir(dir);
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const tlsDir = path.join(state, 'tls');
  const { caPem, certPem, keyPem } = makeTestCa(tlsDir);
  const name = names(port);
  const baseUrl = `https://localhost:${port}`;
  const began = Date.now();
  const [config, data, logs] = name.volumes;

  const started = await docker([
    'run', '--detach', '--name', name.gitlab, '--hostname', 'localhost', '--shm-size', '256m',
    '--label', LABEL,
    '--publish', `127.0.0.1:${port}:${port}`,
    '--volume', `${config}:/etc/gitlab`, '--volume', `${data}:/var/opt/gitlab`, '--volume', `${logs}:/var/log/gitlab`,
    '--volume', `${certPem}:/etc/gitlab/ssl/localhost.crt:ro`,
    '--volume', `${keyPem}:/etc/gitlab/ssl/localhost.key:ro`,
    '--env', `GITLAB_OMNIBUS_CONFIG=${omnibusConfig(port)}`,
    GITLAB_EE_IMAGE,
  ], { timeoutMs: LONG });
  if (started.code !== 0) {
    // A name already in use means an instance of an earlier call: it is not this call's to undo.
    if (!/already in use/i.test(started.stderr)) await undo(dir, port);
    throw new Error(`Docker could not start GitLab (exit ${started.code})`);
  }

  try {
    const waiting = wait ?? (() => waitForReadiness({ baseUrl, caFile: caPem, container: name.gitlab }));
    await waiting();
    const readyAfterMs = Date.now() - began;

    // The script goes in on standard input; the token comes back on standard output and goes
    // straight to the file.
    const made = await docker(['exec', '-i', name.gitlab, 'gitlab-rails', 'runner', '-'], { input: ROOT_TOKEN_SCRIPT, timeoutMs: 10 * MINUTE });
    const match = /^WHEELHOUSE_TOKEN=(\S+)$/m.exec(made.stdout);
    if (made.code !== 0 || match === null) throw new Error(`GitLab did not make the root's token (exit ${made.code})`);
    const rootTokenFile = path.join(state, 'root-token');
    writeSecret(rootTokenFile, `${match[1]}\n`);
    return { baseUrl, rootToken: rootTokenFile, rootTokenFile, caFile: caPem, readyAfterMs };
  } catch (error) {
    await undo(dir, port);
    throw error;
  }
}

// Undoes a failed call, as far as it can: errors from the undoing are not reported over the
// failure that led to it.
async function undo(dir, port) {
  try { await stopGitlab({ dir, port }); } catch { /* the first failure is the one to report */ }
}

// An API client for `baseUrl` that trusts the throwaway authority, with the token read from a file.
export function apiFor({ baseUrl, caFile, tokenFile }) {
  return gitlabApi({ baseUrl, token: readSecret(tokenFile), fetch: fetchTrusting(caFile) });
}

// Makes an instance runner (through the API), registers it with the shell executor and starts it
// in a container that shares GitLab's network, so https://localhost:<port> reaches GitLab from
// inside it and the certificate's name matches. `token` is the path of the file holding the
// root's token. Returns { runnerId, runnerTokenFile }.
export async function startRunner({ dir, baseUrl, token, tokenFile = token, port = DEFAULT_PORT }) {
  const state = stateDir(dir);
  const name = names(port);
  const caFile = path.join(state, 'tls', 'ca.pem');
  const api = apiFor({ baseUrl, caFile, tokenFile });
  const made = await api.post('/user/runners', { runner_type: 'instance_type', description: 'wheelhouse-probe-runner', run_untagged: true });
  if (made.status !== 201 || typeof made.body?.token !== 'string') throw new Error(`GitLab did not make a runner (HTTP ${made.status})`);
  const runnerTokenFile = path.join(state, 'runner-token');
  try {
    writeSecret(runnerTokenFile, `${made.body.token}\n`);
    const env = { CI_SERVER_TOKEN: made.body.token };
    const [, , , configVolume] = name.volumes;
    const common = [
      '--network', `container:${name.gitlab}`,
      '--volume', `${configVolume}:/etc/gitlab-runner`,
      '--volume', `${caFile}:/certs/ca.pem:ro`,
    ];
    // The token is in the child's environment only (`--env NAME` names it, with no value).
    await mustDocker('register the runner', [
      'run', '--rm', '--label', LABEL, ...common, '--env', 'CI_SERVER_TOKEN', RUNNER_IMAGE,
      'register', '--non-interactive', '--url', baseUrl, '--executor', 'shell', '--tls-ca-file', '/certs/ca.pem',
    ], { env, timeoutMs: LONG });
    await mustDocker('start the runner', ['run', '--detach', '--name', name.runner, '--label', LABEL, ...common, RUNNER_IMAGE], { timeoutMs: LONG });
    return { runnerId: made.body.id, runnerTokenFile };
  } catch (error) {
    // Undo what this call made; the instance itself is left as it was.
    await docker(['rm', '--force', name.runner]);
    await docker(['volume', 'rm', '--force', name.volumes[3]]);
    try { await api.delete(`/runners/${made.body.id}`); } catch { /* best effort */ }
    fs.rmSync(runnerTokenFile, { force: true });
    throw error;
  }
}

const PERSON_SCOPES = ['api', 'read_repository', 'write_repository'];

// Makes two users (as the root, through `api`) with generated passwords and a personal access
// token each, kept under `<dir>/state/people/`. Returns
// { maintainer, second }, each { id, username, passwordFile, tokenFile }.
export async function makeTestPeople(api, { dir, now = () => new Date() } = {}) {
  const people = path.join(stateDir(dir), 'people');
  const expires = new Date(now().getTime() + 300 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = {};
  for (const role of ['maintainer', 'second']) {
    const username = `wh-${role}`;
    const password = crypto.randomBytes(24).toString('base64url');
    const user = await api.post('/users', {
      email: `${username}@example.test`, username, name: `Wheelhouse ${role}`, password, skip_confirmation: true,
    });
    if (user.status !== 201 || typeof user.body?.id !== 'number') throw new Error(`GitLab did not make the ${role} user (HTTP ${user.status})`);
    const passwordFile = path.join(people, `${role}.password`);
    writeSecret(passwordFile, `${password}\n`);
    const token = await api.post(`/users/${user.body.id}/personal_access_tokens`, { name: 'wheelhouse-probe', scopes: PERSON_SCOPES, expires_at: expires });
    if (token.status !== 201 || typeof token.body?.token !== 'string') throw new Error(`GitLab did not make the ${role} user's token (HTTP ${token.status})`);
    const tokenFile = path.join(people, `${role}.token`);
    writeSecret(tokenFile, `${token.body.token}\n`);
    result[role] = { id: user.body.id, username, passwordFile, tokenFile };
  }
  return result;
}

// Stops the instance. With `remove` (the default) the containers, their volumes and the state
// folder (certificates, tokens, passwords) go; without it the containers are only stopped.
export async function stopGitlab({ dir, port = DEFAULT_PORT, remove = true } = {}) {
  const name = names(port);
  if (!remove) {
    await mustDocker('stop the runner', ['stop', name.runner]);
    await mustDocker('stop GitLab', ['stop', name.gitlab]);
    return;
  }
  // Only "no such container/volume" counts as already gone. Anything left is named in the error,
  // and the state folder (the only record of the tokens) stays until nothing is left.
  const left = [];
  const attempt = async (what, args) => {
    const done = await docker(args);
    if (done.code !== 0 && !/no such/i.test(done.stderr)) left.push(what);
  };
  await attempt(`container ${name.runner}`, ['rm', '--force', name.runner]);
  await attempt(`container ${name.gitlab}`, ['rm', '--force', name.gitlab]);
  for (const volume of name.volumes) await attempt(`volume ${volume}`, ['volume', 'rm', '--force', volume]);
  if (left.length > 0) throw new Error(`Docker could not remove: ${left.join(', ')}. The state folder was kept.`);
  fs.rmSync(stateDir(dir), { recursive: true, force: true });
}
