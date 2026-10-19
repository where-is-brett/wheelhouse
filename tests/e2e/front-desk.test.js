// tests/e2e/front-desk.test.js
// The front desk end to end (front desk plan, Task 14). One computer: its own WHEELHOUSE_HOME with
// a real helper on a socket (a named pipe on Windows), a bare repository standing in for the host
// behind a stand-in for gh and glab, the project's main checkout cloned from it, and the director's
// profile on a bare repository of its own. The hooks' `decide` functions are called with what
// Claude Code sends: the board-context hook on each prompt of the director's, the card check before
// each AskUserQuestion call, and the prompt record after the director's click. The mod's bridge
// takes a reply code from the phone.
//
// The front desk's command (scripts/frontdesk/cli.js) runs as a sandboxed command does: every file
// call it makes into the Wheelhouse home fails the test, so it reaches state and the profile only
// through the helper. Its cards go to AskUserQuestion as the command gives them.
//
// The build loop's side starts from its records, as the foreman writes them through the helper: the
// work, its running features and a feature's question (tests/e2e/build-loop.test.js makes them from
// a feature session), and the gate's asks (act merge). The watcher runs as runWatcher runs it, its
// waker in Shape 2, which starts nothing and prints its wakes. Pictures of a preview are taken by a
// stand-in for scripts/screens/shoot.js, in a browser whose path is Chrome's (ruling F61).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main as cli } from '../../scripts/frontdesk/cli.js';
import { decide as boardContext, cardsLine, HEADINGS } from '../../scripts/hooks/board-context.js';
import { decide as cardCheck } from '../../scripts/hooks/card-check.js';
import { decide as promptRecord } from '../../scripts/hooks/prompt-record.js';
import { runBridge } from '../../scripts/mod/bridge.js';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { BUNDLE_MS } from '../../scripts/lib/build-loop.js';
import { profileDir, stateDir, wheelhouseHome } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { answerLine, approvalLine, confirmLine, replyCode, setLineOf } from '../../scripts/state/card-lines.js';
import { listEvents, makeEvent } from '../../scripts/state/events.js';
import { enrol, makeSigningKey } from '../../scripts/state/signing.js';
import { readHandled } from '../../scripts/watcher/handled.js';
import { projectConfig, runWatcher } from '../../scripts/watcher/main.js';
import { makeWaker } from '../../scripts/watcher/waker.js';
import { makeBareRemote, g } from '../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../helpers/homes.js';
import { writeFiles } from '../helpers/lineage.js';
import { matchingBody } from '../helpers/provenance.js';

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
// The project's configuration on its default branch: the watcher in Shape 2, and the pages.
const CONFIG = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], watcherShape: 2, pages: PAGES };
// A folder that is never created, so no managed copy of the hooks is found.
const NO_MANAGED = path.join(tempFolder('wh-no-managed-'), 'absent');
// The hook's own limit is 2 seconds; a test machine running every file at once is given longer.
const HOOK_WAIT_MS = 10000;
const short = (sha) => sha.slice(0, 7);

// --- The sandbox ---

// What the project's sandbox does to the front desk's commands (scripts/protection/settings.js:
// denyRead and denyWrite on ~/.wheelhouse): every file call into the Wheelhouse home fails with
// EPERM. Only calls made inside `sandboxed` are held, so the helper answering them in this same
// process, whose requests arrive in the server's own context, is not.
const walls = new AsyncLocalStorage();
const denied = [];
const TWO_PATHS = ['copyFileSync', 'cpSync', 'linkSync', 'renameSync', 'symlinkSync'];
const HELD_CALLS = [
  'accessSync', 'appendFileSync', 'chmodSync', 'copyFileSync', 'cpSync', 'existsSync', 'linkSync', 'lstatSync', 'mkdirSync',
  'mkdtempSync', 'openSync', 'opendirSync', 'readFileSync', 'readdirSync', 'readlinkSync', 'realpathSync', 'renameSync',
  'rmSync', 'rmdirSync', 'statSync', 'symlinkSync', 'unlinkSync', 'utimesSync', 'writeFileSync',
];

