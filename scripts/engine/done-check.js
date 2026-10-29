// scripts/engine/done-check.js
// The done check (Archon design, section 11): the quick loop's `until_bash`. It asks the helper for the run's order
// by the run's id (never the copy in the run's artefacts, which an agent can write), runs each check in the worktree,
// prints one line a check and exits 0 only when every one passes. A page check is walked in a browser by the preview
// step, so here it is only listed.
//   node scripts/engine/done-check.js --run <run id>
import { run as defaultRun } from '../lib/run.js';
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';

const CHECK_MS = 10 * 60 * 1000;

// The shell a check's command runs in: the project's own commands are written for one.
const shell = (command, platform) => (platform === 'win32'
  ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command], windowsVerbatimArguments: true }
  : { file: '/bin/sh', args: ['-c', command] });

// A test's name as one word of a shell command.
const quoted = (name, platform) => (platform === 'win32' ? `"${name.replace(/"/g, '""')}"` : `'${name.replace(/'/g, "'\\''")}'`);

// Each check's result, in order: { check, ok, line }, with `ok` null for a check left to the preview step.
export async function runDoneChecks(order, { cwd, run = defaultRun, platform = process.platform } = {}) {
  const results = [];
  for (const check of order.done) {
    if (check.page !== undefined) {
      results.push({ check, ok: null, line: `left to the preview step: the page ${check.page} shows ${check.mustShow}` });
      continue;
    }
    const command = check.test !== undefined ? `${order.testCommand} ${quoted(check.test, platform)}` : check.command;
    const what = check.test !== undefined ? `the test ${check.test}` : `the command ${check.command}`;
    const { file, args, windowsVerbatimArguments } = shell(command, platform);
    let result;
    try {
      result = await run(file, args, { cwd, timeoutMs: CHECK_MS, windowsVerbatimArguments, limit: 256 * 1024 });
    } catch {
      results.push({ check, ok: false, line: `fail: ${what} could not be started` });
      continue;
    }
    if (result.timedOut) {
      results.push({ check, ok: false, line: `fail: ${what} took longer than ${CHECK_MS / 60000} minutes` });
    } else if (typeof check.expect === 'string') {
      const ok = String(result.stdout ?? '').includes(check.expect);
      results.push({ check, ok, line: ok ? `pass: ${what} shows ${check.expect}` : `fail: ${what} doesn't show ${check.expect}` });
    } else {
      const want = check.expect ?? 0;
      const ok = result.code === want;
      results.push({ check, ok, line: ok ? `pass: ${what}` : `fail: ${what} ended with ${result.code}, not ${want}` });
    }
  }
  return results;
}

// The run id from `--run <id>`, or null.
export function runArg(argv, name = '--run') {
  const at = argv.indexOf(name);
  return at >= 0 && typeof argv[at + 1] === 'string' && argv[at + 1] !== '' ? argv[at + 1] : null;
}

export async function main(argv = process.argv.slice(2), { client = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run, platform } = {}) {
  const runId = runArg(argv);
  if (!runId) {
    out('usage: node scripts/engine/done-check.js --run <run id>');
    return 2;
  }
  const answer = await client.engine.order({ runId });
  if (answer?.ok !== true || !answer.order) {
    out(`fail: ${answer?.refused ?? 'the helper gave no work order for this run'}`);
    return 1;
  }
  const results = await runDoneChecks(answer.order, { cwd, run, platform });
  for (const result of results) out(result.line);
  const failed = results.filter((r) => r.ok === false).length;
  out(failed === 0 ? 'every done check passes' : `${failed} of ${results.length} checks failed`);
  return failed === 0 ? 0 : 1;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
