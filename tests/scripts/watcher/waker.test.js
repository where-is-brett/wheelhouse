// tests/scripts/watcher/waker.test.js
// Waking the foreman or a feature session (build-loop design, section 11;
// check 27). Every `claude` here is a stand-in: `run` records the call. The
// one real process started is `node -e`, to try spawnDetached and pidAlive.
import { FOREGROUND_ONLY } from '../../../scripts/lib/claude.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  makeWaker, writeWake, readWake, wakesDir, sessionModeOf, featureModeOf, sessionEnv, spawnDetached, pidAlive, processStartTime, makeStartTimes,
  outboxFile, runningFile, sessionFile, grantsUsedFile, watcherDir, PROMPTS, MAX_RUN_MS, STARTING_MS, windowsBuildsOf,
} from '../../../scripts/watcher/waker.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { PLUGIN_ROOT, foremanCommands } from '../../../scripts/foreman/tools.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import { BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS, settingKey } from '../../../scripts/protection/windows-builds.js';
import { confirmationFor, dataHash, eventPath, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { stateDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { guardedCommand, selfTestFile } from '../../../scripts/windows/low.js';
import { readBaseline, writeBaseline } from '../../../scripts/watcher/control-files.js';

const unix = process.platform !== 'win32';
const P = 'o__p';
const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const MIN = 60 * 1000;
const SESSION = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
const OTHER_SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED = ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)'];
// A flat routing table with no pins runs at Balanced: its models as written, Balanced's efforts.
const FLAT_COLUMN = [
  'The models and efforts for the subagents you dispatch this wake (Thoroughness: Balanced):',
  'builder: model model-b, effort medium',
  "mechanical: model the session's own, effort medium",
  "builderCritical: model the session's own, effort high",
  "reviewer: model the session's own, effort high",
  "reviewerCritical: model the session's own, effort high",
  "tester: model the session's own, effort medium",
];
const withColumn = (prompt, column = FLAT_COLUMN) => [prompt, '', ...column].join('\n');

const config = (over = {}) => readConfig(JSON.stringify({
  v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [],
  routing: { foreman: 'model-a', builder: 'model-b' },
  ...over,
}));

// The project's main checkout, a git folder of its own (for info/exclude).
function checkout() {
  const found = readProject(P);
  if (found) return found.folder;
  const main = tempFolder('wh-main-');
  fs.mkdirSync(path.join(main, '.git', 'info'), { recursive: true });
  writeProject(P, {
    folder: main, remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
  });
  return main;
}

// A feature worktree in the checkout's .claude/worktrees/, with a brief; `session` goes in the
// session's own session.json, which the waker must never trust.
function worktree({ session = null } = {}) {
  const parent = path.join(checkout(), '.claude', 'worktrees');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'wt-'));
  const p = featurePaths(dir);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.brief, 'The brief.\n');
  if (session !== null) fs.writeFileSync(p.session, `${JSON.stringify({ sessionId: session })}\n`);
  return dir;
}

// The session id the watcher would have kept when it started the feature, and the record of the
// worktree's agent files the foreman's start keeps when it makes the worktree (without it, the
// feature's wakes wait: control-files.test.js).
function keepSession(work, dir, sessionId = SESSION) {
  fs.mkdirSync(path.dirname(sessionFile(P, work)), { recursive: true });
  fs.writeFileSync(sessionFile(P, work), JSON.stringify({ sessionId, worktree: dir, at: new Date(T0).toISOString() }));
  writeBaseline(P, work, dir);
}

// A stand-in for starting a process: keeps each call; each process lives until
// `end(pid, code)`, which also settles its exit code when `exits` is on.
function fakeRun({ exits = false } = {}) {
  const calls = [];
  const live = new Set();
  const settle = new Map();
  let next = 100;
  const run = (file, args, options) => {
    const pid = next;
    next += 1;
    calls.push({ file, args, ...options, pid });
    live.add(pid);
    if (!exits) return { pid };
    return { pid, exited: new Promise((resolve) => { settle.set(pid, resolve); }) };
  };
  const end = (pid, code = 0) => {
    live.delete(pid);
    settle.get(pid)?.(code);
  };
  return { run, calls, live, alive: (pid) => live.has(pid), end };
}

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const bundle = (id, over = {}) => ({ to: 'foreman', events: [{ type: 'incident', id, detail: {} }], digest: [], dropped: 0, ...over });
const featureBundle = (work, id = 'x') => ({ to: 'feature', work, events: [{ type: 'ci-red', id }], digest: [], dropped: 0 });

// The record a prompt's copy was made from: same name, in the watcher's own folder.
const recordOf = (copy) => path.join(wakesDir(P), path.basename(copy));
// The file a foreman prompt names: after its lead, before its first command.
const fileIn = (prompt, lead) => prompt.slice(lead.length).replace(/\. First run: [\s\S]*$/, '');
// The foreman's prompt for `copy`, as the waker gives it with this plugin's own wake command.
const foremanPrompt = (copy) => PROMPTS.foreman(copy, foremanCommands(PLUGIN_ROOT).wake);
const foremanCopies = () => path.join(checkout(), '.wheelhouse', 'foreman', 'wakes');

function waker(fake, over = {}) {
  let t = T0;
  const clock = { now: () => new Date(t), move: (ms) => { t += ms; } };
  const w = makeWaker({
    shape: 1,
    project: P,
    config: config(),
    run: fake.run,
    alive: fake.alive,
    startTimeOf: async () => null,
    now: clock.now,
    bootedAt: () => 0,
    claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: '/bin', WHEELHOUSE_ROLE: 'foreman' },
    print: () => { throw new Error('Shape 1 prints nothing'); },
    ...over,
  });
  w.clock = clock;
  // A start comes straight after the foreman's start made the worktree and recorded its agent
  // files, which the waker now checks before a start too (ruling P7-33): kept here when missing.
  const start = w.startFeature;
  w.startFeature = (args = {}) => {
    keepRecord(args);
    return start(args);
  };
  return w;
}

// The record of a worktree's agent files the foreman's start keeps, when there is none yet.
function keepRecord({ work, worktree: dir } = {}) {
  try {
    if (readBaseline(P, work, dir) === null) writeBaseline(P, work, dir);
  } catch { /* a start the waker refuses for its own reasons */ }
}

test('a foreman bundle starts one fresh foreman with the configured model and mode, told to read its own copy', () => withHome(async () => {
  const main = checkout();
  const fake = fakeRun();
  const w = waker(fake, { config: config({ sessionMode: 'plan' }) });
  const record = writeWake(P, bundle('e1'), { now: () => new Date(T0) });
  assert.equal(path.dirname(record), wakesDir(P));
  await w.wakeForeman(record);
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  const copy = path.join(main, '.wheelhouse', 'foreman', 'wakes', path.basename(record));
  assert.equal(call.file, 'claude');
  assert.deepEqual(call.args, ['-p', foremanPrompt(copy), '--permission-mode', 'plan', '--model', 'model-a', '--effort', 'medium']);
  // The prompt gives the first command whole, so the first step needs no skill and no ${CLAUDE_PLUGIN_ROOT}.
  assert.ok(call.args[1].startsWith(`Wheelhouse foreman: follow wheelhouse:foreman to handle ${copy}. First run: node '`), call.args[1]);
  assert.ok(call.args[1].includes(`${foremanCommands(PLUGIN_ROOT).wake} read `), call.args[1]);
  assert.equal(fs.readFileSync(copy, 'utf8'), fs.readFileSync(record, 'utf8'), 'the copy is the record');
  assert.match(fs.readFileSync(path.join(main, '.git', 'info', 'exclude'), 'utf8'), /^\.wheelhouse\/$/m, 'git-ignored through info/exclude');
  assert.equal(call.cwd, main);
  assert.equal(call.env.WHEELHOUSE_ROLE, 'foreman');
  assert.equal(call.env.PATH, '/bin');

  // With no model named, the command line's own default applies, named by its alias, so the front
  // desk's model in the main folder's local settings never reaches the foreman.
  const other = fakeRun();
  await waker(other, { config: config({ routing: {} }) }).wakeForeman(writeWake(P, bundle('e2')));
  assert.deepEqual(other.calls[0].args.slice(2), ['--permission-mode', 'acceptEdits', '--model', 'default', '--effort', 'medium']);
}));

test('the foreman\'s tools, when given, are passed with --allowedTools', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  await waker(fake, { foremanTools: ['Bash(node:*)', 'Read'] }).wakeForeman(writeWake(P, bundle('e1')));
  assert.deepEqual(fake.calls[0].args.slice(2), ['--permission-mode', 'acceptEdits', '--model', 'model-a', '--effort', 'medium', '--allowedTools', 'Bash(node:*)', 'Read']);
  assert.throws(() => waker(fake, { foremanTools: [''] }), /tool/);
  assert.throws(() => waker(fake, { foremanTools: 'Read' }), /tool/);
}));

