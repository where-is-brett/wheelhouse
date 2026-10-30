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
import { main as copyMain } from '../../../scripts/engine/order-copy.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';
import { ownRunRules, projectSettings } from '../../../scripts/protection/settings.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';

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

test("a named test runs alone under Node's own runner, which reads a bare word as a file (check 81)", async (t) => {
  // A run under this suite's runner would report to it and end 0 whatever its tests did.
  const context = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  t.after(() => { if (context !== undefined) process.env.NODE_TEST_CONTEXT = context; });
  const cwd = tempFolder('wh-done-');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'p', private: true, scripts: { test: 'node --test' } }));
  fs.mkdirSync(path.join(cwd, 'tests'));
  fs.writeFileSync(path.join(cwd, 'tests', 'greet.test.js'), [
    "const { test } = require('node:test');",
    "test('greet says hello (with the switch off)', () => {});",
    "test('greet says good day', () => { throw new Error('not yet'); });",
  ].join('\n'));
  for (const testCommand of ['npm test', 'node --test']) {
    const order = { ...orderWith([{ test: 'greet says hello (with the switch off)' }, { test: 'greet says good day' }]), testCommand };
    const results = await runDoneChecks(order, { cwd });
    assert.deepEqual(results.map((r) => r.ok), [true, false], `${testCommand}: ${results.map((r) => r.line).join('; ')}`);
  }
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

// The branch's own shared settings, as setup commits them, in a fresh worktree.
const SHARED = { permissions: { deny: ['Read(**/.env)'] }, sandbox: { enabled: true, allowUnsandboxedCommands: false, filesystem: { denyRead: ['~/.wheelhouse'], denyWrite: ['~/.claude'] } } };
const git = (args, cwd) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.excludesFile=/dev/null', ...args], { cwd, encoding: 'utf8' });
function sharedWorktree(shared = SHARED) {
  const worktree = tempFolder('wh-wt-');
  git(['init', '-q'], worktree);
  if (shared) {
    fs.mkdirSync(path.join(worktree, '.claude'));
    fs.writeFileSync(path.join(worktree, '.claude', 'settings.json'), `${JSON.stringify(shared, null, 2)}\n`);
    git(['add', '.'], worktree);
    git(['commit', '-q', '-m', 'shared settings'], worktree);
  }
  return worktree;
}
const readShared = (worktree) => JSON.parse(fs.readFileSync(path.join(worktree, '.claude', 'settings.json'), 'utf8'));

test("the first step merges the run's own overlay into the worktree's project settings, which Archon's steps read", async () => {
  const ws = tempFolder('wh-ws-');
  const dir = path.join(ws, 'artifacts', 'runs', 'run-7');
  const worktree = sharedWorktree();
  const client = { engine: { order: async () => ({ ok: true, order: orderWith([{ test: 'good' }]) }) } };
  assert.equal(await copyMain(['--run', 'run-7', '--out', dir, '--flags'], { client, cwd: worktree, out: () => {} }), 0);
  const settings = readShared(worktree);
  const overlay = ownRunRules('run-7', dir);
  // The shared guards stay, and the run's own lists are added to them.
  assert.deepEqual(settings.permissions.deny, SHARED.permissions.deny);
  assert.deepEqual(settings.permissions.allow, overlay.permissions.allow);
  assert.ok(settings.permissions.allow.some((rule) => rule.startsWith('Read(/') && rule.includes(path.join('artifacts', 'runs', 'run-7').replaceAll('\\', '/'))));
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(settings.sandbox.filesystem.denyRead, [...SHARED.sandbox.filesystem.denyRead, ...overlay.sandbox.filesystem.denyRead]);
  assert.deepEqual(settings.sandbox.filesystem.denyWrite, [...SHARED.sandbox.filesystem.denyWrite, ...overlay.sandbox.filesystem.denyWrite]);
  assert.deepEqual(settings.sandbox.filesystem.allowRead, overlay.sandbox.filesystem.allowRead);
  assert.deepEqual(settings.sandbox.filesystem.allowWrite, overlay.sandbox.filesystem.allowWrite);
  // Archon never reads the local settings, so none is written.
  assert.equal(fs.existsSync(path.join(worktree, '.claude', 'settings.local.json')), false);
  // No commit of the run's carries it, whatever it adds.
  fs.writeFileSync(path.join(worktree, 'work.txt'), 'done\n');
  assert.equal(git(['status', '--porcelain'], worktree), '?? work.txt\n');
  git(['add', '-A'], worktree);
  git(['commit', '-q', '-a', '-m', 'the run\'s work'], worktree);
  assert.deepEqual(JSON.parse(git(['show', 'HEAD:.claude/settings.json'], worktree)), SHARED);
  // A folder that isn't a run's own gets no overlay.
  const elsewhere = sharedWorktree();
  assert.equal(await copyMain(['--run', 'run-7', '--out', tempFolder('wh-art-')], { client, cwd: elsewhere, out: () => {} }), 0);
  assert.deepEqual(readShared(elsewhere), SHARED);
});

