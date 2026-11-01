// tests/scripts/engine/goal-check.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dataHash, makeEvent, checkRecord, HELPER_ONLY_KINDS, PROTECTED_KINDS } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { withHome } from '../../helpers/homes.js';
import { sheetHash, baselineProblem, lastCheckHolds, goalsView, signedSheetOf, startProblem, checkSheet } from '../../../scripts/engine/goal.js';
import { GOAL_CHECK_LANE, GOAL_WORK } from '../../../scripts/engine/goal-limits.js';
import { goalCheckHost, checksOfGoal, resultsOf, runStep, GOAL_STEP } from '../../../scripts/engine/goal-check.js';
import { goalFolderOf, prepareGoalFolder } from '../../../scripts/engine/goal-folder.js';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { checkOrder, orderStore } from '../../../scripts/engine/order.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { workflowFor } from '../../../scripts/engine/archon/adapter.js';

const NOW = new Date('2026-11-01T10:00:00.000Z');
const HEAD = 'a'.repeat(40);
const TEST = { test: 'export downloads every order' };
const SUITE = { command: 'npm test', expect: 0 };
const PIECE = { id: 'export-page', title: 'The page', lane: 'small', visible: false, dependsOn: [] };
const FEATURE = { id: 'export-feature', title: 'The feature', lane: 'feature', visible: true, dependsOn: [] };

const sheet = (extra = {}) => ({
  title: 'Customers can export their orders',
  done: [TEST, SUITE],
  checksSay: ['The export holds every order.', 'The tests still pass.'],
  pieces: [{ work: 'export-page', hash: dataHash(PIECE) }],
  areas: { may: ['src/**'], wontTouch: ['tests/export.test.js'] },
  checkFiles: ['tests/export.test.js'],
  spend: { tokens: 20000000 },
  until: new Date(NOW.getTime() + 8 * 3600000).toISOString(),
  ...extra,
});

const before = (hash, results, extra = {}) => ({ goal: 'orders', hash, when: 'before', head: HEAD, results, ok: false, at: NOW.toISOString(), ...extra });
const failing = [{ check: TEST, ok: false }, { check: SUITE, ok: true }];
const passing = [{ check: TEST, ok: true }, { check: SUITE, ok: true }];

test('every goal check passing refuses the baseline', () => {
  const s = sheet();
  const hash = sheetHash(s);
  assert.equal(baselineProblem({ id: 'orders', hash, sheet: s, goalChecks: { orders: [before(hash, failing)] } }), null);
  assert.match(baselineProblem({ id: 'orders', hash, sheet: s, goalChecks: { orders: [before(hash, passing)] } }), /already pass/);
});

test('the latest baseline for a hash is the one that counts', () => {
  const s = sheet();
  const hash = sheetHash(s);
  const goalChecks = { orders: [before(hash, failing), before(hash, passing)] };
  assert.match(baselineProblem({ id: 'orders', hash, sheet: s, goalChecks }), /already pass/);
});

