// scripts/host/cut-access.js
// Taking the agents' host keys away from this computer (ruling R88): the runbook's step 2, cut
// access (cutAccess, the helper's /runbook/cut-access), and uninstall's keys (scripts/setup/
// uninstall.js) share it, so there is one revocation in the code.
//
// - The GitHub app's keys are deleted from this computer (deleteAppKeys); a copy of them would still
//   work until the app is suspended or uninstalled on GitHub, so the installation's page is given.
// - A GitLab project key is revoked through GitLab's API (revokeGitlabKey): first as the key
//   revoking itself, then by its own number on the project, and its file is deleted once GitLab has
//   revoked it. A token the director pasted at setup is their own: revoking it stops it everywhere
//   they used it.
// - A Quick connection uses the director's own sign-in, which only they can revoke: nothing is
//   changed here, and the page where they can is given.
// No key is ever in an answer, an argument or a log: it goes only into the request's header.
import { deleteKey, readKey } from './keys.js';
import { checkBaseUrl, gitlabApi, projectPath } from './gitlab-key.js';
import { installationOf } from './connection.js';
import { DEFAULT_GITLAB } from './gitlab-base.js';

export const INSTALLATIONS_PAGE = 'https://github.com/settings/installations';
export const GITLAB_URL = DEFAULT_GITLAB;

// The settings page of one installation of the app, or the list of them when its number isn't known.
export const installationPage = (id) => (Number.isSafeInteger(id) && id > 0 ? `${INSTALLATIONS_PAGE}/${id}` : INSTALLATIONS_PAGE);

// The app's keys as kept on this computer, or null when there are none or the file is damaged.
export function appKeys() {
  try {
    return readKey('github-app');
  } catch {
    return null;
  }
}

// The installation of the app a connection uses (ruling R83), as its settings page.
export const connectionInstallationPage = (connection, keys = appKeys()) => installationPage(installationOf(connection, keys));

// The settings page of every installation the key file names (one per account, ruling R83, and the
// single one kept before installations were kept per account), newest kept first; the list of
// installations when it names none.
export function installationPages(keys = appKeys()) {
  const ids = [];
  const kept = keys?.installations;
  if (kept !== null && typeof kept === 'object' && !Array.isArray(kept)) ids.push(...Object.values(kept));
  ids.push(keys?.installationId);
  const pages = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].map(installationPage);
  return pages.length > 0 ? pages : [INSTALLATIONS_PAGE];
}

// Deletes the app's keys from this computer. Gives the installation page of `connection` (the
// project's own installation), read before the keys go.
export function deleteAppKeys(connection) {
  const url = connectionInstallationPage(connection);
  deleteKey('github-app');
  return { url };
}

// The page where a GitLab key can be checked: the director's own tokens for one they pasted, the
// project's access tokens for one setup made.
export const gitlabKeyPage = ({ base, repo, pasted }) => (pasted ? `${base}/-/user_settings/personal_access_tokens` : `${base}/${repo}/-/settings/access_tokens`);

// Revokes the GitLab key kept as `name` (gitlab-project-<projectId>) through GitLab's API at `base`:
// as the key revoking itself, then, if GitLab won't, by its own number on the project. Its file is
// deleted once GitLab has revoked it. Gives { found, pasted, url, revoked, status }: `found` false
// when no key is kept under that name; `status` GitLab's answer (null when it could not be reached).
export async function revokeGitlabKey({ name, projectId, base, repo, fetch }) {
  let key = null;
  try { key = readKey(name); } catch { /* damaged: treated as none */ }
  const pasted = key?.kind === 'pasted-token';
  const url = gitlabKeyPage({ base, repo, pasted });
  if (typeof key?.token !== 'string' || key.token === '') return { found: false, pasted, url, revoked: false, status: null };
  const api = gitlabApi({ baseUrl: base, token: key.token, fetch });
  const statusOf = async (call) => { try { return (await call()).status; } catch { return null; } };
  const revoked = (status) => status !== null && status >= 200 && status < 300;
  let status = await statusOf(() => api.delete('/personal_access_tokens/self'));
  // If GitLab will not revoke a key by itself, try it by its own number.
  if (status !== null && !revoked(status) && status !== 401 && Number.isInteger(key.id) && key.id > 0) {
    status = await statusOf(() => api.delete(`${projectPath(projectId)}/access_tokens/${key.id}`));
  }
  if (revoked(status)) deleteKey(name);
  return { found: true, pasted, url, revoked: revoked(status), status };
}

const plainAnswer = (text, rest = {}) => ({ ok: true, message: text, ...rest });

// The runbook's step 2 for a project's record: { ok, message, url? }, or { ok: false, refused, url }.
export async function cutAccess({ record, fetch }) {
  const { connection, host, repo } = record;
  const base = host === 'gitlab' ? checkBaseUrl(connection.baseUrl ?? GITLAB_URL) : null;
  if (connection.mode !== 'narrow') {
    if (host === 'github') {
      return plainAnswer('Nothing was changed on this computer: the agents use your own GitHub sign-in, and only you can revoke it. Still for you: open the page below and revoke the sign-in that Wheelhouse uses.', { url: 'https://github.com/settings/applications' });
    }
    const apps = `${base}/-/user_settings/applications`;
    const tokens = `${base}/-/user_settings/personal_access_tokens`;
    return plainAnswer(`Nothing was changed on this computer: the agents use your own GitLab sign-in, and only you can revoke it. Still for you: revoke the sign-in on ${apps}, and check ${tokens} for any token of yours that Wheelhouse uses.`, { url: apps });
  }
  if (host === 'github') {
    // The project's own installation of the app, on its account (ruling R83).
    const { url } = deleteAppKeys(connection);
    return plainAnswer('Done on this computer: the Wheelhouse app\'s keys were deleted from it, so nothing here can use them. Still for you: the app is still installed on GitHub, and a copy of its keys would still work until the app is suspended or uninstalled. Open the page below and choose Suspend or Uninstall.', { url });
  }
  const got = await revokeGitlabKey({ name: `gitlab-project-${connection.projectId}`, projectId: connection.projectId, base, repo, fetch });
  const { pasted, url, status } = got;
  if (!got.found) {
    return plainAnswer('No project key was found on this computer, so there was nothing to revoke from here. Still for you: check the page below for any key that Wheelhouse made, and revoke it.', { url });
  }
  if (got.revoked) {
    return plainAnswer(pasted
      ? 'Done: GitLab revoked the token. It was your own token, pasted in at setup, so it stops working anywhere else you used it too; its file was deleted from this computer. The page below lists your personal access tokens, to check it is gone.'
      : 'Done: GitLab revoked the project key, and its file was deleted from this computer. Nothing is left for you on this step.', { url });
  }
  if (status === 401) {
    return plainAnswer(`GitLab no longer accepts this key (HTTP 401), so it no longer works; its file was kept on this computer. Still for you: open the page below and check that the key is gone.`, { url });
  }
  return {
    ok: false,
    refused: `GitLab did not revoke the ${pasted ? 'token' : 'project key'}${status === null ? ' (it could not be reached)' : ` (HTTP ${status})`}, so its file was kept on this computer. For you: open the page below, find ${pasted ? 'the token' : 'the key Wheelhouse made'}, and revoke it.`,
    url,
  };
}