test("a second run in the same worktree gets its own overlay, never the earlier run's as well", async () => {
  const ws = tempFolder('wh-ws-');
  const worktree = sharedWorktree();
  const client = { engine: { order: async () => ({ ok: true, order: orderWith([{ test: 'good' }]) }) } };
  assert.equal(await copyMain(['--run', 'run-7', '--out', path.join(ws, 'artifacts', 'runs', 'run-7')], { client, cwd: worktree, out: () => {} }), 0);
  const second = path.join(ws, 'artifacts', 'runs', 'run-8');
  assert.equal(await copyMain(['--run', 'run-8', '--out', second], { client, cwd: worktree, out: () => {} }), 0);
  const settings = readShared(worktree);
  assert.deepEqual(settings.permissions.allow, ownRunRules('run-8', second).permissions.allow);
  assert.doesNotMatch(JSON.stringify(settings), /run-7/);
});

test("--release puts the branch's own shared settings back, so git can move the worktree to a commit that changes them", async () => {
  const ws = tempFolder('wh-ws-');
  const worktree = sharedWorktree();
  git(['switch', '-q', '-c', 'newer'], worktree);
  // A later commit changes the shared settings, as a rebase onto a newer main line would bring.
  fs.writeFileSync(path.join(worktree, '.claude', 'settings.json'), `${JSON.stringify({ ...SHARED, model: 'small' }, null, 2)}\n`);
  git(['commit', '-q', '-a', '-m', 'newer settings'], worktree);
  git(['switch', '-q', '-'], worktree);
  const client = { engine: { order: async () => ({ ok: true, order: orderWith([{ test: 'good' }]) }) } };
  assert.equal(await copyMain(['--run', 'run-7', '--out', path.join(ws, 'artifacts', 'runs', 'run-7')], { client, cwd: worktree, out: () => {} }), 0);
  assert.throws(() => git(['merge', '-q', '--ff-only', 'newer'], worktree), 'skip-worktree holds the file');
  const said = [];
  assert.equal(await copyMain(['--release'], { cwd: worktree, out: (line) => said.push(line) }), 0);
  assert.deepEqual(readShared(worktree), SHARED, "the branch's own settings are back");
  assert.doesNotMatch(git(['ls-files', '-v', '--', '.claude/settings.json'], worktree), /^S /, 'no longer skip-worktree');
  git(['merge', '-q', '--ff-only', 'newer'], worktree);
  assert.equal(readShared(worktree).model, 'small');
  // Nothing to release is no trouble.
  assert.equal(await copyMain(['--release'], { cwd: sharedWorktree(), out: () => {} }), 0);
  assert.equal(await copyMain(['--release'], { cwd: sharedWorktree(null), out: () => {} }), 0);
});

