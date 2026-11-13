// scripts/lib/launchers.js
// The launchers: one bare command name for each of Wheelhouse's scripts, in `bin/`, for an agent that matches a shell
// rule on the command's stem (its adapter's tool sheet says so: scripts/agents/tool-sheets.js's BY_LAUNCHER). For such
// an agent `node <path>/cli.js` can only be allowed by allowing every `node` command; a launcher's bare name can be
// allowed alone, with the folder of `bin/` on the session's PATH (check 61, the T4 run). An agent that matches the
// whole command keeps its `node "<path>"` commands.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin');

// Each launcher's name, and the script it runs, inside the plugin.
export const LAUNCHERS = Object.freeze({
  'wh-frontdesk': 'scripts/frontdesk/cli.js',
  'wh-feature': 'scripts/feature/cli.js',
  'wh-setup': 'scripts/setup/cli.js',
  'wh-update': 'scripts/update/cli.js',
  'wh-trials': 'scripts/health/trials.js',
  'wh-wake': 'scripts/foreman/wake.js',
  'wh-act': 'scripts/foreman/act.js',
});

// The launcher that runs `script`, or null.
export const launcherOf = (script) => Object.entries(LAUNCHERS).find(([, s]) => s === script)?.[0] ?? null;

// The marker an adapter sets in the environment of a session that runs Wheelhouse's scripts by launcher. A guard reads a
// bare launcher name as Wheelhouse's own only in a session that has it (scripts/hooks/stop-guard.js).
export const LAUNCHER_SESSION = 'WHEELHOUSE_LAUNCHER_SESSION';

// The environment variable a launcher sets for the script it runs, so the script names its commands by launcher.
export const LAUNCHED = 'WHEELHOUSE_LAUNCHED';

// A PATH with the launchers' folder first, for a session that runs them. `delimiter` is the system's.
export function pathWithLaunchers(current, { binDir = BIN_DIR, delimiter = path.delimiter } = {}) {
  const rest = typeof current === 'string' && current !== '' ? current.split(delimiter).filter((p) => p !== binDir) : [];
  return [binDir, ...rest].join(delimiter);
}
