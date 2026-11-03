// scripts/host/connection.js
// The two ways the helper reaches the host (design section 11), and the
// environment it gives `gh`, `glab` and `git` for each. A project in git alone
// has no host, so its connection is only `{ mode: 'none' }`.
//
//   Connection = {
//     host: 'github' | 'gitlab',
//     mode: 'quick' | 'narrow' | 'as-is',   as-is: pushes with the director's own git as it is
//     backend?: 'cli' | 'rest',   how the helper reaches the host for all but pushes: the host's tool
//                           (gh, glab) or the host's web API through curl; a record with none reads as 'cli'
//     switched?: 'cli',     kept with backend 'rest' when the tool stopped starting and the helper moved the
//                           project to the web API by itself: it names the backend left (the board says so)
//     project: 'owner/name',
//     projectId?: number,   GitLab narrow: the project's number, naming its key
//     baseUrl?: string,     GitLab: the GitLab address (default: the public service's)
//     locked?: boolean,     the project's protection level is Locked
//     installationId?: number,  GitHub narrow: the app's installation on the project's
//                           account, kept when step 3 connected it
//   }
//
// It is kept in the project's settings and holds no secret. Quick uses the
// director's own sign-in, so the tools are given nothing. As-is pushes with the director's own git
// settings (scripts/lib/safe-git.js, the push reaches) and holds no key either. Narrow uses the
// Wheelhouse GitHub App's keys or a GitLab project's key, which reach the
// tools only through their environment, never an argument. No function here
// returns a key other than in that environment, or logs or throws one.
import { renewKeys } from './github-app.js';
import { checkBaseUrl } from './gitlab-key.js';
import { DEFAULT_GITLAB } from './gitlab-base.js';
import { findKey, saveKey } from './keys.js';
import { borrowKey } from './store.js';

const RENEW_WITHIN_MS = 10 * 60 * 1000;
const NOTICE_MS = 14 * 24 * 60 * 60 * 1000;
const PER_PAGE = 100;
const MOST_PAGES = 100;
const GITHUB_API = 'https://api.github.com';
const GITHUB_ORIGIN = 'https://github.com';
const GITHUB_HEADER = 'http.https://github.com/.extraheader';

export const BACKENDS = Object.freeze(['cli', 'rest']);

// The backend a project's connection uses: 'rest' when the record says so, else 'cli' (a record kept before
// backends were chosen has none).
export const backendOf = (connection) => (connection?.backend === 'rest' ? 'rest' : 'cli');

const validId = (id) => Number.isInteger(id) && id > 0;
const timeOf = (now) => (typeof now === 'function' ? now() : now ?? new Date()).getTime();

