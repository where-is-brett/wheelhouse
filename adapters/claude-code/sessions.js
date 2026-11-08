// adapters/claude-code/sessions.js
// How Claude Code sessions are started: the command line, the environment and the permissions each carries.
// The watcher's waker (scripts/watcher/waker.js) and the foreman's start (scripts/foreman/start.js) ask the
// project's adapter for these calls; this is the Claude Code adapter's answer. It imports no module that
// reaches the hook kit or the waker, so the waker and the registry can both load it without a cycle.
import { DEFAULT_SESSION_MODE, SESSION_MODES, isModelName } from '../../scripts/gate/guardrails.js';
import { FOREGROUND_ONLY, invocation, isClaudeSignIn, resolveClaude, withoutHostVariables } from '../../scripts/lib/claude.js';
import { PLUGIN_ROOT, foremanTools } from '../../scripts/foreman/tools.js';
import { EFFORTS } from '../../scripts/routing/thoroughness.js';

// The variable that tells a hook the session is the foreman's.
export const ROLE_VARIABLE = 'WHEELHOUSE_ROLE';
// The pass a foreman command holds for its run (scripts/host/helper.js): never given to a session it starts.
export const FOREMAN_PASS_VARIABLE = 'WHEELHOUSE_FOREMAN_RUN';

// The explicit permission mode sessions start in: the configuration's, or
// `acceptEdits`. Bypass mode, and any mode not known, are refused.
export function sessionModeOf(config) {
  const mode = config?.sessionMode ?? DEFAULT_SESSION_MODE;
  if (mode === 'bypassPermissions') throw new Error('Wheelhouse never starts a session in bypass mode');
  if (!SESSION_MODES.includes(mode)) throw new Error(`This isn't a permission mode Wheelhouse starts sessions in: ${JSON.stringify(mode)}`);
  return mode;
}

// A feature session's mode: as sessionModeOf, and never `auto`, on any system.
export function featureModeOf(config) {
  const mode = sessionModeOf(config);
  if (mode === 'auto') throw new Error('A feature session is never started in auto mode');
  return mode;
}

// Claude Code's alias for the command line's own default model.
export const DEFAULT_MODEL = 'default';

// The role's model from the routing table, or null for the command line's own default.
function modelOf(config, role) {
  const model = config?.routing?.[role] ?? null;
  if (model !== null && !isModelName(model)) throw new Error(`The ${role}'s model can't be passed to claude`);
  return model;
}

// The model a call was given from the column in force (scripts/routing/in-force.js), or null when none was given,
// so the flat table's applies, as before. One that can't be passed is refused.
function givenModel(model, role) {
  if (model === undefined || model === null) return null;
  if (!isModelName(model)) throw new Error(`The ${role}'s model can't be passed to claude`);
  return model;
}

// The thinking effort and fallback model a call was given, as flags: `--effort` (one of EFFORTS) and
// `--fallback-model` (a model name), each left out when not given. Anything else is refused. The effort goes on
// the command line only, never in CLAUDE_CODE_EFFORT_LEVEL, which would override each subagent's own.
function effortArgs({ effort, fallback }) {
  const e = effort ?? null;
  const f = fallback ?? null;
  if (e !== null && !EFFORTS.includes(e)) throw new Error(`This isn't a thinking effort Wheelhouse passes to claude: ${JSON.stringify(e)}`);
  if (f !== null && !isModelName(f)) throw new Error("The fallback model can't be passed to claude");
  return [...(e === null ? [] : ['--effort', e]), ...(f === null ? [] : ['--fallback-model', f])];
}

// The environment a started session gets: the host session's variables and
// every spelling of WHEELHOUSE_ROLE taken out, but for Claude Code's sign-in
// variables (scripts/lib/claude.js), spelt exactly, so a session signs in as the
// one that started the watcher or the foreman did: CLAUDE_CODE_USE_BEDROCK,
// CLAUDE_CODE_OAUTH_TOKEN and the like start "CLAUDE", as the host session's do.
export function sessionEnv(env) {
  const kept = Object.entries(env).filter(([name]) => isClaudeSignIn(name));
  const rest = Object.entries(withoutHostVariables(env)).filter(([name]) => name.toUpperCase() !== ROLE_VARIABLE && name.toUpperCase() !== FOREMAN_PASS_VARIABLE);
  return Object.fromEntries([...rest, ...kept]);
}

