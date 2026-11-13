// scripts/lib/launchers.js
// The launchers: one bare command name for each of Wheelhouse's scripts a Copilot session runs, in `bin/`. Copilot
// matches a shell rule on the command's stem (check 61, the T4 run), so `node <path>/cli.js` can only be allowed by
// allowing every `node` command; a launcher's bare name can be allowed alone. A rule `shell(wh-frontdesk:*)` matched
// and ran it (13 November 2026, CLI 1.0.105, with the folder of `bin/` on the session's PATH); the same rule naming
// the launcher's full path did not. Claude Code keeps its `node "<path>"` commands.
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

// The environment variable a launcher sets for the script it runs, so the script names its commands by launcher.
export const LAUNCHED = 'WHEELHOUSE_LAUNCHED';

// A PATH with the launchers' folder first, for a session that runs them. `delimiter` is the system's.
export function pathWithLaunchers(current, { binDir = BIN_DIR, delimiter = path.delimiter } = {}) {
  const rest = typeof current === 'string' && current !== '' ? current.split(delimiter).filter((p) => p !== binDir) : [];
  return [binDir, ...rest].join(delimiter);
}
