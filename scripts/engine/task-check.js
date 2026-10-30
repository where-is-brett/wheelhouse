// scripts/engine/task-check.js
// One small-lane task's done check (Archon design, section 7.2): its build loop's until_bash. The task is done when
// the plan in the tree has it ticked, nothing is left uncommitted, and the test the plan names for it, if any, passes
// with the work order's test command. The order comes from the helper by the run's id, never from the run's copy.
// It prints one line and exits 0 only when the task is done, or, with `--most`, on the task's last round: Archon fails a
// loop that runs out of rounds, so the check counts each task's rounds in the run's artefacts and closes the loop on
// the last, leaving what it found for the lane's close (tasks-done.js), which looks again at every task. A feature's slice adds its task review's output
// (`--review`): the task is done only once that review finds no BLOCKER or HIGH.
//   node scripts/engine/task-check.js --run <run id> --artefacts <folder> --base <ref> --task <n> [--most <rounds>]
//     [--review <output>]
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { run as defaultRun } from '../lib/run.js';
import { runArg, runDoneChecks } from './done-check.js';
import { PLAN_FILE, tasksOf } from './plan-file.js';
import { reviewHolds } from './review-round.js';

export const ROUNDS_FILE = 'task-rounds.json';

// This round of task `n`'s build loop, counted in the run's artefacts.
function countRound(artefacts, n) {
  const file = path.join(artefacts, ROUNDS_FILE);
  let rounds = {};
  try { rounds = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* the first round of the first task */ }
  if (rounds === null || typeof rounds !== 'object' || Array.isArray(rounds)) rounds = {};
  const round = (Number.isInteger(rounds[n]) && rounds[n] >= 0 ? rounds[n] : 0) + 1;
  fs.writeFileSync(file, `${JSON.stringify({ ...rounds, [n]: round })}\n`);
  return round;
}

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run, platform } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  const n = runArg(argv, '--task');
  if (!runId || !n) {
    out('usage: node scripts/engine/task-check.js --run <run id> --artefacts <folder> --base <ref> --task <n>');
    return 2;
  }
  const most = Number(runArg(argv, '--most'));
  const artefacts = runArg(argv, '--artefacts');
  const last = Number.isInteger(most) && most >= 1 && artefacts && path.isAbsolute(artefacts) && countRound(artefacts, n) >= most;
  const fail = (line) => {
    out(last ? `${line}; out of rounds, so the loop closes and the lane asks` : line);
    return last ? 0 : 1;
  };
  let text = '';
  try { text = fs.readFileSync(path.join(cwd, PLAN_FILE), 'utf8'); } catch { /* no plan */ }
  const task = tasksOf(text).find((t) => String(t.n) === n);
  if (!task?.done) {
    return fail(`fail: task ${n} isn't ticked in ${PLAN_FILE}`);
  }
  const status = await (run ?? defaultRun)('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, timeoutMs: 30000 }).catch(() => ({ code: 1, stdout: '' }));
  if (status.code !== 0 || status.stdout.trim() !== '') {
    return fail(`fail: task ${n} left changes that aren't committed`);
  }
  if (task.test) {
    const answer = await client.engine.order({ runId });
    if (answer?.ok !== true || !answer.order) {
      return fail(`fail: ${answer?.refused ?? 'the helper gave no work order for this run'}`);
    }
    const [result] = await runDoneChecks({ ...answer.order, done: [{ test: task.test }] }, { cwd, run, platform });
    if (!result.ok) {
      return fail(result.line);
    }
  }
  const at = argv.indexOf('--review');
  if (at >= 0 && reviewHolds(argv[at + 1] ?? '')) {
    return fail(`fail: task ${n}'s review found a BLOCKER or HIGH, or gave no review`);
  }
  out(`pass: task ${n} is done`);
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
