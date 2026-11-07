// tests/e2e/front-desk.test.js
// The front desk end to end (front desk plan, Task 14). One computer: its own WHEELHOUSE_HOME with
// a real helper on a socket (a named pipe on Windows), a bare repository standing in for the host
// behind a stand-in for gh and glab, the project's main checkout cloned from it, and the director's
// profile on a bare repository of its own. The hooks' `decide` functions are called with what
// Claude Code sends: the board-context hook on each prompt of the director's, the card check before
// each AskUserQuestion call, and the prompt record after the director's click.
//
// The front desk's command (scripts/frontdesk/cli.js) runs as a sandboxed command does: every file
// call it makes into the Wheelhouse home fails the test, so it reaches state and the profile only
// through the helper. Its cards go to AskUserQuestion as the command gives them.
//
// The build loop's side starts from its records, as the foreman writes them through the helper: the
// work, its running features and a feature's question (tests/e2e/build-loop.test.js makes them from
// a feature session), and the gate's asks (act merge). The watcher runs as runWatcher runs it, its
// waker printing its wakes and starting nothing. Pictures of a preview are taken by a
// stand-in for scripts/pictures/shoot.js, in a browser whose path is Chrome's (ruling F61).
import { test, before, beforeEach, afterEach, after } from 'node:test';
import { run as realRun } from '../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { main as cli } from '../../scripts/frontdesk/cli.js';
import { decide as boardContext, cardsLine, HEADINGS } from '../../scripts/hooks/board-context.js';
import { decide as cardCheck } from '../../scripts/hooks/card-check.js';
import { decide as promptRecord } from '../../scripts/hooks/prompt-record.js';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { BUNDLE_MS } from '../../scripts/lib/build-loop.js';
import { profileDir, stateDir, wheelhouseHome } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { answerLine, approvalLine, confirmLine, setLineOf } from '../../scripts/state/card-lines.js';
import { listEvents, makeEvent, confirmationFor } from '../../scripts/state/events.js';
import { enrol, makeSigningKey } from '../../scripts/state/signing.js';
import { readHandled } from '../../scripts/watcher/handled.js';
import { projectConfig, runWatcher } from '../../scripts/watcher/main.js';
import { writeBaseline } from '../../scripts/watcher/control-files.js';
import { makeWaker } from '../../scripts/watcher/waker.js';
import { makeBareRemote, g } from '../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../helpers/homes.js';
import { standInTools, guardedRun } from '../helpers/host-stand-ins.js';
import { writeFiles } from '../helpers/lineage.js';
import { matchingBody } from '../helpers/provenance.js';
import { sandboxed as wallSandboxed } from '../helpers/sandbox-wall.js';
import { waitLongerOnTheHelper, until as waitUntil, WAIT_MS } from '../helpers/until.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

// These tests run the real helper and check what reaches it, however loaded the computer is.
waitLongerOnTheHelper();

const P = 'o__p';
const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// A pull request body stamped with what matches the installed manifest, so the gate's provenance condition passes.
const BODY = matchingBody();
// The pages whose pictures let an approval carry over an update, and a browser named as Chrome is.
const PAGES = ['/', '/pricing'];
const CHROME = '/fake/Google Chrome';
// The project's configuration on its default branch: the watcher's shape, and the pages.
const CONFIG = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], watcherShape: 1, pages: PAGES };
// A folder that is never created, so no managed copy of the hooks is found.
const NO_MANAGED = path.join(tempFolder('wh-no-managed-'), 'absent');
// The hook's own limit is 2 seconds; a test machine running every file at once is given longer.
const HOOK_WAIT_MS = WAIT_MS;
const short = (sha) => sha.slice(0, 7);

// --- The sandbox ---

// The front desk's command runs inside the sandbox stand-in (tests/helpers/sandbox-wall.js),
// which shuts the Wheelhouse home to it.
const sandboxed = (world, fn) => wallSandboxed(world.walls, fn);

// --- The host ---

