// scripts/hooks/stop-guard.js
// Marks bypass mode for the session on every call, and while STOP is on lets
// only reading, reporting, loading a tool's schema (ToolSearch), Claude Code's notification, the
// runbook, the foreman's reading and closing of a wake, and the front desk's and setup's reading
// commands (uninstall's among them) through, each command with nothing chained, piped or
// redirected but one trailing ` 2>/dev/null` (QUIET). On SessionEnd it clears the session's bypass
// marker and says nothing. It acts in a registered project and in a folder being set up (kit.js's
// beingSetUp), as in a project.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import { answer, runAndExit, pluginRoots, projectOf, registeredByPath, worktreeRoot, lockedByPath, beingSetUp } from './kit.js';
import { words } from './shell-words.js';
import { QUESTION_ID } from '../feature/files.js';
import { stopState, NO_HELPER_STOP } from '../lib/stop.js';
import { markBypass, clearBypass } from '../lib/bypass.js';
import { SETUP_TITLES } from '../state/card-lines.js';
import { startedAsScript } from '../lib/started-as-script.js';
import tools from '../../adapters/claude-code/tools.js';
import { parseTrialLine, MOST_TRIAL_LINES } from '../lib/trial-lines.js';

// ToolSearch only loads tools' schemas, so the notification tool can be loaded under STOP; it runs
// nothing, and every tool it loads still meets this guard and the lineage hold.
export const READ_TOOLS = tools.read;
// They only halt work that is already running.
export const HALT_TOOLS = tools.halt;
// Claude Code's own notification, so the courier's wake for STOP can still reach the director's
// phone. It only tells them. It is kept out of READ_TOOLS; the lineage hold lets it through separately (lineage-hold.js).
export const NOTIFY_TOOLS = tools.notify;
export const SANDBOX_NEEDED = 'Locked needs the sandbox on in this project\'s settings';
export const DENIED = 'STOP is on: only reading, reporting and the runbook carry on';

