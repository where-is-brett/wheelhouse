// scripts/engine/tasks-done.js
// The close of the small lane's tasks (Archon design, section 7.2): after every task has settled, the one question the
// lane asks. The question of the task that blocked, if one did; a card for a plan the lane can't take (more than
// MOST_TASKS tasks goes to the feature lane, none means the plan step built nothing); or a card for tasks left
// unticked when their rounds ran out. It prints { blocked, question, options, recommend, level, topic }, the
// blocked exit's fields, for the lane's wait.
//   node scripts/engine/tasks-done.js --artefacts <folder> --base <ref>
import fs from 'node:fs';
import path from 'node:path';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { BLOCKED_FILE, MOST_TASKS, findPlan, planProblem, tasksOf } from './plan-file.js';

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

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run } = {}) {
  const artefacts = runArg(argv, '--artefacts');
  const base = runArg(argv, '--base');
  if (!artefacts || !path.isAbsolute(artefacts) || !base) {
    out('usage: node scripts/engine/tasks-done.js --artefacts <folder> --base <ref>');
    return 2;
  }
  let kept = null;
  try { kept = JSON.parse(fs.readFileSync(path.join(artefacts, BLOCKED_FILE), 'utf8')); } catch { /* no task blocked */ }
  if (kept) {
    const { question, options, recommend, level, topic } = kept;
    out(JSON.stringify({ blocked: true, question, options, recommend, level, topic }));
    return 0;
  }
  const tasks = tasksOf((await findPlan({ cwd, base, run }))?.text);
  const problem = planProblem(tasks);
  if (problem === 'too-many') out(JSON.stringify(TOO_BIG));
  else if (problem === 'none' || tasks.some((t) => !t.done)) out(JSON.stringify(UNFINISHED));
  else out(JSON.stringify(CLEAN));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
