// probes/58-hook-input/run.js
// Check 58: what does a Copilot guard get as input, for every tool, and how does its answer land?
// A logger-and-guard hook (guard.js) is registered in the scratch Copilot home's hooks folder three ways:
//   camel          flat file, camelCase events (preToolUse ...), Copilot's own format
//   pascal         flat file, PascalCase events (PreToolUse ...)
//   pascal-nested  Claude Code's nested form (a matcher group around the hooks), PascalCase events
// The home's hooks folder is used (not the project's) because a repository's hooks may load only in a trusted
// folder (check 56); the run also passes --trust-folder, so the scratch project is trusted either way.
// Runs, each a fresh Copilot with the scratch home:
//   all-tools   one prompt that makes the session use each tool once (shell, view, edit, create, grep, glob,
//               web fetch, task with a custom agent, the MCP stand-in's echo, and PowerShell only when pwsh exists)
//   gap-fill    only if some tool was not seen: a second prompt for just those (at most one)
//   ask-user    a prompt that asks for ask_user alone, run without --no-ask-user, to see if it can be triggered
//               headlessly (it may wait for an answer that never comes, so it has a shorter time limit)
//   deny-view   the camelCase preToolUse hook answers permissionDecision deny for the view tool
//   exit-1      the camelCase preToolUse hook exits 1
//   exit-2      the camelCase preToolUse hook exits 2
//   sleep       the camelCase preToolUse hook has timeoutSec 5 and sleeps for 10 seconds
// The four last runs ask for a view of README.md (its secret word shows whether the view went through) and a
// create of out.txt (the file system shows whether it went through).
// Permissions: every run passes --allow-all-tools (so no permission prompt blocks a tool) and --allow-url for the
// stand-in web page on 127.0.0.1, which a local server in this process serves. The web fetch is therefore only
// to this machine.
//
// Usage: node probes/58-hook-input/run.js              the trial, run from outside any sandbox
//        node probes/58-hook-input/run.js --dry-run    the same plumbing against a stand-in Copilot
// Options: --bin <path>, --timeout-ms <n> (one run, default 300000), --timeout-sec <n> (the sleep run's hook
//          timeoutSec, default 5), --sleep-sec <n> (default timeout-sec + 5), --results-dir <dir>
//
// Model runs: 6 to 7 (all-tools, gap-fill only when needed, ask-user, deny-view, exit-1, exit-2, sleep). Everything
// it makes is under the temporary folder and is removed when it ends, also on Ctrl-C. It never reads or writes the
// real ~/.copilot or ~/.wheelhouse.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOGIN_HOME, copilotBin, defaultPrefix, runCopilot, scratchCopilotHome } from '../lib/copilot.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';
import { hookLogLines, readHookLog } from '../56-registration/run.js';

export const CHECK = '58-hook-input';
export const TAGS = ['camel', 'pascal', 'pascal-nested'];
export const CAMEL_EVENTS = ['sessionStart', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'subagentStart', 'subagentStop'];
export const PASCAL_EVENTS = CAMEL_EVENTS.map((event) => event[0].toUpperCase() + event.slice(1));

const GUARD = fileURLToPath(new URL('./guard.js', import.meta.url));
const MCP = fileURLToPath(new URL('./mcp.js', import.meta.url));
const FAKE = fileURLToPath(new URL('./fake-copilot.js', import.meta.url));

