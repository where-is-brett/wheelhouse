// tests/scripts/engine/plan-file.test.js
// The small lane's plan file (Archon design, section 7.2): its tasks, read from the tree or, once the lane has taken
// it out before review, from the branch's history, so a run carried on over the branch finds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PLAN_FILE, MOST_TASKS, tasksOf, findPlan, main } from '../../../scripts/engine/plan-file.js';
import { tempFolder } from '../../helpers/homes.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString();

const PLAN = [
  '# Plan: prices show two decimals',
  '',
  '- [x] **Task 1:** Format a price',
  '  Test: formats a price with two decimals',
  '- [ ] **Task 2:** Show the price on the card',
  '  Files: src/card.js',
  '- [ ] **Task 3:** Show the price in the basket',
  '',
  '- [ ] a checkbox that is not a task',
].join('\n');

function repo(plan = PLAN) {
  const dir = tempFolder('wh-plan-');
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'wh/card-1');
  if (plan !== null) {
    fs.writeFileSync(path.join(dir, PLAN_FILE), plan);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'plan');
  }
  return dir;
}

async function cli(dir, ...argv) {
  const lines = [];
  const code = await main(argv, { cwd: dir, out: (line) => lines.push(line) });
  return { code, json: JSON.parse(lines.at(-1)) };
}

test('tasksOf reads each task, its tick and its test, and nothing else', () => {
  assert.deepEqual(tasksOf(PLAN), [
    { n: 1, title: 'Format a price', test: 'formats a price with two decimals', done: true },
    { n: 2, title: 'Show the price on the card', test: null, done: false },
    { n: 3, title: 'Show the price in the basket', test: null, done: false },
  ]);
  assert.deepEqual(tasksOf(''), []);
});

test('a task number given twice counts once, by its first line', () => {
  const tasks = tasksOf('- [ ] **Task 1:** One\n- [x] **Task 1:** Again\n- [ ] **Task 2:** Two\n');
  assert.deepEqual(tasks.map((t) => [t.n, t.title, t.done]), [[1, 'One', false], [2, 'Two', false]]);
});

test('findPlan finds the plan in the tree, then in the history once a commit took it out, else none', async () => {
  const dir = repo();
  assert.equal((await findPlan({ cwd: dir, base: 'main' })).where, 'tree');
  git(dir, 'rm', '-q', PLAN_FILE);
  git(dir, 'commit', '-qm', 'Take out the build plan');
  const found = await findPlan({ cwd: dir, base: 'main' });
  assert.equal(found.where, 'history');
  assert.equal(found.text, PLAN);
  assert.equal(await findPlan({ cwd: repo(null), base: 'main' }), null);
});

test('--gate says whether the branch has a plan', async () => {
  assert.deepEqual((await cli(repo(), '--gate', '--base', 'main')).json, { planned: true });
  assert.deepEqual((await cli(repo(null), '--gate', '--base', 'main')).json, { planned: false });
});

test('--tasks gives the unfinished tasks, and none for a plan the lane can\'t take', async () => {
  assert.deepEqual((await cli(repo(), '--tasks', '--base', 'main')).json, ['2', '3']);
  const big = Array.from({ length: MOST_TASKS + 1 }, (_, i) => `- [ ] **Task ${i + 1}:** Step ${i + 1}`).join('\n');
  const tooMany = repo(big);
  assert.deepEqual((await cli(tooMany, '--tasks', '--base', 'main')).json, []);
  assert.deepEqual((await cli(tooMany, '--problem', '--base', 'main')).json, { problem: 'too-many' });
  const none = repo('# Plan\n\nNo tasks here.\n');
  assert.deepEqual((await cli(none, '--tasks', '--base', 'main')).json, []);
  assert.deepEqual((await cli(none, '--problem', '--base', 'main')).json, { problem: 'none' });
  assert.deepEqual((await cli(repo(), '--problem', '--base', 'main')).json, { problem: null });
  assert.deepEqual((await cli(repo(null), '--problem', '--base', 'main')).json, { problem: 'none' });
});

test('--task <n> --gate skips a ticked task, and every task once one has blocked', async () => {
  const dir = repo();
  const artefacts = tempFolder('wh-plan-art-');
  assert.deepEqual((await cli(dir, '--task', '1', '--gate', '--base', 'main', '--artefacts', artefacts)).json, { skip: true });
  assert.deepEqual((await cli(dir, '--task', '2', '--gate', '--base', 'main', '--artefacts', artefacts)).json, { skip: false });
  fs.writeFileSync(path.join(artefacts, 'small-blocked.json'), '{}\n');
  assert.deepEqual((await cli(dir, '--task', '2', '--gate', '--base', 'main', '--artefacts', artefacts)).json, { skip: true });
});

test('a usage line, and exit 2, for a call with no base', async () => {
  const lines = [];
  assert.equal(await main(['--tasks'], { cwd: repo(), out: (line) => lines.push(line) }), 2);
  assert.match(lines[0], /^usage:/);
});