test('a second bundle while a foreman runs waits for it', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const w = waker(fake);
  const first = writeWake(P, bundle('e1'));
  const second = writeWake(P, bundle('e2'));
  await w.wakeForeman(first);
  await w.wakeForeman(second);
  assert.equal(fake.calls.length, 1, 'one foreman at a time');
  assert.deepEqual(w.waiting().map((e) => [e.file, Boolean(e.flight)]), [[first, true], [second, false]]);
  await w.pump();
  assert.equal(fake.calls.length, 1, 'still running');

  // A new waker (a restarted watcher) still sees the foreman running.
  const again = waker(fake);
  await again.pump();
  assert.equal(fake.calls.length, 1, 'the running foreman is known across restarts');

  fake.end(fake.calls[0].pid);
  await again.pump();
  // The restarted watcher never learnt the first one's exit code, so its wake goes again, with the second, as one.
  assert.equal(fake.calls.length, 2);
  const merged = recordOf(fileIn(fake.calls[1].args[1], PROMPTS.foreman('')));
  assert.deepEqual(readWake(merged).merged, [first, second]);
  assert.deepEqual(readWake(merged).events.map((e) => e.id), ['e1', 'e2']);
}));

test('several waiting wakes go as one, each event once, read only from the records', () => withHome(async () => {
  checkout();
  const fake = fakeRun({ exits: true });
  const w = waker(fake);
  await w.wakeForeman(writeWake(P, bundle('e0')));
  const third = writeWake(P, bundle('e3', { digest: [{ type: 'progress', id: 'p1' }] }));
  const fourth = writeWake(P, bundle('e4', { events: [{ type: 'incident', id: 'e3' }, { type: 'stuck', id: 'e4' }], digest: [{ type: 'progress', id: 'p2' }], dropped: 2 }));
  await w.wakeForeman(third);
  await w.wakeForeman(fourth);
  // A copy the foreman could write is never read back.
  fs.mkdirSync(foremanCopies(), { recursive: true });
  fs.writeFileSync(path.join(foremanCopies(), path.basename(third)), JSON.stringify({ v: 1, to: 'foreman', events: [{ id: 'planted' }] }));
  fake.end(fake.calls[0].pid, 0);
  await flush();
  assert.equal(fake.calls.length, 2, 'the exit started the next foreman, with no pump called');
  const merged = recordOf(fileIn(fake.calls[1].args[1], PROMPTS.foreman('')));
  const wake = readWake(merged);
  assert.deepEqual(wake.events.map((e) => e.id), ['e3', 'e4']);
  assert.deepEqual(wake.digest.map((e) => e.id), ['p1', 'p2']);
  assert.equal(wake.dropped, 2);
  assert.deepEqual(wake.merged, [third, fourth]);
  assert.deepEqual(w.waiting().map((e) => e.file), [merged], 'the merged record takes their place');
}));

test('a wake leaves the outbox only when its session exits with 0', () => withHome(async () => {
  checkout();
  const fake = fakeRun({ exits: true });
  const w = waker(fake);
  await w.wakeForeman(writeWake(P, bundle('e1')));
  assert.equal(w.waiting().length, 1, 'kept while in flight');
  fake.end(fake.calls[0].pid, 0);
  await flush();
  assert.deepEqual(w.waiting(), []);
  assert.equal(fs.existsSync(runningFile(P, 'foreman')), false);
}));

test('a session that exits with an error puts its wake back, waiting 1, 5, then 15 minutes, and is reported from the third', () => withHome(async () => {
  checkout();
  const fake = fakeRun({ exits: true });
  const errors = [];
  const w = waker(fake, { onError: (m) => errors.push(m) });
  await w.wakeForeman(writeWake(P, bundle('e1')));
  const waits = [MIN, 5 * MIN, 15 * MIN, 15 * MIN];
  for (const [i, wait] of waits.entries()) {
    fake.end(fake.calls.at(-1).pid, 1);
    await flush();
    const [entry] = w.waiting();
    assert.equal(entry.failures, i + 1);
    assert.equal(entry.flight, null);
    assert.equal(Date.parse(entry.retryAt) - w.clock.now().getTime(), wait);
    assert.match(entry.lastError, /exited with code 1/);
    assert.equal(errors.length, Math.max(0, i + 1 - 2), 'reported from the third failure');
    await w.pump();
    assert.equal(fake.calls.length, i + 1, 'not before its wait');
    w.clock.move(wait);
    await w.pump();
    assert.equal(fake.calls.length, i + 2, 'sent again after it');
  }
  assert.match(errors.at(-1), /failed 4 times/);
}));

test('a process that cannot be started leaves its wake waiting', () => withHome(async () => {
  checkout();
  let fail = true;
  const fake = fakeRun();
  const w = waker(fake, { run: (...a) => { if (fail) throw new Error('no claude'); return fake.run(...a); } });
  await w.wakeForeman(writeWake(P, bundle('e1')));
  assert.equal(w.waiting().length, 1);
  assert.equal(w.waiting()[0].failures, 1);
  assert.equal(fs.existsSync(runningFile(P, 'foreman')), false, 'the starting record goes when the start fails');
  fail = false;
  w.clock.move(MIN);
  await w.pump();
  assert.equal(fake.calls.length, 1);
  assert.equal(w.waiting()[0].flight !== null, true);
}));

test('a foreman that runs past its time, or whose pid is now another process, no longer blocks wakes', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const errors = [];
  const w = waker(fake, { onError: (m) => errors.push(m) });
  await w.wakeForeman(writeWake(P, bundle('e1')));
  await w.wakeForeman(writeWake(P, bundle('e2')));
  w.clock.move(MAX_RUN_MS.foreman - 1);
  await w.pump();
  assert.equal(fake.calls.length, 1, 'within its time');
  w.clock.move(1);
  await w.pump();
  assert.equal(fake.calls.length, 2, 'past it');
  assert.match(errors[0], /foreman session ran past its 60 minutes/);

  // A recorded start time that is not the running process's: the pid was reused.
  let started = 'Mon Oct 19 09:00:00 2026';
  const reused = fakeRun();
  const r = waker(reused, { startTimeOf: async () => started });
  await r.wakeForeman(writeWake(P, bundle('e3')));
  fs.rmSync(runningFile(P, 'foreman'));
  await r.wakeForeman(writeWake(P, bundle('e4')));
  const recorded = JSON.parse(fs.readFileSync(runningFile(P, 'foreman'), 'utf8'));
  assert.equal(recorded.startTime, started);
  await r.wakeForeman(writeWake(P, bundle('e5')));
  const count = reused.calls.length;
  started = 'Tue Oct 20 10:00:00 2026';
  await r.pump();
  assert.equal(reused.calls.length, count + 1);
}));

test('a starting record, left by a stop mid-start, holds for 2 minutes, then its wake goes again', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const w = waker(fake);
  const left = writeWake(P, bundle('e0'));
  fs.mkdirSync(path.dirname(runningFile(P, 'foreman')), { recursive: true });
  fs.writeFileSync(runningFile(P, 'foreman'), JSON.stringify({ state: 'starting', at: new Date(T0).toISOString(), entries: ['left'] }));
  fs.writeFileSync(outboxFile(P), JSON.stringify({ entries: [{ id: 'left', to: 'foreman', file: left, failures: 0, retryAt: null, flight: { at: new Date(T0).toISOString() } }] }));
  await w.wakeForeman(writeWake(P, bundle('e1')));
  assert.equal(fake.calls.length, 0);
  w.clock.move(STARTING_MS - 1);
  await w.pump();
  assert.equal(fake.calls.length, 0, 'within its 2 minutes');
  w.clock.move(1);
  await w.pump();
  assert.equal(fake.calls.length, 1, 'not held for the foreman\'s whole hour');
  const merged = recordOf(fileIn(fake.calls[0].args[1], PROMPTS.foreman('')));
  assert.deepEqual(readWake(merged).events.map((e) => e.id), ['e0', 'e1'], 'the left wake goes again, with the new one');
  assert.equal(w.waiting()[0].failures, 0, 'no failure counted');
}));

test('a merged wake that fails counts its first failure and waits', () => withHome(async () => {
  const main = checkout();
  const fake = fakeRun();
  const w = waker(fake);
  setStop({ by: 'prompt' });
  await w.wakeForeman(writeWake(P, bundle('e1')));
  await w.wakeForeman(writeWake(P, bundle('e2')));
  liftStop();
  fs.rmSync(path.join(main, '.git'), { recursive: true }); // the copy can't be made: no git folder for info/exclude
  await w.pump();
  assert.equal(fake.calls.length, 0);
  const [entry] = w.waiting();
  assert.equal(w.waiting().length, 1, 'the two are one entry now');
  assert.equal(entry.failures, 1);
  assert.equal(Date.parse(entry.retryAt) - T0, MIN);
  await w.pump();
  assert.equal(fake.calls.length, 0, 'it waits');
}));

