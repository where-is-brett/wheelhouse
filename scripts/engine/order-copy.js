// scripts/engine/order-copy.js
// Every lane's first step (Archon design, section 7.4): asks the helper for the run's work order and writes it to the
// run's artefacts as order.json, for the steps to read. It prints none of the order, since a step's output goes into
// Archon's database and the director's words never do. The copy is for reading only: nothing that guards reads it.
//   node scripts/engine/order-copy.js --run <run id> --out <artefacts folder>
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';

export async function main(argv = process.argv.slice(2), { client = helperClient({ timeout: 30000 }), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const runId = runArg(argv);
  const dir = runArg(argv, '--out');
  if (!runId || !dir || !path.isAbsolute(dir)) {
    out('usage: node scripts/engine/order-copy.js --run <run id> --out <artefacts folder>');
    return 2;
  }
  const answer = await client.engine.order({ runId });
  if (answer?.ok !== true || !answer.order) {
    out(`The helper gave no work order for this run: ${answer?.refused ?? 'no answer'}`);
    return 1;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'order.json'), `${JSON.stringify(answer.order, null, 2)}\n`);
  out(`The work order is in order.json, with ${answer.order.done.length} done checks.`);
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
