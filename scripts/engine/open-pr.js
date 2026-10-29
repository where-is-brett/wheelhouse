// scripts/engine/open-pr.js
// The pack's pull-request step (Archon design, section 7.2): hands the title and body the pr-text step wrote to the
// helper, which pushes this worktree's own branch and opens or updates its pull request. It prints { branch, pr, head },
// the run's returned value; a refusal prints the helper's reason and exits 1, so the run fails rather than carries on.
//   node scripts/engine/open-pr.js --run <run id> --base <ref> --dir <artefacts folder>
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';

export async function main(argv = process.argv.slice(2), { client = helperClient({ timeout: 300000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const runId = runArg(argv);
  const dir = runArg(argv, '--dir');
  if (!runId || !dir || !path.isAbsolute(dir)) {
    out('usage: node scripts/engine/open-pr.js --run <run id> --base <ref> --dir <artefacts folder>');
    return 2;
  }
  const read = (name) => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return ''; } };
  const got = await client.engine.openPr({ runId, cwd, title: read('pr-title.txt').trim(), body: read('pr-body.md') });
  if (got?.ok !== true) {
    out(`The pull request wasn't opened: ${got?.refused ?? 'no answer'}`);
    return 1;
  }
  out(JSON.stringify({ branch: got.branch, pr: got.pr, head: got.head }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
