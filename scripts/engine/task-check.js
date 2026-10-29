// scripts/engine/task-check.js
// One small-lane task's done check (Archon design, section 7.2): its build loop's until_bash. The task is done when
// the plan in the tree has it ticked, nothing is left uncommitted, and the test the plan names for it, if any, passes
// with the work order's test command. The order comes from the helper by the run's id, never from the run's copy.
// It prints one line and exits 0 only when the task is done.
//   node scripts/engine/task-check.js --run <run id> --artefacts <folder> --base <ref> --task <n>
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { run as defaultRun } from '../lib/run.js';
import { runArg, runDoneChecks } from './done-check.js';
import { PLAN_FILE, tasksOf } from './plan-file.js';

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run, platform } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  const n = runArg(argv, '--task');
  if (!runId || !n) {
    out('usage: node scripts/engine/task-check.js --run <run id> --artefacts <folder> --base <ref> --task <n>');
    return 2;
  }
  let text = '';
  try { text = fs.readFileSync(path.join(cwd, PLAN_FILE), 'utf8'); } catch { /* no plan */ }
  const task = tasksOf(text).find((t) => String(t.n) === n);
  if (!task?.done) {
    out(`fail: task ${n} isn't ticked in ${PLAN_FILE}`);
    return 1;
  }
  const status = await (run ?? defaultRun)('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, timeoutMs: 30000 }).catch(() => ({ code: 1, stdout: '' }));
  if (status.code !== 0 || status.stdout.trim() !== '') {
    out(`fail: task ${n} left changes that aren't committed`);
    return 1;
  }
  if (task.test) {
    const answer = await client.engine.order({ runId });
    if (answer?.ok !== true || !answer.order) {
      out(`fail: ${answer?.refused ?? 'the helper gave no work order for this run'}`);
      return 1;
    }
    const [result] = await runDoneChecks({ ...answer.order, done: [{ test: task.test }] }, { cwd, run, platform });
    if (!result.ok) {
      out(result.line);
      return 1;
    }
  }
  out(`pass: task ${n} is done`);
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
