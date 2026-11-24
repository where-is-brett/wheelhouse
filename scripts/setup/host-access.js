// scripts/setup/host-access.js
// Step 3 finds how the director's computer already reaches the host, and asks last (design section 12):
//   - the remote and its transport (HTTPS or SSH);
//   - the director's credential helper, as their own git settings name it;
//   - whether `git ls-remote` works with the director's git as it is (no prompt, no window);
//   - whether `git credential fill` gives a key, and whether that key passes `GET /user`;
//   - which of the host's tool and the host's web API carries everything that is not a push (`backendFor`).
// It asks nothing when git reaches the host and the key passes, or the host's tool is signed in. When there is no key,
// or the key can only push, it raises the key card (design section 6): the host's token page opens with the key's name
// and permissions filled in, the director pastes the key into the computer's own hidden box (never the chat), setup
// checks it and stores it with `git credential approve`, replacing only the director's own entry for that host.
//
// The words the director reads here never say "REST" or "curl" (the one exception, the line for a computer with
// neither a curl nor a tool, is design section 11's own and is shown as a wait, not on a card).
//
// Nothing here puts a key in a line said, an error or the journal. `borrow` and `store` are the computer's store (the
// director's key, store.js); `via` is how the checks are made (gitlabApi's run, curl, proxy, caFile and platform), for
// tests.
import fs from 'node:fs';
import path from 'node:path';
import { askDirectorGit, directorProxy, outsideRepo, ceilingOf, directorGitEnv } from '../host/director-git.js';
import { curlPath, request, NO_CURL } from '../host/curl.js';
import { gitlabApi } from '../host/gitlab-key.js';
import { DEFAULT_GITLAB, unreadableAuthority } from '../host/gitlab-base.js';
import { tokenUrl } from '../host/token-url.js';
import { withoutTokens } from '../lib/token-names.js';

const NAME = { github: 'GitHub', gitlab: 'GitLab' };
const GITHUB_ORIGIN = 'https://github.com';
const GITHUB_API = 'https://api.github.com';
export const KEY_DAYS_ASKED = 90;
export const NO_KEY_GIVEN = (host) => `No ${NAME[host]} key was given, so setup could not go on; a fresh Go ahead asks again`;

// The address a host's key is kept under in the director's store: GitHub's, or the GitLab at `base`.
export const hostAddress = (host, base = DEFAULT_GITLAB) => (host === 'github' ? GITHUB_ORIGIN : base.replace(/\/+$/, ''));

// ---- Finding ----

