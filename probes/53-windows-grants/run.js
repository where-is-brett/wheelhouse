// probes/53-windows-grants/run.js
// Check 53: granting build commands to a feature session on Windows. A `claude -p` session,
// started through claude.cmd (or claude.exe) in a scratch project, is asked to run `npm test`:
//   1. with no allow rule: it should be refused at once, not left waiting for an answer;
//   2. with --allowedTools "Bash(npm test:*)": it should run;
//   3. with the Guarded runner's rule in the form Task 6 uses, `Bash('<low node>' '<runner>':*)`,
//      running a stand-in runner script at low integrity (the probe makes its own low copy of
//      node.exe, as check 52 does; if that copy does not start, the normal node.exe is used and
//      the line says so);
//   4. with only that runner rule, a plain `npm test`: it should be refused.
// Each trial prints `PASS <name>: <detail> (<time>)`, `FAIL ...` or `SEEN ...`.
// The model is never written into the repository: pass it as --model <name> or set
// WHEELHOUSE_PROBE_MODEL. Real sessions cost a few cents of usage each.
// Check 53's Desktop question (does Desktop on Windows apply a sandbox of its own) cannot be
// run from here: the script ends with one SEEN line pointing at the run sheet.
// Usage: node probes/53-windows-grants/run.js --model <name> [--inherit-env] [--allow-off-windows]
// Everything it makes is under the temporary folder and is removed at the end or on Ctrl+C.
// Log: <home>/.wheelhouse-probes/53-windows-grants/ (times and session ids; no conversation text).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, withoutGitVars } from '../../scripts/lib/run.js';
import { resolveClaude, invocation, parseStream, toolCalls, missingFlags } from '../../scripts/eval/harness.js';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';
import { integrityOf, reportLine, runnerPrefix, runnerRule, seconds } from '../lib/windows.js';
import { makeEnv, strippedNames } from '../27-sessions/trials.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRIAL_TIMEOUT_MS = 3 * 60 * 1000;
const NEEDED_FLAGS = ['--print', '--output-format', '--verbose', '--permission-mode', '--setting-sources', '--model', '--allowedTools'];
export const NPM_RULE = 'Bash(npm test:*)';

export const PROMPTS = {
  plain: 'Run `npm test` in this project with the Bash tool. When it has finished, reply with the single word DONE and nothing else.',
  runner: (command) => `Run exactly this command with the Bash tool, changing nothing in it: ${command}\nWhen it has finished, reply with the single word DONE and nothing else.`,
};

// ------------------------------------------------------------------ options

export function parseOptions(argv, env = process.env) {
  const options = { model: env.WHEELHOUSE_PROBE_MODEL || '', inheritEnv: false, offWindows: false };
  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    let value;
    const equals = arg.indexOf('=');
    if (arg.startsWith('--') && equals > 0) {
      value = arg.slice(equals + 1);
      arg = arg.slice(0, equals);
    }
    if (arg === '--model') options.model = value ?? argv[++i] ?? '';
    else if (arg === '--inherit-env') options.inheritEnv = true;
    else if (arg === '--allow-off-windows') options.offWindows = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.model) throw new Error('Name the model: --model <name>, or set WHEELHOUSE_PROBE_MODEL. It is not written into the repository.');
  if (!/^[\w.[\]:-]+$/.test(options.model) || options.model.startsWith('-')) throw new Error(`That does not look like a model name: ${options.model}`);
  return options;
}

// ------------------------------------------------------- reading a session's stream

// What the stream says happened: the Bash commands the session tried, the permission
// denials its result event lists, and any tool result that was an error about permission.
export function summariseSession(text) {
  const events = parseStream(text);
  const final = events.findLast((event) => event.type === 'result');
  const init = events.find((event) => event.type === 'system' && event.subtype === 'init');
  const bashCommands = toolCalls(events).filter((call) => call.name === 'Bash').map((call) => String(call.input.command ?? ''));
  const denials = Array.isArray(final?.permission_denials) ? final.permission_denials : [];
  const blocked = events
    .filter((event) => event.type === 'user')
    .flatMap((event) => (Array.isArray(event.message?.content) ? event.message.content : []))
    .filter((block) => block.type === 'tool_result' && block.is_error === true)
    .map((block) => (typeof block.content === 'string' ? block.content : JSON.stringify(block.content)))
    .filter((content) => /permission|approv|not allowed|requested|denied/i.test(content));
  return {
    sessionId: init?.session_id ?? final?.session_id ?? null,
    bashCommands,
    denials: denials.length,
    blocked: blocked.length,
    isError: final?.is_error === true,
    result: typeof final?.result === 'string' ? final.result.slice(0, 200) : '',
    hasResult: Boolean(final),
  };
}