function walledOff(p) {
  const held = walls.getStore();
  if (!held) return false;
  let text = null;
  if (typeof p === 'string') text = p;
  else if (Buffer.isBuffer(p)) text = p.toString();
  else if (p instanceof URL) text = fileURLToPath(p);
  if (text === null) return false;
  const full = path.resolve(text);
  return held.some((wall) => full === wall || full.startsWith(`${wall}${path.sep}`));
}

const originals = new Map();
for (const call of HELD_CALLS) {
  const original = fs[call];
  if (typeof original !== 'function') continue;
  originals.set(call, original);
  const wrapped = function held(...args) {
    for (const p of TWO_PATHS.includes(call) ? args.slice(0, 2) : args.slice(0, 1)) {
      if (!walledOff(p)) continue;
      denied.push(`${call} ${String(p)}`);
      if (call === 'existsSync') return false;
      throw Object.assign(new Error(`EPERM: operation not permitted, ${call} '${String(p)}'`), { code: 'EPERM', syscall: call, path: String(p) });
    }
    return original.apply(this, args);
  };
  if (call === 'realpathSync') {
    wrapped.native = function heldNative(p, ...rest) {
      if (walledOff(p)) {
        denied.push(`realpathSync.native ${String(p)}`);
        throw Object.assign(new Error(`EPERM: operation not permitted, realpath '${String(p)}'`), { code: 'EPERM' });
      }
      return original.native.call(this, p, ...rest);
    };
  }
  fs[call] = wrapped;
}
after(() => {
  for (const [call, original] of originals) fs[call] = original;
});

// Runs fn as a sandboxed command of the computer `world` runs, then checks it touched nothing in
// the Wheelhouse home.
async function sandboxed(world, fn) {
  const before = denied.length;
  const result = await walls.run(world.walls, fn);
  assert.deepEqual(denied.slice(before), [], 'a sandboxed command reached into the Wheelhouse home');
  return result;
}

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

async function until(check, what) {
  const end = Date.now() + 20 * SECOND;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`waited too long for ${what}`);
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}

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