// How a remote's address reaches the host: 'https', 'ssh' (ssh:// or the scp form) or null (a path on this computer).
export function transportOf(remoteUrl) {
  const url = String(remoteUrl ?? '').trim();
  // An address that starts with a dash would read as an option to git, and `::` names a transport helper: neither is an address.
  if (url.startsWith('-') || url.includes('::') || /\s/.test(url)) return null;
  // A bracketed (IPv6) host, or a second @ before the host, is not read.
  if (unreadableAuthority(url)) return null;
  // A Windows drive path (C:/Users/ann/repo, C:\Users\ann\repo, C:repo) is a place on this computer, not host:path.
  if (/^[A-Za-z]:/.test(url)) return null;
  if (/^https:\/\/[^/\s-]/i.test(url)) return 'https';
  if (/^ssh:\/\/(?:[^-/@\s][^/@\s]*@)?[^-/@\s]/i.test(url)) return 'ssh';
  // The scp form: [user@]host:path, a host that cannot start with a dash, and no scheme.
  if (/^(?:[A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*:(?!\/\/)[^\s]+$/.test(url)) return 'ssh';
  return null;
}

// The credential helper the director's own git names for an address, or null when it names none.
export async function credentialHelperOf({ address, ask }) {
  try {
    const got = await ask(['config', '--get-urlmatch', 'credential.helper', address]);
    const helper = got.code === 0 ? got.stdout.trim().split(/\r?\n/).at(-1) : '';
    return helper === '' ? null : helper;
  } catch {
    return null;
  }
}

// Whether `git ls-remote` reaches the remote with the director's git as it is, asking nothing.
export async function lsRemoteWorks({ remoteUrl, ask }) {
  if (transportOf(remoteUrl) === null) return false;
  try {
    return (await ask(['ls-remote', '--end-of-options', remoteUrl, 'HEAD'])).code === 0;
  } catch {
    return false;
  }
}

// One harmless call with the key: GET /user. Gives { state: 'works', user } on a 200; { state: 'refused', status } on a
// 401 (the key is not accepted at all); { state: 'push-only', status } on a 403 (it is accepted for the repository only);
// { state: 'unreachable', code } when the host could not be reached; { state: 'error', status } for any other answer.
export async function checkApiKey({ host, base = DEFAULT_GITLAB, key, via = {} }) {
  let answer;
  try {
    if (host === 'gitlab') {
      answer = await gitlabApi({ baseUrl: base, token: key, bearer: true, ...via }).get('/user');
    } else {
      const platform = via.platform ?? process.platform;
      const got = await request({
        run: via.run, curl: via.curl ?? curlPath({ platform }), url: `${GITHUB_API}/user`, method: 'GET',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${key}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'wheelhouse' },
        proxy: via.proxy !== undefined ? via.proxy : await directorProxy(GITHUB_API), caFile: via.caFile ?? null, platform, base: GITHUB_API,
      });
      let body = null;
      try { body = got.body ? JSON.parse(got.body) : null; } catch { /* not JSON */ }
      answer = { status: got.status, body };
    }
  } catch (error) {
    return { state: 'unreachable', code: typeof error?.code === 'string' ? error.code : 'HOST_REQUEST_FAILED' };
  }
  if (answer.status === 200) {
    const user = host === 'github' ? answer.body?.login : answer.body?.username;
    return { state: 'works', user: typeof user === 'string' && user !== '' ? user : null };
  }
  if (answer.status === 401) return { state: 'refused', status: 401 };
  if (answer.status === 403) return { state: 'push-only', status: 403 };
  return { state: 'error', status: answer.status };
}

// The host git itself reads from a remote's address: the authority runs to the first /, the host is what follows the @, and an
// authority holding a backslash, ?, #, % or a second @ is no host to trust (git, curl and a URL reader each end it differently).
// null when none is read.
function gitHostOf(remoteUrl) {
  const text = String(remoteUrl).trim();
  if (text.includes('::') || text.startsWith('-')) return null;
  if (unreadableAuthority(text)) return null;
  const web = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/]*)/.exec(text);
  if (web) {
    if (!['https', 'ssh', 'git+ssh'].includes(web[1].toLowerCase())) return null;
    if (/[\\?#%]/.test(web[2]) || (web[2].match(/@/g) ?? []).length > 1) return null;
    return web[2].replace(/^.*@/, '').replace(/:\d*$/, '').toLowerCase();
  }
  const scp = /^(?:[^@:/\s]*@)?([^@:/\s]+):/.exec(text);
  return scp ? scp[1].toLowerCase() : null;
}

// The address the director's own program would use for a remote once its url.<base>.insteadOf settings have been applied (it
// rewrites addresses before it reaches them); null when it cannot say, which keeps the token variables out.
async function resolvedRemote({ remoteUrl, run, gitPath, env }) {
  if (transportOf(remoteUrl) === null) return null;
  try {
    const got = await askDirectorGit(['ls-remote', '--get-url', '--end-of-options', remoteUrl], { run, gitPath, cwd: outsideRepo(), env: directorGitEnv({ ...env, ...withoutTokens({ env: { ...process.env, ...env } }) }) });
    const url = got.stdout.trim().split(/\r?\n/).at(-1) ?? '';
    return got.code === 0 && /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|[^\s:/@]*@?[^\s:/@]+:)\S*$/.test(url) ? url : null;
  } catch {
    return null;
  }
}

// Where the director's git is asked from, and in what environment (they live with the asker, director-git.js).
export { outsideRepo, ceilingOf, directorGitEnv };

