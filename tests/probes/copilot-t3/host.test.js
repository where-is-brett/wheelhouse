// tests/probes/copilot-t3/host.test.js
// The real host's own parts, with no Copilot session: the throwaway project kept on this computer, the order's worktree, and the
// helper's local merge of a change a stand-in session committed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { realHost, buildPrompt } from '../../../probes/copilot-t3/host.js';
import { ORDER } from '../../../probes/copilot-t3/runner.js';

const started = [];
const stubHelper = async ({ home }) => { started.push(home); return { stop: async () => { started.push(`stop ${home}`); } }; };

test('the project is staged, the order gets a worktree, and a committed change merges through the local adapter', async (t) => {
  const was = process.env.WHEELHOUSE_HOME;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-real-')));
  t.after(() => {
    if (was === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = was;
    fs.rmSync(base, { recursive: true, force: true });
  });
  const host = realHost({ helper: stubHelper, label: 'unit', ghAccount: async () => { throw new Error('offline'); } });
  const { project } = await host.stage({ folder: base });
  assert.match(project, /copilot-t3-unit/);
  assert.deepEqual(started, [path.join(base, 'wheelhouse-home')]);
  await host.order(ORDER);
  const worktree = path.join(base, 'project', '.claude', 'worktrees', ORDER.work);
  assert.ok(fs.existsSync(worktree));
  // A merge with nothing committed is refused, in words.
  assert.deepEqual(await host.merge({ work: ORDER.work }), { merged: false, reason: 'The session left no commit' });
  fs.writeFileSync(path.join(worktree, 'src', 'greeting.js'), 'export const greet = (name) => `Hello, ${name}!`;\n');
  const got = await host.merge({ work: ORDER.work });
  assert.equal(got.merged, true, got.reason);
  await host.stop();
  await host.stop();
  assert.deepEqual(started, [path.join(base, 'wheelhouse-home'), `stop ${path.join(base, 'wheelhouse-home')}`]);
  assert.match(execFileSync('git', ['--git-dir', path.join(base, 'wheelhouse-home', 'projects', project, 'home.git'), 'show', 'main:src/greeting.js'], { encoding: 'utf8' }), /Hello/);
});

test('the build prompt names the goal and never a model', () => {
  const prompt = buildPrompt(ORDER);
  assert.ok(prompt.includes(ORDER.goal));
  assert.doesNotMatch(prompt, /--model|claude|gpt/i);
});

test('a resumed attempt that skips the stage gets its places back from the run folder, and writes nothing to the real usage folder', async (t) => {
  const was = process.env.WHEELHOUSE_HOME;
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-real-home-')));
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-attach-')));
  t.after(() => {
    if (was === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = was;
    fs.rmSync(real, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  });
  process.env.WHEELHOUSE_HOME = real;
  const account = async () => ({ quota_remaining: 100, quota_snapshots: { premium_interactions: { entitlement: 200, remaining: 100 } }, quota_reset_date: '2099-01-01' });
  const first = realHost({ helper: stubHelper, label: 'again', ghAccount: account });
  const { project } = await first.stage({ folder: base });
  await first.order(ORDER);
  // A new process: nothing in memory, and WHEELHOUSE_HOME back at the real home.
  process.env.WHEELHOUSE_HOME = real;
  const realUsage = path.join(real, 'usage');
  const second = realHost({ helper: stubHelper, label: 'again', ghAccount: account });
  await second.attach({ folder: base, project, order: ORDER });
  assert.equal(process.env.WHEELHOUSE_HOME, path.join(base, 'wheelhouse-home'));
  assert.equal(await second.monthUsed(), 100);
  assert.equal(fs.existsSync(path.join(realUsage, 'copilot-account.json')), false);
  assert.equal((await second.merge({ work: ORDER.work })).reason, 'The session left no commit');
});

test('attach refuses a run folder with no project', async () => {
  const host = realHost({ helper: stubHelper, label: 'none' });
  await assert.rejects(host.attach({ folder: fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-empty-')), project: 'p', order: ORDER }), /no project/);
});

test('a month that gh cannot read, with no earlier reading and an empty ledger, is unreadable, not zero', async (t) => {
  const was = process.env.WHEELHOUSE_HOME;
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-nomonth-')));
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-nomonth-run-')));
  t.after(() => {
    if (was === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = was;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  });
  process.env.WHEELHOUSE_HOME = home;
  const host = realHost({ helper: stubHelper, label: 'nomonth', ghAccount: async () => { throw new Error('offline'); } });
  await host.stage({ folder: base });
  assert.equal(await host.monthUsed(), null);
});
