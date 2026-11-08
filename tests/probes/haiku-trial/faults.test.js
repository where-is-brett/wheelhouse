// tests/probes/haiku-trial/faults.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { faults, featureEnvOf } from '../../../probes/haiku-trial/faults.js';
import { STUCK_AFTER } from '../../../scripts/feature/cli.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { tempFolder } from '../../helpers/homes.js';

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
});

test('f1c is refused and points to ask', () => {
  const tree = feature();
  const got = faults.f1cDirectorKind({ env: process.env, cwd: tree, run });
  assert.notEqual(got.code, 0);
  assert.match(got.text, /"behaviour" is the director's to decide/);
  assert.match(got.text, /ask --about behaviour --level 3/);
});

const LINE = (pid, session, extra = '') => ({ pid, ppid: 1, pgid: pid, command: `claude -p --model haiku WHEELHOUSE_ROLE=feature WHEELHOUSE_SESSION=${session} PWD=/work/${session} ${extra}` });

test('f3 kills only the named piece\'s session', async () => {
  const kills = [];
  const listProcesses = async () => [LINE(101, 'p1-import'), LINE(102, 'p2-categories'), { pid: 103, ppid: 1, pgid: 103, command: 'node server.js' }];
  const got = await faults.f3KillFeature({ project: 'ledger', piece: 'p1-import', listProcesses, kill: (pid, sig) => kills.push([pid, sig]) });
  assert.deepEqual(got, { pid: 101 });
  assert.deepEqual(kills, [[101, 'SIGKILL']]);
});

test('f3b kills only the foreman', async () => {
  const kills = [];
  const listProcesses = async () => [LINE(101, 'p1-import'), { pid: 200, ppid: 1, pgid: 200, command: 'claude -p WHEELHOUSE_ROLE=foreman WHEELHOUSE_SESSION=foreman-ledger' }];
  const got = await faults.f3bKillForeman({ project: 'ledger', listProcesses, kill: (pid, sig) => kills.push([pid, sig]) });
  assert.deepEqual(got, { pid: 200 });
  assert.deepEqual(kills, [[200, 'SIGKILL']]);
});

test('f3 says so when the piece has no session', async () => {
  await assert.rejects(faults.f3KillFeature({ project: 'x', piece: 'nope', listProcesses: async () => [LINE(1, 'other')], kill: () => {} }), /nope/);
});

test('featureEnvOf copies WHEELHOUSE variables and the worktree', async () => {
  const listProcesses = async () => [
    LINE(7, 'p3-categories-two'),
    { pid: 8, ppid: 1, pgid: 8, command: 'claude -p WHEELHOUSE_ROLE=feature WHEELHOUSE_SESSION=p9 PWD=/work/p9 HOME=/h' },
  ];
  const got = await featureEnvOf({ project: 'ledger', piece: 'p3-categories-two', listProcesses });
  assert.equal(got.env.WHEELHOUSE_SESSION, 'p3-categories-two');
  assert.equal(got.env.WHEELHOUSE_ROLE, 'feature');
  assert.equal(got.cwd, '/work/p3-categories-two');
  assert.equal(got.env.HOME, undefined, 'only the WHEELHOUSE variables are copied');
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

test('secondDecision raises a right-shaped decision with its own text', () => {
  const tree = feature();
  const got = faults.secondDecision({ env: process.env, cwd: tree, run });
  assert.equal(got.code, 0, got.stdout);
});
