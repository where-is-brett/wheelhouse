// scripts/engine/plan-file.js
// The small lane's plan (Archon design, section 7.2): the plan step writes it to PLAN_FILE and commits it on the
// branch, each task builder ticks its own task, and the lane takes it out in its own commit before review, so it never
// reaches the main line. A run carried on over the branch reads it from the tree, or from the branch's history once it
// was taken out. A task line is `- [ ] **Task <n>:** <title>` (`- [x]` once done), and may be followed by an indented
// `Test: <name>`, a test for the work order's test command.
//   node scripts/engine/plan-file.js --gate --base <ref>                         { planned }
//   node scripts/engine/plan-file.js --tasks --base <ref>                        ["2","3"]: the unfinished tasks
//   node scripts/engine/plan-file.js --problem --base <ref>                      { problem: null | 'none' | 'too-many' }
//   node scripts/engine/plan-file.js --task <n> --gate --base <ref> --artefacts <dir>   { skip }
import { safeGit } from '../lib/safe-git.js';
import fs from 'node:fs';
import path from 'node:path';
import { run as defaultRun } from '../lib/run.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';

export const PLAN_FILE = '.wheelhouse-plan.md';
// The most tasks a small plan holds: more is work for the feature lane, in slices. With 2 rounds a task, at check 77's
// 127,000 tokens a round, 8 tasks stay within 60% of the small lane's 4M cap.
export const MOST_TASKS = 8;
// The file a blocked task leaves in the run's artefacts, so the tasks after it don't start.
export const BLOCKED_FILE = 'small-blocked.json';

const TASK = /^\s*- \[( |x|X)\] \*\*Task (\d+):\*\*\s*(.+?)\s*$/;
const TEST = /^\s+Test:\s*(.+?)\s*$/;

// The plan's tasks, in order: { n, title, test, done }. A number given twice counts once, by its first line.
export function tasksOf(text) {
  const tasks = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const found = TASK.exec(lines[i]);
    if (!found) continue;
    const n = Number(found[2]);
    if (tasks.some((t) => t.n === n)) continue;
    let test = null;
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]) && !TASK.test(lines[j]); j += 1) {
      const named = TEST.exec(lines[j]);
      if (named) test = named[1];
    }
    tasks.push({ n, title: found[3], test, done: found[1] !== ' ' });
  }
  return tasks;
}

// The plan's text with tasks `numbers` unticked, so a fresh run builds them again.
export function untick(text, numbers) {
  return String(text ?? '').split('\n').map((line) => {
    const found = TASK.exec(line);
    return found && numbers.includes(Number(found[2])) ? line.replace(/\[[xX]\]/, '[ ]') : line;
  }).join('\n');
}

// The plan: { text, where: 'tree' } from the worktree, { text, where: 'history' } as it was before a commit on
// `base..HEAD` took it out, or null.
export async function findPlan({ cwd, base, run = defaultRun }) {
  try {
    return { text: fs.readFileSync(path.join(cwd, PLAN_FILE), 'utf8'), where: 'tree' };
  } catch { /* not in the tree */ }
  // The fence alone: the worktree's own settings are an agent's to write, and nothing here runs its hooks or filters.
  const fenced = safeGit({ run, cwd, look: 'never', timeoutMs: 30000 });
  const git = (...args) => fenced(args);
  const gone = await git('log', '--diff-filter=D', '--format=%H', `${base}..HEAD`, '--', PLAN_FILE);
  const sha = gone.code === 0 ? gone.stdout.trim().split('\n')[0] : '';
  if (!sha) return null;
  const was = await git('show', `${sha}^:${PLAN_FILE}`);
  return was.code === 0 ? { text: was.stdout, where: 'history' } : null;
}

// Why the lane can't take the plan's tasks: 'none', 'too-many', or null.
export function planProblem(tasks) {
  if (tasks.length === 0) return 'none';
  return tasks.length > MOST_TASKS ? 'too-many' : null;
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run } = {}) {
  const base = runArg(argv, '--base');
  const task = runArg(argv, '--task');
  const artefacts = runArg(argv, '--artefacts');
  const mode = ['--gate', '--tasks', '--problem'].find((flag) => argv.includes(flag));
  if (!base || !mode || (task && (mode !== '--gate' || !artefacts || !path.isAbsolute(artefacts)))) {
    out('usage: node scripts/engine/plan-file.js --gate|--tasks|--problem --base <ref> [--task <n> --artefacts <folder>]');
    return 2;
  }
  const plan = await findPlan({ cwd, base, run });
  const tasks = tasksOf(plan?.text);
  if (task) {
    const blocked = fs.existsSync(path.join(artefacts, BLOCKED_FILE));
    const done = tasks.find((t) => String(t.n) === task)?.done === true;
    out(JSON.stringify({ skip: blocked || done }));
  } else if (mode === '--gate') out(JSON.stringify({ planned: plan !== null }));
  else if (mode === '--problem') out(JSON.stringify({ problem: planProblem(tasks) }));
  else out(JSON.stringify(planProblem(tasks) ? [] : tasks.filter((t) => !t.done).map((t) => String(t.n))));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
