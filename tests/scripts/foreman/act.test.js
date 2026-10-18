// tests/scripts/foreman/act.test.js
// The foreman's deterministic commands (ruling R63): each writes its state
// events through the helper, records each event's id as handled before writing
// it (R64), may be run again with nothing more done (R27), and refuses in one
// plain line. The helper and the waker are stand-ins; git is real, in a
// throwaway main checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main, FOREMAN_QUESTIONS, extraPlanId } from '../../../scripts/foreman/act.js';
import { briefHash, featurePaths, parseBrief } from '../../../scripts/feature/files.js';
import { branchOf } from '../../../scripts/hooks/session-start.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { eventPath, makeEvent } from '../../../scripts/state/events.js';
import { enrol, makeSigningKey } from '../../../scripts/state/signing.js';
import { makeWaker, sessionFile } from '../../../scripts/watcher/waker.js';
import { run as runProgram } from '../../../scripts/lib/run.js';
import { g } from '../../helpers/git-fixture.js';
import { withHome } from '../../helpers/homes.js';
import {
  P, T0, HASH, config, emptyViews, fakeClient, featureView, planText, project, recordInState, reportText, workView, worktree,
} from '../../helpers/foreman.js';
import { buildStatus } from '../../../scripts/feature/status.js';
import { amendBrief } from '../../../scripts/feature/brief.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const now = () => new Date(T0);

// A stand-in waker: keeps each start, and the session record a Shape 1 waker would keep.
function fakeWaker() {
  const starts = [];
  return {
    starts,
    wakerFor: () => ({
      async startFeature({ work, worktree: wt }) {
        starts.push({ work, worktree: wt });
        fs.mkdirSync(path.dirname(sessionFile(P, work)), { recursive: true });
        fs.writeFileSync(sessionFile(P, work), JSON.stringify({ sessionId: '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0', worktree: wt }));
        return { pid: 4242, sessionId: '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0' };
      },
    }),
  };
}

// Runs one command; resolves `{ code, out, err }`.
async function act(argv, deps) {
  const said = { out: '', err: '' };
  const code = await main(argv, {
    project: P, now, out: (t) => { said.out += t; }, err: (t) => { said.err += t; }, ...deps,
  });
  return { code, ...said };
}

const refusedInOneLine = (r) => {
  assert.equal(r.code, 1, r.out);
  assert.equal(r.err.trim().split('\n').length, 1, r.err);
};

const everyWriteHandledFirst = (writes) => {
  for (const w of writes) {
    assert.match(w.id, UUID);
    assert.equal(w.handledFirst, true, `${w.kind} ${JSON.stringify(w.data)}`);
  }
};

// --- start ---

const START = ['start', 'add-export', '--goal', 'Export the report as CSV', '--done', 'A CSV file downloads', '--done', 'Its columns match the table',
  '--appetite-sessions', '1', '--appetite-tokens', '200000', '--ruling', 'r-1'];

function startViews() {
  const views = emptyViews();
  views.work['add-export'] = workView('add-export', { shownFirst: true });
  views.rulebook = [
    { id: 'r-1', words: 'Prices show two decimal places', status: 'accepted' },
    { id: 'r-2', words: 'Proposed only', status: 'proposed' },
  ];
  return views;
}

test('start makes the worktree on feature/<work>, writes the brief, records it, then starts the session', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: startViews() });
  const wt = path.join(checkout, '.claude', 'worktrees', 'add-export');
  const brief = featurePaths(wt).brief;
  const briefAtWrite = [];
  const write = fake.client.state.write;
  fake.client.state.write = async (body) => {
    briefAtWrite.push(fs.existsSync(brief) ? briefHash(fs.readFileSync(brief, 'utf8')) : null);
    return write(body);
  };
  const waker = fakeWaker();
  const r = await act(START, { client: fake.client, wakerFor: waker.wakerFor });
  assert.equal(r.code, 0, r.err);

  assert.equal(branchOf(wt), 'feature/add-export');
  assert.match(fs.readFileSync(path.join(checkout, '.git', 'info', 'exclude'), 'utf8'), /^\.wheelhouse\/$/m);
  const text = fs.readFileSync(brief, 'utf8');
  const { fields } = parseBrief(text);
  assert.deepEqual(fields, {
    v: 1,
    work: 'add-export',
    lane: 'small',
    version: 1,
    goal: 'Export the report as CSV',
    done: ['A CSV file downloads', 'Its columns match the table'],
    appetite: { sessions: 1, tokens: 200000 },
    rulings: [{ id: 'r-1', words: 'Prices show two decimal places' }],
    routing: { foreman: 'model-a', builder: 'model-b', reviewer: 'model-c' },
    shownFirst: true,
  });

  // One record: started, with the brief's hash, written after the brief.
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [['feature', {
    work: 'add-export', step: 'started', worktree: wt, branch: 'feature/add-export', brief: briefHash(text),
  }]]);
  assert.deepEqual(briefAtWrite, [briefHash(text)]);
  everyWriteHandledFirst(fake.writes);
  assert.deepEqual(waker.starts, [{ work: 'add-export', worktree: wt }]);
  assert.match(r.out, /^Made the worktree .*add-export on feature\/add-export\.$/m);
  assert.match(r.out, /^Started the add-export session\.$/m);

  // Again: nothing more.
  const again = await act(START, { client: fake.client, wakerFor: waker.wakerFor });
  assert.equal(again.code, 0, again.err);
  assert.equal(again.out, 'add-export was started already (it is at started).\n');
  assert.equal(fake.writes.length, 1);
  assert.equal(waker.starts.length, 1);
}));

