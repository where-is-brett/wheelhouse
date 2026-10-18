// tests/scripts/watcher/waker.test.js
// Waking the foreman or a feature session (build-loop design, section 11;
// check 27). Every `claude` here is a stand-in: `run` records the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeWaker, writeWake, readWake, wakesDir, sessionModeOf, PROMPTS } from '../../../scripts/watcher/waker.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const unix = process.platform !== 'win32';
const P = 'o__p';
const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const SESSION = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const ALLOWED = ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)'];

const config = (over = {}) => readConfig(JSON.stringify({
  v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [],
  routing: { foreman: 'model-a', builder: 'model-b' },
  ...over,
}));

function checkout() {
  const found = readProject(P);
  if (found) return found.folder;
  const main = tempFolder('wh-main-');
  writeProject(P, {
    folder: main, remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
  });
  return main;
}

// A feature worktree in the checkout's .claude/worktrees/, with a brief and, when given, the session's id.
function worktree({ session = SESSION } = {}) {
  const parent = path.join(checkout(), '.claude', 'worktrees');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'wt-'));
  const p = featurePaths(dir);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.brief, 'The brief.\n');
  if (session !== null) fs.writeFileSync(p.session, `${JSON.stringify({ sessionId: session })}\n`);
  return dir;
}

// A stand-in for starting a process: keeps each call, and each process lives until `end(pid)`.
function fakeRun() {
  const calls = [];
  const live = new Set();
  let next = 100;
  const run = (file, args, options) => {
    const pid = next;
    next += 1;
    calls.push({ file, args, ...options, pid });
    live.add(pid);
    return { pid };
  };
  return { run, calls, live, alive: (pid) => live.has(pid), end: (pid) => live.delete(pid) };
}

const bundle = (id, over = {}) => ({ to: 'foreman', events: [{ type: 'incident', id, detail: {} }], digest: [], dropped: 0, ...over });

function waker(fake, over = {}) {
  return makeWaker({
    shape: 1,
    project: P,
    config: config(),
    run: fake.run,
    alive: fake.alive,
    now: () => new Date(T0),
    bootedAt: () => 0,
    claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: '/bin', WHEELHOUSE_ROLE: 'foreman' },
    print: () => { throw new Error('Shape 1 prints nothing'); },
    ...over,
  });
}

test('a foreman bundle starts one fresh foreman with the configured model and mode', () => withHome(async () => {
  const main = checkout();
  const fake = fakeRun();
  const w = waker(fake, { config: config({ sessionMode: 'plan' }) });
  const file = writeWake(P, bundle('e1'), { now: () => new Date(T0) });
  assert.equal(path.dirname(file), wakesDir(P));
  await w.wakeForeman(file);
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call.file, 'claude');
  assert.deepEqual(call.args, ['-p', `Wheelhouse foreman: handle ${file}`, '--permission-mode', 'plan', '--model', 'model-a']);
  assert.equal(call.cwd, main);
  assert.equal(call.env.WHEELHOUSE_ROLE, 'foreman');
  assert.equal(call.env.PATH, '/bin');

  // With no model named, the command line's own default applies.
  const other = fakeRun();
  await waker(other, { config: config({ routing: {} }) }).wakeForeman(writeWake(P, bundle('e2')));
  assert.deepEqual(other.calls[0].args.slice(2), ['--permission-mode', 'acceptEdits']);
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
  assert.deepEqual(w.waiting().map((e) => e.file), [second]);
  await w.pump();
  assert.equal(fake.calls.length, 1, 'still running');

  // A new waker (a restarted watcher) still sees the foreman running.
  const again = waker(fake);
  await again.pump();
  assert.equal(fake.calls.length, 1, 'the running foreman is known across restarts');

  fake.end(fake.calls[0].pid);
  await again.pump();
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].args[1], `Wheelhouse foreman: handle ${second}`);
  assert.deepEqual(again.waiting(), []);

  // Two that wait together go to the next foreman as one wake naming both.
  const third = writeWake(P, bundle('e3', { digest: [{ type: 'progress', id: 'p1' }] }));
  const fourth = writeWake(P, bundle('e4', { events: [{ type: 'incident', id: 'e3' }, { type: 'stuck', id: 'e4' }], digest: [{ type: 'progress', id: 'p2' }], dropped: 2 }));
  await again.wakeForeman(third);
  await again.wakeForeman(fourth);
  assert.equal(fake.calls.length, 2);
  fake.end(fake.calls[1].pid);
  await again.pump();
  assert.equal(fake.calls.length, 3);
  const merged = fake.calls[2].args[1].replace('Wheelhouse foreman: handle ', '');
  assert.ok(![third, fourth].includes(merged));
  const wake = readWake(merged);
  assert.deepEqual(wake.events.map((e) => e.id), ['e3', 'e4'], 'each event once');
  assert.deepEqual(wake.digest.map((e) => e.id), ['p1', 'p2']);
  assert.equal(wake.dropped, 2);
  assert.deepEqual(wake.merged, [third, fourth]);
}));

