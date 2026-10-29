// scripts/engine/merge-fix.js
// The fix-main lane's merge step (Archon design, section 7.7): asks the helper to add the run's fix to the main line
// through its own merge gate, since Archon's merge queue holds every merge while the main line is red. The helper adds
// it only as the open red-main incident's fix: the pull request the run itself opened, at the head it opened, signed
// CLEAN, and not weakening the checks. A refusal prints its reason and exits 1.
//   node scripts/engine/merge-fix.js --run <run id> --artefacts <folder>
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 300000 }), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  if (!runId) {
    out('usage: node scripts/engine/merge-fix.js --run <run id> --artefacts <folder>');
    return 2;
  }
  const got = await client.engine.mergeFix({ runId });
  if (got?.ok !== true) {
    out(`The fix wasn't added to the main line: ${got?.refused ?? 'no answer'}`);
    return 1;
  }
  out(`The fix, pull request #${got.pr}, was added to the main line at ${String(got.head).slice(0, 7)}.`);
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
