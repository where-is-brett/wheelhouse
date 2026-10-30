// scripts/engine/tasks-done.js
// The close of the small lane's tasks (Archon design, section 7.2): after every task has settled, the one question the
// lane asks. The question of the first task that blocked, named by its number and title, from the task blocks' records
// (the fan-out step's output, which the helper can see), never from a file in the run's artefacts; a card for a plan
// the lane can't take (more than MOST_TASKS tasks goes to the feature lane, none means the plan step built nothing);
// a card for a ticked task that didn't truly end (its test fails, it left changes uncommitted, its review still holds);
// or a card for tasks left unticked when their rounds ran out, or skipped. A loop closes on its last round whatever the
// reason, so this is where a red end becomes a question: never from the run's artefacts, always by looking again. A
// task that didn't end is unticked in a commit of its own, the plan put back first if it was taken out, so the fresh
// run builds it again. A held review goes back even when another task stopped with its own question. A slice's close
// (`--reviewed`) also asks the helper for the holds it keeps, so a review held in a run cancelled before its close is
// still answered here, in the next run, though that run skips the ticked task; holds it can't get count as red. It prints
// { blocked, question, options, recommend, level, topic }, the blocked exit's fields, for the lane's wait.
//   node scripts/engine/tasks-done.js --run <run id> --artefacts <folder> --base <ref> [--reviewed] --records <the fan-out step's output>
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { run as defaultRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg, runDoneChecks } from './done-check.js';
import { MOST_TASKS, PLAN_FILE, findPlan, planProblem, tasksOf, untick } from './plan-file.js';
import { withTicket } from './ticket.js';
import { authorEnv } from './unplan.js';

const CLEAN = { blocked: false, question: '', options: [], recommend: '', level: '3', topic: '' };

const TOO_BIG = {
  blocked: true,
  question: `The plan for this work has more than ${MOST_TASKS} tasks, which is more than the small lane takes.`,
  options: [{ id: 'slice', label: 'Make it a feature, in slices' }, { id: 'stop', label: 'Stop this work' }],
  recommend: 'slice',
  level: '3',
  topic: 'plan-too-big',
};

const UNFINISHED = {
  blocked: true,
  question: "Some of the plan's tasks didn't finish within their rounds.",
  options: [{ id: 'rework', label: 'Send it back for a fresh run' }, { id: 'stop', label: 'Stop this work' }],
  recommend: 'rework',
  level: '3',
  topic: 'tasks-unfinished',
};

const RED = {
  blocked: true,
  options: [{ id: 'rework', label: 'Send it back for a fresh run' }, { id: 'stop', label: 'Stop this work' }],
  recommend: 'rework',
  level: '3',
  topic: 'task-red',
};

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };

// The value after a flag, an empty one included (runArg reads an empty value as missing).
const valueOf = (argv, name) => {
  const at = argv.indexOf(name);
  return at >= 0 && typeof argv[at + 1] === 'string' ? argv[at + 1] : '';
};

const EMPTY = {
  ...UNFINISHED,
  question: 'The plan for this work has no tasks, so nothing was built.',
  topic: 'plan-empty',
};

// The ticked tasks whose latest review still holds.
const heldTasks = (tasks, records) => tasks.filter((t) => t.done && records.some((r) => r?.held === true && String(r.task) === String(t.n)));

