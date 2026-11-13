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

// The one shape a launcher command may take (a Windows .cmd has cmd.exe read its arguments again, and PowerShell expands
// what a literal-word check can't see, so an allowlist, not a list of bad characters): the launcher's name, then
// arguments, each bare characters from `[A-Za-z0-9_.,:/=+@-]` (no `@` first) or one single-quoted string holding none of
// `' " % ^ & | < > $` backtick `!` or a line break; then at most one `< <bare path>` (not under /dev/) and one `2>/dev/null` or `2>NUL`.
// The whole command is printable ASCII (PowerShell reads U+2018 to U+201E as quotes), a space or tab apart, and a quoted
// body holds no `;`, bracket or brace either. No `;`, pipe, `$`, bracket, backtick or second command can match.
const BARE = String.raw`[A-Za-z0-9_.,:/=+-][A-Za-z0-9_.,:/=+@-]*`;
const QUOTED = String.raw`'[^'"%^&|<>$` + '`' + String.raw`!;(){}\r\n]*'`;
const NAMES = Object.keys(LAUNCHERS).map((name) => name.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&')).join('|');
export const LAUNCHER_COMMAND = new RegExp(String.raw`^(?=[ -~]*$)[ \t]*(?:${NAMES})(?:\.cmd)?(?:[ \t]+(?:${BARE}|${QUOTED}))*(?:[ \t]+<[ \t]*(?!dev/)(?![^ \t]*/dev/)${BARE})?(?:[ \t]+2>(?:/dev/null|NUL))?[ \t]*$`, 'i');

// How to write an argument the grammar takes.
export const LAUNCHER_GRAMMAR_HELP = 'give each argument as plain letters, digits and . , : / = + @ - , or as text in single quotes (never double quotes) with no \' " % ^ & | < > $ ! or backtick in it, one launcher command alone on the line (no ; | && or $variable), or put longer text in a file and read it with `< path`';