test('start gives slices and a plan to the brief, and a feature started before its session began starts the session only', () => withHome(async () => {
  const checkout = await project({ git: true });
  const views = startViews();
  views.work['add-export'] = workView('add-export', { lane: 'feature' });
  const fake = fakeClient({ views });
  // One plan can't be named for work in several slices: each slice's is recorded by its session.
  const both = await act([...START, '--plan', 'docs/plans/x.md', '--slices', '3'], { client: fake.client, wakerFor: fakeWaker().wakerFor });
  refusedInOneLine(both);
  assert.match(both.err, /--plan names one plan, so it can't be given for work in several slices/);
  assert.equal(fake.writes.length, 0);

  const r = await act([...START, '--slices', '3'], { client: fake.client, wakerFor: () => ({ startFeature: async () => { throw new Error('STOP is on: no session is started'); } }) });
  refusedInOneLine(r);
  assert.match(r.err, /STOP is on/);
  const wt = path.join(checkout, '.claude', 'worktrees', 'add-export');
  const { fields } = parseBrief(fs.readFileSync(featurePaths(wt).brief, 'utf8'));
  assert.equal(fields.plan, undefined);
  assert.equal(fields.slices, 3);
  assert.equal(fields.shownFirst, false);
  assert.deepEqual(fake.writes[0].data.slice, { n: 1, m: 3 });

  // Once STOP lifts, start again starts the session and records nothing more.
  const waker = fakeWaker();
  const again = await act(START, { client: fake.client, wakerFor: waker.wakerFor });
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /^add-export was started already, but its session had not begun\.$/m);
  assert.deepEqual(waker.starts, [{ work: 'add-export', worktree: wt }]);
  assert.equal(fake.writes.length, 1);
}));

test('start gives a known plan to the brief of work in one slice', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: startViews() });
  const r = await act([...START, '--plan', 'docs/plans/x.md'], { client: fake.client, wakerFor: fakeWaker().wakerFor });
  assert.equal(r.code, 0, r.err);
  const { fields } = parseBrief(fs.readFileSync(featurePaths(path.join(checkout, '.claude', 'worktrees', 'add-export')).brief, 'utf8'));
  assert.equal(fields.plan, 'docs/plans/x.md');
}));

