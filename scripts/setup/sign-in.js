// scripts/setup/sign-in.js
// Git's own sign-in on the "Use my git as it is" route. A step 3 attempt that could not reach the host for want of a sign-in (or the
// right one) records the address it tried, and the host's address (`base`), as an `answer` in the run (host.js ownSignInFailure,
// SIGN_IN_TARGET): never text git printed, and nothing a session passes in. Step 3's plan then asks a card (signInAsk) whether to open
// git's sign-in for it. Only after the director's click on that card does the helper's `/setup/sign-in` route (engine.js, signInNow
// here) ask git, in a folder of its own that is no repository, to list the project's branches with the director's own git and the
// same look at their settings first as step 3's calls have (host.js guardAsIsReach); the one change is that git may open its sign-in
// window (Git Credential Manager's) and the route waits several minutes for it, under a total time of its own that stays inside the
// playbook's command timeout. One card's click opens it once: the click must be fresh, and is marked used before anything opens. It never
// reads, asks for or shows a token, and it is the helper's, so it is refused under All stop, and All stop ends it (and the window's
// process group) while it waits.
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
import { gitSaid, scrubGitText, refuseUnlistedSettings, asIsGitEnv, reachFailureKind } from './git.js';
import { CLICK_FRESH_MS } from '../lib/setup-numbers.js';

export const SIGN_IN_TARGET = 'step 3: git sign-in address';
// The marker written, per card, before git's window opens: a click opens it once.
export const SIGN_IN_USED_TARGET = 'step 3: git sign-in opened';

// How long the director has to sign in, and how long the whole route may take (its wait and every git call before it). The playbook runs
// the form with a command timeout above both (SKILL.md, 600000 ms).
export const SIGN_IN_WAIT_MS = 7 * 60 * 1000;
export const SIGN_IN_TOTAL_MS = 9 * 60 * 1000;
// How often the wait looks at All stop.
export const STOP_LOOK_MS = 1000;
// How long a read of git's settings may take.
const SETTINGS_MS = 60 * 1000;
const GITHUB_ORIGIN = 'https://github.com';
// How far ahead of this computer's clock a click may read.
const SKEW_MS = 60 * 1000;

export const SIGN_IN_OTHER = 'Use another way to connect';
export const signInOpenLabel = (host) => `Open git's sign-in for ${host}`;
export const signInRetryLabel = (host) => `I have changed git's sign-in for ${host}`;
export const signInSignedLabel = (host) => `I have signed git in to ${host}`;
// The option that carries step 3 on after the director has changed git's sign-in outside setup, for a card that offers no window: where
// git is signed in as another account, or has no sign-in window of its own. Null for a card that offers git's window.
export const carryOnLabel = (pending) => (pending.why === 'account' ? signInRetryLabel(pending.host) : pending.gcm ? null : signInSignedLabel(pending.host));

