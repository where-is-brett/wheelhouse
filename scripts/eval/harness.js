// scripts/eval/harness.js
// The evaluation harness: runs one headless Claude Code session in a throwaway
// project and reads what it did from the stream-json events it prints.
// Used by scripts/eval/run.js and by the scenarios under tests/eval/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invocation, quoteForCmd, resolveClaude } from '../lib/claude.js';
import { run } from '../lib/run.js';
import { makeScratchProject } from '../../probes/lib/scratch.js';

const VARIANTS = ['with', 'without'];

// Flags checked against `claude --help` before every session. --max-turns is
// left out on purpose: Claude Code 2.1.302 does not list it in --help, yet
// stops a session with `error_max_turns` when it is given (tried on that
// version), so its effect shows in the result event, not the help text.
const NEEDED_FLAGS = ['--print', '--output-format', '--verbose', '--permission-mode', '--plugin-dir', '--setting-sources'];

// ---------------------------------------------------------------- the stream

// One event per line. A line that is not JSON is kept as { type: 'unparsed', line }
// so a stray message from the command shows up instead of vanishing.
export function parseStream(text) {
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ type: 'unparsed', line });
    }
  }
  return events;
}

function blocks(event) {
  const content = event?.message?.content;
  return Array.isArray(content) ? content : [];
}

// Every tool the session called, in order, with its input (a subagent's calls included).
export function toolCalls(events) {
  return events
    .filter((event) => event.type === 'assistant')
    .flatMap((event) => blocks(event).filter((block) => block.type === 'tool_use'))
    .map((block) => ({ name: block.name, input: block.input ?? {} }));
}

// The session's last words: the result event's text, or else the last text the
// main session (not a subagent) wrote.
export function finalText(events) {
  const result = events.findLast((event) => event.type === 'result' && typeof event.result === 'string');
  if (result) return result.result;
  const message = events.findLast((event) => (
    event.type === 'assistant' && !event.parent_tool_use_id && blocks(event).some((block) => block.type === 'text')
  ));
  if (!message) return '';
  return blocks(message).filter((block) => block.type === 'text').map((block) => block.text).join('\n');
}

// Each subagent the session dispatched. Claude Code 2.1.302 calls the tool
// `Agent` in the stream (it lists it as `Task` in the init event); both are read.
// A dispatch with no type is a general-purpose subagent; `model` is whatever the
// dispatching call set (an alias or a full name), or null when it set none.
export function subagents(events) {
  return toolCalls(events)
    .filter((call) => call.name === 'Agent' || call.name === 'Task')
    .map((call) => ({
      type: call.input.subagent_type ?? 'general-purpose',
      model: call.input.model ?? null,
    }));
}

// Whether the session took its prompt in hand (Review Focus 4): false when it made no tool call
// and wrote no text, or ended with a non-zero exit before its first assistant turn. A run that
// was not handled is a failed run, whatever the scenario's pass says.
export function handledOf({ events, exitCode }) {
  const turns = events.filter((event) => event.type === 'assistant');
  if (exitCode !== 0 && turns.length === 0) return false;
  const wrote = turns.some((event) => blocks(event).some((block) => block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== ''));
  return toolCalls(events).length > 0 || wrote;
}

// Whether the session finished (ruling E24): it did not time out, it exited 0, and its result event
// says it succeeded (`subtype: 'success'`, and not `is_error`). A session cut short by its turn
// cap, a crash or the time limit did not, whatever it did first.
export function finishedOf({ events, exitCode, timedOut }) {
  if (timedOut || exitCode !== 0) return false;
  const result = events.findLast((event) => event.type === 'result');
  return result?.subtype === 'success' && result.is_error !== true;
}

// The models the result event says did the work, the main session's and the subagents'.
export function modelsUsed(events) {
  const result = events.findLast((event) => event.type === 'result');
  return Object.keys(result?.modelUsage ?? {});
}

// Tokens from the result event's usage: everything the main session read
// (fresh, cache-written and cache-read input) and what it wrote. Subagents'
// tokens are not in this figure; `totalUsageOf` has them.
export function usageOf(events) {
  const result = events.findLast((event) => event.type === 'result');
  const usage = result?.usage ?? {};
  return {
    input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    output: usage.output_tokens ?? 0,
  };
}

// Tokens across every model that worked, the main session's and the subagents',
// summed from the result event's modelUsage. Falls back to the main session's
// usage when the result carries no modelUsage.
export function totalUsageOf(events) {
  const result = events.findLast((event) => event.type === 'result');
  const perModel = Object.values(result?.modelUsage ?? {});
  if (!perModel.length) return usageOf(events);
  const sum = (key) => perModel.reduce((total, entry) => total + (entry[key] ?? 0), 0);
  return {
    input: sum('inputTokens') + sum('cacheCreationInputTokens') + sum('cacheReadInputTokens'),
    output: sum('outputTokens'),
  };
}