// The plugin's folder, from this script's own place: scripts/hooks/ is two down.
const SELF = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Any character that lets a shell run, chain, redirect or substitute something.
const CONTROL = /[;&|`<>\n\r]|\$\(/;
// Whitespace other than a space or tab (no-break space, U+2028, U+3000 and the like).
const ODD_SPACE = /[^\S \t]/u;

// One trailing ` 2>/dev/null`, which sessions add to hide the sandbox's certificate lines: one
// space or more before it, the first not escaped by a backslash, and nothing after it but spaces.
// On Windows ` 2>NUL` too, in any case.
const QUIET = /(?<!\\) +2>\/dev\/null *$/;
const QUIET_WINDOWS = /(?<!\\) +2>(?:\/dev\/null|[Nn][Uu][Ll]) *$/;

// The one word allowed between `node` and the script (NO_SYSTEM_CA in scripts/protection/settings.js, which a hook can't load).
const NO_SYSTEM_CA = '--no-use-system-ca';

// The words after the script when `command` is `node [--no-use-system-ca] <pluginRoot>/<script> …` with no shell
// syntax but one trailing QUIET, and the script in a real plugin root; null for anything else.
export function scriptArguments(command, pluginRoots, platform, script) {
  if (typeof command !== 'string') return null;
  const windows = platform === 'win32';
  const bare = command.replace(windows ? QUIET_WINDOWS : QUIET, '');
  if (CONTROL.test(bare) || ODD_SPACE.test(bare)) return null;
  const parts = words(bare, windows);
  if (!parts || parts.length < 2 || parts[0] !== 'node') return null;
  if (parts[1] === NO_SYSTEM_CA) parts.splice(1, 1);
  if (parts.length < 2) return null;
  const fold = (p) => {
    const slashed = windows ? p.replaceAll('\\', '/') : p;
    return windows || platform === 'darwin' ? slashed.toLowerCase() : slashed;
  };
  return pluginRoots.some((root) => fold(parts[1]) === fold(`${root}/${script}`)) ? parts.slice(2) : null;
}

// The runbook's one command with a step: `node <pluginRoot>/scripts/runbook/runbook.js <step> …`.
export function isRunbook(command, pluginRoots, platform) {
  const args = scriptArguments(command, pluginRoots, platform, 'scripts/runbook/runbook.js');
  return args !== null && args.length > 0;
}

// A feature session's two commands that only read and report: `answer <questionId>` and
// `report`. `ask` and `open-pr` write, so they stay refused.
function isFeatureRead(command, pluginRoots, platform) {
  const args = scriptArguments(command, pluginRoots, platform, 'scripts/feature/cli.js');
  if (args === null) return false;
  return (args.length === 1 && args[0] === 'report') || (args.length === 2 && args[0] === 'answer' && QUESTION_ID.test(args[1]));
}

// The front desk's commands that only read (scripts/frontdesk/cli.js), by their exact words:
// `cards`, `similar`, `similar <the request's words>` (see REQUEST), `again <n>`, `views <name>`,
// `explain <term>` (one to four words of letters and digits, a word's parts joined by hyphens) and
// `preview <pull request>`. `cards` and `again` record which cards they handed out, and under STOP
// the helper refuses that write, so the cards are still given. `card` and `record` write, so they
// stay refused, as does every other form. The lineage hold lets the same forms through (ruling F70).
const VIEW_NAMES = ['rulebook', 'waiting', 'ideas', 'glossary', 'settings', 'levels', 'work', 'survey'];
const COUNT = /^[1-9][0-9]{0,8}$/;
const TERM = /^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u;
// A request's words for `similar`, quoted or not: they start with a letter or digit and hold only
// letters, digits, spaces and plain punctuation, nothing a shell would expand or read as a comment.
const REQUEST = /^[\p{L}\p{N}][\p{L}\p{N} ,.:'’"!?\/@%+=-]*$/u;
export function isFrontDeskRead(command, pluginRoots, platform) {
  const args = scriptArguments(command, pluginRoots, platform, 'scripts/frontdesk/cli.js');
  if (args === null || args.length === 0) return false;
  const [name, ...rest] = args;
  if (name === 'cards') return rest.length === 0;
  if (name === 'similar') return rest.length === 0 || REQUEST.test(rest.join(' '));
  if (name === 'again' || name === 'preview') return rest.length === 1 && COUNT.test(rest[0]);
  if (name === 'views') return rest.length === 1 && VIEW_NAMES.includes(rest[0]);
  if (name === 'explain') {
    const term = rest.join(' ');
    return rest.length > 0 && TERM.test(term) && term.split(' ').length <= 4;
  }
  return false;
}

// Setup's commands that only read (scripts/setup/cli.js), by their exact words: `status`,
// `plan <step>`, `wait <step>`, which asks that plan again while it waits, and `resume`, which asks
// for the status and then the plan of the first step neither done nor running, and so reads no more
// than those two. The helper answers both under STOP, changing nothing
// a step lists: `plan` writes only setup's own records, including a step settled on answers the
// director already gave (ruling R52). `health`, followed by up to MOST_TRIAL_LINES lines each as
// the safety trials print them (scripts/lib/trial-lines.js), reads step 10's board (ruling R41); under
// STOP the helper neither starts anything nor removes anything for it. `uninstall plan` and
// `uninstall status` read what uninstall would put back and where it stands (ruling R90). `apply`
// and `uninstall apply` change what their cards list, so they stay refused (ruling R91: uninstall
// has no exception of its own, and its card says to lift STOP first), as does every other form.
const SETUP_STEP = new RegExp(`^(?:${Object.keys(SETUP_TITLES).join('|')})$`);
function isSetupRead(command, pluginRoots, platform) {
  const args = scriptArguments(command, pluginRoots, platform, 'scripts/setup/cli.js');
  if (args === null) return false;
  if (args[0] === 'health') return args.length - 1 <= MOST_TRIAL_LINES && args.slice(1).every((l) => parseTrialLine(l) !== null);
  if (args[0] === 'uninstall') return args.length === 2 && ['plan', 'status'].includes(args[1]);
  return (args.length === 1 && ['status', 'resume'].includes(args[0])) || (args.length === 2 && ['plan', 'wait'].includes(args[0]) && SETUP_STEP.test(args[1]));
}

// A wake file as the foreman is told it: one word naming a .json file, never a flag.
const WAKE_FILE = /^[^-].*\.json$/;

// The foreman's two commands that read a wake and record it done: `read <file>`
// and `done <file> --acted|--idle`, so a wake under way when STOP lands can
// still be read and closed. `measures` and every `act.js` command stay refused.
function isWakeRead(command, pluginRoots, platform) {
  const args = scriptArguments(command, pluginRoots, platform, 'scripts/foreman/wake.js');
  if (args === null || !WAKE_FILE.test(args[1] ?? '')) return false;
  return (args.length === 2 && args[0] === 'read') || (args.length === 3 && args[0] === 'done' && ['--acted', '--idle'].includes(args[2]));
}

// sandbox.enabled as the worktree's settings leave it: the local file wins when it
// sets the key. Anything missing or unreadable reads as not on.
function sandboxOn(cwd) {
  const root = worktreeRoot(cwd);
  if (root === null) return false;
  const read = (name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, '.claude', name), 'utf8'))?.sandbox?.enabled;
    } catch {
      return undefined;
    }
  };
  return (read('settings.local.json') ?? read('settings.json')) === true;
}