const OTHER_WAY = 'choose another way to connect on step 3\'s card';
const AGAIN = 'I can open its sign-in again';
export const NO_SIGN_IN_ADDRESS = 'Setup has no address from step 3 to open git\'s sign-in for, so nothing was opened. A fresh Go ahead on step 3\'s card tries it again.';
export const NOT_CHOSEN = 'Git\'s sign-in was not opened, because it has not been chosen on its card yet.';
export const NOT_CHOSEN_DETAIL = 'Run plan 3 and ask the sign-in card it gives, then run this form once its first option has been clicked.';
export const CLICK_USED = 'Git\'s sign-in was already opened for that card, so it was not opened again.';
export const CLICK_STALE = 'The click on git\'s sign-in card is too old to open it now, so nothing was opened.';
export const CLICK_DETAIL = 'Run plan 3: the sign-in card is asked afresh, once. Ask it, then run this form.';
export const NOT_THE_CONNECTION = 'The address setup kept for git\'s sign-in is not the one step 3 connects to, so nothing was opened. A fresh Go ahead on step 3\'s card tries again.';
export const NOT_THE_CONNECTION_UNCLEARED = 'The address setup kept for git\'s sign-in is not the one step 3 connects to, so nothing was opened, and setup could not clear it. This is a fault in Wheelhouse: tell me and I\'ll report it.';
export const STOPPED_LINE = 'All stop is on, so git\'s sign-in was not opened.';
export const STOPPED_DETAIL = 'Once All stop is lifted, run plan 3 and ask the sign-in card it gives, then run this form.';
export const STOPPED_OPEN_LINE = 'All stop was turned on while git\'s sign-in was open, so setup stopped waiting and closed it.';
export const NO_GIT = 'Git is not on this computer yet, so nothing was opened; step 2 installs it, then a fresh Go ahead on step 3\'s card tries again.';
export const ACCOUNT_LINE = (host) => `Git on this computer is signed in to ${host} as a different account from the one that has access to the project, and its sign-in window would not open for that. Sign git out of ${host}, or in as the account that has access to the project (or have the account git uses added to the project), outside setup, then choose '${signInRetryLabel(host)}' on the card that follows; or ${OTHER_WAY} (recommended).`;
export const NO_WINDOW_LINE = (host) => `Git on this computer has no sign-in window of its own that setup can open for ${host}, so nothing was opened. Sign git in to ${host} outside setup, then choose '${signInSignedLabel(host)}' on the card that follows, or ${OTHER_WAY} (recommended).`;
export const NOT_RECORDED = 'Setup could not record that it was opening git\'s sign-in, so nothing was opened. A fresh Go ahead on step 3\'s card tries again.';
export const signedInLine = (host) => `Git reached ${host} and can see the project. Setup carries on with step 3.`;
export const NOT_KEPT = 'Setup could not keep its record of this try, which is a fault in Wheelhouse: tell me and I\'ll report it.';
export const NOT_KEPT_DETAIL = 'Do not run plan 3 or the sign-in form again; say the line and stop.';
export const SIGN_IN_ONCE_DETAIL = 'Run plan 3: the sign-in card is asked afresh, once. Once git\'s sign-in window has been opened and setup still can\'t reach the project, the card recommends "Use another way to connect"; ask each fresh card as given, and never run the sign-in form without a fresh click.';
// The line after a window that opened and did not get git to the project: the card that follows recommends another way.
export const failedLine = (host, said, { timedOut = false, gcm = true } = {}) => (!gcm
  ? `Git still could not reach ${host}${said === '' ? '' : ` (git said: ${said})`}. Next: sign git in to ${host} outside setup, then choose '${signInSignedLabel(host)}' on the card that follows, or ${OTHER_WAY} (recommended).`
  : timedOut
  ? `Git's sign-in for ${host} was not finished within ${SIGN_IN_WAIT_MS / 60000} minutes, so setup stopped waiting. Next: ${OTHER_WAY} (recommended), or ${AGAIN}.`
  : `Git still could not reach ${host}${said === '' ? '' : ` (git said: ${said})`}. Next: ${OTHER_WAY} (recommended), which is the way to go if its window asked for a token, or a password you don't use there; or ${AGAIN}.`);
// Git's window opened and git then reached the host as an account that can't see the project: the card that follows has the account's shape.
export const accountSeenLine = (host, said) => `Git reached ${host} as an account that can't see the project${said === '' ? '' : ` (git said: ${said})`}, so its sign-in window cannot help. Next: sign git out of ${host}, or in as the account that has access to the project (or have the account git uses added to the project), outside setup, then choose '${signInRetryLabel(host)}' on the card that follows; or ${OTHER_WAY} (recommended).`;
// A refusal before the window opened: where the card that follows recommends another way (`opened`), so does the line.
const neutralUnsafe = (opened) => `Setup could not make sure git would run where no project's settings reach it, so nothing was opened; ${opened ? `${OTHER_WAY} (recommended), or ${AGAIN}` : `${AGAIN}, or ${OTHER_WAY}`}.`;
const settingsUnchecked = (opened) => `Setup could not check git's settings before opening its sign-in, so nothing was opened; ${opened ? `${OTHER_WAY} (recommended), or ${AGAIN}` : `${AGAIN}, or ${OTHER_WAY}`}.`;

