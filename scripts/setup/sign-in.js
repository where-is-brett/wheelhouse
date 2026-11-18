// scripts/setup/sign-in.js
// Git's own sign-in on the "Use my git as it is" route. A step 3 attempt that could not reach the host for want of a sign-in (or the
// right one) records the address it tried, and the host's address (`base`), as an `answer` in the run (host.js ownSignInFailure,
// SIGN_IN_TARGET): never text git printed, and nothing a session passes in. Step 3's plan then asks a card (signInAsk) whether to open
// git's sign-in for it. Only after the director's click on that card does the helper's `/setup/sign-in` route (engine.js, signInNow
// here) ask git, in a folder of its own that is no repository, to list the project's branches with the director's own git and the
// same look at their settings first as step 3's calls have (host.js guardAsIsReach); the one change is that git may open its sign-in
// window (Git Credential Manager's) and the route waits several minutes for it. It never reads, asks for or shows a token, and it
// is the helper's, so it is refused under All stop, and All stop ends it while it waits.
//
// Nothing here imports host.js (which imports this): the as-is environment and the guard are given by the route.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run as realRun, withoutGitVars } from '../lib/run.js';
import { wheelhouseHome } from '../lib/paths.js';
import { runClosed } from '../lib/setup-run.js';
import { gitlabBase, DEFAULT_GITLAB } from '../host/gitlab-base.js';
import { newId } from './journal.js';
import { gitSaid, refuseUnlistedSettings } from './git.js';

export const SIGN_IN_TARGET = 'step 3: git sign-in address';

// How long the director has to sign in. The playbook runs the form with a command timeout above this (SKILL.md, 600000 ms).
export const SIGN_IN_WAIT_MS = 8 * 60 * 1000;
// How often the wait looks at All stop.
export const STOP_LOOK_MS = 1000;
// How long a read of git's settings may take.
const SETTINGS_MS = 60 * 1000;
const GITHUB_ORIGIN = 'https://github.com';

export const SIGN_IN_OTHER = 'Use the other way to connect';
export const signInOpenLabel = (host) => `Open git's sign-in for ${host} (recommended)`;

const OTHER_WAY = 'choose the other way to connect on step 3\'s card';
const AGAIN = 'I can open its sign-in again';
export const NO_SIGN_IN_ADDRESS = 'Setup has no address from step 3 to open git\'s sign-in for, so nothing was opened. A fresh Go ahead on step 3\'s card tries it again.';
export const NOT_CHOSEN = 'The director has not chosen git\'s sign-in on its card, so nothing was opened. Run plan 3 and ask that card.';
export const NOT_THE_CONNECTION = 'The address setup kept for git\'s sign-in is not the one step 3 connects to, so nothing was opened. A fresh Go ahead on step 3\'s card tries again.';
export const STOPPED_LINE = 'All stop is on, so git\'s sign-in was not opened. Lift All stop first, then run plan 3 again.';
export const NO_GIT = 'git is not on this computer yet; step 2 installs it';
export const signedInLine = (host) => `Git reached ${host} and can see the project.`;
export const failedLine = (host, said) => `Git still could not reach ${host}${said === '' ? '' : ` (git said: ${said})`}. Next: ${AGAIN}; if its window asked for a token, or a password you don't use there, close it and ${OTHER_WAY}.`;
const NEUTRAL_UNSAFE = `Setup could not make sure git would run where no project's settings reach it, so nothing was opened; ${AGAIN}, or ${OTHER_WAY}.`;
const SETTINGS_UNCHECKED = `Setup could not check git's settings before opening its sign-in, so nothing was opened; ${AGAIN}, or ${OTHER_WAY}.`;

const GITHUB_HOST = new URL(GITHUB_ORIGIN).hostname;

// The record a failed step 3 attempt keeps: the address, the host's address (GitHub's own, or the company's GitLab as step 3 reached it,
// with its port and any path), why a sign-in is needed (`why`: 'sign-in' for none, 'account' where git is signed in as another account), and
// when. `search` marks a look among the director's own projects, before the project is known.
export function signInRecord({ address, base = null, why = 'sign-in', search = false, now = () => new Date() }) {
  const url = new URL(address);
  const kept = url.hostname === GITHUB_HOST ? GITHUB_ORIGIN : (typeof base === 'string' && base !== '' ? base.replace(/\/+$/, '') : url.origin);
  return { address, base: kept, why: why === 'account' ? 'account' : 'sign-in', ...(search ? { search: true } : {}), at: now().toISOString() };
}

// A plain https address with no user, query or fragment, as a URL, or null.
function plainHttps(text) {
  if (typeof text !== 'string') return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.search === '' && url.hash === '' && url.host !== '' ? url : null;
  } catch {
    return null;
  }
}