test('a baseline for another hash doesn\'t count', () => {
  const s = sheet();
  const goalChecks = { orders: [before('b'.repeat(64), failing)] };
  assert.match(baselineProblem({ id: 'orders', hash: sheetHash(s), sheet: s, goalChecks }), /haven't been run/);
  assert.match(baselineProblem({ id: 'orders', hash: sheetHash(s), sheet: s, goalChecks: undefined }), /haven't been run/);
});

test('a baseline that couldn\'t run, or left a check out, proves nothing', () => {
  const s = sheet();
  const hash = sheetHash(s);
  const refuse = (entry) => assert.match(baselineProblem({ id: 'orders', hash, sheet: s, goalChecks: { orders: [entry] } }), /couldn't/);
  refuse(before(hash, [], { said: 'The check run didn\'t start' }));
  refuse(before(hash, [{ check: TEST, ok: false, unrun: true }, { check: SUITE, ok: true }]));
  refuse(before(hash, [{ check: TEST, ok: false }]));
  refuse(before(hash, [...failing], { said: 'the run lost its process' }));
});

test('startProblem asks for the baseline, so every way of starting does', () => {
  const s = sheet();
  const hash = sheetHash(s);
  const work = { 'export-page': { work: { data: PIECE } } };
  const base = { id: 'orders', hash, sheet: s, goals: {}, work, now: NOW };
  assert.match(startProblem(base), /haven't been run/);
  assert.equal(startProblem({ ...base, goalChecks: { orders: [before(hash, failing)] } }), null);
  assert.match(startProblem({ ...base, goalChecks: { orders: [before(hash, passing)] } }), /already pass/);
});

test('a start signed before its baseline, or with none, stays out of the view', () => {
  const s = sheet();
  const hash = sheetHash(s);
  const goal = { kind: 'goal', at: NOW.toISOString(), data: { id: 'orders', sheet: s } };
  const work = { kind: 'work', at: NOW.toISOString(), data: PIECE };
  const start = { kind: 'action', at: NOW.toISOString(), data: { action: 'start-goal', goal: 'orders', hash } };
  assert.deepEqual(goalsView([work, goal], [start]), {});
  const after = before(hash, failing, { at: new Date(NOW.getTime() + 60000).toISOString() });
  assert.deepEqual(goalsView([work, goal], [start], { orders: [after] }), {});
  assert.deepEqual(Object.keys(goalsView([work, goal], [start], { orders: [before(hash, failing)] })), ['orders']);
});

const last = (hash, results, ok, extra = {}) => ({ goal: 'orders', hash, when: 'last', head: HEAD, results, ok, at: NOW.toISOString(), ...extra });

test('a failed check can\'t read as Done', () => {
  const hash = 'c'.repeat(64);
  const view = (entry) => ({ orders: [entry] });
  assert.equal(lastCheckHolds(view(last(hash, passing, true)), { id: 'orders', hash, head: HEAD }), true);
  assert.equal(lastCheckHolds(view(last(hash, failing, false)), { id: 'orders', hash, head: HEAD }), false);
  assert.equal(lastCheckHolds(view(last(hash, failing, true)), { id: 'orders', hash, head: HEAD }), false, 'a result that failed is never read past');
  assert.equal(lastCheckHolds(view(last(hash, [], true)), { id: 'orders', hash, head: HEAD }), false);
  assert.equal(lastCheckHolds(view(last(hash, passing, true)), { id: 'orders', hash, head: 'b'.repeat(40) }), false, 'another head proves nothing here');
  assert.equal(lastCheckHolds(view(last(hash, passing, true, { said: 'lost' })), { id: 'orders', hash, head: HEAD }), false);
  assert.equal(lastCheckHolds({}, { id: 'orders', hash, head: HEAD }), false);
});

test('a sheet may list a piece\'s own done checks, and a bad one is refused', () => {
  const pieces = (done) => [{ work: 'export-page', hash: dataHash(PIECE), done }];
  assert.equal(checkSheet(sheet({ pieces: pieces([{ test: 'a' }, { page: '/orders', mustShow: 'Export' }]) }), { now: NOW }), null);
  assert.match(checkSheet(sheet({ pieces: pieces([{ nothing: true }]) }), { now: NOW }), /piece/i);
  assert.match(checkSheet(sheet({ pieces: pieces('a test') }), { now: NOW }), /piece/i);
});

test('the signed sheet is found by its hash, whatever was recorded later', () => {
  const s = sheet();
  const later = { kind: 'goal', data: { id: 'orders', sheet: sheet({ title: 'A later sheet' }) } };
  const events = [{ kind: 'goal', data: { id: 'orders', sheet: s } }, later];
  assert.deepEqual(signedSheetOf(events, 'orders', sheetHash(s)), s);
  assert.equal(signedSheetOf(events, 'orders', 'd'.repeat(64)), null);
});

const mergedViews = (...ids) => ({
  work: Object.fromEntries([PIECE, FEATURE].map((w) => [w.id, { work: { data: w } }])),
  reports: Object.fromEntries(ids.map((id) => [id, { data: { work: id, outcome: 'merged' } }])),
});

test('the baseline lists the goal\'s own checks, and the last check every merged piece\'s too', () => {
  const s = sheet({ pieces: [{ work: 'export-page', hash: 'x', done: [{ test: 'the page shows' }, { page: '/orders', mustShow: 'Export' }] }, { work: 'export-feature', hash: 'y' }] });
  const base = { sheet: s, views: mergedViews('export-page'), testCommand: 'npm test', designOf: () => null };
  assert.deepEqual(checksOfGoal({ ...base, when: 'before' }), [TEST, SUITE]);
  assert.deepEqual(checksOfGoal({ ...base, when: 'last' }), [TEST, SUITE, { test: 'the page shows' }, { page: '/orders', mustShow: 'Export' }]);
});

test('a merged piece with no list has the project\'s tests, and a feature its slices\' checks', () => {
  const slice = { test: 'the slice works' };
  const text = `\`\`\`wheelhouse-slices\n${JSON.stringify({ goal: 'g', flag: { name: 'f' }, slices: [{ title: 't', goal: 'g', done: [slice] }] })}\n\`\`\``;
  const s = sheet({ done: [TEST], checksSay: ['The export holds every order.'], pieces: [{ work: 'export-page', hash: 'x' }, { work: 'export-feature', hash: 'y' }] });
  const got = checksOfGoal({ sheet: s, when: 'last', views: mergedViews('export-page', 'export-feature'), testCommand: 'npm test', designOf: () => ({ text }) });
  assert.deepEqual(got, [TEST, { command: 'npm test', expect: 0 }, slice]);
});

test('a feature\'s design that can\'t be read stops the list, so its checks aren\'t dropped unseen', () => {
  const s = sheet({ pieces: [{ work: 'export-feature', hash: 'y' }] });
  assert.throws(() => checksOfGoal({ sheet: s, when: 'last', views: mergedViews('export-feature'), testCommand: 'npm test', designOf: () => null }), /design/);
});

// The host with stand-ins, its records in `written`.
function hostWith({ status = 'completed', outputs, trusted = () => true, views = {}, events, startRun, folderAt, signedClean = async () => false, stopped = () => false, config = { testCommand: 'npm test' }, now = () => NOW, write } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-goal-check-'));
  const s = sheet();
  const written = [];
  const started = [];
  const cancelled = [];
  const engine = {
    inspect: async () => (typeof status === 'function' ? status() : { status }),
    outputs: async () => outputs ?? { [GOAL_STEP]: JSON.stringify({ results: [{ check: TEST, ok: false }, { check: SUITE, ok: true }] }) },
    act: async (runId, action) => { cancelled.push({ runId, action }); return { ok: true }; },
  };
  const host = goalCheckHost({
    file: path.join(dir, 'goal-checks.json'), engine, now, stopped, trusted, signedClean,
    write: write ?? (async (kind, data) => { written.push({ kind, data }); }),
    readViews: () => views,
    events: () => events ?? [{ kind: 'goal', data: { id: 'orders', sheet: s } }],
    config: () => config, designOf: () => null,
    folderAt: folderAt ?? (async (head) => ({ ok: true, folder: '/engine/goal-checks/x', head: head ?? HEAD })),
    startRun: startRun ?? (async (args) => { started.push(args); return { ok: true, runId: `goal-run-${started.length}` }; }),
  });
  return { host, written, started, cancelled, s, hash: sheetHash(s), dir };
}

test('the baseline runs the sheet\'s checks at the main line\'s head, and signs from the engine\'s record', async () => {
  const w = hostWith();
  const got = await w.host.start({ goal: 'orders', when: 'before' });
  assert.deepEqual(got, { ok: true, runId: 'goal-run-1', head: HEAD });
  const { order, folder } = w.started[0];
  assert.equal(folder, '/engine/goal-checks/x');
  assert.equal(checkOrder(order), null);
  assert.deepEqual({ work: order.work, lane: order.lane, goal: order.goal, hash: order.hash, when: order.when, head: order.head, done: order.done }, { work: GOAL_WORK, lane: GOAL_CHECK_LANE, goal: 'orders', hash: w.hash, when: 'before', head: HEAD, done: [TEST, SUITE] });
  await w.host.tick();
  assert.deepEqual(w.written, [{ kind: 'goal-check', data: { goal: 'orders', hash: w.hash, when: 'before', head: HEAD, results: [{ check: TEST, ok: false }, { check: SUITE, ok: true }], ok: false } }]);
  await w.host.tick();
  assert.equal(w.written.length, 1, 'signed once');
});

test('pass or fail, with no partial credit', async () => {
  const three = hostWith();
  await three.host.start({ goal: 'orders', when: 'before' });
  await three.host.tick();
  assert.equal(three.written[0].data.ok, false, 'one of two is not a pass');
  const all = hostWith({ outputs: { [GOAL_STEP]: JSON.stringify({ results: [{ check: TEST, ok: true }, { check: SUITE, ok: true }] }) } });
  await all.host.start({ goal: 'orders', when: 'before' });
  await all.host.tick();
  assert.equal(all.written[0].data.ok, true);
});

test('a run\'s own word counts for nothing', async () => {
  const say = (outputs, trusted) => hostWith({ outputs, trusted });
  const fine = { [GOAL_STEP]: JSON.stringify({ results: [{ check: TEST, ok: true }, { check: SUITE, ok: true }] }) };
  for (const [what, w] of [
    ['a pack that isn\'t the installed one', say(fine, () => false)],
    ['another step\'s output', say({ other: fine[GOAL_STEP] })],
    ['words that aren\'t a result', say({ [GOAL_STEP]: 'every check passes' })],
    ['a check it wasn\'t given', say({ [GOAL_STEP]: JSON.stringify({ results: [{ check: { command: 'true', expect: 0 }, ok: true }, { check: SUITE, ok: true }] }) })],
    ['a check left out', say({ [GOAL_STEP]: JSON.stringify({ results: [{ check: TEST, ok: true }] }) })],
    ['an ok that isn\'t a yes or no', say({ [GOAL_STEP]: JSON.stringify({ results: [{ check: TEST, ok: 'yes' }, { check: SUITE, ok: true }] }) })],
  ]) {
    await w.host.start({ goal: 'orders', when: 'before' });
    await w.host.tick();
    assert.equal(w.written.length, 1, what);
    assert.equal(w.written[0].data.ok, false, what);
    assert.deepEqual(w.written[0].data.results, [], what);
    assert.equal(typeof w.written[0].data.said, 'string', what);
  }
});

test('resultsOf keeps only what was asked, and says when a check couldn\'t run', () => {
  const order = { done: [TEST] };
  assert.deepEqual(resultsOf(JSON.stringify({ results: [{ check: TEST, ok: false, unrun: true, line: 'x' }] }), order), [{ check: TEST, ok: false, unrun: true }]);
  assert.equal(resultsOf(undefined, order), null);
});

test('a page check is listed, walked at its piece', async () => {
  const page = { page: '/orders', mustShow: 'Export' };
  const s = sheet({ pieces: [{ work: 'export-page', hash: dataHash(PIECE), done: [page] }] });
  const hash = sheetHash(s);
  const views = { goals: { orders: { sheet: s, hash, ended: null } }, ...mergedViews('export-page') };
  const w = hostWith({ views, events: [{ kind: 'goal', data: { id: 'orders', sheet: s } }] });
  await w.host.start({ goal: 'orders', when: 'last' });
  assert.deepEqual(w.started[0].order.done, [TEST, SUITE], 'no run walks a page');
  await w.host.tick();
  assert.deepEqual(w.written[0].data.results[0], { check: page, ok: null, walked: true });
  assert.equal(w.written[0].data.results.length, 3);
});

test('the last check takes its list from the signed sheet, not the narrowed view', async () => {
  const late = { test: 'the late piece holds' };
  const s = sheet({ pieces: [{ work: 'export-page', hash: dataHash(PIECE) }, { work: 'export-feature', hash: dataHash(FEATURE), done: [late] }] });
  const hash = sheetHash(s);
  const narrowedSheet = { ...s, pieces: [s.pieces[0]] };
  const views = { goals: { orders: { sheet: narrowedSheet, hash, ended: null } }, ...mergedViews('export-page', 'export-feature') };
  const w = hostWith({ views, events: [{ kind: 'goal', data: { id: 'orders', sheet: s } }] });
  await w.host.start({ goal: 'orders', when: 'last' });
  assert.ok(w.started[0].order.done.some((c) => c.test === late.test), 'the piece dropped from the view is still checked');
});

test('a project\'s signed check counts for its test command', async () => {
  const seen = [];
  const w = hostWith({ signedClean: async (head) => { seen.push(head); return true; }, outputs: { [GOAL_STEP]: JSON.stringify({ results: [{ check: TEST, ok: false }] }) } });
  await w.host.start({ goal: 'orders', when: 'before' });
  assert.deepEqual(w.started[0].order.done, [TEST], 'the test command isn\'t run twice');
  assert.deepEqual(seen, [HEAD]);
  await w.host.tick();
  assert.deepEqual(w.written[0].data.results, [{ check: SUITE, ok: true, signed: true }, { check: TEST, ok: false }]);
});

test('when nothing is left to run, the result is signed with no run', async () => {
  const s = sheet({ done: [SUITE], checksSay: ['The tests still pass.'] });
  const w = hostWith({ signedClean: async () => true, events: [{ kind: 'goal', data: { id: 'orders', sheet: s } }] });
  const got = await w.host.start({ goal: 'orders', when: 'before' });
  assert.equal(got.ok, true);
  assert.equal(got.runId, null);
  assert.deepEqual(w.started, []);
  assert.equal(w.written[0].data.ok, true);
});

test('a check run that fails to start says so and the goal isn\'t Done', async () => {
  const w = hostWith({ startRun: async () => ({ ok: false, refused: 'the engine is down' }) });
  const got = await w.host.start({ goal: 'orders', when: 'before' });
  assert.deepEqual(got, { ok: false, refused: 'the engine is down' });
  assert.deepEqual(w.written, [{ kind: 'goal-check', data: { goal: 'orders', hash: w.hash, when: 'before', head: HEAD, results: [], ok: false, said: 'the engine is down' } }]);
  const noFolder = hostWith({ folderAt: async () => ({ ok: false, refused: 'the folder could not be made' }) });
  assert.equal((await noFolder.host.start({ goal: 'orders', when: 'before' })).ok, false);
  assert.equal(noFolder.written[0].data.head, null);
  assert.equal(noFolder.written[0].data.ok, false);
});

test('a run that failed, was cancelled or was lost says so, and one that outlives its limit is cancelled', async () => {
  for (const status of ['failed', 'cancelled']) {
    const w = hostWith({ status });
    await w.host.start({ goal: 'orders', when: 'before' });
    await w.host.tick();
    assert.equal(w.written[0].data.ok, false, status);
    assert.equal(typeof w.written[0].data.said, 'string', status);
  }
  let at = NOW;
  const going = hostWith({ status: 'running', now: () => at });
  await going.host.start({ goal: 'orders', when: 'before' });
  await going.host.tick();
  assert.deepEqual(going.written, []);
  at = new Date(NOW.getTime() + 5 * 3600000);
  await going.host.tick();
  assert.equal(going.cancelled.length, 1);
  assert.equal(going.written[0].data.ok, false);
  const paused = hostWith({ status: 'paused' });
  await paused.host.start({ goal: 'orders', when: 'before' });
  await paused.host.tick();
  assert.equal(paused.cancelled.length, 1, 'no step here asks anything, so a paused run has lost its way');
  let unknownAt = NOW;
  const unknown = hostWith({ status: 'unknown', now: () => unknownAt });
  await unknown.host.start({ goal: 'orders', when: 'before' });
  await unknown.host.tick();
  assert.deepEqual(unknown.written, []);
  unknownAt = new Date(NOW.getTime() + 3600000);
  await unknown.host.tick();
  assert.equal(unknown.written[0].data.ok, false);
});

test('a helper started again picks up the run under way, and a write that failed is tried again', async () => {
  let fail = true;
  const written = [];
  const w = hostWith({ write: async (kind, data) => { if (fail) throw new Error('no'); written.push({ kind, data }); } });
  await w.host.start({ goal: 'orders', when: 'before' });
  await w.host.tick();
  assert.deepEqual(written, []);
  fail = false;
  await w.host.tick();
  assert.equal(written.length, 1);
  await w.host.tick();
  assert.equal(written.length, 1);
});

test('a second ask while a check runs gets the same run', async () => {
  const w = hostWith({ status: 'running' });
  const first = await w.host.start({ goal: 'orders', when: 'before' });
  const second = await w.host.start({ goal: 'orders', when: 'before' });
  assert.equal(second.runId, first.runId);
  assert.equal(w.started.length, 1);
  assert.deepEqual(w.host.workOf('goal-run-1'), { work: GOAL_WORK, lane: null, branch: null });
  assert.equal(w.host.workOf('other'), null);
});

test('an unsigned goal starts nothing by itself', async () => {
  const w = hostWith({ views: { goals: {} } });
  await w.host.tick();
  assert.deepEqual(w.started, []);
  const last = await w.host.start({ goal: 'orders', when: 'last' });
  assert.equal(last.ok, false);
  assert.match(last.refused, /signed/);
  assert.deepEqual(w.started, []);
  assert.deepEqual(w.written, []);
});

test('a goal with no sheet, or already started, has no baseline, and nothing starts under All stop', async () => {
  const none = hostWith({ events: [] });
  assert.match((await none.host.start({ goal: 'orders', when: 'before' })).refused, /no sheet/i);
  const started = hostWith({ views: { goals: { orders: { ended: null } } } });
  assert.match((await started.host.start({ goal: 'orders', when: 'before' })).refused, /started/);
  const stopped = hostWith({ stopped: () => true });
  assert.match((await stopped.host.start({ goal: 'orders', when: 'before' })).refused, /All stop/);
  assert.deepEqual(stopped.started, []);
  assert.match((await hostWith().host.start({ goal: 'orders', when: 'later' })).refused, /before it or last/);
});

test('a test check with no test command says so and starts nothing', async () => {
  const w = hostWith({ config: { testCommand: null, testsNotCounting: true } });
  const got = await w.host.start({ goal: 'orders', when: 'before' });
  assert.equal(got.ok, false);
  assert.match(got.refused, /test command/);
  assert.equal(w.written[0].data.ok, false);
  assert.deepEqual(w.started, []);
});

// --- the step ---

test('the step runs what the helper\'s order lists, and prints a result the helper can read', async () => {
  const out = [];
  const seen = [];
  const order = { lane: GOAL_CHECK_LANE, done: [{ command: 'first', expect: 0 }, { command: 'second', expect: 0 }], testCommand: 'npm test', prepare: 'get-ready' };
  const run = async (file, args) => { seen.push(args.at(-1)); return { code: args.at(-1) === 'second' ? 1 : 0, stdout: '' }; };
  const code = await runStep(order, { cwd: '/x', run, out: (line) => out.push(line), platform: 'linux' });
  assert.equal(code, 0, 'a failed check is a result, not a failed run');
  assert.deepEqual(seen, ['get-ready', 'first', 'second']);
  assert.deepEqual(JSON.parse(out.join('')).results.map((r) => r.ok), [true, false]);
});

test('a prepare step that fails leaves every check unrun', async () => {
  const out = [];
  const order = { lane: GOAL_CHECK_LANE, done: [{ command: 'first', expect: 0 }], testCommand: 'npm test', prepare: 'get-ready' };
  await runStep(order, { cwd: '/x', run: async () => ({ code: 1, stdout: '' }), out: (line) => out.push(line), platform: 'linux' });
  assert.deepEqual(JSON.parse(out.join('')).results, [{ check: order.done[0], ok: false, unrun: true }]);
});

// --- the folder ---

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' }).trim();

function homeWithCommits() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-goal-folder-'));
  const home = path.join(root, 'home.git');
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  git(root, 'init', '-q', '--bare', '-b', 'main', home);
  git(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'one');
  const first = git(work, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(work, 'a.txt'), 'two\n');
  git(work, 'commit', '-q', '-am', 'two');
  const second = git(work, 'rev-parse', 'HEAD');
  git(work, 'push', '-q', home, 'main');
  return { root, home, first, second };
}

test('the folder works for a project in git alone', async () => {
  const { root, home, second } = homeWithCommits();
  const engine = path.join(root, 'engine');
  const got = await prepareGoalFolder({ project: 'solo', source: home, engine });
  assert.deepEqual(got, { ok: true, folder: goalFolderOf('solo', engine), head: second });
  assert.equal(fs.readFileSync(path.join(got.folder, 'a.txt'), 'utf8'), 'two\n');
});

test('the folder takes the head it is asked for, starts clean, and refuses a head it can\'t find', async () => {
  const { root, home, first } = homeWithCommits();
  const engine = path.join(root, 'engine');
  const one = await prepareGoalFolder({ project: 'solo', source: home, engine });
  fs.writeFileSync(path.join(one.folder, 'left-behind.txt'), 'x');
  const got = await prepareGoalFolder({ project: 'solo', source: home, engine, head: first });
  assert.equal(got.head, first);
  assert.equal(fs.readFileSync(path.join(got.folder, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(fs.existsSync(path.join(got.folder, 'left-behind.txt')), false);
  assert.equal((await prepareGoalFolder({ project: 'solo', source: home, engine, head: 'b'.repeat(40) })).ok, false);
  assert.equal((await prepareGoalFolder({ project: 'solo', source: path.join(root, 'nothing'), engine })).ok, false);
});

// --- the route and the workflow ---

function routesWith({ start, held = () => false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-goal-route-'));
  const orders = path.join(dir, 'orders');
  const calls = [];
  const engine = {
    start: start ?? (async (order) => { calls.push(order); return { ok: true, runId: 'goal-1' }; }),
    artefactsOf: (runId) => path.join(dir, 'folder', runId),
    act: async () => ({ ok: true }),
  };
  const routes = engineRoutes({ projects: () => [{ project: 'p', folder: '/p' }], engineFor: () => engine, ordersDir: () => orders, write: async () => {}, held, host: { repo: () => 'o/p' } });
  return { routes, calls, dir, orders };
}

const standIn = { v: 1, work: GOAL_WORK, lane: GOAL_CHECK_LANE, goal: 'orders', hash: 'c'.repeat(64), when: 'before', head: HEAD, done: [SUITE], testCommand: 'npm test', prepare: null, listed: [] };

test('a goal check has a start of its own: a stand-in order, a ticket and no run record', async () => {
  const { routes, calls, dir, orders } = routesWith();
  assert.deepEqual(await routes.startGoalCheck({ project: 'p', order: standIn, folder: '/engine/goal-checks/x' }), { ok: true, runId: 'goal-1' });
  assert.deepEqual(calls, [{ work: GOAL_WORK, lane: GOAL_CHECK_LANE, goal: 'orders', project: '/engine/goal-checks/x', bindings: {} }]);
  assert.equal(orderStore(orders).load('goal-1').goal, 'orders');
  assert.ok(fs.existsSync(path.join(dir, 'folder', 'goal-1', TICKET_FILE)));
});

test('no goal check starts under All stop, and a refused start is said back', async () => {
  const stopped = routesWith({ held: () => true });
  assert.equal((await stopped.routes.startGoalCheck({ project: 'p', order: standIn, folder: '/f' })).ok, false);
  assert.deepEqual(stopped.calls, []);
  const refused = routesWith({ start: async () => ({ ok: false, refused: 'no' }) });
  assert.deepEqual(await refused.routes.startGoalCheck({ project: 'p', order: standIn, folder: '/f' }), { ok: false, refused: 'no' });
});

test('a stand-in order holds what a check run needs, and no other run is passed by it', () => {
  assert.equal(checkOrder(standIn), null);
  assert.match(checkOrder({ ...standIn, goal: undefined }), /goal/);
  assert.match(checkOrder({ ...standIn, work: 'other' }), /goal/);
  assert.match(checkOrder({ ...standIn, done: 'x' }), /goal/);
});

test('a goal check needs no twin on Copilot', () => {
  const tiers = { small: 'copilot:a', medium: 'copilot:a', large: 'copilot:a' };
  assert.deepEqual(workflowFor('wheelhouse-goal-check', { tiers }), { workflow: 'wheelhouse-goal-check' });
});

test('no piece of work can have the goal check\'s work name', () => {
  assert.throws(() => makeEvent({ kind: 'work', data: { id: GOAL_WORK, title: 'Check', lane: 'small', visible: true, dependsOn: [] } }), /kept for/);
});

test('a goal-check record holds its result, and only the helper writes one', () => withHome(() => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
  const good = { goal: 'orders', hash: 'c'.repeat(64), when: 'last', head: HEAD, results: [{ check: TEST, ok: true }, { check: { page: '/a', mustShow: 'b' }, ok: null, walked: true }], ok: true };
  makeEvent({ kind: 'goal-check', data: good });
  makeEvent({ kind: 'goal-check', data: { ...good, head: null, results: [], ok: false, said: 'It didn\'t start.' } });
  for (const bad of [{ ...good, when: 'sometime' }, { ...good, hash: 'short' }, { ...good, head: 'short' }, { ...good, ok: 'yes' }, { ...good, results: 'all' }, { ...good, results: [{ ok: true }] }, { ...good, results: [{ check: TEST, ok: 'yes' }] }, { ...good, extra: 1 }, { ...good, said: '' }]) {
    assert.throws(() => makeEvent({ kind: 'goal-check', data: bad }), /goal-check/, JSON.stringify(bad));
  }
  assert.equal(HELPER_ONLY_KINDS.includes('goal-check'), true);
  assert.equal(PROTECTED_KINDS.includes('goal-check'), true);
  assert.match(checkRecord(makeEvent({ kind: 'goal-check', data: good }), { enrolled: readEnrolled(), computer }), /only the helper/);
}));