const GITHUB_HOST = new URL(GITHUB_ORIGIN).hostname;

// The record a failed step 3 attempt keeps: the address, the host's address (GitHub's own, or the company's GitLab as step 3 reached it,
// with its port and any path), why a sign-in is needed (`why`: 'sign-in' for none, 'account' where git is signed in as another account), whether
// git here has a sign-in window of its own to open (`gcm`, read by setup from git's settings), and when. `search` marks a look among the
// director's own projects, before the project is known.
export function signInRecord({ address, base = null, why = 'sign-in', search = false, gcm = false, now = () => new Date() }) {
  const url = new URL(address);
  const kept = url.hostname === GITHUB_HOST ? GITHUB_ORIGIN : (typeof base === 'string' && base !== '' ? base.replace(/\/+$/, '') : url.origin);
  return { address, base: kept, why: why === 'account' ? 'account' : 'sign-in', ...(search ? { search: true } : {}), gcm: gcm === true, at: now().toISOString() };
}

// Whether a value of git's `credential.helper` is Git Credential Manager (its own sign-in window).
// A value that starts with `!` is a shell command, not the manager.
const isManager = (value) => !value.trim().startsWith('!') && (/^(?:manager|manager-core)$/i.test(value.trim()) || /git-credential-manager/i.test(value));

// Whether the director's own git here has a sign-in window of its own to open: any value of `credential.helper` (an empty one clears
// those before it) is Git Credential Manager. Read from a folder of Wheelhouse's own that is no repository and has none above it, under
// the same ceiling and the same look at git's settings as the sign-in itself; anything unclear reads as no window.
export async function gitHasSignInWindow({ run = realRun, gitPath = 'git', home = wheelhouseHome(), url = null, platform = process.platform }) {
  let neutral = null;
  try {
    const root = path.resolve(home);
    fs.mkdirSync(root, { recursive: true });
    neutral = fs.mkdtempSync(path.join(root, 'sign-in-'));
    const env = asIsGitEnv({ GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: root });
    const baseEnv = asIsGitEnv(withoutGitVars());
    const inside = await run(gitPath, ['rev-parse', '--git-dir'], { cwd: neutral, env, baseEnv, timeoutMs: SETTINGS_MS });
    if (inside.code === 0 || inside.timedOut === true) return false;
    await refuseUnlistedSettings({ run, gitPath, cwd: neutral, env: { GIT_CEILING_DIRECTORIES: root }, baseEnv });
    const got = await run(gitPath, ['config', '--get-all', 'credential.helper'], { cwd: neutral, env, baseEnv, timeoutMs: SETTINGS_MS });
    if (got.code !== 0) return false;
    let helpers = [];
    for (const value of String(got.stdout ?? '').replace(/\r?\n$/, '').split(/\r?\n/)) helpers = value.trim() === '' ? [] : [...helpers, value];
    if (helpers.some(isManager)) return true;
    // A helper named for the address (`credential.<url>.helper`) counts too: the most specific one git matches to it.
    if (plainHttps(url) === null) return false;
    const scoped = await run(gitPath, ['config', '--get-urlmatch', 'credential.helper', url], { cwd: neutral, env, baseEnv, timeoutMs: SETTINGS_MS });
    if (scoped.code !== 0) return false;
    return String(scoped.stdout ?? '').split(/\r?\n/).some((value) => value.trim() !== '' && isManager(value));
  } catch {
    return false;
  } finally {
    if (neutral !== null) fs.rmSync(neutral, { recursive: true, force: true });
  }
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
// why, search, gcm, at }, or null when there is none, when the director's attempt since has reached the host (a record cleared), when the
// run is closed, when step 3 has been done since it was kept, or when its address is not a plain https one (no sign-in is offered for it).
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
  return { id: last.id, address: address.href, base: base.href.replace(/\/+$/, ''), host: address.hostname, why: sign.why === 'account' ? 'account' : 'sign-in', search: sign.search === true, gcm: sign.gcm === true, at: sign.at };
}

