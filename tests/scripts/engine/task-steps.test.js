// tests/scripts/engine/task-steps.test.js
// The small lane's steps around each task (Archon design, section 7.2): a task's check (its loop's until_bash), its
// record (a blocked task stops the ones after it), and the close of the tasks, which raises the question of the task
// that stopped, or a card when the plan can't be taken or tasks were left unfinished.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as taskCheck } from '../../../scripts/engine/task-check.js';
import { main as taskRecord } from '../../../scripts/engine/task-record.js';
import { main as tasksDone } from '../../../scripts/engine/tasks-done.js';
import { PLAN_FILE, BLOCKED_FILE } from '../../../scripts/engine/plan-file.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { tempFolder } from '../../helpers/homes.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString();
const node = JSON.stringify(process.execPath);
const order = workOrder({ work: { id: 'card-1', lane: 'small', goal: 'Prices show two decimals', done: [{ command: 'true', expect: 0 }] }, config: { testCommand: `${node} -e "process.exit(process.argv[1] === 'good' ? 0 : 1)"` } });
const client = { engine: { order: async () => ({ ok: true, order }) } };

function repo(plan) {
  const dir = tempFolder('wh-task-');
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'wh/card-1');
  if (plan) {
    fs.writeFileSync(path.join(dir, PLAN_FILE), plan);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'plan');
  }
  return dir;
}
function artefacts() {
  const dir = tempFolder('wh-task-art-');
  fs.writeFileSync(path.join(dir, TICKET_FILE), `${'a'.repeat(64)}\n`);
  return dir;
}
function sink() {
  const lines = [];
  return { lines, out: (line) => lines.push(line), last: () => JSON.parse(lines.at(-1)) };
}
const check = (cwd, art, n) => taskCheck(['--run', 'run-1', '--artefacts', art, '--base', 'main', '--task', String(n)], { client, cwd, out: () => {} });

test('a task passes its check only when it is ticked, the tree is clean and its test passes', async () => {
  const dir = repo('- [ ] **Task 1:** One\n  Test: good\n- [x] **Task 2:** Two\n  Test: bad\n- [x] **Task 3:** Three\n');
  const art = artefacts();
  assert.equal(await check(dir, art, 1), 1, 'not ticked');
  assert.equal(await check(dir, art, 2), 1, 'its test fails');
  assert.equal(await check(dir, art, 3), 0, 'ticked, no test, clean');
  fs.writeFileSync(path.join(dir, 'loose.js'), 'x\n');
  assert.equal(await check(dir, art, 3), 1, 'a change not committed');
  fs.rmSync(path.join(dir, 'loose.js'));
  fs.writeFileSync(path.join(dir, PLAN_FILE), '- [x] **Task 1:** One\n  Test: good\n');
  git(dir, 'commit', '-qam', 'tick');
  assert.equal(await check(dir, art, 1), 0);
});

test('a task with no plan in the tree fails its check', async () => {
  assert.equal(await check(repo(null), artefacts(), 1), 1);
});

const blockedOutput = { summary: 's', blocked: true, question: 'Should prices round up?', options: [{ id: 'up', label: 'Round up' }, { id: 'near', label: 'Round to nearest' }], recommend: 'near', level: '3', topic: 'rounding', assumptions: [] };

test('a blocked task is recorded once, so the tasks after it skip', async () => {
  const art = artefacts();
  const s = sink();
  assert.equal(await taskRecord(['--artefacts', art, '--task', '2'], { stdin: JSON.stringify(blockedOutput), out: s.out }), 0);
  assert.deepEqual(s.last(), { blocked: true });
  const kept = JSON.parse(fs.readFileSync(path.join(art, BLOCKED_FILE), 'utf8'));
  assert.equal(kept.task, '2');
  assert.equal(kept.question, 'Should prices round up?');
  await taskRecord(['--artefacts', art, '--task', '3'], { stdin: JSON.stringify({ ...blockedOutput, question: 'Another' }), out: () => {} });
  assert.equal(JSON.parse(fs.readFileSync(path.join(art, BLOCKED_FILE), 'utf8')).task, '2', 'the first block wins');
});

test('a task that finished, or skipped, records nothing', async () => {
  const art = artefacts();
  for (const stdin of [JSON.stringify({ summary: 's', blocked: false, assumptions: [] }), '']) {
    const s = sink();
    await taskRecord(['--artefacts', art, '--task', '1'], { stdin, out: s.out });
    assert.deepEqual(s.last(), { blocked: false });
  }
  assert.equal(fs.existsSync(path.join(art, BLOCKED_FILE)), false);
});

const done = async (cwd, art) => {
  const s = sink();
  assert.equal(await tasksDone(['--artefacts', art, '--base', 'main'], { cwd, out: s.out }), 0);
  return s.last();
};

test('the tasks close with the stopped task\'s question', async () => {
  const art = artefacts();
  await taskRecord(['--artefacts', art, '--task', '2'], { stdin: JSON.stringify(blockedOutput), out: () => {} });
  const got = await done(repo('- [x] **Task 1:** One\n- [ ] **Task 2:** Two\n'), art);
  assert.equal(got.blocked, true);
  assert.equal(got.question, 'Should prices round up?');
  assert.equal(got.recommend, 'near');
  assert.equal(got.level, '3');
  assert.equal(got.topic, 'rounding');
  assert.equal(got.options.length, 2);
});

test('a plan of more than eight tasks closes with a card for the feature lane', async () => {
  const big = Array.from({ length: 9 }, (_, i) => `- [ ] **Task ${i + 1}:** Step`).join('\n');
  const got = await done(repo(big), artefacts());
  assert.equal(got.blocked, true);
  assert.equal(got.topic, 'plan-too-big');
  assert.equal(got.recommend, 'slice');
  assert.deepEqual(got.options.map((o) => o.id), ['slice', 'stop']);
});

test('a plan with no tasks, or tasks left unticked, closes with a card to send it back', async () => {
  for (const plan of ['# Plan\n', '- [x] **Task 1:** One\n- [ ] **Task 2:** Two\n']) {
    const got = await done(repo(plan), artefacts());
    assert.equal(got.blocked, true);
    assert.equal(got.topic, 'tasks-unfinished');
    assert.equal(got.recommend, 'rework');
    assert.deepEqual(got.options.map((o) => o.id), ['rework', 'stop']);
  }
});

test('every task ticked closes clean', async () => {
  const got = await done(repo('- [x] **Task 1:** One\n- [x] **Task 2:** Two\n'), artefacts());
  assert.equal(got.blocked, false);
  assert.deepEqual(got.options, []);
});
