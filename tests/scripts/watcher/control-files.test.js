// tests/scripts/watcher/control-files.test.js
// The files in a feature's folder that steer agents, checked before every wake (ruling P7-13): read
// with fs alone, recorded when the foreman's start makes the worktree, and compared before each
// wake. A new or changed one, or no record, holds the wake and raises one record for the card.
// Every session here is a stand-in: `run` records the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  baselineFile, changedPaths, checkControlFiles, controlFilesState, isControlPath, readBaseline, writeBaseline,
} from '../../../scripts/watcher/control-files.js';
import { makeWaker, sessionFile, writeWake } from '../../../scripts/watcher/waker.js';
import { raiseRecord } from '../../../scripts/watcher/main.js';
import { main as act } from '../../../scripts/foreman/act.js';
import { controlFileInput, controlFilesDue } from '../../../scripts/cards/build-loop.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { cardsDue } from '../../../scripts/hooks/board-context.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { CONTROL_PATHS, makeEvent } from '../../../scripts/state/events.js';
import { readEnrolled } from '../../../scripts/state/signing.js';
import { buildViews } from '../../../scripts/state/views.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import {
  P as FOREMAN_P, T0 as FOREMAN_T0, emptyViews, fakeClient, project, workView,
} from '../../helpers/foreman.js';

const unix = process.platform !== 'win32';
const P = 'o__p';
const T0 = Date.parse('2026-10-24T09:00:00.000Z');
const MIN = 60 * 1000;
const SESSION = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
const WORK = 'login-page';
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

const config = () => readConfig(JSON.stringify({
  v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], routing: { foreman: 'model-a', builder: 'model-b' },
}));

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

// A feature worktree in the checkout's .claude/worktrees/ with a brief, a hook file from the
// default branch and some code, whose session the watcher started.
function worktree() {
  const parent = path.join(checkout(), '.claude', 'worktrees');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'wt-'));
  fs.mkdirSync(featurePaths(dir).dir, { recursive: true });
  fs.writeFileSync(featurePaths(dir).brief, 'The brief.\n');
  put(dir, '.github/hooks/project.json', '{"hooks":{}}\n');
  put(dir, 'src/app.js', 'export const app = 1;\n');
  fs.mkdirSync(path.dirname(sessionFile(P, WORK)), { recursive: true });
  fs.writeFileSync(sessionFile(P, WORK), JSON.stringify({ sessionId: SESSION, worktree: dir, at: new Date(T0).toISOString() }));
  return dir;
}

function put(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function fakeRun() {
  const calls = [];
  let pid = 100;
  return { calls, run: (file, args, options) => { calls.push({ file, args, ...options }); pid += 1; return { pid }; } };
}

// A waker of either shape for the one feature in `dir`, raising into `raised`, with a clock to move.
function waker(dir, { shape = 1, raised = [], raise, lines = [] } = {}) {
  let t = T0;
  const fake = fakeRun();
  const w = makeWaker({
    shape,
    project: P,
    config: config(),
    run: fake.run,
    alive: () => true,
    startTimeOf: async () => null,
    now: () => new Date(t),
    bootedAt: () => 0,
    locate: () => dir,
    claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: '/bin' },
    platform: 'darwin',
    print: (line) => lines.push(line),
    raise: raise ?? (async (record) => { raised.push(record); }),
  });
  return { w, fake, raised, lines, move: (ms) => { t += ms; } };
}

const featureBundle = (id) => ({ to: 'feature', work: WORK, events: [{ type: 'ci-red', id }], digest: [], dropped: 0 });
const wake = (h, id) => h.w.wakeFeature(WORK, writeWake(P, featureBundle(id), { now: () => new Date(T0) }));

// The plain records raised, as the helper would make them, and the views built from them.
const asEvents = (raised, from = T0) => raised.map((r, i) => makeEvent({ kind: r.kind, data: r.data, now: () => new Date(from + i * 1000) }));
const viewsOf = (events) => buildViews(events, readEnrolled());