test('a feature\'s question becomes a composed card, a click answers it, and only that session wakes', async () => {
  await onComputer(async (world) => {
    await building(world, 'export', 'The orders export');
    await building(world, 'search', 'Searching the menu');
    await watch(world); // the watcher's first look: what is in state already is not news
    await buildLoop(world, 'question', EXPORT_QUESTION);

    // The director's next prompt: the hook says a card waits that no visit has asked.
    world.at(HOUR);
    assert.ok((await prompt(world, 'Morning')).startsWith(cardsLine(1)));
    const visit = await frontDesk(world, ['cards']);
    assert.equal(visit.questions.length, 1);
    assert.equal(visit.left, 0);
    const [card] = visit.questions;
    // Composed from the question as the build recorded it: its own options, and its set line.
    assert.deepEqual(labelsOf(card), ['CSV', 'Excel', 'Explain more']);
    assert.equal(setLineOf(card.question), answerLine('q-export-1'));
    assert.match(card.question, /^What this is: /);
    assert.match(card.options[0].description, /^Recommended:/);

    await ask(world, visit.questions, { [card.question]: 'CSV' });
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

test('an approval card answered by its reply code from the phone lets the gate merge', async () => {
  await onComputer(async (world) => {
    const head = await openPr(world, 7, 'banner', { 'src/home.js': 'export const banner = \'Hot cross buns are back\';\n' });
    assert.deepEqual((await merge(world, 7)).reasons, [`no approval of ${short(head)}`]);

    // The front desk composes the approval card from the pull request's number; the command
    // fills in its head from the host, so the card's words and its set line name one commit.
    world.at(MINUTE);
    const { question, id } = await frontDesk(world, ['card'], approvalCard(7, 'changes the banner on the shop\'s home page.'));
    assert.equal(setLineOf(question.question), approvalLine(7, head));
    const code = replyCode(approvalLine(7, head));
    assert.ok(question.question.includes(code), 'the card carries its reply code');
    assert.deepEqual(labelsOf(question), ['Approve', 'Not now', 'Explain more', 'Show me']);
    // At the computer, the director puts it off; the card's code is now on record.
    await ask(world, [question], { [question.question]: 'Not now' });
    assert.equal(eventsOf('shown').length, 1);
    assert.equal(eventsOf('approval').length, 0);
    assert.ok((await viewsOf(world)).waiting.some((c) => c.id === id), 'Not now keeps it waiting');

    // Later, from the phone: the mod hands the bridge the code and an option.
    world.at(2 * HOUR);
    const said = JSON.parse(await runBridge({
      stdin: Readable.from([JSON.stringify({ cmd: 'reply', origin: 'bridge', text: `${code.toLowerCase()} approve`, cwd: world.checkout })]),
      deps: { client: world.client, now: world.now },
    }));
    assert.deepEqual(said, { ok: true, says: 'Recorded: Approve pull request #7' });
    assert.deepEqual(eventsOf('approval').map((e) => [e.data.pr, e.data.commit]), [[7, head]]);
    assert.ok(!(await viewsOf(world)).waiting.some((c) => c.id === id), 'the approval closes the card');

    assert.deepEqual(await merge(world, 7), { ok: true, merged: true, sha: head, guardrailPaths: [], criticalAreas: [] });
    assert.deepEqual(world.host.merges, [{ number: 7, sha: head }]);
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
    assert.equal(setLineOf(card.question), approvalLine(7, head));
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
test('a card answered Not now stays on the board and is not asked on the next visit', async () => {
  await onComputer(async (world) => {
    await building(world, 'export', 'The orders export');
    await watch(world);
    await buildLoop(world, 'question', EXPORT_QUESTION);

    world.at(HOUR);
    assert.ok((await prompt(world, 'Morning')).startsWith(cardsLine(1)));
    const visit = await frontDesk(world, ['cards']);
    const [card] = visit.questions;
    await ask(world, visit.questions, { [card.question]: 'Not now' });

    // Nothing was decided: no answer, and no session is woken.
    assert.equal(eventsOf('action').length, 0);
    assert.equal((await viewsOf(world)).questions['q-export-1'].answer, null);
    assert.deepEqual((await watch(world)).works, []);

    // Later in the visit, and on the next one, the card is not asked again.
    world.at(HOUR + 10 * MINUTE);
    assert.equal(await prompt(world, 'What about the menu prices?'), '');
    world.at(5 * HOUR);
    const next = await prompt(world, 'Back again');
    assert.ok(next.startsWith(HEADINGS.briefing), next);
    assert.ok(!next.includes('Cards to ask this visit'), next);
    assert.deepEqual(await frontDesk(world, ['cards']), { questions: [], left: 0 });

    // It stays on the board, waiting on the director, where they can ask for it by its number.
    const board = await prompt(world, '/wheelhouse:board');
    assert.match(board, /^### Waiting on you\n- 1\\\. What this is: Should the orders export download as CSV or as an Excel workbook\?/m, board);
    const again = await frontDesk(world, ['again', '1']);
    assert.deepEqual(again.questions.map((q) => q.question), [card.question]);
  });
});

test('a concept known after three days is proposed once; Explain more takes it back at once', async () => {
  await onComputer(async (world) => {
    // A product question whose text uses one glossary term, "preview".
    const choice = (day) => ({
      kind: 'question',
      level: 3,
      what: `Which photo should the preview of the menu page show first, for week ${day}?`,
      why: 'It is the first thing customers see on that page.',
      options: [{ label: 'The cakes', says: 'Colourful, and they sell best.' }, { label: 'The bread', says: 'What the shop is known for.' }],
      recommend: 'The cakes',
      because: 'they sell best',
      meanwhile: 'The page keeps the photo it has.',
    });
    const asked = async (day) => (await frontDesk(world, ['card'], choice(day))).question;

    // While the director doesn't know it, the card puts it in plain words.
    const first = await asked(1);
    assert.match(first.question, /private trial copy/);
    assert.doesNotMatch(first.question, /\bpreview\b/);

    // Cards using it, answered on three different days without asking for more.
    for (const day of [0, 1, 2]) {
      world.at(day * DAY + HOUR);
      const question = day === 0 ? first : await asked(day + 1);
      await ask(world, [question], { [question.question]: 'The cakes' });
    }

    // The next visit's first prompt proposes it as known, once: a profile setting waiting for its
    // confirmation, and its one-line card, which this visit asks.
    world.at(3 * DAY + HOUR);
    assert.ok((await prompt(world, 'Morning')).startsWith(cardsLine(1)));
    const proposed = eventsOf('setting', profileDir()).filter((e) => e.data.key === 'known:preview');
    assert.deepEqual(proposed.map((e) => e.data.value), [true]);
    assert.match((await asked(4)).question, /private trial copy/, 'nothing learnt changes anything until it is confirmed');
    world.at(3 * DAY + 4 * HOUR);
    await prompt(world, 'Back again');
    assert.equal(eventsOf('setting', profileDir()).filter((e) => e.data.key === 'known:preview').length, 1, 'proposed once');
    assert.equal(eventsOf('card').filter((e) => e.data.line === confirmLine(proposed[0])).length, 1);

    // The director confirms it: from then on the word is kept as it is.
    const visit = await frontDesk(world, ['cards']);
    const confirm = visit.questions.find((q) => setLineOf(q.question) === confirmLine(proposed[0]));
    assert.ok(confirm, JSON.stringify(visit));
    await ask(world, [confirm], { [confirm.question]: 'Confirm' });
    const known = await asked(5);
    assert.match(known.question, /\bpreview\b/);
    assert.doesNotMatch(known.question, /private trial copy/);

    // Explain more on a card using it: the next visit sets it back to not known at once, with no
    // card to confirm, and the words are plain again.
    world.at(4 * DAY + HOUR);
    await ask(world, [known], { [known.question]: 'Explain more' });
    const cards = eventsOf('card').length;
    world.at(4 * DAY + 4 * HOUR);
    assert.ok(!(await prompt(world, 'Morning')).includes('Cards to ask this visit'));
    assert.deepEqual(eventsOf('setting', profileDir()).filter((e) => e.data.key === 'known:preview').map((e) => e.data.value), [true, false]);
    assert.equal(eventsOf('card').length, cards, 'no card asks to confirm it');
    assert.match((await asked(6)).question, /private trial copy/);
  });
});

test('an update after an approval with identical pages merges; with a changed page it asks again', async () => {
  await onComputer(async (world) => {
    // Two changes users see, each approved by the director's click on its card. Recording an
    // approval photographs that commit's pages at every size from its preview, in the background.
    const same = await openPr(world, 7, 'menu', { 'src/menu.js': 'export const menu = [\'Sourdough\'];\n' });
    const changed = await openPr(world, 8, 'prices', { 'src/prices.js': 'export const prices = { sourdough: 6 };\n' });
    for (const [pr, what] of [[7, 'adds the menu page.'], [8, 'adds the price list.']]) {
      const { question } = await frontDesk(world, ['card'], approvalCard(pr, what));
      await ask(world, [question], { [question.question]: 'Approve' });
    }
    for (const sha of [same, changed]) await until(() => Object.keys(keptFor(sha) ?? {}).length === PAGES.length * 2, `the pictures of ${short(sha)}`);
    assert.ok(world.shots.every((s) => s.browser === CHROME));

    // Another change merges, and each is brought up to date: its head is a new commit no click named.
    await mainMoves(world, { 'src/about.js': 'export const about = \'Since 1952\';\n' });
    const updated = await world.client.updateBranch({ project: P, number: 7 });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    const shots = world.shots.length;
    assert.deepEqual(await merge(world, 7), { ok: true, merged: true, sha: updated.head, guardrailPaths: [], criticalAreas: [] });
    // Every page looked the same: the head was photographed at the gate, from its own preview.
    assert.deepEqual(world.shots.slice(shots).map((s) => s.commit), Array(PAGES.length * 2).fill(updated.head.slice(0, 12)));

    // The second, brought up to date with the first, looks different on one page now.
    const moved = await world.client.updateBranch({ project: P, number: 8 });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    world.changed.add(moved.head.slice(0, 12));
    assert.deepEqual((await merge(world, 8)).reasons, [`no approval of ${short(moved.head)}`]);
    assert.deepEqual(world.host.merges, [{ number: 7, sha: updated.head }]);

    // The gate asks again: the foreman's merge records it, and the front desk's next card names the new head.
    await buildLoop(world, 'gate-asks', { work: 'prices', pr: 8, ask: 'approval', sha: moved.head });
    const visit = await frontDesk(world, ['cards']);
    assert.deepEqual(visit.questions.map((q) => setLineOf(q.question)), [approvalLine(8, moved.head)]);
  });
});
