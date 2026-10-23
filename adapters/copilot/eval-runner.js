// adapters/copilot/eval-runner.js
// The Copilot adapter's evaluation runner (Part 8 Task 3; rulings P8-25 to P8-27): one evaluation session through
// `copilot -p`, from a clean home of its own, with what it did turned into the stream-json events the evaluation's
// scenarios read (scripts/eval/harness.js), so a scenario judges a Copilot run as it judges a Claude Code one. The
// version check's safety subset (sessions.js safetySubset, ruling P8-20) runs its sessions through `npm run eval`'s own
// command, and so through this runner.
//
// Who runs it. The director, by hand, through `npm run eval -- --agent copilot` (scripts/eval/run.js, which reaches it
// through the registry's adapterFor and never names the agent), and the version check (sessions.js), which starts
// that same command as a program of its own, only once the background sessions are switched on (ruling P8-1). No
// watcher, foreman or setup path imports it.
//
// The session (ruling P8-25):
// - It takes runSession's arguments. `pluginDirs`, `permissionMode`, `settingSources`, `maxTurns`, `extraArgs`,
//   `offered`, `appendSystemPrompt` and the sandbox's `socket`, `readable`, `writable` and `unreadable` are Claude
//   Code's and have no Copilot form, so they are ignored. `model` becomes `--model`, `resume` `--resume=<id>`.
// - Its home is a session home (sessions.js writeSessionHome) in the run's scratch Wheelhouse home, the set-up's
//   WHEELHOUSE_HOME, never the real ~/.wheelhouse: Wheelhouse's hook registration, the kit's agents, and the sign-in
//   keys alone. A set-up that wrote the home itself (one whose guard is changed, 38) names it as COPILOT_HOME.
// - Its environment is copilotSessionEnv's: the few variables a session keeps, and COPILOT_HOME.
// - Its rules are Ask's (permissions.js levelRules, made for the scratch project), with `--no-ask-user`, the
//   temporary folder shut off, and never `--trust-folder` or an allow-everything flag. A scenario may name the
//   commands its session may run (`commands`), each passed as one `shell(<command>:*)` rule.
//
// What it answers is runSession's outcome: `{ events, exitCode, handled, usage, totalUsage, timedOut?, stderr? }`, the
// events translated (translateEvents), and `raw`, Copilot's own events, which the record keeps beside them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handledOf, totalUsageOf, usageOf } from '../../scripts/eval/harness.js';
import { EVAL_PROJECT } from '../../scripts/eval/standard-project.js';
import { isModelName } from '../../scripts/gate/guardrails.js';
import { quoteForCmd, resolveCommand } from '../../scripts/lib/claude.js';
import { run as realRun } from '../../scripts/lib/run.js';
import { assertUnderTmp } from '../../probes/lib/scratch.js';
import { copilotHome, file as hookFile } from './hooks.js';
import { levelRules } from './permissions.js';
import { CMD_LINE_MOST, WIDE_FLAGS, copilotSessionEnv, sessionUsage, writeSessionHome } from './sessions.js';
import { toGuardInput } from './translate.js';

// The session home's target: a feature's, so it sits where a builder's would (sessions.js sessionHome).
export const EVAL_TARGET = 'feature-eval';

// The variable naming the Copilot home an evaluation's sessions take their sign-in from, when it isn't the person's
// own: a folder signed in on its own (`COPILOT_HOME=<folder> copilot login`). Tests always set it to a scratch one.
export const SIGN_IN_VARIABLE = 'WHEELHOUSE_EVAL_COPILOT_SIGN_IN';

// The longest one evaluation session may run, as runSession's.
const SESSION_MS = 20 * 60 * 1000;