test('a new .github/hooks file stops the wake and raises one card', () => withHome(async () => {
  const dir = worktree();
  writeBaseline(P, WORK, dir);
  const h = waker(dir);
  put(dir, '.github/hooks/off.json', '{"disableAllHooks":true}\n');

  await wake(h, 'a1');
  assert.equal(h.fake.calls.length, 0, 'no session is woken');
  const [held] = h.w.waiting();
  assert.equal(held.failures, 1, 'the wake failed and waits');
  assert.match(held.lastError, /new or changed file that steers agents: \.github\/hooks\/off\.json/);
  assert.deepEqual(h.raised, [{ kind: 'control-file', data: { work: WORK, paths: ['.github/hooks/off.json'], at: new Date(T0).toISOString() } }]);

  // Tried again past its wait, and with another wake: still held, and raised no more.
  h.move(2 * MIN);
  await wake(h, 'a2');
  h.move(6 * MIN);
  await h.w.pump();
  assert.equal(h.fake.calls.length, 0);
  assert.equal(h.raised.length, 1, 'one record for the work and what was found');

  // The record makes one card, in the plan's words, with no set line.
  const record = asEvents(h.raised)[0];
  const views = viewsOf([record]);
  const due = controlFilesDue(views);
  assert.deepEqual(due.map((r) => r.id), [record.id]);
  assert.equal(cardsDue(views, new Date(T0)), 1, 'the board counts it');
  const { card } = composeCard(controlFileInput(due[0], 'the login page'));
  assert.equal(card.kind, 'question');
  assert.equal(card.line, null);
  assert.equal(card.event, record.id);
  assert.ok(card.question.startsWith("A feature's folder has a new file that steers agents, `.github/hooks/off.json`: look at it before the feature carries on."), card.question);
  assert.match(card.question, /The feature is the login page\./);
  assert.deepEqual(cardProblems(card.question), []);
  const cardEvent = makeEvent({ kind: 'card', data: card, now: () => new Date(T0 + 5000) });
  assert.deepEqual(controlFilesDue(viewsOf([record, cardEvent])), [], 'made once');
  assert.ok(viewsOf([record, cardEvent]).waiting.some((c) => c.id === cardEvent.id));

  // A changed file is a new finding: one more record, which takes the first one's place.
  put(dir, '.github/hooks/off.json', '{"disableAllHooks":false}\n');
  h.move(20 * MIN);
  await h.w.pump();
  assert.equal(h.fake.calls.length, 0);
  assert.equal(h.raised.length, 2);
  const second = makeEvent({ kind: 'control-file', data: h.raised[1].data, now: () => new Date(T0 + 9000) });
  assert.deepEqual(viewsOf([record, cardEvent, second]).controlFiles.map((r) => r.id), [second.id]);
  assert.ok(!viewsOf([record, cardEvent, second]).waiting.some((c) => c.id === cardEvent.id), 'the first card closes');

  // Taken out again, the files match their record: the wake goes, and the card is closed.
  fs.rmSync(path.join(dir, '.github', 'hooks', 'off.json'));
  h.move(20 * MIN);
  await h.w.pump();
  assert.equal(h.fake.calls.length, 1, 'woken');
  assert.deepEqual(h.w.waiting().map((e) => e.flight !== null), [true], 'its wake is in flight');
  assert.equal(h.raised.length, 3);
  assert.deepEqual(h.raised[2], { kind: 'control-file-lift', data: { work: WORK, at: new Date(T0 + 48 * MIN).toISOString() } });
  const lift = makeEvent({ kind: 'control-file-lift', data: h.raised[2].data, now: () => new Date(T0 + 10000) });
  const lifted = viewsOf([record, cardEvent, second, lift]);
  assert.deepEqual(lifted.controlFiles, []);
  assert.ok(!lifted.waiting.some((c) => c.id === cardEvent.id));
}));

