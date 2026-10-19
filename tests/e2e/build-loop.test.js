// tests/e2e/build-loop.test.js
// The build loop and lineage end to end (build-loop design, sections 10, 11, 12 and 14.6, and
// section 15's scenarios 26 and 28 to 32). One computer: its own WHEELHOUSE_HOME with a real
// helper on a socket (a named pipe on Windows), a bare repository standing in for the host
// behind a stand-in for gh and glab, and the project's main checkout cloned from it. The
// foreman's commands (act.js, wake.js) make real git worktrees there. The watcher's core and
// sources run as runWatcher runs them; the waker is the real one in Shape 2, which starts no
// process: what it would hand to a session is caught as its printed lines, and each wake is
// copied into the session's own folder. The hooks' `decide` functions are called with the
// input Claude Code sends, and the director's clicks are signed by the prompt-record hook.
//
// Sandbox-shaped. The commands sessions run through Bash run inside `sandboxed`, which refuses,
// as the project's sandbox does, every file call into the Wheelhouse home and records it: each
// such call fails the test. Those are a feature session's (scripts/feature/cli.js, and the
// lineage check the hold lets through) and the foreman's (act.js and wake.js, which forward to
// the helper; the helper runs them outside the sandbox as a child process, ruling R156). Hooks
// run outside the sandbox (check 32), as do the helper and the watcher.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forward } from '../../scripts/foreman/forward.js';
import { briefHash, featurePaths, parseBrief, readStatus } from '../../scripts/feature/files.js';
import { main as cli } from '../../scripts/feature/cli.js';
import { decide as featureStatus } from '../../scripts/hooks/feature-status.js';
import { decide as lineageHold, HELD } from '../../scripts/hooks/lineage-hold.js';
import { decide as promptRecord } from '../../scripts/hooks/prompt-record.js';
import { decide as sessionStart } from '../../scripts/hooks/session-start.js';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { BUNDLE_MS } from '../../scripts/lib/build-loop.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { run } from '../../scripts/lib/run.js';
import { holdFile, isHeld, main as lineageCheck, MATCHED } from '../../scripts/lineage/check.js';
import { buildManifest } from '../../scripts/lineage/manifest.js';
import { fingerprintFile } from '../../scripts/lineage/fingerprint.js';
import { describePlan, land, planFromPins } from '../../scripts/lineage/upgrade.js';
import {
  amendLine, answerLine, approveWorkLine, incidentFixLine, liftIncidentLine,
} from '../../scripts/state/card-lines.js';
import { listEvents, makeEvent } from '../../scripts/state/events.js';
import { enrol, makeSigningKey } from '../../scripts/state/signing.js';
import { readHandled } from '../../scripts/watcher/handled.js';
import { projectConfig, runWatcher } from '../../scripts/watcher/main.js';
import { makeWaker, readWake } from '../../scripts/watcher/waker.js';
import { makeBareRemote, g } from '../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../helpers/homes.js';
import { lineageFixture, writeFiles } from '../helpers/lineage.js';
import { writeSessionProvenance } from '../helpers/provenance.js';

const P = 'o__p';
const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const SECOND = 1000;
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(PLUGIN_ROOT, 'scripts', 'feature', 'cli.js');
const CHECK = path.join(PLUGIN_ROOT, 'scripts', 'lineage', 'check.js');
// A folder that is never created, so no managed copy of the hooks is found.
const NO_MANAGED = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-no-managed-')), 'absent');
process.on('exit', () => fs.rmSync(path.dirname(NO_MANAGED), { recursive: true, force: true }));
// The project's configuration on its default branch: the watcher in Shape 2, so the waker
// prints its wakes (and copies each into the session's folder) instead of starting `claude`.
const CONFIG = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], watcherShape: 2 };

// --- The sandbox ---

// What the project's sandbox does to a feature session's commands (scripts/protection/settings.js:
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

function refusal(call, p) {
  denied.push(`${call} ${String(p)}`);
  return Object.assign(new Error(`EPERM: operation not permitted, ${call} '${String(p)}'`), { code: 'EPERM', syscall: call, path: String(p) });
}

const originals = new Map();
for (const call of HELD_CALLS) {
  const original = fs[call];
  if (typeof original !== 'function') continue;
  originals.set(call, original);
  const wrapped = function held(...args) {
    for (const p of TWO_PATHS.includes(call) ? args.slice(0, 2) : args.slice(0, 1)) {
      if (!walledOff(p)) continue;
      if (call === 'existsSync') {
        denied.push(`${call} ${String(p)}`);
        return false;
      }
      throw refusal(call, p);
    }
    return original.apply(this, args);
  };
  if (call === 'realpathSync') {
    wrapped.native = function heldNative(p, ...rest) {
      if (walledOff(p)) throw refusal('realpathSync.native', p);
      return original.native.call(this, p, ...rest);
    };
  }
  fs[call] = wrapped;
}
after(() => {
  for (const [call, original] of originals) fs[call] = original;
});

// Runs fn as a sandboxed command of the computer `world` runs, then checks it touched nothing
// in the Wheelhouse home.
async function sandboxed(world, fn) {
  const before = denied.length;
  const result = await walls.run(world.walls, fn);
  assert.deepEqual(denied.slice(before), [], 'a sandboxed command reached into the Wheelhouse home');
  return result;
}

// The sandbox stand-in holds: a sandboxed read of the home fails, and is caught.
async function sandboxHolds(world) {
  const before = denied.length;
  await walls.run(world.walls, async () => {
    assert.throws(() => fs.readFileSync(path.join(world.home, 'computer.json')), { code: 'EPERM' });
  });
  assert.equal(denied.length, before + 1);
  denied.length = before;
}

// --- The host ---