test('under Shape 2 start passes on the waker\'s START line', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: startViews(), cfg: config({ watcherShape: 2 }) });
  const r = await act(START, {
    client: fake.client,
    wakerFor: (cfg, print) => makeWaker({ shape: cfg.watcherShape, project: P, config: cfg, print, stopped: () => false }),
  });
  assert.equal(r.code, 0, r.err);
  const wt = path.join(checkout, '.claude', 'worktrees', 'add-export');
  assert.match(r.out, new RegExp(`^START feature add-export ${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
}));

test('start makes its branch and worktree afresh, refusing ones no recorded feature made', () => withHome(async () => {
  const checkout = await project({ git: true });
  const wt = path.join(checkout, '.claude', 'worktrees', 'add-export');
  // Git runs in the main checkout with hooks, fsmonitor, and system and global config off.
  const gitCalls = [];
  const run = (file, args, opts) => { gitCalls.push({ file, args, opts }); return runProgram(file, args, opts); };

  // A branch an agent made in the shared repository is not taken over.
  await g(checkout, 'branch', 'feature/add-export');
  const fake = fakeClient({ views: startViews() });
  const branchThere = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor, run });
  refusedInOneLine(branchThere);
  assert.match(branchThere.err, /The branch feature\/add-export is there already, but no recorded feature made it/);
  await g(checkout, 'branch', '-D', 'feature/add-export');

  // Nor is a folder in the worktree's place.
  fs.mkdirSync(wt, { recursive: true });
  const folderThere = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor, run });
  refusedInOneLine(folderThere);
  assert.match(folderThere.err, /is there already, but no recorded feature made it/);
  fs.rmSync(wt, { recursive: true });
  assert.equal(fake.writes.length, 0);

  const made = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor, run });
  assert.equal(made.code, 0, made.err);
  assert.equal(branchOf(wt), 'feature/add-export');
  assert.ok(gitCalls.length > 0);
  for (const call of gitCalls) {
    assert.equal(call.file, 'git');
    assert.equal(call.opts.cwd, checkout);
    assert.deepEqual(call.args.slice(0, 4), ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false']);
    assert.equal(call.opts.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(call.opts.env.GIT_CONFIG_GLOBAL, '/dev/null');
  }
}));

test('start refuses a repository whose config sets a filter or an include, before git runs (R93)', () => withHome(async () => {
  const checkout = await project({ git: true });
  const config = path.join(checkout, '.git', 'config');
  const plain = fs.readFileSync(config, 'utf8');
  for (const section of ['[filter "lfs"]\n\tsmudge = sh -c evil\n', '[include]\n\tpath = ../x\n', '[includeIf "gitdir:/x/"]\n\tpath = y\n', '[Filter.lfs]\n\tclean = x\n']) {
    fs.writeFileSync(config, `${plain}${section}`);
    const gitCalls = [];
    const fake = fakeClient({ views: startViews() });
    const r = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor, run: (...a) => { gitCalls.push(a); return runProgram(...a); } });
    refusedInOneLine(r);
    assert.match(r.err, /\.git\/config sets/, section);
    assert.equal(gitCalls.length, 0, 'git never ran');
    assert.equal(fake.writes.length, 0);
  }
  fs.writeFileSync(config, plain);
  const fake = fakeClient({ views: startViews() });
  assert.equal((await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor })).code, 0);
}));

test('start refuses a main checkout whose .git is a file, whose config lives elsewhere (R93)', () => withHome(async () => {
  const checkout = await project();
  fs.rmSync(path.join(checkout, '.git'), { recursive: true });
  fs.writeFileSync(path.join(checkout, '.git'), 'gitdir: /somewhere/else/.git/worktrees/x\n');
  const gitCalls = [];
  const fake = fakeClient({ views: startViews() });
  const r = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor, run: (...a) => { gitCalls.push(a); return runProgram(...a); } });
  refusedInOneLine(r);
  assert.match(r.err, /\.git isn't a folder of its own/);
  assert.equal(gitCalls.length, 0);
  assert.equal(fake.writes.length, 0);
}));

test('start refuses what it may not start, in one line, and writes nothing', () => withHome(async () => {
  await project({ git: true });
  const views = startViews();
  views.work.unapproved = workView('unapproved', { approved: false });
  views.work['quick-held'] = workView('quick-held', { lane: 'quick', approved: false });
  for (const w of ['b1', 'b2', 'b3']) {
    views.work[w] = workView(w, { lane: 'quick', approved: false, since: '2026-10-19T06:00:00.000Z' });
    views.features[w] = featureView(w, { step: 'building' });
  }
  const fake = fakeClient({ views });
  const cases = [
    [['start', 'Bad_Id', '--goal', 'g'], /work id/],
    [['start', 'missing', ...START.slice(2)], /no work named missing/],
    [['start', 'unapproved', ...START.slice(2, -2)], /not approved/],
    [['start', 'quick-held', ...START.slice(2, -2)], /no building slot is free/],
    [['start', 'add-export', ...START.slice(2, -2), '--ruling', 'r-2'], /r-2 is not an accepted ruling/],
    [['start', 'add-export', '--done', 'x', '--appetite-sessions', '1', '--appetite-tokens', '5'], /--goal is needed/],
    [['start', 'add-export', '--goal', 'g', '--appetite-sessions', '1', '--appetite-tokens', '5'], /--done/],
    [['start', 'add-export', '--goal', 'g', '--done', 'x', '--appetite-sessions', 'one', '--appetite-tokens', '5'], /--appetite-sessions/],
    [['start', 'add-export', '--goal', 'g', '--done', 'x', '--appetite-sessions', '1', '--appetite-tokens', '5', '--colour', 'red'], /--colour/],
  ];
  for (const [argv, why] of cases) {
    const r = await act(argv, { client: fake.client, wakerFor: fakeWaker().wakerFor });
    refusedInOneLine(r);
    assert.match(r.err, why, argv.join(' '));
  }
  assert.equal(fake.writes.length, 0);
}));

test('small work held for pace may open a session to plan (R60)', () => withHome(async () => {
  await project({ git: true });
  const views = startViews();
  for (const w of ['b1', 'b2', 'b3']) {
    views.work[w] = workView(w, { since: '2026-10-19T06:00:00.000Z' });
    views.features[w] = featureView(w, { step: 'building' });
  }
  const fake = fakeClient({ views });
  const r = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^It is held \(no building slot is free \(pace\)\), so its session plans and then waits\.$/m);

  // Bug work has no plan, so starting it is building: held, it doesn't start (R89).
  fake.views.work['a-bug'] = workView('a-bug', { lane: 'bug', approved: false });
  const bug = await act(['start', 'a-bug', ...START.slice(2, -2)], { client: fake.client, wakerFor: fakeWaker().wakerFor });
  refusedInOneLine(bug);
  assert.match(bug.err, /a-bug can't start: no building slot is free \(pace\)/);
}));

// --- plan-ready, build, pause and resume ---

async function planScene({ otherFiles = ['src/other.js'], building = 1 } = {}) {
  const checkout = await project();
  const views = emptyViews();
  for (let n = 1; n <= building; n += 1) {
    const w = `other-${n}`;
    views.work[w] = workView(w, { since: '2026-10-19T06:00:00.000Z' });
    views.features[w] = featureView(w, { step: 'building', worktree: worktree(checkout, w), files: otherFiles });
  }
  views.work.mine = workView('mine');
  const wt = worktree(checkout, 'mine', { plan: { path: 'docs/plans/mine.md', files: ['src/mine.js', 'package.json'] } });
  views.features.mine = featureView('mine', { step: 'started', worktree: wt, branch: 'feature/mine', brief: HASH });
  return { checkout, views, wt };
}

test('plan-ready records the plan and, when it clears, the go-ahead to build', () => withHome(async () => {
  const { views, wt } = await planScene();
  const fake = fakeClient({ views });
  const r = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  const carried = { work: 'mine', worktree: wt, branch: 'feature/mine', plan: 'docs/plans/mine.md', files: ['src/mine.js', 'package.json'] };
  assert.deepEqual(fake.writes.map((w) => w.data), [{ ...carried, step: 'planned' }, { ...carried, step: 'building' }]);
  assert.ok(fake.writes.every((w) => w.data.brief === undefined), 'no go-ahead carries a brief (R85)');
  everyWriteHandledFirst(fake.writes);
  assert.equal(r.out, 'Recorded the plan of mine: docs/plans/mine.md, 2 files.\nmine may build: recorded building, so its session is woken with build.\n');

  // Again: it is building that plan already.
  const again = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(again.code, 0, again.err);
  assert.equal(again.out, 'mine is building this plan already.\n');
  assert.equal(fake.writes.length, 2);
}));

test('plan-ready records a plan that clashes, or has no slot, and says why it waits', () => withHome(async () => {
  const { views } = await planScene({ otherFiles: ['package.json'] });
  const fake = fakeClient({ views });
  const r = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(fake.writes.map((w) => w.data.step), ['planned']);
  assert.match(r.out, /^mine waits: its plan touches package\.json, which other-1 is changing \(a hot file\)\.$/m);
  // Again: the plan is recorded already; it still waits.
  const again = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(fake.writes.length, 1);
  assert.match(again.out, /^mine waits: /m);

  const paced = await planScene({ building: 3 });
  const fake2 = fakeClient({ views: paced.views });
  const p = await act(['plan-ready', 'mine'], { client: fake2.client });
  assert.match(p.out, /^mine waits: no building slot is free \(pace\)\.$/m);
}));

test('while an incident is open or STOP is on, start, build and resume refuse, plan-ready records and waits, and only the fix merges (R95)', () => withHome(async () => {
  const { checkout, views, wt } = await planScene();
  views.incidents = { open: [{ id: 'site-down', what: 'The site is down', at: '2026-10-19T08:00:00.000Z', fixes: [7] }] };
  views.work['add-export'] = workView('add-export');
  views.work.held = workView('held');
  views.features.held = featureView('held', { step: 'planned', worktree: worktree(checkout, 'held'), plan: 'p.md', files: [] });
  views.work.rest = workView('rest');
  views.features.rest = featureView('rest', { step: 'paused', pausedFor: 'five-hour', worktree: worktree(checkout, 'rest'), plan: 'p.md', files: [] });
  views.work.m = workView('m');
  views.features.m = featureView('m', { step: 'building', worktree: worktree(checkout, 'm', { pr: { pr: 6, plan: 'a.md' } }) });
  views.work.x = workView('x');
  views.features.x = featureView('x', { step: 'building', worktree: worktree(checkout, 'x', { pr: { pr: 7, plan: 'b.md' } }) });
  const fake = fakeClient({ views, answers: { updateBranch: { ok: true } } });
  const waker = fakeWaker();

  const start = await act(START, { client: fake.client, wakerFor: waker.wakerFor });
  refusedInOneLine(start);
  assert.match(start.err, /^add-export can't start while incident site-down is open: start nothing and give no go-ahead\. Nothing to do until it is over$/m);
  assert.equal(waker.starts.length, 0);
  refusedInOneLine(await act(['build', 'held'], { client: fake.client }));
  const resumed = await act(['resume', 'rest'], { client: fake.client });
  refusedInOneLine(resumed);
  assert.match(resumed.err, /^rest can't resume while incident site-down is open/);
  assert.equal(fake.writes.length, 0);

  // The plan is kept as planned, so the queue offers build once the incident is over.
  const planned = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(planned.code, 0, planned.err);
  assert.equal(planned.out, 'Recorded the plan of mine: docs/plans/mine.md, 2 files.\nmine waits: incident site-down is open.\n');
  assert.deepEqual(fake.writes.map((w) => w.data.step), ['planned']);

  // Only the incident's recorded fix merges.
  const frozen = await act(['merge', 'm'], { client: fake.client });
  refusedInOneLine(frozen);
  assert.match(frozen.err, /^Pull request #6 for m can't merge while incident site-down is open: only an incident's fix merges\. Nothing to do until it is over$/m);
  assert.deepEqual(fake.calls.map(([name]) => name), ['prState']);
  assert.equal((await act(['merge', 'x'], { client: fake.client })).out, 'Merged pull request #7 for x at cccccccccccc.\n');

  // STOP holds everything, the fix too.
  setStop({ by: 'prompt' });
  views.incidents = { open: [] };
  const stopped = fakeClient({ views, answers: { updateBranch: { ok: true } } });
  const s = await act(START, { client: stopped.client, wakerFor: waker.wakerFor });
  assert.match(s.err, /^add-export can't start while STOP is on/m);
  fs.writeFileSync(featurePaths(views.features.x.data.worktree).pr, JSON.stringify({ pr: 7, plan: 'b.md' }));
  assert.match((await act(['merge', 'x'], { client: stopped.client })).err, /^Pull request #7 for x can't merge while STOP is on/m);
  assert.equal(stopped.writes.length, 0);
}));

test('build and resume give the go-ahead once a wait clears; pause records the pause; each again does nothing', () => withHome(async () => {
  const { views, wt } = await planScene({ building: 3 });
  views.features.mine = featureView('mine', { step: 'planned', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['src/mine.js'] });
  const fake = fakeClient({ views });
  const held = await act(['build', 'mine'], { client: fake.client });
  assert.equal(held.code, 0, held.err);
  assert.equal(held.out, 'mine waits: no building slot is free (pace).\n');
  assert.equal(fake.writes.length, 0);

  // A slot frees.
  fake.views.features['other-3'] = featureView('other-3', { step: 'closed' });
  const built = await act(['build', 'mine'], { client: fake.client });
  assert.equal(built.out, 'mine may build: recorded building, so its session is woken with build.\n');
  assert.deepEqual(fake.writes.at(-1).data, { work: 'mine', step: 'building', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['src/mine.js'] });
  assert.equal((await act(['build', 'mine'], { client: fake.client })).out, 'mine is building already.\n');

  // The foreman's own pause is for the five-hour window.
  const paused = await act(['pause', 'mine'], { client: fake.client });
  assert.equal(paused.out, 'Paused mine.\n');
  assert.deepEqual(fake.writes.at(-1).data, {
    work: 'mine', step: 'paused', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['src/mine.js'], pausedFor: 'five-hour',
  });
  assert.equal((await act(['pause', 'mine'], { client: fake.client })).out, 'mine is paused already.\n');

  const resumed = await act(['resume', 'mine'], { client: fake.client });
  assert.equal(resumed.out, 'mine may build: recorded building, so its session is woken with build.\n');
  assert.equal(fake.writes.at(-1).data.step, 'building');
  assert.equal((await act(['resume', 'mine'], { client: fake.client })).out, 'mine is building already.\n');
  everyWriteHandledFirst(fake.writes);

  // Refusals.
  fake.views.features.planning = featureView('planning', { step: 'started', worktree: wt });
  fake.views.work.planning = workView('planning');
  refusedInOneLine(await act(['build', 'planning'], { client: fake.client }));
  refusedInOneLine(await act(['resume', 'planning'], { client: fake.client }));
  refusedInOneLine(await act(['build', 'nobody'], { client: fake.client }));
  refusedInOneLine(await act(['pause', 'nobody'], { client: fake.client }));
}));

test('a director\'s pause is lifted only by their amendment: build and resume refuse it', () => withHome(async () => {
  const { views, wt } = await planScene();
  for (const pausedFor of ['director', undefined]) {
    views.features.mine = featureView('mine', {
      step: 'paused', worktree: wt, plan: 'p.md', files: ['src/mine.js'], ...(pausedFor ? { pausedFor } : {}),
    });
    const fake = fakeClient({ views: structuredClone(views) });
    for (const command of ['build', 'resume']) {
      const r = await act([command, 'mine'], { client: fake.client });
      refusedInOneLine(r);
      assert.match(r.err, /paused by the director: only their amendment beginning "Resume" lifts it/, `${command} ${pausedFor}`);
    }
    assert.equal(fake.writes.length, 0);
  }
  // The foreman's own pause for the five-hour window doesn't replace the director's, but the director's replaces it.
  views.features.mine = featureView('mine', { step: 'paused', worktree: wt, plan: 'p.md', files: [], pausedFor: 'director' });
  const fake = fakeClient({ views });
  assert.equal((await act(['pause', 'mine'], { client: fake.client })).out, 'mine is paused already.\n');
  assert.equal(fake.writes.length, 0);
}));

test('a paused feature keeps its pause when its plan arrives, and one paused before it planned goes back to planning on resume', () => withHome(async () => {
  const { views, wt } = await planScene();
  views.features.mine = featureView('mine', { step: 'paused', worktree: wt, branch: 'feature/mine', pausedFor: 'five-hour' });
  const fake = fakeClient({ views });
  const resumed = await act(['resume', 'mine'], { client: fake.client });
  assert.equal(resumed.out, 'Resumed mine: it had no plan yet, so it goes back to planning.\n');
  assert.deepEqual(fake.writes.at(-1).data, { work: 'mine', step: 'started', worktree: wt, branch: 'feature/mine' });

  fake.views.features.mine = featureView('mine', { step: 'paused', worktree: wt, branch: 'feature/mine', pausedFor: 'director' });
  const r = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(r.out, 'Recorded the plan of mine: docs/plans/mine.md, 2 files.\nmine is paused: its plan waits until it is resumed.\n');
  assert.deepEqual(fake.writes.at(-1).data, {
    work: 'mine', step: 'paused', worktree: wt, branch: 'feature/mine', plan: 'docs/plans/mine.md', files: ['src/mine.js', 'package.json'], pausedFor: 'director',
  });
  assert.equal((await act(['plan-ready', 'mine'], { client: fake.client })).out, 'mine is paused: its plan waits until it is resumed.\n');
  assert.equal(fake.writes.length, 2);
}));

test('a slice\'s next plan waits while its pull request is open, then the slice moves on, and the last slice\'s merge reads done (R88)', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine', { lane: 'feature' });
  const wt = worktree(checkout, 'mine', { brief: { lane: 'feature', slices: 2 } });
  const p = featurePaths(wt);
  for (const n of [1, 2]) {
    fs.mkdirSync(path.join(wt, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'docs', 'plans', `slice-${n}.md`), planText([`src/slice-${n}.js`]));
  }
  views.features.mine = featureView('mine', {
    step: 'building', worktree: wt, branch: 'feature/mine', slice: { n: 1, m: 2 }, plan: 'docs/plans/slice-1.md', files: ['src/slice-1.js'],
  });
  const fake = fakeClient({ views, answers: { updateBranch: { ok: true } } });
  const phase = () => buildStatus({
    worktree: wt, now, answered: () => new Set(), slice: () => fake.views.features.mine.data.slice,
  }).phase;

  // Slice 1's pull request is open, and the session has recorded slice 2's plan, as the lane says.
  fs.writeFileSync(p.pr, JSON.stringify({ pr: 5, plan: 'docs/plans/slice-1.md' }));
  fs.writeFileSync(p.plan, JSON.stringify({ plan: 'docs/plans/slice-2.md' }));
  assert.equal(phase(), 'pr-open');
  const early = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(early.code, 0, early.err);
  assert.equal(early.out, 'mine waits: its pull request #5 is still open; the next plan is checked once it merges.\n');
  assert.equal(fake.writes.length, 0, 'nothing is recorded while the pull request is open');

  // The merge marks pr.json; the status reads ready-to-build, which raises plan-ready again.
  assert.equal((await act(['merge', 'mine'], { client: fake.client })).code, 0);
  assert.equal(phase(), 'ready-to-build');
  const r = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(fake.writes.map((w) => w.data), [
    { work: 'mine', step: 'planned', worktree: wt, branch: 'feature/mine', slice: { n: 2, m: 2 }, plan: 'docs/plans/slice-2.md', files: ['src/slice-2.js'] },
    { work: 'mine', step: 'building', worktree: wt, branch: 'feature/mine', slice: { n: 2, m: 2 }, plan: 'docs/plans/slice-2.md', files: ['src/slice-2.js'] },
  ]);
  // Again: it is building slice 2's plan; the slice doesn't move again.
  assert.equal((await act(['plan-ready', 'mine'], { client: fake.client })).out, 'mine is building this plan already.\n');
  refusedInOneLine(await act(['plan-ready', 'mine', '--slice', '2'], { client: fake.client }));

  // Slice 2's pull request opens with the report written, and merges: the feature is done.
  fs.writeFileSync(p.pr, JSON.stringify({ pr: 6, plan: 'docs/plans/slice-2.md' }));
  fs.writeFileSync(p.report, reportText('mine'));
  assert.equal(phase(), 'pr-open');
  assert.equal((await act(['merge', 'mine'], { client: fake.client })).code, 0);
  assert.equal(phase(), 'done');
}));

test('build waits while the feature\'s own pull request is open', () => withHome(async () => {
  const { views, wt } = await planScene();
  views.features.mine = featureView('mine', { step: 'planned', worktree: wt, plan: 'docs/plans/mine.md', files: [] });
  fs.writeFileSync(featurePaths(wt).pr, JSON.stringify({ pr: 5, plan: 'docs/plans/old.md' }));
  const fake = fakeClient({ views });
  const r = await act(['build', 'mine'], { client: fake.client });
  assert.equal(r.out, 'mine waits: its pull request #5 is still open; the next plan is checked once it merges.\n');
  assert.equal(fake.writes.length, 0);
}));

// --- questions ---

const QUESTION = {
  id: 'q-mine-1', kind: 'question', what: 'Which date format?', why: 'Users read it', options: [{ label: 'UK', says: '19 October 2026' }, { label: 'ISO', says: '2026-10-19' }], recommendation: 'UK', level: 3,
};
const EXTRA = {
  id: 'q-mine-2', kind: 'extra-plan', what: 'Export as PDF too', why: 'It is separate work', options: [{ label: 'queue', says: 'Queue it' }, { label: 'drop', says: 'Leave it out' }], recommendation: 'queue', level: 2, plan: 'docs/plans/pdf.md',
};

async function questionScene() {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine', { lane: 'feature', visible: true, doc: { path: 'docs/specs/mine.md', hash: HASH } });
  const wt = worktree(checkout, 'mine', {
    questions: [QUESTION, EXTRA, { ...QUESTION, id: `q-mine-${FOREMAN_QUESTIONS + 1}` }],
  });
  views.features.mine = featureView('mine', { step: 'building', worktree: wt });
  return { checkout, views, wt };
}

test('question copies the feature\'s question line into state unchanged, once', () => withHome(async () => {
  const { views } = await questionScene();
  const fake = fakeClient({ views });
  const r = await act(['question', 'mine', 'q-mine-1'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  const { kind, ...asked } = QUESTION;
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [['question', { ...asked, work: 'mine' }]]);
  everyWriteHandledFirst(fake.writes);
  assert.equal(r.out, 'Recorded question q-mine-1 for the director.\n');
  assert.equal((await act(['question', 'mine', 'q-mine-1'], { client: fake.client })).out, 'Question q-mine-1 is recorded already.\n');
  assert.equal(fake.writes.length, 1);

  for (const argv of [['question', 'mine', 'q-mine-2'], ['question', 'mine', 'q-mine-9'], ['question', 'mine', `q-mine-${FOREMAN_QUESTIONS + 1}`], ['question', 'mine', 'q-other-1'], ['question', 'mine']]) {
    refusedInOneLine(await act(argv, { client: fake.client }));
  }
  assert.equal(fake.writes.length, 1);
}));

test('extra-plan queues the plan as work of its own, with the parent\'s lane, visibility and document', () => withHome(async () => {
  const { views } = await questionScene();
  const fake = fakeClient({ views });
  const r = await act(['extra-plan', 'mine', 'q-mine-2'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [['work', {
    id: 'mine-x2', title: 'Export as PDF too', lane: 'feature', visible: true, dependsOn: [], doc: { path: 'docs/specs/mine.md', hash: HASH }, parent: 'mine',
  }]]);
  everyWriteHandledFirst(fake.writes);
  assert.match(r.out, /^Queued mine-x2 \(feature\), an extra plan of mine: Export as PDF too\.$/m);
  assert.match(r.out, /^Its plan is docs\/plans\/pdf\.md in mine's worktree\. It needs the director's approval to start\.$/m);
  assert.equal((await act(['extra-plan', 'mine', 'q-mine-2'], { client: fake.client })).out, 'mine-x2 is queued already.\n');
  assert.equal(fake.writes.length, 1);
  refusedInOneLine(await act(['extra-plan', 'mine', 'q-mine-1'], { client: fake.client }));

  // A long work id still makes a short slug of its own, the same each time.
  const long = 'a'.repeat(38);
  assert.ok(extraPlanId(long, `q-${long}-12`).length <= 40);
  assert.equal(extraPlanId(long, `q-${long}-12`), extraPlanId(long, `q-${long}-12`));
  assert.notEqual(extraPlanId(long, `q-${long}-12`), extraPlanId(`${'a'.repeat(37)}b`, `q-${'a'.repeat(37)}b-12`));
}));

test('ask records the foreman\'s own question with an id the feature can never use', () => withHome(async () => {
  const { views } = await questionScene();
  const fake = fakeClient({ views });
  const argv = ['ask', 'mine', '--what', 'mine has made no progress for 20 minutes', '--why', 'It may be stuck on a prompt',
    '--option', 'wait=Leave it a while', '--option', 'stop=Close it', '--recommend', 'wait', '--level', '2'];
  const r = await act(argv, { client: fake.client });
  assert.equal(r.code, 0, r.err);
  const id = `q-mine-${FOREMAN_QUESTIONS + 1}`;
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [['question', {
    id, work: 'mine', what: 'mine has made no progress for 20 minutes', why: 'It may be stuck on a prompt',
    options: [{ label: 'wait', says: 'Leave it a while' }, { label: 'stop', says: 'Close it' }], recommendation: 'wait', level: 2,
  }]]);
  everyWriteHandledFirst(fake.writes);
  assert.equal(r.out, `Asked the director: ${id}.\n`);
  assert.equal((await act(argv, { client: fake.client })).out, `The director was asked this already: ${id}.\n`);
  const other = await act([...argv.slice(0, 3), 'Another question', ...argv.slice(4)], { client: fake.client });
  assert.equal(other.out, `Asked the director: q-mine-${FOREMAN_QUESTIONS + 2}.\n`);

  for (const bad of [
    ['ask', 'mine', '--what', 'x', '--why', 'y', '--option', 'a=1', '--recommend', 'a', '--level', '2'],
    ['ask', 'mine', '--what', 'x', '--why', 'y', '--option', 'a=1', '--option', 'b=2', '--recommend', 'c', '--level', '2'],
    ['ask', 'mine', '--what', 'x', '--why', 'y', '--option', 'a=1', '--option', 'b=2', '--recommend', 'a', '--level', '5'],
    ['ask', 'nobody', '--what', 'x', '--why', 'y', '--option', 'a=1', '--option', 'b=2', '--recommend', 'a', '--level', '2'],
  ]) refusedInOneLine(await act(bad, { client: fake.client }));
}));

// --- amend ---

// The director's signed amend click, and the amendment it names, in the state clone.
function recordAmend(work, change, hash, at) {
  try {
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
  } catch (error) {
    if (!/already exists/.test(error.message)) throw error; // made by an earlier call
  }
  const put = (event) => {
    const file = path.join(stateDir(P), eventPath(event));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(event));
  };
  put(makeEvent({ kind: 'amendment', data: { work, change, hash }, now: () => new Date(at - 1000) }));
  put(makeEvent({ kind: 'action', data: { action: 'amend', question: 'Change it?', label: `Change the approved ${work} to this, ${hash.slice(0, 12)}`, work, hash }, now: () => new Date(at) }));
}

test('amend records the amended brief\'s hash before it writes the brief, at the feature\'s own step', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine');
  const wt = worktree(checkout, 'mine');
  const before = fs.readFileSync(featurePaths(wt).brief, 'utf8');
  views.features.mine = featureView('mine', { step: 'building', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['a.js'] });
  // The brief the foreman recorded at start; the go-ahead after it carries none (R85).
  recordInState('feature', { work: 'mine', step: 'started', worktree: wt, brief: briefHash(before) }, T0 - 120000);
  recordInState('feature', { work: 'mine', step: 'building', worktree: wt }, T0 - 90000);
  recordAmend('mine', 'Make the export CSV, not Excel', 'b'.repeat(64), T0 - 60000);
  const fake = fakeClient({ views });
  const fileAtWrite = [];
  const write = fake.client.state.write;
  fake.client.state.write = async (body) => {
    fileAtWrite.push(fs.readFileSync(featurePaths(wt).brief, 'utf8'));
    return write(body);
  };
  const r = await act(['amend', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  const after = fs.readFileSync(featurePaths(wt).brief, 'utf8');
  assert.equal(parseBrief(after).fields.version, 2);
  assert.match(after, /^- 19 October 2026 \(version 2\): Make the export CSV, not Excel$/m);
  assert.deepEqual(fake.writes.map((w) => w.data), [{
    work: 'mine', step: 'building', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['a.js'], brief: briefHash(after),
  }]);
  assert.deepEqual(fileAtWrite, [before], 'the hash was recorded while the file still held the brief before');
  everyWriteHandledFirst(fake.writes);
  assert.equal(r.out, `Amended mine's brief to version 2 (${briefHash(after).slice(0, 12)}); its session is woken with brief-changed.\n`);

  const again = await act(['amend', 'mine'], { client: fake.client });
  assert.equal(again.out, 'mine\'s brief has this amendment already.\n');
  assert.equal(fake.writes.length, 1);
  assert.equal(fs.readFileSync(featurePaths(wt).brief, 'utf8'), after);

  // Stopped after the hash was recorded and before the file was written: the repeat writes the file only.
  fs.writeFileSync(featurePaths(wt).brief, before);
  const midway = await act(['amend', 'mine'], { client: fake.client });
  assert.equal(midway.code, 0, midway.err);
  assert.equal(fake.writes.length, 1);
  assert.equal(fs.readFileSync(featurePaths(wt).brief, 'utf8'), after);
}));