test('an unchanged folder wakes as before', () => withHome(async () => {
  const dir = worktree();
  writeBaseline(P, WORK, dir);
  const h = waker(dir);
  // Code changes, the feature's own folder and a package's files steer no agent.
  put(dir, 'src/app.js', 'export const app = 2;\n');
  put(dir, '.wheelhouse/feature/notes/AGENTS.md', 'notes\n');
  put(dir, 'node_modules/kit/AGENTS.md', 'a package\'s\n');
  put(dir, 'node_modules/kit/.github/hooks/x.json', '{}\n');
  await wake(h, 'b1');
  assert.equal(h.fake.calls.length, 1);
  assert.equal(h.fake.calls[0].cwd, dir);
  assert.deepEqual(h.raised, []);
  assert.deepEqual(h.w.waiting().map((e) => [e.failures, e.flight !== null]), [[0, true]], 'in flight, never failed');
  // A file that steers agents and is gone steers nothing: the wake goes.
  fs.rmSync(path.join(dir, '.github', 'hooks', 'project.json'));
  assert.deepEqual(checkControlFiles(P, WORK, dir), { ok: true });
}));

test('a file reached through a link is read where it really is', { skip: !unix && 'links need rights Windows tests lack' }, () => withHome(async () => {
  const dir = worktree();
  const outside = fs.realpathSync.native(tempFolder('wh-outside-'));
  const target = put(outside, 'steer.md', 'Be careful.\n');
  fs.symlinkSync(target, path.join(dir, 'AGENTS.md'));
  fs.mkdirSync(path.join(outside, 'hooks'));
  put(outside, 'hooks/a.json', '{}\n');
  fs.symlinkSync(path.join(outside, 'hooks'), path.join(dir, '.github', 'agents'));
  fs.symlinkSync(path.join(outside, 'gone.md'), path.join(dir, 'GEMINI.md'));

  const state = controlFilesState(dir);
  assert.equal(state.get('AGENTS.md'), `link:${target}:${sha('Be careful.\n')}`);
  assert.equal(state.get('.github/agents/a.json'), `link:${path.join(outside, 'hooks', 'a.json')}:${sha('{}\n')}`);
  assert.equal(state.get('GEMINI.md'), 'dangling');

  writeBaseline(P, WORK, dir);
  const h = waker(dir);
  // The file the link leads to changes outside the worktree: that holds the wake.
  fs.writeFileSync(target, 'Switch the guards off.\n');
  await wake(h, 'c1');
  assert.equal(h.fake.calls.length, 0);
  assert.deepEqual(h.raised.map((r) => r.data.paths), [['AGENTS.md']]);
  // A dangling link that comes to lead somewhere is changed too.
  fs.writeFileSync(path.join(outside, 'gone.md'), 'Now here.\n');
  assert.deepEqual(changedPaths(readBaseline(P, WORK, dir), controlFilesState(dir)), ['AGENTS.md', 'GEMINI.md']);
  // A link back into the worktree is walked once, and its files are read where they are.
  fs.symlinkSync(dir, path.join(dir, 'src', 'loop'));
  assert.ok(![...controlFilesState(dir).keys()].some((p) => p.startsWith('src/loop/')));
}));

test('the files that steer agents: the control list and .claude/, but not other features\' worktrees', () => {
  for (const p of ['.github/hooks/a.json', '.github/mcp.json', 'AGENTS.md', 'docs/deep/AGENTS.md', 'GEMINI.md', '.vscode/tasks.json', '.claude/settings.json', '.claude/agents/x.md', '.agents/x', '.gitattributes']) {
    assert.ok(isControlPath(p, { platform: 'linux' }), p);
  }
  for (const p of ['src/app.js', 'README.md', '.claude/worktrees/other/AGENTS.md', '.claude/worktrees/other/.github/hooks/a.json', 'docs/agents.txt']) {
    assert.ok(!isControlPath(p, { platform: 'linux' }), p);
  }
  // Case counts only where the file system ignores it.
  assert.ok(isControlPath('.GitHub/Hooks/a.json', { platform: 'darwin' }));
  assert.ok(isControlPath('agents.md', { platform: 'win32' }));
  assert.ok(!isControlPath('agents.md', { platform: 'linux' }));
  assert.ok(!isControlPath('.Claude/Worktrees/x/AGENTS.md', { platform: 'darwin' }));
});