// The foreman's session. Two kinds:
//   - a fresh foreman for one wake (the default), run as `claude -p <prompt>`, with `tools` passed to
//     --allowedTools when there are any;
//   - the foreman's long session (`long: true`), with the prompt first and no -p, its own `settings` file,
//     and --allowedTools always given (by default the foreman's own tools for `pluginRoot`).
// `model`, `effort` and `fallback` are the foreman's from the column in force, when given (effortArgs).
// With a `sessionId` (a fresh wake's), `--session-id <id>` goes before -p, so the run's transcript is found by that id.
// Its environment is sessionEnv's, with the role and FOREGROUND_ONLY, as a feature session's is.
// Returns { file, args, env, input, verbatim }.
export function foremanCall({
  config, pluginRoot = PLUGIN_ROOT, prompt, platform = process.platform, env = process.env, claude = null, tools = null, settings = null, long = false,
  model: chosen = null, effort = null, fallback = null, sessionId = null,
}) {
  // The foreman works in the project's main folder, whose local settings start the front desk on its
  // own model (design section 8), so it always names one: the column's, its role's, or the command line's default.
  const model = givenModel(chosen, 'foreman') ?? modelOf(config, 'foreman') ?? DEFAULT_MODEL;
  const given = tools ?? (long ? foremanTools(pluginRoot, { platform }) : []);
  const args = [
    ...(settings === null ? [] : ['--settings', settings]),
    '--permission-mode', sessionModeOf(config),
    ...(model ? ['--model', model] : []),
    ...effortArgs({ effort, fallback }),
    ...(long || given.length > 0 ? ['--allowedTools', ...given] : []),
  ];
  // In the long session the prompt goes first: --allowedTools takes every word after it.
  const resolved = claude ?? resolveClaude(long ? { platform, env } : { env });
  const call = long ? invocation(resolved, [prompt], args) : invocation(resolved, sessionId === null ? [] : ['--session-id', sessionId], args, prompt);
  return { ...call, env: { ...sessionEnv(env), [ROLE_VARIABLE]: 'foreman', ...FOREGROUND_ONLY } };
}

// Whether a foreman session can be started under `config`: throws, in plain words, when its mode is bypass or
// not one Wheelhouse starts sessions in. The waker asks before it wakes the foreman; the answer is ignored.
export function checkForeman(config) {
  sessionModeOf(config);
}

// Whether a feature session can be started under `config`: throws, in plain words, when its mode or its
// builder's model can't be passed. The waker asks before it does anything for the session (labelling its
// worktree, recording grants), so a refusal leaves nothing behind.
export function checkFeature(config) {
  modelOf(config, 'feature');
  modelOf(config, 'builder');
  featureModeOf(config);
}

// A feature session: `lead` is the words that name which session it is. `allowed` are the allow rules
// to pass to --allowedTools, when there are any. `model`, `effort` and `fallback` are the feature role's from the
// column in force, when given (effortArgs).
function featureCall({
  lead, config, prompt, tail = [], allowed = [], platform = process.platform, env = process.env, claude = null, model: chosen = null, effort = null, fallback = null,
}) {
  // A worktree reads the main checkout's local settings too, so, as the foreman, it names its model: the column's,
  // or the flat table's `feature` role, else its `builder` role (as before), else the command line's default.
  const model = givenModel(chosen, 'feature') ?? modelOf(config, 'feature') ?? modelOf(config, 'builder') ?? DEFAULT_MODEL;
  const args = [
    ...lead,
    '--permission-mode', featureModeOf(config),
    ...(model ? ['--model', model] : []),
    ...effortArgs({ effort, fallback }),
    ...(allowed.length > 0 ? ['--allowedTools', ...allowed] : []),
    ...tail,
  ];
  const call = invocation(claude ?? resolveClaude({ platform, env }), [], args, prompt);
  return { ...call, env: { ...sessionEnv(env), ...FOREGROUND_ONLY } };
}