// gh and glab stood in for over the bare repository, as GitHub keeps it: a pull request's head is
// its branch's head (kept at refs/pull/<n>/head, where the helper fetches it), CI is green on every
// commit, a merge moves the default branch to the head the gate merged, and each commit has its own
// preview deployment.
function standInHost(remoteUrl) {
  const prs = new Map();
  const merges = [];
  return {
    merges,
    open: (number, branch) => { prs.set(number, { branch, state: 'open', merged: null }); },
    defaultBranch: async () => 'main',
    prState: async (number) => {
      const pr = prs.get(number);
      if (!pr) throw new Error(`the host has no pull request ${number}`);
      const headSha = pr.state === 'merged' ? pr.merged : await g(remoteUrl, 'rev-parse', `refs/heads/${pr.branch}`);
      if (pr.state === 'open') await g(remoteUrl, 'update-ref', `refs/pull/${number}/head`, headSha);
      return { number, headSha, headRef: pr.branch, baseRef: 'main', mergeable: 'yes', state: pr.state, body: BODY };
    },
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async ({ number, sha }) => {
      merges.push({ number, sha });
      await g(remoteUrl, 'update-ref', 'refs/heads/main', sha);
      Object.assign(prs.get(number), { state: 'merged', merged: sha });
      return { merged: true };
    },
    previewUrl: async (sha) => `https://preview-${sha.slice(0, 12)}.example.app/`,
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

// A stand-in for shoot.js: a picture's hash comes from its page, its size and whether its commit
// looks changed (`world.changed` holds such commits by their first 12 characters). No browser runs;
// every picture asked for is listed.
function standInShoot(world) {
  return async ({ browser, url, size }) => {
    const address = new URL(url);
    const commit = /^preview-([0-9a-f]{12})\./.exec(address.hostname)?.[1] ?? '';
    world.shots.push({ browser, url, commit });
    const look = world.changed.has(commit) ? 'changed' : 'same';
    return { ok: true, hash: crypto.createHash('sha256').update(`${address.pathname} ${size.width}x${size.height} ${look}`).digest('hex') };
  };
}

// --- The computer ---

// The host's default branch with the product and its configuration, the main checkout cloned from
// it, the profile's own repository, a home with this computer's signing key enrolled, the project's
// record, a helper, the state cloned and the lock taken. `work` is a clone of the host for making
// branches and moving main, as builders and other merges do.
async function makeWorld() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const profileRemote = await makeBareRemote({ repo: 'o/profile' });
  const work = tempFolder('wh-work-');
  await g(work, 'init', '-q', '-b', 'main');
  writeFiles(work, {
    'README.md': 'The bakery\'s shop.\n',
    'src/home.js': 'export const banner = \'Fresh bread daily\';\n',
    '.claude/wheelhouse.json': `${JSON.stringify(CONFIG)}\n`,
  });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'The shop');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await g(work, 'push', '-q', 'origin', 'main');
  const checkout = fs.realpathSync.native(tempFolder('wh-main-'));
  await g(path.dirname(checkout), 'clone', '-q', remote.url, checkout);

  const home = shortHome();
  const host = standInHost(remote.url);
  // The computer's clock: the test moves it on, and each reading is a millisecond after the last,
  // as a real clock is between two writes, so no two records share a time.
  let ms = 0;
  const now = () => new Date(T0 + (ms += 1));
  const world = {
    remote, profileRemote, work, checkout, home, host, now, lines: [], shots: [], changed: new Set(),
    walls: [...new Set([path.resolve(home), fs.realpathSync.native(home)])],
    at: (to) => { ms = Math.max(ms, to); },
  };
  await as(home, async () => {
    writeProject(P, {
      folder: checkout, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
    fs.writeFileSync(path.join(wheelhouseHome(), 'profile.json'), JSON.stringify({
      remoteUrl: profileRemote.url, host: 'github', repo: 'o/profile', connection: { host: 'github', mode: 'quick', project: 'o/profile' },
    }));
    const helper = await startHelper({
      run: hostGuard,
      address: testAddress(home), adapterFor: async () => host, envFor: async () => ({}), now,
      screens: { shoot: standInShoot(world), browser: CHROME },
    });
    world.close = async () => {
      await helper.close();
      remote.cleanup();
      profileRemote.cleanup();
    };
    world.client = helperClient({ address: helper.address });
    assert.deepEqual(await world.client.state.clone({ project: P }), { ok: true });
    assert.equal((await world.client.lock.take({ project: P })).result.taken, true);
    world.config = (await projectConfig(P, world.client)).config;
    assert.deepEqual(world.config?.pages, PAGES, 'the configuration is read from the default branch');
    world.waker = makeWaker({ shape: 2, project: P, config: world.config, print: (line) => world.lines.push(line), now });
  });
  return world;
}

// Runs a test's body with the computer's home, and closes it afterwards.
async function onComputer(fn) {
  const world = await makeWorld();
  try {
    await as(world.home, () => fn(world));
  } finally {
    await world.close();
  }
}

const eventsOf = (kind, dir = stateDir(P)) => listEvents(dir, { report: () => {} }).filter((e) => e.kind === kind);
const viewsOf = async (world) => (await world.client.state.views({ project: P })).views;

// --- The front desk and the director ---

// The front desk's command, run in the sandbox from the main checkout: `node cli.js <argv>`, with
// `input` as JSON on standard input. Resolves with what it printed, parsed when it is JSON.
async function frontDesk(world, argv, input) {
  const said = { out: '', err: '' };
  const code = await sandboxed(world, () => cli(argv, {
    cwd: world.checkout,
    client: world.client,
    now: world.now,
    ...(input === undefined ? {} : { input: JSON.stringify(input) }),
    out: (t) => { said.out += t; },
    err: (t) => { said.err += t; },
  }));
  assert.equal(code, 0, said.err);
  try {
    return JSON.parse(said.out);
  } catch {
    return said.out;
  }
}

// The programs no test may reach for real, stand-ins first on the PATH while this file runs
// (tests/helpers/host-stand-ins.js): the helper's own host facts read protection with `gh api` by
// name when the cache doesn't cover the board's time, and a child the test starts inherits the
// PATH. Each test ends with none of them run.
let tools;
before(() => { tools = standInTools(); });
beforeEach(() => tools.reset());
afterEach(() => assert.deepEqual(tools.calls(), [], 'no host tool ran'));
after(() => tools.restore());

// The host facts as a day-old-at-most cache, so reading the board never asks the stand-in host.
function freshFacts(at) {
  const file = path.join(stateDir(P), '..', 'host-facts.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ at: new Date(at.getTime() - MINUTE).toISOString(), facts: { protection: 'on', ci: 'present' } })}\n`);
}

// The director's prompt, as the board-context hook sees it: the text it adds, or ''.
async function prompt(world, text) {
  freshFacts(world.now());
  const out = await boardContext(
    { session_id: 'front-desk', cwd: world.checkout, hook_event_name: 'UserPromptSubmit', prompt: text },
    { now: world.now, env: {}, client: world.client, dir: NO_MANAGED, waitMs: HOOK_WAIT_MS },
  );
  return out?.hookSpecificOutput?.additionalContext ?? '';
}

// The front desk asks `questions` in one AskUserQuestion call and the director answers each as
// `answers` says (question text to label), as Claude Code runs it: the card check first, which
// lets a card in the form the composer gives through, then the prompt record with the answers.
async function ask(world, questions, answers) {
  const call = { session_id: 'front-desk', cwd: world.checkout, permission_mode: 'default', tool_name: 'AskUserQuestion' };
  assert.equal(await cardCheck({ ...call, hook_event_name: 'PreToolUse', tool_input: { questions } }, { dir: NO_MANAGED, now: world.now }), undefined,
    'the card check lets a composed card through');
  await promptRecord({
    ...call,
    hook_event_name: 'PostToolUse',
    tool_input: { questions, answers },
    tool_response: { questions, answers },
    tool_use_id: 'toolu_1',
  }, { client: world.client, now: world.now, dir: NO_MANAGED });
}

const labelsOf = (question) => question.options.map((o) => o.label);

// Typed replies are off until the director rules: the setting, written and confirmed as the director's confirmation would.
async function typedRepliesOn(world) {
  const written = await world.client.state.write({ project: P, kind: 'setting', data: { key: 'typedReplies', value: true, words: 'Answer decisions by typing' } });
  assert.equal(written.ok, true, JSON.stringify(written));
  const setting = eventsOf('setting').find((e) => e.data.key === 'typedReplies');
  const recorded = await world.client.state.record({ project: P, event: makeEvent({ ...confirmationFor(setting), now: world.now }) });
  assert.equal(recorded.ok, true, JSON.stringify(recorded));
}

// The director's typed reply, as the prompt record hook sees it: a decision is answered in chat, never on the picker.
async function reply(world, text) {
  await promptRecord(
    { session_id: 'front-desk', cwd: world.checkout, hook_event_name: 'UserPromptSubmit', prompt: text },
    { client: world.client, now: world.now, dir: NO_MANAGED, env: {} },
  );
}

// A record the build loop writes through the helper.
async function buildLoop(world, kind, data) {
  const written = await world.client.state.write({ project: P, kind, data });
  assert.equal(written.ok, true, JSON.stringify(written));
  return written.id;
}

// Work the foreman is building, with its feature running in a worktree of its own.
async function building(world, work, title) {
  const worktree = path.join(world.checkout, '.claude', 'worktrees', work);
  fs.mkdirSync(path.join(worktree, '.wheelhouse', 'feature'), { recursive: true });
  writeBaseline(P, work, worktree); // the record of its agent files, as the foreman's start keeps it
  await buildLoop(world, 'work', { id: work, title, lane: 'small', visible: false, dependsOn: [] });
  await buildLoop(world, 'feature', { work, step: 'building', worktree, branch: `feature/${work}`, session: `sess-${work}` });
}

// The question the export's session asked, as the foreman records it from its feature file.
const EXPORT_QUESTION = {
  id: 'q-export-1', work: 'export', what: 'Should the orders export download as CSV or as an Excel workbook?',
  why: 'It decides what the shop staff open after downloading.', level: 3, recommendation: 'CSV',
  options: [{ label: 'CSV', says: 'A plain file any spreadsheet opens.' }, { label: 'Excel', says: 'A workbook with the columns already sized.' }],
};

// A pull request on the host from the branch feature/<work>, made from main as it stands with
// `files`, and its signed CLEAN review. Resolves with its head.
async function openPr(world, number, work, files) {
  const branch = `feature/${work}`;
  await g(world.work, 'fetch', '-q', 'origin', 'main');
  await g(world.work, 'checkout', '-q', '-B', branch, 'origin/main');
  writeFiles(world.work, files);
  await g(world.work, 'add', '-A');
  await g(world.work, 'commit', '-q', '-m', `Build ${work}`);
  await g(world.work, 'push', '-q', 'origin', branch);
  world.host.open(number, branch);
  const head = await g(world.work, 'rev-parse', 'HEAD');
  const reviewed = await world.client.state.record({
    project: P, event: makeEvent({ kind: 'review', data: { pr: number, commit: head, verdict: 'CLEAN' }, now: world.now }),
  });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  return head;
}

// The default branch moves on with `files`, as when another change merges.
async function mainMoves(world, files) {
  await g(world.work, 'fetch', '-q', 'origin', 'main');
  await g(world.work, 'checkout', '-q', '-B', 'main', 'origin/main');
  writeFiles(world.work, files);
  await g(world.work, 'add', '-A');
  await g(world.work, 'commit', '-q', '-m', 'Another change merged');
  await g(world.work, 'push', '-q', 'origin', 'main');
}

const merge = (world, number) => world.client.merge({ project: P, number, stop: false, bypass: false, approvalRequired: true });

// The approval card the front desk composes for a change users see, naming only the pull request:
// the command fills in its head from the host.
const approvalCard = (pr, what) => ({
  kind: 'approval',
  level: 3,
  what: `Pull request #${pr} ${what}`,
  why: 'Users will see this change, so it is shown to you before it joins the shop.',
  options: [{ label: 'Approve', says: 'It goes live once its last checks pass.' }],
  recommend: 'Approve',
  because: 'it does what you asked, and nothing else changes',
  meanwhile: 'It waits; other work carries on.',
  target: { pr },
});

// The pictures kept for a commit when its approval was recorded, by page and size.
const keptFor = (sha) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(P), '..', 'screens', `${sha}.json`), 'utf8')).shots;
  } catch {
    return null;
  }
};