// The sign-in step 3 is waiting on, from a run (as the journal holds it): the latest record of this kind, as { id, address, base, host,
// why, search, at }, or null when there is none, when the director's attempt since has reached the host (a record cleared), when the run is
// closed, when step 3 has been done since it was kept, or when its address is not a plain https one (no sign-in is offered for it).
export function pendingSignIn(run) {
  if (run === null || run === undefined || runClosed(run)) return null;
  const last = (Array.isArray(run.changes) ? run.changes : []).filter((c) => c?.kind === 'answer' && c.target === SIGN_IN_TARGET).at(-1);
  const sign = last?.after?.signIn;
  if (sign === null || typeof sign !== 'object') return null;
  const address = plainHttps(sign.address);
  const base = plainHttps(sign.base);
  const at = Date.parse(sign.at);
  if (address === null || base === null || !Number.isFinite(at) || typeof last.id !== 'string') return null;
  const done = run.steps?.[3]?.doneAt;
  if (typeof done === 'string' && Date.parse(done) >= at) return null;
  return { id: last.id, address: address.href, base: base.href.replace(/\/+$/, ''), host: address.hostname, why: sign.why === 'account' ? 'account' : 'sign-in', search: sign.search === true, at: sign.at };
}

// Step 3's card for it, as a question (an id of its own to each record, so a fresh attempt is asked afresh).
export function signInAsk(pending) {
  const account = pending.why === 'account';
  const open = signInOpenLabel(pending.host);
  const id = `git-sign-in-${crypto.createHash('sha256').update(`${pending.id}\n${pending.address}\n${pending.at}`).digest('hex').slice(0, 10)}`;
  return {
    id,
    card: {
      level: 2,
      what: account
        ? `Git on this computer is signed in to ${pending.host} as a different account from the one setup made the project on.`
        : `Git on this computer isn't signed in to ${pending.host}, so setup could not reach the project there.`,
      why: 'You chose to use your own git, so setup relies on its sign-in and makes none. Git opens its own window for it, and setup never sees what you type there.',
      options: [
        { label: open, says: account ? 'Git\'s sign-in window opens. Sign in with the account that owns the project, then say Go ahead again on step 3.' : 'Git\'s sign-in window opens. Sign in, then say Go ahead again on step 3.' },
        { label: SIGN_IN_OTHER, says: 'Step 3\'s connection card comes back, to choose a way that needs nothing from your git\'s sign-in.' },
      ],
      recommend: open,
      because: 'it is the way you chose, and nothing else changes',
      meanwhile: 'Nothing more runs on step 3 until you choose.',
    },
  };
}

// Why the pending address is not the run's step 3 connection, or null when it is: its host is GitHub's or the public GitLab's, or a GitLab
// the project's settings name (`gitlabHosts`), reached at the base the record keeps; the address lies under that base; and its project
// path is one of the run's own: the folder's remote's (`remoteRepo`), a repository setup made, or one it brought in (a look among the
// director's own projects, `search`, is for a project of that name).
export function connectionProblem({ pending, run, remoteRepo = null, gitlabHosts = [] }) {
  const address = new URL(pending.address);
  const base = new URL(pending.base);
  const baseText = base.href.replace(/\/+$/, '');
  if (base.hostname === GITHUB_HOST) {
    if (base.origin !== GITHUB_ORIGIN || base.pathname !== '/') return `the base ${pending.base} is not GitHub's`;
  } else if (base.origin !== new URL(DEFAULT_GITLAB).origin && gitlabBase({ config: { gitlabHosts }, remoteUrl: `${base.origin}/o/p.git` }) !== base.origin) {
    return `the base ${pending.base} is neither the public GitLab nor one the project's settings name`;
  }
  if (!address.href.startsWith(`${baseText}/`)) return `the address ${pending.address} is not under ${pending.base}`;
  let project;
  try {
    project = decodeURIComponent(address.pathname.slice(base.pathname.replace(/\/+$/, '').length)).replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase();
  } catch {
    return `the address ${pending.address} has no readable project path`;
  }
  const changes = Array.isArray(run?.changes) ? run.changes : [];
  const own = new Set([
    remoteRepo,
    ...changes.filter((c) => c?.kind === 'host').map((c) => c.after?.repository),
    ...changes.filter((c) => c?.kind === 'folder').map((c) => c.after?.joined),
  ].filter((r) => typeof r === 'string' && r !== '').map((r) => r.toLowerCase()));
  if (own.has(project)) return null;
  if (pending.search) {
    const wanted = changes.filter((c) => c?.kind === 'answer' && c.step === 3 && typeof c.after?.joined === 'string').at(-1)?.after.joined;
    if (typeof wanted === 'string' && wanted.split('/').at(-1).toLowerCase() === project.split('/').at(-1)) return null;
  }
  return `the project ${project} is none of this run's step 3 projects`;
}

const withoutTrace = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => !/^GCM_(?:TRACE|DEBUG)/i.test(name)));

