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

test('the project is staged, the order gets a worktree, and a committed change merges through the local adapter', async (t) => {
  const was = process.env.WHEELHOUSE_HOME;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-real-')));
  t.after(() => {
    if (was === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = was;
    fs.rmSync(base, { recursive: true, force: true });
  });
  const host = realHost({ label: 'unit', ghAccount: async () => { throw new Error('offline'); } });
  const { project } = await host.stage({ folder: base });
  assert.match(project, /copilot-t3-unit/);
  await host.order(ORDER);
  const worktree = path.join(base, 'project', '.claude', 'worktrees', ORDER.work);
  assert.ok(fs.existsSync(worktree));
  // A merge with nothing committed is refused, in words.
  assert.deepEqual(await host.merge({ work: ORDER.work }), { merged: false, reason: 'The session left no commit' });
  fs.writeFileSync(path.join(worktree, 'src', 'greeting.js'), 'export const greet = (name) => `Hello, ${name}!`;\n');
  const got = await host.merge({ work: ORDER.work });
  assert.equal(got.merged, true, got.reason);
  assert.match(execFileSync('git', ['--git-dir', path.join(base, 'wheelhouse-home', 'projects', project, 'home.git'), 'show', 'main:src/greeting.js'], { encoding: 'utf8' }), /Hello/);
});

test('the build prompt names the goal and never a model', () => {
  const prompt = buildPrompt(ORDER);
  assert.ok(prompt.includes(ORDER.goal));
  assert.doesNotMatch(prompt, /--model|claude|gpt/i);
});

test('the month is read from the account when gh can, and the stage passes no model', async (t) => {
  const was = process.env.WHEELHOUSE_HOME;
  t.after(() => { if (was === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = was; });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-usage-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  process.env.WHEELHOUSE_HOME = home;
  const host = realHost({ label: 'unit', ghAccount: async () => ({ quota_remaining: 148, quota_snapshots: { premium_interactions: { entitlement: 200, remaining: 148 } }, quota_reset_date: '2099-01-01' }) });
  assert.equal(await host.monthUsed(), 52);
});
