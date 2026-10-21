// scripts/host/gitlab-base.js
// The GitLab address a project lives at, in one place. `DEFAULT_GITLAB` is the only place the public
// service's address is written; every other module takes the address from `gitlabBase` (or from the
// base its caller passes). A company's own GitLab is named by the project setting `gitlabHosts`, each
// entry a host name, with its port when it has one (`gitlab.example.org`, `localhost:8929`).

export const DEFAULT_GITLAB = 'https://gitlab.com';

const DEFAULT_HOST = new URL(DEFAULT_GITLAB).hostname;
const GITHUB_HOST = 'github.com';
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];

// A repository address read into its host name, its port (as written, '' when none) and the address
// of the web site that goes with it: https unless the address itself is plain http on this computer.
// An ssh port is the ssh server's, not the web site's, so it is dropped.
export function parseRemote(remoteUrl) {
  const text = String(remoteUrl ?? '').trim();
  const scp = /^[^@/\s]+@([^:/\s]+):/.exec(text); // git@host:owner/name.git
  if (scp) return { hostname: scp[1].toLowerCase(), port: '', origin: `https://${scp[1].toLowerCase()}` };
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('That is not a repository address this can read');
  }
  if (!url.hostname) throw new Error('That is not a repository address this can read');
  const web = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL.includes(url.hostname));
  const port = web ? url.port : '';
  const scheme = web ? url.protocol : 'https:';
  return { hostname: url.hostname.toLowerCase(), port, origin: `${scheme}//${url.hostname.toLowerCase()}${port === '' ? '' : `:${port}`}` };
}

// Whether a `gitlabHosts` entry names the remote's host: an entry with a port must match the port too;
// an entry without one names the host on any port.
export function listed(parts, gitlabHosts) {
  if (!Array.isArray(gitlabHosts)) return false;
  return gitlabHosts.map((h) => String(h).trim().toLowerCase()).some((entry) => entry === parts.hostname || (parts.port !== '' && entry === `${parts.hostname}:${parts.port}`));
}

// The name a remote's host goes by in messages: the host name, with the port when it has one.
export const hostWords = (parts) => (parts.port === '' ? parts.hostname : `${parts.hostname}:${parts.port}`);

// Whether the remote is the public service's.
export const isDefaultHost = (parts) => parts.hostname === DEFAULT_HOST;

// The GitLab address for a project: the origin of its remote when `gitlabHosts` (in `config`) names
// the remote's host, else the public service's. The origin is kept as a whole, so a port stays.
export function gitlabBase({ config, remoteUrl } = {}) {
  if (typeof remoteUrl !== 'string' || remoteUrl.trim() === '') return DEFAULT_GITLAB;
  let parts;
  try {
    parts = parseRemote(remoteUrl);
  } catch {
    return DEFAULT_GITLAB;
  }
  if (isDefaultHost(parts) || parts.hostname === GITHUB_HOST) return DEFAULT_GITLAB;
  return listed(parts, config?.gitlabHosts) ? parts.origin : DEFAULT_GITLAB;
}

// The address of the instance's no-reply mailbox: <id>-<username>@users.noreply.<host>.
function noReply(user, base) {
  return `${user.id}-${user.username}@users.noreply.${new URL(base).hostname}`;
}

// The email GitLab puts on a person's commits, from their profile (`GET /user` already read as `user`):
// the commit email, else the public one, else the instance's no-reply form. null when the profile has
// no id and username to build it from.
export function commitEmailOf(user, base = DEFAULT_GITLAB) {
  const own = [user?.commit_email, user?.public_email].find((e) => typeof e === 'string' && e.includes('@'));
  if (own !== undefined) return own;
  if (typeof user?.username === 'string' && user.username !== '' && Number.isInteger(user?.id)) return noReply(user, base);
  return null;
}

// The commit email of whoever `api` is signed in as. The instance is the api's own address.
export async function commitEmail({ api }) {
  const got = await api.get('/user');
  const email = got.status >= 200 && got.status < 300 ? commitEmailOf(got.body, api.baseUrl ?? DEFAULT_GITLAB) : null;
  if (email === null) throw new Error('GitLab did not say who is signed in, so there is no commit email to use');
  return email;
}
