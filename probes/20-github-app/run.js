// probes/20-github-app/run.js
// Check 20: signs in to the test GitHub App, then tries what its key can and
// cannot do. Usage: node run.js <clientId> <appSlug> <owner/repo-a>
// Repository -a has the app installed; -b is the second scratch repository,
// found by swapping the ending of the first name.
// Keys are held in memory only: they are never printed, logged or passed as a
// process argument. gh's key is read from `gh auth token` on stdout.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { askSecret } from '../../scripts/secrets/secret-box.js';
import { startDeviceSignIn, waitForSignIn, renewKeys, installUrl } from '../../scripts/host/github-app.js';

const execFileAsync = promisify(execFile);
const API = 'https://api.github.com';
const secrets = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const [clientId, appSlug, repoA] = process.argv.slice(2);
if (!clientId || !appSlug || !/^[^/]+\/[^/]+-a$/.test(repoA ?? '')) {
  console.error('Usage: node run.js <clientId> <appSlug> <owner/repo-a>   (the first repository name ends in -a)');
  process.exit(2);
}
const [owner, nameA] = repoA.split('/');
const nameB = nameA.replace(/-a$/, '-b');
const logFile = path.join(probeLogDir('20-github-app', os.homedir()), 'trials.jsonl');

function hold(key) {
  if (key) secrets.add(key);
  return key;
}

// Anything printed passes through here, so a key can't appear even by accident.
function scrub(text) {
  let clean = String(text);
  for (const secret of secrets) clean = clean.replaceAll(secret, '[key]');
  return clean;
}

function openPage(url) {
  const [file, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  execFileAsync(file, args).catch(() => {});
}

async function api(key, method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON: a 204 has no body */ }
  return { status: response.status, ok: response.ok, json, message: json?.message ?? '' };
}

function describe(response) {
  return `HTTP ${response.status}${response.message ? ` ${response.message.slice(0, 100)}` : ''}`;
}

async function trial(what, expected, run) {
  const started = Date.now();
  let result;
  try {
    result = scrub(await run());
  } catch (error) {
    result = scrub(`error: ${error.message}`);
  }
  const ms = Date.now() - started;
  console.log(`${what} | expected: ${expected} | result: ${result} | ${ms} ms`);
  await appendJsonl(logFile, { what, expected, result, ms });
}

async function ghKey() {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    return hold(stdout.trim());
  } catch {
    return null;
  }
}

// 1. Sign in with the device code.
const sign = await startDeviceSignIn({ clientId });
console.log(`Type this code: ${sign.userCode}`);
console.log(`on this page: ${sign.verificationUri}`);
openPage(sign.verificationUri);
let keys = await waitForSignIn({ clientId, deviceCode: sign.deviceCode, interval: sign.interval });
hold(keys.accessToken);
hold(keys.refreshToken);
console.log('Signed in. Opening the install page.');
console.log(installUrl(appSlug));
openPage(installUrl(appSlug));

// 2. Wait for the installation to show (the director installs on -a only).
let installation;
for (let waited = 0; waited < 300 && !installation; waited += 3) {
  const found = await api(keys.accessToken, 'GET', '/user/installations');
  installation = found.json?.installations?.find((one) => one.app_slug === appSlug);
  if (!installation) await sleep(3000);
}
if (!installation) {
  console.error('The app was not installed within five minutes.');
  process.exit(1);
}

const gh = await ghKey();
const repoIdOfB = gh ? (await api(gh, 'GET', `/repos/${owner}/${nameB}`)).json?.id : undefined;

// 3. The trials.
await trial('list the installations the app key can see', `1 installation, repositories: ${nameA} only`, async () => {
  const listed = await api(keys.accessToken, 'GET', '/user/installations');
  const repos = await api(keys.accessToken, 'GET', `/user/installations/${installation.id}/repositories`);
  const names = (repos.json?.repositories ?? []).map((repo) => repo.name).join(', ');
  return `${listed.json?.total_count ?? '?'} installation(s), repositories: ${names || describe(repos)}`;
});

const tag = crypto.randomBytes(3).toString('hex');
const branch = `wheelhouse-check-20-${tag}`;
const encode = (text) => Buffer.from(text, 'utf8').toString('base64');
let pull;
await trial('push a branch to the scratch repository', 'created', async () => {
  const base = await api(keys.accessToken, 'PUT', `/repos/${repoA}/contents/check-20-${tag}-base.txt`, { message: 'Check 20: first file', content: encode('base\n') });
  if (!base.ok) return `first file: ${describe(base)}`;
  const ref = await api(keys.accessToken, 'POST', `/repos/${repoA}/git/refs`, { ref: `refs/heads/${branch}`, sha: base.json.commit.sha });
  if (!ref.ok) return `branch: ${describe(ref)}`;
  const change = await api(keys.accessToken, 'PUT', `/repos/${repoA}/contents/check-20-${tag}-change.txt`, { message: 'Check 20: a change', content: encode('change\n'), branch });
  return change.ok ? `created ${branch}` : `change: ${describe(change)}`;
});
await trial('open a pull request', 'created', async () => {
  const repo = await api(keys.accessToken, 'GET', `/repos/${repoA}`);
  const opened = await api(keys.accessToken, 'POST', `/repos/${repoA}/pulls`, { title: `Check 20 ${tag}`, head: branch, base: repo.json?.default_branch ?? 'main' });
  pull = opened.json?.number;
  return opened.ok ? `opened #${pull}` : describe(opened);
});
await trial('close the pull request', 'closed', async () => {
  if (!pull) return 'skipped: no pull request was opened';
  const closed = await api(keys.accessToken, 'PATCH', `/repos/${repoA}/pulls/${pull}`, { state: 'closed' });
  return closed.ok ? `closed #${pull}` : describe(closed);
});

const addRoute = `/user/installations/${installation.id}/repositories/${repoIdOfB}`;
await trial(`add ${nameB} to the installation with the app's key`, 'refused', async () => {
  if (!repoIdOfB) return 'skipped: gh could not look up the second repository';
  return describe(await api(keys.accessToken, 'PUT', addRoute));
});
await trial(`add ${nameB} to the installation with gh's key`, 'accepted (HTTP 204)', async () => {
  if (!repoIdOfB) return 'skipped: gh could not look up the second repository';
  return describe(await api(gh, 'PUT', addRoute));
});

await trial('change the repository description with the app\'s key', 'refused', async () => (
  describe(await api(keys.accessToken, 'PATCH', `/repos/${repoA}`, { description: `Check 20 ${tag}` }))
));

await trial('renew the keys without the client secret', 'refused', async () => {
  keys = await renewKeys({ clientId, refreshToken: keys.refreshToken });
  hold(keys.accessToken);
  hold(keys.refreshToken);
  return `renewed, new access key expires ${keys.accessExpiresAt}`;
});
await trial('renew the keys with the client secret', 'renewed', async () => {
  const clientSecret = hold(await askSecret({ title: 'Wheelhouse check 20', prompt: 'Paste the test app\'s client secret (from its settings page).' }));
  keys = await renewKeys({ clientId, clientSecret, refreshToken: keys.refreshToken });
  hold(keys.accessToken);
  hold(keys.refreshToken);
  return `renewed, new access key expires ${keys.accessExpiresAt}`;
});
