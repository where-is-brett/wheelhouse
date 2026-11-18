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
  signInNow, pendingSignIn, signInAsk, signInRecord, signInOpenLabel, connectionProblem, SIGN_IN_TARGET, SIGN_IN_OTHER, SIGN_IN_WAIT_MS,
  NO_SIGN_IN_ADDRESS, NOT_CHOSEN, NOT_THE_CONNECTION, STOPPED_LINE, signedInLine, failedLine,
} from '../../../scripts/setup/sign-in.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { asIsReachEnv, guardAsIsReach } from '../../../scripts/setup/host.js';
import { startRun, addChanges, readJournal } from '../../../scripts/setup/journal.js';
import { setupRoutes } from '../../../scripts/setup/engine.js';
import { main } from '../../../scripts/setup/cli.js';
import { as, shortHome } from '../../helpers/homes.js';
import { withProject, T0 } from '../../helpers/setup-answers.js';

const ADDRESS = 'https://gitlab.com/owner/shop.git';
const BASE = 'https://gitlab.com';
const FOLDER = '/x/Projects/shop';

// A run as the journal holds it, with a record of the kind a failed attempt keeps (and, by default, a repository setup made).
const record = ({ address = ADDRESS, base = BASE, why, search, at = '2026-11-18T01:00:00.000Z', id = 'chg_1' } = {}) => ({
  id, step: 3, kind: 'answer', target: SIGN_IN_TARGET, before: null, after: { signIn: { address, base, why: why ?? 'sign-in', ...(search ? { search: true } : {}), at } },
});
const made = (repo = 'owner/shop') => ({ id: 'chg_h', step: 3, kind: 'host', target: `gitlab:${repo}`, before: null, after: { repository: repo, private: true, made: true } });
const runOf = (...changes) => ({ id: 'run_1', folder: FOLDER, startedAt: '2026-11-18T00:00:00.000Z', steps: {}, changes: [made(), ...changes] });
const chosen = (pending) => ({ [`3.${signInAsk(pending).id}`]: { label: signInOpenLabel(pending.host), at: '2026-11-18T01:01:00.000Z' } });

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
      journalRun, answers: answers ?? (pending === null ? {} : chosen(pending)), stopped, run: g.run, home: home ?? path.join(process.env.WHEELHOUSE_HOME, 'home'), now: () => new Date('2026-11-18T02:00:00.000Z'), timeoutMs: 1234,
      route: { remoteRepo: null, gitlabHosts: [], reachEnv: asIsReachEnv, guard: guardAsIsReach, findGit: async () => ({ ok: true, path: 'git' }), record: (c) => records.push(c), ...routeGiven },
      ...more,
    });
    return { got, records, home: process.env.WHEELHOUSE_HOME };
  });
}

test('the wait is shorter than the command timeout the playbook gives the form', () => {
  assert.equal(SIGN_IN_WAIT_MS, 8 * 60 * 1000);
  assert.ok(SIGN_IN_WAIT_MS < 600000);
});

test('a record is pending until the attempt after it reaches the host, the run closes, step 3 is done, or its address is not plain https', () => {
  const pending = pendingSignIn(runOf(record()));
  assert.deepEqual({ ...pending }, { id: 'chg_1', address: ADDRESS, base: BASE, host: 'gitlab.com', why: 'sign-in', search: false, at: '2026-11-18T01:00:00.000Z' });
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
});