const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// What a command a scenario names may not hold: anything that could widen or end its `shell(..:*)` rule.
const RULE_BREAKERS = /[*,()\u0000-\u001f\u007f]/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const realOr = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const same = (a, b) => realOr(a) === realOr(b);
const inside = (folder, p) => {
  const relative = path.relative(realOr(folder), realOr(p));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// What `fn` gives with WHEELHOUSE_HOME naming `home` for that moment, so whatever it writes or names lands in the
// run's scratch home. `fn` must not wait on anything.
function inHome(home, fn) {
  const was = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return fn();
  } finally {
    if (was === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = was;
  }
}

// The Copilot home an evaluation's sessions sign in from: SIGN_IN_VARIABLE's folder when it is set, which must not be
// the person's own Copilot home under another spelling, else the person's own. Only its sign-in keys are ever read
// (sessions.js signInOf), and nothing is written there.
export function signInSource({ env = process.env } = {}) {
  const given = env?.[SIGN_IN_VARIABLE];
  if (typeof given !== 'string' || given === '') return copilotHome();
  if (!path.isAbsolute(given)) throw new Error(`${SIGN_IN_VARIABLE} must be a whole path to a Copilot home`);
  if (same(given, copilotHome()) || same(given, path.join(os.homedir(), '.copilot'))) {
    throw new Error(`${SIGN_IN_VARIABLE} names your own Copilot home; leave it unset for that, or name a folder signed in on its own`);
  }
  return given;
}

// The run's scratch Wheelhouse home: the set-up's WHEELHOUSE_HOME, in the temporary folder and never the real home.
function scratchHome(env) {
  const home = env?.WHEELHOUSE_HOME;
  if (typeof home !== 'string' || home === '') {
    throw new Error('A Copilot evaluation session runs from its set-up\'s scratch Wheelhouse home, and this set-up names none (WHEELHOUSE_HOME)');
  }
  assertUnderTmp(home);
  if (same(home, path.join(os.homedir(), '.wheelhouse'))) throw new Error('A Copilot evaluation session never runs from the real Wheelhouse home');
  return realOr(home);
}

// Writes the evaluation's session home in the scratch Wheelhouse home `home`, and answers its path.
export function writeEvalHome(home, { signedInFrom = signInSource(), node = process.execPath, platform = process.platform } = {}) {
  assertUnderTmp(home);
  return inHome(home, () => writeSessionHome({ project: EVAL_PROJECT, target: EVAL_TARGET, signedInFrom, node, platform }));
}

// The session home a run uses: the one its set-up wrote (COPILOT_HOME), which must lie in the scratch home and hold
// Wheelhouse's hook file, else one written afresh now. Copilot's own state survives a rewrite, so a resumed turn
// finds its session.
function homeFor(home, env, signedInFrom, platform) {
  const given = env?.COPILOT_HOME;
  if (typeof given === 'string' && given !== '') {
    if (!inside(home, given)) throw new Error('A Copilot evaluation session\'s home must lie in its scratch Wheelhouse home');
    if (!fs.lstatSync(hookFile({ home: given }), { throwIfNoEntry: false })?.isFile()) {
      throw new Error('This Copilot evaluation session\'s home has no Wheelhouse hook file, so its guards wouldn\'t run: no session is started');
    }
    return given;
  }
  return writeEvalHome(home, { signedInFrom: signedInFrom ?? signInSource(), platform });
}

// The rules: Ask's for the scratch project, and one shell rule for each command the scenario names.
function rulesFor(home, dir, commands, platform) {
  if (!Array.isArray(commands) || !commands.every((c) => typeof c === 'string' && c.trim() !== '' && c.length <= 400 && !RULE_BREAKERS.test(c))) {
    throw new Error('A scenario\'s commands are each a plain command line, with no *, comma, bracket or control character');
  }
  const { allow, deny } = inHome(home, () => levelRules({ level: 'ask', worktree: realOr(dir), domains: [], platform }));
  return { allow: [...allow, ...commands.map((c) => `shell(${c}:*)`)], deny };
}

// The program and its arguments: `copilot` as resolveCommand finds it (through cmd.exe for a .cmd shim, every
// argument checked by quoteForCmd), or the `command` a test gives, with `commandArgs` first.
function callOf({ command, commandArgs, args, env, platform }) {
  if (command !== 'copilot') return { file: command, args: [...commandArgs, ...args], verbatim: false };
  const resolved = resolveCommand({ name: 'copilot', platform, env });
  if (resolved.kind !== 'cmd') return { file: resolved.file, args, verbatim: false };
  let line;
  try {
    line = [resolved.file, ...args].map(quoteForCmd).join(' ');
  } catch {
    throw new Error('This Copilot evaluation session can\'t be started through a .cmd program safely: an argument holds ", %, ! or a closing backslash');
  }
  const call = { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
  if (['cmd.exe', ...call.args].join(' ').length > CMD_LINE_MOST) throw new Error(`This Copilot evaluation session's command line is longer than the ${CMD_LINE_MOST} characters a .cmd program can be given`);
  return call;
}

// Copilot's events, one JSON object per line; a line that isn't one is kept as { type: 'unparsed', line }, as the
// harness keeps Claude Code's, so a stray message shows.
export function rawEvents(stdout) {
  const events = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const event = JSON.parse(line);
      events.push(isObject(event) ? event : { type: 'unparsed', line });
    } catch {
      events.push({ type: 'unparsed', line });
    }
  }
  return events;
}

