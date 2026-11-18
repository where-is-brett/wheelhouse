// tests/scripts/setup/sign-in.test.js
// Git's own sign-in on the "Use my git as it is" route. A failed step 3 attempt keeps the address and its host's address in setup's run;
// step 3's plan asks a card about it; and only after the director's click on that card does the helper's `/setup/sign-in` route ask
// git, from a folder of its own, to list the project's branches, with the director's own settings looked at first, All stop checked
// before and while it waits, and git's window allowed. The form (`cli.js sign-in`) only asks the helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  signInNow, pendingSignIn, signInAsk, signInRecord, signInOpenLabel, signInRetryLabel, signInSignedLabel, carryOnLabel, signInOutdated, triesOf, connectionProblem, gitHasSignInWindow, SIGN_IN_TARGET,
  SIGN_IN_USED_TARGET, SIGN_IN_OTHER, SIGN_IN_WAIT_MS, SIGN_IN_TOTAL_MS, NO_SIGN_IN_ADDRESS, NOT_CHOSEN, NOT_THE_CONNECTION, STOPPED_LINE,
  STOPPED_OPEN_LINE, NO_GIT, ACCOUNT_LINE, NO_WINDOW_LINE, CLICK_USED, CLICK_STALE, NOT_RECORDED, signedInLine, failedLine,
} from '../../../scripts/setup/sign-in.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { asIsReachEnv, guardAsIsReach } from '../../../scripts/setup/host.js';
import { scrubGitText, asIsGitEnv, setupGit } from '../../../scripts/setup/git.js';
import { CLICK_FRESH_MS } from '../../../scripts/lib/setup-numbers.js';
import { startRun, addChanges, readJournal, markStep } from '../../../scripts/setup/journal.js';
import { setupRoutes } from '../../../scripts/setup/engine.js';
import { main } from '../../../scripts/setup/cli.js';
import { as, shortHome, tempFolder } from '../../helpers/homes.js';
import { withProject, T0 } from '../../helpers/setup-answers.js';

const ADDRESS = 'https://gitlab.com/owner/shop.git';
const BASE = 'https://gitlab.com';
const FOLDER = '/x/Projects/shop';

// A run as the journal holds it, with a record of the kind a failed attempt keeps (and, by default, a repository setup made).
const record = ({ address = ADDRESS, base = BASE, why, search, gcm = true, at = '2026-11-18T01:00:00.000Z', id = 'chg_1' } = {}) => ({
  id, step: 3, kind: 'answer', target: SIGN_IN_TARGET, before: null, after: { signIn: { address, base, why: why ?? 'sign-in', ...(search ? { search: true } : {}), gcm, at } },
});
const made = (repo = 'owner/shop') => ({ id: 'chg_h', step: 3, kind: 'host', target: `gitlab:${repo}`, before: null, after: { repository: repo, private: true, made: true } });
const runOf = (...changes) => ({ id: 'run_1', folder: FOLDER, startedAt: '2026-11-18T00:00:00.000Z', steps: {}, changes: [made(), ...changes] });
const NOW = '2026-11-18T01:05:00.000Z';
const chosen = (pending, at = '2026-11-18T01:01:00.000Z') => ({ [`3.${signInAsk(pending).id}`]: { label: signInOpenLabel(pending.host), at } });

