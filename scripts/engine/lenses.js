// scripts/engine/lenses.js
// Which review lenses beyond standards and spec apply to a run (Archon design, section 11), as a script step before
// review. Security applies to a change touching sign-in, permissions, stored data, payments or secrets, by its paths
// or the lines it adds, or touching one of the project's critical areas (its settings' criticalAreas); design applies to visible work, which the work order (from the helper) says. Without an order
// every lens runs. It also records the commit the reviews will read (`head`) and whether the worktree holds only that
// commit (`clean`), in Archon's own record, so the helper signs a review only for the head it read. It prints
// { security, design, feature, head, clean } and exits 0, for the pack to branch on; `feature`, the whole-feature
// lens, is a feature's own run's, every round. After a fix round (the small lane),
// `--held` names the lenses that held in the round before and `--ran` those that have run in any round: security and
// design then run again where they apply and either held or haven't run yet. A list naming no lens is the first round,
// where every lens that applies runs.
//   node scripts/engine/lenses.js --run <run id> --base <ref> [--held <lens,lens> --ran <lens,lens>]
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { changeOf } from './change.js';
import { run as defaultRun } from '../lib/run.js';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig, classifyChange } from '../gate/guardrails.js';

// The words of the critical areas, matched whole within a path or a line, after splitting camelCase and snake_case.
const SECURITY_WORDS = new Set([
  'auth', 'authn', 'authz', 'oauth', 'login', 'logout', 'signin', 'signup', 'password', 'passwords', 'passwd',
  'permission', 'permissions', 'role', 'roles', 'session', 'sessions', 'token', 'tokens', 'jwt', 'secret', 'secrets',
  'credential', 'credentials', 'apikey', 'crypto', 'encrypt', 'decrypt', 'payment', 'payments', 'billing',
  'invoice', 'stripe', 'refund', 'pii', 'gdpr', 'privacy', 'migration', 'migrations',
]);

const LENS_NAMES = ['standards', 'spec', 'security', 'design', 'feature'];

const wordsOf = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const touches = (text) => wordsOf(text).some((word) => SECURITY_WORDS.has(word));

// Whether the changed `paths` fall in one of the project's critical areas, from the worktree's settings; settings that
// can't be read count as touching one, so the lens runs.
export function criticalTouched(cwd, paths) {
  try {
    const file = path.join(cwd, '.claude', 'wheelhouse.json');
    const config = readConfig(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
    return classifyChange({ paths, config }).criticalAreas.length > 0;
  } catch {
    return true;
  }
}

// Whether `changes` (changeOf's, or { path } alone) or the `added` lines touch a critical area.
export function securityTouched(changes, added = '') {
  return changes.some((change) => touches(change.path) || (change.from && touches(change.from))) || touches(added);
}

// The lines `after` has that `before` hasn't.
function addedLines(before, after) {
  const had = new Set(String(before ?? '').split('\n'));
  return String(after ?? '').split('\n').filter((line) => !had.has(line)).join('\n');
}

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run } = {}) {
  const client = withTicket(given, argv);
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
    const paths = changes.flatMap((change) => [change.path, change.from].filter((p) => typeof p === 'string'));
    security = order === null || securityTouched(changes, added) || criticalTouched(cwd, paths);
  } catch {
    security = true;
  }
  const git = (...args) => (run ?? defaultRun)('git', args, { cwd, timeoutMs: 30000 }).catch(() => ({ code: 1, stdout: '' }));
  const named = await git('rev-parse', '--verify', '-q', 'HEAD');
  const head = named.code === 0 ? named.stdout.trim() : '';
  const status = head ? await git('status', '--porcelain', '--untracked-files=all') : { code: 1, stdout: '' };
  const clean = head !== '' && status.code === 0 && status.stdout.trim() === '';
  const lensesIn = (flag) => (runArg(argv, flag) ?? '').split(',').map((lens) => lens.trim()).filter((lens) => LENS_NAMES.includes(lens));
  const held = lensesIn('--held');
  const ran = lensesIn('--ran');
  const again = (lens, applies) => applies && (held.length === 0 || held.includes(lens) || !ran.includes(lens));
  out(JSON.stringify({ security: again('security', security), design: again('design', order === null || order.preview !== null), feature: order?.lane === 'feature', head, clean }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