test('a wakes folder swapped for a link between the check and the copy: the copy is removed and the wake not delivered', { skip: !unix }, () => withHome(async () => {
  const main = checkout();
  const elsewhere = tempFolder('wh-elsewhere-');
  const fake = fakeRun();
  let swaps = 0;
  const swap = (dir) => {
    swaps += 1;
    fs.renameSync(dir, `${dir}-moved`);
    fs.symlinkSync(elsewhere, dir);
  };
  const w = waker(fake, { beforeCopy: swap });
  await w.wakeForeman(writeWake(P, bundle('e1')));
  assert.equal(swaps, 1);
  assert.equal(fake.calls.length, 0, 'no foreman told to read it');
  assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing left through the link');
  assert.match(w.waiting()[0].lastError, /isn't a real folder where it should be/);
  assert.deepEqual(fs.readdirSync(path.join(path.dirname(wakesDir(P)), 'copies')), [], 'the temporary file went too');

  // A feature's folder, the same way.
  const dir = worktree();
  keepSession('login-page', dir);
  const f = waker(fake, { locate: () => dir, beforeCopy: swap });
  await f.wakeFeature('login-page', writeWake(P, featureBundle('login-page')));
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  assert.ok(fs.existsSync(main));
}));

test('a copy never replaces a link left in its place', { skip: !unix }, () => withHome(async () => {
  checkout();
  const elsewhere = tempFolder('wh-elsewhere-');
  const fake = fakeRun();
  const record = writeWake(P, bundle('e1'));
  fs.mkdirSync(foremanCopies(), { recursive: true });
  fs.symlinkSync(path.join(elsewhere, 'target.json'), path.join(foremanCopies(), path.basename(record)));
  await waker(fake).wakeForeman(record);
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
}));

test('a foreman recorded before the computer last started is not running', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  await waker(fake).wakeForeman(writeWake(P, bundle('e1')));
  await waker(fake, { bootedAt: () => T0 + 1 }).wakeForeman(writeWake(P, bundle('e2')));
  assert.equal(fake.calls.length, 2, 'a pid from before the start may be another process now');
}));

test('a feature bundle wakes only that feature\'s session, by the id the watcher kept', () => withHome(async () => {
  checkout();
  const login = worktree({ session: OTHER_SESSION }); // the session's own file names another id
  const search = worktree();
  keepSession('login-page', login, SESSION);
  keepSession('search-box', search, OTHER_SESSION);
  const fake = fakeRun();
  const where = { 'login-page': login, 'search-box': search };
  const w = waker(fake, { locate: (work) => where[work] ?? null, config: config({ sessionMode: 'dontAsk' }), platform: 'darwin' });
  const record = writeWake(P, featureBundle('login-page', 'ci-red:login-page:abc'));
  await w.wakeFeature('login-page', record);
  assert.equal(fake.calls.length, 1, 'no foreman, no other feature');
  const [call] = fake.calls;
  const copy = path.join(featurePaths(login).dir, 'wakes', path.basename(record));
  assert.equal(call.cwd, login);
  assert.deepEqual(call.args, [
    '-p', withColumn(`Wheelhouse: read ${copy}`), '--resume', SESSION,
    '--permission-mode', 'dontAsk', '--model', 'model-b', '--effort', 'high', '--allowedTools', ...ALLOWED,
  ]);
  assert.equal(fs.readFileSync(copy, 'utf8'), fs.readFileSync(record, 'utf8'));
  assert.equal(Object.hasOwn(call.env, 'WHEELHOUSE_ROLE'), false, 'a feature session is not the foreman, whatever the watcher inherited');

  // A second wake while that session still runs waits for it; another feature does not.
  const again = writeWake(P, featureBundle('login-page', 'f1'));
  await w.wakeFeature('login-page', again);
  await w.wakeFeature('search-box', writeWake(P, featureBundle('search-box', 'c1')));
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].cwd, search);
  assert.equal(fake.calls[1].args[3], OTHER_SESSION);
}));

test('a feature wake waits while the watcher kept no session id, and is dropped once the feature is gone', () => withHome(async () => {
  checkout();
  const dir = worktree({ session: SESSION }); // session.json alone is never enough
  const fake = fakeRun();
  const errors = [];
  let where = dir;
  const w = waker(fake, { locate: () => where, onError: (m) => errors.push(m) });
  await w.wakeFeature('login-page', writeWake(P, featureBundle('login-page')));
  assert.equal(fake.calls.length, 0, 'no kept id');
  assert.match(errors[0], /not started by the watcher/);
  assert.equal(w.waiting().length, 1);

  for (const bad of ['--dangerously-skip-permissions', 'not-a-uuid', SESSION.toUpperCase()]) {
    keepSession('login-page', dir, bad);
    await w.pump();
    assert.equal(fake.calls.length, 0, bad);
  }
  assert.equal(errors.length, 1, 'reported once, not at every loop');
  keepSession('login-page', worktree(), SESSION); // kept for another worktree
  await w.pump();
  assert.equal(fake.calls.length, 0);

  keepSession('login-page', dir, SESSION);
  await w.pump();
  assert.equal(fake.calls.length, 1);

  where = null;
  await w.wakeFeature('login-page', writeWake(P, featureBundle('login-page', 'y')));
  fake.end(fake.calls[0].pid);
  await w.pump();
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(w.waiting(), [], 'a closed or missing feature\'s wake is dropped');
}));

test('a feature\'s wakes folder that is a link is refused, and nothing is written through it', { skip: !unix }, () => withHome(async () => {
  checkout();
  const dir = worktree();
  keepSession('login-page', dir);
  const elsewhere = tempFolder('wh-elsewhere-');
  fs.symlinkSync(elsewhere, path.join(featurePaths(dir).dir, 'wakes'));
  const fake = fakeRun();
  const w = waker(fake, { locate: () => dir });
  await w.wakeFeature('login-page', writeWake(P, featureBundle('login-page')));
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  assert.match(w.waiting()[0].lastError, /wakes folder/);
}));

test('startFeature starts a session with an id of the watcher\'s own, in the worktree, with the brief\'s prompt', () => withHome(async () => {
  checkout();
  const dir = worktree();
  writeBaseline(P, 'login-page', dir); // as the foreman's start keeps it
  const fake = fakeRun();
  const w = waker(fake, { platform: 'darwin' });
  const started = await w.startFeature({ work: 'login-page', worktree: dir, briefFile: featurePaths(dir).brief });
  assert.equal(started.pid, fake.calls[0].pid);
  assert.match(started.sessionId, UUID);
  const [call] = fake.calls;
  assert.equal(call.cwd, dir);
  assert.deepEqual(call.args, [
    '-p', withColumn('Read .wheelhouse/feature/brief.md and follow it.'), '--session-id', started.sessionId,
    '--permission-mode', 'acceptEdits', '--model', 'model-b', '--effort', 'high', '--allowedTools', ...ALLOWED,
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(sessionFile(P, 'login-page'), 'utf8')).sessionId, started.sessionId);
  assert.equal(PROMPTS.start, 'Read .wheelhouse/feature/brief.md and follow it.');
  assert.equal(Object.hasOwn(call.env, 'WHEELHOUSE_ROLE'), false);

  // Its wakes resume that id.
  fake.end(call.pid);
  const wake = waker(fake, { locate: () => dir });
  await wake.wakeFeature('login-page', writeWake(P, featureBundle('login-page')));
  assert.equal(fake.calls[1].args[3], started.sessionId);

  await assert.rejects(w.startFeature({ work: 'login-page', worktree: dir }), /already running/);
  await assert.rejects(w.startFeature({ work: 'other', worktree: dir, briefFile: path.join(dir, 'brief.md') }), /brief/);
  await assert.rejects(w.startFeature({ work: 'Bad Name', worktree: worktree() }), /work/);
  const outside = tempFolder('wh-outside-');
  fs.mkdirSync(featurePaths(outside).dir, { recursive: true });
  fs.writeFileSync(featurePaths(outside).brief, 'x');
  await assert.rejects(w.startFeature({ work: 'elsewhere', worktree: outside }), /worktree/);
  await assert.rejects(w.startFeature({ work: 'nowhere', worktree: 'relative/path' }), /worktree/);
  // In the checkout, but not strictly inside its .claude/worktrees/.
  const inCheckout = path.join(checkout(), 'src');
  fs.mkdirSync(featurePaths(inCheckout).dir, { recursive: true });
  fs.writeFileSync(featurePaths(inCheckout).brief, 'x');
  await assert.rejects(w.startFeature({ work: 'in-checkout', worktree: inCheckout }), /worktree/);
  const folder = path.join(checkout(), '.claude', 'worktrees');
  fs.mkdirSync(featurePaths(folder).dir, { recursive: true });
  fs.writeFileSync(featurePaths(folder).brief, 'x');
  await assert.rejects(w.startFeature({ work: 'the-folder', worktree: folder }), /worktree/);
  if (unix) {
    const link = path.join(checkout(), '.claude', 'worktrees', 'link');
    fs.symlinkSync(worktree(), link);
    await assert.rejects(w.startFeature({ work: 'linked', worktree: link }), /worktree/);
  }
  assert.equal(fake.calls.length, 2);
}));

