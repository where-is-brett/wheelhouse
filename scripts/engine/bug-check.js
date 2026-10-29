// scripts/engine/bug-check.js
// The bug lane's build loop's until_bash (Archon design, sections 7.2 and 11). The fix is done when every done check
// in the helper's order for the run passes, the bug's kept reproduction among them; the reproduction's test files are
// as they were at the commit that proved it red, so no fix passes by changing them; and the change deletes, skips or
// loosens no test. It exits 0 at once when the builder took its blocked exit, and on the loop's last round, counted in
// the run's artefacts: Archon fails a loop that runs out of rounds, so the check closes it and the lane asks.
//   node scripts/engine/bug-check.js --run <run id> --artefacts <folder> --base <ref> --most <rounds> [--blocked <true|false>]
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { run as defaultRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { runArg, runDoneChecks } from './done-check.js';
import { changeOf } from './change.js';
import { protectedFindings } from './protected-check.js';

export const ROUNDS_FILE = 'bug-rounds.json';

// This round of the build loop, counted in the run's artefacts.
function countRound(artefacts) {
  const file = path.join(artefacts, ROUNDS_FILE);
  let kept = null;
  try { kept = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* the first round */ }
  const round = (Number.isInteger(kept?.rounds) && kept.rounds >= 0 ? kept.rounds : 0) + 1;
  fs.writeFileSync(file, `${JSON.stringify({ rounds: round })}\n`);
  return round;
}

// What stands between the worktree `cwd` and a done fix, as plain lines: none when it is done.
export async function fixProblems({ client, runId, cwd, base, run = defaultRun, platform }) {
  const problems = [];
  const answer = await client.engine.order({ runId });
  if (answer?.ok !== true || !answer.order) return [`the helper gave no work order for this run (${answer?.refused ?? 'no answer'})`];
  for (const result of await runDoneChecks(answer.order, { cwd, run, platform })) if (result.ok === false) problems.push(result.line);
  const found = await client.engine.reproductionFind({ runId });
  const kept = found?.ok === true ? found.kept : null;
  if (!kept) problems.push('the bug has no kept reproduction');
  else {
    // The fence alone: the worktree's own settings are an agent's to write.
    const git = safeGit({ run, cwd, look: 'never', timeoutMs: 30000 });
    let same = null;
    try { same = await git(['diff', '--quiet', kept.commit, '--', ...kept.files]); } catch { same = null; }
    if (same?.code !== 0) problems.push('the reproduction\'s test changed since it went red');
  }
  try {
    for (const finding of await protectedFindings(await changeOf({ cwd, base, run }), answer.order.protectedFiles)) problems.push(`the change ${finding}`);
  } catch (error) {
    problems.push(`the change could not be read: ${error.message}`);
  }
  return problems;
}

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run, platform } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  const base = runArg(argv, '--base');
  if (!runId || !base) {
    out('usage: node scripts/engine/bug-check.js --run <run id> --artefacts <folder> --base <ref> --most <rounds> [--blocked <true|false>]');
    return 2;
  }
  if (runArg(argv, '--blocked') === 'true') {
    out('the builder stopped with a question');
    return 0;
  }
  const most = Number(runArg(argv, '--most'));
  const artefacts = runArg(argv, '--artefacts');
  const last = Number.isInteger(most) && most >= 1 && artefacts && path.isAbsolute(artefacts) && countRound(artefacts) >= most;
  const problems = await fixProblems({ client, runId, cwd, base, run, platform });
  if (problems.length === 0) {
    out('pass: the fix is done');
    return 0;
  }
  for (const problem of problems) out(`fail: ${problem}`);
  if (last) {
    out('out of rounds, so the loop closes and the lane asks');
    return 0;
  }
  return 1;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