// The ticked tasks that didn't truly end, in the plan's order: [{ n, title, why }], each task's first reason. `why` is
// plain words for the card. A test that can't be checked counts as failing.
async function unended({ tasks, records, unread, runId, client, cwd, run, platform }) {
  const done = tasks.filter((t) => t.done);
  const found = new Map();
  const add = (task, why) => { if (!found.has(task.n)) found.set(task.n, { ...task, why }); };
  for (const task of heldTasks(tasks, records)) add(task, 'its review still found a serious problem');
  if (unread && done.length > 0) add(done[0], "whether its review still holds couldn't be checked");
  // Before the tests: a test may write files of its own.
  const status = await (run ?? defaultRun)('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, timeoutMs: 30000 }).catch(() => ({ code: 1, stdout: '' }));
  const named = done.filter((t) => t.test);
  if (named.length > 0) {
    const answer = await client.engine.order({ runId }).catch(() => null);
    const order = answer?.ok === true ? answer.order : null;
    for (const task of named) {
      const [result] = order ? await runDoneChecks({ ...order, done: [{ test: task.test }] }, { cwd, run, platform }) : [{ ok: false }];
      if (!result.ok) add(task, order ? 'its test still fails after its rounds' : "its test couldn't be checked");
    }
  }
  if ((status.code !== 0 || status.stdout.trim() !== '') && done.length > 0) add(done.at(-1), "it left changes that aren't committed");
  return [...found.values()].sort((a, b) => a.n - b.n);
}

// Unticks `numbers` in the plan, in a commit of its own, with the plan back in the tree if the lane had taken it out:
// a task's check reads it there, and the lane's unplan step takes it out again. A commit that can't be made leaves the
// tree as it was and the question standing: the card is what matters.
async function sendBack(numbers, plan, { cwd, run = defaultRun }) {
  const file = path.join(cwd, PLAN_FILE);
  const fenced = safeGit({ run, cwd, look: 'never', timeoutMs: 30000 });
  const git = (args, options) => fenced(args, options);
  const undo = () => (plan.where === 'tree' ? fs.writeFileSync(file, plan.text) : fs.rmSync(file, { force: true }));
  fs.writeFileSync(file, untick(plan.text, numbers));
  const added = await git(['add', '--', PLAN_FILE]).catch(() => ({ code: 1 }));
  const committed = added.code === 0 ? await git(['commit', '-q', '-m', `Send task ${numbers.join(', ')} back to be built again`, '--', PLAN_FILE], { env: await authorEnv(git) }).catch(() => ({ code: 1 })) : added;
  if (committed.code === 0) return;
  await git(['reset', '-q', '--', PLAN_FILE]).catch(() => null);
  undo();
}

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run, platform } = {}) {
  const runId = runArg(argv);
  const artefacts = runArg(argv, '--artefacts');
  const base = runArg(argv, '--base');
  if (!runId || !artefacts || !path.isAbsolute(artefacts) || !base || !argv.includes('--records')) {
    out('usage: node scripts/engine/tasks-done.js --run <run id> --artefacts <folder> --base <ref> [--reviewed] --records <the fan-out step\'s output>');
    return 2;
  }
  const client = withTicket(given, argv);
  const records = parsed(valueOf(argv, '--records'));
  const kept = argv.includes('--reviewed') ? await client.engine.taskHolds({ runId }).catch(() => null) : { ok: true, tasks: [] };
  const unread = kept?.ok !== true;
  const list = [...(Array.isArray(records) ? records : []), ...(unread ? [] : kept.tasks.map((task) => ({ task, held: true })))];
  const stopped = list.find((r) => r?.blocked === true && typeof r.question === 'string' && r.question !== '');
  const plan = await findPlan({ cwd, base, run });
  const tasks = tasksOf(plan?.text);
  if (stopped) {
    const { task, question, options, recommend, level, topic } = stopped;
    const held = heldTasks(tasks, list).map((t) => t.n);
    if (held.length > 0) await sendBack(held, plan, { cwd, run });
    const title = tasks.find((t) => String(t.n) === String(task))?.title;
    const named = title ? `Task ${task}, ${title}: ${question}` : `Task ${task}: ${question}`;
    out(JSON.stringify({ blocked: true, question: named, options, recommend, level, topic }));
    return 0;
  }
  const problem = planProblem(tasks);
  const red = problem ? [] : await unended({ tasks, records: list, unread, runId, client, cwd, run, platform });
  if (red.length > 0) {
    await sendBack(red.map((t) => t.n), plan, { cwd, run });
    const [{ n, title, why }] = red;
    out(JSON.stringify({ ...RED, question: `Task ${n}, ${title}: ${why}.` }));
  } else if (problem === 'too-many') out(JSON.stringify(TOO_BIG));
  else if (problem === 'none') out(JSON.stringify(EMPTY));
  else if (tasks.some((t) => !t.done)) out(JSON.stringify(UNFINISHED));
  else out(JSON.stringify(CLEAN));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
