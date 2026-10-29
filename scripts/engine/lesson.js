// scripts/engine/lesson.js
// The pack's lesson-record step (Archon design, section 7.2): asks the helper to write the lesson the run's lesson step
// gave. The helper reads it from the engine's own record, never from this step, and writes at most one a run.
//   node scripts/engine/lesson.js --run <run id>
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';

export async function main(argv = process.argv.slice(2), { client = helperClient({ timeout: 30000 }), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const runId = runArg(argv);
  if (!runId) {
    out('usage: node scripts/engine/lesson.js --run <run id>');
    return 2;
  }
  const got = await client.engine.lesson({ runId });
  if (got?.ok !== true) {
    out(`The lesson wasn't written: ${got?.refused ?? 'no answer'}`);
    return 1;
  }
  out(got.written ? 'One lesson written for the next run.' : 'No lesson from this run.');
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