// The tools to cover, how a tool's name (whatever Copilot calls it) is recognised, and what to say to use it.
export const STEPS = [
  { key: 'shell', name: /^(bash|shell)$/i, text: 'Use the shell tool to run the command `echo probe58-shell`.' },
  { key: 'powershell', name: /powershell/i, text: 'Use the powershell tool to run `Write-Output probe58-powershell`.', needs: 'pwsh' },
  { key: 'view', name: /^(view|read)$/i, text: 'Use the view tool to view README.md.' },
  { key: 'edit', name: /^(edit|str_replace)/i, text: 'Use the edit tool to change the word alpha to beta in edit-me.txt.' },
  { key: 'create', name: /^(create|write)$/i, text: 'Use the create tool to create out.txt containing the word went-through.' },
  { key: 'grep', name: /^grep$/i, text: 'Use the grep tool to search the folder for the word secret.' },
  { key: 'glob', name: /^glob$/i, text: 'Use the glob tool to find the files matching *.md.' },
  { key: 'web_fetch', name: /web_?fetch/i, text: 'Use the web fetch tool to fetch __URL__ and tell me its first line.' },
  { key: 'task', name: /^(task|agent)$/i, text: 'Use the task tool to run the custom agent probe-agent with the prompt "Reply ok".' },
  { key: 'echo', name: /echo/i, text: 'Use the echo tool from the probe58 MCP server with the text probe58.' },
];
export const ASK_USER = { key: 'ask_user', name: /ask_?user/i, text: 'Use the ask_user tool to ask me which colour I prefer, offering red or blue.' };
export const EXTRA_PROMPT = 'Use the view tool to view README.md and tell me its secret word. Then use the create tool to create out.txt containing the word went-through. Then say done.';
export const EXTRAS = [
  { id: 'deny-view', mode: 'deny' },
  { id: 'exit-1', mode: 'exit1' },
  { id: 'exit-2', mode: 'exit2' },
  { id: 'sleep', mode: 'sleep' },
];

export function categoryOf(toolName) {
  const name = String(toolName ?? '');
  for (const step of [...STEPS, ASK_USER]) if (step.name.test(name)) return step.key;
  return null;
}

// ------------------------------------------------------------------ options

export function parseOptions(argv) {
  const options = { dryRun: false, bin: '', timeoutMs: 300_000, timeoutSec: 5, sleepSec: null, resultsDir: path.join(os.tmpdir(), 'wheelhouse-probe-results') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--bin') options.bin = argv[++i] ?? '';
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--timeout-sec') options.timeoutSec = Number(argv[++i]);
    else if (arg === '--sleep-sec') options.sleepSec = Number(argv[++i]);
    else if (arg === '--results-dir') options.resultsDir = argv[++i] ?? '';
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout-ms is a number of milliseconds');
  if (!Number.isFinite(options.timeoutSec) || options.timeoutSec <= 0) throw new Error('--timeout-sec is a number of seconds');
  if (options.sleepSec === null) options.sleepSec = options.timeoutSec + 5;
  if (!Number.isFinite(options.sleepSec) || options.sleepSec <= 0) throw new Error('--sleep-sec is a number of seconds');
  if (!options.resultsDir) throw new Error('--results-dir needs a folder');
  return options;
}

// -------------------------------------------------------------- hook files

export function hookCommand({ guard = GUARD, log, tag, event, mode = 'log', seconds }) {
  return `node "${guard}" "${log}" ${tag} ${event} ${mode}${seconds === undefined ? '' : ` ${seconds}`}`;
}

// The three hook files. Only the camelCase preToolUse hook acts on `mode`; every other registration only logs.
export function hookFiles({ guard = GUARD, log, mode = 'log', seconds, timeoutSec = 30 }) {
  const entry = (tag, event, acts) => {
    const command = hookCommand({ guard, log, tag, event, mode: acts ? mode : 'log', seconds: acts ? seconds : undefined });
    return { type: 'command', bash: command, powershell: command, timeoutSec: acts && mode === 'sleep' ? timeoutSec : 30 };
  };
  const flat = (tag, events) => ({ version: 1, hooks: Object.fromEntries(events.map((event) => [event, [entry(tag, event, tag === 'camel' && event === 'preToolUse')]])) });
  const nested = {
    version: 1,
    hooks: Object.fromEntries(PASCAL_EVENTS.map((event) => {
      const command = hookCommand({ guard, log, tag: 'pascal-nested', event });
      return [event, [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 30 }] }]];
    })),
  };
  return { 'probe-camel.json': flat('camel', CAMEL_EVENTS), 'probe-pascal.json': flat('pascal', PASCAL_EVENTS), 'probe-pascal-nested.json': nested };
}

export function mcpConfig({ node = process.execPath, mcp = MCP } = {}) {
  return { mcpServers: { probe58: { type: 'local', command: node, args: [mcp], tools: ['*'] } } };
}

export const AGENT_FILE = '---\nname: probe-agent\ndescription: Replies with the single word ok\n---\nReply with the single word ok and nothing else.\n';

