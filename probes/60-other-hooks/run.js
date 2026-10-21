// probes/60-other-hooks/run.js
// Check 60: what can Copilot's other hooks do? Can sessionStart and userPromptSubmitted add text the agent reads
// (and through which field), can preCompact block a compaction, and does subagentStop name the agent that stopped?
// A hook (hook.js) is registered in the scratch Copilot home's hooks folder, in three files by spelling of the event:
//   camel    probe-camel.json    sessionStart, userPromptSubmitted, preCompact, subagentStart, subagentStop ...
//   pascal   probe-pascal.json   the same names with a capital letter (SessionStart, UserPromptSubmitted ...)
//   claude   probe-claude.json   UserPromptSubmit, Claude Code's own name for the prompt event
// The home's hooks folder is used (not the project's) because check 56 found it loads in every folder.
// Runs, each a fresh Copilot with the scratch home (all with --allow-all-tools and --trust-folder, no tools wanted):
//   markers          sessionStart and userPromptSubmitted hooks each answer with a marker sentence carrying a code
//                    of its own, through one field each (additionalContext, hookSpecificOutput.additionalContext,
//                    systemMessage, plain stdout, and for the prompt event modifiedPrompt), under each spelling.
//                    The prompt asks the agent to repeat every code that starts with WHMARK. Which codes come back,
//                    and which events of Copilot's JSON output hold them, says which fields reach the agent.
//   compact-log      only if markers gave a session id: that session resumed with the prompt /compact, the preCompact
//                    hooks only logging. Shows whether a slash command can be given to -p, and what preCompact gets.
//   compact-fresh    only if compact-log did not fire preCompact: /compact as the first prompt of a new session.
//   compact-block    only if preCompact fired: the resumed session again, the camelCase preCompact hook answering
//                    {"decision":"block"}. Whether Copilot still compacts says whether it can block.
//   compact-exit2    only if the compaction still happened: the same with the hook exiting 2.
//   compact-block-pascal  only if it still happened: the PascalCase hook answering block.
//   subagent         the agent is asked to run the custom agent probe-agent with the task tool, the subagentStart and
//                    subagentStop hooks logging: does the stop input name the agent?
// How a run is judged: from Copilot's own events in its JSON output and the hook log, never from words in the reply,
// except for the markers, which only the reply can show (the events are searched for them too).
//
// Usage: node probes/60-other-hooks/run.js              the trial, run from outside any sandbox
//        node probes/60-other-hooks/run.js --dry-run    the same plumbing against a stand-in Copilot
// Options: --bin <path>, --timeout-ms <n> (one run, default 300000), --results-dir <dir>
//
// Model runs: 3 to 7 (markers, compact-log, [compact-fresh], [compact-block, compact-exit2, compact-block-pascal],
// subagent); the first compaction run is only made when markers finishes with a session id. Everything it makes is
// under the temporary folder and is removed when it ends, also on Ctrl-C. It never reads or writes the real
// ~/.copilot or ~/.wheelhouse.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOGIN_HOME, copilotBin, defaultPrefix, runCopilot, scratchCopilotHome } from '../lib/copilot.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';
import { readHookLog } from '../56-registration/run.js';
import { toolEvents, toolOutcomes } from '../58-hook-input/run.js';

export const CHECK = '60-other-hooks';
export const SPELLINGS = ['camel', 'pascal', 'claude'];
export const LOG_EVENTS = ['sessionStart', 'userPromptSubmitted', 'preCompact', 'subagentStart', 'subagentStop', 'agentStop', 'sessionEnd'];
const capital = (name) => name[0].toUpperCase() + name.slice(1);
// The event name a spelling registers: claude only has the prompt event, under Claude Code's name.
export function eventName(spelling, event) {
  if (spelling === 'camel') return event;
  if (spelling === 'pascal') return capital(event);
  return event === 'userPromptSubmitted' ? 'UserPromptSubmit' : null;
}
export const SESSION_FIELDS = ['additionalContext', 'hookSpecific', 'systemMessage', 'plain'];
export const PROMPT_FIELDS = [...SESSION_FIELDS, 'modifiedPrompt'];

const HOOK = fileURLToPath(new URL('./hook.js', import.meta.url));
const FAKE = fileURLToPath(new URL('./fake-copilot.js', import.meta.url));

export const AGENT_FILE = '---\nname: probe-agent\ndescription: Replies with the single word ok\n---\nReply with the single word ok and nothing else.\n';
export const MARKER_PROMPT = 'Without using any tool, list every code you were given that starts with WHMARK, each on its own line with the sentence it came with. If you were given none, say only: none.';
export const COMPACT_PROMPT = '/compact';
export const SUBAGENT_PROMPT = 'Use the task tool to run the custom agent probe-agent with the prompt "Reply ok". Then say done.';

