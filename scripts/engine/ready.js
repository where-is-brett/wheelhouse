// scripts/engine/ready.js
// The pack's mark-ready step (Archon design, section 7.2; ruling 9 of part 3b): asks the helper to hand the run's pull
// request to the engine's merge queue. The helper does so only once every lens that ran is signed CLEAN for the head,
// and, for work shown first, the director approved it; a refusal prints its reason and exits 1.
//   node scripts/engine/ready.js --run <run id>
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';

export async function main(argv = process.argv.slice(2), { client = helperClient({ timeout: 60000 }), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const runId = runArg(argv);
  if (!runId) {
    out('usage: node scripts/engine/ready.js --run <run id>');
    return 2;
  }
  const got = await client.engine.ready({ runId });
  if (got?.ok !== true) {
    out(`The pull request wasn't marked ready: ${got?.refused ?? 'no answer'}`);
    return 1;
  }
  out(`Pull request ${got.pr} is ready for the merge queue at ${String(got.head).slice(0, 7)}.`);
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
