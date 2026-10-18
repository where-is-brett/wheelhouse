// probes/29-hold/run.js
// Check 29: the hold. Runs two short headless Claude Code sessions in
// throwaway projects under the temporary folder, each registering hold.js as a
// PreToolUse hook, and asks each for the same four things: a Read of a file,
// an Edit of it, a Write of a new file and a shell command that makes a folder.
//   held   the project holds `.hold-probe`: only the Read may run.
//   free   no marker: all four run.
// It passes when both come out so, judged from the files left on disk and from
// the tool results in the session's events (a refused call still appears in
// the events, so the events alone would not show whether it ran).
// Usage: node probes/29-hold/run.js        (the same on macOS and Windows)
// Prints one line for each session and one final PASS or FAIL line; the log
// (with the tokens used) goes to <home>/.wheelhouse-probes/29-hold/. Real
// sessions cost tokens. Needs the `claude` command; the harness finds it
// (on Windows as claude.exe or claude.cmd).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../scripts/lib/run.js';
import { runSession, modelsUsed, resolveClaude, invocation } from '../../scripts/eval/harness.js';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { makeScratchProject } from '../lib/scratch.js';

const HOOK = fileURLToPath(new URL('./hold.js', import.meta.url));
const SHELL_TOOLS = ['Bash', 'PowerShell'];

export const PROMPT = [
  'Do these four things in this order, one tool call each, then say in one line what happened to each.',
  'If one is refused, carry on with the next.',
  '1. Read the file notes.txt.',
  '2. Edit notes.txt so that the word before becomes the word after.',
  '3. Write a new file named new.txt containing the word written.',
  '4. Run the shell command: mkdir bash-ran',
].join(' ');

// --------------------------------------------------------------- the judgement

// Each tool call in the events with its result: { name, input, isError, text }.
export function callsWithResults(events) {
  const results = new Map();
  for (const event of events) {
    if (event.type !== 'user' || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      if (block.type !== 'tool_result') continue;
      const text = typeof block.content === 'string'
        ? block.content
        : (Array.isArray(block.content) ? block.content.map((part) => part.text ?? '').join('\n') : '');
      results.set(block.tool_use_id, { isError: block.is_error === true, text });
    }
  }
  const calls = [];
  for (const event of events) {
    if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      if (block.type !== 'tool_use') continue;
      calls.push({ name: block.name, input: block.input ?? {}, ...(results.get(block.id) ?? { isError: null, text: '' }) });
    }
  }
  return calls;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// What the four requests left on disk.
export function filesLeft(dir) {
  const notes = readText(path.join(dir, 'notes.txt'));
  return {
    edited: notes !== null && notes.includes('after'),
    written: fs.existsSync(path.join(dir, 'new.txt')),
    shellRan: fs.existsSync(path.join(dir, 'bash-ran')),
  };
}

// held: the Read ran; the Edit, Write and shell command were each tried, refused
// with "probe: held", and left nothing on disk. free: nothing refused, all four done.
export function judge({ events, dir, held }) {
  const calls = callsWithResults(events);
  const read = calls.find((call) => call.name === 'Read');
  const edit = calls.find((call) => call.name === 'Edit');
  const write = calls.find((call) => call.name === 'Write');
  const shell = calls.find((call) => SHELL_TOOLS.includes(call.name));
  const files = filesLeft(dir);
  const summary = `Read ${read ? (read.isError ? 'refused' : 'ran') : 'not tried'}, Edit ${state(edit, files.edited)}, Write ${state(write, files.written)}, shell ${state(shell, files.shellRan)}`;
  const tried = [['Read', read], ['Edit', edit], ['Write', write], ['the shell command', shell]].filter(([, call]) => !call).map(([name]) => name);
  if (tried.length) return { pass: false, why: `${summary}; the session never tried ${tried.join(', ')}` };
  if (held) {
    const refused = [edit, write, shell].every((call) => call.isError === true && call.text.includes('probe: held'));
    if (read.isError) return { pass: false, why: `${summary}; the Read was refused` };
    if (files.edited || files.written || files.shellRan) return { pass: false, why: `${summary}; something got through the hold` };
    if (!refused) return { pass: false, why: `${summary}; the three were not all refused with "probe: held"` };
    return { pass: true, why: summary };
  }
  const refusedAny = [read, edit, write, shell].some((call) => call.text.includes('probe: held'));
  if (refusedAny) return { pass: false, why: `${summary}; the hook refused a call with no marker present` };
  if (read.isError || !files.edited || !files.written || !files.shellRan) return { pass: false, why: `${summary}; not all four ran` };
  return { pass: true, why: summary };
}

function state(call, onDisk) {
  if (!call) return 'not tried';
  if (call.isError) return call.text.includes('probe: held') ? 'refused (probe: held)' : 'failed';
  return onDisk ? 'ran' : 'reported done, nothing on disk';
}

// ------------------------------------------------------------------ a session

async function session({ held }) {
  const hookPath = process.platform === 'win32' ? HOOK.replaceAll('\\', '/') : HOOK;
  const project = await makeScratchProject({
    name: 'hold',
    settings: {
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `node "${hookPath}"` }] }] },
      // These let the shell command run without asking, so that a refusal can only be the hook's.
      permissions: { allow: ['Bash(mkdir bash-ran)', 'PowerShell(mkdir bash-ran)'] },
    },
    files: { 'notes.txt': 'before\n', ...(held ? { '.hold-probe': '' } : {}) },
  });
  try {
    const outcome = await runSession({
      dir: project.dir,
      prompt: PROMPT,
      pluginDirs: [],
      permissionMode: 'acceptEdits',
      maxTurns: 12,
      timeoutMs: 5 * 60 * 1000,
    });
    const judged = judge({ events: outcome.events, dir: project.dir, held });
    return { ...judged, outcome };
  } finally {
    await project.cleanup();
  }
}

async function claudeVersion() {
  try {
    const call = invocation(resolveClaude(), [], ['--version']);
    const result = await run(call.file, call.args, { input: call.input, timeoutMs: 30000, windowsVerbatimArguments: call.verbatim });
    return result.stdout.trim() || result.stderr.trim();
  } catch (error) {
    return `unknown (${error.message})`;
  }
}

export async function main() {
  const version = await claudeVersion();
  const log = path.join(probeLogDir('29-hold'), 'run.jsonl');
  console.log(`Check 29, the hold, on ${process.platform} with Claude Code ${version}`);
  let allPassed = true;
  for (const held of [true, false]) {
    const label = held ? 'held' : 'free';
    const result = await session({ held });
    const { usage, exitCode, events } = result.outcome;
    const notes = [result.why];
    if (exitCode !== 0) notes.push(`claude exited ${exitCode}`);
    if (result.outcome.timedOut) notes.push('timed out');
    if (result.outcome.stderr) notes.push(`stderr: ${result.outcome.stderr.trim().slice(-300)}`);
    console.log(`${label}: ${result.pass ? 'pass' : 'fail'} (${notes.join('; ')}) ${usage.input} in / ${usage.output} out`);
    await appendJsonl(log, {
      at: new Date().toISOString(),
      platform: process.platform,
      claude: version,
      variant: label,
      pass: result.pass,
      why: notes.join('; '),
      usage,
      models: modelsUsed(events),
      calls: callsWithResults(events),
      events,
    });
    if (!result.pass) allPassed = false;
  }
  console.log(`Check 29 on ${process.platform}: ${allPassed ? 'PASS' : 'FAIL'}`);
  console.log(`Log: ${log}`);
  return allPassed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(`Check 29 on ${process.platform}: FAIL (${error.message})`); process.exitCode = 2; },
  );
}
