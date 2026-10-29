// scripts/engine/fix-rerun.js
// The fix-main lane's first step (Archon design, section 7.7): the cheapest fix for a red main line is a job that
// failed for a passing reason, so the main line's failed runs of its newest commit have their failed jobs run again,
// once, and the step waits to see the result. Every call goes to the gh on PATH, which is Wheelhouse's broker; it lets
// a re-run through only for the default branch while a red-main incident is open. Prints { green, rerun } and exits 0
// whatever happened: the lane builds a fix when the main line isn't green.
//   node scripts/engine/fix-rerun.js --run <run id> --base <branch> [--wait-ms <n>] [--every-ms <n>]
import { startedAsScript } from '../lib/started-as-script.js';
import { run as defaultRun } from '../lib/run.js';
import { runArg } from './done-check.js';

const WAIT_MS = 10 * 60 * 1000;
const EVERY_MS = 20 * 1000;
const LISTED = 20;

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };
const number = (argv, name, fallback) => {
  const n = Number(runArg(argv, name));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export async function main(argv = process.argv.slice(2), { run = defaultRun, out = (line) => process.stdout.write(`${line}\n`), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const base = runArg(argv, '--base');
  if (!base) {
    out('usage: node scripts/engine/fix-rerun.js --run <run id> --base <branch> [--wait-ms <n>] [--every-ms <n>]');
    return 2;
  }
  const waitMs = number(argv, '--wait-ms', WAIT_MS);
  const everyMs = number(argv, '--every-ms', EVERY_MS);
  const gh = async (...args) => {
    try {
      const got = await run('gh', args);
      return got?.code === 0 ? parsed(got.stdout) ?? {} : null;
    } catch {
      return null;
    }
  };
  const said = (green, rerun) => {
    out(JSON.stringify({ green, rerun }));
    return 0;
  };

  const runs = await gh('run', 'list', '--branch', base, '--limit', String(LISTED), '--json', 'databaseId,headSha,status,conclusion');
  if (!Array.isArray(runs) || runs.length === 0) return said(false, false);
  const head = runs[0].headSha;
  const failed = runs.filter((r) => r.headSha === head && r.conclusion === 'failure' && Number.isInteger(r.databaseId));
  if (failed.length === 0) return said(false, false);
  const again = [];
  for (const r of failed) if (await gh('run', 'rerun', String(r.databaseId), '--failed')) again.push(r.databaseId);
  if (again.length === 0) return said(false, false);

  const until = Date.now() + waitMs;
  const done = new Map();
  for (;;) {
    for (const id of again) {
      if (done.has(id)) continue;
      const got = await gh('run', 'view', String(id), '--json', 'status,conclusion');
      if (got?.status === 'completed') done.set(id, got.conclusion);
    }
    if (done.size === again.length) return said([...done.values()].every((c) => c === 'success'), true);
    if (Date.now() >= until) return said(false, true);
    await sleep(everyMs);
  }
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