// gh and glab stood in for over the bare repository, as GitHub keeps it: a pull request's head
// is its branch's head (kept at refs/pull/<n>/head, where the helper fetches it), a merge moves
// the default branch to the head the gate merged, and CI passes on a commit only once the test
// says so. A pull request is opened only from a branch the host holds.
function standInHost(remoteUrl) {
  const prs = new Map();
  const passed = new Set();
  const merges = [];
  const headOf = async (branch) => {
    const found = await run('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: remoteUrl });
    return found.code === 0 ? found.stdout.trim() : null;
  };
  return {
    prs,
    merges,
    pass: (sha) => { passed.add(sha); },
    defaultBranch: async () => 'main',
    openPr: async ({ head, base, title, body }) => {
      if (await headOf(head) === null) throw new Error(`the host has no branch ${head}`);
      const number = prs.size + 1;
      prs.set(number, { head, base, title, body, state: 'open', merged: null });
      return { number };
    },
    updatePr: async ({ number }) => ({ number }),
    prState: async (number) => {
      const pr = prs.get(number);
      if (!pr) throw new Error(`the host has no pull request ${number}`);
      const headSha = pr.state === 'merged' ? pr.merged : await headOf(pr.head);
      if (pr.state === 'open') await g(remoteUrl, 'update-ref', `refs/pull/${number}/head`, headSha);
      return { number, headSha, headRef: pr.head, baseRef: pr.base, mergeable: 'yes', state: pr.state, body: pr.body };
    },
    ciState: async (sha) => ({ sha, state: passed.has(sha) ? 'success' : 'pending' }),
    merge: async ({ number, sha }) => {
      merges.push({ number, sha });
      await g(remoteUrl, 'update-ref', 'refs/heads/main', sha);
      Object.assign(prs.get(number), { state: 'merged', merged: sha });
      return { merged: true };
    },
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

// --- The computer ---

// The host's default branch with the product and the configuration, the main checkout cloned
// from it, a home with this computer's signing key enrolled, the project's record, a helper,
// the state cloned and the lock taken. `lineage` makes a Wheelhouse root and an install record
// for the checkout (tests/helpers/lineage.js), whose manifest the helper's gate reads.
async function makeWorld({ lineage = false } = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const seed = tempFolder('wh-seed-');
  await g(seed, 'init', '-q', '-b', 'main');
  writeFiles(seed, {
    'README.md': 'The product.\n',
    'package.json': '{ "name": "product" }\n',
    'src/app.js': 'export const app = 1;\n',
    '.claude/wheelhouse.json': `${JSON.stringify(CONFIG)}\n`,
  });
  await g(seed, 'add', '-A');
  await g(seed, 'commit', '-q', '-m', 'The product');
  await g(seed, 'push', '-q', remote.url, 'HEAD:refs/heads/main');

  const checkout = fs.realpathSync.native(tempFolder('wh-main-'));
  await g(path.dirname(checkout), 'clone', '-q', remote.url, checkout);
  const fixture = lineage ? lineageFixture(checkout) : null;

  const home = shortHome();
  const host = standInHost(remote.url);
  // The computer's clock: the test moves it on, and each reading is a millisecond after the
  // last, as a real clock is between two writes, so no two records share a time.
  let ms = 0;
  const now = () => new Date(T0 + (ms += 1));
  const lines = [];
  const world = {
    remote, checkout, home, host, now, lines, lineage: fixture,
    // The folders the sandbox holds: the home as spelt and as its real path.
    walls: [...new Set([path.resolve(home), fs.realpathSync.native(home)])],
    tick: (by = SECOND) => { ms += by; return now(); },
  };
  await as(home, async () => {
    writeProject(P, {
      folder: checkout, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
    const helper = await startHelper({
      address: testAddress(home), adapterFor: async () => host, envFor: async () => ({}), now, ...(fixture ? { pluginRoot: fixture.root } : {}),
    });
    world.close = async () => {
      await helper.close();
      remote.cleanup();
    };
    world.client = helperClient({ address: helper.address });
    assert.deepEqual(await world.client.state.clone({ project: P }), { ok: true });
    assert.equal((await world.client.lock.take({ project: P })).result.taken, true);
    world.config = (await projectConfig(P, world.client)).config;
    assert.equal(world.config?.watcherShape, 2, 'the configuration is read from the default branch');
    world.waker = makeWaker({ shape: 2, project: P, config: world.config, print: (line) => lines.push(line), now });
  });
  return world;
}

// Runs a test's body with the computer's home, and closes it afterwards.
async function onComputer(options, fn) {
  const world = await makeWorld(options);
  try {
    await as(world.home, () => fn(world));
  } finally {
    await world.close();
  }
}

// --- The watcher ---

// What the waker printed, as the sessions it would wake.
function woken(lines) {
  const foreman = [];
  const features = [];
  for (const line of lines) {
    const f = /^WAKE foreman (.+)$/.exec(line);
    if (f) foreman.push(f[1]);
    const w = /^WAKE feature ([a-z0-9-]+) (.+)$/.exec(line);
    if (w) features.push({ work: w[1], file: w[2] });
  }
  return { foreman, features, works: features.map((x) => x.work) };
}

// One watch as the watcher process runs it: an observation, a minute's wait for the bundle,
// then a second, after which what was gathered goes out. Every source is asked each time, and
// awake time counts for nothing, so nothing is called stuck. Returns who was woken.
async function watch(world) {
  const from = world.lines.length;
  const result = await runWatcher({
    project: P,
    client: world.client,
    config: world.config,
    waker: world.waker,
    now: world.now,
    sleep: async () => { world.tick(BUNDLE_MS + SECOND); },
    intervals: { state: 0, features: 0, prs: 0, testMerge: 0 },
    loops: 2,
    handled: () => readHandled(P),
    log: () => {},
  });
  assert.equal(result.started, true);
  return woken(world.lines.slice(from));
}

// The events of the one foreman wake `woke` holds.
function foremanEvents(woke) {
  assert.equal(woke.foreman.length, 1, `one foreman wake: ${JSON.stringify(woke)}`);
  return readWake(woke.foreman[0]).events;
}

// --- The foreman ---

// One of the foreman's commands, `node act.js …` or `node wake.js …`, run in the sandbox from
// the main checkout: it forwards to the helper, which runs it in a child process.
async function foremanRuns(world, script, argv) {
  const said = { out: '', err: '' };
  world.tick();
  const code = await sandboxed(world, () => forward(script, argv, {
    cwd: world.checkout, client: world.client, out: (t) => { said.out += t; }, err: (t) => { said.err += t; },
  }));
  return { code, ...said };
}

const foreman = (world, argv) => foremanRuns(world, 'act', argv);

async function foremanReads(world, file) {
  const read = await foremanRuns(world, 'wake', ['read', file]);
  assert.equal(read.code, 0, read.err);
  return read.out;
}

// --- The front desk and the director ---

// A record the front desk writes through the helper.
async function frontDesk(world, kind, data) {
  world.tick();
  const written = await world.client.state.write({ project: P, kind, data });
  assert.equal(written.ok, true, JSON.stringify(written));
  return written.id;
}

// The director's click on a card, as Claude Code sends it to the prompt-record hook.
async function click(world, { question, options, label }) {
  world.tick();
  const questions = [{ question, header: 'Card', multiSelect: false, options: options.map((o) => ({ label: o, description: o })) }];
  await promptRecord({
    session_id: 'front-desk',
    cwd: world.checkout,
    permission_mode: 'default',
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: { questions, answers: { [question]: label } },
    tool_response: { questions, answers: { [question]: label } },
    tool_use_id: 'toolu_1',
  }, { client: world.client, now: world.now, dir: NO_MANAGED });
}

const eventsOf = (kind) => listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === kind);
const viewsOf = async (world) => (await world.client.state.views({ project: P })).views;

// Work the front desk records, naming its document, and for small or feature work the
// director's approval of it, clicked on its card.
async function queueWork(world, id, { lane = 'small' } = {}) {
  const text = `# ${id}\n\nWhat ${id} builds.\n`;
  const rel = `docs/work/${id}.md`;
  writeFiles(world.checkout, { [rel]: text });
  const hash = briefHash(text);
  await frontDesk(world, 'work', { id, title: `The ${id} work`, lane, visible: false, dependsOn: [], doc: { path: rel, hash } });
  if (lane === 'small' || lane === 'feature') {
    await click(world, { question: approveWorkLine(id, lane, hash), options: ['Approve', 'Not yet'], label: 'Approve' });
  }
  return { doc: rel, hash };
}

// --- A feature session ---

// The feature-status hook as Claude Code runs it at the session's Stop.
async function statusHook(world, s) {
  await featureStatus({ cwd: s.worktree, session_id: s.sessionId, hook_event_name: 'Stop' }, { now: world.now });
  return readStatus(featurePaths(s.worktree).status);
}

// One of the feature session's commands, `node cli.js …`, run in the sandbox.
async function session(world, s, argv) {
  const said = { out: '', err: '' };
  world.tick();
  const code = await sandboxed(world, () => cli(argv, {
    cwd: s.worktree, client: world.client, out: (t) => { said.out += t; }, err: (t) => { said.err += t; },
  }));
  return { code, ...said };
}

// The foreman starts the work; its session begins (the status hook keeps its id, and the session
// start records its provenance, matching the installed manifest unless `provenance` is false).
async function startWork(world, work, { provenance = true } = {}) {
  const started = await foreman(world, [
    'start', work, '--goal', `Build ${work}`, '--done', 'It works', '--appetite-sessions', '1', '--appetite-tokens', '200000',
  ]);
  assert.equal(started.code, 0, started.err);
  const s = { work, worktree: path.join(world.checkout, '.claude', 'worktrees', work), sessionId: `sess-${work}` };
  assert.ok(started.out.split('\n').includes(`START feature ${work} ${s.worktree}`), 'the waker was asked to start the session');
  assert.equal(await g(s.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), `feature/${work}`);
  if (provenance) writeSessionProvenance(P, s.sessionId);
  await statusHook(world, s);
  return s;
}

const reportText = (work) => `\`\`\`json\n${JSON.stringify({
  v: 1, work, status: 'done', tests: 'npm test: 4 pass', assumptions: [], concerns: [], rulings: [],
}, null, 2)}\n\`\`\`\n\nBuilt ${work}. The tests pass.\n`;

// The session commits `files`, writes and checks its report, and opens its pull request, which
// pushes its branch to the host first; the reviewer's signed CLEAN review of the head is recorded.
async function buildAndOpen(world, s, files) {
  writeFiles(s.worktree, files);
  await g(s.worktree, 'add', '-A');
  await g(s.worktree, 'commit', '-q', '-m', `Build ${s.work}`);
  const head = await g(s.worktree, 'rev-parse', 'HEAD');
  writeFiles(s.worktree, { '.wheelhouse/feature/report.md': reportText(s.work) });
  const checked = await session(world, s, ['report']);
  assert.equal(checked.code, 0, checked.err);
  const opened = await session(world, s, ['open-pr', '--title', `Build ${s.work}`]);
  assert.equal(opened.code, 0, opened.err);
  const pr = Number(/^Opened pull request #(\d+)$/m.exec(opened.out)[1]);
  assert.equal(await g(world.remote.url, 'rev-parse', `refs/heads/feature/${s.work}`), head, 'open-pr pushed the branch');
  assert.equal((await statusHook(world, s)).phase, 'pr-open');
  world.tick();
  const reviewed = await world.client.state.record({
    project: P, event: makeEvent({ kind: 'review', data: { pr, commit: head, verdict: 'CLEAN' }, now: world.now }),
  });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  return { ...s, pr, head };
}

// Two pieces of quick work, each built with its pull request open, reviewed and CI green.
async function twoReady(world) {
  await watch(world); // the watcher's first look: what is in state already is not news
  const ready = [];
  for (const work of ['alpha', 'beta']) {
    await queueWork(world, work, { lane: 'quick' });
    const s = await startWork(world, work);
    const built = await buildAndOpen(world, s, { [`src/${work}.js`]: `export const ${work} = true;\n` });
    world.host.pass(built.head);
    ready.push(built);
  }
  return ready;
}

const mergeReady = (events) => events.filter((e) => e.type === 'merge-ready').map((e) => e.work).sort();

// --- Design section 10, and scenario 26 ---

test('a question goes from the feature file to state, a click answers it, and only that session wakes', async () => {
  await onComputer({}, async (world) => {
    await sandboxHolds(world);
    await watch(world);
    const sessions = {};
    for (const work of ['export', 'search']) {
      await queueWork(world, work);
      sessions[work] = await startWork(world, work);
    }
    const s = sessions.export;
    await watch(world); // the work and the starts are where things stand now

    // 1. The session writes the question, and pauses that feature.
    const asked = await session(world, s, [
      'ask', '--what', 'Export as CSV or as Excel?', '--why', 'It decides what users download',
      '--option', 'CSV=A CSV file', '--option', 'Excel=An Excel workbook', '--recommend', 'CSV', '--level', '3',
    ]);
    assert.equal(asked.code, 0, asked.err);
    const id = asked.out.trim();
    assert.equal(id, 'q-export-1');
    const waiting = await statusHook(world, s);
    assert.deepEqual([waiting.phase, waiting.waitingOn], ['waiting', 'question']);
    assert.deepEqual(await session(world, s, ['answer', id]), { code: 0, out: 'There is no answer yet.\n', err: '' });

    // 2. The watcher wakes the foreman, and no session; the foreman records the question in state.
    let woke = await watch(world);
    assert.deepEqual(woke.works, [], 'no session is woken for a question');
    assert.deepEqual(foremanEvents(woke).filter((e) => e.type === 'question').map((e) => [e.work, e.id]), [['export', id]]);
    assert.match(await foremanReads(world, woke.foreman[0]), new RegExp(`- question export: ${id}\\. Next: act question export ${id}`));
    const recorded = await foreman(world, ['question', 'export', id]);
    assert.equal(recorded.code, 0, recorded.err);
    assert.deepEqual(eventsOf('question').map((e) => [e.data.id, e.data.recommendation]), [[id, 'CSV']]);
    assert.equal((await viewsOf(world)).questions[id].answer, null, 'it waits on the director');

    // 3 and 4. The front desk asks on a card; the director's click is a signed record.
    const question = `${answerLine(id)}\nExport as CSV or as Excel? It decides what users download.`;
    await click(world, { question, options: ['CSV', 'Excel'], label: 'CSV' });
    const answers = eventsOf('action').filter((e) => e.data.action === 'answer');
    assert.equal(answers.length, 1);
    assert.equal(typeof answers[0].sig?.value, 'string', 'the answer is signed');
    assert.deepEqual((await viewsOf(world)).questions[id].answer?.label, 'CSV');

    // The watcher wakes that one session, never the other; the foreman hears it has nothing to do.
    woke = await watch(world);
    assert.deepEqual(woke.works, ['export']);
    assert.match(await foremanReads(world, woke.foreman[0]), new RegExp(`- answer export: ${id} answered "CSV"\\. Nothing to do: the watcher wakes its session\\.`));
    // The session reads its wake from its own folder, and the signed answer through the helper.
    const [{ file }] = woke.features;
    assert.ok(file.startsWith(featurePaths(s.worktree).dir + path.sep), 'the wake is copied into the worktree');
    const wake = await sandboxed(world, () => readWake(file));
    assert.deepEqual(wake.events.map((e) => [e.type, e.detail.questionId, e.detail.label]), [['answer', id, 'CSV']]);
    assert.deepEqual(await session(world, s, ['answer', id]), { code: 0, out: 'CSV\n', err: '' });
    const carryingOn = await statusHook(world, s);
    assert.deepEqual([carryingOn.phase, carryingOn.waitingOn], ['planning', null], 'the feature carries on');
  });
});

// scenario 26, its deterministic half
test('"make the export CSV" while the export builds: the click amends the brief and wakes that session only', async () => {
  await onComputer({}, async (world) => {
    await watch(world);
    const sessions = {};
    for (const work of ['export', 'search']) {
      await queueWork(world, work);
      sessions[work] = await startWork(world, work);
    }
    const s = sessions.export;
    await watch(world);
    const recordedBefore = briefHash(fs.readFileSync(featurePaths(s.worktree).brief, 'utf8'));

    // Route 3: the front desk writes the changed document, records the amendment, and asks.
    const change = 'Make the export CSV, not Excel';
    const amended = `# export\n\nWhat export builds, as a CSV file.\n`;
    writeFiles(world.checkout, { 'docs/work/export.md': amended });
    const hash = briefHash(amended);
    await frontDesk(world, 'amendment', { work: 'export', change, hash });
    await click(world, { question: `${amendLine('export', hash)}?\n${change}.`, options: ['Change it', 'Not now'], label: 'Change it' });
    assert.deepEqual(eventsOf('action').filter((e) => e.data.action === 'amend').map((e) => [e.data.work, e.data.hash]), [['export', hash]]);
    assert.equal((await viewsOf(world)).work.export.approval?.hash, hash, 'the approval carries over to the changed document');

    // The click wakes the foreman alone, which amends the brief.
    let woke = await watch(world);
    assert.deepEqual(woke.works, []);
    assert.deepEqual(foremanEvents(woke).filter((e) => e.type === 'amended').map((e) => [e.work, e.detail.hash]), [['export', hash]]);
    assert.match(await foremanReads(world, woke.foreman[0]), new RegExp(`- amended export: the director changed it \\(${hash.slice(0, 12)}\\)\\. Next: act amend export ${hash}`));
    const applied = await foreman(world, ['amend', 'export', hash]);
    assert.equal(applied.code, 0, applied.err);
    assert.match(applied.out, /Amended export's brief to version 2 .*its session is woken with brief-changed/);

    // The brief's change wakes that session only; the foreman's own record wakes no one.
    woke = await watch(world);
    assert.deepEqual(woke.works, ['export']);
    assert.deepEqual(woke.foreman, [], 'the foreman is not woken by its own amendment');
    const wake = await sandboxed(world, () => readWake(woke.features[0].file));
    assert.deepEqual(wake.events.map((e) => e.type), ['brief-changed']);
    // The session reads its amended brief: version 2, what changed after the override.
    const text = await sandboxed(world, () => fs.readFileSync(featurePaths(s.worktree).brief, 'utf8'));
    const { fields, body } = parseBrief(text);
    assert.equal(fields.version, 2);
    assert.match(body, /^\s*# The Wheelhouse override[\s\S]*\n# What changed\n\n- 19 October 2026 \(version 2\): Make the export CSV, not Excel\n/);
    assert.notEqual(briefHash(text), recordedBefore);
    assert.equal(wake.events[0].detail.hash, briefHash(text), 'the session reads the brief the foreman recorded');
    // The other feature's brief is untouched.
    assert.equal(parseBrief(fs.readFileSync(featurePaths(sessions.search.worktree).brief, 'utf8')).fields.version, 1);
  });
});

// --- Section 12: side by side, merging, incidents ---

const planFor = (work, files) => `# The ${work} plan\n\n### Task 1: Build it\n\n**Files:**\n${files.map((f) => `- Modify: \`${f}\``).join('\n')}\n\n- [ ] Step 1\n`;

// scenario 28
test('two features change the same hot file: the second waits with its plan ready', async () => {
  await onComputer({}, async (world) => {
    await watch(world);
    const sessions = {};
    for (const work of ['export', 'search']) {
      await queueWork(world, work);
      sessions[work] = await startWork(world, work);
    }
    await watch(world);

    // Each session writes its plan, both touching package.json, a hot file by default, and records it.
    const plan = async (s) => {
      writeFiles(s.worktree, { [`docs/plans/${s.work}.md`]: planFor(s.work, ['package.json', `src/${s.work}.js`]) });
      const recorded = await session(world, s, ['plan', `docs/plans/${s.work}.md`]);
      assert.equal(recorded.code, 0, recorded.err);
      assert.equal((await statusHook(world, s)).phase, 'ready-to-build');
    };

    // The first plan clears the clash check: the foreman lets it build, which wakes its session.
    await plan(sessions.export);
    let woke = await watch(world);
    assert.deepEqual(foremanEvents(woke).filter((e) => e.type === 'plan-ready').map((e) => e.work), ['export']);
    assert.match(await foremanReads(world, woke.foreman[0]), /- plan-ready export: plan docs\/plans\/export\.md, 2 files\. It clears the clash check and a slot is free\. Next: act plan-ready export/);
    const first = await foreman(world, ['plan-ready', 'export']);
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /export may build/);
    woke = await watch(world);
    assert.deepEqual(woke.works, ['export']);
    assert.deepEqual(readWake(woke.features[0].file).events.map((e) => e.type), ['build']);

    // The second touches the same hot file: it is recorded as planned, and waits.
    await plan(sessions.search);
    woke = await watch(world);
    assert.deepEqual(foremanEvents(woke).filter((e) => e.type === 'plan-ready').map((e) => e.work), ['search']);
    const hot = 'its plan touches package.json, which export is changing (a hot file)';
    assert.ok((await foremanReads(world, woke.foreman[0])).includes(`It waits: ${hot}. Next: act plan-ready search`));
    const second = await foreman(world, ['plan-ready', 'search']);
    assert.equal(second.code, 0, second.err);
    assert.ok(second.out.includes(`search waits: ${hot}.`), second.out);

    const { features } = await viewsOf(world);
    assert.equal(features.export.data.step, 'building');
    assert.equal(features.search.data.step, 'planned');
    assert.deepEqual(features.search.data.files, ['package.json', 'src/search.js']);
    // No go-ahead reaches the waiting session, and its plan stays ready for when one does.
    woke = await watch(world);
    assert.deepEqual(woke.works, []);
    assert.equal((await statusHook(world, sessions.search)).phase, 'ready-to-build');
  });
});

// scenario 29
test('feature A merges while B is ready: B is updated, tested again, and its review carries over', async () => {
  await onComputer({}, async (world) => {
    const [alpha, beta] = await twoReady(world);

    // Both are ready to merge: the watcher wakes the foreman for each.
    let woke = await watch(world);
    assert.deepEqual(mergeReady(foremanEvents(woke)), ['alpha', 'beta']);
    const read = await foremanReads(world, woke.foreman[0]);
    assert.match(read, new RegExp(`- merge-ready alpha: pull request #${alpha.pr} at ${alpha.head.slice(0, 12)}\\. Next: act merge alpha`));

    // A merges; the default branch moves to it.
    const merged = await foreman(world, ['merge', 'alpha']);
    assert.equal(merged.code, 0, merged.err);
    assert.match(merged.out, new RegExp(`Merged pull request #${alpha.pr} for alpha at ${alpha.head.slice(0, 12)}; its status reads done`));
    assert.deepEqual(world.host.merges, [{ number: alpha.pr, sha: alpha.head }]);

    // B is behind now: the gate brings it up to date with a clean merge, and waits for CI on it.
    const updating = await foreman(world, ['merge', 'beta']);
    assert.equal(updating.code, 0, updating.err);
    const updated = await g(world.remote.url, 'rev-parse', 'refs/heads/feature/beta');
    assert.notEqual(updated, beta.head);
    assert.match(updating.out, new RegExp(`Brought pull request #${beta.pr} for beta up to date at ${updated.slice(0, 12)}; the merge waits for CI on that commit`));
    assert.equal(await g(world.remote.url, 'rev-parse', `${updated}^@`), `${beta.head}\n${alpha.head}`);
    assert.deepEqual(world.host.merges.map((m) => m.number), [alpha.pr], 'nothing more merged');

    // Tested again: while CI runs on the new head, nothing is ready to merge.
    woke = await watch(world);
    const events = woke.foreman.flatMap((f) => readWake(f).events);
    assert.deepEqual(mergeReady(events), []);
    assert.deepEqual(events.filter((e) => e.type === 'report').map((e) => e.work), ['alpha'], 'A has ended');
    assert.deepEqual(woke.works, [], 'no session is asked to review again');

    // CI passes on it; the review of B's own commit still holds for it, so it is ready again.
    world.host.pass(updated);
    woke = await watch(world);
    const ready = foremanEvents(woke).filter((e) => e.type === 'merge-ready');
    assert.deepEqual(ready.map((e) => [e.work, e.detail.head]), [['beta', updated]]);
    const carried = await world.client.carried({ project: P, number: beta.pr });
    assert.deepEqual(carried, { ok: true, review: 'clean', upToDate: true, earlier: true });

    const done = await foreman(world, ['merge', 'beta']);
    assert.equal(done.code, 0, done.err);
    assert.deepEqual(world.host.merges, [{ number: alpha.pr, sha: alpha.head }, { number: beta.pr, sha: updated }]);
    // No review was asked for or recorded for the new head: B's own carried over.
    assert.deepEqual(eventsOf('review').map((e) => e.data.commit).sort(), [alpha.head, beta.head].sort());
  });
});

test('feature A merges while B is ready: B is updated, and B pushes a fix after the update', async () => {
  await onComputer({}, async (world) => {
    const [, beta] = await twoReady(world);
    await watch(world);
    const merged = await foreman(world, ['merge', 'alpha']);
    assert.equal(merged.code, 0, merged.err);
    // The gate brings B up to date on the host, as above.
    const updating = await foreman(world, ['merge', 'beta']);
    assert.equal(updating.code, 0, updating.err);
    const updated = await g(world.remote.url, 'rev-parse', 'refs/heads/feature/beta');
    assert.notEqual(updated, beta.head);

    // B's session commits a fix (its CI went red, or a reviewer found something) and pushes it.
    // The host's branch has moved on, so the push is turned down, in plain words.
    writeFiles(beta.worktree, { 'src/beta.js': 'export const beta = 2;\n' });
    await g(beta.worktree, 'add', '-A');
    await g(beta.worktree, 'commit', '-q', '-m', 'Fix beta');
    const fix = await g(beta.worktree, 'rev-parse', 'HEAD');
    const turnedDown = await session(world, beta, ['push']);
    assert.equal(turnedDown.code, 1);
    assert.equal(turnedDown.err, 'The branch was not pushed: the host\'s branch has moved on (the gate may have brought it up to date): run `cli.js pull`, then push again\n');
    assert.equal(await g(world.remote.url, 'rev-parse', 'refs/heads/feature/beta'), updated, 'nothing was pushed');

    // pull brings the update into B's branch: the helper merges it with the fix in its mirror,
    // and the session's own git brings that in.
    const pulled = await session(world, beta, ['pull']);
    assert.equal(pulled.code, 0, pulled.err);
    const head = await g(beta.worktree, 'rev-parse', 'HEAD');
    assert.equal(pulled.out, `Brought in the host's feature/beta: merged with this branch at ${head.slice(0, 12)}\n`);
    assert.equal(await g(beta.worktree, 'rev-parse', `${head}^@`), `${fix}\n${updated}`);
    assert.equal(await g(beta.worktree, 'status', '--porcelain'), '');

    // Then the push goes.
    const pushed = await session(world, beta, ['push']);
    assert.equal(pushed.code, 0, pushed.err);
    assert.equal(pushed.out, 'Pushed feature/beta\n');
    assert.equal(await g(world.remote.url, 'rev-parse', 'refs/heads/feature/beta'), head);
  });
});

// scenario 30
test('an incident while two PRs are ready: neither merges; the fix does; the click ends it', async () => {
  await onComputer({}, async (world) => {
    const [alpha, beta] = await twoReady(world);

    // Route 1: the front desk records the incident while both are ready.
    const incident = 'checkout-down';
    await frontDesk(world, 'incident', { id: incident, what: 'Checkout fails for every user' });
    let woke = await watch(world);
    let events = foremanEvents(woke);
    assert.deepEqual(events.filter((e) => e.type === 'incident').map((e) => e.detail.incident), [incident]);
    assert.deepEqual(mergeReady(events), ['alpha', 'beta']);
    let read = await foremanReads(world, woke.foreman[0]);
    assert.match(read, /Hold: incident checkout-down is open\./);
    assert.match(read, new RegExp(`- merge-ready alpha: pull request #${alpha.pr} at \\w+\\. It waits: incident checkout-down is open, and only an incident's fix merges`));

    // Neither merges: the foreman refuses, and so does the helper's gate if asked directly.
    for (const s of [alpha, beta]) {
      const refused = await foreman(world, ['merge', s.work]);
      assert.equal(refused.code, 1);
      assert.match(refused.err, new RegExp(`Pull request #${s.pr} for ${s.work} can't merge while incident checkout-down is open`));
      const gate = await world.client.merge({ project: P, number: s.pr, stop: false, bypass: false });
      assert.deepEqual(gate.reasons, ['incident checkout-down is open, so only its fix may merge']);
    }
    assert.deepEqual(world.host.merges, []);

    // The fix is bug work, which starts during an incident; its pull request opens.
    await queueWork(world, 'fix-checkout', { lane: 'bug' });
    woke = await watch(world);
    assert.match(await foremanReads(world, woke.foreman[0]), /- start fix-checkout \(bug\): approved\. Next: act start fix-checkout/);
    const fixing = await startWork(world, 'fix-checkout');
    const fix = await buildAndOpen(world, fixing, { 'src/app.js': 'export const app = 2;\n' });
    world.host.pass(fix.head);

    // The director's click names it the incident's fix; it, and only it, merges.
    await click(world, { question: `${incidentFixLine(incident, fix.pr)}?`, options: ['Merge the fix', 'Not now'], label: 'Merge the fix' });
    woke = await watch(world);
    events = foremanEvents(woke);
    assert.deepEqual(events.filter((e) => e.type === 'incident-fix').map((e) => e.detail.pr), [fix.pr]);
    assert.deepEqual(mergeReady(events), ['fix-checkout']);
    read = await foremanReads(world, woke.foreman[0]);
    assert.match(read, /- merge-ready fix-checkout: pull request #3 at \w+\. Next: act merge fix-checkout/);
    assert.match(read, /- merge alpha: pull request #1 is ready to merge, but waits: incident checkout-down is open/);
    const merged = await foreman(world, ['merge', 'fix-checkout']);
    assert.equal(merged.code, 0, merged.err);
    assert.deepEqual(world.host.merges, [{ number: fix.pr, sha: fix.head }]);
    assert.equal((await foreman(world, ['merge', 'alpha'])).code, 1, 'the others still wait');

    // The director's click ends it: the ready pull requests are offered again and the gate lets them on.
    await click(world, { question: `${liftIncidentLine(incident)}?`, options: ['End it', 'Not now'], label: 'End it' });
    assert.deepEqual((await viewsOf(world)).incidents.open, []);
    woke = await watch(world);
    assert.deepEqual(foremanEvents(woke).filter((e) => e.type === 'lift-incident').map((e) => e.detail.incident), [incident]);
    read = await foremanReads(world, woke.foreman[0]);
    assert.doesNotMatch(read, /Hold:/);
    assert.match(read, new RegExp(`- merge alpha: pull request #${alpha.pr} at ${alpha.head.slice(0, 12)} is ready to merge\\. Next: act merge alpha`));
    assert.match(read, new RegExp(`- merge beta: pull request #${beta.pr} at ${beta.head.slice(0, 12)} is ready to merge\\. Next: act merge beta`));
    // The fix moved the default branch, so A is brought up to date first, as any merge is.
    const going = await foreman(world, ['merge', 'alpha']);
    assert.equal(going.code, 0, going.err);
    assert.match(going.out, new RegExp(`Brought pull request #${alpha.pr} for alpha up to date`));
    const gate = await world.client.merge({ project: P, number: beta.pr, stop: false, bypass: false });
    assert.deepEqual(gate.reasons, ['the branch is not up to date with the default branch'], 'no incident holds it');
  });
});

// --- Lineage ---

// A transcript of a session on a Claude Code at or above the floor, with a made-up model.
function transcript(world) {
  const file = path.join(tempFolder('wh-transcript-'), 'session.jsonl');
  const entries = [
    { type: 'user', version: '2.1.302', message: { content: 'go' } },
    { type: 'assistant', version: '2.1.302', message: { model: 'model-a', content: [] } },
  ];
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'));
  return file;
}

// The session start in the feature's worktree, as Claude Code runs it: its added context.
async function sessionStarts(world, s, { root, claudeHome }) {
  world.tick();
  const said = await sessionStart(
    { cwd: s.worktree, session_id: s.sessionId, transcript_path: s.transcript, hook_event_name: 'SessionStart' },
    {
      client: world.client, dir: NO_MANAGED, now: world.now, background: async () => ({}), spawn: () => ({ on() {}, unref() {} }),
      lineageRoot: root, claudeHome,
    },
  );
  return said?.hookSpecificOutput?.additionalContext ?? '';
}

const holdOf = (world, s, call) => lineageHold({ session_id: s.sessionId, cwd: s.worktree, permission_mode: 'acceptEdits', hook_event_name: 'PreToolUse', ...call }, { dir: NO_MANAGED });

// The lineage check the hold lets through, run in the sandbox: its exit code and what it said.
async function checkCommand(world, s) {
  let out = '';
  const code = await sandboxed(world, () => lineageCheck([], {
    cwd: s.worktree, root: world.lineage.root, claudeHome: world.lineage.claudeHome, write: (t) => { out += t; },
  }));
  return { code, out };
}

// scenario 31
test('an installed Superpowers file differs: a warning, a hold, and the gate refuses the PR', async () => {
  await onComputer({ lineage: true }, async (world) => {
    const { root, claudeHome } = world.lineage;
    await watch(world);
    await queueWork(world, 'export', { lane: 'quick' });
    const s = { ...(await startWork(world, 'export', { provenance: false })), transcript: transcript(world) };

    // A Superpowers file installed for the project differs from the manifest.
    world.lineage.put({ 'skills/brainstorming/SKILL.md': 'brainstorm, changed by hand\n' });

    // At session start, a warning in the session's context, and the hold.
    const warned = await sessionStarts(world, s, { root, claudeHome });
    const warning = "Lineage: the installed superpowers files differ from Wheelhouse's manifest (skills/brainstorming). "
      + 'Edits and commands are held until a session starts with matching files. Raise this with the director as a card.';
    assert.ok(warned.split('\n').includes(warning), warned);
    assert.equal(isHeld(P), true);
    // The front desk's card is made from the one plain lineage-hold event the start recorded through the helper.
    let holds = eventsOf('lineage-hold');
    assert.equal(holds.length, 1);
    assert.deepEqual(holds[0].data, { at: holds[0].data.at, mismatches: [{ upstream: 'superpowers', path: 'skills/brainstorming' }] });
    assert.equal(holds[0].sig, undefined, 'a plain event');

    // Held: edits and commands are refused; reading, and the check command, are not.
    const deny = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: HELD } };
    assert.deepEqual(await holdOf(world, s, { tool_name: 'Edit', tool_input: { file_path: path.join(s.worktree, 'src', 'app.js') } }), deny);
    assert.deepEqual(await holdOf(world, s, { tool_name: 'Bash', tool_input: { command: `node "${CLI}" open-pr --title "Build export"` } }), deny);
    assert.equal(await holdOf(world, s, { tool_name: 'Read', tool_input: { file_path: path.join(s.worktree, 'src', 'app.js') } }), undefined);
    assert.equal(await holdOf(world, s, { tool_name: 'Bash', tool_input: { command: `node "${CHECK}"` } }), undefined);
    const checked = await checkCommand(world, s);
    assert.equal(checked.code, 1);
    assert.match(checked.out, /still differ from Wheelhouse's manifest, so edits and commands stay held\..*\n- superpowers: skills\/brainstorming\n$/);

    // A second start with the same files warns again, and records nothing more.
    assert.ok((await sessionStarts(world, s, { root, claudeHome })).includes(warning));
    assert.equal(eventsOf('lineage-hold').length, 1);

    // The gate is the backstop: a pull request this session opens (as one past the hold would,
    // on a Claude Code where a failing guard lets the call through) says what built it, and is refused.
    const built = await buildAndOpen(world, s, { 'src/export.js': 'export const csv = true;\n' });
    world.host.pass(built.head);
    const body = world.host.prs.get(built.pr).body;
    assert.match(body, /- Fingerprints: mismatch/);
    assert.match(body, /- Models: model-a/);
    assert.match(fs.readFileSync(featurePaths(s.worktree).report, 'utf8'), /- Fingerprints: mismatch/, 'the report says the same');
    const why = "the pull request's provenance does not match the manifest: the fingerprints did not match";
    const gate = await world.client.merge({ project: P, number: built.pr, stop: false, bypass: false });
    assert.deepEqual(gate.reasons, [why]);
    const refused = await foreman(world, ['merge', 'export']);
    assert.equal(refused.code, 1);
    assert.ok(refused.err.includes(why), refused.err);
    assert.deepEqual(world.host.merges, []);

    // The files are put back. The check says so but changes nothing: the hold lifts only at a start.
    world.lineage.restore();
    assert.deepEqual(await checkCommand(world, s), { code: 0, out: `${MATCHED}\n` });
    assert.equal(isHeld(P), true);
    assert.deepEqual(await holdOf(world, s, { tool_name: 'Edit', tool_input: { file_path: path.join(s.worktree, 'src', 'app.js') } }), deny);
    const clean = await sessionStarts(world, s, { root, claudeHome });
    assert.doesNotMatch(clean, /Lineage:/);
    assert.equal(fs.existsSync(holdFile(P)), false);
    assert.equal(await holdOf(world, s, { tool_name: 'Edit', tool_input: { file_path: path.join(s.worktree, 'src', 'app.js') } }), undefined);
    holds = eventsOf('lineage-hold');
    assert.equal(holds.length, 1, 'a lifted hold records nothing');
  });
});

// A made-up Wheelhouse repository on `main`: a manifest pinning one upstream at OLD, a register
// whose override is anchored on a sentence of that upstream, the marketplace's pins and the
// manifest script's own pin text, as scripts/lineage/upgrade.js lands them.
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const KIT = {
  name: 'superpowers', plugin: 'superpowers', repo: 'https://example.invalid/superpowers.git', ref: 'v1.0.0', sha: OLD,
  folders: ['skills/brainstorming', 'skills/writing-plans'], files: ['LICENSE'],
};
const ANCHOR = 'link it for your human partner';
const COPY = {
  'skills/brainstorming/SKILL.md': 'Ask one question at a time.\n',
  'skills/writing-plans/SKILL.md': `Plans are small.\n${ANCHOR}\n`,
  'skills/writing-plans/notes.md': 'carried line\n',
  LICENSE: 'Licence text\n',
};

async function wheelhouseRepo(checkout) {
  const pristine = tempFolder('wh-pristine-');
  writeFiles(pristine, COPY);
  const root = tempFolder('wh-repo-');
  writeFiles(root, {
    'lineage/manifest.json': `${JSON.stringify(buildManifest({ roots: { superpowers: pristine }, version: '1.2.3', upstreams: [KIT] }), null, 2)}\n`,
    'lineage/register.json': `${JSON.stringify({
      v: 1,
      version: '0.4.2',
      overrides: [{
        id: 'nothing-waits', upstream: 'superpowers', skill: 'writing-plans', rule: 'Nothing waits for a person.', why: 'Nobody is in the chat.', scenario: 32,
        anchors: [{ file: 'skills/writing-plans/SKILL.md', text: ANCHOR }],
      }],
      carried: [{
        id: 'carried-line', upstream: 'superpowers', file: 'skills/writing-plans/notes.md', text: 'carried line',
        hash: fingerprintFile(path.join(pristine, 'skills', 'writing-plans', 'notes.md')).hash,
      }],
      assumptions: [],
    }, null, 2)}\n`,
    '.claude-plugin/plugin.json': `${JSON.stringify({ name: 'wheelhouse', version: '1.2.3' })}\n`,
    '.claude-plugin/marketplace.json': `${JSON.stringify({
      name: 'wheelhouse',
      plugins: [
        { name: 'wheelhouse', source: './' },
        { name: 'superpowers', source: { source: 'url', url: KIT.repo, ref: KIT.ref, sha: OLD } },
      ],
    }, null, 2)}\n`,
    'scripts/lineage/manifest.js': fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'lineage', 'manifest.js'), 'utf8'),
  });
  await g(root, 'init', '-q', '-b', 'main');
  await g(root, 'add', '-A');
  await g(root, 'commit', '-q', '-m', 'The release');
  // Claude Code's record of installs: the pinned copy, installed for the project.
  const installed = tempFolder('wh-installed-');
  writeFiles(installed, COPY);
  const claudeHome = tempFolder('wh-claude-');
  writeFiles(claudeHome, {
    'plugins/installed_plugins.json': JSON.stringify({
      version: 2,
      plugins: { 'superpowers@wheelhouse': [{ scope: 'project', projectPath: checkout, installPath: installed, version: '1.0.0', gitCommitSha: OLD }] },
    }),
  });
  return { root, claudeHome };
}

