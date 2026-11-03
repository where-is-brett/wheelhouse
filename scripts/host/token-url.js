// scripts/host/token-url.js
// Links to the host's new-token page with the agents' key already described, so the director only
// checks it, picks the repository and clicks. Only what the host's own documentation lists is filled in:
//   GitHub  (docs.github.com, "Managing your personal access tokens"): name, description, target_name,
//           expires_in, and each permission by name. The repository can't be preselected, so the card says which to pick.
//   GitLab  (docs.gitlab.com, "Personal access tokens"): name, description and scopes. No expiry parameter is
//           documented, so the card tells the director the days to choose.
//   GitLab's project key page is documented without any query parameters, so it is opened as it is.
// The GitLab pages are on the project's own GitLab (`base`, from gitlabBase).
import { DEFAULT_GITLAB } from './gitlab-base.js';
import { KEY_SCOPES } from './gitlab-key.js';

// What the kept GitHub key holds. Administration is not among them: it comes only in the one-off key.
const KEPT = { contents: 'write', pull_requests: 'write', issues: 'write', statuses: 'read', checks: 'read', metadata: 'read' };

export function tokenUrl({ host, kind, owner, repos = [], name, days, base = DEFAULT_GITLAB, localChecks = false, project }) {
  const where = repos.join(', ');
  if (host === 'github') {
    const url = new URL('https://github.com/settings/personal-access-tokens/new');
    if (kind === 'administration') {
      url.searchParams.set('name', 'Wheelhouse setup (one use)');
      url.searchParams.set('description', `Used once, to protect the main branch of ${where}. Delete it afterwards.`);
      url.searchParams.set('target_name', owner);
      url.searchParams.set('expires_in', '1');
      url.searchParams.set('administration', 'write');
      url.searchParams.set('metadata', 'read');
      return url.toString();
    }
    if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('GitHub accepts an expiry of 1 to 366 days');
    url.searchParams.set('name', name.slice(0, 40));
    url.searchParams.set('description', `Wheelhouse agents: code, pull requests and issues in ${where} only.`);
    url.searchParams.set('target_name', owner);
    url.searchParams.set('expires_in', String(days));
    for (const [permission, level] of Object.entries(KEPT)) url.searchParams.set(permission, level);
    if (localChecks) url.searchParams.set('statuses', 'write');
    return url.toString();
  }
  if (host === 'gitlab') {
    const root = base.replace(/\/+$/, '');
    if (kind === 'project') {
      if (typeof project !== 'string' || project === '') throw new Error('The project key page needs the project\'s path');
      return `${root}/${project.split('/').map(encodeURIComponent).join('/')}/-/settings/access_tokens`;
    }
    const url = new URL(`${root}/-/user_settings/personal_access_tokens`);
    url.searchParams.set('name', name);
    url.searchParams.set('description', `Wheelhouse agents: code and merge requests${where ? ` in ${where}` : ''}.`);
    url.searchParams.set('scopes', KEY_SCOPES.join(','));
    return url.toString();
  }
  throw new Error(`Unknown host: ${host}`);
}