// ------------------------------------------------------------------ a session

export function missingFlags(helpText, flags) {
  return flags.filter((flag) => !new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(helpText));
}

// Finding and starting `claude` lives in scripts/lib/claude.js, shared with the watcher.
export { resolveClaude, quoteForCmd, invocation };

const checkedHelp = new Set();

async function checkFlags({ commandArgs, flags, env, resolved }) {
  const key = `${resolved.file}\0${commandArgs.join('\0')}\0${flags.join(',')}`;
  if (checkedHelp.has(key)) return;
  const help = await start(resolved, { lead: commandArgs, args: ['--help'], env, timeoutMs: 60000 });
  const missing = missingFlags(help.stdout + help.stderr, flags);
  if (missing.length) throw new Error(`This claude does not list the flags the harness needs: ${missing.join(', ')}`);
  checkedHelp.add(key);
}

async function start(resolved, { lead = [], args, prompt, cwd, env, timeoutMs }) {
  const call = invocation(resolved, lead, args, prompt);
  return run(call.file, call.args, { cwd, env, input: call.input, timeoutMs, windowsVerbatimArguments: call.verbatim });
}

// Runs `claude -p` in `dir` and parses what it prints. `command` and
// `commandArgs` are for tests (a stand-in for claude). `settingSources` defaults
// to project and local settings only, so the director's own plugins and hooks
// do not load beside the ones the scenario names with `pluginDirs`.
// `appendSystemPrompt`, when given, is added to the session's system prompt: one
// line with no double quotes, so it passes through claude.cmd on Windows too.
// `extraArgs` go on the command line after the rest, as given. They are not looked
// for in --help: `--permission-prompt-tool`, which a scenario that asks cards
// needs (it is what gives a `claude -p` session AskUserQuestion, on 2.1.302), is
// not listed there as a flag of its own.
export async function runSession({
  dir,
  prompt,
  pluginDirs,
  permissionMode,
  model,
  maxTurns,
  env,
  appendSystemPrompt,
  settingSources = 'project,local',
  extraArgs = [],
  timeoutMs = 20 * 60 * 1000,
  command = 'claude',
  commandArgs = [],
}) {
  // With the default command, find claude (on Windows, its .exe or .cmd); a command given is used as it is.
  const resolved = command === 'claude' ? resolveClaude({ env: { ...process.env, ...env } }) : { kind: 'direct', file: command };
  const flags = [...NEEDED_FLAGS, ...(model ? ['--model'] : []), ...(appendSystemPrompt ? ['--append-system-prompt'] : [])];
  await checkFlags({ commandArgs, flags, env, resolved });
  const args = [
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', permissionMode,
    '--max-turns', String(maxTurns),
    '--setting-sources', settingSources,
    ...pluginDirs.flatMap((pluginDir) => ['--plugin-dir', pluginDir]),
    ...(model ? ['--model', model] : []),
    ...(appendSystemPrompt ? ['--append-system-prompt', appendSystemPrompt] : []),
    ...extraArgs,
  ];
  const result = await start(resolved, { lead: commandArgs, args, prompt, cwd: dir, env, timeoutMs });
  const events = parseStream(result.stdout);
  const outcome = {
    events,
    exitCode: result.code,
    handled: handledOf({ events, exitCode: result.code }),
    usage: usageOf(events),
    totalUsage: totalUsageOf(events),
  };
  if (result.timedOut) outcome.timedOut = true;
  if (result.code !== 0 && !events.length) outcome.stderr = result.stderr.slice(-2000);
  return outcome;
}

