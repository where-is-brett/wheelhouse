// scripts/eval/harness.js
// The evaluation harness: runs one headless Claude Code session in a throwaway
// project and reads what it did from the stream-json events it prints.
// Used by scripts/eval/run.js and by the scenarios under tests/eval/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invocation, quoteForCmd, resolveClaude } from '../lib/claude.js';
import { run } from '../lib/run.js';
import { projectSettings } from '../protection/settings.js';
import { fileURLToPath } from 'node:url';
import { makeScratchProject } from '../../probes/lib/scratch.js';

const VARIANTS = ['with', 'without'];

// Flags checked against `claude --help` before every session. --max-turns is
// left out on purpose: Claude Code 2.1.302 does not list it in --help, yet
// stops a session with `error_max_turns` when it is given (tried on that
// version), so its effect shows in the result event, not the help text.
const NEEDED_FLAGS = ['--print', '--output-format', '--verbose', '--permission-mode', '--plugin-dir', '--setting-sources', '--strict-mcp-config', '--disallowedTools', '--settings'];

// A session is kept away from the director's own (ruling F90). Started from inside a Claude Code
// session it would inherit that session's whole environment (its messaging socket, its ids, the
// account's), the account's connectors would load, and Claude Code 2.1.302 gives every `claude -p`
// session tools that list and message the other sessions on this computer, reach the account's
// routines, or belong to the Desktop app, and three built-in plugins. So:
// - its environment is built from an allowlist (SESSION_ENV: what the shell, the operating system
//   and signing in need), plus what the run sets, never the rest of this process's;
// - no MCP server is loaded but those a scenario names (--strict-mcp-config);
// - DENIED_TOOLS are denied;
// - its settings (--settings, SESSION_SETTINGS) turn the built-in plugins off, and deny reading or
//   editing the real ~/.wheelhouse and listing the computer's processes;
// - its commands run in Claude Code's sandbox (sessionSettings, ruling F94).
// Signing in needs none of the rest: a run with the allowlist alone signs in (tried on 2.1.302).
export const SESSION_ENV = /^(?:PATH|Path|HOME|USER|LOGNAME|SHELL|TMPDIR|TEMP|TMP|LANG|LC_[A-Z]+|TERM|TZ|USERPROFILE|USERNAME|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|SystemRoot|SYSTEMROOT|SystemDrive|windir|WINDIR|ComSpec|COMSPEC|PATHEXT|ProgramFiles|ProgramFiles\(x86\)|ProgramData|ProgramW6432|CommonProgramFiles|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|CLAUDE_CONFIG_DIR|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/;
export const DENIED_TOOLS = [
  'ListAgents', 'SendMessage', 'RemoteTrigger', 'CronCreate', 'CronDelete', 'CronList',
  'Artifact', 'ArtifactComments', 'ArtifactData', 'DesignSync', 'PushNotification', 'ReportFindings', 'Workflow', 'ScheduleWakeup',
];
export const SESSION_SETTINGS = {
  enabledPlugins: { 'cc-plugin-agents-md@builtin': false, 'cc-plugin-telemetry@builtin': false, 'cc-plugin-plugin-authoring@builtin': false },
  permissions: { deny: ['Read(~/.wheelhouse/**)', 'Edit(~/.wheelhouse/**)', 'Bash(ps:*)', 'Bash(ps *)'] },
};

// This process's environment as a session gets it: the allowlist only.
export const sessionEnv = (from = process.env) => Object.fromEntries(Object.entries(from).filter(([name]) => SESSION_ENV.test(name)));

// This repository: its tests, the judges and the expected results among them, are no session's to read.
const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// What the sandbox keeps a session from reading beyond a project's own list (rulings F94, F102):
// the director's conversations with Claude Code (their transcripts, the prompts they typed, the
// files' history, sessions, environments and shell snapshots), their account file, the Desktop
// app's own folder, other evaluation runs' records, the folder their projects live in (setup's
// ~/Projects), and this repository wherever it is. The installed plugins (~/.claude/plugins) stay
// readable: Superpowers' scripts run from there. A run's set-up names what it must read in these
// (`readable`), such as the repository's scripts a feature brief's commands run.
export const EVAL_DENY_READ = [
  '~/.claude/projects', '~/.claude/history.jsonl', '~/.claude/file-history', '~/.claude/sessions', '~/.claude/session-env',
  '~/.claude/shell-snapshots', '~/.claude.json', '~/Library/Application Support/Claude', '~/.wheelhouse-evals', '~/Projects', REPOSITORY,
];

// The commands a session may not run (ruling F102): the keychain's, by name and by its path, in
// both forms Claude Code matches. A sandboxed command runs without asking, and the sandbox lets it
// reach the keychain, where Claude Code keeps the director's sign-in.
export const EVAL_DENY_COMMANDS = ['security', '/usr/bin/security'].flatMap((c) => [`Bash(${c}:*)`, `Bash(${c} *)`]);

// The only extra arguments a session takes (ruling F100): what gives a `claude -p` session
// AskUserQuestion. Anything else could override or widen the isolation, so it is refused.
export const TAKEN_EXTRA_ARGS = Object.freeze(['--permission-prompt-tool', 'stdio']);

// The denied tools a scenario may be offered (ruling F99), each only with the PreToolUse hook in the
// project's local settings that turns the call away (turnAwayEntry), so the call shows in the events
// and nothing reaches the director's phone.
export const OFFERABLE_TOOLS = Object.freeze(['PushNotification']);

// What the hook that turns an offered tool's call away answers it with, by tool.
export const TURNED_AWAY = Object.freeze({ PushNotification: 'Sent to the director\'s phone.' });

// The phone's other known answer: the words the notification tool answers with when it isn't sent
// because the director has just been active (check 41), for the scenarios that run that branch.
export const NOT_SENT = 'Not sent \u2014 this terminal is active, so your output here already reaches the user; a separate notification would be redundant.';

// Every answer a known hook may give, by tool.
const KNOWN_ANSWERS = Object.freeze({ PushNotification: Object.freeze([TURNED_AWAY.PushNotification, NOT_SENT]) });

// The script of a PreToolUse hook that turns every call it is given away with `reason`. It fails
// closed (ruling F107): once its input ends it answers deny, and any failure of its own (its input
// can't be read, a throw) exits with code 2, which refuses the call too.
export function turnAwayScript(reason) {
  const said = JSON.stringify(reason);
  return `// A stand-in for the director in an evaluation run: every call this hook is given is turned away.
const refuse = () => { process.stderr.write(${said}); process.exit(2); };
process.on('uncaughtException', refuse);
process.stdin.on('error', refuse);
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: ${said} } }));
});
`;
}

// The local settings' PreToolUse entry that runs the hook script at `file` for `matcher`. With
// `onFailure: block`, a hook that can't run at all (no Node, a timeout) refuses the call as well,
// as Wheelhouse's guards do (hooks/hooks.json).
export function turnAwayEntry(matcher, file) {
  return { matcher, hooks: [{ type: 'command', command: `node "${file}"`, timeout: 10, onFailure: 'block' }] };
}

// A socket's spellings: as given, and through the real path of its folder (the temporary folder
// has two on macOS), so the sandbox knows it whichever way a command names it.
function socketSpellings(socket) {
  try {
    return [...new Set([socket, path.join(fs.realpathSync(path.dirname(socket)), path.basename(socket))])];
  } catch {
    return [socket];
  }
}

// Whether `file` is in the real Wheelhouse home, by either spelling.
function inRealHome(file) {
  const home = path.join(os.homedir(), '.wheelhouse');
  return socketSpellings(file).some((spelt) => {
    const relative = path.relative(home, spelt);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

// A session's settings (ruling F94): SESSION_SETTINGS with EVAL_DENY_COMMANDS, and the sandbox a project's own settings
// give its sessions (projectSettings: on, no command outside it, no reading the real
// ~/.wheelhouse or any credential, the npm registry only), with EVAL_DENY_READ added. Per run:
// `socket`, the run's stand-in helper's socket, the one Unix socket a command may reach (none
// without it; never one in the real Wheelhouse home); `readable`, paths read again inside what is
// denied; `writable`, paths written outside the project. The sandbox doesn't run on native
// Windows, where Claude Code runs commands outside it and these settings change nothing.
export function sessionSettings({ socket = null, readable = [], writable = [] } = {}) {
  if (socket !== null && (typeof socket !== 'string' || socket === '')) throw new Error('A session\'s socket is a path');
  if (socket !== null && inRealHome(socket)) throw new Error(`A session never reaches a socket in the real Wheelhouse home: ${socket}`);
  const { sandbox } = projectSettings({ webDomains: [] });
  const own = structuredClone(SESSION_SETTINGS);
  return {
    ...own,
    permissions: { ...own.permissions, deny: [...own.permissions.deny, ...EVAL_DENY_COMMANDS] },
    sandbox: {
      ...sandbox,
      filesystem: {
        ...sandbox.filesystem,
        denyRead: [...new Set([...sandbox.filesystem.denyRead, ...EVAL_DENY_READ])],
        ...(readable.length > 0 ? { allowRead: [...readable] } : {}),
        ...(writable.length > 0 ? { allowWrite: [...writable] } : {}),
      },
      network: { ...sandbox.network, allowUnixSockets: socket === null ? [] : socketSpellings(socket) },
    },
  };
}

// The extra arguments, when they are TAKEN_EXTRA_ARGS or none; anything else is refused.
function vettedExtraArgs(extraArgs) {
  if (Array.isArray(extraArgs) && extraArgs.length === 0) return [];
  if (Array.isArray(extraArgs) && extraArgs.length === TAKEN_EXTRA_ARGS.length && extraArgs.every((arg, i) => arg === TAKEN_EXTRA_ARGS[i])) return [...extraArgs];
  throw new Error(`An evaluation session takes no extra arguments but ${TAKEN_EXTRA_ARGS.join(' ')}, not ${JSON.stringify(extraArgs)}`);
}

// Whether `hook` is the known hook that turns `tool` away, failing closed: it blocks on failure, and
// its command runs, with nothing else, a script that is turnAwayScript's for one of that tool's
// known answers (KNOWN_ANSWERS) word for word.
function knownHook(hook, tool) {
  if (hook?.type !== 'command' || hook.onFailure !== 'block' || typeof hook.command !== 'string') return false;
  const file = /^node "([^"]+)"$/.exec(hook.command)?.[1];
  try {
    const text = file === undefined ? null : fs.readFileSync(file, 'utf8');
    return text !== null && (KNOWN_ANSWERS[tool] ?? []).some((said) => text === turnAwayScript(said));
  } catch {
    return false;
  }
}

// Whether the local settings of the project `dir` hold the known hook (knownHook) for `tool` on PreToolUse.
function turnedAway(dir, tool) {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'));
    const entries = Array.isArray(settings?.hooks?.PreToolUse) ? settings.hooks.PreToolUse : [];
    return entries.some((entry) => typeof entry?.matcher === 'string' && entry.matcher.split('|').includes(tool)
      && Array.isArray(entry.hooks) && entry.hooks.some((hook) => knownHook(hook, tool)));
  } catch {
    return false;
  }
}

// The tools a session is offered of DENIED_TOOLS: only OFFERABLE_TOOLS, each turned away in `dir`.
function vettedOffer(offered, dir) {
  if (!Array.isArray(offered)) throw new Error('The tools a session is offered are a list');
  for (const tool of offered) {
    if (!OFFERABLE_TOOLS.includes(tool)) throw new Error(`Of the denied tools, only ${OFFERABLE_TOOLS.join(', ')} can be offered, not ${JSON.stringify(tool)}`);
    if (!turnedAway(dir, tool)) throw new Error(`${tool} is offered only with a PreToolUse hook in the project's local settings that turns the call away: the known one (turnAwayEntry), which fails closed`);
  }
  return offered;
}

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

// The session's id, from its init event, or null.
export function sessionIdOf(events) {
  const init = events.find((event) => event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string');
  return init?.session_id ?? null;
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
  return run(call.file, call.args, { cwd, env, baseEnv: sessionEnv(), input: call.input, timeoutMs, windowsVerbatimArguments: call.verbatim });
}

// Runs `claude -p` in `dir` and parses what it prints. `command` and
// `commandArgs` are for tests (a stand-in for claude). `settingSources` defaults
// to project and local settings only, so the director's own plugins and hooks
// do not load beside the ones the scenario names with `pluginDirs`.
// `appendSystemPrompt`, when given, is added to the session's system prompt: one
// line with no double quotes, so it passes through claude.cmd on Windows too.
// `resume`, when given, is the id of the session this prompt continues (--resume).
// `extraArgs` go on the command line after the rest, as given: only TAKEN_EXTRA_ARGS, or none. They
// are not looked for in --help: `--permission-prompt-tool`, which a scenario that asks cards
// needs (it is what gives a `claude -p` session AskUserQuestion, on 2.1.302), is
// not listed there as a flag of its own. `socket`, `readable` and `writable` are the run's own
// for the sandbox (sessionSettings); `offered` lists denied tools the session is given (vettedOffer).
export async function runSession({
  dir,
  prompt,
  pluginDirs,
  permissionMode,
  model,
  maxTurns,
  env,
  appendSystemPrompt,
  resume,
  settingSources = 'project,local',
  extraArgs = [],
  socket = null,
  readable = [],
  writable = [],
  offered = [],
  timeoutMs = 20 * 60 * 1000,
  command = 'claude',
  commandArgs = [],
}) {
  const extra = vettedExtraArgs(extraArgs);
  const offer = vettedOffer(offered, dir);
  const settings = sessionSettings({ socket, readable, writable });
  // With the default command, find claude (on Windows, its .exe or .cmd); a command given is used as it is.
  const resolved = command === 'claude' ? resolveClaude({ env: { ...process.env, ...env } }) : { kind: 'direct', file: command };
  const flags = [...NEEDED_FLAGS, ...(model ? ['--model'] : []), ...(appendSystemPrompt ? ['--append-system-prompt'] : []), ...(resume ? ['--resume'] : [])];
  await checkFlags({ commandArgs, flags, env, resolved });
  // The session's settings, in a file of its own outside the project (a JSON argument would not
  // pass through claude.cmd on Windows), removed once the session is over.
  const settingsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-eval-settings-')), 'settings.json');
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  const args = [
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', permissionMode,
    '--max-turns', String(maxTurns),
    '--setting-sources', settingSources,
    '--strict-mcp-config',
    '--disallowedTools', DENIED_TOOLS.filter((tool) => !offer.includes(tool)).join(','),
    '--settings', settingsFile,
    ...pluginDirs.flatMap((pluginDir) => ['--plugin-dir', pluginDir]),
    ...(model ? ['--model', model] : []),
    ...(appendSystemPrompt ? ['--append-system-prompt', appendSystemPrompt] : []),
    ...(resume ? ['--resume', resume] : []),
    ...extra,
  ];
  let result;
  try {
    result = await start(resolved, { lead: commandArgs, args, prompt, cwd: dir, env, timeoutMs });
  } finally {
    fs.rmSync(path.dirname(settingsFile), { recursive: true, force: true });
  }
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
  return { ids: [...new Set(ids)], variants, trials, ...(all ? { all } : {}), ...(suite !== null ? { suite } : {}), ...(again ? { again } : {}) };
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

// Writes a trial's record and answers where, and under which trial. A record is never written over
// (ruling F105): when another run has saved this trial's record since, the next free trial number
// is taken.
function saveRecord({ home, date, scenario, variant, trial, record }) {
  let saved = trial;
  let file = resultFile({ home, date, id: scenarioName(scenario), variant, trial: saved });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify({ ...record, trial: saved }, null, 2) + '\n', { flag: 'wx' });
      return { file, trial: saved };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      saved += 1;
      file = resultFile({ home, date, id: scenarioName(scenario), variant, trial: saved });
    }
  }
}