function check(connection) {
  if (connection === null || typeof connection !== 'object') throw new Error('The connection is missing');
  const { host, mode, project, projectId } = connection;
  if (mode === 'none') return connection;
  if (host !== 'github' && host !== 'gitlab') throw new Error('The connection\'s host must be github or gitlab');
  if (mode !== 'quick' && mode !== 'narrow' && mode !== 'as-is') throw new Error('The connection must be quick, narrow or as-is');
  if (typeof project !== 'string' || !project.includes('/')) throw new Error('The connection\'s project must be written owner/name');
  if (host === 'gitlab' && mode === 'narrow' && !(Number.isInteger(projectId) && projectId > 0)) {
    throw new Error('The GitLab connection needs the project\'s number');
  }
  if (connection.backend !== undefined && !BACKENDS.includes(connection.backend)) throw new Error('The connection\'s backend must be cli or rest');
  if (connection.switched !== undefined && connection.switched !== 'cli') throw new Error('The connection\'s switched must name the backend it left');
  if (connection.installationId !== undefined && !validId(connection.installationId)) {
    throw new Error('The connection\'s installation must be a number');
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

// `deps` is keys.js's seam for tests: { store }.
async function githubKeys(deps) {
  const keys = await findKey('github-app', deps);
  if (!keys || typeof keys.accessToken !== 'string' || keys.accessToken === '') {
    throw new Error('The GitHub connection has no keys: sign in to the Wheelhouse app again');
  }
  return keys;
}

async function gitlabKey(connection, deps) {
  const key = await findKey(`gitlab-project-${connection.projectId}`, deps);
  if (!key || typeof key.token !== 'string' || key.token === '') {
    throw new Error('The GitLab connection has no key for this project: setup needs to make one');
  }
  return key;
}

// The app's installation a GitHub connection uses: the project's own, which its record keeps once
// step 3 connected it; else the one the keys keep for the project's account; else, from keys kept
// before installations were kept per account (only `installationId`), that one. Null when none.
// One key file serves every installation of the app: its access key works across them (check 20).
export function installationOf(connection, keys) {
  if (validId(connection?.installationId)) return connection.installationId;
  const kept = keys?.installations;
  if (kept !== null && typeof kept === 'object' && !Array.isArray(kept)) {
    const account = typeof connection?.project === 'string' ? connection.project.split('/')[0].toLowerCase() : null;
    return account !== null && validId(kept[account]) ? kept[account] : null;
  }
  return validId(keys?.installationId) ? keys.installationId : null;
}

// The GitHub access key, renewed first when it has less than ten minutes
// left, with the new keys saved. A key with no expiry is used as it is.
async function githubAccessKey({ fetch, now, keys: deps }) {
  const keys = await githubKeys(deps);
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
  // Kept in the computer's store, where setup, cut-access and uninstall now read and remove keys too.
  await saveKey('github-app', { ...kept, accessToken: fresh.accessToken, accessExpiresAt: fresh.accessExpiresAt, ...renewal }, deps);
  return fresh.accessToken;
}

// The environment the helper gives gh, glab and git for this connection.
// `keys` is keys.js's seam for tests ({ store }); left out, the computer's own store is used.
export async function childEnv(connection, { fetch = globalThis.fetch, now = () => new Date(), keys } = {}) {
  check(connection);
  if (connection.mode === 'none') return {};
  if (connection.mode === 'quick' || connection.mode === 'as-is') {
    if (connection.locked) throw new Error('Locked needs the narrow connection');
    return {};
  }
  if (connection.host === 'github') {
    const key = await githubAccessKey({ fetch, now, keys });
    return { GH_TOKEN: key, ...gitHeader(GITHUB_HEADER, 'x-access-token', key) };
  }
  const root = checkBaseUrl(connection.baseUrl ?? DEFAULT_GITLAB);
  const base = new URL(root);
  const { token } = await gitlabKey(connection, keys);
  return {
    GITLAB_TOKEN: token,
    // glab api takes no repository option, so the host is how a self-managed
    // GitLab is reached.
    // A GitLab served under a path keeps it.
    GITLAB_HOST: `${base.host}${base.pathname.replace(/\/+$/, '')}`,
    ...gitHeader(`http.${root}/.extraheader`, 'oauth2', token),
  };
}

// What the helper's reads of the host (fetches, the lock and state branches) carry on the as-is connection when
// there is no tool to sign in with (backend 'rest'): the director's own key, borrowed from their own sign-in store
// for this request, as the header a narrow key travels in. Nothing else: no tool variable, and no push uses it (a
// push is the director's own setup as it is). Empty on any other connection, and when there is no key to lend.
// `borrow` is a seam for tests.
export async function readEnv(connection, { borrow = borrowKey } = {}) {
  check(connection);
  if (connection.mode !== 'as-is' || backendOf(connection) !== 'rest') return {};
  const root = connection.host === 'github' ? GITHUB_ORIGIN : checkBaseUrl(connection.baseUrl ?? DEFAULT_GITLAB);
  const lent = await borrow({ host: new URL(root).host, base: root, repoPath: connection.project });
  if (typeof lent?.key !== 'string' || lent.key === '') return {};
  return connection.host === 'github'
    ? gitHeader(GITHUB_HEADER, 'x-access-token', lent.key)
    : gitHeader(`http.${root}/.extraheader`, lent.username || 'oauth2', lent.key);
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
// the helper cannot add a repository to the installation (check 20). The
// installation is the project's (installationOf).
export async function installationCovers(connection, { fetch = globalThis.fetch, now = () => new Date(), keys } = {}) {
  check(connection);
  if (connection.host !== 'github' || connection.mode !== 'narrow') {
    throw new Error('Only the narrow GitHub connection has an installation to check');
  }
  const installationId = installationOf(connection, await githubKeys(keys));
  if (installationId === null) {
    throw new Error('The GitHub connection does not know its installation: sign in to the Wheelhouse app again');
  }
  const key = await githubAccessKey({ fetch, now, keys });
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
export async function renewalDue(connection, now = () => new Date(), keys) {
  check(connection);
  if (connection.mode !== 'narrow') return { due: false };
  const kept = connection.host === 'github'
    ? (await findKey('github-app', keys))?.refreshExpiresAt
    : (await findKey(`gitlab-project-${connection.projectId}`, keys))?.expiresAt;
  if (typeof kept !== 'string') return { due: false };
  const expiry = Date.parse(kept);
  if (Number.isNaN(expiry)) return { due: false };
  if (expiry - timeOf(now) > NOTICE_MS) return { due: false };
  return { due: true, on: new Date(expiry).toISOString().slice(0, 10) };
}
