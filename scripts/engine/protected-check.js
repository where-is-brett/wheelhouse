// scripts/engine/protected-check.js
// The protected-tests check step, before review (Archon design, section 11): compares the run's change with the base
// branch and finds deleted tests, fewer assertions in a changed test file, new skip markers, and changed coverage or
// test settings. The files the run's work order lists may change; the order comes from the helper by the run's id.
// With --json it prints { clean, findings } and exits 0, for the pack to send a first failure back to the builder and
// a second to the blocked exit; without it, it prints the findings and exits 1 on any.
//   node scripts/engine/protected-check.js --run <run id> --base <ref> [--json]
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { changeOf } from './change.js';
import { isTestFile, isTestSettings, skipCount, assertionCount, listed } from './test-guard.js';

// The findings for `changes` (changeOf's), as plain lines, leaving out the files `protectedFiles` lists.
export async function protectedFindings(changes, protectedFiles = []) {
  const findings = [];
  for (const change of changes) {
    const file = change.path;
    if (change.status === 'R' && isTestFile(change.from) && !isTestFile(file) && !listed(change.from, protectedFiles)) {
      findings.push(`deletes the test ${change.from} (moved to ${file}, which isn't a test)`);
      continue;
    }
    if (listed(file, protectedFiles)) continue;
    if (isTestSettings(file) && change.status !== 'A') {
      findings.push(`changes the test settings in ${file}`);
      continue;
    }
    if (!isTestFile(file)) continue;
    if (change.status === 'D') {
      findings.push(`deletes the test ${file}`);
      continue;
    }
    const before = await change.before();
    const after = await change.after();
    if (skipCount(after) > skipCount(before)) findings.push(`adds a skip marker in ${file}`);
    if (before !== null && assertionCount(after) < assertionCount(before)) {
      findings.push(`has fewer assertions in ${file} (${assertionCount(after)}, was ${assertionCount(before)})`);
    }
  }
  return findings;
}

export async function main(argv = process.argv.slice(2), { client = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run } = {}) {
  const runId = runArg(argv);
  const base = runArg(argv, '--base');
  const json = argv.includes('--json');
  if (!runId || !base) {
    out('usage: node scripts/engine/protected-check.js --run <run id> --base <ref> [--json]');
    return 2;
  }
  const got = await client.engine.order({ runId });
  let findings;
  if (got?.ok !== true || !got.order) findings = [`the helper gave no work order for this run (${got?.refused ?? 'no answer'})`];
  else {
    try {
      findings = await protectedFindings(await changeOf({ cwd, base, run }), got.order.protectedFiles);
    } catch (error) {
      findings = [`the change could not be read: ${error.message}`];
    }
  }
  if (json) {
    out(JSON.stringify({ clean: findings.length === 0, findings: findings.join('\n') }));
    return 0;
  }
  for (const finding of findings) out(`The change ${finding}`);
  out(findings.length === 0 ? 'No test was deleted, skipped or loosened.' : `${findings.length} test changes need the builder's attention.`);
  return findings.length === 0 ? 0 : 1;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