// Superpowers' installed folder, read from Claude Code's own list of installed
// plugins (never a path written into the code), so the variants load the copy that is there.
export function locateSuperpowers({ home = os.homedir(), env = process.env } = {}) {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const file = path.join(configDir, 'plugins', 'installed_plugins.json');
  let installed;
  try {
    installed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
  const ids = Object.keys(installed.plugins ?? {}).filter((id) => id.startsWith('superpowers@'));
  ids.sort((a, b) => (b === 'superpowers@claude-plugins-official') - (a === 'superpowers@claude-plugins-official'));
  for (const id of ids) {
    for (const entry of installed.plugins[id]) {
      if (entry.installPath && fs.existsSync(entry.installPath)) return entry.installPath;
    }
  }
  throw new Error(`No installed Superpowers folder found in ${file}`);
}

// Matt Pocock's skills' folder: an install Claude Code records in its list of
// installed plugins, or else the newest copy synced from the organisation's
// catalogue (plugins/synced/<catalogue>/<plugin>/, named in its plugin.json;
// a folder whose name carries `~` is an older generation and is passed over).
export function locateMattSkills({ home = os.homedir(), env = process.env } = {}) {
  const plugins = path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'plugins');
  try {
    const installed = JSON.parse(fs.readFileSync(path.join(plugins, 'installed_plugins.json'), 'utf8'));
    for (const [id, entries] of Object.entries(installed.plugins ?? {})) {
      if (!id.startsWith('mattpocock-skills@') || !Array.isArray(entries)) continue;
      const found = entries.find((entry) => entry.installPath && fs.existsSync(entry.installPath));
      if (found) return found.installPath;
    }
  } catch { /* no list of installs; look for a synced copy */ }
  const synced = path.join(plugins, 'synced');
  const copies = [];
  const list = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.includes('~'));
    } catch {
      return [];
    }
  };
  for (const catalogue of list(synced)) {
    for (const plugin of list(path.join(synced, catalogue.name))) {
      const dir = path.join(synced, catalogue.name, plugin.name);
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
        if (manifest.name === 'mattpocock-skills') copies.push({ dir, at: fs.statSync(dir).mtimeMs });
      } catch { /* not a plugin */ }
    }
  }
  if (copies.length === 0) throw new Error(`No copy of Matt Pocock's skills found in ${plugins}`);
  copies.sort((a, b) => b.at - a.at);
  return copies[0].dir;
}

// -------------------------------------------------------------- the scenarios

// A scenario's name in its record's file and its line: its number, and its leg when its pass has
// more than one, each leg run as a session of its own (27-route).
export const scenarioName = (scenario) => (scenario.leg ? `${scenario.id}-${scenario.leg}` : String(scenario.id));

export function resultFile({ home = os.homedir(), date, id, variant, trial }) {
  return path.join(home, '.wheelhouse-evals', date, `${id}-${variant}-${trial}.json`);
}

export function describeRun({ id, variant, pass, why, usage }) {
  return `${id} ${variant}: ${pass ? 'pass' : 'fail'} (${why}) ${usage.input} in / ${usage.output} out`;
}

// The command line of `npm run eval`: scenario ids (24, or one leg, 27-route), or one of --all
// (every suite), --suite <name> or --again (what the last run marked); --variant and --trials
// with ids, --all or --suite. `all`, `suite` and `again` are in the answer only when given.
export function parseArgs(argv) {
  const ids = [];
  let variants = VARIANTS;
  let trials = 1;
  let all = false;
  let suite = null;
  let again = false;
  let chose = false;
  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    let value;
    const equals = arg.indexOf('=');
    if (arg.startsWith('--') && equals > 0) {
      value = arg.slice(equals + 1);
      arg = arg.slice(0, equals);
    }
    if (arg === '--variant') {
      value ??= argv[++i];
      if (!VARIANTS.includes(value)) throw new Error(`--variant must be with or without, not ${value}`);
      variants = [value];
      chose = true;
    } else if (arg === '--trials') {
      value ??= argv[++i];
      trials = Number(value);
      if (!Number.isInteger(trials) || trials < 1) throw new Error(`--trials must be a whole number of at least 1, not ${value}`);
      chose = true;
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--suite') {
      value ??= argv[++i];
      if (typeof value !== 'string' || value === '' || value.startsWith('--')) throw new Error('--suite needs a suite\'s name, for example: --suite build-loop');
      suite = value;
    } else if (arg === '--again') {
      again = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}`);
    } else if (/^\d+$/.test(arg)) {
      ids.push(Number(arg));
    } else if (/^\d+-[a-z]+$/.test(arg)) {
      // One leg of a scenario whose pass has more than one: 27-route.
      ids.push(arg);
    } else {
      throw new Error(`Not a scenario number: ${arg}`);
    }
  }
  const ways = [ids.length > 0 && 'scenario numbers', all && '--all', suite !== null && '--suite', again && '--again'].filter(Boolean);
  if (ways.length > 1) throw new Error(`Give one of scenario numbers, --all, --suite or --again, not ${ways.join(' and ')}`);
  if (again && chose) throw new Error('--again chooses its own variants and trials: give it no --variant or --trials');
  if (!ways.length) throw new Error('Name at least one scenario number, or --all, --suite <name> or --again, for example: npm run eval -- 24 --variant with');
  return { ids, variants, trials, ...(all ? { all } : {}), ...(suite !== null ? { suite } : {}), ...(again ? { again } : {}) };
}

// The local date, as the evaluations folder names a day's folder.
export function today(now = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

async function commitSetup(dir) {
  const git = async (...args) => {
    const result = await run('git', args, { cwd: dir, input: '' });
    if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${result.stderr.trim()}`);
  };
  await git('add', '--all');
  await git('-c', 'user.name=Wheelhouse eval', '-c', 'user.email=eval@wheelhouse.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'Scenario set-up');
}

