// scripts/engine/task-record.js
// The last step of each small-lane task (Archon design, section 7.2), and the block's output. A task block can't hold
// a wait, so a task whose builder took the blocked exit gives its question as its record: the fan-out step's output
// holds every task's record, and the lane asks from it once all have settled. It also leaves a hint in the run's
// artefacts, so the tasks after it skip; the hint only ever skips work, and never becomes a question. The first block's
// hint is kept. The build step's output comes on standard input; a task that skipped gives none. A feature slice's
// build step ends on the task's review (`--reviewed`): a review that still holds when the rounds run out adds `held`,
// which the close of the tasks reads, since nothing in the run's artefacts can be trusted for it. It prints
// { blocked, task, question, options, recommend, level, topic, held? }.
//   node scripts/engine/task-record.js --artefacts <folder> --task <n> [--reviewed]   < the build step's output
import fs from 'node:fs';
import path from 'node:path';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { BLOCKED_FILE } from './plan-file.js';
import { reviewHolds } from './review-round.js';

export const readStdin = async (stream = process.stdin) => {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
};

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };

export async function main(argv = process.argv.slice(2), { stdin, out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const artefacts = runArg(argv, '--artefacts');
  const task = runArg(argv, '--task');
  if (!artefacts || !path.isAbsolute(artefacts) || !task) {
    out('usage: node scripts/engine/task-record.js --artefacts <folder> --task <n>');
    return 2;
  }
  const text = stdin ?? await readStdin();
  const output = parsed(text);
  const blocked = output?.blocked === true;
  const { question = '', options = [], recommend = '', level = '3', topic = '' } = blocked ? output : {};
  if (blocked) {
    try { fs.writeFileSync(path.join(artefacts, BLOCKED_FILE), `${JSON.stringify({ task })}\n`, { flag: 'wx' }); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  const held = argv.includes('--reviewed') && !blocked && text.trim() !== '' && reviewHolds(text);
  out(JSON.stringify({ blocked, task, question, options, recommend, level, topic, ...(held ? { held: true } : {}) }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