// The raw events as Copilot printed them, one line each, for the readers in sessions.js (activitySummary, refusalsOf).
export const rawText = (raw) => (Array.isArray(raw) ? raw.filter((e) => e?.type !== 'unparsed').map((e) => JSON.stringify(e)).join('\n') : '');

// A tool call's name and input as the scenarios read them: the guards' translation (translate.js), so `bash` is
// `Bash` with its `command`, `view` is `Read` with its `file_path`, an MCP tool is `mcp__<server>__<tool>`, and an
// apply_patch is one `Edit` naming every path it changes. A tool the translation doesn't know keeps its own name, and
// arguments that aren't an object are kept under `arguments`.
function toolUseOf(name, args, dir) {
  const translated = typeof name === 'string' && name !== '' ? toGuardInput({ cwd: dir, toolName: name, toolArgs: args ?? {} }, 'preToolUse') : null;
  const list = Array.isArray(translated) ? translated : [translated];
  const first = list[0];
  if (isObject(first) && typeof first.tool_name === 'string' && isObject(first.tool_input)) {
    const input = list.length > 1 ? { ...first.tool_input, file_paths: list.map((t) => t.tool_input.file_path) } : first.tool_input;
    return { name: first.tool_name, input };
  }
  return { name: typeof name === 'string' && name !== '' ? name : 'unknown', input: isObject(args) ? args : args === undefined || args === null ? {} : { arguments: args } };
}

const count = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

// Copilot's events (`raw`) as the stream-json events the harness reads (ruling P8-25, preflight section 5):
// - `system/init` first, with the session id the `result` event names;
// - an `assistant` text for each `assistant.message` with something in it;
// - an `assistant` `tool_use` for each `tool.execution_start`;
// - a `user` `tool_result` for each `tool.execution_complete`, `is_error` when it didn't succeed, its text the
//   result's content or the refusal's message;
// - `result` for Copilot's `result` event: `subtype: 'success'`, `is_error` when its exit code isn't 0, `result` the
//   last answer, and `usage` the token counts `usage` (sessionUsage's) gives, 0 for a count no source gave.
// A message or call a sub-agent made carries `parent_tool_use_id`. Every other kind of event is left out here; `raw`
// keeps it.
export function translateEvents(raw, { usage = null, dir = '/' } = {}) {
  const events = Array.isArray(raw) ? raw.filter(isObject) : [];
  const out = [];
  const result = events.findLast((e) => e.type === 'result');
  const sessionId = typeof result?.sessionId === 'string' && result.sessionId !== '' ? result.sessionId : null;
  if (sessionId !== null) out.push({ type: 'system', subtype: 'init', session_id: sessionId });
  let answer = '';
  for (const event of events) {
    const data = isObject(event.data) ? event.data : {};
    const parent = typeof data.parentToolCallId === 'string' && data.parentToolCallId !== '' ? data.parentToolCallId : null;
    if (event.type === 'assistant.message' && typeof data.content === 'string' && data.content.trim() !== '') {
      if (parent === null) answer = data.content;
      out.push({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'text', text: data.content }] } });
    } else if (event.type === 'tool.execution_start') {
      const { name, input } = toolUseOf(data.toolName, data.arguments, dir);
      out.push({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id: String(data.toolCallId ?? ''), name, input }] } });
    } else if (event.type === 'tool.execution_complete') {
      const failed = data.success !== true;
      const text = failed ? String(data.error?.message ?? '') : String(data.result?.content ?? '');
      out.push({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: String(data.toolCallId ?? ''), is_error: failed, content: text }] } });
    } else if (event.type === 'result') {
      const tokens = usage?.tokens ?? {};
      out.push({
        type: 'result',
        subtype: 'success',
        is_error: typeof event.exitCode === 'number' && event.exitCode !== 0,
        result: answer,
        ...(sessionId === null ? {} : { session_id: sessionId }),
        usage: {
          input_tokens: count(tokens.input),
          output_tokens: count(tokens.output),
          cache_read_input_tokens: count(tokens.cache_read),
          cache_creation_input_tokens: count(tokens.cache_write),
        },
      });
    }
  }
  return out;
}