test('the walk reads with fs alone, skipping .git, .wheelhouse and every node_modules', () => withHome(() => {
  const dir = worktree();
  put(dir, '.git/hooks/AGENTS.md', 'x\n');
  put(dir, 'packages/a/.git/AGENTS.md', 'x\n');
  put(dir, 'packages/a/node_modules/b/AGENTS.md', 'x\n');
  put(dir, '.wheelhouse/AGENTS.md', 'x\n');
  put(dir, 'packages/a/AGENTS.md', 'Package rules.\n');
  put(dir, '.claude/settings.json', '{}\n');
  put(dir, '.claude/worktrees/other/AGENTS.md', 'x\n');
  const state = controlFilesState(dir);
  assert.deepEqual([...state.keys()].sort(), ['.claude/settings.json', '.github/hooks/project.json', 'packages/a/AGENTS.md']);
  assert.equal(state.get('packages/a/AGENTS.md'), sha('Package rules.\n'));
  if (unix) {
    // A pipe in a file's place is named, never read (reading it would wait for ever).
    fs.rmSync(path.join(dir, '.claude', 'settings.json'));
    execFileSync('mkfifo', [path.join(dir, '.claude', 'settings.json')], { stdio: 'ignore' });
    assert.equal(controlFilesState(dir).get('.claude/settings.json'), 'special');
  }
}));

test('a feature with no record of its agent files waits, and raises the card that says so', () => withHome(async () => {
  const dir = worktree();
  const h = waker(dir);
  await wake(h, 'd1');
  assert.equal(h.fake.calls.length, 0);
  assert.match(h.w.waiting()[0].lastError, /no record yet of this feature's agent files/);
  assert.deepEqual(h.raised.map((r) => r.data.paths), [[]]);
  // A record kept for another worktree of the same work is no record of this one.
  const other = worktree();
  writeBaseline(P, WORK, other);
  assert.equal(readBaseline(P, WORK, dir), null);
  assert.equal(checkControlFiles(P, WORK, dir).ok, false);
  const { card } = composeCard(controlFileInput(viewsOf(asEvents(h.raised)).controlFiles[0], WORK));
  assert.ok(card.question.startsWith("There is no record yet of this feature's agent files, so they can't be checked: look at them before the feature carries on."), card.question);
  assert.deepEqual(cardProblems(card.question), []);
}));

test('Shape 2 prints no wake for a feature whose folder gained a file that steers agents', () => withHome(async () => {
  const dir = worktree();
  writeBaseline(P, WORK, dir);
  const h = waker(dir, { shape: 2 });
  put(dir, '.vscode/tasks.json', '{}\n');
  await wake(h, 'e1');
  assert.deepEqual(h.lines, []);
  assert.deepEqual(h.raised.map((r) => r.data.paths), [['.vscode/tasks.json']]);
  fs.rmSync(path.join(dir, '.vscode'), { recursive: true });
  h.move(2 * MIN);
  await h.w.pump();
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /^WAKE feature login-page /);
}));

test('a record the helper doesn\'t take is raised again at the next wake, and the wake still waits', () => withHome(async () => {
  const dir = worktree();
  writeBaseline(P, WORK, dir);
  const writes = [];
  let answer = { ok: false, refused: 'STOP is on' };
  const client = { state: { write: async (body) => { writes.push(body); return answer; } } };
  const h = waker(dir, { raise: raiseRecord(P, client) });
  put(dir, '.claude/commands/x.md', 'Do it.\n');
  await wake(h, 'f1');
  assert.equal(h.fake.calls.length, 0);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { project: P, kind: 'control-file', data: { work: WORK, paths: ['.claude/commands/x.md'], at: new Date(T0).toISOString() } });
  answer = { ok: true, id: 'x' };
  h.move(2 * MIN);
  await h.w.pump();
  assert.equal(writes.length, 2, 'raised again');
  h.move(6 * MIN);
  await h.w.pump();
  assert.equal(writes.length, 2, 'once taken, not again');
  assert.equal(h.fake.calls.length, 0);
}));

