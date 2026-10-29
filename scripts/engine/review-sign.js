// scripts/engine/review-sign.js
// The pack's step after its pull request is open (Archon design, section 7.5): asks the helper to sign each review
// step from Archon's own record. The helper posts the merge queue's verdict once every lens that ran is CLEAN; no step
// posts one. It prints { clean } and exits 0, for the pack to branch on; a refusal (another pack, a run the helper
// didn't start) prints the reason and exits 1, so the run fails rather than carries on.
//   node scripts/engine/review-sign.js --run <run id>
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { REVIEW_STEPS } from './routes.js';

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 60000 }), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  if (!runId) {
    out('usage: node scripts/engine/review-sign.js --run <run id>');
    return 2;
  }
  let clean = true;
  let posted = false;
  let ran = 0;
  for (const step of REVIEW_STEPS) {
    const got = await client.engine.review({ runId, step });
    if (got?.ok !== true) {
      out(`The helper didn't sign ${step}: ${got?.refused ?? 'no answer'}`);
      return 1;
    }
    if (!got.ran) continue;
    ran += 1;
    if (got.verdict !== 'CLEAN') clean = false;
    posted = got.posted === true;
  }
  out(JSON.stringify({ clean: clean && ran > 0 && posted }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
