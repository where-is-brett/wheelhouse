// scripts/lib/started-by-script.js
// Whether a session was started by a script. It sits apart from the decisions' answer so the seat and the hooks can ask
// it without loading that module's graph; scripts/decisions/answer.js re-exports it.
// The values of CLAUDE_CODE_ENTRYPOINT that are not a person typing: Claude Code's print mode and its SDKs. The app,
// the editor and the terminal each set another value.
export const SCRIPT_ENTRYPOINT = /^sdk-/;
// The variables only Wheelhouse's own starters set on a session they run.
const STARTER_VARIABLES = ['WHEELHOUSE_ROLE', 'WHEELHOUSE_SESSION', 'WHEELHOUSE_AGENT', 'WHEELHOUSE_ENGINE_RUN'];

// Whether the session was started by a script, from the environment its hooks inherit.
export function startedByScript(env = process.env) {
  const entry = env?.CLAUDE_CODE_ENTRYPOINT;
  if (typeof entry === 'string' && SCRIPT_ENTRYPOINT.test(entry)) return true;
  return STARTER_VARIABLES.some((name) => typeof env?.[name] === 'string' && env[name] !== '');
}
