// tests/probes/haiku-trial/faults.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { faults, featureEnvOf, sessionEnv, STUCK_WHY } from '../../../probes/haiku-trial/faults.js';
import { STUCK_AFTER } from '../../../scripts/feature/cli.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { tempFolder } from '../../helpers/homes.js';
import { makeFeatureFolder } from '../../helpers/made-feature.js';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;

// A feature worktree made by hand, as tests/scripts/feature/cli.test.js does: a .git folder and the brief.
function feature() {
  const tree = fs.realpathSync.native(tempFolder('wh-faults-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/login-page\n');
  const brief = {
    v: 1, work: 'login-page', lane: 'feature', version: 1, goal: 'Let people sign in', done: ['Sign in works'],
    appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true,
  };
  write(featurePaths(tree).brief, `${fence(brief)}\nThe brief.\n`);
  return tree;
}
const run = (command, args, opts) => spawnSync(command, args, { ...opts, encoding: 'utf8' });

test('f1 gets exit 2 and a send-back', () => {
  const tree = feature();
  const got = faults.f1WrongShape({ env: process.env, cwd: tree, run });
  assert.equal(got.code, 2, got.stdout);
  assert.equal(got.sentBack, true);
});

test('f1b is stuck by the STUCK_AFTER-th try', () => {
  const tree = feature();
  const got = faults.f1bStuck({ env: process.env, cwd: tree, run });
  assert.ok(got.stuckAt <= STUCK_AFTER);
  assert.equal(got.tries.at(-1).stuck, true);
  assert.ok(got.tries.length <= STUCK_AFTER);
  assert.equal(got.why, STUCK_WHY);
  assert.equal(got.stuckCode, 0, 'the stuck message was sent');
  const lines = fs.readFileSync(featurePaths(tree).questions, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.at(-1).stuck, true);
  assert.equal(lines.at(-1).why, STUCK_WHY);
});

test('f1c is refused and points to ask', () => {
  const tree = feature();
  const got = faults.f1cDirectorKind({ env: process.env, cwd: tree, run });
  assert.notEqual(got.code, 0);
  assert.match(got.text, /"behaviour" is the director's to decide/);
  assert.match(got.text, /ask --about behaviour --level 3/);
});

// A project with feature worktrees made as Wheelhouse leaves them: .git on feature/<slug> and a brief whose work is the slug.
const project = fs.realpathSync.native(tempFolder('wh-faults-project-'));
function worktree(slug, folder = slug) {
  const tree = path.join(project, '.wheelhouse', 'worktrees', folder);
  write(path.join(tree, '.git', 'HEAD'), `ref: refs/heads/feature/${slug}\n`);
  makeFeatureFolder(tree, slug);
  return tree;
}
// PWD is what the watcher had, not the session's folder; the folder comes from `cwds`, the stand-in for `lsof -d cwd`.
const cwds = new Map();
const cwdOf = async (pid) => cwds.get(pid) ?? null;
const LINE = (pid, cwd) => {
  cwds.set(pid, cwd);
  return { pid, ppid: 1, pgid: pid, command: `claude -p --model haiku WHEELHOUSE_ENGINE_RUN=1 WHEELHOUSE_SESSION=s${pid} PWD=/stale/watcher/folder HOME=/h` };
};
const p1 = worktree('p1-import');
const p10 = worktree('p10-other');
const spaced = worktree('p2-categories', 'with space');
const elsewhere = fs.realpathSync.native(tempFolder('wh-faults-elsewhere-'));
write(path.join(elsewhere, '.git', 'HEAD'), 'ref: refs/heads/feature/p1-import\n');
makeFeatureFolder(elsewhere, 'p1-import');
const FOREMAN = { pid: 200, ppid: 1, pgid: 200, command: 'claude -p WHEELHOUSE_ROLE=foreman WHEELHOUSE_SESSION=foreman-ledger' };
const table = async () => [LINE(101, p1), LINE(110, p10), LINE(102, spaced), LINE(103, elsewhere), { pid: 104, ppid: 1, pgid: 104, command: 'node server.js' }, FOREMAN];

test('f3 kills only the named piece\'s session', async () => {
  const kills = [];
  const got = await faults.f3KillFeature({ project, piece: 'p1', listProcesses: table, cwdOf, kill: (pid, sig) => kills.push([pid, sig]) });
  assert.deepEqual(got, { pid: 101 });
  assert.deepEqual(kills, [[101, 'SIGKILL']]);
});

test('f3b kills only the foreman', async () => {
  const kills = [];
  const got = await faults.f3bKillForeman({ project, listProcesses: table, cwdOf, kill: (pid, sig) => kills.push([pid, sig]) });
  assert.deepEqual(got, { pid: 200 });
  assert.deepEqual(kills, [[200, 'SIGKILL']]);
});

test('a piece that names no session is said, and p1 does not match a p10 slug', async () => {
  const only10 = async () => [LINE(110, p10)];
  await assert.rejects(faults.f3KillFeature({ project, piece: 'p1', listProcesses: only10, cwdOf, kill: () => assert.fail('killed') }), /p1/);
  assert.equal((await featureEnvOf({ project, piece: 'p10', listProcesses: only10, cwdOf })).cwd, p10);
});

test('a process outside the project is not found', async () => {
  await assert.rejects(featureEnvOf({ project, piece: 'p1', listProcesses: async () => [LINE(103, elsewhere)], cwdOf }), /p1/);
});

test('a folder with a brief that does not match its branch is not a feature session', async () => {
  const odd = worktree('p5-other', 'odd');
  makeFeatureFolder(odd, 'something-else');
  await assert.rejects(featureEnvOf({ project, piece: 'p5', listProcesses: async () => [LINE(5, odd)], cwdOf }), /p5/);
});

test('featureEnvOf reads the worktree from the process, not PWD, and keeps PATH and HOME beside the WHEELHOUSE variables', async () => {
  const got = await featureEnvOf({ project, piece: 'p1', listProcesses: table, cwdOf });
  assert.equal(got.env.WHEELHOUSE_ENGINE_RUN, '1');
  assert.equal(got.env.WHEELHOUSE_SESSION, 's101');
  assert.equal(got.env.HOME, '/h', "the session's own HOME wins");
  assert.equal(typeof got.env.PATH, 'string');
  assert.notEqual(got.cwd, '/stale/watcher/folder');
  assert.equal(got.cwd, p1);
  const withSpace = await featureEnvOf({ project, piece: 'p2', listProcesses: table, cwdOf });
  assert.equal(withSpace.cwd, spaced);
  assert.ok(withSpace.cwd.includes(' '));
});

test('sessionEnv fills PATH and HOME from the base when the session lacks them', () => {
  assert.deepEqual(sessionEnv({ WHEELHOUSE_SESSION: 's' }, { PATH: '/bin', HOME: '/home/x', SECRET: 'no' }), { PATH: '/bin', HOME: '/home/x', WHEELHOUSE_SESSION: 's' });
});

test('typed commands go through the front desk', () => {
  const typed = [];
  const tmux = { type: (name, text) => typed.push([name, text]) };
  faults.f6AllStop(tmux);
  faults.undoTyped(tmux, 'abc123');
  faults.liftTyped(tmux);
  assert.deepEqual(typed.map(([, text]) => text), ['all stop', 'undo abc123', 'lift all stop']);
  assert.deepEqual([...new Set(typed.map(([name]) => name))], ['desk'], 'the run\'s own prefix is added by the tmux layer');
});

test('decisionFallback asks the spec\'s question at level 3', () => {
  const calls = [];
  const tree = tempFolder('wh-faults-empty-');
  const fake = (command, args, opts) => { calls.push({ command, args, opts }); return { status: 0, stdout: 'q-x-1\n' }; };
  faults.decisionFallback({ env: { A: 'b' }, cwd: tree, run: fake });
  assert.equal(calls.length, 1);
  const { args } = calls[0];
  assert.ok(args.includes('Should moving one transaction also make a rule for that shop?'));
  assert.equal(args[args.indexOf('--about') + 1], 'behaviour');
  assert.equal(args[args.indexOf('--level') + 1], '3');
  assert.equal(args.filter((a) => a === '--option').length, 2);
  assert.equal(args.filter((a) => a === '--cost').length, 2);
  assert.equal(args.filter((a) => a === '--undo').length, 2);
  for (const flag of ['--recommend', '--because', '--meanwhile']) assert.ok(args.includes(flag), flag);
  assert.deepEqual(calls[0].opts.env, { A: 'b' });
  assert.equal(calls[0].opts.cwd, tree);
});

test('decisionFallback skips when the question is already in the trail, and an unrelated decision does not suppress it', () => {
  const tree = feature();
  const other = faults.secondDecision({ env: process.env, cwd: tree, run });
  assert.equal(other.code, 0, other.stdout);
  const never = () => assert.fail('asked again');
  const raised = faults.decisionFallback({ env: process.env, cwd: tree, run });
  assert.equal(raised.raised, true, raised.stdout);
  assert.deepEqual(faults.decisionFallback({ env: process.env, cwd: tree, run: never }), { raised: false, skipped: true });
});

test('secondDecision raises a right-shaped decision with its own text', () => {
  const tree = feature();
  const got = faults.secondDecision({ env: process.env, cwd: tree, run });
  assert.equal(got.code, 0, got.stdout);
});

test('thirdDecision raises a right-shaped decision of its own', () => {
  const tree = feature();
  const got = faults.thirdDecision({ env: process.env, cwd: tree, run });
  assert.equal(got.code, 0, got.stdout);
});

test('reviewDecision raises the card as a decision and naturalSendBacks counts a session\'s own send-backs', () => {
  const tree = feature();
  assert.equal(faults.naturalSendBacks({ cwd: tree }), 0);
  faults.f1WrongShape({ env: process.env, cwd: tree, run });
  assert.equal(faults.naturalSendBacks({ cwd: tree }), 1);
  assert.equal(faults.naturalSendBacks({ cwd: path.join(tree, 'nowhere') }), null);
  const card = {
    what: 'Check the tracker', why: 'It is the director\'s call', recommend: 'Tag it',
    options: [{ label: 'Tag it', says: 'Tag the release', cost: 'none', undo: 'yes' }, { label: 'Hold it', says: 'Hold the tag', cost: 'the tag waits', undo: 'yes' }],
    because: 'the score passed', meanwhile: 'nothing builds',
  };
  const got = faults.reviewDecision({ env: process.env, cwd: tree, card, run });
  assert.equal(got.code, 0, got.stdout);
});

// The layout the real runs had: a feature's worktree is <project>/.claude/worktrees/<work>, and Wheelhouse records the
// running session under the project's NAME.
function claudeWorktree(work, sub = '') {
  const tree = path.join(project, '.claude', 'worktrees', work);
  write(path.join(tree, '.git'), `gitdir: /somewhere/.git/worktrees/${work}\n`);
  makeFeatureFolder(tree, work);
  return sub === '' ? tree : path.join(tree, sub);
}

test('a feature session in .claude/worktrees is found by its running record', async () => {
  const tree = claudeWorktree('p1-import-bank-csv');
  const kills = [];
  const rows = async () => [LINE(301, tree)];
  const recorded = () => [{ work: 'p1-import-bank-csv', pid: 301, at: '2026-11-09T01:00:00Z' }];
  const got = await faults.f3KillFeature({ project, name: 'owner__repo', piece: 'p1', listProcesses: rows, cwdOf, recorded, kill: (pid, sig) => kills.push([pid, sig]) });
  assert.deepEqual(got, { pid: 301 });
  assert.deepEqual(kills, [[301, 'SIGKILL']]);
});

test('a recorded session whose process is a wrapper is killed through its claude -p child', async () => {
  const tree = claudeWorktree('p2-export-year');
  cwds.set(402, tree);
  const rows = async () => [{ pid: 401, ppid: 1, pgid: 401, command: 'node waker.js' }, { pid: 402, ppid: 401, pgid: 401, command: 'claude -p --model haiku WHEELHOUSE_SESSION=s402 HOME=/h' }];
  const recorded = () => [{ work: 'p2-export-year', pid: 401, at: 'x' }];
  const got = await featureEnvOf({ project, name: 'owner__repo', piece: 'p2', listProcesses: rows, cwdOf, recorded });
  assert.equal(got.cwd, tree);
  assert.equal(got.env.WHEELHOUSE_SESSION, 's402');
});

test('a claude -p in .claude/worktrees is found without a record, by its folder name', async () => {
  const tree = claudeWorktree('p3-tags');
  const got = await featureEnvOf({ project, piece: 'p3', listProcesses: async () => [LINE(501, claudeWorktree('p3-tags', 'src'))], cwdOf });
  assert.equal(got.cwd, claudeWorktree('p3-tags', 'src'), 'the process folder, not the worktree root');
  assert.ok(tree);
});

test('p1 does not match a recorded p10 session', async () => {
  const recorded = () => [{ work: 'p10-other', pid: 601, at: 'x' }];
  await assert.rejects(faults.f3KillFeature({ project, name: 'owner__repo', piece: 'p1', listProcesses: async () => [], cwdOf, recorded, kill: () => assert.fail('killed') }), /p1/);
});

// A feature session runs as a `claude -p` only for the length of one turn: the watcher removes its running record when the run
// ends and starts another at the next wake. Between runs there is no process and no running record, only the session record
// the watcher keeps (watcher/sessions/<work>.json), and the feature command still works from the worktree.
test('a work between runs is found by the watcher session record, with the home in its environment', async () => {
  const tree = claudeWorktree('month-page');
  const worktrees = () => [{ work: 'month-page', worktree: tree, sessionId: 's1', at: '2026-11-11T01:36:32.872Z' }];
  const got = await featureEnvOf({
    project, name: 'owner__repo', piece: 'month-page', listProcesses: async () => [], cwdOf, recorded: () => [], worktrees,
  });
  assert.equal(got.cwd, tree);
  assert.equal(got.env.WHEELHOUSE_HOME, process.env.WHEELHOUSE_HOME);
  assert.equal(got.env.PATH, process.env.PATH);
});

test('a session record names the work by whole hyphen segments, and a kill needs a process', async () => {
  const worktrees = () => [{ work: 'month-page', worktree: claudeWorktree('month-page'), sessionId: 's1', at: 'x' }];
  await assert.rejects(featureEnvOf({ project, name: 'owner__repo', piece: 'mont', listProcesses: async () => [], cwdOf, recorded: () => [], worktrees }), /mont/);
  await assert.rejects(featureEnvOf({ project, name: 'owner__repo', piece: 'page-x', listProcesses: async () => [], cwdOf, recorded: () => [], worktrees }), /page-x/);
  await assert.rejects(
    faults.f3KillFeature({ project, name: 'owner__repo', piece: 'month-page', listProcesses: async () => [], cwdOf, recorded: () => [], worktrees, kill: () => assert.fail('killed') }),
    /month-page/,
  );
});
