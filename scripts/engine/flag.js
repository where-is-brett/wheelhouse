// scripts/engine/flag.js
// A feature's switch in the pack (Archon design, section 7.2): every slice merges behind it, off, and the feature's
// own run switches it on before the director's switch-on approval. The switch comes from the run's work order, asked
// of the helper by the run's id, never from the run's copy. A switch kept in a file (one JSON key, true or false) is
// checked and switched here; one the project sets its own way, given in words, is left to the AI step and the
// reviewers. The file is read only when it is a plain file inside the worktree, never through a link. Git runs behind
// Wheelhouse's fence (safe-git.js), since the worktree is one an agent controls.
//   node scripts/engine/flag.js --check-off --run <run id>   prints { clean, why? }
//   node scripts/engine/flag.js --on --run <run id>          prints { switched }: true once the file says on, committed
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { run as defaultRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';

export const switchMessage = (name) => `Switch on ${name}`;
const MOST_BYTES = 256 * 1024;
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Whether a folder between the worktree `cwd` and the file `full` inside it is a link (a folder not made yet isn't).
export function linkedOnTheWay(cwd, full) {
  for (let dir = path.dirname(full); dir !== path.resolve(cwd) && dir !== path.dirname(dir); dir = path.dirname(dir)) {
    try { if (fs.lstatSync(dir).isSymbolicLink()) return true; } catch { /* not made yet */ }
  }
  return false;
}

// The switches in `file` under `cwd`: { flags } ({} when there is no file yet), or { why } when it can't be used.
function readFlags(cwd, file) {
  const full = path.resolve(cwd, ...file.split('/'));
  if (!full.startsWith(path.resolve(cwd) + path.sep)) return { why: 'the flags file is outside the worktree' };
  if (linkedOnTheWay(cwd, full)) return { why: 'the flags file is reached through a link' };
  let found;
  try { found = fs.lstatSync(full); } catch { return { flags: {} }; }
  if (!found.isFile() || found.size > MOST_BYTES) return { why: 'the flags file isn\'t a plain file' };
  try {
    const flags = JSON.parse(fs.readFileSync(full, 'utf8'));
    return isPlain(flags) ? { flags, full } : { why: 'the flags file isn\'t a record of switches' };
  } catch {
    return { why: 'the flags file can\'t be read as JSON' };
  }
}

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run = defaultRun } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  const checking = argv.includes('--check-off');
  if (!runId || checking === argv.includes('--on')) {
    out('usage: node scripts/engine/flag.js --check-off|--on --run <run id>');
    return 2;
  }
  const got = await client.engine.order({ runId });
  const flag = got?.ok === true ? got.order?.flag : null;
  if (!isPlain(flag)) {
    out(checking ? JSON.stringify({ clean: false, why: 'the work order names no switch' }) : 'The work order names no switch to turn on.');
    return checking ? 0 : 1;
  }
  if (typeof flag.file !== 'string') {
    out(JSON.stringify(checking ? { clean: true } : { switched: false }));
    return 0;
  }
  const read = readFlags(cwd, flag.file);
  if (checking) {
    if (read.why) out(JSON.stringify({ clean: false, why: read.why }));
    else if (read.flags[flag.name] === true) out(JSON.stringify({ clean: false, why: `the slice switched ${flag.name} on, and a slice merges with it off` }));
    else out(JSON.stringify({ clean: true }));
    return 0;
  }
  if (read.why) {
    out(`The switch wasn't turned on: ${read.why}.`);
    return 1;
  }
  if (read.flags[flag.name] === true) {
    out(JSON.stringify({ switched: true }));
    return 0;
  }
  const full = read.full ?? path.resolve(cwd, ...flag.file.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify({ ...read.flags, [flag.name]: true }, null, 2)}\n`);
  const git = safeGit({ run, cwd, look: 'never', timeoutMs: 30000 });
  // The fence shuts out the global config, so the commit is the branch's last author's unless the worktree names one.
  let env = {};
  if ((await git(['config', 'user.email'])).code !== 0) {
    const [name, email] = String((await git(['log', '-1', '--format=%an%n%ae'])).stdout ?? '').trim().split('\n');
    if (name && email) env = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  }
  const added = await git(['add', '--', flag.file]);
  const committed = added.code === 0 ? await git(['commit', '-q', '-m', switchMessage(flag.name), '--', flag.file], { env }) : added;
  if (committed.code !== 0) {
    out(`The switch wasn't committed: ${String(committed.stderr ?? '').trim() || 'git refused'}`);
    return 1;
  }
  out(JSON.stringify({ switched: true }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