test('the card offers git\'s sign-in for the host, recommended, and the other way, composes as a question, and is asked afresh for a new record', () => {
  const pending = pendingSignIn(runOf(record()));
  const { id, card } = signInAsk(pending);
  assert.match(id, /^git-sign-in-[0-9a-f]{10}$/);
  assert.deepEqual(card.options.map((o) => o.label), ["Open git's sign-in for gitlab.com (recommended)", 'Use the other way to connect']);
  assert.equal(card.options[0].label, signInOpenLabel('gitlab.com'));
  assert.equal(card.options[1].label, SIGN_IN_OTHER);
  assert.equal(card.recommend, card.options[0].label);
  for (const part of ['what', 'why', 'because', 'meanwhile']) assert.ok(typeof card[part] === 'string' && card[part] !== '', part);
  const composed = composeCard({ ...card, kind: 'question', suggest: false }).question;
  assert.ok(composed.question.length > 0);
  assert.notEqual(signInAsk(pendingSignIn(runOf(record({ id: 'chg_9', at: '2026-11-18T02:00:00.000Z' })))).id, id);
  // Where the account is the trouble, it says so.
  const account = signInAsk(pendingSignIn(runOf(record({ why: 'account' })))).card;
  assert.match(account.what, /signed in to gitlab\.com as a different account/);
  assert.match(account.options[0].says, /account that owns the project/);
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
  for (const [what, journalRun, options, line] of [
    ['stop', run, { stopped: () => true }, STOPPED_LINE],
    ['no record', runOf(), {}, NO_SIGN_IN_ADDRESS],
    ['not chosen', run, { answers: {} }, NOT_CHOSEN],
    ['the other way chosen', run, { answers: { [`3.${signInAsk(pendingSignIn(run)).id}`]: { label: SIGN_IN_OTHER } } }, NOT_CHOSEN],
    ['another project', runOf(record({ address: 'https://gitlab.com/owner/else.git' })), {}, NOT_THE_CONNECTION],
  ]) {
    const g = fakeGit();
    const { got, records } = await attempt(journalRun, g, options);
    assert.deepEqual({ ok: got.ok, refused: got.refused }, { ok: false, refused: line }, what);
    assert.equal(g.calls.length, 0, what);
    assert.equal(records.length, 0, what);
  }
  assert.equal(NO_SIGN_IN_ADDRESS, 'Setup has no address from step 3 to open git\'s sign-in for, so nothing was opened. A fresh Go ahead on step 3\'s card tries it again.');
});