test('a feature session whose start exits with an error is reported', () => withHome(async () => {
  checkout();
  const fake = fakeRun({ exits: true });
  const errors = [];
  const w = waker(fake, { onError: (m) => errors.push(m) });
  await w.startFeature({ work: 'login-page', worktree: worktree() });
  fake.end(fake.calls[0].pid, 2);
  await flush();
  assert.match(errors[0], /login-page session exited with code 2/);
}));

test('bypass mode is refused for every session, and auto mode for feature sessions', () => withHome(async () => {
  checkout();
  assert.throws(() => readConfig(JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], sessionMode: 'bypassPermissions' })), /configuration/);
  const bypass = { ...config(), sessionMode: 'bypassPermissions' };
  assert.throws(() => sessionModeOf(bypass), /bypass/i);
  assert.throws(() => sessionModeOf({ ...config(), sessionMode: 'anything' }), /mode/i);
  assert.equal(sessionModeOf({}), 'acceptEdits', 'none given: the explicit default');
  const fake = fakeRun();
  for (const shape of [1, 2]) assert.throws(() => waker(fake, { shape, config: bypass }), /bypass/i);
  const changed = config();
  const w = waker(fake, { config: changed });
  changed.sessionMode = 'bypassPermissions'; // changed after the waker was made
  await assert.rejects(w.startFeature({ work: 'login-page', worktree: worktree() }), /bypass/i);
  await assert.rejects(w.wakeFeature('login-page', writeWake(P, bundle('e1'))), /bypass/i);
  await assert.rejects(w.wakeForeman(writeWake(P, bundle('e2'))), /bypass/i);
  assert.equal(fake.calls.length, 0);

  // auto: the foreman may use it; a feature session never.
  const auto = config({ sessionMode: 'auto' });
  assert.equal(sessionModeOf(auto), 'auto');
  assert.throws(() => featureModeOf(auto), /auto/);
  const a = waker(fake, { config: auto });
  await a.wakeForeman(writeWake(P, bundle('e3')));
  assert.deepEqual(fake.calls[0].args.slice(2, 4), ['--permission-mode', 'auto']);
  await assert.rejects(a.startFeature({ work: 'login-page', worktree: worktree() }), /auto/);
  await assert.rejects(a.wakeFeature('login-page', writeWake(P, featureBundle('login-page'))), /auto/);
  assert.equal(fake.calls.length, 1);
}));

test('on Windows a feature session gets no build-command allow rules', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const w = waker(fake, { platform: 'win32' });
  await w.startFeature({ work: 'login-page', worktree: worktree() });
  assert.ok(!fake.calls[0].args.includes('--allowedTools'));
}));

const runGrant = { questionId: 'q-login-page-1', commands: ['npm test'], scope: 'run' };
const featureGrant = { questionId: 'q-login-page-2', commands: ['git status'], scope: 'feature' };
const allowedOf = (call) => (call.args.includes('--allowedTools') ? call.args.slice(call.args.indexOf('--allowedTools') + 1) : []);

test('allow this time gives the rule for one run only', () => withHome(async () => {
  checkout();
  const dir = worktree();
  writeBaseline(P, 'login-page', dir); // as the foreman's start keeps it
  const fake = fakeRun({ exits: true });
  // The answer the state gives stays the same until the director clicks again: the waker itself keeps the run grant from a second run.
  const asked = [];
  const w = waker(fake, {
    platform: 'win32', locate: () => dir, windowsBuilds: (work) => { asked.push(work); return { level: 'ask', grants: [runGrant, featureGrant], guardedCommand: null }; },
  });
  const { pid } = await w.startFeature({ work: 'login-page', worktree: dir });
  assert.deepEqual(asked, ['login-page']);
  assert.deepEqual(allowedOf(fake.calls[0]), ['Bash(npm test:*)', 'Bash(git status:*)']);
  assert.deepEqual(JSON.parse(fs.readFileSync(grantsUsedFile(P), 'utf8')), { used: ['q-login-page-1'] });
  assert.equal(path.dirname(grantsUsedFile(P)), watcherDir(P), 'kept in the watcher\'s own folder');
  fake.end(pid, 0);
  await flush();
  await w.wakeFeature('login-page', writeWake(P, featureBundle('login-page', 'f1')));
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(allowedOf(fake.calls[1]), ['Bash(git status:*)'], 'the feature grant stays; the run grant has gone');
  assert.deepEqual(JSON.parse(fs.readFileSync(grantsUsedFile(P), 'utf8')), { used: ['q-login-page-1'] });
}));

test('allow this time is used up by a run at every level', () => withHome(async () => {
  checkout();
  for (const [n, level] of ['unattended', 'guarded', 'ask'].entries()) {
    const fake = fakeRun();
    const grant = { ...runGrant, questionId: `q-login-page-${n + 10}` };
    const w = waker(fake, { platform: 'win32', windowsBuilds: () => ({ level, grants: [grant], guardedCommand: null }) });
    await w.startFeature({ work: `feature-${n}`, worktree: worktree() });
    assert.ok(JSON.parse(fs.readFileSync(grantsUsedFile(P), 'utf8')).used.includes(grant.questionId), level);
  }
  // A grant used up while Unattended was on gives no rule once the level is back to Ask.
  const fake = fakeRun();
  await waker(fake, { platform: 'win32', windowsBuilds: () => ({ level: 'ask', grants: [{ ...runGrant, questionId: 'q-login-page-10' }], guardedCommand: null }) })
    .startFeature({ work: 'feature-3', worktree: worktree() });
  assert.deepEqual(allowedOf(fake.calls[0]), []);
}));

test('a record of used grants that can\'t be read counts every run grant as used', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const w = waker(fake, { platform: 'win32', windowsBuilds: () => ({ level: 'ask', grants: [runGrant, featureGrant], guardedCommand: null }) });
  fs.mkdirSync(watcherDir(P), { recursive: true });
  for (const [n, text] of ['not json', '{"used":"q-login-page-2"}', '[]'].entries()) {
    fs.writeFileSync(grantsUsedFile(P), text);
    await w.startFeature({ work: `feature-${n}`, worktree: worktree() });
    assert.deepEqual(allowedOf(fake.calls.at(-1)), ['Bash(git status:*)'], text);
    assert.equal(fs.readFileSync(grantsUsedFile(P), 'utf8'), text, 'left as it was');
  }
}));

test('on Windows the waker passes its level to the allow rules, and a failing reading is ask', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const start = (windowsBuilds, work) => waker(fake, { platform: 'win32', windowsBuilds }).startFeature({ work, worktree: worktree() });
  await start(() => ({ level: 'unattended', grants: [], guardedCommand: null }), 'a');
  assert.deepEqual(allowedOf(fake.calls.at(-1)), [...ALLOWED, 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git restore:*)', 'Bash(git rm:*)', 'Bash(git mv:*)']);
  await start(() => { throw new Error('views gone'); }, 'b');
  assert.deepEqual(allowedOf(fake.calls.at(-1)), []);
  await start(() => null, 'c');
  assert.deepEqual(allowedOf(fake.calls.at(-1)), []);
  // Off Windows the answer is read too, for an adapter that works out its own rules (ruling P8-4), but Claude
  // Code's allow rules don't follow it: an answer that throws there changes nothing.
  await waker(fake, { platform: 'darwin', windowsBuilds: () => { throw new Error('not asked'); } }).startFeature({ work: 'd', worktree: worktree() });
  assert.deepEqual(allowedOf(fake.calls.at(-1)), ALLOWED);
}));

