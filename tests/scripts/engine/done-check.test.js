// tests/scripts/engine/done-check.test.js
// The done check (Archon design, section 11): the quick loop's until_bash. It asks the helper for the run's order by
// the run's id, runs each check in the worktree and passes only when every one does; the copy in the run's
// artefacts is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main, runDoneChecks } from '../../../scripts/engine/done-check.js';
import { main as copyMain, EXCLUDE_LINE as OVERLAY_LINE } from '../../../scripts/engine/order-copy.js';
import { EXCLUDE_LINE } from '../../../scripts/setup/project-files.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';
import { ownRunRules } from '../../../scripts/protection/settings.js';

const node = JSON.stringify(process.execPath);
const orderWith = (done, extra = {}) => workOrder({ work: { id: 'card-1', lane: 'quick', goal: 'A goal', done, ...extra }, config: { testCommand: `${node} -e "process.exit(process.argv[1] === 'good' ? 0 : 1)"` } });

function sink() {
  const lines = [];
  return { lines, out: (line) => lines.push(line) };
}

test('done-check reads the helper\'s order, not order.json', async () => {
  const cwd = tempFolder('wh-done-');
  const order = orderWith([{ command: `${node} -e "process.exit(0)"`, expect: 0 }]);
  // The run's artefacts hold a loosened copy: it is never read.
  fs.writeFileSync(path.join(cwd, 'order.json'), JSON.stringify({ ...order, done: [] }));
  const asked = [];
  const client = { engine: { order: async (args) => { asked.push(args); return { ok: true, order }; } } };
  const { lines, out } = sink();
  const code = await main(['--run', 'run-7'], { client, cwd, out });
  assert.equal(code, 0);
  assert.deepEqual(asked, [{ runId: 'run-7' }]);
  assert.match(lines.join('\n'), /pass/);
});

test('done-check exits 1 when one check fails and names it', async () => {
  const cwd = tempFolder('wh-done-');
  const order = orderWith([
    { test: 'good' },
    { test: 'bad' },
    { command: `${node} -e 'console.log("price A$12.00")'`, expect: 'A$12.00' },
    { command: `${node} -e "process.exit(3)"`, expect: 0 },
    { page: '/', mustShow: 'Hello' },
  ]);
  const client = { engine: { order: async () => ({ ok: true, order }) } };
  const { lines, out } = sink();
  const code = await main(['--run', 'run-7'], { client, cwd, out });
  assert.equal(code, 1);
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^pass: the test good/);
  assert.match(lines[1], /^fail: the test bad/);
  assert.match(lines[2], /^pass: /);
  assert.match(lines[3], /^fail: .*ended with 3, not 0/);
  assert.match(lines[4], /^left to the preview step: the page \/ shows Hello/);
  assert.match(lines[5], /2 of 5 checks failed/);
});

test('done-check fails closed when the helper has no order for the run', async () => {
  const client = { engine: { order: async () => ({ ok: false, refused: 'there is no work order for that run' }) } };
  const { lines, out } = sink();
  assert.equal(await main(['--run', 'run-x'], { client, cwd: tempFolder('wh-done-'), out }), 1);
  assert.match(lines.join('\n'), /no work order/);
  assert.equal(await main([], { client, cwd: tempFolder('wh-done-'), out }), 2);
});

test('runDoneChecks runs each command in the worktree it is given', async () => {
  const cwd = tempFolder('wh-done-');
  fs.writeFileSync(path.join(cwd, 'marker'), 'here');
  const results = await runDoneChecks(orderWith([{ command: `${node} -e "require('fs').statSync('marker')"`, expect: 0 }]), { cwd });
  assert.deepEqual(results.map((r) => r.ok), [true]);
});

