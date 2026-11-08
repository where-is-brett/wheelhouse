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