const until = (check, what) => waitUntil(check, { what });

// --- The watcher ---

// What the waker printed, as the sessions it would wake.
function woken(lines) {
  const foreman = [];
  const works = [];
  for (const line of lines) {
    if (/^WAKE foreman /.test(line)) foreman.push(line);
    const w = /^WAKE feature ([a-z0-9-]+) /.exec(line);
    if (w) works.push(w[1]);
  }
  return { foreman, works };
}

// One watch as the watcher process runs it: an observation, a minute's wait for the bundle, then a
// second, after which what was gathered goes out. Returns who was woken.
async function watch(world) {
  const from = world.lines.length;
  const result = await runWatcher({
    project: P,
    client: world.client,
    config: world.config,
    waker: world.waker,
    now: world.now,
    sleep: async () => { world.at(world.now().getTime() - T0 + BUNDLE_MS + SECOND); },
    intervals: { state: 0, features: 0, prs: 0, testMerge: 0 },
    loops: 2,
    handled: () => readHandled(P),
    log: () => {},
  });
  assert.equal(result.started, true);
  return woken(world.lines.slice(from));
}

// --- The tests ---

test('a feature\'s question becomes a decision in chat, a typed reply answers it, and only that session wakes', async () => {
  await onComputer(async (world) => {
    await typedRepliesOn(world);
    await building(world, 'export', 'The orders export');
    await building(world, 'search', 'Searching the menu');
    await watch(world); // the watcher's first look: what is in state already is not news
    await buildLoop(world, 'question', EXPORT_QUESTION);

    // The director's next prompt: the hook says a decision waits that is not shown yet.
    world.at(HOUR);
    assert.match(await prompt(world, 'Morning'), /^Decisions not shown yet: 1\./);
    // Cards makes the card the decision is made from and hands none to the picker.
    assert.deepEqual(await frontDesk(world, ['cards']), { questions: [], left: 0 });
    assert.equal(eventsOf('card')[0].data.line, answerLine('q-export-1'));
    // The message is composed from the question as the build recorded it: its own options.
    const shown = await frontDesk(world, ['decision', 'show', '1']);
    assert.match(shown, /^Decision needed \(1\): Should the orders export download as CSV or as an Excel workbook\?/);
    assert.match(shown, /^A\. CSV \(recommended\)\. A plain file any spreadsheet opens\./m);
    assert.match(shown, /^B\. Excel\. A workbook with the columns already sized\./m);

    await reply(world, '1 A');
    const answers = eventsOf('action').filter((e) => e.data.action === 'answer');
    assert.deepEqual(answers.map((e) => [e.data.questionId, e.data.label]), [['q-export-1', 'CSV']]);
    assert.equal(typeof answers[0].sig?.value, 'string', 'the answer is signed');
    assert.equal((await viewsOf(world)).questions['q-export-1'].answer?.label, 'CSV');

    // The watcher wakes the export's session, never the search's.
    assert.deepEqual((await watch(world)).works, ['export']);
    // The card is closed: the next visit asks nothing, and the hook counts nothing.
    world.at(4 * HOUR);
    assert.ok(!(await prompt(world, 'Back again')).includes(cardsLine(1)));
    assert.deepEqual(await frontDesk(world, ['cards']), { questions: [], left: 0 });
  });
});