test('a feature bundle wakes only that feature\'s session', () => withHome(async () => {
  checkout();
  const login = worktree();
  const search = worktree({ session: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  const fake = fakeRun();
  const where = { 'login-page': login, 'search-box': search };
  const w = waker(fake, { locate: (work) => where[work] ?? null, config: config({ sessionMode: 'dontAsk' }) });
  const file = writeWake(P, { to: 'feature', work: 'login-page', events: [{ type: 'ci-red', id: 'ci-red:login-page:abc' }], digest: [], dropped: 0 });
  await w.wakeFeature('login-page', file);
  assert.equal(fake.calls.length, 1, 'no foreman, no other feature');
  const [call] = fake.calls;
  assert.equal(call.cwd, login);
  assert.deepEqual(call.args, [
    '-p', `Wheelhouse: read ${file}`, '--resume', SESSION,
    '--permission-mode', 'dontAsk', '--model', 'model-b', '--allowedTools', ...ALLOWED,
  ]);
  assert.equal(Object.hasOwn(call.env, 'WHEELHOUSE_ROLE'), false, 'a feature session is not the foreman, whatever the watcher inherited');

  // A second wake while that session still runs waits for it; another feature does not.
  const again = writeWake(P, { to: 'feature', work: 'login-page', events: [{ type: 'findings', id: 'f1' }], digest: [], dropped: 0 });
  await w.wakeFeature('login-page', again);
  const other = writeWake(P, { to: 'feature', work: 'search-box', events: [{ type: 'conflict', id: 'c1' }], digest: [], dropped: 0 });
  await w.wakeFeature('search-box', other);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].cwd, search);
  assert.equal(fake.calls[1].args[3], 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  fake.end(call.pid);
  await w.pump();
  assert.equal(fake.calls.length, 3);
  assert.equal(fake.calls[2].args[1], `Wheelhouse: read ${again}`);
}));

test('a feature wake waits for the session\'s id, and is dropped once the feature is gone', () => withHome(async () => {
  checkout();
  const dir = worktree({ session: null });
  const fake = fakeRun();
  let where = dir;
  const w = waker(fake, { locate: () => where });
  const file = writeWake(P, { to: 'feature', work: 'login-page', events: [{ type: 'ci-red', id: 'x' }], digest: [], dropped: 0 });
  await w.wakeFeature('login-page', file);
  assert.equal(fake.calls.length, 0, 'no session id yet');
  assert.equal(w.waiting().length, 1);

  // An id that could read as a flag is no id.
  fs.writeFileSync(featurePaths(dir).session, JSON.stringify({ sessionId: '--dangerously-skip-permissions' }));
  await w.pump();
  assert.equal(fake.calls.length, 0);

  fs.writeFileSync(featurePaths(dir).session, JSON.stringify({ sessionId: SESSION }));
  await w.pump();
  assert.equal(fake.calls.length, 1);

  where = null;
  await w.wakeFeature('login-page', writeWake(P, { to: 'feature', work: 'login-page', events: [], digest: [], dropped: 0 }));
  fake.end(fake.calls[0].pid);
  await w.pump();
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(w.waiting(), [], 'a closed or missing feature\'s wake is dropped');
}));

test('startFeature starts a session in the worktree with the brief\'s prompt', () => withHome(async () => {
  checkout();
  const dir = worktree({ session: null });
  const fake = fakeRun();
  const w = waker(fake);
  const started = await w.startFeature({ work: 'login-page', worktree: dir, briefFile: featurePaths(dir).brief });
  assert.equal(started.pid, fake.calls[0].pid);
  const [call] = fake.calls;
  assert.equal(call.cwd, dir);
  assert.deepEqual(call.args, ['-p', 'Read .wheelhouse/feature/brief.md and follow it.', '--permission-mode', 'acceptEdits', '--model', 'model-b', '--allowedTools', ...ALLOWED]);
  assert.equal(PROMPTS.start, 'Read .wheelhouse/feature/brief.md and follow it.');
  assert.equal(Object.hasOwn(call.env, 'WHEELHOUSE_ROLE'), false);

  await assert.rejects(w.startFeature({ work: 'login-page', worktree: dir }), /already running/);
  await assert.rejects(w.startFeature({ work: 'other', worktree: dir, briefFile: path.join(dir, 'brief.md') }), /brief/);
  await assert.rejects(w.startFeature({ work: 'Bad Name', worktree: worktree() }), /work/);
  const outside = tempFolder('wh-outside-');
  fs.mkdirSync(featurePaths(outside).dir, { recursive: true });
  fs.writeFileSync(featurePaths(outside).brief, 'x');
  await assert.rejects(w.startFeature({ work: 'elsewhere', worktree: outside }), /worktree/);
  await assert.rejects(w.startFeature({ work: 'nowhere', worktree: 'relative/path' }), /worktree/);
  if (unix) {
    const link = path.join(checkout(), '.claude', 'worktrees', 'link');
    fs.symlinkSync(worktree(), link);
    await assert.rejects(w.startFeature({ work: 'linked', worktree: link }), /worktree/);
  }
  assert.equal(fake.calls.length, 1);
}));

test('bypass mode is refused for feature sessions', () => withHome(async () => {
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
}));

test('Shape 2 prints one line per wake and starts nothing itself', () => withHome(async () => {
  checkout();
  const lines = [];
  const w = waker({ run: () => { throw new Error('Shape 2 starts nothing'); }, alive: () => true }, { shape: 2, print: (line) => lines.push(line) });
  const foreman = writeWake(P, bundle('e1'));
  const second = writeWake(P, bundle('e2'));
  const feature = writeWake(P, { to: 'feature', work: 'login-page', events: [], digest: [], dropped: 0 });
  const dir = worktree();
  await w.wakeForeman(foreman);
  await w.wakeForeman(second);
  await w.wakeFeature('login-page', feature);
  await w.startFeature({ work: 'login-page', worktree: dir });
  assert.deepEqual(lines, [
    `WAKE foreman ${foreman}`,
    `WAKE foreman ${second}`,
    `WAKE feature login-page ${feature}`,
    `START feature login-page ${dir}`,
  ]);
  assert.deepEqual(w.waiting(), []);
}));

test('the foreman, and only the foreman, is told it is the foreman, on both shapes', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const file = writeWake(P, bundle('e1'));
  await waker(fake, { baseEnv: { PATH: '/bin' } }).wakeForeman(file);
  assert.equal(fake.calls[0].env.WHEELHOUSE_ROLE, 'foreman');
  assert.ok(fake.calls[0].args[1].startsWith('Wheelhouse foreman: '));
  assert.equal(fake.calls[0].args[1], PROMPTS.foreman(file));

  const dir = worktree();
  const features = fakeRun();
  const w = waker(features, { locate: () => dir, baseEnv: { PATH: '/bin', WHEELHOUSE_ROLE: 'foreman', wheelhouse_role: 'foreman' } });
  await w.startFeature({ work: 'search-box', worktree: worktree() });
  await w.wakeFeature('login-page', writeWake(P, { to: 'feature', work: 'login-page', events: [], digest: [], dropped: 0 }));
  assert.equal(features.calls.length, 2);
  for (const call of features.calls) {
    assert.ok(!Object.keys(call.env).some((k) => k.toUpperCase() === 'WHEELHOUSE_ROLE'), 'no feature session gets the variable');
  }

  // Shape 2 names the file the same way; the foreman's own session reads the line.
  const lines = [];
  await waker(fakeRun(), { shape: 2, print: (line) => lines.push(line) }).wakeForeman(file);
  assert.equal(lines[0], `WAKE foreman ${file}`);
  assert.equal(lines[0].slice('WAKE foreman '.length), fake.calls[0].args[1].slice('Wheelhouse foreman: handle '.length));
}));