test('the waker\'s own reading of the state grants a signed click made on this computer', () => withHome(async () => {
  checkout();
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
  const keep = (event) => {
    const file = path.join(stateDir(P), eventPath(event));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(event)}\n`);
  };
  const dir = worktree();
  const t = (n) => () => new Date(T0 - (10 - n) * MIN);
  const data = {
    id: 'q-login-page-1', work: 'login-page', what: 'Let this feature\'s builder run: npm test.', why: 'w', options: BUILD_QUESTION_OPTIONS,
    recommendation: BUILD_QUESTION_LABELS.once, level: 3, commands: ['npm test'],
  };
  keep(makeEvent({ kind: 'feature', data: { work: 'login-page', step: 'building', worktree: dir }, now: t(1) }));
  keep(makeEvent({ kind: 'question', data, now: t(2) }));
  // A fresh stand-in each time, so the run before has ended.
  const started = async () => {
    const fake = fakeRun();
    await waker(fake, { platform: 'win32' }).startFeature({ work: 'login-page', worktree: dir });
    return allowedOf(fake.calls[0]);
  };
  assert.deepEqual(await started(), [], 'no answer yet');
  const click = makeEvent({
    kind: 'action', data: { action: 'answer', questionId: data.id, questionHash: dataHash(data), question: data.what, label: BUILD_QUESTION_LABELS.feature }, now: t(3),
  });
  const { sig, ...unsigned } = click;
  keep(unsigned);
  assert.deepEqual(await started(), [], 'an unsigned click grants nothing');
  keep(click); // in the unsigned one's place
  assert.deepEqual(await started(), ['Bash(npm test:*)']);
}));

const RUNNER = "'C:/h/windows/low-node/node.exe' 'C:/p/scripts/windows/guarded.js'";

test('at guarded the worktree is labelled before each run, which gets the runner\'s rule and the grants', () => withHome(async () => {
  checkout();
  const dir = worktree();
  keepSession('login-page', dir);
  const fake = fakeRun({ exits: true });
  const labelled = [];
  const w = waker(fake, {
    platform: 'win32', locate: () => dir, labelGuarded: async (wt) => { labelled.push([wt, fake.calls.length]); },
    windowsBuilds: () => ({ level: 'guarded', grants: [featureGrant], guardedCommand: RUNNER }),
  });
  const { pid } = await w.startFeature({ work: 'login-page', worktree: dir });
  assert.deepEqual(labelled, [[dir, 0]], 'labelled before the session started');
  assert.deepEqual(allowedOf(fake.calls[0]), [`Bash(${RUNNER}:*)`, 'Bash(git status:*)']);
  fake.end(pid, 0);
  await flush();
  // And again on each wake.
  await w.wakeFeature('login-page', writeWake(P, featureBundle('login-page', 'g1')));
  assert.deepEqual(labelled, [[dir, 0], [dir, 1]]);
  assert.deepEqual(allowedOf(fake.calls[1]), [`Bash(${RUNNER}:*)`, 'Bash(git status:*)']);
}));

test('a worktree that can\'t be labelled, or no runner to name, gets the Ask rules, and the log says so', () => withHome(async () => {
  checkout();
  const errors = [];
  const fake = fakeRun();
  const start = (over, work) => waker(fake, { platform: 'win32', onError: (m) => errors.push(m), ...over }).startFeature({ work, worktree: worktree() });
  await start({
    labelGuarded: async () => { throw new Error('icacls refused to label x'); },
    windowsBuilds: () => ({ level: 'guarded', grants: [featureGrant], guardedCommand: RUNNER }),
  }, 'a');
  assert.deepEqual(allowedOf(fake.calls.at(-1)), ['Bash(git status:*)']);
  assert.match(errors.at(-1), /a worktree couldn't be made ready for Guarded, so this run asks for build commands: icacls refused/);
  let asked = false;
  await start({
    labelGuarded: async () => { asked = true; },
    windowsBuilds: () => ({ level: 'guarded', grants: [], guardedCommand: null }),
  }, 'b');
  assert.equal(asked, false, 'nothing is labelled for no runner');
  assert.deepEqual(allowedOf(fake.calls.at(-1)), []);
  assert.match(errors.at(-1), /b worktree/);
  // At any other level nothing is labelled.
  await start({ labelGuarded: async () => { asked = true; }, windowsBuilds: () => ({ level: 'unattended', grants: [], guardedCommand: RUNNER }) }, 'c');
  await start({ labelGuarded: async () => { asked = true; }, windowsBuilds: () => ({ level: 'ask', grants: [], guardedCommand: RUNNER }) }, 'd');
  assert.equal(asked, false);
}));

test('the waker reads Guarded only while this computer\'s self-test passes', () => withHome(async () => {
  checkout();
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
  const keep = (event) => {
    const file = path.join(stateDir(P), eventPath(event));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(event)}\n`);
  };
  const setting = makeEvent({ kind: 'setting', data: { key: settingKey(computer), value: 'guarded' }, now: () => new Date(T0 - 5 * MIN) });
  keep(setting);
  keep(makeEvent({ kind: 'confirmation', data: confirmationFor(setting).data, now: () => new Date(T0 - 4 * MIN) }));
  const read = () => windowsBuildsOf(P, { now: () => new Date(T0), platform: 'win32', pluginRoot: '/p' })('login-page');
  assert.equal(read().level, 'ask', 'no self-test yet');
  fs.mkdirSync(path.dirname(selfTestFile(wheelhouseHome())), { recursive: true });
  fs.writeFileSync(selfTestFile(wheelhouseHome()), JSON.stringify({ at: new Date(T0 - 60 * MIN).toISOString(), lowStarts: true, writeHeld: true, keysReadHeld: false }));
  assert.equal(read().level, 'guarded');
  // The runner's command, where this home can be written into a rule (a Windows path on Windows).
  let expected = null;
  try { expected = guardedCommand({ home: wheelhouseHome(), pluginRoot: '/p', platform: 'win32' }); } catch { /* not on this system */ }
  assert.equal(read().guardedCommand, expected);
  fs.writeFileSync(selfTestFile(wheelhouseHome()), JSON.stringify({ at: new Date(T0 - 60 * MIN).toISOString(), lowStarts: true, writeHeld: false, keysReadHeld: true }));
  assert.equal(read().level, 'ask', 'a write that got through');
  assert.equal(windowsBuildsOf(P, { now: () => new Date(T0), platform: 'darwin' })('login-page').level, 'ask', 'never off Windows');
}));

test('Shape 2 prints one line per wake, naming each session\'s own copy, and starts nothing itself', () => withHome(async () => {
  checkout();
  const lines = [];
  const dir = worktree();
  writeBaseline(P, 'login-page', dir); // as the foreman's start keeps it
  const w = waker({ run: () => { throw new Error('Shape 2 starts nothing'); }, alive: () => true }, { shape: 2, print: (line) => lines.push(line), locate: () => dir });
  const foreman = writeWake(P, bundle('e1'));
  const second = writeWake(P, bundle('e2'));
  const feature = writeWake(P, featureBundle('login-page'));
  await w.wakeForeman(foreman);
  await w.wakeForeman(second);
  await w.wakeFeature('login-page', feature);
  await w.startFeature({ work: 'login-page', worktree: dir });
  assert.deepEqual(lines, [
    `WAKE foreman ${path.join(foremanCopies(), path.basename(foreman))}`,
    `WAKE foreman ${path.join(foremanCopies(), path.basename(second))}`,
    `WAKE feature login-page ${path.join(featurePaths(dir).dir, 'wakes', path.basename(feature))}`,
    `START feature login-page ${dir}`,
  ]);
  assert.deepEqual(w.waiting(), []);
}));

test('the waker prints Shape 2\'s lines through the printer it is given', () => withHome(async () => {
  checkout();
  const dir = worktree();
  writeBaseline(P, 'login-page', dir); // as the foreman's start keeps it
  const lines = [];
  // The mod's bridge answers on stdout, so with a printer given nothing else may reach it.
  const write = process.stdout.write;
  const written = [];
  process.stdout.write = (chunk, ...rest) => { written.push(String(chunk)); return write.call(process.stdout, chunk, ...rest); };
  try {
    const w = waker(fakeRun(), { shape: 2, print: (line) => lines.push(line), locate: () => dir });
    await w.wakeForeman(writeWake(P, bundle('e1')));
    await w.wakeFeature('login-page', writeWake(P, featureBundle('login-page')));
    await w.startFeature({ work: 'login-page', worktree: dir });
  } finally {
    process.stdout.write = write;
  }
  assert.deepEqual(lines.map((line) => line.split(' ').slice(0, 2).join(' ')), ['WAKE foreman', 'WAKE feature', 'START feature']);
  assert.equal(lines[2], `START feature login-page ${dir}`);
  assert.deepEqual(written.filter((text) => /WAKE|START/.test(text)), []);
}));