export const NOT_SIGNED_IN = /not logged in|please run \/login|invalid api key|authentication|unauthori[sz]ed|\b40[13]\b/i;

// Trial 1 and 4: the command should have been refused, and not have run.
export function judgeRefused({ summary, timedOut, ran }) {
  if (timedOut) return { status: 'FAIL', why: 'the session was still waiting after 3 minutes: the refusal did not come at once' };
  if (ran) return { status: 'FAIL', why: 'the command ran although no rule allowed it' };
  if (summary.denials > 0 || summary.blocked > 0) return { status: 'PASS', why: `refused (${summary.denials} permission denial${summary.denials === 1 ? '' : 's'} in the result)` };
  if (!summary.bashCommands.length) return { status: 'SEEN', why: 'inconclusive: the session never called Bash' };
  return { status: 'FAIL', why: 'the command did not run, but no refusal was reported either' };
}

// Trial 2 and 3: the command should have run, with nothing refused.
export function judgeAllowed({ summary, timedOut, ran }) {
  if (timedOut) return { status: 'FAIL', why: 'the session was still waiting after 3 minutes' };
  if (ran && summary.denials === 0) return { status: 'PASS', why: 'the command ran and nothing was refused' };
  if (ran) return { status: 'FAIL', why: `the command ran but ${summary.denials} denial${summary.denials === 1 ? ' was' : 's were'} reported` };
  if (summary.denials > 0 || summary.blocked > 0) return { status: 'FAIL', why: 'the rule did not allow the command: it was refused' };
  if (!summary.bashCommands.length) return { status: 'SEEN', why: 'inconclusive: the session never called Bash' };
  return { status: 'FAIL', why: 'the command was tried but did not run, and no refusal was reported' };
}

// ------------------------------------------------------------------ running

const tail = (text, n = 200) => String(text ?? '').trim().slice(-n);

async function exec(file, args = [], options = {}) {
  try {
    return await run(file, args, { baseEnv: withoutGitVars(process.env), timeoutMs: 120000, ...options });
  } catch (error) {
    return { code: null, stdout: '', stderr: error.message, error, failedToStart: true };
  }
}

async function say(ctx, status, name, detail = '', extra = {}) {
  const line = reportLine(status, name, detail);
  console.log(line);
  ctx.counts[status] += 1;
  await appendJsonl(ctx.log, { at: new Date().toISOString(), status, name, detail, ...extra }).catch(() => {});
}