test('amend refuses a brief the session changed, records nothing and leaves the file', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine');
  const wt = worktree(checkout, 'mine');
  const recorded = fs.readFileSync(featurePaths(wt).brief, 'utf8');
  views.features.mine = featureView('mine', { step: 'building', worktree: wt });
  recordInState('feature', { work: 'mine', step: 'started', worktree: wt, brief: briefHash(recorded) }, T0 - 120000);
  recordAmend('mine', 'Make the export CSV, not Excel', 'b'.repeat(64), T0 - 60000);
  // The session rewrote its own brief, even putting the change in itself.
  const changed = recorded.replace('The goal.', 'A goal of the session\'s own.');
  for (const text of [changed, amendBrief(changed, { change: 'Make the export CSV, not Excel', now: new Date(T0 - 60000) })]) {
    fs.writeFileSync(featurePaths(wt).brief, text);
    const fake = fakeClient({ views: structuredClone(views) });
    const r = await act(['amend', 'mine'], { client: fake.client });
    refusedInOneLine(r);
    assert.match(r.err, /mine's brief isn't the one recorded, so it was not amended: ask the director/);
    assert.equal(fake.writes.length, 0);
    assert.equal(fs.readFileSync(featurePaths(wt).brief, 'utf8'), text);
  }
}));