// Runs one trial of one scenario in one variant: makes the scratch project, runs
// the scenario's setup(dir, variant), commits it, runs the session, asks the
// scenario to judge it, writes the whole record to the evaluations folder in
// the home folder, and removes the scratch project.
// setup may return a context: `env` (added to the session's environment),
// `pluginDirs` (loaded after the variant's own), `appendSystemPrompt` (added to
// the session's system prompt), anything its pass reads (given
// to pass as `context`), `evidence()`, whose answer is kept in the record, and
// `close()`, called once the run is over, pass or fail. A scenario's own
// `extraArgs` go to the session's command line (runSession). Resolves with the verdict, its reasons,
// the record's file, whether the session was handled, its tokens and its one printed line.
export async function runScenario({ scenario, variant, trial = 1, home = os.homedir(), date = today(), runner = runSession }) {
  const project = await makeScratchProject({ name: `eval-${scenario.id}` });
  let context = {};
  try {
    context = (await scenario.setup(project.dir, variant)) ?? {};
    await commitSetup(project.dir);
    const session = await runner({
      dir: project.dir,
      prompt: scenario.prompt,
      pluginDirs: [...scenario.variants[variant].pluginDirs, ...(context.pluginDirs ?? [])],
      permissionMode: scenario.permissionMode ?? 'acceptEdits',
      model: scenario.model,
      maxTurns: scenario.maxTurns ?? 30,
      ...(context.env ? { env: context.env } : {}),
      ...(context.appendSystemPrompt ? { appendSystemPrompt: context.appendSystemPrompt } : {}),
      ...(scenario.extraArgs ? { extraArgs: scenario.extraArgs } : {}),
    });
    // A session that never took the prompt in hand passes nothing, whatever its pass says
    // (Review Focus 4); its pass is still asked, and kept in the record, but cannot make it a pass.
    // A pass that throws judges the run a fail; the record is written all the same.
    const handled = session.handled ?? handledOf({ events: session.events, exitCode: session.exitCode });
    let judged;
    try {
      judged = scenario.pass({ events: session.events, dir: project.dir, variant, context });
    } catch (error) {
      judged = { pass: false, why: `pass could not judge it: ${error instanceof Error ? error.message : String(error)}` };
    }
    // A session that did not finish never passes (Review Focus 4, ruling E24). When its pass saw a
    // failure, that failure stands and the trial counts as handled; when its pass saw nothing
    // wrong, the session only showed that nothing bad happened before it stopped, so the trial
    // counts as not handled (`did not finish`) and may be run again.
    const finished = finishedOf(session);
    const errored = session.events.findLast((event) => event.type === 'result')?.is_error === true;
    let shown = handled;
    let lead = handled ? judged.why : 'not handled';
    if (handled && !finished && judged.pass) {
      shown = false;
      lead = 'did not finish';
    }
    const pass = judged.pass === true && finished && shown;
    const total = totalUsageOf(session.events);
    const notes = [lead];
    if (errored) notes.push('the result event is an error');
    if (session.exitCode !== 0) notes.push(`claude exited ${session.exitCode}`);
    if (session.timedOut) notes.push('timed out');
    // A failure shown by a session that stopped short, with nothing above to say so.
    if (!finished && shown && notes.length === 1) notes.push('it did not finish');
    const why = notes.join('; ');
    const record = {
      id: scenario.id,
      ...(scenario.leg ? { leg: scenario.leg } : {}),
      title: scenario.title,
      variant,
      trial,
      date,
      pass,
      why,
      handled: shown,
      ...(shown ? {} : { judged: { pass: judged.pass, why: judged.why } }),
      exitCode: session.exitCode,
      usage: total,
      mainSessionUsage: usageOf(session.events),
      models: modelsUsed(session.events),
      subagents: subagents(session.events),
      finalText: finalText(session.events),
      ...(session.stderr ? { stderr: session.stderr } : {}),
      ...(typeof context.evidence === 'function' ? { evidence: context.evidence() } : {}),
      events: session.events,
    };
    const file = resultFile({ home, date, id: scenarioName(scenario), variant, trial });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
    return { pass, why, file, handled: shown, usage: total, line: describeRun({ id: scenarioName(scenario), variant, pass, why, usage: total }) };
  } finally {
    try {
      await context.close?.();
    } finally {
      await project.cleanup();
    }
  }
}
