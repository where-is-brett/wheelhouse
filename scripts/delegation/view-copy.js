// scripts/delegation/view-copy.js
// The reader's first step, as order-copy.js is a lane's: asks the helper for the view built when the card was sealed,
// and writes it to view.json in the run's folder, the only thing the reader's step can read. It prints none of the
// view, since a step's output goes into Archon's database.
//   node scripts/delegation/view-copy.js --run <run id> --artefacts <artefacts folder>
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { withTicket } from '../engine/ticket.js';
import { runArg } from '../engine/done-check.js';
import { startedAsScript } from '../lib/started-as-script.js';

export const VIEW_FILE = 'view.json';

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  if (!runId) {
    out('usage: node scripts/delegation/view-copy.js --run <run id> --artefacts <artefacts folder>');
    return 2;
  }
  let got;
  try {
    got = await client.engine.readerView({ runId });
  } catch (error) {
    got = { ok: false, refused: error instanceof Error ? error.message : 'the helper couldn\'t be reached' };
  }
  if (!got?.ok || got.view === null || typeof got.view !== 'object') {
    out(`The view couldn't be read: ${got?.refused ?? 'the helper didn\'t say why'}`);
    return 1;
  }
  fs.writeFileSync(path.join(cwd, VIEW_FILE), `${JSON.stringify(got.view, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
