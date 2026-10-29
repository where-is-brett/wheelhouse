// scripts/engine/order-copy.js
// Every lane's first step (Archon design, section 7.4): asks the helper for the run's work order and writes it to the
// run's artefacts as order.json, for the steps to read. It prints none of the order, since a step's output goes into
// Archon's database and the director's words never do. The copy is for reading only: nothing that guards reads it.
// With --flags it prints only { visible, showFirst }, two yes-or-no answers the pack branches on. With --feature-flags,
// for a feature's slices and its own run, it adds { demo, flagFile, topic, words }: whether this slice is the midpoint
// demo, whether the switch is kept in a file, and the topic and words of the approval the run ends on.
// Run in the run's worktree, it also writes the run's own settings overlay there (ownRunRules), which lets the run's
// Claude steps read their own artefacts and no other run's. Archon gives its Claude steps the project and user settings
// only, never the local ones, so the overlay is merged into the worktree's .claude/settings.json, over the branch's own.
//   node scripts/engine/order-copy.js --run <run id> --out <artefacts folder> [--flags | --feature-flags]
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { ownRunRules, mergeSettings } from '../protection/settings.js';
import { safeGit } from '../lib/safe-git.js';
import { run as realRun } from '../lib/run.js';
const SHARED = '.claude/settings.json';
// The exclude line that keeps the overlay out of git where the branch doesn't track the file.
export const EXCLUDE_LINE = `/${SHARED}`;

// What a path is without following a link: 'none', 'dir', 'file' or 'other' (a link among them).
function kindOf(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
  } catch {
    return 'none';
  }
}

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Writes the overlay into the worktree's .claude/settings.json, never through a link a branch holds. Where the branch
// tracks the file, the overlay is merged over the branch's own shared settings as the index holds them (so a second run
// in the same worktree never keeps an earlier run's lists), and the worktree's own index marks it skip-worktree, so no
// commit of the run's carries it and the director's checkout is untouched. Where it doesn't, the overlay is written
// alone and kept out of git by the exclude list. Gives a refusal, or null.
async function writeOverlay(cwd, overlay, run) {
  const folder = path.join(cwd, '.claude');
  const file = path.join(folder, 'settings.json');
  if (!['none', 'dir'].includes(kindOf(folder)) || !['none', 'file'].includes(kindOf(file))) return `${SHARED} in the worktree is a link or not a plain file`;
  const git = safeGit({ run, cwd, look: 'never', timeoutMs: 30000 });
  const staged = await git(['ls-files', '--stage', '--', SHARED]);
  if (staged.code !== 0) return 'the worktree is not a git checkout';
  let settings = overlay;
  if (staged.stdout.trim() !== '') {
    if (!/^100644 /.test(staged.stdout) || kindOf(file) !== 'file') return `the branch's shared settings (${SHARED}) aren't a plain file`;
    const held = await git(['show', `:${SHARED}`]);
    let shared;
    try { shared = JSON.parse(held.stdout); } catch { shared = null; }
    if (held.code !== 0 || !isPlain(shared)) return `the branch's shared settings (${SHARED}) couldn't be read`;
    const kept = await git(['update-index', '--skip-worktree', '--', SHARED]);
    if (kept.code !== 0) return 'the shared settings couldn\'t be kept out of the run\'s commits';
    settings = mergeSettings(shared, overlay);
  } else {
    const found = await git(['rev-parse', '--git-path', 'info/exclude']);
    if (found.code !== 0) return 'the worktree is not a git checkout';
    const exclude = path.resolve(cwd, found.stdout.trim());
    if (!['none', 'file'].includes(kindOf(exclude))) return 'the worktree\'s exclude list is a link or not a plain file';
    const listed = kindOf(exclude) === 'file' ? fs.readFileSync(exclude, 'utf8') : '';
    if (!listed.split(/\r?\n/).includes(EXCLUDE_LINE)) {
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.appendFileSync(exclude, `${listed === '' || listed.endsWith('\n') ? '' : '\n'}${EXCLUDE_LINE}\n`);
    }
  }
  fs.mkdirSync(folder, { recursive: true });
  const temp = path.join(folder, `.settings.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* nothing left to take away */ }
    return `the merged settings couldn't be written (${error?.code ?? 'unknown'})`;
  }
  return null;
}

// The approval a run ends on: the switch-on of a feature, the midpoint demo of a slice, or work shown first.
export const APPROVAL_WORDS = Object.freeze({
  'switch-on': 'Every slice of this feature is added, behind its switch. Approve it to switch it on for everyone, or reject it to leave it off.',
  'midpoint-demo': 'This slice is half way through the feature. Approve it to carry on with the next slices, or reject it to stop and change course.',
  'shown-first': 'This change is shown to you first. Approve it to send it to the merge queue, or reject it.',
});
export function approvalOf(order) {
  if (order.lane === 'feature') return 'switch-on';
  return order.demo === true ? 'midpoint-demo' : 'shown-first';
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
  const { order } = answer;
  if (argv.includes('--feature-flags')) {
    const topic = approvalOf(order);
    out(JSON.stringify({ visible: order.preview !== null, showFirst: order.showFirst === true, demo: order.demo === true, flagFile: typeof order.flag?.file === 'string', topic, words: APPROVAL_WORDS[topic] }));
  } else if (argv.includes('--flags')) out(JSON.stringify({ visible: order.preview !== null, showFirst: order.showFirst === true }));
  else out(`The work order is in order.json, with ${answer.order.done.length} done checks.`);
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
