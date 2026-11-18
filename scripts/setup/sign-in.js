// scripts/setup/sign-in.js
// `cli.js sign-in`: opens git's own sign-in for the host a step 3 attempt on the "Use my git as it is" route could not reach,
// so the director can sign in in git's window (Git Credential Manager's), and says whether git then reached the project.
//
// The address is the one setup itself recorded when that attempt failed on a missing sign-in (host.js SIGN_IN_TARGET, an `answer`
// in this folder's setup run), never text git printed or anything a session passes in. With none recorded, it refuses. It asks
// git, in a folder of its own that is no repository, to list the project's branches, with the director's own git as step 3's
// calls have it (asIsReachEnv) and the same look at the director's settings first (guardAsIsReach); the one change from them
// is that git may now open its sign-in window. It waits several minutes for it. It never reads, asks for or shows a token.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as realRun, withoutGitVars } from '../lib/run.js';
import { findRun } from './journal.js';
import { gitFailure } from './git.js';
import { toolsStatus } from './tools.js';
import { asIsReachEnv, guardAsIsReach, SIGN_IN_TARGET } from './host.js';

// How long the director has to sign in.
export const SIGN_IN_WAIT_MS = 8 * 60 * 1000;

export const NO_SIGN_IN_ADDRESS = 'Setup has no repository address recorded from step 3 to open a sign-in for, so nothing was opened. Run setup\'s step 3 again; if its line then offers git\'s sign-in, ask again.';
export const signedInLine = (host) => `Signed in: git reached ${host} and can see the project. A fresh Go ahead tries step 3 again.`;

// The address setup recorded for the latest run in `folder`: https, no user, no query, or null.
export function recordedAddress(folder, { find = findRun } = {}) {
  const run = find(folder);
  const mine = (Array.isArray(run?.changes) ? run.changes : []).filter((c) => c?.kind === 'answer' && c.target === SIGN_IN_TARGET);
  const address = mine.at(-1)?.after?.signIn?.address;
  if (typeof address !== 'string') return null;
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.host === '') return null;
    return url;
  } catch {
    return null;
  }
}

// Runs it for `folder`; gives the one line to say. A refusal is a thrown error whose message is the line.
export async function signIn({
  folder, run = realRun, platform = process.platform, env = process.env, home = os.tmpdir(), timeoutMs = SIGN_IN_WAIT_MS, find = findRun,
  findGit = async () => (await toolsStatus({ platform, run, tools: ['git'] })).git,
}) {
  const url = recordedAddress(folder, { find });
  if (url === null) throw new Error(NO_SIGN_IN_ADDRESS);
  const address = url.href;
  const isGitHub = url.hostname === 'github.com';
  const git = await findGit({ platform });
  if (!git?.ok || typeof git.path !== 'string') throw new Error('git is not on this computer yet; step 2 installs it');
  const reach = asIsReachEnv({ host: isGitHub ? 'github' : 'gitlab', url: address, gitPath: git.path, env, platform, base: isGitHub ? undefined : url.origin });
  // A folder of its own that is no repository, so no setting of the project's reaches the call.
  const neutral = fs.mkdtempSync(path.join(home, 'wheelhouse-sign-in-'));
  try {
    const given = await guardAsIsReach({ run, gitPath: git.path, cwd: neutral, env: reach, url: address, timeoutMs });
    // The one change: git may open its sign-in window (the call is a listing, so it changes nothing on the host).
    const opened = { ...given, GIT_TERMINAL_PROMPT: '1', GCM_INTERACTIVE: 'auto' };
    const got = await run(git.path, ['ls-remote', '--heads', '--end-of-options', address], { cwd: neutral, env: opened, baseEnv: withoutGitVars(), timeoutMs });
    if (got.code !== 0) {
      throw new Error(gitFailure(`Git could not reach ${url.hostname} after its sign-in was opened`, got.stderr, { then: 'if its window asked for a token, or for a password you don\'t use for that site, close it and choose the other way to connect on step 3\'s card' }));
    }
    return signedInLine(url.hostname);
  } finally {
    fs.rmSync(neutral, { recursive: true, force: true });
  }
}