test('under STOP nothing is started or woken; what waits goes once STOP lifts', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const dir = worktree();
  const w = waker(fake, { locate: () => dir });
  setStop({ by: 'prompt' });
  const file = writeWake(P, bundle('e1'));
  await w.wakeForeman(file);
  await w.wakeFeature('login-page', writeWake(P, { to: 'feature', work: 'login-page', events: [], digest: [], dropped: 0 }));
  await assert.rejects(w.startFeature({ work: 'search-box', worktree: worktree() }), /STOP/);
  assert.equal(fake.calls.length, 0);
  assert.equal(w.waiting().length, 2);

  liftStop();
  await w.pump();
  assert.equal(fake.calls.length, 2);
}));

test('under STOP Shape 2 prints nothing until STOP lifts', () => withHome(async () => {
  checkout();
  const lines = [];
  const two = waker(fakeRun(), { shape: 2, print: (line) => lines.push(line) });
  setStop({ by: 'prompt' });
  const file = writeWake(P, bundle('e1'));
  await two.wakeForeman(file);
  await assert.rejects(two.startFeature({ work: 'search-box', worktree: worktree() }), /STOP/);
  assert.deepEqual(lines, []);
  liftStop();
  await two.pump();
  assert.deepEqual(lines, [`WAKE foreman ${file}`]);
}));