// ------------------------------------------------------------------ options

export function parseOptions(argv) {
  const options = { dryRun: false, bin: '', timeoutMs: 300_000, resultsDir: path.join(os.tmpdir(), 'wheelhouse-probe-results') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--bin') options.bin = argv[++i] ?? '';
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--results-dir') options.resultsDir = argv[++i] ?? '';
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout-ms is a number of milliseconds');
  if (!options.resultsDir) throw new Error('--results-dir needs a folder');
  return options;
}

// ----------------------------------------------------------------- markers

// One marker per (spelling, event, field), each with a code of its own so a reply can be traced to its hook.
export function makeMarkers(random = () => crypto.randomBytes(3).toString('hex')) {
  const markers = [];
  for (const [kind, event, fields] of [['session', 'sessionStart', SESSION_FIELDS], ['prompt', 'userPromptSubmitted', PROMPT_FIELDS]]) {
    for (const spelling of SPELLINGS) {
      const name = eventName(spelling, event);
      if (!name) continue;
      for (const field of fields) markers.push({ id: `${spelling}/${kind}/${field}`, spelling, kind, event: name, field, token: `WHMARK-${random()}` });
    }
  }
  return markers;
}

// -------------------------------------------------------------- hook files

export function hookCommand({ hook = HOOK, log, tag, event, mode = 'log', field = '', token = '' }) {
  return `node "${hook}" "${log}" ${tag} ${event} ${mode}${field ? ` ${field}` : ''}${token ? ` ${token}` : ''}`;
}

// compactMode: what the preCompact hook does (log, block or exit2); compactActs: the spelling whose hook does it.
export function hookFiles({ hook = HOOK, log, markers = [], compactMode = 'log', compactActs = 'camel', timeoutSec = 30 }) {
  const entry = (command) => ({ type: 'command', bash: command, powershell: command, timeoutSec });
  const files = {};
  for (const spelling of SPELLINGS) {
    const hooks = {};
    const add = (name, command) => { (hooks[name] ??= []).push(entry(command)); };
    for (const event of LOG_EVENTS) {
      const name = eventName(spelling, event);
      if (!name) continue;
      const acts = event === 'preCompact' && spelling === compactActs;
      add(name, hookCommand({ hook, log, tag: `${spelling}:log`, event: name, mode: acts ? compactMode : 'log' }));
    }
    for (const marker of markers.filter((m) => m.spelling === spelling)) {
      add(marker.event, hookCommand({ hook, log, tag: `${spelling}:${marker.field}`, event: marker.event, mode: 'marker', field: marker.field, token: marker.token }));
    }
    if (Object.keys(hooks).length) files[`probe-${spelling}.json`] = { version: 1, hooks };
  }
  return files;
}

export function projectFiles() {
  return {
    'README.md': 'Wheelhouse probe 60.\n',
    [path.join('.github', 'agents', 'probe-agent.agent.md')]: AGENT_FILE,
  };
}

export function copilotArgs({ prompt, logDir, resume }) {
  return [
    '-p', prompt,
    '--output-format', 'json', '--no-auto-update', '--disable-builtin-mcps',
    '--allow-all-tools', '--trust-folder', '--no-ask-user',
    ...(resume ? [`--resume=${resume}`] : []),
    '--log-dir', logDir, '--log-level', 'debug',
  ];
}

// --------------------------------------------------------------- analysis

const started = (entries) => entries.filter((entry) => entry?.tag && entry.phase !== 'woke');

// { tag: { event: n } } of the hooks that ran.
export function countHooks(entries) {
  const counts = {};
  for (const entry of started(entries)) {
    counts[entry.tag] ??= {};
    counts[entry.tag][entry.event] = (counts[entry.tag][entry.event] ?? 0) + 1;
  }
  return counts;
}

export function assistantText(events) {
  return events.filter((event) => event?.type === 'assistant.message').map((event) => String(event.data?.content ?? '')).join('\n');
}

// For each marker: whether its hook ran, whether the reply holds its code, and which event types of the JSON output
// hold the code anywhere (a hook's answer reaching the model's input might show in an event of its own).
export function markerOutcomes(markers, events, entries) {
  const reply = assistantText(events);
  return markers.map((marker) => {
    const ran = started(entries).filter((entry) => entry.tag === `${marker.spelling}:${marker.field}` && entry.event === marker.event).length;
    const types = [...new Set(events.filter((event) => JSON.stringify(event).includes(marker.token)).map((event) => event.type))];
    return { id: marker.id, event: marker.event, field: marker.field, ran, inReply: reply.includes(marker.token), inEventTypes: types };
  });
}

// A summary line per field: replied under which spellings.
export function fieldTable(outcomes) {
  const table = {};
  for (const outcome of outcomes) {
    const [spelling, kind] = outcome.id.split('/');
    ((table[`${kind}/${outcome.field}`] ??= {})[spelling]) = outcome.ran === 0 ? 'hook did not run' : outcome.inReply ? 'in reply' : outcome.inEventTypes.length ? `events only: ${outcome.inEventTypes.join(',')}` : 'not seen';
  }
  return table;
}

export function compactionEventTypes(events) {
  return [...new Set(events.filter((event) => /compact/i.test(String(event?.type))).map((event) => event.type))];
}

// Whether Copilot compacted: an event about compaction that says it finished.
export function compactionHappened(events) {
  return events.some((event) => /compact/i.test(String(event?.type)) && /complete|finish|done|end/i.test(String(event.type)) && event.data?.success !== false);
}

export function preCompactRan(entries) {
  return started(entries).some((entry) => /^precompact$/i.test(entry.event) && /:log$/.test(entry.tag));
}

// The subagent hooks' inputs, and where (if anywhere) the stopped agent's name is in the stop input.
export function subagentFindings(entries, name = 'probe-agent') {
  const found = { starts: [], stops: [], namedIn: [] };
  for (const entry of started(entries)) {
    if (/^subagentstart$/i.test(entry.event)) found.starts.push({ tag: entry.tag, input: entry.input });
    if (/^subagentstop$/i.test(entry.event)) {
      found.stops.push({ tag: entry.tag, input: entry.input });
      for (const [key, value] of Object.entries(entry.input ?? {})) if (typeof value === 'string' && value.includes(name)) found.namedIn.push(`${entry.tag}:${key}`);
    }
  }
  return found;
}

const LOG_LINE = /hook|plugin|compact/i;
const TOKEN = /\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/g;
export function copilotLogLines(dir, { max = 300, width = 400 } = {}) {
  const lines = [];
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch { return lines; }
  for (const name of names) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!LOG_LINE.test(line)) continue;
      lines.push(line.replace(TOKEN, '[redacted]').slice(0, width));
      if (lines.length >= max) return lines;
    }
  }
  return lines;
}

