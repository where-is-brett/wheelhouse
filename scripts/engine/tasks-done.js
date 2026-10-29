// scripts/engine/tasks-done.js
// The close of the small lane's tasks (Archon design, section 7.2): after every task has settled, the one question the
// lane asks. The question of the first task that blocked, named by its number and title, from the task blocks' records
// (the fan-out step's output, which the helper can see), never from a file in the run's artefacts; a card for a plan
// the lane can't take (more than MOST_TASKS tasks goes to the feature lane, none means the plan step built nothing);
// or a card for tasks left unticked when their rounds ran out, or skipped. It prints
// { blocked, question, options, recommend, level, topic }, the blocked exit's fields, for the lane's wait.
//   node scripts/engine/tasks-done.js --artefacts <folder> --base <ref> --records <the fan-out step's output>
import path from 'node:path';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { MOST_TASKS, findPlan, planProblem, tasksOf } from './plan-file.js';

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

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run } = {}) {
  const artefacts = runArg(argv, '--artefacts');
  const base = runArg(argv, '--base');
  if (!artefacts || !path.isAbsolute(artefacts) || !base || !argv.includes('--records')) {
    out('usage: node scripts/engine/tasks-done.js --artefacts <folder> --base <ref> --records <the fan-out step\'s output>');
    return 2;
  }
  const records = parsed(valueOf(argv, '--records'));
  const stopped = (Array.isArray(records) ? records : []).find((r) => r?.blocked === true && typeof r.question === 'string' && r.question !== '');
  const tasks = tasksOf((await findPlan({ cwd, base, run }))?.text);
  if (stopped) {
    const { task, question, options, recommend, level, topic } = stopped;
    const title = tasks.find((t) => String(t.n) === String(task))?.title;
    const named = title ? `Task ${task}, ${title}: ${question}` : `Task ${task}: ${question}`;
    out(JSON.stringify({ blocked: true, question: named, options, recommend, level, topic }));
    return 0;
  }
  const problem = planProblem(tasks);
  if (problem === 'too-many') out(JSON.stringify(TOO_BIG));
  else if (problem === 'none') out(JSON.stringify(EMPTY));
  else if (tasks.some((t) => !t.done)) out(JSON.stringify(UNFINISHED));
  else out(JSON.stringify(CLEAN));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
