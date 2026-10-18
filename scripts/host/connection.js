// scripts/host/connection.js
// The two ways the helper reaches the host (design section 11), and the
// environment it gives `gh`, `glab` and `git` for each.
//
//   Connection = {
//     host: 'github' | 'gitlab',
//     mode: 'quick' | 'narrow',
//     project: 'owner/name',
//     projectId?: number,   GitLab narrow: the project's number, naming its key
//     baseUrl?: string,     GitLab: the GitLab address (default https://gitlab.com)
//     locked?: boolean,     the project's protection level is Locked
//   }
//
// It is kept in the project's settings and holds no secret. Quick uses the
// director's own sign-in, so the tools are given nothing. Narrow uses the
// Wheelhouse GitHub App's keys or a GitLab project's key, which reach the
// tools only through their environment, never an argument. No function here
// returns a key other than in that environment, or logs or throws one.
import { renewKeys } from './github-app.js';
import { checkBaseUrl } from './gitlab-key.js';
import { readKey, writeKey } from './keys.js';

const RENEW_WITHIN_MS = 10 * 60 * 1000;
const NOTICE_MS = 14 * 24 * 60 * 60 * 1000;
const PER_PAGE = 100;
const MOST_PAGES = 100;
const GITHUB_API = 'https://api.github.com';
const GITHUB_HEADER = 'http.https://github.com/.extraheader';

const timeOf = (now) => (typeof now === 'function' ? now() : now ?? new Date()).getTime();

function check(connection) {
  if (connection === null || typeof connection !== 'object') throw new Error('The connection is missing');
  const { host, mode, project, projectId } = connection;
  if (host !== 'github' && host !== 'gitlab') throw new Error('The connection\'s host must be github or gitlab');
  if (mode !== 'quick' && mode !== 'narrow') throw new Error('The connection must be quick or narrow');
  if (typeof project !== 'string' || !project.includes('/')) throw new Error('The connection\'s project must be written owner/name');
  if (host === 'gitlab' && mode === 'narrow' && !(Number.isInteger(projectId) && projectId > 0)) {
    throw new Error('The GitLab connection needs the project\'s number');
  }
  return connection;
}

