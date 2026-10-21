// scripts/host/gitlab-key.js
// Makes a GitLab project access token (the "project key") for Wheelhouse, and
// a small client for GitLab's REST API. The project key is a Developer's unless
// a Maintainer's is asked for, with the api and write_repository scopes, so it
// can push branches and open merge requests, but (with the default branch
// protected to "no one") not push to the default branch. No function here
// returns, logs or throws a message holding a key, and errors never repeat
// GitLab's own message text.
import { DEFAULT_GITLAB } from './gitlab-base.js';

const DEVELOPER = 30;
const MAINTAINER = 40;
const SCOPES = ['api', 'write_repository'];
const MOST_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

// The GitLab address without a trailing slash, refusing anything but https
// (plain http is allowed on this computer only).
export function checkBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('The GitLab address must start with https://');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('The GitLab address must start with https://');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

// `bearer: true` sends the token as "Authorization: Bearer", which is how an
// OAuth sign-in token is sent; a personal or project access token uses the
// PRIVATE-TOKEN header.
// `baseUrl` on the client is the GitLab address itself (for pages such as the token page), not the API's.
export function gitlabApi({ baseUrl = DEFAULT_GITLAB, token, bearer = false, fetch = globalThis.fetch }) {
  if (typeof token !== 'string' || token === '') throw new Error('The sign-in is missing');
  const address = checkBaseUrl(baseUrl);
  const root = `${address}/api/v4`;
  const auth = bearer ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token };

  async function send(method, path, body) {
    let response;
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers: { Accept: 'application/json', ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // The underlying error can quote the request, so its text is not passed on.
      throw new Error('Could not reach GitLab');
    }
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
  }

  return {
    baseUrl: address,
    get: (path) => send('GET', path),
    post: (path, body = {}) => send('POST', path, body),
    put: (path, body = {}) => send('PUT', path, body),
    delete: (path) => send('DELETE', path),
  };
}

export const projectPath = (projectId) => `/projects/${encodeURIComponent(String(projectId))}`;

function expiryDate(now, days) {
  return new Date(now().getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// What GitLab says when the group has switched project keys off ("Allow group and project access
// tokens", check 71). The setting cannot be read through the API, so this refusal is the only signal.
const KEYS_OFF = /does not have permission to create project access token/i;
// The code on the error makeProjectKey throws for it, so a caller can offer another way without reading words.
export const KEYS_OFF_CODE = 'keys-switched-off';
export const isKeysSwitchedOff = (error) => error?.code === KEYS_OFF_CODE;
export const KEYS_SWITCHED_OFF = 'GitLab refused a project key because the company\'s group has switched project keys off: ask the company\'s GitLab admin (an owner of the top-level group) to tick "Allow group and project access tokens" in the group\'s settings, or use a pasted token';

function refusal(status, body) {
  if (status === 400 && KEYS_OFF.test(String(body?.message ?? body?.error ?? ''))) return KEYS_SWITCHED_OFF;
  if (status === 401) return 'GitLab did not accept the sign-in used to make the project key';
  if (status === 403) {
    return 'GitLab says this sign-in may not make a project key: it needs the Maintainer or Owner role on the project, and, on the public hosted service, a Premium or Ultimate plan';
  }
  if (status === 404) return 'GitLab could not find the project, or this sign-in cannot see it';
  return `GitLab refused the request for a project key (HTTP ${status})`;
}

// accessLevel is Developer (30) unless the caller asks for Maintainer (40). A
// Developer's key cannot change protected branches or project settings, so it
// cannot undo the protection, but it can push branches and open merge requests,
// and merge where the branch's merge access includes Developers. A Maintainer's
// key can unprotect the default branch.
export async function makeProjectKey({ api, projectId, name, days, accessLevel = DEVELOPER, now = () => new Date() }) {
  if (accessLevel !== MAINTAINER && accessLevel !== DEVELOPER) throw new Error('The key can be a Developer (30) or a Maintainer (40)');
  if (!Number.isInteger(days) || days < 1 || days > MOST_DAYS) {
    throw new Error(`The key's life must be a whole number of days from 1 to ${MOST_DAYS}`);
  }
  if (typeof name !== 'string' || name.trim() === '') throw new Error('The key needs a name');
  const answer = await api.post(`${projectPath(projectId)}/access_tokens`, {
    name,
    scopes: SCOPES,
    access_level: accessLevel,
    expires_at: expiryDate(now, days),
  });
  if (answer.status < 200 || answer.status >= 300) {
    const line = refusal(answer.status, answer.body);
    throw Object.assign(new Error(line), line === KEYS_SWITCHED_OFF ? { code: KEYS_OFF_CODE } : {});
  }
  const { token, expires_at: expiresAt, id } = answer.body ?? {};
  if (typeof token !== 'string' || typeof id !== 'number') {
    throw new Error('GitLab answered, but did not return a project key');
  }
  return { token, expiresAt, id };
}