// Opens git's sign-in for the pending address, from a neutral folder, and gives { ok: true, line } once git reaches the project, or
// { ok: false, refused, detail? } (`detail` is for the agent alone). `route` gives what only host.js knows: `reachEnv({ host, url, gitPath,
// platform, base })` (the as-is environment), `guard({ run, gitPath, cwd, env, url, timeoutMs })` (the look at the director's settings, which
// gives the call's environment), `findGit()`, `remoteRepo` and `gitlabHosts` for the connection check, and `record(change)` (the run's journal).
// A refusal or a failed attempt that reached git keeps a new record, so the card is asked afresh before git's window opens again.
export async function signInNow({
  journalRun, answers = {}, stopped = () => false, route, run = realRun, platform = process.platform, home = wheelhouseHome(),
  timeoutMs = SIGN_IN_WAIT_MS, now = () => new Date(),
}) {
  const refuse = (refused, detail) => ({ ok: false, refused, ...(typeof detail === 'string' && detail !== '' ? { detail } : {}) });
  if (stopped()) return refuse(STOPPED_LINE);
  const pending = pendingSignIn(journalRun);
  if (pending === null) return refuse(NO_SIGN_IN_ADDRESS);
  if (answers[`3.${signInAsk(pending).id}`]?.label !== signInOpenLabel(pending.host)) return refuse(NOT_CHOSEN);
  const problem = connectionProblem({ pending, run: journalRun, remoteRepo: route.remoteRepo, gitlabHosts: route.gitlabHosts });
  if (problem !== null) return refuse(NOT_THE_CONNECTION, problem);
  const git = await route.findGit();
  if (!git?.ok || typeof git.path !== 'string') return refuse(NO_GIT);
  const kept = (why) => {
    try {
      route.record({ id: newId('chg'), step: 3, kind: 'answer', target: SIGN_IN_TARGET, before: null, after: { signIn: signInRecord({ address: pending.address, base: pending.base, why, search: pending.search, now }) } });
    } catch { /* the card is asked again from the older record */ }
  };
  const host = pending.host;
  // A folder of its own under Wheelhouse's, that is no repository and has none above it that git may use.
  fs.mkdirSync(home, { recursive: true });
  const neutral = fs.mkdtempSync(path.join(home, 'sign-in-'));
  const ceiling = { GIT_CEILING_DIRECTORIES: path.dirname(neutral) };
  try {
    const inside = await run(git.path, ['rev-parse', '--git-dir'], { cwd: neutral, env: { GIT_TERMINAL_PROMPT: '0', ...ceiling }, baseEnv: withoutGitVars(), timeoutMs: SETTINGS_MS });
    if (inside.code === 0) {
      kept(pending.why);
      return refuse(NEUTRAL_UNSAFE, `git found a repository at ${String(inside.stdout ?? '').trim()} for the sign-in's folder, ${neutral}`);
    }
    try {
      await refuseUnlistedSettings({ run, gitPath: git.path, cwd: neutral });
    } catch (error) {
      kept(pending.why);
      return refuse(SETTINGS_UNCHECKED, error instanceof Error ? error.message : undefined);
    }
    const isGitHub = host === GITHUB_HOST;
    const reach = route.reachEnv({ host: isGitHub ? 'github' : 'gitlab', url: pending.address, gitPath: git.path, platform, base: isGitHub ? undefined : pending.base });
    let given;
    try {
      given = await route.guard({ run, gitPath: git.path, cwd: neutral, env: { ...reach, ...ceiling }, url: pending.address, timeoutMs: SETTINGS_MS });
    } catch (error) {
      kept(pending.why);
      const line = typeof error?.lineFor === 'function' ? error.lineFor({ stop: 'nothing was opened', again: AGAIN }) : (error instanceof Error ? error.message : SETTINGS_UNCHECKED);
      return refuse(line, error?.detail);
    }
    if (stopped()) return refuse(STOPPED_LINE);
    // The one change from step 3's calls: git's own window may open. Git itself is still told not to prompt in a terminal, and nothing
    // here traces what the credential helper does.
    const opened = withoutTrace({ ...given, GCM_INTERACTIVE: 'auto' });
    const controller = new AbortController();
    const watch = setInterval(() => { if (stopped()) controller.abort(); }, STOP_LOOK_MS);
    let got;
    try {
      got = await run(git.path, ['ls-remote', '--heads', '--end-of-options', pending.address], { cwd: neutral, env: opened, baseEnv: withoutTrace(withoutGitVars()), timeoutMs, signal: controller.signal });
    } finally {
      clearInterval(watch);
    }
    if (stopped() || got.stopped === true) return refuse(STOPPED_LINE);
    if (got.code !== 0) {
      kept(pending.why);
      return refuse(failedLine(host, got.timedOut === true ? '' : gitSaid(got.stderr)));
    }
    try {
      route.record({ id: newId('chg'), step: 3, kind: 'answer', target: SIGN_IN_TARGET, before: null, after: { signIn: null, reached: now().toISOString() } });
    } catch { /* a record that could not be kept leaves the card to be asked once more */ }
    return { ok: true, line: signedInLine(host) };
  } finally {
    fs.rmSync(neutral, { recursive: true, force: true });
  }
}