// git's http.extraHeader, carried in the environment: GIT_CONFIG_COUNT and its
// numbered key and value act as `-c` options would, without an argument.
function gitHeader(configKey, user, key) {
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: configKey,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`${user}:${key}`, 'utf8').toString('base64')}`,
  };
}

function githubKeys() {
  const keys = readKey('github-app');
  if (!keys || typeof keys.accessToken !== 'string' || keys.accessToken === '') {
    throw new Error('The GitHub connection has no keys: sign in to the Wheelhouse app again');
  }
  return keys;
}

function gitlabKey(connection) {
  const key = readKey(`gitlab-project-${connection.projectId}`);
  if (!key || typeof key.token !== 'string' || key.token === '') {
    throw new Error('The GitLab connection has no key for this project: setup needs to make one');
  }
  return key;
}

// The GitHub access key, renewed first when it has less than ten minutes
// left, with the new keys saved. A key with no expiry is used as it is.
async function githubAccessKey({ fetch, now }) {
  const keys = githubKeys();
  if (keys.accessExpiresAt == null) return keys.accessToken;
  const left = Date.parse(keys.accessExpiresAt) - timeOf(now);
  if (left >= RENEW_WITHIN_MS) return keys.accessToken;
  if (typeof keys.refreshToken !== 'string' || keys.refreshToken === '') {
    throw new Error('The GitHub access key needs renewing, but there is no renewal key: sign in to the Wheelhouse app again');
  }
  let fresh;
  try {
    fresh = await renewKeys({
      clientId: keys.clientId,
      refreshToken: keys.refreshToken,
      fetch,
      now: () => new Date(timeOf(now)),
    });
  } catch (error) {
    // The underlying message could name GitHub's reply; only the step is said,
    // and GitHub's own short error code when it gave one.
    const code = typeof error?.code === 'string' && /^[a-z_]{1,40}$/.test(error.code) ? ` (${error.code})` : '';
    throw new Error(`Could not renew the GitHub access key${code}: sign in to the Wheelhouse app again if this goes on`);
  }
  const { clientSecret, ...kept } = keys; // a client secret is never kept
  // A reply that gives no new renewal key leaves the old one, and its expiry, in place.
  const renewal = typeof fresh.refreshToken === 'string' && fresh.refreshToken !== ''
    ? { refreshToken: fresh.refreshToken, refreshExpiresAt: fresh.refreshExpiresAt }
    : {};
  writeKey('github-app', { ...kept, accessToken: fresh.accessToken, accessExpiresAt: fresh.accessExpiresAt, ...renewal });
  return fresh.accessToken;
}

// The environment the helper gives gh, glab and git for this connection.
export async function childEnv(connection, { fetch = globalThis.fetch, now = () => new Date() } = {}) {
  check(connection);
  if (connection.mode === 'quick') {
    if (connection.locked) throw new Error('Locked needs the narrow connection');
    return {};
  }
  if (connection.host === 'github') {
    const key = await githubAccessKey({ fetch, now });
    return { GH_TOKEN: key, ...gitHeader(GITHUB_HEADER, 'x-access-token', key) };
  }
  const root = checkBaseUrl(connection.baseUrl ?? 'https://gitlab.com');
  const base = new URL(root);
  const { token } = gitlabKey(connection);
  return {
    GITLAB_TOKEN: token,
    // glab api takes no repository option, so the host is how a self-managed
    // GitLab is reached.
    // A GitLab served under a path keeps it.
    GITLAB_HOST: `${base.host}${base.pathname.replace(/\/+$/, '')}`,
    ...gitHeader(`http.${root}/.extraheader`, 'oauth2', token),
  };
}

async function listPage(url, key, fetch) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${key}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch {
    throw new Error('Could not reach GitHub to list the installation\'s repositories');
  }
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to the list of the installation's repositories`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('GitHub\'s list of the installation\'s repositories was not JSON');
  }
  if (!body || !Array.isArray(body.repositories)) throw new Error('GitHub\'s list of the installation\'s repositories was not in the expected shape');
  return body.repositories;
}

// Whether the Wheelhouse app's installation can see the project. If not, the
// installation's settings page, where the director ticks it. This only reads:
// the helper cannot add a repository to the installation (check 20).
export async function installationCovers(connection, { fetch = globalThis.fetch, now = () => new Date() } = {}) {
  check(connection);
  if (connection.host !== 'github' || connection.mode !== 'narrow') {
    throw new Error('Only the narrow GitHub connection has an installation to check');
  }
  const { installationId } = githubKeys();
  if (!Number.isInteger(installationId) || installationId < 1) {
    throw new Error('The GitHub connection does not know its installation: sign in to the Wheelhouse app again');
  }
  const key = await githubAccessKey({ fetch, now });
  const wanted = connection.project.toLowerCase();
  for (let page = 1; page <= MOST_PAGES; page += 1) {
    const url = `${GITHUB_API}/user/installations/${installationId}/repositories?per_page=${PER_PAGE}&page=${page}`;
    const repositories = await listPage(url, key, fetch);
    if (repositories.some((repo) => typeof repo?.full_name === 'string' && repo.full_name.toLowerCase() === wanted)) {
      return { covered: true };
    }
    if (repositories.length < PER_PAGE) break;
  }
  return { covered: false, settingsUrl: `https://github.com/settings/installations/${installationId}` };
}

// Whether the board should raise the connection's renewal: within 14 days of
// the GitHub renewal key's expiry, or the GitLab key's or pasted token's.
export function renewalDue(connection, now = () => new Date()) {
  check(connection);
  if (connection.mode !== 'narrow') return { due: false };
  const kept = connection.host === 'github'
    ? readKey('github-app')?.refreshExpiresAt
    : readKey(`gitlab-project-${connection.projectId}`)?.expiresAt;
  if (typeof kept !== 'string') return { due: false };
  const expiry = Date.parse(kept);
  if (Number.isNaN(expiry)) return { due: false };
  if (expiry - timeOf(now) > NOTICE_MS) return { due: false };
  return { due: true, on: new Date(expiry).toISOString().slice(0, 10) };
}