test('it lists the address\'s branches with the director\'s own git from a folder of Wheelhouse\'s own, git\'s window allowed, nothing traced, and says one line', async () => {
  const g = fakeGit();
  const { got, records, home } = await attempt(runOf(record()), g);
  assert.deepEqual(got, { ok: true, line: 'Git reached gitlab.com and can see the project.' });
  assert.equal(got.line, signedInLine('gitlab.com'));
  const listed = listing(g);
  assert.deepEqual(listed.args, ['ls-remote', '--heads', '--end-of-options', ADDRESS]);
  assert.equal(path.dirname(listed.cwd), path.join(home, 'home'), 'a folder under Wheelhouse\'s own');
  assert.ok(!fs.existsSync(listed.cwd), 'removed after');
  assert.equal(listed.env.GIT_TERMINAL_PROMPT, '0', 'git is still told not to prompt in a terminal');
  assert.equal(listed.env.GCM_INTERACTIVE, 'auto', 'its own window may open');
  assert.equal(listed.timeoutMs, 1234);
  assert.ok(listed.signal instanceof AbortSignal, 'All stop can end the wait');
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
  assert.equal(records.length, 1);
  assert.equal(records[0].step, 3);
  assert.equal(records[0].target, SIGN_IN_TARGET);
  assert.equal(records[0].after.signIn, null);
  assert.equal(pendingSignIn(runOf(record(), records[0])), null);
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

test('All stop coming on while git waits ends it, and it says so and keeps no record', async () => {
  let on = false;
  const g = fakeGit({
    during: async (options) => {
      on = true;
      await new Promise((resolve) => { options.signal.addEventListener('abort', resolve, { once: true }); });
    },
  });
  const { got, records } = await attempt(runOf(record()), g, { stopped: () => on });
  assert.deepEqual({ ok: got.ok, refused: got.refused }, { ok: false, refused: STOPPED_LINE });
  assert.equal(records.length, 0);
});

test('git\'s failure is said with what git said (scrubbed, never its output), the next step, and a new record so the card is asked afresh', async () => {
  const g = fakeGit({ listing: { code: 128, stdout: 'abc\trefs/heads/main\n', stderr: 'fatal: Authentication failed for \'https://oauth2:glpat-abcdefgh1234@gitlab.com/owner/shop.git/\'\n' } });
  const { got, records } = await attempt(runOf(record()), g);
  assert.equal(got.ok, false);
  assert.equal(got.refused, failedLine('gitlab.com', 'fatal: Authentication failed for \'https://[hidden]@gitlab.com/owner/shop.git/\''));
  assert.match(got.refused, /^Git still could not reach gitlab\.com \(git said: fatal: Authentication failed for 'https:\/\/\[hidden\]@gitlab\.com\/owner\/shop\.git\/'\)\. Next: I can open its sign-in again; if its window asked for a token, or a password you don't use there, close it and choose the other way to connect on step 3's card\.$/);
  assert.ok(!/glpat|abc\trefs|refs\/heads/.test(JSON.stringify(got)));
  assert.ok(!/make a token|create a token|personal access token/i.test(got.refused));
  assert.equal(records.length, 1);
  const again = pendingSignIn(runOf(record(), { ...records[0], id: 'chg_n' }));
  assert.equal(again.address, ADDRESS);
  assert.notEqual(signInAsk(again).id, signInAsk(pendingSignIn(runOf(record()))).id, 'a fresh click is needed to open it again');
});

test('a setting that is unsafe is refused before any contact, in the words of the sign-in, with the exact setting as detail for the agent', async () => {
  const g = fakeGit({ rewrite: 'ssh://git@gitlab.com/owner/shop.git' });
  const { got, records } = await attempt(runOf(record()), g);
  assert.equal(got.ok, false);
  assert.match(got.refused, /^A setting in git on this computer \(it points this project's address somewhere else, for example to SSH\) means Wheelhouse can't safely use your own git, so nothing was opened\. Ask me which setting it is: whoever looks after this computer can change it, then I can open its sign-in again\. Or choose the other way to connect on step 3's card\.$/);
  assert.ok(!/fresh Go ahead/.test(got.refused));
  assert.match(got.detail, /^git's own answer for https:\/\/gitlab\.com\/owner\/shop\.git was ssh:\/\/\[hidden\]@gitlab\.com/);
  assert.ok(!g.calls.some((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads')), 'no contact with the host');
  assert.equal(records.length, 1);
  // Settings that cannot be read say so, in the same words.
  const unread = fakeGit({ list: '' });
  const bad = { ...unread, run: async (file, args, options) => (args.includes('--list') && !args.includes('--name-only') ? { code: 1, stdout: '', stderr: '' } : unread.run(file, args, options)) };
  const second = await attempt(runOf(record()), bad);
  assert.equal(second.got.refused, 'Git\'s settings on this computer could not be read, so nothing was opened; I can open its sign-in again, or choose the other way to connect on step 3\'s card.');
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
  assert.deepEqual({ ok: got.ok, refused: got.refused }, { ok: false, refused: 'git is not on this computer yet; step 2 installs it' });
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
    await answer(asked.ask.card, signInOpenLabel('gitlab.com'));
    assert.equal((await routesWith({ stopped: () => true })({ folder })).refused, STOPPED_LINE);
    const stopRefused = await setupRoutes({ now: () => T0, userHome: user, stopped: () => true })['/setup/sign-in']({ folder });
    assert.deepEqual(stopRefused, { ok: false, refused: 'All stop is on' });
    await assert.rejects(routesWith()({ folder, address: 'https://evil.example/x.git' }), /takes the folder, nothing else/);
    assert.equal(g.calls.filter((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads')).length, 0, 'nothing reached the host');
    // With the click, git is asked, and the record is cleared in the run.
    const done = await routesWith()({ folder });
    assert.deepEqual(done, { ok: true, line: signedInLine('gitlab.com') });
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