test("a branch without shared settings gets the run's overlay alone, kept out of git by the exclude list", async () => {
  const ws = tempFolder('wh-ws-');
  const worktree = sharedWorktree(null);
  fs.writeFileSync(path.join(worktree, 'README.md'), 'start\n');
  git(['add', '-A'], worktree);
  git(['commit', '-q', '-m', 'start'], worktree);
  const client = { engine: { order: async () => ({ ok: true, order: orderWith([{ test: 'good' }]) }) } };
  const first = path.join(ws, 'artifacts', 'runs', 'run-7');
  assert.equal(await copyMain(['--run', 'run-7', '--out', first], { client, cwd: worktree, out: () => {} }), 0);
  assert.deepEqual(readShared(worktree), ownRunRules('run-7', first));
  // No commit of the run's carries it, whatever it adds.
  fs.writeFileSync(path.join(worktree, 'work.txt'), 'done\n');
  assert.equal(git(['status', '--porcelain'], worktree), '?? work.txt\n');
  git(['add', '-A'], worktree);
  git(['commit', '-q', '-m', "the run's work"], worktree);
  assert.equal(git(['ls-tree', '-r', '--name-only', 'HEAD'], worktree), 'README.md\nwork.txt\n');
  // A second run in the same worktree gets its own lists, not the first run's as well.
  const second = path.join(ws, 'artifacts', 'runs', 'run-8');
  assert.equal(await copyMain(['--run', 'run-8', '--out', second], { client, cwd: worktree, out: () => {} }), 0);
  assert.deepEqual(readShared(worktree), ownRunRules('run-8', second));
  // The exclude line is written once.
  const exclude = path.resolve(worktree, git(['rev-parse', '--git-path', 'info/exclude'], worktree).trim());
  assert.equal(fs.readFileSync(exclude, 'utf8').split('\n').filter((l) => l === '/.claude/settings.json').length, 1);
});

test('the merged settings keep the shared rules that stop a step changing them', async () => {
  const ws = tempFolder('wh-ws-');
  const worktree = sharedWorktree(projectSettings(readConfig(null)));
  const client = { engine: { order: async () => ({ ok: true, order: orderWith([{ test: 'good' }]) }) } };
  assert.equal(await copyMain(['--run', 'run-7', '--out', path.join(ws, 'artifacts', 'runs', 'run-7')], { client, cwd: worktree, out: () => {} }), 0);
  const settings = readShared(worktree);
  assert.ok(settings.permissions.deny.includes('Edit(/.claude/settings.json)'));
  assert.ok(settings.sandbox.filesystem.denyWrite.includes('./.claude/settings.json'));
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
});

test("a merged settings file that can't be written stops the step with a plain refusal", { skip: process.platform === 'win32' }, async () => {
  const ws = tempFolder('wh-ws-');
  const worktree = sharedWorktree();
  fs.chmodSync(path.join(worktree, '.claude'), 0o555);
  const client = { engine: { order: async () => ({ ok: true, order: orderWith([{ test: 'good' }]) }) } };
  const { lines, out } = sink();
  try {
    assert.equal(await copyMain(['--run', 'run-7', '--out', path.join(ws, 'artifacts', 'runs', 'run-7')], { client, cwd: worktree, out }), 1);
  } finally { fs.chmodSync(path.join(worktree, '.claude'), 0o755); }
  assert.match(lines.join('\n'), /couldn't be written/);
  assert.deepEqual(fs.readdirSync(path.join(worktree, '.claude')), ['settings.json']);
});

test("the overlay is never written through a link a branch holds, and the step stops", async () => {
  const ws = tempFolder('wh-ws-');
  const dir = path.join(ws, 'artifacts', 'runs', 'run-7');
  const target = path.join(tempFolder('wh-target-'), 'settings.json');
  fs.writeFileSync(target, `${JSON.stringify(SHARED)}\n`);
  const kept = fs.readFileSync(target, 'utf8');
  const worktree = sharedWorktree();
  fs.rmSync(path.join(worktree, '.claude', 'settings.json'));
  fs.symlinkSync(target, path.join(worktree, '.claude', 'settings.json'));
  const client = { engine: { order: async () => ({ ok: true, order: orderWith([{ test: 'good' }]) }) } };
  const { lines, out } = sink();
  assert.equal(await copyMain(['--run', 'run-7', '--out', dir], { client, cwd: worktree, out }), 1);
  assert.equal(fs.readFileSync(target, 'utf8'), kept);
  assert.match(lines.join('\n'), /overlay/);
  const linked = sharedWorktree();
  fs.rmSync(path.join(linked, '.claude'), { recursive: true });
  fs.symlinkSync(path.dirname(target), path.join(linked, '.claude'));
  assert.equal(await copyMain(['--run', 'run-7', '--out', dir], { client, cwd: linked, out: () => {} }), 1);
  assert.equal(fs.readFileSync(target, 'utf8'), kept);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['settings.json']);
});