// Whether a sign-in kept for an earlier attempt is not for this one: step 3 now connects another way than "Use my git as it is" (`asIs`
// false), or to another host or another base than the record's. `url` is any address on the connection's host, `base` its GitLab's
// address (the record keeps GitHub's own for github.com).
export function signInOutdated(pending, { asIs, url, base }) {
  if (pending === null) return false;
  if (!asIs) return true;
  const host = new URL(url).hostname;
  const kept = host === GITHUB_HOST ? GITHUB_ORIGIN : String(base).replace(/\/+$/, '');
  return pending.host !== host || pending.base !== kept;
}

// Step 3's card for it, as a question (an id of its own to each record, so a fresh attempt is asked afresh). Where git is signed in as
// another account, git's own window would not open (it reuses that account), so no window is offered: the card asks the director to
// change git's sign-in outside setup, or to choose another way (recommended). Where git has no window of its own (`gcm` false), the card has
// the same shape: sign git in outside setup, then click, or choose another way (recommended); no window is offered. `platform` is the
// computer the card is shown on (where to sign git out differs).
// `tries` is how many cards this host has had; `opened` is whether git's window has been opened for an earlier record of this host.
export function signInAsk(pending, { platform = process.platform, tries = 1, opened = false } = {}) {
  const account = pending.why === 'account';
  // The card's words depend on the record and the try only (never the time), so the same record asked again says the same, and a later
  // record, which the Desktop app would show as the earlier card if it said the same, says it is a further try.
  const again = Number.isInteger(tries) && tries >= 2 ? `Asked again (card ${tries}): ` : null;
  const lead = (first, laterWords) => (again === null ? first : `${again}${laterWords}`);
  const open = signInOpenLabel(pending.host);
  const retry = signInRetryLabel(pending.host);
  const signed = signInSignedLabel(pending.host);
  // Where to sign git out, by the computer the card is shown on.
  const where = platform === 'win32' ? ' (in Windows\' Credential Manager, under Windows Credentials)' : platform === 'darwin' ? ' (in Keychain Access)' : '';
  const id = askId(pending);
  const otherSays = 'Step 3\'s connection card comes back, to choose a way that needs nothing from your git\'s sign-in.';
  if (account) {
    return {
      id,
      card: {
        level: 2,
        what: lead(`Git on this computer is signed in to ${pending.host} as a different account from the one that has access to the project, so setup could not reach it.`, `git on this computer reaches ${pending.host} as a different account from the one that has access to the project, so setup could not reach it.`),
        why: 'You chose to use your own git, so setup relies on its sign-in and makes none. Git would use the same account again and open no window, so setup opens none.',
        options: [
          { label: retry, says: `Do this first: sign git out of ${pending.host}${where}, or sign it in as the account that has access to the project (or have the account git uses added to the project), outside setup. Then click this, and setup carries on with step 3. Click this also once that account has been added.` },
          { label: SIGN_IN_OTHER, says: otherSays },
        ],
        recommend: SIGN_IN_OTHER,
        because: 'it works without any change to git\'s sign-in',
        meanwhile: 'Nothing more runs on step 3 until you choose.',
      },
    };
  }
  if (!pending.gcm) {
    return {
      id,
      card: {
        level: 2,
        what: lead(`Git on this computer isn't signed in to ${pending.host}, so setup could not reach the project there.`, `setup still could not reach the project on ${pending.host} with git's sign-in.`),
        why: 'You chose to use your own git, so setup relies on its sign-in and makes none. Git on this computer does not seem to have a sign-in window of its own, so setup opens none.',
        options: [
          { label: signed, says: `Do this first: sign git in to ${pending.host}, outside setup. Then click this, and setup carries on with step 3. If you're not sure how, choose another way to connect.` },
          { label: SIGN_IN_OTHER, says: otherSays },
        ],
        recommend: SIGN_IN_OTHER,
        because: 'it works without any change to git\'s sign-in',
        meanwhile: 'Nothing more runs on step 3 until you choose.',
      },
    };
  }
  return {
    id,
    card: {
      level: 2,
      what: lead(`Git on this computer isn't signed in to ${pending.host}, so setup could not reach the project there.`, `setup still could not reach the project on ${pending.host} with git's sign-in.`),
      why: 'You chose to use your own git, so setup relies on its sign-in and makes none. Git opens its own window for it, which may take a minute and may open behind other windows, and setup never sees what you type there.',
      options: [
        {
          label: open,
          says: 'Git\'s sign-in window opens (it may take a minute, and may open behind other windows). Sign in, then setup carries on with step 3. If it asks for a token, close it and choose another way to connect.',
        },
        { label: SIGN_IN_OTHER, says: otherSays },
      ],
      recommend: opened ? SIGN_IN_OTHER : open,
      because: opened ? `git's sign-in window has been opened before for ${pending.host}, and setup still can't reach the project` : 'it is the way you chose, and nothing else changes',
      meanwhile: 'Nothing more runs on step 3 until you choose.',
    },
  };
}