// Runs one trial of one scenario in one variant: makes the scratch project, runs
// the scenario's setup(dir, variant), commits it, runs the session, asks the
// scenario to judge it, writes the whole record to the evaluations folder in
// the home folder, and removes the scratch project.
// A scenario with `prompts` (a list) in place of `prompt` is one session over several of the
// director's turns: each prompt after the first resumes the session (--resume), and
// `between({ turn, turns, context, dir, variant })`, when given, runs before each of them (turn is
// its index). Its pass gets `turns` ([{ prompt, events }]) beside `events`, every turn's in order;
// its tokens are every turn's together. A session whose id can't be read ends after that turn.
// setup may return a context: `env` (added to the session's environment),
// `pluginDirs` (loaded after the variant's own), `appendSystemPrompt` (added to
// the session's system prompt), anything its pass reads (given
// to pass as `context`), `evidence()`, whose answer is kept in the record, and
// `close()`, called once the run is over, pass or fail; its `helper.address` is the one socket the
// session's sandbox lets a command reach, and its `readable` and `writable` go to the sandbox too
// (runSession). A scenario's own `extraArgs` go to the session's command line, and its `offered`
// tools are taken off the denied list (runSession). Resolves with the verdict, its reasons,
// the record's file, the trial it was saved under, whether the session was handled, its tokens
// and its one printed line. `beforePrompt({ scenario, variant, dir, context, runner, home })`, when given,
// runs after the set-up and may answer { why, usage?, evidence? } to refuse the trial (see above).
export async function runScenario({ scenario, variant, trial = 1, home = os.homedir(), date = today(), runner = runSession, beforePrompt }) {
  const project = await makeScratchProject({ name: `eval-${scenario.id}` });
  let context = {};
  try {
    context = (await scenario.setup(project.dir, variant)) ?? {};
    await commitSetup(project.dir);
    // A check the runner makes after set-up and before the prompt (run.js, needsSandbox). When it
    // refuses, the session is never started: the trial is a failed one that was not handled, with
    // the check's reason and the tokens the check itself spent.
    const refusal = typeof beforePrompt === 'function'
      ? await beforePrompt({ scenario, variant, dir: project.dir, context, runner, home })
      : null;
    if (refusal) {
      const spent = refusal.usage ?? { input: 0, output: 0 };
      const why = refusal.why;
      const stopped = {
        id: scenario.id,
        ...(scenario.leg ? { leg: scenario.leg } : {}),
        title: scenario.title,
        variant,
        trial,
        date,
        pass: false,
        why,
        handled: false,
        exitCode: null,
        usage: spent,
        mainSessionUsage: spent,
        models: [],
        subagents: [],
        finalText: '',
        ...(typeof context.evidence === 'function' ? { evidence: context.evidence() } : {}),
        ...(refusal.evidence ? { check: refusal.evidence } : {}),
        events: [],
      };
      const kept = saveRecord({ home, date, scenario, variant, trial, record: stopped });
      return { pass: false, why, file: kept.file, trial: kept.trial, handled: false, usage: spent, line: describeRun({ id: scenarioName(scenario), variant, pass: false, why, usage: spent }) };
    }
    const prompts = Array.isArray(scenario.prompts) ? scenario.prompts : [scenario.prompt];
    const turns = [];
    let resume = null;
    for (const [turn, prompt] of prompts.entries()) {
      if (turn > 0) {
        if (resume === null) break;
        await scenario.between?.({ turn, turns, context, dir: project.dir, variant });
      }
      const ran = await runner({
        dir: project.dir,
        prompt,
        pluginDirs: [...scenario.variants[variant].pluginDirs, ...(context.pluginDirs ?? [])],
        permissionMode: scenario.permissionMode ?? 'acceptEdits',
        model: scenario.model,
        maxTurns: scenario.maxTurns ?? 30,
        ...(context.env ? { env: context.env } : {}),
        ...(context.appendSystemPrompt ? { appendSystemPrompt: context.appendSystemPrompt } : {}),
        ...(scenario.extraArgs ? { extraArgs: scenario.extraArgs } : {}),
        ...(scenario.offered ? { offered: scenario.offered } : {}),
        ...(typeof context.helper?.address === 'string' ? { socket: context.helper.address } : {}),
        ...(context.readable ? { readable: context.readable } : {}),
        ...(context.writable ? { writable: context.writable } : {}),
        ...(resume === null ? {} : { resume }),
      });
      turns.push({ prompt, ...ran });
      resume = sessionIdOf(ran.events);
    }
    const session = {
      events: turns.flatMap((t) => t.events),
      exitCode: turns.find((t) => t.exitCode !== 0)?.exitCode ?? 0,
      ...(turns.some((t) => t.timedOut) ? { timedOut: true } : {}),
      ...(turns.find((t) => t.stderr) ? { stderr: turns.find((t) => t.stderr).stderr } : {}),
    };
    const several = prompts.length > 1;
    // A session that never took the prompt in hand passes nothing, whatever its pass says
    // (Review Focus 4); its pass is still asked, and kept in the record, but cannot make it a pass.
    // Over several turns, every turn that ran must have taken its prompt in hand. A `/compact` turn
    // writes nothing and calls no tool by its nature: it took its prompt in hand when it compacted.
    // A pass that throws judges the run a fail; the record is written all the same.
    const compactedTurn = (t) => /^\/compact\b/.test(t.prompt) && t.events.some((e) => e.type === 'system' && e.subtype === 'compact_boundary');
    const sessionHandled = turns.every((t) => compactedTurn(t) || (t.handled ?? handledOf({ events: t.events, exitCode: t.exitCode })));
    let judged;
    try {
      judged = scenario.pass({ events: session.events, dir: project.dir, variant, context, ...(several ? { turns: turns.map((t) => ({ prompt: t.prompt, events: t.events })) } : {}) });
    } catch (error) {
      judged = { pass: false, why: `pass could not judge it: ${error instanceof Error ? error.message : String(error)}` };
    }
    // A session that did not finish never passes (Review Focus 4, ruling E24): every turn must
    // finish, and every prompt must have run. When its pass saw a failure, that failure stands and
    // the trial counts as handled; when its pass saw nothing wrong, the session only showed that
    // nothing bad happened before it stopped, so the trial counts as not handled (`did not finish`)
    // and may be run again.
    const finished = turns.length === prompts.length && turns.every((t) => finishedOf(t));
    // A session whose result event says it errored (it ran out of turns, say) never passes.
    const errored = turns.some((t) => t.events.findLast((event) => event.type === 'result')?.is_error === true);
    // A pass may find the run inconclusive (`handled: false`): it could not tell what stopped the
    // route it watched, so the trial is not handled and may be run again.
    const handled = sessionHandled && judged.handled !== false;
    let shown = handled;
    let lead = handled ? judged.why : (sessionHandled && judged.why ? `not handled: ${judged.why}` : 'not handled');
    if (handled && !finished && judged.pass) {
      shown = false;
      lead = 'did not finish';
    }
    const pass = judged.pass === true && finished && shown;
    const sum = (count) => turns.map((t) => count(t.events)).reduce((a, b) => ({ input: a.input + b.input, output: a.output + b.output }), { input: 0, output: 0 });
    const total = sum(totalUsageOf);
    const notes = [lead];
    if (errored) notes.push('the result event is an error');
    if (several && turns.length < prompts.length) notes.push(`only ${turns.length} of ${prompts.length} turns ran`);
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
      mainSessionUsage: sum(usageOf),
      models: [...new Set(turns.flatMap((t) => modelsUsed(t.events)))],
      subagents: subagents(session.events),
      finalText: finalText(turns.at(-1)?.events ?? []),
      ...(several ? { turns: turns.map((t) => ({ prompt: t.prompt, finalText: finalText(t.events), usage: totalUsageOf(t.events) })) } : {}),
      ...(session.stderr ? { stderr: session.stderr } : {}),
      ...(typeof context.evidence === 'function' ? { evidence: context.evidence() } : {}),
      events: session.events,
    };
    const { file, trial: saved } = saveRecord({ home, date, scenario, variant, trial, record });
    return { pass, why, file, trial: saved, handled: shown, usage: total, line: describeRun({ id: scenarioName(scenario), variant, pass, why, usage: total }) };
  } finally {
    try {
      await context.close?.();
    } finally {
      await project.cleanup();
    }
  }
}