test('an amendment that says to pause pauses the feature, and one that says to resume resumes it; none refuses', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine');
  const wt = worktree(checkout, 'mine');
  views.features.mine = featureView('mine', { step: 'building', worktree: wt, plan: 'p.md', files: [] });
  const fake = fakeClient({ views });
  refusedInOneLine(await act(['amend', 'mine'], { client: fake.client }));

  recordAmend('mine', 'Pause it until the pricing is settled', 'c'.repeat(64), T0 - 60000);
  const brief = fs.readFileSync(featurePaths(wt).brief, 'utf8');
  const r = await act(['amend', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'The amendment says to pause: paused mine.\n');
  assert.deepEqual(fake.writes.map((w) => w.data.step), ['paused']);
  assert.equal(fake.writes[0].data.pausedFor, 'director');
  assert.equal(fs.readFileSync(featurePaths(wt).brief, 'utf8'), brief, 'the brief is not changed');
  refusedInOneLine(await act(['resume', 'mine'], { client: fake.client }));

  recordAmend('mine', 'Resume it', 'd'.repeat(64), T0 - 30000);
  const resumed = await act(['amend', 'mine'], { client: fake.client });
  assert.equal(resumed.out, 'The amendment says to resume: mine may build: recorded building, so its session is woken with build.\n');
  assert.deepEqual(fake.writes.map((w) => w.data.step), ['paused', 'building']);
}));

