// scripts/engine/lenses.js
// Which review lenses beyond standards and spec apply to a run (Archon design, section 11), as a script step before
// review. Security applies to a change touching sign-in, permissions, stored data, payments or secrets, by its paths
// or the lines it adds; design applies to visible work, which the work order (from the helper) says. Without an order
// every lens runs. It also records the commit the reviews will read (`head`) and whether the worktree holds only that
// commit (`clean`), in Archon's own record, so the helper signs a review only for the head it read. It prints
// { security, design, head, clean } and exits 0, for the pack to branch on.
//   node scripts/engine/lenses.js --run <run id> --base <ref>
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { changeOf } from './change.js';
import { run as defaultRun } from '../lib/run.js';

// The words of the critical areas, matched whole within a path or a line, after splitting camelCase and snake_case.
const SECURITY_WORDS = new Set([
  'auth', 'authn', 'authz', 'oauth', 'login', 'logout', 'signin', 'signup', 'password', 'passwords', 'passwd',
  'permission', 'permissions', 'role', 'roles', 'session', 'sessions', 'token', 'tokens', 'jwt', 'secret', 'secrets',
  'credential', 'credentials', 'apikey', 'crypto', 'encrypt', 'decrypt', 'payment', 'payments', 'billing',
  'invoice', 'stripe', 'refund', 'pii', 'gdpr', 'privacy', 'migration', 'migrations',
]);

const wordsOf = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const touches = (text) => wordsOf(text).some((word) => SECURITY_WORDS.has(word));

// Whether `changes` (changeOf's, or { path } alone) or the `added` lines touch a critical area.
export function securityTouched(changes, added = '') {
  return changes.some((change) => touches(change.path) || (change.from && touches(change.from))) || touches(added);
}

// The lines `after` has that `before` hasn't.
function addedLines(before, after) {
  const had = new Set(String(before ?? '').split('\n'));
  return String(after ?? '').split('\n').filter((line) => !had.has(line)).join('\n');
}

export async function main(argv = process.argv.slice(2), { client = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run } = {}) {
  const runId = runArg(argv);
  const base = runArg(argv, '--base');
  if (!runId || !base) {
    out('usage: node scripts/engine/lenses.js --run <run id> --base <ref>');
    return 2;
  }
  const got = await client.engine.order({ runId });
  const order = got?.ok === true ? got.order : null;
  let security = true;
  try {
    const changes = await changeOf({ cwd, base, run });
    let added = '';
    for (const change of changes) added += `${addedLines(await change.before(), await change.after())}\n`;
    security = order === null || securityTouched(changes, added);
  } catch {
    security = true;
  }
  const git = (...args) => (run ?? defaultRun)('git', args, { cwd, timeoutMs: 30000 }).catch(() => ({ code: 1, stdout: '' }));
  const named = await git('rev-parse', '--verify', '-q', 'HEAD');
  const head = named.code === 0 ? named.stdout.trim() : '';
  const status = head ? await git('status', '--porcelain', '--untracked-files=all') : { code: 1, stdout: '' };
  const clean = head !== '' && status.code === 0 && status.stdout.trim() === '';
  out(JSON.stringify({ security, design: order === null || order.preview !== null, head, clean }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
