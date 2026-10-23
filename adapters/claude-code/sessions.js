// adapters/claude-code/sessions.js
// How Claude Code sessions are started: the command line, the environment and the permissions each carries.
// The watcher's waker (scripts/watcher/waker.js) and the foreman's start (scripts/foreman/start.js) ask the
// project's adapter for these calls; this is the Claude Code adapter's answer. It imports no module that
// reaches the hook kit or the waker, so the waker and the registry can both load it without a cycle.
import { DEFAULT_SESSION_MODE, SESSION_MODES, isModelName } from '../../scripts/gate/guardrails.js';
import { invocation, resolveClaude, withoutHostVariables } from '../../scripts/lib/claude.js';
import { PLUGIN_ROOT, foremanTools } from '../../scripts/foreman/tools.js';

// The variable that tells a hook the session is the foreman's.
export const ROLE_VARIABLE = 'WHEELHOUSE_ROLE';

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

// The role's model from the routing table, or null for the command line's own default.
function modelOf(config, role) {
  const model = config?.routing?.[role] ?? null;
  if (model !== null && !isModelName(model)) throw new Error(`The ${role}'s model can't be passed to claude`);
  return model;
}

// The environment a started session gets: the host session's variables and
// every spelling of WHEELHOUSE_ROLE taken out.
export function sessionEnv(env) {
  return Object.fromEntries(Object.entries(withoutHostVariables(env)).filter(([name]) => name.toUpperCase() !== ROLE_VARIABLE));
}

// The foreman's session. Two kinds:
//   - a fresh foreman for one wake (the default), run as `claude -p <prompt>`, with `tools` passed to
//     --allowedTools when there are any;
//   - the foreman's long session (`long: true`), with the prompt first and no -p, its own `settings` file,
//     and --allowedTools always given (by default the foreman's own tools for `pluginRoot`).
// Returns { file, args, env, input, verbatim }.
export function foremanCall({
  config, pluginRoot = PLUGIN_ROOT, prompt, platform = process.platform, env = process.env, claude = null, tools = null, settings = null, long = false,
}) {
  const model = modelOf(config, 'foreman');
  const given = tools ?? (long ? foremanTools(pluginRoot, { platform }) : []);
  const args = [
    ...(settings === null ? [] : ['--settings', settings]),
    '--permission-mode', sessionModeOf(config),
    ...(model ? ['--model', model] : []),
    ...(long || given.length > 0 ? ['--allowedTools', ...given] : []),
  ];
  // In the long session the prompt goes first: --allowedTools takes every word after it.
  const resolved = claude ?? resolveClaude(long ? { platform, env } : { env });
  const call = long ? invocation(resolved, [prompt], args) : invocation(resolved, [], args, prompt);
  return { ...call, env: { ...sessionEnv(env), [ROLE_VARIABLE]: 'foreman' } };
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
  modelOf(config, 'builder');
  featureModeOf(config);
}

// A feature session: `lead` is the words that name which session it is. `allowed` are the allow rules
// to pass to --allowedTools, when there are any.
function featureCall({ lead, config, prompt, allowed = [], platform = process.platform, env = process.env, claude = null }) {
  const model = modelOf(config, 'builder');
  const args = [
    ...lead,
    '--permission-mode', featureModeOf(config),
    ...(model ? ['--model', model] : []),
    ...(allowed.length > 0 ? ['--allowedTools', ...allowed] : []),
  ];
  const call = invocation(claude ?? resolveClaude({ platform, env }), [], args, prompt);
  return { ...call, env: sessionEnv(env) };
}

// A new feature session, which takes `sessionId` as its own. Returns { file, args, env, input, verbatim }.
export function featureStartCall({ sessionId, ...rest }) {
  return featureCall({ ...rest, lead: ['--session-id', sessionId] });
}

// The feature session with id `sessionId`, resumed. The mode and model are given again: `--resume` needs them.
export function featureResumeCall({ sessionId, ...rest }) {
  return featureCall({ ...rest, lead: ['--resume', sessionId] });
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

export default Object.freeze({ checkForeman, checkFeature, foremanCall, featureStartCall, featureResumeCall, finalAnswer });