test('the first step copies the helper\'s order into the artefacts and prints none of it', async () => {
  const dir = tempFolder('wh-art-');
  const order = orderWith([{ test: 'good' }]);
  const client = { engine: { order: async () => ({ ok: true, order }) } };
  const { lines, out } = sink();
  assert.equal(await copyMain(['--run', 'run-7', '--out', dir], { client, out }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'order.json'), 'utf8')), order);
  assert.doesNotMatch(lines.join('\n'), /A goal/);
});

test('with --flags the first step prints only whether the work is visible and shown first, for the pack to branch on', async () => {
  const dir = tempFolder('wh-art-');
  const order = orderWith([{ test: 'good' }], { visible: true });
  const client = { engine: { order: async () => ({ ok: true, order }) } };
  const { lines, out } = sink();
  assert.equal(await copyMain(['--run', 'run-7', '--out', dir, '--flags'], { client, out }), 0);
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ visible: true, showFirst: true }]);
  assert.ok(fs.existsSync(path.join(dir, 'order.json')));
});

test("the first step writes the run's own settings overlay in its worktree, so its Claude steps can read the order", async () => {
  const ws = tempFolder('wh-ws-');
  const dir = path.join(ws, 'artifacts', 'runs', 'run-7');
  const worktree = tempFolder('wh-wt-');
  execFileSync('git', ['init', '-q'], { cwd: worktree });
  const client = { engine: { order: async () => ({ ok: true, order: orderWith([{ test: 'good' }]) }) } };
  assert.equal(await copyMain(['--run', 'run-7', '--out', dir, '--flags'], { client, cwd: worktree, out: () => {} }), 0);
  // Kept out of git, so no commit of the run's can carry it.
  execFileSync('git', ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '-q', '.claude/settings.local.json'], { cwd: worktree });
  const overlay = JSON.parse(fs.readFileSync(path.join(worktree, '.claude', 'settings.local.json'), 'utf8'));
  assert.deepEqual(overlay, ownRunRules('run-7', dir));
  assert.ok(overlay.permissions.allow.some((rule) => rule.startsWith('Read(/') && rule.includes(path.join('artifacts', 'runs', 'run-7').replaceAll('\\', '/'))));
  // A folder that isn't a run's own gets no overlay.
  const elsewhere = tempFolder('wh-wt-');
  assert.equal(await copyMain(['--run', 'run-7', '--out', tempFolder('wh-art-')], { client, cwd: elsewhere, out: () => {} }), 0);
  assert.equal(fs.existsSync(path.join(elsewhere, '.claude', 'settings.local.json')), false);
});

test("the overlay's exclude line is setup's own", () => {
  assert.equal(OVERLAY_LINE, EXCLUDE_LINE);
});

test("the overlay is never written through a link a branch holds, and the step stops", async () => {
  const ws = tempFolder('wh-ws-');
  const dir = path.join(ws, 'artifacts', 'runs', 'run-7');
  const worktree = tempFolder('wh-wt-');
  execFileSync('git', ['init', '-q'], { cwd: worktree });
  const target = path.join(tempFolder('wh-target-'), 'settings.json');
  fs.writeFileSync(target, '{"kept":true}\n');
  fs.mkdirSync(path.join(worktree, '.claude'));
  fs.symlinkSync(target, path.join(worktree, '.claude', 'settings.local.json'));
  const client = { engine: { order: async () => ({ ok: true, order: orderWith([{ test: 'good' }]) }) } };
  const { lines, out } = sink();
  assert.equal(await copyMain(['--run', 'run-7', '--out', dir], { client, cwd: worktree, out }), 1);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"kept":true}\n');
  assert.match(lines.join('\n'), /overlay/);
  const linked = tempFolder('wh-wt-');
  execFileSync('git', ['init', '-q'], { cwd: linked });
  fs.symlinkSync(path.dirname(target), path.join(linked, '.claude'));
  assert.equal(await copyMain(['--run', 'run-7', '--out', dir], { client, cwd: linked, out: () => {} }), 1);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['settings.json']);
});