async function makeLowNode(ctx) {
  const bin = path.join(ctx.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const copy = path.join(bin, 'node-low.exe');
  fs.copyFileSync(process.execPath, copy);
  const label = await exec('icacls', [copy, '/setintegritylevel', 'L']);
  if (label.code !== 0) return { node: copy, low: false, why: `icacls could not label the copy: ${tail(`${label.stdout} ${label.stderr}`)}` };
  const probe = await exec(copy, ['-e', "const r=require('node:child_process').spawnSync('whoami',['/groups'],{encoding:'utf8'});console.log(r.stdout)"]);
  if (probe.failedToStart || probe.code !== 0) return { node: copy, low: false, why: `the labelled copy did not start (${probe.failedToStart ? probe.error.code : `exit ${probe.code}`}: ${tail(probe.stderr, 120)})` };
  const level = integrityOf(probe.stdout);
  return { node: copy, low: level === 'low', why: level === 'low' ? 'starts at low' : `starts, but shows ${level ?? 'no integrity row'}` };
}

async function claudeSession(ctx, { prompt, allowedTools }) {
  const args = [
    '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'default',
    '--model', ctx.options.model,
    '--setting-sources', 'project,local',
    '--max-turns', '6',
    ...(allowedTools ? ['--allowedTools', allowedTools] : []),
  ];
  const call = invocation(ctx.resolved, [], args, prompt);
  const started = Date.now();
  const result = await exec(call.file, call.args, { cwd: ctx.project.dir, env: ctx.env.overrides, input: call.input, timeoutMs: TRIAL_TIMEOUT_MS, windowsVerbatimArguments: call.verbatim });
  return { result, ms: Date.now() - started, timedOut: result.timedOut === true };
}

function clearMarkers(ctx) {
  for (const name of ['ran.txt', 'runner-ran.txt']) fs.rmSync(path.join(ctx.project.dir, name), { force: true });
}

async function trial(ctx, { name, prompt, allowedTools, judge }) {
  clearMarkers(ctx);
  const { result, ms, timedOut } = await claudeSession(ctx, { prompt, allowedTools });
  if (result.failedToStart) {
    await say(ctx, 'FAIL', name, `claude did not start: ${result.error.message}`);
    return { fatal: true };
  }
  const summary = summariseSession(result.stdout);
  if (!timedOut && summary.isError && NOT_SIGNED_IN.test(`${summary.result} ${result.stderr}`)) {
    await say(ctx, 'FAIL', name, `claude is not signed in here (${tail(summary.result || result.stderr, 120)}); see the run sheet`, { signedIn: false });
    return { fatal: true };
  }
  const ran = fs.existsSync(path.join(ctx.project.dir, 'ran.txt'));
  const runnerNote = (() => {
    try { return fs.readFileSync(path.join(ctx.project.dir, 'runner-ran.txt'), 'utf8'); } catch { return null; }
  })();
  const verdict = judge({ summary, timedOut, ran });
  await say(ctx, verdict.status, name, `${verdict.why} (${seconds(ms)}; npm test ${ran ? 'ran' : 'did not run'}; command tried: ${summary.bashCommands.map((c) => c.slice(0, 300)).join(' | ') || 'none'})`, { ms, sessionId: summary.sessionId, exitCode: result.code, timedOut, summary });
  return { verdict, summary, ran, runnerNote, ms };
}

// ------------------------------------------------------------------ cleanup and main

async function cleanup(ctx) {
  if (ctx.cleaned) return;
  ctx.cleaned = true;
  try { await ctx.project?.cleanup(); } catch (error) { console.error(`Cleanup left the scratch project: ${error.message}`); }
  if (ctx.root) {
    try {
      assertUnderTmp(ctx.root);
      fs.rmSync(ctx.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      if (process.platform === 'win32') await exec('cmd.exe', ['/d', '/c', 'rd', '/s', '/q', ctx.root]);
      if (fs.existsSync(ctx.root)) console.error(`Cleanup left ${ctx.root}: ${error.message}`);
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  if (process.platform !== 'win32' && !options.offWindows) {
    console.error('Check 53 runs on Windows only (it tests claude.cmd and the low-integrity runner): nothing was done.');
    return 2;
  }
  const resolved = resolveClaude();
  const env = makeEnv({ inherit: options.inheritEnv });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ctx = { options, resolved, env, counts: { PASS: 0, FAIL: 0, SEEN: 0 }, log: path.join(probeLogDir('53-windows-grants'), `run-${stamp}.jsonl`), cleanups: [] };

  const help = invocation(resolved, [], ['--help']);
  const helpText = await exec(help.file, help.args, { env: env.overrides, input: help.input, windowsVerbatimArguments: help.verbatim, timeoutMs: 60000 });
  const missing = missingFlags(`${helpText.stdout}${helpText.stderr}`, NEEDED_FLAGS);
  if (missing.length) throw new Error(`This claude does not list the flags the trials need: ${missing.join(', ')}`);
  const versionCall = invocation(resolved, [], ['--version']);
  const version = tail((await exec(versionCall.file, versionCall.args, { input: versionCall.input, windowsVerbatimArguments: versionCall.verbatim, timeoutMs: 30000 })).stdout, 60);
  console.log(`Check 53, granting build commands, on ${process.platform} ${os.release()} with Claude Code ${version} (${resolved.kind === 'cmd' ? 'through claude.cmd' : 'claude.exe'}); ${options.inheritEnv ? 'environment inherited' : `${strippedNames(process.env).length} Claude variables left out of the sessions' environment`}`);

  const interrupt = () => {
    console.error('\nInterrupted: removing what the probe made first');
    cleanup(ctx).finally(() => process.exit(130));
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-53-root-'));
    assertUnderTmp(ctx.root);
    ctx.project = await makeScratchProject({
      name: '53-project',
      files: {
        'package.json': `${JSON.stringify({ name: 'probe', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
        'test/probe.test.js': "import { test } from 'node:test';\nimport fs from 'node:fs';\ntest('runs', () => { fs.writeFileSync('ran.txt', 'ran\\n'); });\n",
      },
    });

    // The low copy and the stand-in runner, for trial 3. The project is labelled low so the runner can write in it.
    const lowNode = process.platform === 'win32' ? await makeLowNode(ctx) : { node: path.join(ctx.root, 'bin', 'node-low.exe'), low: false, why: 'not Windows' };
    if (!fs.existsSync(lowNode.node)) {
      fs.mkdirSync(path.dirname(lowNode.node), { recursive: true });
      fs.copyFileSync(process.execPath, lowNode.node);
    }
    const runnerFile = path.join(ctx.root, 'runner', 'standin-runner.js');
    fs.mkdirSync(path.dirname(runnerFile), { recursive: true });
    fs.copyFileSync(path.join(HERE, 'standin-runner.js'), runnerFile);
    if (lowNode.low) {
      const labelled = await exec('icacls', [ctx.project.dir, '/setintegritylevel', '(OI)(CI)L']);
      if (labelled.code !== 0) lowNode.low = false;
    }
    await say(ctx, 'SEEN', 'low-copy', lowNode.low ? 'a copy of node.exe labelled low starts at low; trial 3 runs the stand-in runner at low' : `trial 3 will run the stand-in runner at the normal level: ${lowNode.why}`);

    // 1. no allow rule
    const first = await trial(ctx, { name: 'grants-no-allow-rule', prompt: PROMPTS.plain, judge: judgeRefused });
    if (first.fatal) return 1;
    // 2. npm test allowed by name
    await trial(ctx, { name: 'grants-npm-test-allowed', prompt: PROMPTS.plain, allowedTools: NPM_RULE, judge: judgeAllowed });
    // 3. the runner's rule
    let command;
    let rule;
    try {
      command = `${runnerPrefix(lowNode.node, runnerFile, { platform: process.platform })} npm test`;
      rule = runnerRule(lowNode.node, runnerFile, { platform: process.platform });
    } catch (error) {
      await say(ctx, 'SEEN', 'grants-runner-rule', `the probe's scratch path can't be written into a rule (${error.message}); trials 3 and 4 were not run`);
      return finish(ctx);
    }
    await say(ctx, 'SEEN', 'grants-runner-rule-form', rule.replace(os.tmpdir().replaceAll('\\', '/'), '<temp>'));
    const third = await trial(ctx, { name: 'grants-runner-rule', prompt: PROMPTS.runner(command), allowedTools: rule, judge: judgeAllowed });
    if (third.runnerNote) {
      const level = /integrity=(\w+)/.exec(third.runnerNote)?.[1] ?? 'unknown';
      await say(ctx, lowNode.low && level !== 'low' && third.ran ? 'FAIL' : 'SEEN', 'grants-runner-integrity', `the stand-in runner reported it ran at ${level}${lowNode.low ? '' : ' (no low copy was available, so normal is expected)'}`);
    } else if (third.ran) {
      await say(ctx, 'SEEN', 'grants-runner-integrity', 'npm test ran but the runner left no note');
    }
    // 4. a plain npm test with only the runner's rule
    await trial(ctx, { name: 'grants-plain-npm-test-with-runner-rule-only', prompt: PROMPTS.plain, allowedTools: rule, judge: judgeRefused });
    await say(ctx, 'SEEN', 'desktop-local-sandbox', 'not run by the script: the director looks at Claude Desktop (Settings, Claude Code, a "Local sandbox" row) and runs `touch ~/sandbox-probe` in a local session; see probes/53-windows-grants/run.md');
    return finish(ctx);
  } finally {
    await cleanup(ctx);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

function finish(ctx) {
  console.log(`Check 53 on ${process.platform}: ${ctx.counts.PASS} PASS, ${ctx.counts.FAIL} FAIL, ${ctx.counts.SEEN} SEEN`);
  console.log(`Log: ${ctx.log}`);
  return ctx.counts.FAIL ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(`Check 53 on ${process.platform}: FAIL (${error.message})`); process.exitCode = 2; },
  );
}