// ---------------------------------------------------------------- summary

export function summarise(results) {
  const out = [];
  out.push(`Check ${CHECK}${results.dryRun ? ' (dry run, against a stand-in)' : ''}: ${results.runs.length} model run(s), Copilot ${results.copilotVersion || 'version unknown'}`);
  for (const run of results.runs) {
    out.push(`${run.id.padEnd(22)} exit ${String(run.code).padEnd(4)}${run.timedOut ? ' TIMED OUT' : ''} ${Math.round(run.durationMs / 1000)}s   hooks run: ${Object.entries(run.hookCounts).map(([tag, events]) => `${tag}=${Object.values(events).reduce((a, b) => a + b, 0)}`).join(' ') || 'none'}`);
    if (run.fieldTable) {
      for (const [field, row] of Object.entries(run.fieldTable)) out.push(`    ${field.padEnd(28)} ${Object.entries(row).map(([spelling, word]) => `${spelling}: ${word}`).join('; ')}`);
    }
    if (run.compaction) out.push(`    preCompact ran: ${run.compaction.preCompactRan}; compaction events: ${run.compaction.eventTypes.join(', ') || 'none'}; compacted: ${run.compaction.happened}`);
    if (run.subagent) out.push(`    subagentStart inputs: ${run.subagent.starts.length}; subagentStop inputs: ${run.subagent.stops.length}; agent named in stop input: ${run.subagent.namedIn.join(', ') || 'no'}`);
  }
  for (const note of results.notes) out.push(`Note: ${note}`);
  if (results.error) out.push(`STOPPED EARLY: ${String(results.error).split('\n')[0]}`);
  return out.join('\n');
}

// ------------------------------------------------------------------- main

