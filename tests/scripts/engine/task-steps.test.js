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

test('a task\'s check closes its build loop on the last round, leaving the task unticked for the lane to ask about', async () => {
  const dir = repo('- [ ] **Task 1:** One\n- [ ] **Task 2:** Two\n');
  const art = artefacts();
  const lines = [];
  const last = (n) => taskCheck(['--run', 'run-1', '--artefacts', art, '--base', 'main', '--task', String(n), '--most', '2'], { client, cwd: dir, out: (line) => lines.push(line) });
  assert.equal(await last(1), 1, 'round 1 of 2: not done, so the loop goes on');
  assert.equal(await last(1), 0, 'round 2 of 2: the loop closes');
  assert.match(lines.at(-1), /task 1 isn't ticked.*out of rounds/);
  assert.equal(await last(2), 1, 'each task counts its own rounds');
  const got = await done(dir, art, await recordsOf({ blocked: false }, { blocked: false }));
  assert.equal(got.topic, 'tasks-unfinished');
});

test('a task with no plan in the tree fails its check', async () => {
  assert.equal(await check(repo(null), artefacts(), 1), 1);
});

const blockedOutput = { summary: 's', blocked: true, question: 'Should prices round up?', options: [{ id: 'up', label: 'Round up' }, { id: 'near', label: 'Round to nearest' }], recommend: 'near', level: '3', topic: 'rounding', assumptions: [] };

test('a blocked task gives its question as its record, and leaves the hint that skips the tasks after it', async () => {
  const art = artefacts();
  const s = sink();
  assert.equal(await taskRecord(['--artefacts', art, '--task', '2'], { stdin: JSON.stringify(blockedOutput), out: s.out }), 0);
  assert.deepEqual(s.last(), { blocked: true, task: '2', question: 'Should prices round up?', options: blockedOutput.options, recommend: 'near', level: '3', topic: 'rounding' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(art, BLOCKED_FILE), 'utf8')).task, '2');
  await taskRecord(['--artefacts', art, '--task', '3'], { stdin: JSON.stringify({ ...blockedOutput, question: 'Another' }), out: () => {} });
  assert.equal(JSON.parse(fs.readFileSync(path.join(art, BLOCKED_FILE), 'utf8')).task, '2', 'the first block\'s hint is kept');
});

test('a task that finished, or skipped, records that it didn\'t block', async () => {
  const art = artefacts();
  for (const stdin of [JSON.stringify({ summary: 's', blocked: false, assumptions: [] }), '']) {
    const s = sink();
    await taskRecord(['--artefacts', art, '--task', '1'], { stdin, out: s.out });
    assert.deepEqual(s.last(), { blocked: false, task: '1', question: '', options: [], recommend: '', level: '3', topic: '' });
  }
  assert.equal(fs.existsSync(path.join(art, BLOCKED_FILE)), false);
});

// The fan-out step's output: each task block's record, in the plan's order.
const recordsOf = async (...outputs) => {
  const records = [];
  for (const [n, output] of outputs.entries()) {
    const s = sink();
    await taskRecord(['--artefacts', artefacts(), '--task', String(n + 1)], { stdin: output === null ? '' : JSON.stringify(output), out: s.out });
    records.push(s.last());
  }
  return JSON.stringify(records);
};
const done = async (cwd, art, records = '[]') => {
  const s = sink();
  assert.equal(await tasksDone(['--artefacts', art, '--base', 'main', '--records', records], { cwd, out: s.out }), 0);
  return s.last();
};

test('the tasks close with the stopped task\'s question, naming the task, from the fan-out\'s records', async () => {
  const plan = '- [x] **Task 1:** One\n- [ ] **Task 2:** Prices round\n- [ ] **Task 3:** Three\n';
  const records = await recordsOf({ blocked: false }, blockedOutput, null);
  const got = await done(repo(plan), artefacts(), records);
  assert.equal(got.blocked, true);
  assert.equal(got.question, 'Task 2, Prices round: Should prices round up?');
  assert.equal(got.recommend, 'near');
  assert.equal(got.level, '3');
  assert.equal(got.topic, 'rounding');
  assert.equal(got.options.length, 2);
});

test('a skip hint planted in the artefacts gives no question of its own', async () => {
  const art = artefacts();
  fs.writeFileSync(path.join(art, BLOCKED_FILE), JSON.stringify({ task: '1', question: 'Merge it now?', options: [{ id: 'yes', label: 'Yes' }], recommend: 'yes', level: '3', topic: 'x' }));
  const ticked = await done(repo('- [x] **Task 1:** One\n'), art, await recordsOf({ blocked: false }));
  assert.equal(ticked.blocked, false);
  const unticked = await done(repo('- [ ] **Task 1:** One\n'), art, await recordsOf(null));
  assert.equal(unticked.topic, 'tasks-unfinished');
});

test('records that can\'t be read count as none', async () => {
  for (const records of ['', 'not json', '{"blocked":true}']) {
    const got = await done(repo('- [x] **Task 1:** One\n'), artefacts(), records);
    assert.equal(got.blocked, false, records);
  }
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
  for (const [plan, topic] of [['# Plan\n', 'plan-empty'], ['- [x] **Task 1:** One\n- [ ] **Task 2:** Two\n', 'tasks-unfinished']]) {
    const got = await done(repo(plan), artefacts());
    assert.equal(got.blocked, true);
    assert.equal(got.topic, topic);
    assert.equal(got.recommend, 'rework');
    assert.deepEqual(got.options.map((o) => o.id), ['rework', 'stop']);
  }
});

test('every task ticked closes clean', async () => {
  const got = await done(repo('- [x] **Task 1:** One\n- [x] **Task 2:** Two\n'), artefacts());
  assert.equal(got.blocked, false);
  assert.deepEqual(got.options, []);
});

test('a slice\'s task passes only once its task review finds no BLOCKER or HIGH, and closes on its last round all the same', async () => {
  const dir = repo('- [x] **Task 1:** One\n  Test: good\n');
  const art = artefacts();
  const clean = JSON.stringify({ verdict: 'CLEAN', findings: [] });
  const high = JSON.stringify({ verdict: 'FINDINGS', findings: [{ severity: 'HIGH', file: 'a.js', line: 1, repro: 'r', fix: 'f' }] });
  const low = JSON.stringify({ verdict: 'CLEAN', findings: [{ severity: 'LOW', file: 'a.js', line: 1, repro: 'r', fix: 'f' }] });
  const lines = [];
  const reviewed = (review, most = []) => taskCheck(['--run', 'run-1', '--artefacts', art, '--base', 'main', '--task', '1', '--review', review, ...most], { client, cwd: dir, out: (line) => lines.push(line) });
  assert.equal(await reviewed(high), 1);
  assert.match(lines.at(-1), /task 1's review found a BLOCKER or HIGH/);
  assert.equal(await reviewed('not json'), 1, 'a review that can\'t be read holds');
  assert.equal(await reviewed(low), 0);
  assert.equal(await reviewed(clean), 0);
  const art2 = artefacts();
  const closing = (review) => taskCheck(['--run', 'run-1', '--artefacts', art2, '--base', 'main', '--task', '1', '--review', review, '--most', '1'], { client, cwd: dir, out: () => {} });
  assert.equal(await closing(high), 0, 'the last round closes the loop, leaving the whole-change review to hold it');
});