// --- merge and close ---

test('merge brings the pull request up to date, then merges it; a refusal is one line for the director, never tried again', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine');
  const wt = worktree(checkout, 'mine', { pr: { pr: 12, plan: 'docs/plans/a.md' } });
  views.features.mine = featureView('mine', { step: 'building', worktree: wt });
  const kept = () => JSON.parse(fs.readFileSync(featurePaths(wt).pr, 'utf8'));

  const refused = fakeClient({ views });
  const r = await act(['merge', 'mine'], { client: refused.client });
  refusedInOneLine(r);
  assert.match(r.err.trim(), /^Pull request #12 for mine couldn't be brought up to date: unknown request\. Ask the director; don't try again\.$/);
  assert.deepEqual(refused.calls.map(([name]) => name), ['prState', 'updateBranch']);
  assert.deepEqual(kept(), { pr: 12, plan: 'docs/plans/a.md' });

  const gate = fakeClient({ views, answers: { updateBranch: { ok: true }, merge: { ok: false, refused: 'no signed CLEAN review on the head commit' } } });
  const no = await act(['merge', 'mine'], { client: gate.client });
  refusedInOneLine(no);
  assert.match(no.err.trim(), /^Pull request #12 for mine was not merged: no signed CLEAN review on the head commit\. Ask the director; don't try again\.$/);
  assert.equal(kept().merged, undefined);

  const ok = fakeClient({ views, answers: { updateBranch: { ok: true } } });
  const merged = await act(['merge', 'mine'], { client: ok.client });
  assert.equal(merged.code, 0, merged.err);
  assert.equal(merged.out, 'Merged pull request #12 for mine at cccccccccccc.\n');
  assert.deepEqual(ok.calls.map(([name, body]) => [name, body]), [['prState', { project: P, number: 12 }], ['updateBranch', { project: P, number: 12 }], ['merge', { project: P, number: 12 }]]);
  // pr.json marks the merge, so the status moves on (R88).
  assert.deepEqual(kept(), { pr: 12, plan: 'docs/plans/a.md', merged: true });

  // Merged already (a stop after the merge, before pr.json was marked): it is marked now.
  fs.writeFileSync(featurePaths(wt).pr, JSON.stringify({ pr: 12, plan: 'docs/plans/a.md' }));
  const done = fakeClient({ views, answers: { prState: { ok: true, result: { state: 'merged' } } } });
  assert.equal((await act(['merge', 'mine'], { client: done.client })).out, 'Pull request #12 for mine is merged already.\n');
  assert.deepEqual(kept(), { pr: 12, plan: 'docs/plans/a.md', merged: true });

  views.features.nopr = featureView('nopr', { step: 'building', worktree: worktree(checkout, 'nopr') });
  refusedInOneLine(await act(['merge', 'nopr'], { client: ok.client }));
}));