// The id of a record's card: its words and the record only (never the time).
function askId({ id, address, at }) {
  return `git-sign-in-${crypto.createHash('sha256').update(`${id}\n${address}\n${at}`).digest('hex').slice(0, 10)}`;
}

// The sign-in records a run has kept for a host (a cleared record is none), as the journal holds them; every host's when `host` is null.
function recordsOf(run, host) {
  return (Array.isArray(run?.changes) ? run.changes : []).filter((c) => {
    if (c?.kind !== 'answer' || c.target !== SIGN_IN_TARGET || c.after?.signIn === null || typeof c.after?.signIn !== 'object') return false;
    if (host === null) return true;
    try {
      return new URL(c.after.signIn.address).hostname === host;
    } catch {
      return false;
    }
  });
}

// How many sign-in records a run has kept for this host: the try the latest one is (a cleared record is no try; another host's is not this one's).
export function triesOf(run, host = null) {
  return Math.max(1, recordsOf(run, host).length);
}

// Whether git's window has been opened for a record of this host: a card of its click was marked used, which is kept before anything opens.
// `exceptId` is the record being asked: its own mark is left out, so asking it again says what it said before the window opened.
export function openedOf(run, host, exceptId = null) {
  const used = new Set((Array.isArray(run?.changes) ? run.changes : []).filter((c) => c?.kind === 'answer' && c.target === SIGN_IN_USED_TARGET).map((c) => c.after?.used));
  return recordsOf(run, host).filter((c) => exceptId === null || c.id !== exceptId).some((c) => {
    try {
      return used.has(askId({ id: c.id, address: new URL(c.after.signIn.address).href, at: c.after.signIn.at }));
    } catch {
      return false;
    }
  });
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

// Opens git's sign-in for the pending address, from a neutral folder, and gives { ok: true, line } once git reaches the project, or
// { ok: false, refused, detail? } (`detail` is for the agent alone, scrubbed). `route` gives what only host.js knows: `reachEnv({ host,
// url, gitPath, platform, base })` (the as-is environment), `guard({ run, gitPath, cwd, env, url, timeoutMs, baseEnv })` (the look at the director's
// settings, which gives the call's environment), `findGit()`, `remoteRepo` and `gitlabHosts` for the connection check, and `record(change)`
// (the run's journal). A refusal or a failed attempt that reached git keeps a new record, so the card is asked afresh before git's window
// opens again; one that shows the record cannot be used (not the connection, no git) clears it. The click must be fresh and newer than
// the record, and is marked used before anything opens. Every git call is held to the route's total time (`totalMs`), the wait to
// `timeoutMs`.
export async function signInNow({
  journalRun, answers = {}, stopped = () => false, route, run = realRun, platform = process.platform, home = wheelhouseHome(),
  timeoutMs = SIGN_IN_WAIT_MS, totalMs = SIGN_IN_TOTAL_MS, now = () => new Date(),
}) {
  const refuse = (refused, detail) => ({ ok: false, refused, ...(typeof detail === 'string' && detail !== '' ? { detail: scrubGitText(detail) } : {}) });
  if (stopped()) return refuse(STOPPED_LINE, STOPPED_DETAIL);
  const pending = pendingSignIn(journalRun);
  if (pending === null) return refuse(NO_SIGN_IN_ADDRESS);
  const writes = (after, target = SIGN_IN_TARGET) => {
    try {
      route.record({ id: newId('chg'), step: 3, kind: 'answer', target, before: null, after });
      return true;
    } catch {
      return false;
    }
  };
  // A fresh record of the same address, so the card is asked afresh; whether it could be kept.
  const kept = (why = pending.why) => writes({ signIn: signInRecord({ address: pending.address, base: pending.base, why, search: pending.search, gcm: pending.gcm, now }) });
  const cleared = (reason) => writes({ signIn: null, cleared: reason });
  // Where git is signed in as another account, git's window would not open: no sign-in is opened for it.
  if (pending.why === 'account') return refuse(ACCOUNT_LINE(pending.host));
  // Nor where git has no window of its own: the card offers none to click.
  if (!pending.gcm) return refuse(NO_WINDOW_LINE(pending.host));
  // Whether the card that follows a refusal before the window opens recommends another way: git's window has opened before for this host.
  const wasOpened = openedOf(journalRun, pending.host);
  const ask = signInAsk(pending, { platform, tries: triesOf(journalRun, pending.host), opened: openedOf(journalRun, pending.host, pending.id) });
  // A refusal that keeps a fresh record so the card is asked afresh: a fault in Wheelhouse if the record could not be kept.
  const keptRefuse = (refused, detail, why) => (kept(why) ? refuse(refused, detail) : refuse(NOT_KEPT, NOT_KEPT_DETAIL));
  const click = answers[`3.${ask.id}`];
  if (click?.label !== signInOpenLabel(pending.host)) return refuse(NOT_CHOSEN, NOT_CHOSEN_DETAIL);
  const used = (Array.isArray(journalRun.changes) ? journalRun.changes : []).some((c) => c?.kind === 'answer' && c.target === SIGN_IN_USED_TARGET && c.after?.used === ask.id);
  if (used) return keptRefuse(CLICK_USED, CLICK_DETAIL);
  const clicked = Date.parse(click.at);
  const age = now().getTime() - clicked;
  if (!Number.isFinite(clicked) || age > CLICK_FRESH_MS || age < -SKEW_MS || clicked <= Date.parse(pending.at)) {
    return keptRefuse(CLICK_STALE, CLICK_DETAIL);
  }
  const problem = connectionProblem({ pending, run: journalRun, remoteRepo: route.remoteRepo, gitlabHosts: route.gitlabHosts });
  if (problem !== null) return refuse(cleared('not the connection') ? NOT_THE_CONNECTION : NOT_THE_CONNECTION_UNCLEARED, problem);
  // The route's total time starts before the first thing it looks at.
  const began = Date.now();
  const left = () => totalMs - (Date.now() - began);
  const git = await route.findGit();
  if (!git?.ok || typeof git.path !== 'string') {
    cleared('no git');
    return refuse(NO_GIT);
  }
  const host = pending.host;
  // Every call before the window is held to what is left of the route's total time.
  const limited = async (file, args, options = {}) => {
    const remaining = left();
    if (remaining <= 0) return { code: 1, stdout: '', stderr: '', timedOut: true };
    return run(file, args, { ...options, timeoutMs: Math.min(options.timeoutMs ?? Infinity, remaining) });
  };
  // A folder of its own under Wheelhouse's, that is no repository and has none above it that git may use.
  const root = path.resolve(home);
  fs.mkdirSync(root, { recursive: true });
  const neutral = fs.mkdtempSync(path.join(root, 'sign-in-'));
  const ceiling = { GIT_CEILING_DIRECTORIES: path.dirname(neutral) };
  // One base for every git call here: the director's own, less what could make git or its helper load or trace code of anyone's.
  const baseEnv = asIsGitEnv(withoutGitVars());
  try {
    const inside = await limited(git.path, ['rev-parse', '--git-dir'], { cwd: neutral, env: { GIT_TERMINAL_PROMPT: '0', ...ceiling }, baseEnv, timeoutMs: SETTINGS_MS });
    if (inside.code === 0 || inside.timedOut === true) {
      return keptRefuse(neutralUnsafe(wasOpened), inside.timedOut === true ? 'git did not answer in time where the sign-in\'s folder is' : `git found a repository at ${String(inside.stdout ?? '').trim()} for the sign-in's folder, ${neutral}`);
    }
    try {
      await refuseUnlistedSettings({ run: limited, gitPath: git.path, cwd: neutral, env: ceiling, baseEnv });
    } catch (error) {
      return keptRefuse(settingsUnchecked(wasOpened), error instanceof Error ? error.message : undefined);
    }
    const isGitHub = host === GITHUB_HOST;
    const reach = route.reachEnv({ host: isGitHub ? 'github' : 'gitlab', url: pending.address, gitPath: git.path, platform, base: isGitHub ? undefined : pending.base });
    let given;
    try {
      given = await route.guard({ run: limited, gitPath: git.path, cwd: neutral, env: { ...reach, ...ceiling }, url: pending.address, timeoutMs: SETTINGS_MS, baseEnv });
    } catch (error) {
      const line = typeof error?.lineFor === 'function' ? error.lineFor({ stop: 'nothing was opened', again: wasOpened ? null : AGAIN }) : settingsUnchecked(wasOpened);
      return keptRefuse(line, error?.detail ?? (error instanceof Error ? error.message : undefined));
    }
    if (stopped()) return refuse(STOPPED_LINE, STOPPED_DETAIL);
    // The click opens it once: marked before anything opens, and nothing opens if the mark cannot be kept.
    if (!writes({ used: ask.id }, SIGN_IN_USED_TARGET)) return refuse(NOT_RECORDED);
    // The one change from step 3's calls: git's own window may open. Git itself is still told not to prompt in a terminal, and nothing
    // here traces what the credential helper does. Off Windows the call leads a process group of its own, ended with it, so a window git's
    // helper opened does not outlast the wait or All stop. (windowsHide only stops a console window, never the helper's own window.)
    const opened = asIsGitEnv({ ...given, GCM_INTERACTIVE: 'auto' }, { keep: ['GCM_INTERACTIVE'] });
    const controller = new AbortController();
    const watch = setInterval(() => { if (stopped()) controller.abort(); }, STOP_LOOK_MS);
    let got;
    try {
      got = await limited(git.path, ['ls-remote', '--heads', '--end-of-options', pending.address], {
        cwd: neutral, env: opened, baseEnv, timeoutMs, signal: controller.signal, ownGroup: true, platform,
      });
    } finally {
      clearInterval(watch);
    }
    if (stopped() || got.stopped === true) {
      return kept() ? refuse(STOPPED_OPEN_LINE, STOPPED_DETAIL) : refuse(`${STOPPED_OPEN_LINE} ${NOT_KEPT}`, NOT_KEPT_DETAIL);
    }
    if (got.code !== 0) {
      const said = got.timedOut === true ? '' : gitSaid(got.stderr);
      // Git opened its window and reached the host as an account that can't see the project: it is signed in, as another account.
      if (got.timedOut !== true && reachFailureKind(got.stderr) === 'not-found') return keptRefuse(accountSeenLine(host, said), SIGN_IN_ONCE_DETAIL, 'account');
      return keptRefuse(failedLine(host, said, { timedOut: got.timedOut === true, gcm: pending.gcm }), SIGN_IN_ONCE_DETAIL);
    }
    writes({ signIn: null, reached: now().toISOString() });
    return { ok: true, line: signedInLine(host) };
  } finally {
    fs.rmSync(neutral, { recursive: true, force: true });
  }
}