// A new feature session, which takes `sessionId` as its own. Returns { file, args, env, input, verbatim }.
export function featureStartCall({ sessionId, ...rest }) {
  return featureCall({ ...rest, lead: ['--session-id', sessionId] });
}

// The feature session with id `sessionId`, resumed. The mode and model are given again: `--resume` needs them.
export function featureResumeCall({ sessionId, ...rest }) {
  return featureCall({ ...rest, lead: ['--resume', sessionId] });
}

// The feature session with id `sessionId`, opened for the director to work in (the helm): its own mode, model, effort and
// allow rules, with no `-p` and nothing piped in, so it opens interactive. `start: false` resumes the session;
// `start: true` starts it under that id, with `prompt` as the last, positional argument (after `--`, since
// --allowedTools takes every word after it). The environment is a feature run's.
export function featureHelmCall({ sessionId, prompt = null, start = false, ...rest }) {
  const lead = [start ? '--session-id' : '--resume', sessionId];
  const tail = start && typeof prompt === 'string' && prompt !== '' ? ['--', prompt] : [];
  return featureCall({ ...rest, lead, tail, prompt: undefined });
}

// The tools a "why" session may use: it reads and searches, and nothing else.
export const WHY_TOOLS = 'Read,Grep,Glob';
// The connector configuration a why session is given: none.
const WHY_NO_MCP = '{"mcpServers":{}}';
const WHY_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// A "why" session (design section 6.3): a read-only fork of the session `sessionId`, run in the same `worktree`, asked `question`.
// It is always `--resume <id> --fork-session`, so the session it copies carries on undisturbed and is never resumed directly;
// a follow-up passes the copy's own id. Five guards keep it read-only: the fork, `--permission-mode plan`, `--tools` and
// `--allowedTools` of reading tools alone (with no connector), and the `why` role that the hooks enforce for every tool. Returns { command, file, args, cwd, env, input, verbatim }.
export function whyCall({
  sessionId, worktree, question, config = null, platform = process.platform, env = process.env, claude = null, model: chosen = null,
}) {
  if (typeof sessionId !== 'string' || !WHY_SESSION_ID.test(sessionId)) throw new Error('A why session copies a session named by a plain id');
  if (typeof worktree !== 'string' || worktree === '') throw new Error('A why session needs the folder of the session it copies');
  const model = givenModel(chosen, 'feature') ?? modelOf(config, 'feature') ?? modelOf(config, 'builder') ?? DEFAULT_MODEL;
  const args = [
    '--output-format', 'json',
    '--permission-mode', 'plan',
    ...(model ? ['--model', model] : []),
    // Only these tools exist in the session at all, and no connector server is started: --tools takes the others away
    // (a task, an agent, the web, a skill, the schedule), and an empty strict MCP configuration takes the connectors.
    '--tools', WHY_TOOLS,
    '--allowedTools', WHY_TOOLS,
    '--strict-mcp-config', '--mcp-config', WHY_NO_MCP,
    '--disable-slash-commands',
  ];
  const call = invocation(claude ?? resolveClaude({ platform, env }), ['--resume', sessionId, '--fork-session'], args, question);
  return { ...call, command: call.file, cwd: worktree, env: { ...sessionEnv(env), [ROLE_VARIABLE]: 'why', ...FOREGROUND_ONLY } };
}

// The text of the last `result` event in a stream-json run, or null.
export function finalAnswer(stdout) {
  let last = null;
  for (const line of String(stdout ?? '').split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    try {
      const event = JSON.parse(text);
      if (event?.type === 'result' && typeof event.result === 'string') last = event.result;
    } catch {
      // Not an event line.
    }
  }
  return last;
}

// The waker puts the Thoroughness column for a feature's subagents into its prompt only for an adapter that says it
// takes it (scripts/watcher/waker.js): Claude Code's sessions pass each subagent its model and effort.
export const takesColumn = true;

export default Object.freeze({ checkForeman, checkFeature, foremanCall, featureStartCall, featureResumeCall, featureHelmCall, whyCall, finalAnswer, takesColumn });