test('close records the report with every ruling, then closes the feature and forgets its session', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine');
  const rulings = ['Ruling: dates show as day month year', 'Ruling: the export streams'];
  const wt = worktree(checkout, 'mine', { pr: { pr: 12, merged: true }, rulings, report: reportText('mine', { pr: 99, rulings }) });
  views.features.mine = featureView('mine', { step: 'building', worktree: wt, branch: 'feature/mine' });
  fs.mkdirSync(path.dirname(sessionFile(P, 'mine')), { recursive: true });
  fs.writeFileSync(sessionFile(P, 'mine'), '{}');
  const fake = fakeClient({ views, answers: { prState: { ok: true, result: { state: 'merged' } } } });
  const r = await act(['close', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  // The pull request is pr.json's, never the one the report names.
  assert.deepEqual(fake.calls, [['prState', { project: P, number: 12 }]]);
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [
    ['report', { work: 'mine', outcome: 'merged', summary: 'Shipped the export. Tests pass.', rulings, pr: 12 }],
    ['feature', { work: 'mine', step: 'closed', worktree: wt, branch: 'feature/mine' }],
  ]);
  everyWriteHandledFirst(fake.writes);
  assert.equal(fs.existsSync(sessionFile(P, 'mine')), false);
  assert.ok(fs.existsSync(featurePaths(wt).pr), 'pr.json is left as it is');
  assert.equal(r.out, 'Recorded mine\'s report (merged, 2 rulings) and closed it.\n');
  assert.equal((await act(['close', 'mine'], { client: fake.client })).out, 'mine is closed already.\n');
  assert.equal(fake.writes.length, 2);
}));

