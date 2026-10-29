// scripts/engine/order-copy.js
// Every lane's first step (Archon design, section 7.4): asks the helper for the run's work order and writes it to the
// run's artefacts as order.json, for the steps to read. It prints none of the order, since a step's output goes into
// Archon's database and the director's words never do. The copy is for reading only: nothing that guards reads it.
// With --flags it prints only { visible, showFirst }, two yes-or-no answers the pack branches on. Run in the run's
// worktree, it also writes the run's own settings overlay there (.claude/settings.local.json, ownRunRules), which
// lets the run's Claude steps read their own artefacts and no other run's.
//   node scripts/engine/order-copy.js --run <run id> --out <artefacts folder> [--flags]
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { ownRunRules } from '../protection/settings.js';

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const client = withTicket(given, argv);
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
  let overlay = null;
  try { overlay = ownRunRules(runId, dir); } catch { /* not a run's own artefacts folder: no overlay */ }
  if (overlay) {
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.local.json'), `${JSON.stringify(overlay, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(dir, 'order.json'), `${JSON.stringify(answer.order, null, 2)}\n`);
  if (argv.includes('--flags')) out(JSON.stringify({ visible: answer.order.preview !== null, showFirst: answer.order.showFirst === true }));
  else out(`The work order is in order.json, with ${answer.order.done.length} done checks.`);
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