// A stand-in git: the guard's reads answer as a clean computer's, no folder holds a repository, and each ls-remote is kept.
const fakeGit = ({ list = 'global\0user.name\nx\0', rewrite = null, listing = { code: 0, stdout: '', stderr: '' }, repository = false, during = () => {} } = {}) => {
  const calls = [];
  const run = async (file, args, options = {}) => {
    calls.push({ args, ...options });
    if (args[0] === 'rev-parse') return repository ? { code: 0, stdout: '.git\n', stderr: '' } : { code: 128, stdout: '', stderr: 'fatal: not a git repository' };
    if (args.includes('--name-only')) return { code: 0, stdout: '', stderr: '' };
    if (args.includes('--list')) return { code: 0, stdout: list, stderr: '' };
    if (args.includes('--get-urlmatch')) return { code: 1, stdout: '', stderr: '' };
    if (args.includes('--get-url')) return { code: 0, stdout: `${rewrite ?? args.at(-1)}\n`, stderr: '' };
    if (args.includes('--get-regexp')) return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'ls-remote') {
      await during(options);
      return listing;
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};
const listing = (g) => g.calls.find((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads'));

// Runs signInNow for `journalRun` in a scratch Wheelhouse home, with the real as-is environment and guard over the stand-in git.
async function attempt(journalRun, g, { answers, stopped, home, routeGiven = {}, ...more } = {}) {
  return as(shortHome(), async () => {
    const records = [];
    const pending = pendingSignIn(journalRun);
    const got = await signInNow({
      journalRun, answers: answers ?? (pending === null ? {} : chosen(pending)), stopped, run: g.run, home: home ?? path.join(process.env.WHEELHOUSE_HOME, 'home'), now: () => new Date(NOW), timeoutMs: 1234,
      route: { remoteRepo: null, gitlabHosts: [], reachEnv: asIsReachEnv, guard: guardAsIsReach, findGit: async () => ({ ok: true, path: 'git' }), record: (c) => records.push(c), ...routeGiven },
      ...more,
    });
    return { got, records, home: process.env.WHEELHOUSE_HOME };
  });
}

test('the wait, and the whole route, are shorter than the command timeout the playbook gives the form', () => {
  assert.equal(SIGN_IN_WAIT_MS, 7 * 60 * 1000);
  assert.equal(SIGN_IN_TOTAL_MS, 9 * 60 * 1000);
  assert.ok(SIGN_IN_WAIT_MS < SIGN_IN_TOTAL_MS && SIGN_IN_TOTAL_MS < 600000);
});

test('a record is pending until the attempt after it reaches the host, the run closes, step 3 is done, or its address is not plain https', () => {
  const pending = pendingSignIn(runOf(record()));
  assert.deepEqual({ ...pending }, { id: 'chg_1', address: ADDRESS, base: BASE, host: 'gitlab.com', why: 'sign-in', search: false, gcm: true, at: '2026-11-18T01:00:00.000Z' });
  assert.equal(pendingSignIn(runOf(record({ gcm: false }))).gcm, false);
  assert.equal(pendingSignIn(runOf()), null);
  assert.equal(pendingSignIn(null), null);
  // The latest record rules: a cleared one (the attempt that followed reached the host) ends it, and a newer one begins it again.
  const cleared = { id: 'chg_2', step: 3, kind: 'answer', target: SIGN_IN_TARGET, before: null, after: { signIn: null, reached: '2026-11-18T01:30:00.000Z' } };
  assert.equal(pendingSignIn(runOf(record(), cleared)), null);
  assert.equal(pendingSignIn(runOf(record(), cleared, record({ id: 'chg_3', at: '2026-11-18T01:40:00.000Z' })))?.id, 'chg_3');
  // Older than the step 3 success, or in a closed run, it is ignored.
  assert.equal(pendingSignIn({ ...runOf(record()), steps: { 3: { doneAt: '2026-11-18T01:00:00.000Z' } } }), null);
  assert.equal(pendingSignIn({ ...runOf(record()), steps: { 3: { doneAt: '2026-11-18T00:59:59.000Z' } } })?.id, 'chg_1');
  assert.equal(pendingSignIn({ ...runOf(record()), closedAt: '2026-11-18T03:00:00.000Z' }), null);
  for (const address of ['http://gitlab.com/o/s.git', 'ssh://git@gitlab.com/o/s.git', 'https://user:pw@gitlab.com/o/s.git', 'https://gitlab.com/o/s.git?x=1', 'not a url', 7]) {
    assert.equal(pendingSignIn(runOf(record({ address }))), null, String(address));
  }
  assert.equal(pendingSignIn(runOf(record({ base: 'http://gitlab.com' }))), null);
});

test('signInRecord keeps GitHub\'s own base for github.com, a company\'s base as given (port and path), and the address\'s origin otherwise', () => {
  assert.equal(signInRecord({ address: 'https://github.com/o/s.git', base: 'https://gitlab.com' }).base, 'https://github.com');
  assert.equal(signInRecord({ address: 'https://git.example.org:8443/g/s.git', base: 'https://git.example.org:8443/' }).base, 'https://git.example.org:8443');
  assert.equal(signInRecord({ address: 'https://git.example.org/code/g/s.git', base: 'https://git.example.org/code' }).base, 'https://git.example.org/code');
  assert.equal(signInRecord({ address: 'https://git.example.org:8443/g/s.git' }).base, 'https://git.example.org:8443');
  assert.equal(signInRecord({ address: ADDRESS, why: 'account', search: true }).why, 'account');
  assert.equal(signInRecord({ address: ADDRESS }).gcm, false);
  assert.equal(signInRecord({ address: ADDRESS, gcm: true }).gcm, true);
});

test('the card offers git\'s sign-in for the host and another way, composes as a question, recommends the sign-in only where git has a window, and is asked afresh for a new record', () => {
  const pending = pendingSignIn(runOf(record()));
  const { id, card } = signInAsk(pending);
  assert.match(id, /^git-sign-in-[0-9a-f]{10}$/);
  assert.deepEqual(card.options.map((o) => o.label), ["Open git's sign-in for gitlab.com", 'Use another way to connect']);
  assert.equal(card.options[0].label, signInOpenLabel('gitlab.com'));
  assert.equal(card.options[1].label, SIGN_IN_OTHER);
  assert.equal(card.recommend, card.options[0].label);
  assert.match(card.why, /may take a minute and may open behind other windows/);
  assert.match(card.options[0].says, /may take a minute, and may open behind other windows/);
  for (const part of ['what', 'why', 'because', 'meanwhile']) assert.ok(typeof card[part] === 'string' && card[part] !== '', part);
  const composed = composeCard({ ...card, kind: 'question', suggest: false }).question;
  assert.ok(composed.question.length > 0);
  // "Recommended" is said once on the option: by the card's own marking, not by its label.
  assert.equal(composed.options.filter((o) => /recommended/i.test(`${o.label} ${o.description}`)).length, 1);
  assert.ok(!/recommended/i.test(composed.options[0].label));
  assert.notEqual(signInAsk(pendingSignIn(runOf(record({ id: 'chg_9', at: '2026-11-18T02:00:00.000Z' })))).id, id);
  assert.match(card.options[0].says, /If it asks for a token, close it and choose another way to connect\.$/);
});

test('where git has no sign-in window of its own the card has the account card\'s shape: no Open, a click that carries step 3 on, and the other way recommended', () => {
  const pending = pendingSignIn(runOf(record({ gcm: false })));
  const { card } = signInAsk(pending);
  assert.deepEqual(card.options.map((o) => o.label), ['I have signed git in to gitlab.com', SIGN_IN_OTHER]);
  assert.equal(card.options[0].label, signInSignedLabel('gitlab.com'));
  assert.ok(!card.options.some((o) => o.label === signInOpenLabel('gitlab.com')), 'no Open');
  assert.equal(card.recommend, SIGN_IN_OTHER);
  assert.equal(card.options[0].says, 'Do this first: sign git in to gitlab.com, outside setup. Then click this, and setup carries on with step 3. If you\'re not sure how, choose another way to connect.');
  assert.ok(!/window/i.test(`${card.options[0].says} ${card.options[1].says}`));
  assert.equal(carryOnLabel(pending), signInSignedLabel('gitlab.com'));
  assert.equal(carryOnLabel(pendingSignIn(runOf(record({ why: 'account' })))), signInRetryLabel('gitlab.com'));
  assert.equal(carryOnLabel(pendingSignIn(runOf(record()))), null);
  composeCard({ ...card, kind: 'question', suggest: false });
});

test('where git is signed in as another account no window is offered: the card says to change git\'s sign-in outside setup, and recommends another way', () => {
  const pending = pendingSignIn(runOf(record({ why: 'account' })));
  const { card } = signInAsk(pending);
  assert.match(card.what, /signed in to gitlab\.com as a different account/);
  assert.deepEqual(card.options.map((o) => o.label), [signInRetryLabel('gitlab.com'), SIGN_IN_OTHER]);
  assert.ok(!card.options.some((o) => o.label === signInOpenLabel('gitlab.com')), 'no Open');
  assert.equal(card.recommend, SIGN_IN_OTHER);
  assert.equal(card.options[0].says, 'Do this first: sign git out of gitlab.com (in Keychain Access), or sign it in as the account that owns the project, outside setup. Then click this, and setup carries on with step 3.');
  assert.doesNotMatch(card.options[0].says, /Go ahead/);
  // Where to sign git out depends on the computer the card is shown on.
  assert.match(signInAsk(pending, { platform: 'win32' }).card.options[0].says, /^Do this first: sign git out of gitlab\.com \(in Windows' Credential Manager, under Windows Credentials\), or sign it in as the account/);
  const elsewhere = signInAsk(pending, { platform: 'linux' }).card.options[0].says;
  assert.equal(elsewhere, 'Do this first: sign git out of gitlab.com, or sign it in as the account that owns the project, outside setup. Then click this, and setup carries on with step 3.');
  assert.equal(signInAsk(pending, { platform: 'win32' }).id, signInAsk(pending, { platform: 'darwin' }).id);
  composeCard({ ...card, kind: 'question', suggest: false });
});

test('the address must be the run\'s step 3 connection: its host, base and project', () => {
  const problem = (pending, extra = {}) => connectionProblem({ pending: pendingSignIn(runOf(pending)), run: runOf(pending), ...extra });
  assert.equal(problem(record()), null);
  // The project of the folder's own remote, a project brought in, and a look among the director's own.
  assert.equal(connectionProblem({ pending: pendingSignIn(runOf(record({ address: 'https://gitlab.com/o/other.git' }))), run: { changes: [] }, remoteRepo: 'o/Other' }), null);
  const joined = { id: 'chg_j', step: 3, kind: 'folder', target: '/x/.git', before: null, after: { origin: 'x', joined: 'o/Brought' } };
  assert.equal(connectionProblem({ pending: pendingSignIn(runOf(record({ address: 'https://gitlab.com/o/brought.git' }))), run: runOf(joined) }), null);
  const searching = { id: 'chg_s', step: 3, kind: 'answer', target: 'step 3', before: null, after: { joined: 'cafe-menu' } };
  assert.equal(connectionProblem({ pending: pendingSignIn(runOf(record({ address: 'https://gitlab.com/ann/cafe-menu.git', search: true }))), run: runOf(searching) }), null);
  assert.match(connectionProblem({ pending: pendingSignIn(runOf(record({ address: 'https://gitlab.com/ann/cafe-menu.git' }))), run: runOf(searching) }), /none of this run's step 3 projects/);
  // Another project, another host, another base.
  assert.match(problem(record({ address: 'https://gitlab.com/owner/else.git' })), /none of this run's step 3 projects/);
  assert.match(problem(record({ address: 'https://evil.example/owner/shop.git', base: 'https://evil.example' })), /neither the public GitLab nor one the project's settings name/);
  assert.match(problem(record({ address: 'https://github.com/owner/shop.git' })), /not under https:\/\/gitlab\.com/);
  assert.match(problem(record({ address: 'https://evil.example/owner/shop.git', base: 'https://github.com' })), /not under https:\/\/github\.com/);
  // A company's GitLab the project's settings name, on a port and under a path.
  const company = record({ address: 'https://git.example.org:8443/code/owner/shop.git', base: 'https://git.example.org:8443/code' });
  assert.match(problem(company), /neither the public GitLab/);
  assert.equal(problem(company, { gitlabHosts: ['git.example.org:8443'] }), null);
  assert.equal(problem(record({ address: 'https://github.com/owner/shop.git', base: 'https://github.com' })), null);
});

test('it does nothing under All stop, without a record, without the director\'s click, or for an address that is not the connection\'s', async () => {
  const run = runOf(record());
  for (const [what, journalRun, options, line, kept] of [
    ['stop', run, { stopped: () => true }, STOPPED_LINE, 0],
    ['no record', runOf(), {}, NO_SIGN_IN_ADDRESS, 0],
    ['not chosen', run, { answers: {} }, NOT_CHOSEN, 0],
    ['the other way chosen', run, { answers: { [`3.${signInAsk(pendingSignIn(run)).id}`]: { label: SIGN_IN_OTHER } } }, NOT_CHOSEN, 0],
    // An address that is not the connection's clears the record, so its card no longer takes over step 3's plan.
    ['another project', runOf(record({ address: 'https://gitlab.com/owner/else.git' })), {}, NOT_THE_CONNECTION, 1],
  ]) {
    const g = fakeGit();
    const { got, records } = await attempt(journalRun, g, options);
    assert.deepEqual({ ok: got.ok, refused: got.refused }, { ok: false, refused: line }, what);
    assert.equal(g.calls.length, 0, what);
    assert.equal(records.length, kept, what);
    if (kept === 1) {
      assert.equal(records[0].after.signIn, null, what);
      assert.equal(pendingSignIn(runOf(record({ address: 'https://gitlab.com/owner/else.git' }), records[0])), null, what);
    }
  }
  assert.ok(!/director|plan 3/i.test(`${NOT_CHOSEN} ${STOPPED_LINE} ${NO_GIT}`), 'the director\'s lines carry no instruction for the agent');
  assert.equal(NO_SIGN_IN_ADDRESS, 'Setup has no address from step 3 to open git\'s sign-in for, so nothing was opened. A fresh Go ahead on step 3\'s card tries it again.');
});

test('it lists the address\'s branches with the director\'s own git from a folder of Wheelhouse\'s own, git\'s window allowed, nothing traced, and says one line', async () => {
  const g = fakeGit();
  const { got, records, home } = await attempt(runOf(record()), g);
  assert.deepEqual(got, { ok: true, line: 'Git reached gitlab.com and can see the project. Setup carries on with step 3.' });
  assert.equal(got.line, signedInLine('gitlab.com'));
  const listed = listing(g);
  assert.deepEqual(listed.args, ['ls-remote', '--heads', '--end-of-options', ADDRESS]);
  assert.equal(path.dirname(listed.cwd), path.join(home, 'home'), 'a folder under Wheelhouse\'s own');
  assert.ok(!fs.existsSync(listed.cwd), 'removed after');
  assert.equal(listed.env.GIT_TERMINAL_PROMPT, '0', 'git is still told not to prompt in a terminal');
  assert.equal(listed.env.GCM_INTERACTIVE, 'auto', 'its own window may open');
  assert.equal(listed.timeoutMs, 1234);
  assert.ok(listed.signal instanceof AbortSignal, 'All stop can end the wait');
  // Off Windows the call leads a process group of its own, ended with it; windowsHide is left at its default (it hides a console, not git's window).
  assert.equal(listed.windowsHide, undefined);
  assert.equal(listed.ownGroup, true);
  assert.equal(listed.env.GIT_ALLOW_PROTOCOL, 'https');
  assert.equal(listed.env.GIT_CONFIG_GLOBAL, undefined, 'the director\'s own settings are read');
  // Git runs where no repository's settings reach it: the folder's parent is git's ceiling, and a repository there refuses.
  assert.equal(listed.env.GIT_CEILING_DIRECTORIES, path.dirname(listed.cwd));
  // The look at the settings came first, in the same folder, and no trace variable reaches git.
  const guarded = g.calls.findIndex((c) => c.args.includes('--get-url'));
  assert.ok(guarded >= 0 && guarded < g.calls.indexOf(listed));
  assert.equal(g.calls[guarded].cwd, listed.cwd);
  assert.ok(g.calls.findIndex((c) => c.args.includes('--name-only')) < guarded, 'the settings that are not allowed are looked for first');
  // The record is cleared, so step 3's plan asks nothing more of it.
  // The click is marked used before git was asked, and the record is cleared after.
  assert.equal(records.length, 2);
  assert.equal(records[0].target, SIGN_IN_USED_TARGET);
  assert.equal(records[0].after.used, signInAsk(pendingSignIn(runOf(record()))).id);
  assert.equal(records[1].step, 3);
  assert.equal(records[1].target, SIGN_IN_TARGET);
  assert.equal(records[1].after.signIn, null);
  assert.equal(pendingSignIn(runOf(record(), records[1])), null);
});

test('no credential-helper trace variable reaches git, whether in its environment or the base it is merged over', async () => {
  const before = { GCM_TRACE: process.env.GCM_TRACE, GCM_DEBUG: process.env.GCM_DEBUG, GCM_TRACE_SECRETS: process.env.GCM_TRACE_SECRETS };
  Object.assign(process.env, { GCM_TRACE: '1', GCM_DEBUG: '1', GCM_TRACE_SECRETS: '1' });
  try {
    const g = fakeGit();
    await attempt(runOf(record()), g);
    const listed = listing(g);
    for (const name of Object.keys(process.env).filter((n) => /^GCM_(TRACE|DEBUG)/.test(n))) {
      assert.equal(listed.baseEnv[name], undefined, `base ${name}`);
      assert.equal(listed.env[name], undefined, `env ${name}`);
    }
  } finally {
    for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test('a company\'s GitLab base on another port and path is the one the environment is made for', async () => {
  const company = record({ address: 'https://git.example.org:8443/code/owner/shop.git', base: 'https://git.example.org:8443/code' });
  const seen = [];
  const g = fakeGit();
  const { got } = await attempt(runOf(company), g, { routeGiven: { gitlabHosts: ['git.example.org:8443'], reachEnv: (o) => { seen.push(o); return asIsReachEnv(o); } } });
  assert.equal(got.ok, true);
  assert.equal(seen[0].host, 'gitlab');
  assert.equal(seen[0].base, 'https://git.example.org:8443/code');
  assert.equal(listing(g).args.at(-1), 'https://git.example.org:8443/code/owner/shop.git');
  const hub = [];
  await attempt(runOf(record({ address: 'https://github.com/owner/shop.git', base: 'https://github.com' })), fakeGit(), { routeGiven: { reachEnv: (o) => { hub.push(o); return asIsReachEnv(o); } } });
  assert.equal(hub[0].host, 'github');
});

test('All stop coming on while git waits ends it, and it says so, in a line of its own, and keeps a fresh record', async () => {
  let on = false;
  const g = fakeGit({
    during: async (options) => {
      on = true;
      await new Promise((resolve) => { options.signal.addEventListener('abort', resolve, { once: true }); });
    },
  });
  const { got, records } = await attempt(runOf(record()), g, { stopped: () => on });
  // The window had opened, so it has a line of its own, and a fresh record so the card is asked afresh (the click is not reused).
  assert.deepEqual({ ok: got.ok, refused: got.refused }, { ok: false, refused: STOPPED_OPEN_LINE });
  assert.notEqual(STOPPED_OPEN_LINE, STOPPED_LINE);
  assert.ok(!/was not opened/.test(STOPPED_OPEN_LINE));
  assert.deepEqual(records.map((r) => r.target), [SIGN_IN_USED_TARGET, SIGN_IN_TARGET]);
  assert.equal(pendingSignIn(runOf(record(), ...records)).address, ADDRESS);
  assert.notEqual(signInAsk(pendingSignIn(runOf(record(), ...records.map((r, i) => ({ ...r, id: `chg_n${i}` }))))).id, signInAsk(pendingSignIn(runOf(record()))).id);
});

test('a failure line where git has no window never offers to open one, and says the card to choose', () => {
  const line = failedLine('gitlab.com', 'fatal: nope', { gcm: false });
  assert.equal(line, 'Git still could not reach gitlab.com (git said: fatal: nope). Next: sign git in to gitlab.com outside setup, then choose \'I have signed git in to gitlab.com\' on the card that follows, or choose another way to connect on step 3\'s card (recommended).');
  assert.ok(!/open|window/i.test(failedLine('gitlab.com', '', { gcm: false, timedOut: true })));
  assert.match(failedLine('gitlab.com', 'x', { gcm: true }), /I can open its sign-in again/);
});

test('git\'s failure is said with what git said (scrubbed, never its output), the next step, and a new record so the card is asked afresh', async () => {
  const g = fakeGit({ listing: { code: 128, stdout: 'abc\trefs/heads/main\n', stderr: 'fatal: Authentication failed for \'https://oauth2:glpat-abcdefgh1234@gitlab.com/owner/shop.git/\'\n' } });
  const { got, records } = await attempt(runOf(record()), g);
  assert.equal(got.ok, false);
  assert.equal(got.refused, failedLine('gitlab.com', 'fatal: Authentication failed for \'https://[hidden]@gitlab.com/owner/shop.git/\''));
  assert.match(got.refused, /^Git still could not reach gitlab\.com \(git said: fatal: Authentication failed for 'https:\/\/\[hidden\]@gitlab\.com\/owner\/shop\.git\/'\)\. Next: I can open its sign-in again; if its window asked for a token, or a password you don't use there, close it and choose another way to connect on step 3's card\.$/);
  assert.match(got.detail, /Run plan 3: the sign-in card is asked afresh, once\. If the same thing fails a second time, ask the card plan 3 gives once more and recommend its "Use another way to connect"/);
  assert.ok(!/glpat|abc\trefs|refs\/heads/.test(JSON.stringify(got)));
  assert.ok(!/make a token|create a token|personal access token/i.test(got.refused));
  assert.deepEqual(records.map((r) => r.target), [SIGN_IN_USED_TARGET, SIGN_IN_TARGET]);
  const again = pendingSignIn(runOf(record(), { ...records[1], id: 'chg_n' }));
  assert.equal(again.address, ADDRESS);
  assert.notEqual(signInAsk(again).id, signInAsk(pendingSignIn(runOf(record()))).id, 'a fresh click is needed to open it again');
});

test('a setting that is unsafe is refused before any contact, in the words of the sign-in, with the exact setting as detail for the agent', async () => {
  const g = fakeGit({ rewrite: 'ssh://git@gitlab.com/owner/shop.git' });
  const { got, records } = await attempt(runOf(record()), g);
  assert.equal(got.ok, false);
  assert.match(got.refused, /^A setting in git on this computer \(it points this project's address somewhere else, for example to SSH\) means Wheelhouse can't safely use your own git, so nothing was opened\. Ask me which setting it is: whoever looks after this computer can change it, then I can open its sign-in again\. Or choose another way to connect on step 3's card\.$/);
  assert.ok(!/fresh Go ahead/.test(got.refused));
  assert.match(got.detail, /^git's own answer for https:\/\/gitlab\.com\/owner\/shop\.git was ssh:\/\/\[hidden\]@gitlab\.com/);
  assert.ok(!g.calls.some((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads')), 'no contact with the host');
  assert.equal(records.length, 1);
  // Settings that cannot be read say so, in the same words.
  const unread = fakeGit({ list: '' });
  const bad = { ...unread, run: async (file, args, options) => (args.includes('--list') && !args.includes('--name-only') ? { code: 1, stdout: '', stderr: '' } : unread.run(file, args, options)) };
  const second = await attempt(runOf(record()), bad);
  assert.equal(second.got.refused, 'Git\'s settings on this computer could not be read, so nothing was opened; I can open its sign-in again, or choose another way to connect on step 3\'s card.');
});

test('a folder that is inside a repository is refused, and no git runs there', async () => {
  const g = fakeGit({ repository: true });
  const { got } = await attempt(runOf(record()), g);
  assert.equal(got.ok, false);
  assert.match(got.refused, /no project's settings reach it, so nothing was opened/);
  assert.match(got.detail, /git found a repository/);
  assert.ok(!g.calls.some((c) => c.args[0] === 'ls-remote'));
});

test('git missing is said plainly', async () => {
  const { got } = await attempt(runOf(record()), fakeGit(), { routeGiven: { findGit: async () => ({ ok: false }) } });
  assert.deepEqual({ ok: got.ok, refused: got.refused }, { ok: false, refused: NO_GIT });
  assert.equal(NO_GIT, 'Git is not on this computer yet, so nothing was opened; step 2 installs it, then a fresh Go ahead on step 3\'s card tries again.');
  // The record is cleared, so the old card does not take over step 3's plan, and the line is true.
  const kept = await attempt(runOf(record()), fakeGit(), { routeGiven: { findGit: async () => ({ ok: false }) } });
  assert.equal(kept.records.length, 1);
  assert.equal(kept.records[0].after.signIn, null);
});

// ---- Through the helper's routes ----

test('the route refuses under All stop and anything but the folder; with the card clicked it runs git and clears the record', async () => {
  await withProject(async ({ folder, user, plan, answer }) => {
    const run = startRun({ folder, now: () => T0 });
    addChanges(run.id, [made(), record({ at: T0.toISOString() })]);
    // Step 3's plan asks the card, ahead of anything else, and asks it again until it is answered.
    const asked = await plan(3);
    assert.equal(asked.ok, true);
    assert.equal(asked.ask.card.options.length, 2);
    assert.match(asked.ask.id, /^git-sign-in-/);
    assert.deepEqual((await plan(3)).ask.id, asked.ask.id);
    const g = fakeGit();
    const routesWith = (extra = {}) => setupRoutes({ now: () => T0, userHome: user, signInWith: { run: g.run, route: { findGit: async () => ({ ok: true, path: 'git' }) }, ...extra } })['/setup/sign-in'];
    // Not before the click.
    assert.equal((await routesWith()({ folder })).refused, NOT_CHOSEN);
    await answer(asked.ask.card, signInOpenLabel('gitlab.com'), { at: new Date(T0.getTime() + 30 * 1000) });
    assert.equal((await routesWith({ stopped: () => true })({ folder })).refused, STOPPED_LINE);
    const stopRefused = await setupRoutes({ now: () => T0, userHome: user, stopped: () => true })['/setup/sign-in']({ folder });
    assert.deepEqual(stopRefused, { ok: false, refused: 'All stop is on' });
    await assert.rejects(routesWith()({ folder, address: 'https://evil.example/x.git' }), /takes the folder, nothing else/);
    assert.equal(g.calls.filter((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads')).length, 0, 'nothing reached the host');
    // With the click, git is asked, and the record is cleared in the run.
    const done = await routesWith()({ folder });
    assert.deepEqual(done, { ok: true, line: signedInLine('gitlab.com') });
    // The same click opens it once: it is marked used, and the cleared record leaves nothing to open.
    assert.equal((await routesWith()({ folder })).refused, NO_SIGN_IN_ADDRESS);
    assert.equal(g.calls.filter((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads')).length, 1);
    const kept = readJournal().runs.find((r) => r.id === run.id).changes.filter((c) => c.target === SIGN_IN_TARGET);
    assert.equal(kept.at(-1).after.signIn, null);
    assert.equal(pendingSignIn(readJournal().runs.find((r) => r.id === run.id)), null);
  }, { connected: false });
});

test('the other way to connect is a click that takes git\'s own route out of the connection card, so step 3 goes on without asking the sign-in again', async () => {
  await withProject(async ({ folder, plan, answer }) => {
    const run = startRun({ folder, now: () => T0 });
    addChanges(run.id, [made(), record({ at: T0.toISOString() })]);
    const asked = await plan(3);
    await answer(asked.ask.card, SIGN_IN_OTHER);
    const next = await plan(3);
    assert.ok(next.ask === undefined || !/^git-sign-in-/.test(next.ask.id), 'the sign-in is not asked again');
  }, { connected: false });
});

test('once a sign-in works, plan 3 gives step 3 on: no sign-in card, and the plan covered by the one card\'s Go ahead when it holds, else step 3\'s own cards', async () => {
  for (const consent of [true, false]) {
    await withProject(async ({ folder, user, plan, answer }) => {
      const run = startRun({ folder, now: () => T0 });
      if (consent) await answer((await plan(0)).ask.card, 'Go ahead');
      for (const n of [1, 2]) markStep(run.id, n, 'doneAt', { now: () => T0 });
      addChanges(run.id, [made(), record({ at: T0.toISOString() })]);
      const asked = await plan(3);
      assert.match(asked.ask.id, /^git-sign-in-/, 'the sign-in card takes over step 3\'s plan, consent or not');
      await answer(asked.ask.card, signInOpenLabel('gitlab.com'), { at: new Date(T0.getTime() + 30 * 1000) });
      const g = fakeGit();
      const done = await setupRoutes({ now: () => T0, userHome: user, signInWith: { run: g.run, route: { findGit: async () => ({ ok: true, path: 'git' }) } } })['/setup/sign-in']({ folder });
      assert.deepEqual(done, { ok: true, line: signedInLine('gitlab.com') });
      const next = await plan(3);
      assert.ok(next.ask === undefined || !/^git-sign-in-/.test(next.ask.id), 'no sign-in card');
      if (consent) {
        assert.ok(Array.isArray(next.changes), 'step 3\'s own plan');
        assert.equal(next.covered, true, 'it runs on under the Go ahead already given, with no card');
      } else {
        assert.notEqual(next.covered, true, 'without that Go ahead, step 3 asks its own cards');
      }
    }, { connected: false });
  }
  assert.match(signedInLine('gitlab.com'), /Setup carries on with step 3\.$/);
});

test('a pending sign-in is outdated once step 3 connects another way, or to another host or base', () => {
  const pending = pendingSignIn(runOf(record()));
  assert.equal(signInOutdated(null, { asIs: true, url: ADDRESS, base: BASE }), false);
  assert.equal(signInOutdated(pending, { asIs: true, url: 'https://gitlab.com/o/n.git', base: BASE }), false, 'the same host and base');
  assert.equal(signInOutdated(pending, { asIs: true, url: 'https://gitlab.com/o/n.git', base: `${BASE}/` }), false);
  assert.equal(signInOutdated(pending, { asIs: false, url: ADDRESS, base: BASE }), true, 'another way to connect');
  assert.equal(signInOutdated(pending, { asIs: true, url: 'https://github.com/o/n.git', base: BASE }), true, 'another host');
  assert.equal(signInOutdated(pending, { asIs: true, url: 'https://git.example.org/o/n.git', base: 'https://git.example.org' }), true, 'another GitLab');
  const hub = pendingSignIn(runOf(record({ address: 'https://github.com/owner/shop.git', base: 'https://github.com' })));
  assert.equal(signInOutdated(hub, { asIs: true, url: 'https://github.com/o/n.git', base: BASE }), false, 'GitHub\'s own base is its own');
});

test('where git is signed in as another account nothing is opened: the line says what to do, and no git runs', async () => {
  const run = runOf(record({ why: 'account' }));
  const g = fakeGit();
  const { got, records } = await attempt(run, g, { answers: chosen(pendingSignIn(run)) });
  assert.deepEqual({ ok: got.ok, refused: got.refused }, { ok: false, refused: ACCOUNT_LINE('gitlab.com') });
  assert.match(got.refused, /signed in to gitlab\.com as a different account[^]*Sign git out of gitlab\.com, or in as the owning account, outside setup, then choose 'I have changed git's sign-in for gitlab\.com' on the card that follows; or choose another way to connect on step 3's card \(recommended\)/);
  assert.equal(g.calls.length, 0);
  assert.equal(records.length, 0);
});

test('where git has no sign-in window of its own the route refuses to open one, and no git runs', async () => {
  const run = runOf(record({ gcm: false }));
  const g = fakeGit();
  const { got, records } = await attempt(run, g, { answers: { [`3.${signInAsk(pendingSignIn(run)).id}`]: { label: signInOpenLabel('gitlab.com'), at: '2026-11-18T01:01:00.000Z' } } });
  assert.deepEqual({ ok: got.ok, refused: got.refused }, { ok: false, refused: NO_WINDOW_LINE('gitlab.com') });
  assert.match(got.refused, /^Git on this computer has no sign-in window of its own[^]*Sign git in to gitlab\.com outside setup, then choose 'I have signed git in to gitlab\.com' on the card that follows, or choose another way to connect on step 3's card \(recommended\)\.$/);
  assert.equal(g.calls.length, 0);
  assert.equal(records.length, 0);
});

test('step 3\'s plan goes on after a click on the no-window card, as it does for the account card, and asks a card again for a fresh record', async () => {
  for (const why of ['sign-in', 'account']) {
    await withProject(async ({ folder, answer, plan }) => {
      const run = startRun({ folder, now: () => T0 });
      addChanges(run.id, [made(), record({ at: T0.toISOString(), gcm: false, why })]);
      const asked = await plan(3);
      assert.match(asked.ask.card.options[0].label, /^I have (?:signed git in to|changed git's sign-in for) gitlab\.com$/);
      await answer(asked.ask.card, asked.ask.card.options[0].label, { at: new Date(T0.getTime() + 30 * 1000) });
      const next = await plan(3);
      assert.ok(!String(next.ask?.id ?? next.ask?.card?.id ?? '').startsWith('git-sign-in-'), `${why}: plan 3 carries on`);
    }, { connected: false });
  }
});

test('a click opens git\'s sign-in once: it must be fresh and newer than the record, is marked used before anything opens, and a mark that cannot be kept stops it', async () => {
  const run = runOf(record());
  const pending = pendingSignIn(run);
  // Too old, or not newer than the record: nothing opens, and a fresh record means the card is asked afresh.
  for (const [what, at] of [['old', '2026-11-18T00:50:00.000Z'], ['older than the record', '2026-11-18T00:59:00.000Z'], ['not a time', 'x']]) {
    const g = fakeGit();
    const { got, records } = await attempt(run, g, { answers: chosen(pending, at), now: undefined });
    assert.equal(got.refused, CLICK_STALE, what);
    assert.equal(g.calls.length, 0, what);
    assert.equal(records.length, 1, what);
    assert.equal(records[0].target, SIGN_IN_TARGET, what);
  }
  assert.ok(Date.parse(NOW) - Date.parse('2026-11-18T00:50:00.000Z') > CLICK_FRESH_MS);
  // A click a little after this computer's clock still counts; one far ahead does not.
  assert.equal((await attempt(run, fakeGit(), { answers: chosen(pending, '2026-11-18T01:05:30.000Z') })).got.ok, true);
  assert.equal((await attempt(run, fakeGit(), { answers: chosen(pending, '2026-11-18T01:30:00.000Z') })).got.refused, CLICK_STALE);
  // Used: a mark for this card refuses, and nothing opens.
  const marked = { id: 'chg_u', step: 3, kind: 'answer', target: SIGN_IN_USED_TARGET, before: null, after: { used: signInAsk(pending).id } };
  const used = fakeGit();
  const usedTry = await attempt(runOf(record(), marked), used);
  assert.equal(usedTry.got.refused, CLICK_USED);
  assert.equal(used.calls.length, 0);
  // A used marker with no newer record keeps a fresh record, so the next plan 3 asks a new card, and a click on that is accepted.
  assert.deepEqual(usedTry.records.map((r) => r.target), [SIGN_IN_TARGET]);
  const fresh = pendingSignIn(runOf(record(), marked, { ...usedTry.records[0], id: 'chg_f', after: { signIn: { ...usedTry.records[0].after.signIn, at: '2026-11-18T01:02:00.000Z' } } }));
  assert.notEqual(signInAsk(fresh).id, signInAsk(pending).id, 'a new card id');
  const reopened = await attempt(runOf(record(), marked, { id: 'chg_f', step: 3, kind: 'answer', target: SIGN_IN_TARGET, before: null, after: { signIn: { ...usedTry.records[0].after.signIn, at: '2026-11-18T01:02:00.000Z' } } }), fakeGit(), { answers: chosen(fresh, '2026-11-18T01:03:00.000Z') });
  assert.equal(reopened.got.ok, true, 'Open on the new card is accepted');
  // The mark is kept before git is asked; if it cannot be, git is not asked.
  const order = [];
  const g = fakeGit({ during: () => order.push('asked') });
  await attempt(run, g, { routeGiven: { record: (c) => order.push(c.target) } });
  assert.deepEqual(order, [SIGN_IN_USED_TARGET, 'asked', SIGN_IN_TARGET]);
  const refused = fakeGit();
  const { got } = await attempt(run, refused, { routeGiven: { record: () => { throw new Error('disk full'); } } });
  assert.equal(got.refused, NOT_RECORDED);
  assert.ok(!listing(refused), 'git was not asked');
});

test('the whole route is held to its total time: each call is cut to what is left, and a route out of time asks git nothing more', async () => {
  const seen = [];
  const g = fakeGit();
  const timed = async (file, args, options) => {
    seen.push(options.timeoutMs);
    return g.run(file, args, options);
  };
  const { got } = await attempt(runOf(record()), { ...g, run: timed }, { totalMs: 5000 });
  assert.equal(got.ok, true);
  assert.ok(seen.length > 3 && seen.every((ms) => Number.isFinite(ms) && ms <= 5000), `every call is cut to the total: ${seen}`);
  // With no time at all, nothing runs, and the refusal is the settings' own.
  const none = fakeGit();
  const spent = await attempt(runOf(record()), none, { totalMs: 0 });
  assert.equal(spent.got.ok, false);
  assert.equal(none.calls.length, 0);
});

test('the sign-in folder\'s ceiling is its parent in full even where Wheelhouse\'s home is given as a relative path', async () => {
  const g = fakeGit();
  const { home } = await attempt(runOf(record()), g, { home: path.relative(process.cwd(), path.join(shortHome(), 'rel-home')) });
  const listed = listing(g);
  assert.ok(path.isAbsolute(listed.env.GIT_CEILING_DIRECTORIES));
  assert.equal(listed.env.GIT_CEILING_DIRECTORIES, path.dirname(listed.cwd));
  assert.ok(path.isAbsolute(listed.cwd));
  assert.ok(home);
});

test('the settings look runs under the ceiling: a parent repository with a setting that is not allowed no longer refuses', async () => {
  const { refuseUnlistedSettings } = await import('../../../scripts/setup/git.js');
  const { run: realRun } = await import('../../../scripts/lib/run.js');
  const parent = fs.realpathSync.native(fs.mkdtempSync(path.join(shortHome(), 'parent-')));
  await realRun('git', ['init', '-q'], { cwd: parent });
  await realRun('git', ['config', '--local', 'core.sshCommand', 'evil'], { cwd: parent });
  const home = path.join(parent, 'wh');
  const neutral = path.join(home, 'sign-in-x');
  fs.mkdirSync(neutral, { recursive: true });
  await assert.rejects(refuseUnlistedSettings({ cwd: neutral }), /core\.sshcommand/, 'without the ceiling the parent\'s setting is found');
  await refuseUnlistedSettings({ cwd: neutral, env: { GIT_CEILING_DIRECTORIES: home } });
  fs.rmSync(parent, { recursive: true, force: true });
});

test('what git can print is scrubbed from the detail too: a setting\'s value, a refusal\'s own words', async () => {
  const g = fakeGit({ rewrite: 'ssh://git@gitlab.com/owner/shop.git' });
  const { got } = await attempt(runOf(record()), g);
  assert.equal(scrubGitText(got.detail), got.detail);
  const unread = fakeGit({ list: '' });
  const bad = { ...unread, run: async (file, args, options) => (args.includes('--name-only') ? { code: 0, stdout: 'remote.o.url\0http.extraheader\0', stderr: '' } : unread.run(file, args, options)) };
  const { got: second } = await attempt(runOf(record()), bad);
  assert.ok(!/secretvalue/.test(JSON.stringify(second)));
  assert.equal(scrubGitText(second.detail ?? ''), second.detail ?? '');
});

test('the sign-in window is read from git\'s credential helpers: Git Credential Manager is one, an empty value clears the ones before it, and anything unclear is none', async () => {
  const helpers = async (stdout, { code = 0 } = {}) => as(shortHome(), async () => gitHasSignInWindow({
    gitPath: 'git', home: path.join(process.env.WHEELHOUSE_HOME, 'h'),
    run: async (file, args) => (args[0] === 'rev-parse' ? { code: 128, stdout: '', stderr: '' } : args.includes('--name-only') ? { code: 0, stdout: '', stderr: '' } : { code, stdout, stderr: '' }),
  }));
  assert.equal(await helpers('manager\n'), true);
  assert.equal(await helpers('osxkeychain\nmanager-core\n'), true);
  assert.equal(await helpers('!"/usr/local/share/gcm-core/git-credential-manager" x\n'), false, 'a shell command is not the manager');
  assert.equal(await helpers('/usr/local/share/gcm-core/git-credential-manager\n'), true);
  assert.equal(await helpers('osxkeychain\n'), false);
  assert.equal(await helpers('manager\n\nosxkeychain\n'), false);
  assert.equal(await helpers('', { code: 1 }), false);
  // Where the folder sits in a repository, or the settings are not allowed, it reads as none.
  assert.equal(await as(shortHome(), async () => gitHasSignInWindow({ home: process.env.WHEELHOUSE_HOME, run: async () => ({ code: 0, stdout: '.git\n', stderr: '' }) })), false);
  assert.equal(await as(shortHome(), async () => gitHasSignInWindow({ home: process.env.WHEELHOUSE_HOME, run: async () => { throw new Error('no git'); } })), false);
});

test('a helper named for the address (credential.<url>.helper) counts too', async () => {
  const seen = [];
  const read = async (scoped, url = ADDRESS) => as(shortHome(), async () => gitHasSignInWindow({
    gitPath: 'git', home: path.join(process.env.WHEELHOUSE_HOME, 'h'), url,
    run: async (file, args) => {
      seen.push(args);
      if (args[0] === 'rev-parse') return { code: 128, stdout: '', stderr: '' };
      if (args.includes('--name-only')) return { code: 0, stdout: '', stderr: '' };
      if (args.includes('--get-urlmatch')) return { code: scoped === null ? 1 : 0, stdout: scoped ?? '', stderr: '' };
      return { code: 0, stdout: 'osxkeychain\n', stderr: '' };
    },
  }));
  assert.equal(await read('manager\n'), true);
  assert.equal(await read('!git-credential-manager\n'), false);
  assert.equal(await read('cache\n'), false);
  assert.equal(await read(null), false);
  assert.equal(await read('manager\n', null), false, 'no address, no scoped read');
  assert.ok(seen.some((a) => a.join(' ') === `config --get-urlmatch credential.helper ${ADDRESS}`));
});

test('the as-is environment drops every GCM variable but the kept ones and the code-loading variables, and keeps HOME, XDG_CONFIG_HOME, proxy and certificate variables', async () => {
  const planted = {
    GCM_CREDENTIAL_STORE: 'plaintext', GCM_TRACE: '1', gcm_authority: 'x', DOTNET_STARTUP_HOOKS: '/evil.dll', COREHOST_TRACE: '1', COREHOST_TRACEFILE: '/x', LD_PRELOAD: '/evil.so', DYLD_INSERT_LIBRARIES: '/evil',
    XDG_CONFIG_HOME: '/mine', HOME: '/mine', USERPROFILE: '/mine', HTTPS_PROXY: 'http://p', SSL_CERT_FILE: '/c', GCM_INTERACTIVE: 'never', KEEP: 'y',
  };
  assert.deepEqual(asIsGitEnv(planted, { keep: ['GCM_INTERACTIVE'] }), { XDG_CONFIG_HOME: '/mine', HOME: '/mine', USERPROFILE: '/mine', HTTPS_PROXY: 'http://p', SSL_CERT_FILE: '/c', GCM_INTERACTIVE: 'never', KEEP: 'y' });
  assert.deepEqual(asIsGitEnv(planted), { XDG_CONFIG_HOME: '/mine', HOME: '/mine', USERPROFILE: '/mine', HTTPS_PROXY: 'http://p', SSL_CERT_FILE: '/c', KEEP: 'y' });
  // Through the route: planted in the process environment, none reaches any as-is git call, in its environment or its base, and HOME stays.
  const before = { ...process.env };
  // GCM_INTERACTIVE is the one GCM variable setup itself sets: 'never' (the fence) on every call but the sign-in's own, which sets 'auto'.
  const bad = /^(?:GCM_(?!INTERACTIVE$)|DOTNET_STARTUP_HOOKS$|COREHOST_TRACE|LD_PRELOAD$|DYLD_)/i;
  Object.assign(process.env, { GCM_CREDENTIAL_STORE: 'plaintext', GCM_TRACE: '1', DOTNET_STARTUP_HOOKS: '/evil.dll', COREHOST_TRACE: '1', LD_PRELOAD: '/evil.so', DYLD_INSERT_LIBRARIES: '/evil', HOME: '/mine/home' });
  const merged = (call) => ({ ...(call.baseEnv ?? process.env), ...(call.env ?? {}) });
  try {
    const g = fakeGit();
    await attempt(runOf(record()), g);
    assert.ok(g.calls.length >= 4, 'the rev-parse, the settings looks, the guard and the call itself');
    for (const call of g.calls) {
      const env = merged(call);
      assert.ok(!Object.keys(env).some((k) => bad.test(k)), `${call.args.join(' ')}: ${Object.keys(env).filter((k) => bad.test(k))}`);
      if (!(call.args[0] === 'ls-remote' && call.args.includes('--heads'))) assert.notEqual(env.GCM_INTERACTIVE, 'auto', call.args.join(' '));
      assert.equal(env.HOME, '/mine/home', call.args.join(' '));
    }
    assert.equal(merged(listing(g)).GCM_INTERACTIVE, 'auto');
    // The look at the credential helpers too.
    const seen = [];
    await as(shortHome(), async () => gitHasSignInWindow({ gitPath: 'git', home: path.join(process.env.WHEELHOUSE_HOME, 'h'), run: async (file, args, options) => { seen.push(options); return args[0] === 'rev-parse' ? { code: 128, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' }; } }));
    assert.ok(seen.length >= 2);
    for (const call of seen) {
      const env = merged(call);
      assert.ok(!Object.keys(env).some((k) => bad.test(k)));
      assert.equal(env.HOME, '/mine/home');
    }
    // Step 3's own as-is reach calls (through setupGit with the as-is environment) have the same base.
    const reached = [];
    const git = setupGit({ run: async (file, args, options) => { reached.push({ args, ...options }); return { code: 0, stdout: '', stderr: '' }; }, cwd: tempFolder('wh-reach-'), reachEnv: asIsReachEnv({ host: 'gitlab', url: ADDRESS, gitPath: 'git', base: BASE }), reachGuard: async ({ env }) => env });
    await git(['ls-remote', '--heads', '--end-of-options', ADDRESS]);
    const call = reached.find((c) => c.args[0] === 'ls-remote');
    const env = merged(call);
    assert.ok(!Object.keys(env).some((k) => bad.test(k)), Object.keys(env).filter((k) => bad.test(k)).join());
    assert.equal(env.HOME, '/mine/home');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    Object.assign(process.env, before);
  }
});

// ---- A second record asked again ----

const TRY_SHAPES = [['gcm', { gcm: true }], ['no window', { gcm: false }], ['account', { why: 'account', gcm: true }]];
test('plan 3 gives each later sign-in record a card of its own words, the same record the same words, and no record makes plan 3 throw', async () => {
  for (const [shape, extra] of TRY_SHAPES) {
    await withProject(async ({ folder, plan }) => {
      const run = startRun({ folder, now: () => T0 });
      addChanges(run.id, [made()]);
      const asks = [];
      for (const n of [1, 2, 3]) {
        addChanges(run.id, [record({ ...extra, id: `chg_t${n}`, at: new Date(T0.getTime() + n * 60 * 1000).toISOString() })]);
        const asked = await plan(3);
        assert.equal(asked.ok, true, `${shape} try ${n}`);
        asks.push(asked.ask);
        // The same record asked again is the same card.
        const again = await plan(3);
        assert.equal(again.ask.id, asked.ask.id, `${shape} try ${n} again`);
        assert.deepEqual(again.ask.card, asked.ask.card);
      }
      assert.equal(new Set(asks.map((a) => a.id)).size, 3, `${shape}: a new id each time`);
      assert.equal(new Set(asks.map((a) => a.card.question)).size, 3, `${shape}: different words each time`);
      const words = asks.map((a) => a.card.question);
      assert.ok(!/Setup tried again/.test(words[0]), `${shape}: try 1 keeps today's words`);
      const host = 'gitlab.com';
      for (const [i, n] of [[1, 2], [2, 3]]) {
        assert.ok(words[i].includes(`Setup tried again (try ${n}), and `), words[i]);
        assert.ok(words[i].includes(extra.why === 'account' ? `still reaches ${host} as a different account` : `still isn't signed in to ${host}`), words[i]);
      }
    }, { connected: false });
  }
});

test('the card for a try is a function of the record and the try alone', () => {
  const pending = pendingSignIn(runOf(record()));
  assert.deepEqual(signInAsk(pending, { tries: 2 }), signInAsk(pending, { tries: 2 }));
  assert.deepEqual(signInAsk(pending), signInAsk(pending, { tries: 1 }));
  assert.equal(signInAsk(pending, { tries: 2 }).id, signInAsk(pending).id, 'the id is of the record');
  assert.match(signInAsk(pending, { tries: 2 }).card.what, /^Setup tried again \(try 2\), and git on this computer still isn't signed in to gitlab\.com, so setup could not reach the project there\.$/);
  const account = pendingSignIn(runOf(record({ why: 'account' })));
  assert.match(signInAsk(account, { tries: 3 }).card.what, /^Setup tried again \(try 3\), and git on this computer still reaches gitlab\.com as a different account from the one that owns the project, so setup could not reach it\.$/);
  assert.equal(triesOf(runOf(record(), record({ id: 'chg_2', at: '2026-11-18T02:00:00.000Z' }))), 2);
  assert.equal(triesOf(runOf()), 1);
  assert.match(signInAsk(pendingSignIn(runOf(record({ gcm: false })))).card.options[0].says, /If you're not sure how, choose another way to connect\.$/);
});

test('a used click, and a stale one, each give a fresh record, and plan 3 asks a fresh card for it (in words of its own)', async () => {
  for (const kind of ['used', 'stale']) {
    await withProject(async ({ folder, user, plan, answer }) => {
      const run = startRun({ folder, now: () => T0 });
      addChanges(run.id, [made(), record({ at: T0.toISOString() })]);
      const first = await plan(3);
      const at = kind === 'used' ? new Date(T0.getTime() + 30 * 1000) : new Date(T0.getTime() - 5 * 60 * 1000);
      await answer(first.ask.card, signInOpenLabel('gitlab.com'), { at });
      if (kind === 'used') addChanges(run.id, [{ id: 'chg_used', step: 3, kind: 'answer', target: SIGN_IN_USED_TARGET, before: null, after: { used: first.ask.id } }]);
      const g = fakeGit();
      const routes = setupRoutes({ now: () => T0, userHome: user, signInWith: { run: g.run, route: { findGit: async () => ({ ok: true, path: 'git' }) } } });
      const got = await routes['/setup/sign-in']({ folder });
      assert.equal(got.refused, kind === 'used' ? CLICK_USED : CLICK_STALE);
      assert.equal(g.calls.filter((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads')).length, 0);
      const next = await plan(3);
      assert.equal(next.ok, true, kind);
      assert.match(next.ask.id, /^git-sign-in-/);
      assert.notEqual(next.ask.id, first.ask.id, 'a fresh card');
      assert.ok(next.ask.card.question.includes('Setup tried again (try 2), and '), next.ask.card.question);
    }, { connected: false });
  }
});

test('a guard failure with no line of its own is refused in the settings line, and the scrubbed message is the detail', async () => {
  const g = fakeGit();
  const { got } = await attempt(runOf(record()), g, { routeGiven: { guard: async () => { throw new Error('boom https://u:pw@gitlab.com/x'); } } });
  assert.equal(got.refused, 'Setup could not check git\'s settings before opening its sign-in, so nothing was opened; I can open its sign-in again, or choose another way to connect on step 3\'s card.');
  assert.equal(got.detail, 'boom https://[hidden]@gitlab.com/x');
});

test('the route\'s total time starts before git is looked for', async () => {
  let slept = 0;
  const g = fakeGit();
  const { got } = await attempt(runOf(record()), g, {
    totalMs: 50, routeGiven: { findGit: async () => { await new Promise((r) => { setTimeout(r, 80); }); slept += 1; return { ok: true, path: 'git' }; } },
  });
  assert.equal(slept, 1);
  assert.equal(got.ok, false);
  assert.ok(!g.calls.some((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads') && c.timeoutMs > 0), 'no wait is left to give git');
});

test('two sign-ins for one run do not open at once, and a waiting one counts the helper as busy', async () => {
  await withProject(async ({ folder, user, answer, plan }) => {
    const run = startRun({ folder, now: () => T0 });
    addChanges(run.id, [made(), record({ at: T0.toISOString() })]);
    const asked = await plan(3);
    await answer(asked.ask.card, signInOpenLabel('gitlab.com'), { at: new Date(T0.getTime() + 30 * 1000) });
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    let started;
    const startedWaiting = new Promise((resolve) => { started = resolve; });
    const g = fakeGit({ during: async () => { started(); await waiting; } });
    const routes = setupRoutes({ now: () => T0, userHome: user, signInWith: { run: g.run, route: { findGit: async () => ({ ok: true, path: 'git' }) } } });
    assert.equal(routes.busy(), false);
    const first = routes['/setup/sign-in']({ folder });
    await startedWaiting;
    assert.equal(routes.busy(), true, 'a waiting sign-in is the helper\'s work');
    const second = await routes['/setup/sign-in']({ folder });
    assert.equal(second.ok, false);
    assert.match(second.refused, /already open for this setup/);
  assert.equal(second.detail, 'Wait for the open sign-in\'s line; do not run plan 3 or this form again until it comes, or, if no line comes within 10 minutes, run plan 3.');
    assert.equal(g.calls.filter((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads')).length, 1);
    release();
    assert.equal((await first).ok, true);
    assert.equal(routes.busy(), false);
  }, { connected: false });
});

// ---- The form ----

test('the form: `sign-in` asks the helper for the folder alone, prints its one line, and a refusal is its line, then the agent-only detail', async () => {
  let out = '';
  let err = '';
  const given = [];
  const answers = [{ ok: true, line: 'Git reached x and can see the project.' }];
  const client = { setup: { signIn: async (body) => { given.push(body); return answers.shift(); } } };
  const base = { cwd: FOLDER, client, out: (t) => { out += t; }, err: (t) => { err += t; }, entrypoint: 'cli', env: {} };
  assert.equal(await main(['sign-in'], base), 0);
  assert.equal(out, 'Git reached x and can see the project.\n');
  assert.deepEqual(given, [{ folder: FOLDER }]);
  answers.push({ ok: false, refused: 'A setting in git on this computer (why) means no.\nsecond', detail: 'http.sslverify = false; set in global file:/x\nmore' });
  assert.equal(await main(['sign-in'], base), 1);
  assert.equal(err, 'A setting in git on this computer (why) means no. second\nDetail: http.sslverify = false; set in global file:/x more\n');
  err = '';
  answers.push({ ok: false, refused: 'All stop is on' });
  assert.equal(await main(['sign-in'], base), 1);
  assert.equal(err, 'All stop is on\n');
  // The form takes nothing after it: an address is never given by the session.
  err = '';
  assert.equal(await main(['sign-in', 'https://evil.example/x.git'], base), 1);
  assert.match(err, /^Commands: /);
  assert.equal(given.length, 3);
});