function fakeBin(dir) {
  const bin = path.join(dir, 'copilot');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  return bin;
}

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export async function main(argv = process.argv.slice(2), { out = console.log, settleMs } = {}) {
  const options = parseOptions(argv);
  const settle = settleMs ?? (options.dryRun ? 0 : 1000);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-otherhooks-work-'));
  assertUnderTmp(work);
  const log = path.join(work, 'hooks.jsonl');
  const undo = [() => fs.rmSync(work, { recursive: true, force: true })];
  const cleanup = () => { for (const step of undo.splice(0).reverse()) { try { step(); } catch { /* keep undoing the rest */ } } };
  const onSignal = (signal) => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const markers = makeMarkers();
  const results = {
    check: CHECK, dryRun: options.dryRun, startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    options: { timeoutMs: options.timeoutMs }, permissionFlags: ['--allow-all-tools', '--trust-folder', '--no-ask-user'],
    copilotVersion: '', bin: '', markers: markers.map(({ id, event, field, token }) => ({ id, event, field, token })),
    runs: [], notes: [], compactionTriggerable: null, preCompactCanBlock: null, error: null,
  };

  try {
    const bin = options.bin || (options.dryRun ? fakeBin(work) : copilotBin(defaultPrefix()));
    results.bin = bin;
    if (!fs.existsSync(bin)) throw new Error(`There is no Copilot at ${bin}. Install the pinned version first (installCopilot in probes/lib/copilot.js).`);

    const home = options.dryRun ? scratchCopilotHome() : scratchCopilotHome({ signedInFrom: LOGIN_HOME });
    undo.push(() => home.remove());
    const version = await runCopilot({ args: ['--version'], cwd: work, home: home.dir, bin, timeoutMs: 60_000 });
    results.copilotVersion = version.stdout.trim().split('\n')[0] ?? '';

    fs.mkdirSync(path.join(home.dir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home.dir, 'agents', 'probe-agent.agent.md'), AGENT_FILE);
    const hooksDir = path.join(home.dir, 'hooks');

    const project = await makeScratchProject({ name: 'otherhooks', files: projectFiles() });
    const cwd = project.dir;
    undo.push(() => { assertUnderTmp(cwd); fs.rmSync(cwd, { recursive: true, force: true }); });

    const runOne = async ({ id, prompt, resume, withMarkers = false, compactMode = 'log', compactActs = 'camel' }) => {
      fs.rmSync(hooksDir, { recursive: true, force: true });
      fs.mkdirSync(hooksDir, { recursive: true });
      const active = withMarkers ? markers : [];
      for (const [name, data] of Object.entries(hookFiles({ log, markers: active, compactMode, compactActs }))) {
        fs.writeFileSync(path.join(hooksDir, name), JSON.stringify(data, null, 2) + '\n');
      }
      fs.writeFileSync(log, '');
      const logDir = path.join(work, `copilot-log-${id}`);
      const args = copilotArgs({ prompt, logDir, resume });
      const t0 = Date.now();
      const result = await runCopilot({ args, cwd, home: home.dir, bin, timeoutMs: options.timeoutMs });
      await sleep(settle);
      const hookEntries = readHookLog(log);
      const final = result.events.find((event) => event.type === 'result') ?? null;
      const run = {
        id, args, cwd, code: result.code, timedOut: result.timedOut, durationMs: Date.now() - t0,
        stdout: result.stdout, stderr: result.stderr, result: final, sessionId: final?.sessionId ?? null,
        toolEvents: toolEvents(result.events), toolOutcomes: toolOutcomes(result.events),
        eventTypes: [...new Set(result.events.map((event) => event.type))],
        hookCounts: countHooks(hookEntries), hookEntries, copilotLogLines: copilotLogLines(logDir),
        compaction: { preCompactRan: preCompactRan(hookEntries), eventTypes: compactionEventTypes(result.events), happened: compactionHappened(result.events) },
      };
      if (withMarkers) {
        run.markerOutcomes = markerOutcomes(markers, result.events, hookEntries);
        run.fieldTable = fieldTable(run.markerOutcomes);
        run.reply = assistantText(result.events);
      }
      if (id === 'subagent') run.subagent = subagentFindings(hookEntries);
      results.runs.push(run);
      return run;
    };

    const first = await runOne({ id: 'markers', prompt: MARKER_PROMPT, withMarkers: true });
    const session = first.sessionId;

    // Compaction: a resumed session given /compact, then (if that fires nothing) a new session given it.
    let compactor = null;
    if (session) {
      const logged = await runOne({ id: 'compact-log', prompt: COMPACT_PROMPT, resume: session });
      if (logged.compaction.preCompactRan) compactor = { resume: session };
      else {
        results.notes.push('compact-log: the resumed session given /compact did not run any preCompact hook.');
        const fresh = await runOne({ id: 'compact-fresh', prompt: COMPACT_PROMPT });
        if (fresh.compaction.preCompactRan) compactor = { resume: null };
        else results.notes.push('compact-fresh: a new session given /compact did not run any preCompact hook either.');
      }
    } else {
      results.notes.push('The markers run gave no session id, so no resumed session was tried for /compact.');
    }
    results.compactionTriggerable = compactor !== null;
    if (compactor) {
      for (const [id, compactMode, compactActs] of [['compact-block', 'block', 'camel'], ['compact-exit2', 'exit2', 'camel'], ['compact-block-pascal', 'block', 'pascal']]) {
        const run = await runOne({ id, prompt: COMPACT_PROMPT, resume: compactor.resume, compactMode, compactActs });
        if (!run.compaction.happened) { results.preCompactCanBlock = id; break; }
      }
      if (results.preCompactCanBlock === null) results.notes.push('Compaction still happened with every blocking answer tried.');
    }

    await runOne({ id: 'subagent', prompt: SUBAGENT_PROMPT });
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