test('every session the waker starts keeps Claude Code\'s sign-in, spelt exactly, the switches that start "CLAUDE" too', () => withHome(async () => {
  checkout();
  const signIn = {
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
    CLAUDE_CODE_USE_FOUNDRY: '1', AWS_PROFILE: 'work', VERTEX_REGION_CLAUDE_MODEL_A: 'us-east5',
  };
  const host = { PATH: '/bin', ...signIn, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', claude_code_use_bedrock: 'a spelling not kept', ANTHROPIC_BASE_URL: 'http://gateway' };
  assert.deepEqual(sessionEnv(host), { PATH: '/bin', ...signIn });
  const fake = fakeRun();
  await waker(fake, { baseEnv: host }).wakeForeman(writeWake(P, bundle('e1')));
  assert.deepEqual(fake.calls[0].env, { PATH: '/bin', ...signIn, WHEELHOUSE_ROLE: 'foreman', ...FOREGROUND_ONLY });
  const features = fakeRun();
  await waker(features, { baseEnv: host }).startFeature({ work: 'search-box', worktree: worktree() });
  assert.deepEqual(features.calls[0].env, { PATH: '/bin', ...signIn, ...FOREGROUND_ONLY });
}));

test('the foreman, and only the foreman, is told it is the foreman; no session gets the host session\'s variables', () => withHome(async () => {
  checkout();
  const host = { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', claude_lower: 'y', ANTHROPIC_BASE_URL: 'http://gateway', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY_HELPER: 'kept' };
  assert.deepEqual(sessionEnv({ ...host, WHEELHOUSE_ROLE: 'foreman', wheelhouse_role: 'x' }), { PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY_HELPER: 'kept' });

  const fake = fakeRun();
  const record = writeWake(P, bundle('e1'));
  await waker(fake, { baseEnv: host }).wakeForeman(record);
  assert.deepEqual(fake.calls[0].env, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY_HELPER: 'kept', WHEELHOUSE_ROLE: 'foreman', ...FOREGROUND_ONLY });
  assert.ok(fake.calls[0].args[1].startsWith('Wheelhouse foreman: '));

  const dir = worktree();
  keepSession('login-page', dir);
  const features = fakeRun();
  const w = waker(features, { locate: () => dir, baseEnv: { ...host, WHEELHOUSE_ROLE: 'foreman', wheelhouse_role: 'foreman' } });
  await w.startFeature({ work: 'search-box', worktree: worktree() });
  await w.wakeFeature('login-page', writeWake(P, featureBundle('login-page')));
  assert.equal(features.calls.length, 2);
  for (const call of features.calls) assert.deepEqual(call.env, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY_HELPER: 'kept', ...FOREGROUND_ONLY });

  // Shape 2 names the same copy the Shape 1 prompt names.
  const lines = [];
  await waker(fakeRun(), { shape: 2, print: (line) => lines.push(line) }).wakeForeman(record);
  assert.equal(lines[0].slice('WAKE foreman '.length), fileIn(fake.calls[0].args[1], PROMPTS.foreman('')));
}));

test('under STOP nothing is started or woken; what waits goes once STOP lifts', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const dir = worktree();
  keepSession('login-page', dir);
  const w = waker(fake, { locate: () => dir });
  setStop({ by: 'prompt' });
  await w.wakeForeman(writeWake(P, bundle('e1')));
  await w.wakeFeature('login-page', writeWake(P, featureBundle('login-page')));
  await assert.rejects(w.startFeature({ work: 'search-box', worktree: worktree() }), /STOP/);
  assert.equal(fake.calls.length, 0);
  assert.equal(w.waiting().length, 2);

  liftStop();
  await w.pump();
  assert.equal(fake.calls.length, 2);
}));

test('STOP is read again right before each start', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  let reads = 0;
  const w = waker(fake, { stopped: () => { reads += 1; return reads > 1; } });
  await w.wakeForeman(writeWake(P, bundle('e1')));
  assert.equal(fake.calls.length, 0, 'STOP came on between the first look and the start');
  assert.equal(w.waiting().length, 1);
  assert.equal(w.waiting()[0].flight, null);
  assert.equal(w.waiting()[0].failures, 0);
}));

test('under STOP Shape 2 prints nothing until STOP lifts', () => withHome(async () => {
  checkout();
  const lines = [];
  const two = waker(fakeRun(), { shape: 2, print: (line) => lines.push(line) });
  setStop({ by: 'prompt' });
  const record = writeWake(P, bundle('e1'));
  await two.wakeForeman(record);
  await assert.rejects(two.startFeature({ work: 'search-box', worktree: worktree() }), /STOP/);
  assert.deepEqual(lines, []);
  liftStop();
  await two.pump();
  assert.deepEqual(lines, [`WAKE foreman ${path.join(foremanCopies(), path.basename(record))}`]);
}));

test('an outbox that is there but can\'t be read is never overwritten', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const w = waker(fake);
  fs.mkdirSync(path.dirname(outboxFile(P)), { recursive: true });
  for (const text of ['not json', '[]', '{"entries":3}', `{"entries":[],"pad":"${'x'.repeat(9 * 1024 * 1024)}"}`]) {
    fs.writeFileSync(outboxFile(P), text);
    await assert.rejects(w.wakeForeman(writeWake(P, bundle('e1'))), /outbox/);
    assert.throws(() => w.waiting(), /outbox/);
    assert.equal(fs.readFileSync(outboxFile(P), 'utf8'), text);
  }
  assert.equal(fake.calls.length, 0);
}));

test('the foreman\'s prompt names its playbook and gives its first command whole (M9)', () => {
  const wake = "node '/opt/wheel house/scripts/foreman/wake.js'";
  assert.equal(PROMPTS.foreman('/p/.wheelhouse/foreman/wakes/w.json', wake),
    `Wheelhouse foreman: follow wheelhouse:foreman to handle /p/.wheelhouse/foreman/wakes/w.json. First run: ${wake} read /p/.wheelhouse/foreman/wakes/w.json`);
  // A path with a space or a backslash is one word in single quotes; one with a quote gets no command.
  assert.ok(PROMPTS.foreman('/my p/w.json', wake).endsWith(`First run: ${wake} read '/my p/w.json'`));
  assert.ok(PROMPTS.foreman('C:\\p\\w.json', wake).endsWith(`First run: ${wake} read 'C:\\p\\w.json'`));
  assert.equal(PROMPTS.foreman("/it's/w.json", wake), "Wheelhouse foreman: follow wheelhouse:foreman to handle /it's/w.json");
  // With no wake command (a plugin folder that can't be given as one), the playbook alone.
  assert.equal(PROMPTS.foreman('/p/w.json'), 'Wheelhouse foreman: follow wheelhouse:foreman to handle /p/w.json');
  for (const prompt of [PROMPTS.foreman('/p/w.json', wake), PROMPTS.foreman('/p/w.json')]) assert.ok(prompt.startsWith('Wheelhouse foreman: '));
});

test('a waker whose plugin folder can\'t be a command still wakes the foreman, with its playbook named', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const record = writeWake(P, bundle('e1'));
  await waker(fake, { pluginRoot: "/opt/it's" }).wakeForeman(record);
  assert.equal(fake.calls[0].args[1], PROMPTS.foreman(path.join(foremanCopies(), path.basename(record))));
}));

test('through claude.cmd on Windows, the prompt goes in on stdin', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const w = waker(fake, { claude: { kind: 'cmd', file: 'C:\\Tools\\claude.cmd' } });
  const record = writeWake(P, bundle('e1'));
  await w.wakeForeman(record);
  const [call] = fake.calls;
  assert.equal(call.file, 'cmd.exe');
  assert.equal(call.input, foremanPrompt(path.join(foremanCopies(), path.basename(record))));
  assert.equal(call.windowsVerbatimArguments, true);
  assert.ok(call.args.at(-1).includes('--permission-mode acceptEdits --model model-a'));
}));

test('prune removes wake files past the look-back, never one the outbox still names', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const w = waker(fake);
  const old = writeWake(P, bundle('e1'));
  const waiting = writeWake(P, bundle('e2'));
  const fresh = writeWake(P, bundle('e3'));
  await w.wakeForeman(old); // delivered, its copy made
  fake.end(fake.calls[0].pid);
  await w.pump(); // gone, so sent again: still named
  fs.writeFileSync(outboxFile(P), JSON.stringify({ entries: [{ id: 'a', to: 'foreman', file: waiting, failures: 0, retryAt: null, flight: null }] }));
  const past = new Date(T0 - 8 * 24 * 60 * MIN);
  for (const f of [old, waiting, path.join(foremanCopies(), path.basename(old))]) fs.utimesSync(f, past, past);
  await w.prune();
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(path.join(foremanCopies(), path.basename(old))), false);
  assert.equal(fs.existsSync(waiting), true, 'named in the outbox');
  assert.equal(fs.existsSync(fresh), true, 'too new');
}));

