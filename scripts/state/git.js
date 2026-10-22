// scripts/state/git.js
import path from 'node:path';
import { safeGit } from '../lib/safe-git.js';

// Every git call for the state and lock clones goes through here: no shell, a
// fixed author so the director's own name and address never reach the branch,
// no prompting, replace refs ignored, and no GIT_* variable inherited from
// whatever started this process. `env`, when given (the helper passes the
// connection's), is added on top; these clones are Wheelhouse's own, under
// ~/.wheelhouse/, so a key may travel there. The whole is fenced through
// safeGitEnv: git's global and system config shut out, hooks off, and one
// transport allowed: https, with a local path as well where the caller's
// GIT_ALLOW_PROTOCOL already allows `file` (a local stand-in host).
export function git(dir, args, env = {}) {
  const allowed = String(env?.GIT_ALLOW_PROTOCOL ?? '').split(':');
  const reach = allowed.includes('http') ? 'loopback' : allowed.includes('file') ? 'local' : 'https';
  // look 'never': these are Wheelhouse's own clones under ~/.wheelhouse/, which no agent or project
  // writes into; setup looks once before its sequence, and the helper looks once per request at
  // each repository it uses (lookOnce in scripts/host/helper.js), before its first call here.
  return safeGit({
    cwd: dir,
    env: { GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', ...env },
    reach,
    look: 'never',
    timeoutMs: 5 * 60 * 1000, // a hung remote reads as a failure, not a wait without end
  })(['-c', 'user.name=Wheelhouse', '-c', 'user.email=wheelhouse@invalid', ...args]);
}

const DEFAULT_PORT = { https: '443', http: '80', ssh: '22', git: '9418' };
const caseBlind = process.platform === 'win32' || process.platform === 'darwin';

// A remote address reduced to what names the repository: for a host address, the
// host and the owner/name path (host in lower case, no user, port, `.git` or
// trailing slash, and the same whether it is written for ssh or https); for a local
// path or a file:// address, the full path.
export function remoteKey(url) {
  const text = String(url ?? '').trim().replaceAll('\\', '/');
  const bare = (p) => p.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const local = (p) => {
    const full = bare(path.resolve(p));
    return `path:${caseBlind ? full.toLowerCase() : full}`;
  };
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^/@]*@)?([^/:]*)(?::(\d*))?(\/.*)?$/.exec(text);
  if (scheme) {
    const kind = scheme[1].toLowerCase();
    if (kind === 'file') return local(decodeURIComponent((scheme[4] ?? '/').replace(/^\/([A-Za-z]:)/, '$1')));
    // The port stays unless it is the scheme's own default, so another port names another server.
    const port = scheme[3] && DEFAULT_PORT[kind] !== scheme[3] ? `:${scheme[3]}` : '';
    return `host:${scheme[2].toLowerCase()}${port}/${bare((scheme[4] ?? '').replace(/^\/+/, '')).toLowerCase()}`;
  }
  const scp = /^(?:[^/@\s]+@)?([^/:\s]{2,}):(?!\/)(.*)$/.exec(text);
  if (scp) return `host:${scp[1].toLowerCase()}/${bare(scp[2].replace(/^\/+/, '')).toLowerCase()}`;
  return local(text);
}

// Whether two remote addresses name the same repository.
export const sameRemote = (a, b) => remoteKey(a) === remoteKey(b);