// scenario 32
test('an upgrade whose anchor has gone stops before landing', async () => {
  await onComputer({}, async (world) => {
    const { root, claudeHome } = await wheelhouseRepo(world.checkout);
    const head = await g(root, 'rev-parse', 'HEAD');
    const pins = [{ name: 'superpowers', plugin: 'superpowers', repo: KIT.repo, ref: 'v1.1.0', sha: NEW }];
    // The new release rewrote the sentence the override is anchored on.
    const release = { ...COPY, 'skills/writing-plans/SKILL.md': 'Plans are small.\nshow it to the user\n' };
    const fetchTo = async (_pin, dir) => { writeFiles(dir, release); };

    // The stop, and its plain reason, for the director's card.
    const plan = await planFromPins({ root, pins, fetchTo });
    assert.equal(plan.kind, 'stopped');
    assert.deepEqual(plan.broken, [{ id: 'nothing-waits', file: 'skills/writing-plans/SKILL.md', text: ANCHOR }]);
    const reason = describePlan({ plan, pins });
    assert.ok(reason.includes(`anchor gone: nothing-waits: skills/writing-plans/SKILL.md: ${ANCHOR}`), reason.join('\n'));
    assert.equal(reason.at(-1), 'upgrade stopped: an override or carried text breaks; rewrite or drop it before the upgrade goes on');

    // It stops before landing: no branch, no commit, the pins as they were.
    await assert.rejects(land({ root, pins, fetchTo }), {
      message: `the upgrade is stopped, so nothing lands: anchor gone: nothing-waits: skills/writing-plans/SKILL.md: ${ANCHOR}. Rewrite or drop the broken override first`,
    });
    assert.equal(await g(root, 'rev-parse', 'HEAD'), head);
    assert.equal(await g(root, 'branch', '--list', 'upgrade/*'), '');
    assert.equal(await g(root, 'status', '--porcelain'), '');
    const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.equal(marketplace.plugins.find((p) => p.name === 'superpowers').source.sha, OLD);

    // Nothing landed, so a project's sessions still start on files matching the manifest: no hold.
    await queueWork(world, 'export', { lane: 'quick' });
    const s = { ...(await startWork(world, 'export', { provenance: false })), transcript: transcript(world) };
    const said = await sessionStarts(world, s, { root, claudeHome });
    assert.doesNotMatch(said, /Lineage:/);
    assert.equal(isHeld(P), false);
    assert.deepEqual(eventsOf('lineage-hold'), []);
  });
});