test('a gate-asks becomes an approval card, and the click on it lets the gate merge', async () => {
  await onComputer(async (world) => {
    await building(world, 'banner', 'The Easter banner');
    const head = await openPr(world, 7, 'banner', { 'src/home.js': 'export const banner = \'Hot cross buns are back\';\n' });
    // The foreman's merge found the gate waiting for the director's approval, and recorded it.
    await buildLoop(world, 'gate-asks', { work: 'banner', pr: 7, ask: 'approval', sha: head });

    world.at(HOUR);
    assert.ok((await prompt(world, 'Morning')).startsWith(cardsLine(1)));
    const visit = await frontDesk(world, ['cards']);
    assert.equal(visit.questions.length, 1);
    const [card] = visit.questions;
    assert.equal(setLineOf(visit.inReply[0]), approvalLine(7, head));
    assert.match(card.question, /The Easter banner/);
    await ask(world, visit.questions, { [card.question]: 'Approve' });
    assert.deepEqual(eventsOf('approval').map((e) => [e.data.pr, e.data.commit]), [[7, head]]);

    assert.deepEqual(await merge(world, 7), { ok: true, merged: true, sha: head, guardrailPaths: [], criticalAreas: [] });
    // The click is on record, so no card is made for that ask again.
    assert.deepEqual(await frontDesk(world, ['cards']), { questions: [], left: 0 });
    assert.equal(eventsOf('card').length, 1);
  });
});