export function projectFiles(secret) {
  return {
    'README.md': `Wheelhouse probe 58. The secret word is ${secret}.\n`,
    'edit-me.txt': 'alpha\n',
    [path.join('.github', 'agents', 'probe-agent.agent.md')]: AGENT_FILE,
  };
}

// ----------------------------------------------------------------- prompts

export function stepsFor({ pwsh }) {
  return STEPS.filter((step) => step.needs !== 'pwsh' || pwsh);
}

export function allToolsPrompt({ url, pwsh, keys }) {
  const steps = stepsFor({ pwsh }).filter((step) => !keys || keys.includes(step.key));
  const lines = steps.map((step, i) => `${i + 1}. ${step.text.replace('__URL__', url)}`);
  return `Do these steps in order, once each, using exactly the tool named. If a tool fails or is refused, say so and go on to the next step. Do not skip a step.\n${lines.join('\n')}\nThen say done.`;
}

export function askUserPrompt() {
  return `${ASK_USER.text} Then say done.`;
}

export function copilotArgs({ prompt, logDir, url, askUser = false }) {
  return [
    '-p', prompt,
    '--output-format', 'json', '--no-auto-update', '--disable-builtin-mcps',
    '--allow-all-tools', '--allow-url', url ? new URL(url).hostname : '127.0.0.1', '--trust-folder',
    ...(askUser ? [] : ['--no-ask-user']),
    '--log-dir', logDir, '--log-level', 'debug',
  ];
}

// --------------------------------------------------------------- analysis

export const toolOf = (entry) => entry?.input?.toolName ?? entry?.input?.tool_name ?? null;
const started = (entries) => entries.filter((entry) => entry?.tag && entry.phase !== 'woke');

// { tag: { event: n } } for the hooks that started, zeros included for the registered tags and events.
export function countHooks(entries) {
  const counts = {};
  for (const tag of TAGS) counts[tag] = Object.fromEntries((tag === 'camel' ? CAMEL_EVENTS : PASCAL_EVENTS).map((event) => [event, 0]));
  for (const entry of started(entries)) {
    counts[entry.tag] ??= {};
    counts[entry.tag][entry.event] = (counts[entry.tag][entry.event] ?? 0) + 1;
  }
  return counts;
}

// The tool names the guards saw on preToolUse, per tag, in order.
export function toolsByTag(entries) {
  const out = {};
  for (const entry of started(entries)) {
    if (!/^pretooluse$/i.test(entry.event) || !toolOf(entry)) continue;
    (out[entry.tag] ??= []).push(toolOf(entry));
  }
  return out;
}

export function seenKeys(entries) {
  const keys = new Set();
  for (const entry of started(entries)) {
    if (!/^pretooluse$/i.test(entry.event)) continue;
    const key = categoryOf(toolOf(entry));
    if (key) keys.add(key);
  }
  return keys;
}

// { tag: { event: { tool: [input keys] } } } from the hooks that started.
export function inputKeys(entries) {
  const out = {};
  for (const entry of started(entries)) {
    const tool = toolOf(entry) ?? '(no tool)';
    ((out[entry.tag] ??= {})[entry.event] ??= {})[tool] ??= Object.keys(entry.input ?? {}).sort();
  }
  return out;
}

// Top-level input keys and environment variables that look like they name a permission mode, a sandbox, a mode or a version.
const MODE_WORD = /permission|sandbox|mode|approv|autopilot|version|trust/i;
export function modeFields(entries) {
  const inputs = new Set();
  const envNames = new Set();
  for (const entry of started(entries)) {
    for (const key of Object.keys(entry.input ?? {})) if (MODE_WORD.test(key)) inputs.add(key);
    for (const name of Object.keys(entry.env ?? {})) if (MODE_WORD.test(name)) envNames.add(name);
  }
  return { inputKeys: [...inputs].sort(), envNames: [...envNames].sort() };
}

// The first entry for each tag, event and tool: what the fixtures are made from.
export function samples(entries) {
  const out = {};
  for (const entry of started(entries)) {
    const key = `${entry.tag}/${entry.event}/${toolOf(entry) ?? '(none)'}`;
    out[key] ??= entry;
  }
  return out;
}

const NOT_TOOL_RUN = /mcp_server|tools_loaded|tools_updated|tools_changed/;
export function toolEvents(events) {
  return events.filter((event) => /tool/i.test(String(event?.type)) && !NOT_TOOL_RUN.test(String(event.type)));
}

