// scripts/host/director-git.js
// The one place Wheelhouse asks the director's own git, with their global and system settings in force, which
// proxy it uses for a host's address (`http.proxy`, `http.proxyAuthMethod`). The answer is handed to `curl`
// (proxy.js, curl.js) so Wheelhouse's own calls to the host go by the same road the director's git does.
// The caller chooses the arguments: `git config --get-urlmatch` for settings, `git ls-remote` to see whether the
// director's git reaches the host as it is. Nothing is written.
import { run as realRun } from '../lib/run.js';
import { readProxy } from './proxy.js';

const ASK_MS = 15 * 1000;

// Runs the director's git (the one at `gitPath`) with the arguments given; gives { code, stdout }. Never prompts: git is
// told not to ask on a terminal, and Git Credential Manager not to open a window.
export async function askDirectorGit(args, { run = realRun, env = process.env, gitPath = 'git' } = {}) {
  const got = await run(gitPath, args, { baseEnv: env, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, timeoutMs: ASK_MS });
  return { code: got.code, stdout: String(got.stdout ?? '') };
}

// The proxy for an address (proxy.js readProxy's answer: null for none). Throws PROXY_HAS_PASSWORD when the
// director's git keeps a password in the proxy address; the caller shows that line.
export function directorProxy(address, { ask = askDirectorGit, env = process.env } = {}) {
  return readProxy({ address, ask, env });
}