// The folders a plugin command may be run from (kit.js, shared with the session start).
export { pluginRoots };

// The tools that only read, halt or notify come from `deps` (readTools, haltTools, notifyTools), so a hook entry
// for an agent whose tools keep names of their own can add them; they default to Claude Code's.
//
// On an agent whose hooks only read (`writeVia: 'helper'`, or `bypass: false`), the bypass marker is neither
// written nor cleared. `helperUp: false` says the helper isn't answering there (ruling P5-22): everything STOP
// holds is held, with NO_HELPER_STOP, since nothing a write needs can reach the helper.
export async function decide(input, {
  dir, projectOf: find = projectOf, pluginRoot = PLUGIN_ROOT, self = SELF, platform = process.platform,
  readTools = READ_TOOLS, haltTools = HALT_TOOLS, notifyTools = NOTIFY_TOOLS, bypass = true, writeVia = 'self', helperUp,
} = {}) {
  const cwd = input.cwd;
  const found = find(cwd, { dir });
  const byPath = found ? false : registeredByPath(cwd);
  const inProject = Boolean(found) || byPath === true || (byPath === false && beingSetUp(cwd) !== null);
  const sessionEnd = input.hook_event_name === 'SessionEnd';
  if (inProject && bypass !== false && writeVia === 'self') {
    if (sessionEnd) {
      clearBypass(input.session_id);
      return undefined;
    }
    if (input.permission_mode === 'bypassPermissions') markBypass(input.session_id);
    else clearBypass(input.session_id);
  }
  if (sessionEnd) return undefined;
  if ((input.tool_name === 'Bash' || input.tool_name === 'PowerShell') && (found?.locked || lockedByPath(cwd, { dir })) && !sandboxOn(cwd)) return answer.deny(SANDBOX_NEEDED);
  const stopped = stopState().on;
  if (!stopped && helperUp !== false) return undefined;
  // A folder that cannot be placed is held, not waved through.
  if (!inProject && byPath !== null) return undefined;
  if (readTools.includes(input.tool_name) || haltTools.includes(input.tool_name) || notifyTools.includes(input.tool_name)) return undefined;
  if (input.tool_name === 'Bash') {
    const roots = pluginRoots(dir, self, pluginRoot);
    const command = input.tool_input?.command;
    if (isRunbook(command, roots, platform) || isFeatureRead(command, roots, platform) || isWakeRead(command, roots, platform)
      || isFrontDeskRead(command, roots, platform) || isSetupRead(command, roots, platform)) return undefined;
  }
  return answer.deny(stopped ? DENIED : NO_HELPER_STOP);
}

if (startedAsScript(import.meta.url)) {
  // One script serves two events, and a failure answers differently on each, so
  // the event is read first and the input handed on.
  let text = '';
  let event = 'PreToolUse';
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    text = Buffer.concat(chunks).toString('utf8');
    if (JSON.parse(text)?.hook_event_name === 'SessionEnd') event = 'SessionEnd';
  } catch {
    // Unreadable input is treated as a tool call, so it is refused.
  }
  await runAndExit(decide, { failClosed: true, event }, { stdin: Readable.from([text]) });
}
