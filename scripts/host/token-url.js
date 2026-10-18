// scripts/host/token-url.js
// Links to the host's new-token page with the agents' token already
// described, so the director only checks it, picks the repositories and
// clicks. GitHub can't pre-select repositories; the description names them.

export function tokenUrl({ host, owner, repos, name, days }) {
  const description = `Wheelhouse agents: code, pull requests and issues in ${repos.join(', ')} only.`;
  if (host === 'github') {
    if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('GitHub accepts an expiry of 1 to 366 days');
    const url = new URL('https://github.com/settings/personal-access-tokens/new');
    url.searchParams.set('name', name.slice(0, 40));
    url.searchParams.set('description', description);
    url.searchParams.set('target_name', owner);
    url.searchParams.set('expires_in', String(days));
    url.searchParams.set('contents', 'write');
    url.searchParams.set('pull_requests', 'write');
    url.searchParams.set('issues', 'write');
    url.searchParams.set('metadata', 'read');
    return url.toString();
  }
  if (host === 'gitlab') {
    const url = new URL('https://gitlab.com/-/user_settings/personal_access_tokens');
    url.searchParams.set('name', name);
    url.searchParams.set('scopes', 'api');
    return url.toString();
  }
  throw new Error(`Unknown host: ${host}`);
}