test('close works out the outcome, and refuses a report that is missing or incomplete, naming what is missing', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  const add = (work, opts) => {
    views.work[work] = workView(work);
    views.features[work] = featureView(work, { step: 'building', worktree: worktree(checkout, work, opts) });
  };
  add('blocked', { report: reportText('blocked', { status: 'blocked' }) });
  add('partial', { report: reportText('partial', { status: 'partial' }) });
  add('none', {});
  add('short', { report: '```json\n{"v":1,"work":"short","status":"done"}\n```\n\nText.\n' });
  add('unruled', { rulings: ['Ruling: kept'], report: reportText('unruled') });
  add('open', { pr: 7, report: reportText('open', { pr: 7 }) });
  const fake = fakeClient({ views });

  assert.equal((await act(['close', 'blocked'], { client: fake.client })).code, 0);
  assert.equal(fake.writes.at(-2).data.outcome, 'blocked');
  assert.equal((await act(['close', 'partial'], { client: fake.client })).code, 0);
  assert.equal(fake.writes.at(-2).data.outcome, 'closed');
  assert.equal((await act(['close', 'open'], { client: fake.client })).code, 0);
  assert.equal(fake.writes.at(-2).data.outcome, 'closed', 'an open pull request is not merged');

  // `merged` needs both pr.json's mark and the host's word.
  add('unmarked', { pr: 8, report: reportText('unmarked') });
  add('marked', { pr: { pr: 9, merged: true }, report: reportText('marked') });
  const hostSaysMerged = fakeClient({ views, answers: { prState: { ok: true, result: { state: 'merged' } } } });
  const unmarked = await act(['close', 'unmarked'], { client: hostSaysMerged.client });
  refusedInOneLine(unmarked);
  assert.match(unmarked.err, /merged, but not through act merge/);
  const marked = await act(['close', 'marked'], { client: fake.client });
  refusedInOneLine(marked);
  assert.match(marked.err, /pr\.json says pull request #9 merged, but the host says it hasn't/);
  assert.equal(hostSaysMerged.writes.length, 0);

  const n = fake.writes.length;
  const none = await act(['close', 'none'], { client: fake.client });
  refusedInOneLine(none);
  assert.match(none.err, /report\.md is not there/);
  const short = await act(['close', 'short'], { client: fake.client });
  refusedInOneLine(short);
  assert.match(short.err, /lacks the fields: tests, assumptions, concerns, rulings/);
  const unruled = await act(['close', 'unruled'], { client: fake.client });
  refusedInOneLine(unruled);
  assert.match(unruled.err, /A ruling is missing from the report's rulings: Ruling: kept/);
  assert.equal(fake.writes.length, n);
}));

test('every command checks the work id, and an unknown command is refused', () => withHome(async () => {
  await project();
  const fake = fakeClient({ views: emptyViews() });
  for (const command of ['start', 'plan-ready', 'build', 'pause', 'resume', 'question', 'extra-plan', 'ask', 'amend', 'merge', 'close']) {
    const r = await act([command, '../x'], { client: fake.client });
    refusedInOneLine(r);
    assert.match(r.err, /work id/, command);
  }
  refusedInOneLine(await act(['launch', 'x'], { client: fake.client }));
  refusedInOneLine(await act([], { client: fake.client }));
  assert.equal(fake.writes.length, 0);
}));