test('a control-file record names its work, its paths and when', () => withHome(() => {
  const at = new Date(T0).toISOString();
  const make = (kind, data) => makeEvent({ kind, data, now: () => new Date(T0) });
  assert.equal(make('control-file', { work: WORK, paths: ['AGENTS.md'], at }).kind, 'control-file');
  assert.equal(make('control-file', { work: WORK, paths: [], at }).data.paths.length, 0);
  assert.equal(make('control-file-lift', { work: WORK, at }).kind, 'control-file-lift');
  assert.throws(() => make('control-file', { work: 'Bad Work', paths: [], at }), /slug/);
  assert.throws(() => make('control-file', { work: WORK, paths: [''], at }), /paths/);
  assert.throws(() => make('control-file', { work: WORK, paths: Array.from({ length: CONTROL_PATHS + 1 }, (_, i) => `${i}/AGENTS.md`), at }), /paths/);
  assert.throws(() => make('control-file', { work: WORK, paths: [], at: 'soon' }), /time/);
  assert.throws(() => make('control-file-lift', { work: WORK, at, paths: [] }), /field/);
  // A lift closes only the records of its own work that came before it.
  const one = make('control-file', { work: WORK, paths: ['AGENTS.md'], at });
  const other = makeEvent({ kind: 'control-file', data: { work: 'search-box', paths: ['AGENTS.md'], at }, now: () => new Date(T0 + 1000) });
  const lift = makeEvent({ kind: 'control-file-lift', data: { work: WORK, at }, now: () => new Date(T0 + 2000) });
  const later = makeEvent({ kind: 'control-file', data: { work: WORK, paths: ['GEMINI.md'], at }, now: () => new Date(T0 + 3000) });
  assert.deepEqual(viewsOf([one, other, lift, later]).controlFiles.map((r) => r.id), [other.id, later.id]);
  // A card naming many paths names the first three and how many more, or only how many.
  const many = { id: 'x', data: { work: WORK, paths: ['a/AGENTS.md', 'b/AGENTS.md', 'c/AGENTS.md', 'd/AGENTS.md', 'e/AGENTS.md'] } };
  assert.match(controlFileInput(many, WORK).what, /`a\/AGENTS\.md`, `b\/AGENTS\.md`, `c\/AGENTS\.md` and 2 more: look at them/);
  assert.match(controlFileInput(many, WORK, { short: true }).what, /steer agents, 5 files: look at them/);
}));

test('the foreman\'s start records the worktree\'s agent files right after making it, before the session starts', () => withHome(async () => {
  const main = await project({ git: true });
  const views = emptyViews();
  views.work['add-export'] = workView('add-export');
  views.rulebook = [];
  const fake = fakeClient({ views });
  const wt = path.join(main, '.claude', 'worktrees', 'add-export');
  const seen = [];
  const wakerFor = () => ({
    async startFeature({ work, worktree: at }) {
      seen.push(readBaseline(FOREMAN_P, work, at));
      return { pid: 1, sessionId: SESSION };
    },
  });
  const said = { out: '', err: '' };
  const code = await act(['start', 'add-export', '--goal', 'Export', '--done', 'It exports', '--appetite-sessions', '1', '--appetite-tokens', '1000'], {
    project: FOREMAN_P, now: () => new Date(FOREMAN_T0), out: (t) => { said.out += t; }, err: (t) => { said.err += t; }, client: fake.client, wakerFor,
  });
  assert.equal(code, 0, said.err);
  assert.equal(seen.length, 1);
  assert.ok(seen[0] instanceof Map, 'the record was there when the session started');
  assert.deepEqual(seen[0], controlFilesState(wt));
  assert.equal(path.dirname(baselineFile(FOREMAN_P, 'add-export')), path.join(path.dirname(stateDir(FOREMAN_P)), 'watcher', 'control'));
  assert.equal(JSON.parse(fs.readFileSync(baselineFile(FOREMAN_P, 'add-export'), 'utf8')).at, new Date(FOREMAN_T0).toISOString());
}));
