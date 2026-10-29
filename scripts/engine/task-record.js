// scripts/engine/task-record.js
// The last step of each small-lane task (Archon design, section 7.2). A task block can't hold a wait, so a task whose
// builder took the blocked exit leaves its question in the run's artefacts: the tasks after it skip, and the lane asks
// once all have settled. The first block is kept; a later one changes nothing. The build step's output comes on
// standard input; a task that skipped gives none. It prints { blocked }.
//   node scripts/engine/task-record.js --artefacts <folder> --task <n>   < the build step's output
import fs from 'node:fs';
import path from 'node:path';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { BLOCKED_FILE } from './plan-file.js';

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
  const output = parsed(stdin ?? await readStdin());
  const blocked = output?.blocked === true;
  if (blocked) {
    const { question = '', options = [], recommend = '', level = '3', topic = '' } = output;
    const kept = JSON.stringify({ task, question, options, recommend, level, topic }, null, 2);
    try { fs.writeFileSync(path.join(artefacts, BLOCKED_FILE), `${kept}\n`, { flag: 'wx' }); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  out(JSON.stringify({ blocked }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