// ---------------------------------------------------------------- summary

export function summarise(results) {
  const out = [];
  out.push(`Check ${CHECK}${results.dryRun ? ' (dry run, against a stand-in)' : ''}: ${results.runs.length} model run(s), Copilot ${results.copilotVersion || 'version unknown'}; pwsh ${results.pwsh ? 'present' : 'absent'}`);
  for (const run of results.runs) {
    out.push(`${run.id.padEnd(10)} exit ${String(run.code).padEnd(4)}${run.timedOut ? ' TIMED OUT' : ''} ${Math.round(run.durationMs / 1000)}s`);
    const camel = run.toolsByTag?.camel ?? [];
    const all = Object.entries(run.toolsByTag ?? {}).map(([tag, tools]) => `${tag}=${tools.length}`).join(' ');
    out.push(`           tools seen (camel): ${camel.join(', ') || 'none'}   [preToolUse per registration: ${all || 'none'}]`);
    if (run.checks) {
      const c = run.checks;
      out.push(`           view went through (secret seen): ${c.secretSeen}   out.txt created: ${c.outTxt !== null}   edit-me.txt: ${JSON.stringify(c.editMe)}`);
    }
    if (run.mode === 'sleep') out.push(`           hook woke after sleeping: ${run.hookEntries.some((e) => e.phase === 'woke')}`);
  }
  if (results.missing?.length) out.push(`Not seen after the gap-fill: ${results.missing.join(', ')}`);
  const fields = results.modeFields;
  if (fields) out.push(`Mode/sandbox/version-looking input fields: ${fields.inputKeys.join(', ') || 'none'}; environment names: ${fields.envNames.join(', ') || 'none'}`);
  if (results.error) out.push(`STOPPED EARLY: ${String(results.error).split('\n')[0]}`);
  return out.join('\n');
}

// ------------------------------------------------------------------- main

function fakeBin(dir) {
  const bin = path.join(dir, 'copilot');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  return bin;
}

export function pwshPresent() {
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', timeout: 20_000 });
  return result.status === 0;
}