// One evaluation session through `copilot -p` in the scratch project `dir` (see the head of this file). `command` and
// `commandArgs` are for tests: a stand-in for copilot. `signedInFrom` is the Copilot home the sign-in keys come from
// (signInSource when not given). Resolves with runSession's outcome and `raw`.
export async function run({
  dir,
  prompt,
  model = null,
  resume = null,
  env = {},
  commands = [],
  timeoutMs = SESSION_MS,
  signedInFrom = null,
  command = 'copilot',
  commandArgs = [],
  platform = process.platform,
} = {}) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('A Copilot evaluation session needs its scratch project\'s whole path');
  assertUnderTmp(dir);
  if (typeof prompt !== 'string' || prompt === '') throw new Error('A Copilot evaluation session needs a prompt');
  if (prompt.startsWith('-')) throw new Error('A Copilot evaluation session\'s prompt can\'t start with a dash');
  if (model !== null && model !== undefined && !isModelName(model)) throw new Error(`This model can't be passed to copilot: ${JSON.stringify(model)}`);
  if (resume !== null && resume !== undefined && !PLAIN_ID.test(resume)) throw new Error(`This session id can't be resumed: ${JSON.stringify(resume)}`);
  const given = isObject(env) ? env : {};
  const home = scratchHome(given);
  const ownHome = homeFor(home, given, signedInFrom, platform);
  const rules = rulesFor(home, dir, commands, platform);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-copilot-eval-'));
  const logDir = path.join(scratch, 'logs');
  const usageFile = path.join(scratch, 'usage.json');
  try {
    const args = [
      ...(resume ? [`--resume=${resume}`] : []),
      '-p', prompt, '--output-format', 'json', '--no-auto-update', '--disable-builtin-mcps', '--no-ask-user', '--disallow-temp-dir',
      '--log-dir', logDir, '--usage-output-file', usageFile,
      ...(model ? ['--model', model] : []),
      ...rules.allow.map((rule) => `--allow-tool=${rule}`),
      ...rules.deny.map((rule) => `--deny-tool=${rule}`),
    ];
    const flags = args.filter((_, i) => args[i - 1] !== '-p');
    if (flags.some((arg) => WIDE_FLAGS.some((wide) => arg === wide || arg.startsWith(`${wide}=`)))) {
      throw new Error('A Copilot evaluation session is never started trusted or with every permission given');
    }
    const environment = copilotSessionEnv({ ...process.env, ...given }, { home: ownHome, platform });
    const call = callOf({ command, commandArgs, args, env: environment, platform });
    const result = await realRun(call.file, call.args, { cwd: dir, env: environment, baseEnv: {}, input: '', timeoutMs, windowsVerbatimArguments: call.verbatim });
    const raw = rawEvents(result.stdout);
    const usage = sessionUsage({ usageFile, stdout: rawText(raw) });
    const events = translateEvents(raw, { usage, dir });
    const outcome = {
      events,
      raw,
      exitCode: result.code,
      handled: handledOf({ events, exitCode: result.code }),
      usage: usageOf(events),
      totalUsage: totalUsageOf(events),
    };
    if (result.timedOut) outcome.timedOut = true;
    if (result.code !== 0 && events.length === 0) outcome.stderr = String(result.stderr ?? '').slice(-2000);
    return outcome;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export default Object.freeze({ run });