// scenario 5, its deterministic half
test('a decision no reply has answered stays waiting, is told again, and decides nothing', async () => {
  await onComputer(async (world) => {
    await typedRepliesOn(world);
    await building(world, 'export', 'The orders export');
    await watch(world);
    await buildLoop(world, 'question', EXPORT_QUESTION);

    world.at(HOUR);
    assert.match(await prompt(world, 'Morning'), /^Decisions not shown yet: 1\./);
    assert.deepEqual(await frontDesk(world, ['cards']), { questions: [], left: 0 });
    // Words that are no reply to it, and a reply that names no decision waiting, record nothing.
    await reply(world, 'What about the menu prices?');
    await reply(world, '5 A');
    await reply(world, 'Not now');

    // Nothing was decided: no answer, and no session is woken.
    assert.equal(eventsOf('action').length, 0);
    assert.equal(eventsOf('decision-answer').length, 0);
    assert.equal((await viewsOf(world)).questions['q-export-1'].answer, null);
    assert.deepEqual((await watch(world)).works, []);

    // On the next visit it is still waiting, on the board and in the prompt's reminder, by its number.
    world.at(5 * HOUR);
    const next = await prompt(world, 'Back again');
    assert.match(next, /Decisions waiting for the director: 1\. Should the orders export download as CSV or as an Excel workbook\?/);
    const board = await prompt(world, '/wheelhouse:board');
    assert.match(board, /^### Waiting on you\n- 1\\\. Should the orders export download as CSV or as an Excel workbook\?/m, board);
    assert.match(await frontDesk(world, ['decision', 'show', '1']), /^Decision needed \(1\): /);
  });
});

test('an update after an approval asks again, however the pages look, and the new head\'s card is one click', async () => {
  await onComputer(async (world) => {
    // A change users see, approved by the director's click on its card.
    await openPr(world, 7, 'menu', { 'src/menu.js': 'export const menu = [\'Sourdough\'];\n' });
    const { question } = await frontDesk(world, ['card'], approvalCard(7, 'adds the menu page.'));
    await ask(world, [question], { [question.question]: 'Approve' });

    // Another change merges, and the branch is brought up to date: its head is a new commit no click named.
    await mainMoves(world, { 'src/about.js': 'export const about = \'Since 1952\';\n' });
    const updated = await world.client.updateBranch({ project: P, number: 7 });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    assert.deepEqual((await merge(world, 7)).reasons, [`no approval of ${short(updated.head)}`]);
    assert.deepEqual(world.host.merges, []);

    // The gate asks again: the foreman's merge records it, and the front desk's next card names the new head.
    await buildLoop(world, 'gate-asks', { work: 'menu', pr: 7, ask: 'approval', sha: updated.head });
    const visit = await frontDesk(world, ['cards']);
    assert.deepEqual(visit.inReply.map(setLineOf), [approvalLine(7, updated.head)]);
  });
});

test('a merge waits while the director has a question open on its work, and for an answer no newer version carries', async () => {
  await onComputer(async (world) => {
    const head = await openPr(world, 7, 'export', { 'src/export.js': 'export const kind = \'csv\';\n' });
    const { question } = await frontDesk(world, ['card'], approvalCard(7, 'adds the orders export.'));
    await ask(world, [question], { [question.question]: 'Approve' });
    // The approval names the head; a question of the director's still open on the same work holds the merge.
    await buildLoop(world, 'question', EXPORT_QUESTION);
    const held = await merge(world, 7);
    assert.equal(held.ok, false);
    assert.match(held.refused, /question open on export/);
    assert.deepEqual(world.host.merges, []);
    assert.equal(held.needs, undefined, 'no card is asked for the merge while the question waits');
    assert.ok(head);
  });
});

// The director answers the open question on the work after the head was reviewed.
const treeOf = (world, work) => path.join(world.checkout, '.claude', 'worktrees', work);
async function answeredAfterReview(world) {
  await typedRepliesOn(world);
  await building(world, 'export', 'The orders export');
  await building(world, 'search', 'Searching the menu');
  const head = await openPr(world, 7, 'export', { 'src/export.js': 'export const kind = \'csv\';\n' });
  const { question } = await frontDesk(world, ['card'], approvalCard(7, 'adds the orders export.'));
  await ask(world, [question], { [question.question]: 'Approve' });
  await buildLoop(world, 'question', EXPORT_QUESTION);
  world.at(HOUR);
  await frontDesk(world, ['cards']);
  await reply(world, '1 A');
  return head;
}

test('an answer that needs no change holds the merge until the session says so, then it merges', async () => {
  await onComputer(async (world) => {
    const head = await answeredAfterReview(world);
    const held = await merge(world, 7);
    assert.equal(held.ok, false);
    assert.match(held.refused, /answered a question on export after this version was reviewed/);
    // Reading the answer clears nothing.
    assert.equal((await world.client.state.answer({ project: P, questionId: 'q-export-1' })).answer, 'CSV');
    assert.equal((await merge(world, 7)).ok, false);
    // Another work's session, no folder, and a folder outside any feature can't say it.
    const say = (extra) => world.client.state.answer({ project: P, questionId: 'q-export-1', noChange: true, ...extra });
    assert.equal((await say({ cwd: treeOf(world, 'search') })).ok, false);
    assert.equal((await say({})).ok, false);
    assert.equal((await say({ cwd: world.work })).ok, false);
    assert.equal((await merge(world, 7)).ok, false);
    // The session says it needs no change.
    assert.equal((await world.client.state.answer({ project: P, cwd: treeOf(world, 'export'), questionId: 'q-export-1', noChange: true })).ok, true);
    assert.deepEqual(await merge(world, 7), { ok: true, merged: true, sha: head, guardrailPaths: [], criticalAreas: [], answeredNoChange: ['q-export-1'] });
  });
});

test('an answer that needs a change holds the merge until a newer reviewed version carries it', async () => {
  await onComputer(async (world) => {
    await answeredAfterReview(world);
    assert.match((await merge(world, 7)).refused, /after this version was reviewed/);
    // The session commits the change and pushes it; the new head is reviewed after the answer.
    writeFiles(world.work, { 'src/export.js': 'export const kind = \'csv\';\nexport const cut = true;\n' });
    await g(world.work, 'add', '-A');
    await g(world.work, 'commit', '-q', '-m', 'Cut it');
    await g(world.work, 'push', '-q', 'origin', 'feature/export');
    const moved = await g(world.work, 'rev-parse', 'HEAD');
    world.at(2 * HOUR);
    const reviewed = await world.client.state.record({
      project: P, event: makeEvent({ kind: 'review', data: { pr: 7, commit: moved, verdict: 'CLEAN' }, now: world.now }),
    });
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
    const out = await world.client.merge({ project: P, number: 7, stop: false, bypass: false, approvalRequired: false });
    assert.doesNotMatch(out.refused ?? '', /question|answered/);
  });
});

test('an approval card steered with Suggest a change… is revised once the change is committed, and the click on the revised card lets the gate merge its commit', async () => {
  await onComputer(async (world) => {
    const head = await openPr(world, 7, 'banner', { 'src/home.js': 'export const banner = \'Hot cross buns are back\';\n' });
    world.at(MINUTE);
    const { question, id } = await frontDesk(world, ['card'], approvalCard(7, 'changes the banner on the shop\'s home page.'));
    // The director asks for a change; the words are not a decision, so nothing is approved and the card waits.
    await ask(world, [question], { [question.question]: 'Suggest a change…' });
    assert.deepEqual(eventsOf('approval'), []);
    assert.ok((await viewsOf(world)).waiting.some((c) => c.id === id), 'the card waits for its revision');

    // The revision at the same head describes a change the code doesn't hold, so it is refused.
    const revision = { ...approvalCard(7, 'changes the banner on the shop\'s home page, in bigger type.'), revises: id, changed: 'The banner is in bigger type.' };
    const said = { err: '' };
    const refused = await sandboxed(world, () => cli(['card'], {
      cwd: world.checkout, client: world.client, now: world.now, input: JSON.stringify(revision), out: () => {}, err: (t) => { said.err += t; },
    }));
    assert.notEqual(refused, 0);
    assert.match(said.err, /a revised approval needs the change committed first/);

    // The build commits the change; the revised card names the new head and closes the old card.
    await g(world.work, 'checkout', '-q', 'feature/banner');
    writeFiles(world.work, { 'src/home.js': 'export const banner = \'Hot cross buns are back, in bigger type\';\n' });
    await g(world.work, 'add', '-A');
    await g(world.work, 'commit', '-q', '-m', 'Bigger banner type');
    await g(world.work, 'push', '-q', 'origin', 'feature/banner');
    const head2 = await g(world.work, 'rev-parse', 'HEAD');
    assert.notEqual(head2, head);
    const reviewed = await world.client.state.record({
      project: P, event: makeEvent({ kind: 'review', data: { pr: 7, commit: head2, verdict: 'CLEAN' }, now: world.now }),
    });
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
    const revised = await frontDesk(world, ['card'], revision);
    assert.equal(setLineOf(revised.inReply[0]), approvalLine(7, head2));
    const waiting = (await viewsOf(world)).waiting;
    assert.ok(!waiting.some((c) => c.id === id), 'the old card is closed');
    assert.ok(waiting.some((c) => c.id === revised.id));

    // The click on the revised card signs its own commit, and the gate merges that.
    await ask(world, [revised.question], { [revised.question.question]: 'Approve' });
    assert.deepEqual(eventsOf('approval').map((e) => [e.data.pr, e.data.commit]), [[7, head2]]);
    assert.deepEqual(await merge(world, 7), { ok: true, merged: true, sha: head2, guardrailPaths: [], criticalAreas: [] });
  });
});

test('a gate\'s approval card steered with Suggest a change… is revised at the head the gate asks about next: one revised card waits for it and the click signs the new head', async () => {
  await onComputer(async (world) => {
    await building(world, 'banner', 'The Easter banner');
    const head = await openPr(world, 7, 'banner', { 'src/home.js': 'export const banner = \'Hot cross buns are back\';\n' });
    // The foreman's merge found the gate waiting for the director's approval; the visit makes its card.
    await buildLoop(world, 'gate-asks', { work: 'banner', pr: 7, ask: 'approval', sha: head });
    world.at(HOUR);
    const asked = await frontDesk(world, ['cards']);
    const [card] = asked.questions;
    assert.equal(setLineOf(asked.inReply[0]), approvalLine(7, head));
    const { id } = (await viewsOf(world)).waiting.find((c) => c.data.line === approvalLine(7, head));
    await ask(world, [card], { [card.question]: 'Suggest a change…' });
    assert.deepEqual(eventsOf('approval'), []);
    // The pick records nothing until the director says what they would change; the front desk hands their words on
    // with `suggest`, and only then does the card say a new proposal is on its way.
    assert.equal((await viewsOf(world)).waiting.find((c) => c.id === id).steered, null);
    assert.equal((await frontDesk(world, ['suggest', id, 'banner', 'The banner in bigger type'])).say, 'Noted. A new proposal will follow.');
    assert.equal(typeof (await viewsOf(world)).waiting.find((c) => c.id === id).steered, 'string');

    // The build commits the change; the foreman's merge records the gate asking about the new head,
    // and a visit makes the gate's card for it before the front desk composes the revision.
    await g(world.work, 'checkout', '-q', 'feature/banner');
    writeFiles(world.work, { 'src/home.js': 'export const banner = \'Hot cross buns are back, in bigger type\';\n' });
    await g(world.work, 'add', '-A');
    await g(world.work, 'commit', '-q', '-m', 'Bigger banner type');
    await g(world.work, 'push', '-q', 'origin', 'feature/banner');
    const head2 = await g(world.work, 'rev-parse', 'HEAD');
    const reviewed = await world.client.state.record({
      project: P, event: makeEvent({ kind: 'review', data: { pr: 7, commit: head2, verdict: 'CLEAN' }, now: world.now }),
    });
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
    await buildLoop(world, 'gate-asks', { work: 'banner', pr: 7, ask: 'approval', sha: head2 });
    world.at(2 * HOUR);
    assert.deepEqual((await frontDesk(world, ['cards'])).inReply.map(setLineOf), [approvalLine(7, head2)]);

    // The revision names the old card, closed by the later head, and takes the place of the gate's card.
    const revised = await frontDesk(world, ['card'], {
      ...approvalCard(7, 'changes the banner on the shop\'s home page, in bigger type.'), revises: id, changed: 'The banner is in bigger type.',
    });
    assert.equal(setLineOf(revised.inReply[0]), approvalLine(7, head2));
    assert.match(revised.question.question, /What changed: The banner is in bigger type\./);
    const waiting = (await viewsOf(world)).waiting;
    assert.deepEqual(waiting.map((c) => [c.id, c.data.line, c.data.revises]), [[revised.id, approvalLine(7, head2), id]]);
    // The next visit makes no other card for that head.
    world.at(3 * HOUR);
    await frontDesk(world, ['cards']);
    assert.deepEqual((await viewsOf(world)).waiting.map((c) => c.id), [revised.id]);

    // Approve on the revised card signs the new head, and the gate merges it.
    await ask(world, [revised.question], { [revised.question.question]: 'Approve' });
    assert.deepEqual(eventsOf('approval').map((e) => [e.data.pr, e.data.commit]), [[7, head2]]);
    assert.deepEqual(await merge(world, 7), { ok: true, merged: true, sha: head2, guardrailPaths: [], criticalAreas: [] });
  });
});
