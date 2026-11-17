// scripts/host/director-git.js
// The one place Wheelhouse asks the director's own git, with their global and system settings in force, which
// proxy it uses for a host's address (`http.proxy`, `http.proxyAuthMethod`). The answer is handed to `curl`
// (proxy.js, curl.js) so Wheelhouse's own calls to the host go by the same road the director's git does.
// The caller chooses the arguments: `git config --get-urlmatch` for settings, `git ls-remote` to see whether the
// director's git reaches the host as it is. Nothing is written.
import { run as realRun } from '../lib/run.js';
import fs from 'node:fs';
import path from 'node:path';
import { readProxy } from './proxy.js';
import { wheelhouseHome } from '../lib/paths.js';
import { withoutTokens } from '../lib/token-names.js';

const ASK_MS = 15 * 1000;

// Runs the director's git (the one at `gitPath`) with the arguments given; gives { code, stdout }. Never prompts: git is
// told not to ask on a terminal, and Git Credential Manager not to open a window.
export async function askDirectorGit(args, { run = realRun, env = process.env, gitPath = 'git', cwd } = {}) {
  const got = await run(gitPath, args, { baseEnv: env, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, timeoutMs: ASK_MS, ...(cwd === undefined ? {} : { cwd }) });
  return { code: got.code, stdout: String(got.stdout ?? '') };
}

// A folder of Wheelhouse's own, made if need be, where the director's git is asked what it needs no repository for: never the
// system's temporary folder, which may sit inside a repository.
export function outsideRepo() {
  const home = wheelhouseHome();
  fs.mkdirSync(home, { recursive: true });
  return home;
}

// The environment the director's git is asked in: none of git's own variables (GIT_DIR, GIT_CONFIG*, GIT_WORK_TREE and the rest,
// which could point it anywhere), and only https and ssh to reach by.
// Git looks for a repository no higher than Wheelhouse's own folder's parent, so a repository above it is never found.
export const ceilingOf = () => path.dirname(path.resolve(wheelhouseHome()));
export const directorGitEnv = (env) => ({ ...Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/i.test(key))), GIT_ALLOW_PROTOCOL: 'https:ssh', GIT_CEILING_DIRECTORIES: ceilingOf() });

// The proxy for an address (proxy.js readProxy's answer: null for none). Throws PROXY_HAS_PASSWORD when the
// director's git keeps a password in the proxy address; the caller shows that line.
// Unless the caller gives its own `ask`, the director's git is asked from a folder of Wheelhouse's own, outside any project,
// with git's own variables and the token variables left out.
export function directorProxy(address, { ask, env = process.env, run, gitPath } = {}) {
  const asked = ask ?? ((args) => askDirectorGit(args, { cwd: outsideRepo(), env: directorGitEnv({ ...env, ...withoutTokens({ env: { ...process.env, ...env } }) }), ...(run === undefined ? {} : { run }), ...(gitPath === undefined ? {} : { gitPath }) }));
  return readProxy({ address, ask: asked, env });
}
