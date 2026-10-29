// scripts/engine/control-check.js
// The agent control-file watch as a check step before each review (Archon design, section 4.3): a run whose change
// adds or changes a file that steers agents (a hook, an instruction file, a Claude Code setting) could steer the
// reviewer or the next run, so the change goes to the blocked exit for the director, never on. The list is the
// watcher's own (isControlPath, scripts/watcher/control-files.js). With --json it prints { clean, paths } and exits 0.
//   node scripts/engine/control-check.js --base <ref> [--json]
import { startedAsScript } from '../lib/started-as-script.js';
import { isControlPath } from '../watcher/control-files.js';
import { runArg } from './done-check.js';
import { changeOf } from './change.js';

// The paths among `changes` (changeOf's) that steer agents, the moved-from path of a rename included.
export function controlFindings(changes, { platform = process.platform } = {}) {
  const paths = new Set();
  for (const change of changes) {
    for (const file of [change.path, change.from]) if (typeof file === 'string' && isControlPath(file, { platform })) paths.add(file);
  }
  return [...paths].sort();
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run, platform } = {}) {
  const base = runArg(argv, '--base');
  if (!base) {
    out('usage: node scripts/engine/control-check.js --base <ref> [--json]');
    return 2;
  }
  let paths;
  let trouble = null;
  try {
    paths = controlFindings(await changeOf({ cwd, base, run }), { platform });
  } catch (error) {
    paths = [];
    trouble = `the change could not be read: ${error.message}`;
  }
  const clean = trouble === null && paths.length === 0;
  if (argv.includes('--json')) {
    out(JSON.stringify({ clean, paths: trouble ?? paths.join('\n') }));
    return 0;
  }
  if (trouble) out(trouble);
  for (const file of paths) out(`The change adds or changes ${file}, a file that steers agents.`);
  if (clean) out('No file that steers agents changed.');
  return clean ? 0 : 1;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
