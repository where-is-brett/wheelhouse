// scripts/engine/bug-size.js
// The bug lane's size rule, after its build loop (Archon design, section 7.2): a fix that didn't pass its checks within
// its rounds, or that changes more than MOST_FILES of the product's files, is bigger than a bug, and the lane takes its
// blocked exit with a proposal: make it a small change or a feature, which the First Mate records again in that lane,
// or stop. The checks are run again here, from the helper's order, never read from a file the loop left. Prints
// { blocked, question, options, recommend, topic, level, line } and exits 0.
//   node scripts/engine/bug-size.js --run <run id> --artefacts <folder> --base <ref>
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { changeOf } from './change.js';
import { isTestFile } from './test-guard.js';
import { fixProblems } from './bug-check.js';
import { MOST_FILES } from './reproduction.js';

export const BIGGER_TOPIC = 'bigger-than-a-bug';
export const BIGGER_OPTIONS = Object.freeze([
  Object.freeze({ id: 'small', label: 'Make it a small change' }),
  Object.freeze({ id: 'feature', label: 'Make it a feature' }),
  Object.freeze({ id: 'stop', label: 'Stop this work' }),
]);

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run, platform } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  const base = runArg(argv, '--base');
  if (!runId || !base) {
    out('usage: node scripts/engine/bug-size.js --run <run id> --artefacts <folder> --base <ref>');
    return 2;
  }
  const bigger = (question, line) => {
    out(JSON.stringify({ blocked: true, question, options: BIGGER_OPTIONS, recommend: 'small', topic: BIGGER_TOPIC, level: '3', line }));
    return 0;
  };
  const problems = await fixProblems({ client, runId, cwd, base, run, platform });
  if (problems.length > 0) return bigger('The fix for this bug didn\'t pass its checks within its rounds. Should it go on as a small change, with a plan, or as a feature?', problems.join('; '));
  let files;
  try {
    files = (await changeOf({ cwd, base, run })).map((c) => c.path).filter((file) => !isTestFile(file));
  } catch (error) {
    return bigger('The fix for this bug couldn\'t be measured. Should it go on as a small change, with a plan, or as a feature?', `the change could not be read: ${error.message}`);
  }
  if (files.length > MOST_FILES) return bigger(`The fix for this bug changes ${files.length} files, more than a bug's fix should. Should it go on as a small change, with a plan, or as a feature?`, files.join(', '));
  out(JSON.stringify({ blocked: false, line: `The fix changes ${files.length} of the product's files and passes its checks.` }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