// Whether the folder's own git settings could change where an address goes: any url.<x>.insteadOf or pushInsteadOf key, or an
// include or includeIf section (which could bring one in). Read as plain text, the way originUrl reads the remote, and git is
// never run in the folder for it. A folder with no .git/config is none; one that cannot be read, or whose .git is not a folder, may.
export function folderMayRewrite(folder) {
  if (folder === null || folder === undefined) return false;
  // A linked worktree, or a repository with a config of its own for it, reads more settings than .git/config holds.
  if (fs.existsSync(path.join(folder, '.git', 'commondir')) || fs.existsSync(path.join(folder, '.git', 'config.worktree'))) return true;
  let text;
  try {
    text = fs.readFileSync(path.join(folder, '.git', 'config'), 'utf8');
  } catch (error) {
    return error?.code !== 'ENOENT' || fs.existsSync(path.join(folder, '.git'));
  }
  return /^\s*\[\s*(?:url|include|includeIf)\b/im.test(text) || /^\s*(?:push)?insteadof\s*=/im.test(text);
}

// What step 3 finds about the computer's own road to the host, with nothing asked:
//   { transport, helper, gitReaches, key, user, username }
// `key` is 'none' (git holds no key), 'works' (it passes GET /user), 'push-only' (a 403), 'refused' (a 401),
// 'unreachable' (the host could not be asked) or 'error'. `repo` is owner/name (null for a product with no repository
// yet, so there is no remote to try); `remoteUrl` is its address.
export async function findAccess({ host, base = DEFAULT_GITLAB, repo = null, remoteUrl = null, folder = null, run, gitPath = 'git', borrow, via = {}, env = process.env }) {
  const address = hostAddress(host, base);
  // git's credential helper may read the director's token variables and send them to any host git reaches, so they are kept
  // only where git is to reach github.com: the host of the remote asked, else the host's own address.
  const reached = await (async () => {
    try {
      // A folder that may rewrite addresses itself (a handed-over project's own settings) is not trusted to say where git goes.
      if (folderMayRewrite(folder)) return null;
      if (remoteUrl === null) return new URL(address).hostname;
      const resolved = await resolvedRemote({ remoteUrl, run, gitPath, env });
      return resolved === null ? null : gitHostOf(resolved);
    } catch {
      return null;
    }
  })();
  const ask = (args) => askDirectorGit(args, { run, gitPath, cwd: outsideRepo(), env: directorGitEnv(reached !== null && /^(?:www\.)?github\.com\.?$/.test(reached) ? env : { ...env, ...withoutTokens({ env: { ...process.env, ...env } }) }) });
  const found = {
    transport: transportOf(remoteUrl), helper: await credentialHelperOf({ address, ask }),
    gitReaches: remoteUrl === null ? null : await lsRemoteWorks({ remoteUrl, ask }),
    key: 'none', user: null, username: null,
  };
  let lent = null;
  try {
    lent = await borrow({ host: new URL(address).host, base: address, repoPath: repo ?? undefined });
  } catch { /* no key to lend */ }
  if (typeof lent?.key !== 'string' || lent.key === '') return found;
  found.username = typeof lent.username === 'string' && lent.username !== '' ? lent.username : null;
  const checked = await checkApiKey({ host, base, key: lent.key, via });
  found.key = checked.state;
  found.user = checked.user ?? null;
  return found;
}

// Which backend carries everything but pushes: the host's tool when it starts here and is signed in to this host;
// otherwise the host's web API. Quick and narrow need the tool to sign in, so a tool that starts keeps them on it; a
// tool that will not start settles them on the web API (GitLab's narrow key and the director's own key both reach it
// without the tool).
export function backendFor({ mode, tool, signedByTool }) {
  if (tool === 'works' && (signedByTool || mode !== 'as-is')) return 'cli';
  return 'rest';
}

// ---- The words ----

export const asIsReachLine = (host) => `Wheelhouse uses the same key your git already uses. It can reach everything your account can on ${NAME[host]}.`;
export const replacesLine = (address, host = 'gitlab') => (host === 'github'
  ? `This replaces the key your git uses for ${address} with the new one. Pushes to any repository the new key does not include would be refused, so include every repository you push to from this computer.`
  : `This replaces the key your git uses for ${address} with the new one, so your pushes keep working.`);

// The key card's opening line, for a key that is missing, refused (401), or accepted for pushes only (403). Never
// the words REST or curl.
export function keyCardLine({ host, address, state }) {
  const name = NAME[host];
  const lead = state === 'none'
    ? `Your ${name} key is missing.`
    : state === 'push-only'
      ? `The key your git holds for ${name} can push, but ${name} won't let it open or merge requests.`
      : `Your ${name} key has stopped working.`;
  return `${lead} A page will open on ${address} with the key's name and permissions filled in; make it, then paste it into the box your computer shows, never into the chat.`;
}

// The line on the Go-ahead card for a key that will be asked for.
export const keyCardPlanLine = (host, state) => (state === 'none'
  ? `a ${NAME[host]} key made on a page that opens and pasted into your computer's box, never the chat (none is stored yet)`
  : `a new ${NAME[host]} key made on a page that opens and pasted into your computer's box, never the chat, replacing the one your git holds (${state === 'push-only' ? 'it can push but not open or merge requests' : 'it was refused'})`);

// The line for a computer that has neither a tool nor curl: design section 11, shown as a wait, never on a card.
export const noRoadLine = (host) => NO_CURL.replace(/GitLab/g, NAME[host]);

// ---- The key card ----

// Raises the key card: says what the key is for, opens the host's token page, takes the key from the computer's own box,
// checks it with GET /user and stores it with `git credential approve` (`store`), replacing the director's own entry for
// the host. Gives { user, username }. `existing` is the user name of the entry git holds now (null when none). Nothing
// is said, thrown or stored beyond the key itself.
export async function runKeyCard({
  host, base = DEFAULT_GITLAB, owner, name, state, existing = null, say, open, askSecret, platform = process.platform, halt = () => {},
  store, borrow = null, via = {}, days = KEY_DAYS_ASKED, keyName = 'Wheelhouse',
}) {
  const address = hostAddress(host, base);
  say(keyCardLine({ host, address: new URL(address).host, state }));
  if (state !== 'none') say(replacesLine(new URL(address).host, host));
  say(asIsReachLine(host));
  // A product with no repository yet has none to pick, so its key is made for all repositories.
  const repos = host === 'github' && owner && name ? [name] : [];
  if (host === 'github') say(repos.length > 0 ? `On the page, choose "Only select repositories", then ${name}${state === 'none' ? '' : ' and every other repository you push to from this computer'}, and click Generate token` : 'On the page, choose "All repositories" (the new project does not exist yet), then click Generate token');
  else say(`The page asks for api and write_repository only; set it to expire in ${days} days`);
  await open(host === 'github'
    ? tokenUrl({ host: 'github', owner: owner ?? '', repos, name: keyName, days })
    : tokenUrl({ host: 'gitlab', owner: owner ?? '', repos: owner && name ? [`${owner}/${name}`] : [], name: keyName, base: address }));
  let key;
  try {
    key = await askSecret({ title: `Wheelhouse: ${NAME[host]} key`, prompt: `Paste the ${NAME[host]} key you just made. It goes straight to your computer's own store for ${NAME[host]}, never the chat.` }, platform);
  } catch {
    throw new Error(NO_KEY_GIVEN(host));
  }
  if (typeof key !== 'string' || key.trim() === '') throw new Error(NO_KEY_GIVEN(host));
  key = key.trim();
  halt();
  const checked = await checkApiKey({ host, base, key, via });
  if (checked.state === 'unreachable') throw new Error(`${NAME[host]} could not be reached to check the key, so it was not stored; a fresh Go ahead asks again`);
  if (checked.state !== 'works') throw new Error(`${NAME[host]} did not accept the key. Make a new one with the permissions the page filled in, and a fresh Go ahead asks again`);
  const username = existing ?? checked.user ?? 'oauth2';
  const repoPath = owner && name ? `${owner}/${name}` : undefined;
  await store({ host: new URL(address).host, base: address, repoPath, username, key });
  // Git must give the new key back for this repository, or the old entry still wins for pushes and the API.
  if (borrow !== null) {
    let back = null;
    try { back = await borrow({ host: new URL(address).host, base: address, repoPath }); } catch { /* none */ }
    if (back?.key !== key) throw new Error(`The key was stored, but your git still gives an older one for ${new URL(address).host}, so Wheelhouse did not use it. Check your git's credential settings for that address, and a fresh Go ahead asks again`);
  }
  return { user: checked.user, username };
}