function startPage() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('probe58 stand-in page, line one\nline two\n');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/probe58` }));
  });
}

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export async function main(argv = process.argv.slice(2), { out = console.log, settleMs, pwsh } = {}) {
  const options = parseOptions(argv);
  const settle = settleMs ?? (options.dryRun ? 0 : 1000);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-hookinput-work-'));
  assertUnderTmp(work);
  const log = path.join(work, 'hooks.jsonl');
  const undo = [() => fs.rmSync(work, { recursive: true, force: true })];
  const cleanup = () => { for (const step of undo.splice(0).reverse()) { try { step(); } catch { /* keep undoing the rest */ } } };
  const onSignal = (signal) => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const hasPwsh = pwsh ?? (options.dryRun ? false : pwshPresent());
  const results = {
    check: CHECK, dryRun: options.dryRun, startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    options: { timeoutMs: options.timeoutMs, timeoutSec: options.timeoutSec, sleepSec: options.sleepSec },
    permissionFlags: ['--allow-all-tools', '--allow-url (the stand-in page host)', '--trust-folder'],
    pwsh: hasPwsh, copilotVersion: '', bin: '', runs: [], samples: {}, inputKeys: {}, modeFields: null, missing: [], error: null,
  };

  try {
    const bin = options.bin || (options.dryRun ? fakeBin(work) : copilotBin(defaultPrefix()));
    results.bin = bin;
    if (!fs.existsSync(bin)) throw new Error(`There is no Copilot at ${bin}. Install the pinned version first (installCopilot in probes/lib/copilot.js).`);

    const page = await startPage();
    undo.push(() => page.server.close());
    const home = options.dryRun ? scratchCopilotHome() : scratchCopilotHome({ signedInFrom: LOGIN_HOME });
    undo.push(() => home.remove());
    const version = await runCopilot({ args: ['--version'], cwd: work, home: home.dir, bin, timeoutMs: 60_000 });
    results.copilotVersion = version.stdout.trim().split('\n')[0] ?? '';

    fs.mkdirSync(path.join(home.dir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home.dir, 'agents', 'probe-agent.agent.md'), AGENT_FILE);
    fs.writeFileSync(path.join(home.dir, 'mcp-config.json'), JSON.stringify(mcpConfig(), null, 2) + '\n');
    const hooksDir = path.join(home.dir, 'hooks');

    const secret = `secret-${crypto.randomBytes(4).toString('hex')}`;
    const files = projectFiles(secret);
    const project = await makeScratchProject({ name: 'hookinput', files });
    const cwd = project.dir;
    undo.push(() => { assertUnderTmp(cwd); fs.rmSync(cwd, { recursive: true, force: true }); });

    const resetProject = () => {
      for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), text);
      fs.rmSync(path.join(cwd, 'out.txt'), { force: true });
    };
    const readOr = (name) => { try { return fs.readFileSync(path.join(cwd, name), 'utf8'); } catch { return null; } };

    const runOne = async ({ id, mode = 'log', prompt, askUser = false, timeoutMs = options.timeoutMs }) => {
      fs.rmSync(hooksDir, { recursive: true, force: true });
      fs.mkdirSync(hooksDir, { recursive: true });
      for (const [name, data] of Object.entries(hookFiles({ log, mode, seconds: options.sleepSec, timeoutSec: options.timeoutSec }))) {
        fs.writeFileSync(path.join(hooksDir, name), JSON.stringify(data, null, 2) + '\n');
      }
      resetProject();
      fs.writeFileSync(log, '');
      const logDir = path.join(work, `copilot-log-${id}`);
      const args = copilotArgs({ prompt, logDir, url: page.url, askUser });
      const t0 = Date.now();
      const result = await runCopilot({ args, cwd, home: home.dir, bin, timeoutMs });
      // A hook that outlives its time-out may still log that it woke, so the sleep run waits for that.
      await sleep(settle + (mode === 'sleep' ? options.sleepSec * 1000 : 0));
      const hookEntries = readHookLog(log);
      const run = {
        id, mode, args, cwd, code: result.code, timedOut: result.timedOut, durationMs: Date.now() - t0,
        stdout: result.stdout, stderr: result.stderr,
        result: result.events.find((event) => event.type === 'result') ?? null,
        toolEvents: toolEvents(result.events),
        hookCounts: countHooks(hookEntries), toolsByTag: toolsByTag(hookEntries), hookEntries,
        checks: { secretSeen: result.stdout.includes(secret), outTxt: readOr('out.txt'), editMe: readOr('edit-me.txt'), readmeIntact: readOr('README.md') === files['README.md'] },
        copilotLogLines: hookLogLines(logDir),
      };
      results.runs.push(run);
      return run;
    };

    const first = await runOne({ id: 'all-tools', prompt: allToolsPrompt({ url: page.url, pwsh: hasPwsh }) });
    const wanted = stepsFor({ pwsh: hasPwsh }).map((step) => step.key);
    const seen = seenKeys(first.hookEntries);
    const missing = wanted.filter((key) => !seen.has(key));
    if (missing.length) {
      const again = await runOne({ id: 'gap-fill', prompt: allToolsPrompt({ url: page.url, pwsh: hasPwsh, keys: missing }) });
      const seenNow = seenKeys(again.hookEntries);
      results.missing = missing.filter((key) => !seenNow.has(key));
    }
    await runOne({ id: 'ask-user', prompt: askUserPrompt(), askUser: true, timeoutMs: Math.min(options.timeoutMs, 120_000) });
    for (const extra of EXTRAS) await runOne({ id: extra.id, mode: extra.mode, prompt: EXTRA_PROMPT });

    const all = results.runs.flatMap((run) => run.hookEntries);
    results.samples = samples(all);
    results.inputKeys = inputKeys(all);
    results.modeFields = modeFields(all);
    results.askUserSeen = seenKeys(results.runs.find((run) => run.id === 'ask-user')?.hookEntries ?? []).has('ask_user');
  } catch (error) {
    results.error = error?.stack ?? String(error);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
    results.finishedAt = new Date().toISOString();
  }

  fs.mkdirSync(options.resultsDir, { recursive: true });
  const file = path.join(options.resultsDir, `${CHECK}${options.dryRun ? '.dry-run' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  out(summarise(results));
  out(`Raw results: ${file}`);
  return { results, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { results } = await main();
  if (results.error) process.exitCode = 1;
}
