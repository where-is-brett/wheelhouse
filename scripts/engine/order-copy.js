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
import { safeGit } from '../lib/safe-git.js';
import { run as realRun } from '../lib/run.js';
// The line that keeps this computer's own settings out of git (setup's EXCLUDE_LINE, scripts/setup/project-files.js).
export const EXCLUDE_LINE = '/.claude/settings.local.json';

// What a path is without following a link: 'none', 'dir', 'file' or 'other' (a link among them).
function kindOf(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
  } catch {
    return 'none';
  }
}

// Writes the overlay as the worktree's .claude/settings.local.json, never through a link a branch holds, and keeps it
// out of git in the worktree's own exclude list, so no commit of the run's carries it. Gives a refusal, or null.
async function writeOverlay(cwd, overlay, run) {
  const folder = path.join(cwd, '.claude');
  const file = path.join(folder, 'settings.local.json');
  if (!['none', 'dir'].includes(kindOf(folder)) || !['none', 'file'].includes(kindOf(file))) return '.claude/settings.local.json in the worktree is a link or not a plain file';
  const git = safeGit({ run, cwd, look: 'never', timeoutMs: 30000 });
  const found = await git(['rev-parse', '--git-path', 'info/exclude']);
  if (found.code !== 0) return 'the worktree is not a git checkout';
  const exclude = path.resolve(cwd, found.stdout.trim());
  if (!['none', 'file'].includes(kindOf(exclude))) return 'the worktree\'s exclude list is a link or not a plain file';
  const kept = kindOf(exclude) === 'file' ? fs.readFileSync(exclude, 'utf8') : '';
  if (!kept.split(/\r?\n/).includes(EXCLUDE_LINE)) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, `${kept === '' || kept.endsWith('\n') ? '' : '\n'}${EXCLUDE_LINE}\n`);
  }
  fs.mkdirSync(folder, { recursive: true });
  const temp = path.join(folder, `.settings.local.${process.pid}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(overlay, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, file);
  return null;
}

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), run = realRun, out = (line) => process.stdout.write(`${line}\n`) } = {}) {
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
    const refused = await writeOverlay(cwd, overlay, run);
    if (refused) {
      out(`The run's settings overlay wasn't written: ${refused}`);
      return 1;
    }
  }
  fs.writeFileSync(path.join(dir, 'order.json'), `${JSON.stringify(answer.order, null, 2)}\n`);
  if (argv.includes('--flags')) out(JSON.stringify({ visible: answer.order.preview !== null, showFirst: answer.order.showFirst === true }));
  else out(`The work order is in order.json, with ${answer.order.done.length} done checks.`);
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