test('writeWake writes each wake whole, under its own name, saying it may repeat', () => withHome(async () => {
  const now = () => new Date(T0);
  const a = writeWake(P, bundle('e1'), { now });
  const b = writeWake(P, bundle('e2'), { now });
  assert.notEqual(a, b);
  assert.match(path.basename(a), /^2026-10-19T09-00-00-000Z(-\d+)?\.json$/);
  const wake = readWake(a);
  assert.equal(wake.to, 'foreman');
  assert.equal(wake.at, new Date(T0).toISOString());
  assert.deepEqual(wake.events, [{ type: 'incident', id: 'e1', detail: {} }]);
  assert.match(wake.note, /may repeat/);
  assert.deepEqual(fs.readdirSync(wakesDir(P)).sort(), [path.basename(a), path.basename(b)].sort(), 'no temporary files left');

  const gap = readWake(writeWake(P, { to: 'foreman', events: [{ type: 'long-gap', id: 'long-gap:x', detail: { since: '2026-10-01T00:00:00.000Z' } }], digest: [], dropped: 0 }));
  assert.match(gap.note, /off for over a week/);
  assert.match(gap.note, /views/);
  assert.throws(() => writeWake(P, { to: 'someone' }), /wake/);
}));

test('writeWake refuses a wakes folder that is a link', { skip: !unix }, () => withHome(async () => {
  const elsewhere = tempFolder('wh-elsewhere-');
  fs.mkdirSync(path.dirname(wakesDir(P)), { recursive: true });
  fs.symlinkSync(elsewhere, wakesDir(P));
  assert.throws(() => writeWake(P, bundle('e1')), /wake/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  const watcher = path.dirname(wakesDir(P));
  fs.rmSync(watcher, { recursive: true });
  fs.symlinkSync(elsewhere, watcher);
  assert.throws(() => writeWake(P, bundle('e1')), /wake/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
}));

test('spawnDetached starts a real process detached and gives its exit code; pidAlive and its start time follow it', async (t) => {
  // The child is let go (unref), so something here must keep the test's event loop alive while it waits.
  const keep = setInterval(() => {}, 50);
  t.after(() => clearInterval(keep));
  const child = await spawnDetached(process.execPath, ['-e', 'setTimeout(() => process.exit(3), 300)'], { env: { PATH: process.env.PATH ?? '' } });
  assert.ok(Number.isInteger(child.pid));
  assert.equal(pidAlive(child.pid), true);
  if (unix) assert.match(await processStartTime(child.pid), /\d/);
  assert.equal(await child.exited, 3);
  assert.equal(pidAlive(child.pid), false);
  assert.equal(await processStartTime(child.pid), null);

  const fed = await spawnDetached(process.execPath, ['-e', 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>process.exit(s==="hello"?0:5))'], { input: 'hello' });
  assert.equal(await fed.exited, 0, 'input goes in on stdin');
  await assert.rejects(spawnDetached(path.join(tempFolder('wh-none-'), 'no-such-program'), []));
  assert.equal(await processStartTime(0), null);
  assert.equal(await processStartTime(1, { platform: 'win32', run: async () => ({ code: 0, stdout: '1 2026-10-19T09:00:00.0000000Z\r\n' }) }), '2026-10-19T09:00:00.0000000Z');
  assert.equal(await processStartTime(1, { run: async () => { throw new Error('no ps'); } }), null);
});

test('start times are asked for every running pid in one call, and kept a minute', async () => {
  const asked = [];
  const run = async (file, args) => {
    asked.push([file, args]);
    return { code: 0, stdout: '11 2026-10-19T08:00:00.0000000Z\r\n12 2026-10-19T08:30:00.0000000Z\r\n' };
  };
  let t = T0;
  const times = makeStartTimes({ platform: 'win32', run, now: () => new Date(t) });
  assert.equal(await times.get(11, [11, 12, 13]), '2026-10-19T08:00:00.0000000Z');
  assert.equal(asked.length, 1, 'one PowerShell call for all of them');
  const [file, args] = asked[0];
  assert.equal(file, 'powershell.exe');
  assert.match(args.at(-1), /^Get-CimInstance Win32_Process -Filter 'ProcessId=11 OR ProcessId=12 OR ProcessId=13'/);
  assert.equal(await times.get(12, [11, 12, 13]), '2026-10-19T08:30:00.0000000Z');
  assert.equal(await times.get(13), null, 'gone, and kept as gone');
  assert.equal(asked.length, 1, 'within the minute, nothing is asked again');
  t += 60 * 1000;
  await times.get(11, [11, 12]);
  assert.equal(asked.length, 2);
  assert.match(asked[1][1].at(-1), /ProcessId=11 OR ProcessId=12'/);
  await times.get(11, [], { fresh: true });
  assert.equal(asked.length, 3, 'a fresh ask, for a process just started');

  const ps = [];
  const mac = makeStartTimes({ platform: 'darwin', run: async (f, a) => { ps.push([f, a]); return { code: 0, stdout: '   11 Mon Oct 19 08:00:00 2026\n' }; }, now: () => new Date(t) });
  assert.equal(await mac.get(11, [12]), 'Mon Oct 19 08:00:00 2026');
  assert.deepEqual(ps, [['ps', ['-o', 'pid=,lstart=', '-p', '11,12']]]);
});

// ---- The Thoroughness column at each session start (design section 14.6) ----

const PINS = { mostCapable: 'model-top', midSized: 'model-mid', premium: 'model-premium' };
const tiered = (over = {}) => config({ tiers: { pins: PINS }, ...over });

// Keeps a state event in the project's clone, as the sync leaves it.
function keepEvent(event) {
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event)}\n`);
}
let minute = 0;
// A setting the director confirmed, read by the waker from the local clone.
function confirmSetting(key, value) {
  minute += 2;
  const setting = makeEvent({ kind: 'setting', data: { key, value }, now: () => new Date(T0 - 600 * MIN + minute * MIN) });
  keepEvent(setting);
  keepEvent(makeEvent({ kind: 'confirmation', data: confirmationFor(setting).data, now: () => new Date(T0 - 600 * MIN + (minute + 1) * MIN) }));
}
// The director's Yes on the premium model's card with paid credits, and the helper's signed check of the account,
// which names the premium pin (scripts/routing/premium.js).
function allowPremium(model = PINS.premium) {
  minute += 2;
  const at = new Date(T0 - 600 * MIN + minute * MIN).toISOString();
  const setting = makeEvent({ kind: 'setting', data: { key: 'premium', value: 'paid-too', premiumCard: at }, now: () => new Date(at) });
  keepEvent(setting);
  keepEvent(makeEvent({ kind: 'confirmation', data: confirmationFor(setting).data, now: () => new Date(Date.parse(at) + MIN) }));
  keepEvent(makeEvent({ kind: 'premium-check', data: { setting: setting.id, model, found: true }, now: () => new Date(Date.parse(at) + MIN) }));
}
const columnReady = (column, pins = PINS) => {
  minute += 2;
  keepEvent(makeEvent({ kind: 'column-ready', data: { column, pins, records: [`eval-${column}`] }, now: () => new Date(T0 - 600 * MIN + minute * MIN) }));
};
const flagOf = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const sessionFlags = (args) => ({ model: flagOf(args, '--model'), effort: flagOf(args, '--effort'), fallback: flagOf(args, '--fallback-model') });

test('each wake reads the level in force and gives the foreman and a feature that column\'s model, effort and fallback', () => withHome(async () => {
  checkout();
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
  const notes = [];
  const dir = worktree();
  writeBaseline(P, 'login-page', dir);
  // A fresh waker for each start, as the watcher's own loop would wake with the processes before it gone.
  const wakeForeman = async () => {
    const fake = fakeRun();
    await waker(fake, { config: tiered(), alive: () => false, onNote: (line) => notes.push(line) }).wakeForeman(writeWake(P, bundle(`e${minute}`)));
    return fake.calls[0];
  };
  const startFeature = async () => {
    const fake = fakeRun();
    await waker(fake, { config: tiered(), alive: () => false, platform: 'darwin', onNote: (line) => notes.push(line) })
      .startFeature({ work: 'login-page', worktree: dir, briefFile: featurePaths(dir).brief });
    return fake.calls[0];
  };

  // Nothing set: Balanced, on the pins.
  assert.deepEqual(sessionFlags((await wakeForeman()).args), { model: 'model-mid', effort: 'medium', fallback: 'model-top' });
  let feature = await startFeature();
  assert.deepEqual(sessionFlags(feature.args), { model: 'model-top', effort: 'high', fallback: 'model-mid' });
  assert.match(feature.args[1], /Thoroughness: Balanced/);
  assert.match(feature.args[1], /\nbuilder: model model-top, effort medium\n/);
  assert.match(feature.args[1], /\nreviewer: model model-mid, effort high\n/);
  assert.doesNotMatch(feature.args[1], /build it again|second fresh reviewer/);
  assert.deepEqual(notes, []);

  // Lean, not ready yet: Balanced, said once in the watcher's log.
  confirmSetting('efficiency', 'lean');
  assert.deepEqual(sessionFlags((await wakeForeman()).args), { model: 'model-mid', effort: 'medium', fallback: 'model-top' });
  assert.deepEqual(notes, ["Thoroughness: Lean isn't ready yet, so work runs at Balanced."]);

  // Lean, ready on these pins.
  columnReady('lean');
  assert.deepEqual(sessionFlags((await wakeForeman()).args), { model: 'model-mid', effort: 'low', fallback: 'model-top' });
  feature = await startFeature();
  assert.deepEqual(sessionFlags(feature.args), { model: 'model-top', effort: 'medium', fallback: 'model-mid' });
  assert.match(feature.args[1], /\nbuilder: model model-mid, effort medium\n/);
  assert.match(feature.args[1], /\nWhen a task is sent back by its review, build it again at effort high\.$/);

  // Lightest, ready: the lighter model designs too.
  confirmSetting('efficiency', 'lightest');
  columnReady('lightest');
  feature = await startFeature();
  assert.deepEqual(sessionFlags(feature.args), { model: 'model-mid', effort: 'high', fallback: 'model-top' });
  assert.match(feature.args[1], /\nreviewerCritical: model model-mid, effort high\n/);
  assert.match(feature.args[1], /build it again at effort high/);

  // Thorough: always ready. The premium model only with the director's opt-in and its own ready record.
  confirmSetting('efficiency', 'thorough');
  assert.deepEqual(sessionFlags((await wakeForeman()).args), { model: 'model-top', effort: 'medium', fallback: 'model-mid' });
  feature = await startFeature();
  assert.deepEqual(sessionFlags(feature.args), { model: 'model-top', effort: 'xhigh', fallback: 'model-mid' });
  assert.match(feature.args[1], /\nCritical-area work gets a second fresh reviewer; both must report CLEAN\.$/);
  assert.doesNotMatch(feature.args[1], /build it again/);
  // A premium setting its own card didn't make, and a pin in the configuration alone, count for nothing.
  confirmSetting('premium', 'paid-too');
  columnReady('premium');
  assert.equal(sessionFlags((await startFeature()).args).model, 'model-top', 'not the director\'s opt-in');
  allowPremium();
  feature = await startFeature();
  assert.deepEqual(sessionFlags(feature.args), { model: 'model-premium', effort: 'high', fallback: 'model-top' });
  assert.match(feature.args[1], /\nbuilderCritical: model model-premium, effort high\n/);
  // The foreman never takes the premium model.
  assert.equal(sessionFlags((await wakeForeman()).args).model, 'model-top');

  // A pin moved since Lean's evaluation: Lean waits again, at Balanced.
  confirmSetting('efficiency', 'lean');
  const moved = fakeRun();
  await waker(moved, { config: tiered({ tiers: { pins: { ...PINS, midSized: 'model-mid-2' } } }), alive: () => false }).wakeForeman(writeWake(P, bundle('moved')));
  assert.deepEqual(sessionFlags(moved.calls[0].args), { model: 'model-mid-2', effort: 'medium', fallback: 'model-top' });
}));

test('a column that can\'t be read gives Balanced, and its lines are noted once each time they change', () => withHome(async () => {
  checkout();
  const notes = [];
  const fake = fakeRun();
  const lines = [['Thoroughness: Lean isn\'t ready yet, so work runs at Balanced.']];
  let calls = 0;
  const w = waker(fake, {
    config: tiered(),
    alive: () => false,
    onNote: (line) => notes.push(line),
    routing: () => {
      calls += 1;
      if (calls === 1) throw new Error('unreadable');
      if (calls === 2) return 'not a column';
      return { level: 'balanced', roles: { foreman: { model: 'model-mid', effort: 'medium', fallback: null } }, extra: {}, lines: lines[0] };
    },
  });
  await w.wakeForeman(writeWake(P, bundle('a')));
  assert.deepEqual(sessionFlags(fake.calls[0].args), { model: 'model-mid', effort: 'medium', fallback: 'model-top' }, 'Balanced from the configuration');
  fake.end(fake.calls[0].pid);
  await w.wakeForeman(writeWake(P, bundle('b')));
  assert.deepEqual(sessionFlags(fake.calls[1].args), { model: 'model-mid', effort: 'medium', fallback: 'model-top' });
  fake.end(fake.calls[1].pid);
  await w.wakeForeman(writeWake(P, bundle('c')));
  fake.end(fake.calls[2].pid);
  await w.wakeForeman(writeWake(P, bundle('d')));
  assert.equal(fake.calls.length, 4);
  assert.deepEqual(notes, lines[0], 'said once');
  // An effort the adapter can't pass refuses the start; nothing runs on a guess.
  const bad = fakeRun();
  const errors = [];
  const w2 = waker(bad, { alive: () => false, onError: (m) => errors.push(m), routing: () => ({ level: 'balanced', roles: { foreman: { model: 'model-a', effort: 'max', fallback: null } }, extra: {}, lines: [] }) });
  await w2.wakeForeman(writeWake(P, bundle('e')));
  assert.equal(bad.calls.length, 0);
}));

test('with no pins, every start is as before: the flat models, at Balanced whatever the level', () => withHome(async () => {
  checkout();
  const notes = [];
  const fake = fakeRun();
  const routing = () => ({ level: 'balanced', roles: {}, extra: {}, lines: [] });
  await waker(fake, { alive: () => false, onNote: (l) => notes.push(l) }).wakeForeman(writeWake(P, bundle('a')));
  assert.deepEqual(sessionFlags(fake.calls[0].args), { model: 'model-a', effort: 'medium', fallback: null });
  // A column that names no role leaves each to the flat table, with no effort.
  const bare = fakeRun();
  await waker(bare, { alive: () => false, routing }).wakeForeman(writeWake(P, bundle('b')));
  assert.deepEqual(sessionFlags(bare.calls[0].args), { model: 'model-a', effort: null, fallback: null });
}));

test('at Shape 2 the column goes in each wake\'s copy as `column`, and in a wake of its own before a START line, the lines staying one line', () => withHome(async () => {
  checkout();
  const lines = [];
  const dir = worktree();
  writeBaseline(P, 'login-page', dir);
  const lean = () => ({
    level: 'lean',
    roles: { builder: { model: 'model-mid', effort: 'medium', fallback: 'model-top' }, reviewer: { model: 'model-mid', effort: 'medium', fallback: null } },
    extra: { builderCap: 1 },
    lines: [],
  });
  const w = waker({ run: () => { throw new Error('Shape 2 starts nothing'); }, alive: () => true }, { shape: 2, print: (line) => lines.push(line), locate: () => dir, routing: lean });
  const foreman = writeWake(P, bundle('e1'));
  const feature = writeWake(P, featureBundle('login-page'));
  const recordBefore = fs.readFileSync(feature, 'utf8');
  await w.wakeForeman(foreman);
  await w.wakeFeature('login-page', feature);
  await w.startFeature({ work: 'login-page', worktree: dir });
  assert.equal(lines.length, 3);
  for (const line of lines) assert.doesNotMatch(line, /[\r\n]/);
  const column = [
    'The models and efforts for the subagents you dispatch this wake (Thoroughness: Lean):',
    'builder: model model-mid, effort medium',
    'reviewer: model model-mid, effort medium',
    'When a task is sent back by its review, build it again at effort high.',
  ];
  const copyOf = (line) => JSON.parse(fs.readFileSync(line.split(' ').at(-1), 'utf8'));
  assert.deepEqual(copyOf(lines[0]).column, column);
  const featureCopy = copyOf(lines[1]);
  assert.deepEqual(featureCopy.column, column);
  // The copy is the record with the column beside it; the record itself is unchanged.
  assert.deepEqual({ ...featureCopy, column: undefined }, { ...JSON.parse(recordBefore), column: undefined });
  assert.equal(fs.readFileSync(feature, 'utf8'), recordBefore);
  // The START line's own wake, in the feature's wakes folder, carries the column for the session's first dispatches.
  assert.equal(lines[2], `START feature login-page ${dir}`);
  const wakes = path.join(featurePaths(dir).dir, 'wakes');
  const own = fs.readdirSync(wakes).map((name) => JSON.parse(fs.readFileSync(path.join(wakes, name), 'utf8'))).filter((x) => x.events.length === 0);
  assert.equal(own.length, 1);
  assert.deepEqual(own[0].column, column);
  assert.equal(own[0].to, 'feature');
  assert.equal(own[0].work, 'login-page');

  // An adapter that doesn't take the column gets copies that are the record, as before.
  const plain = [];
  const stand = { checkForeman: () => {}, checkFeature: () => {}, foremanCall: () => ({}), featureStartCall: () => ({}), featureResumeCall: () => ({}), finalAnswer: () => null };
  const other = waker({ run: () => { throw new Error('Shape 2 starts nothing'); }, alive: () => true }, { shape: 2, print: (line) => plain.push(line), locate: () => dir, routing: lean, sessions: stand });
  const again = writeWake(P, featureBundle('login-page', 'y'));
  await other.wakeFeature('login-page', again);
  assert.equal(fs.readFileSync(plain[0].split(' ').at(-1), 'utf8'), fs.readFileSync(again, 'utf8'));
}));