test('through claude.cmd on Windows, the prompt goes in on stdin', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  const w = waker(fake, { claude: { kind: 'cmd', file: 'C:\\Tools\\claude.cmd' } });
  const file = writeWake(P, bundle('e1'));
  await w.wakeForeman(file);
  const [call] = fake.calls;
  assert.equal(call.file, 'cmd.exe');
  assert.equal(call.input, `Wheelhouse foreman: handle ${file}`);
  assert.equal(call.windowsVerbatimArguments, true);
  assert.ok(call.args.at(-1).includes('--permission-mode acceptEdits --model model-a'));
}));

test('a process that cannot be started leaves its wake waiting', () => withHome(async () => {
  checkout();
  let fail = true;
  const fake = fakeRun();
  const w = waker(fake, { run: (...a) => { if (fail) throw new Error('no claude'); return fake.run(...a); } });
  const file = writeWake(P, bundle('e1'));
  await w.wakeForeman(file);
  assert.equal(w.waiting().length, 1);
  fail = false;
  await w.pump();
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(w.waiting(), []);
}));

test('a foreman recorded before the computer last started is not running', () => withHome(async () => {
  checkout();
  const fake = fakeRun();
  await waker(fake).wakeForeman(writeWake(P, bundle('e1')));
  await waker(fake, { bootedAt: () => T0 + 1 }).wakeForeman(writeWake(P, bundle('e2')));
  assert.equal(fake.calls.length, 2, 'a pid from before the start may be another process now');
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
