// scripts/hooks/stop-guard.js
// Marks bypass mode for the session on every call, and while STOP is on lets
// only reading, reporting, the runbook, and the foreman's reading and closing
// of a wake through. On SessionEnd it clears the
// session's bypass marker and says nothing.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import { answer, runAndExit, projectOf, registeredByPath, worktreeRoot, lockedByPath, isInside, managedDir } from './kit.js';
import { words } from './shell-words.js';
import { QUESTION_ID } from '../feature/files.js';
import { stopState } from '../lib/stop.js';
import { markBypass, clearBypass } from '../lib/bypass.js';

export const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'TodoWrite'];
// They only halt work that is already running.
export const HALT_TOOLS = ['TaskStop', 'KillShell'];
export const SANDBOX_NEEDED = 'Locked needs the sandbox on in this project\'s settings';
export const DENIED = 'STOP is on: only reading, reporting and the runbook carry on';

// The plugin's folder, from this script's own place: scripts/hooks/ is two down.
const SELF = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Any character that lets a shell run, chain, redirect or substitute something.
const CONTROL = /[;&|`<>\n\r]|\$\(/;
// Whitespace other than a space or tab (no-break space, U+2028, U+3000 and the like).
const ODD_SPACE = /[^\S \t]/u;

// The words after the script when `command` is `node <pluginRoot>/<script> …` with no shell
// syntax at all and the script in a real plugin root; null for anything else.
export function scriptArguments(command, pluginRoots, platform, script) {
  if (typeof command !== 'string' || CONTROL.test(command) || ODD_SPACE.test(command)) return null;
  const windows = platform === 'win32';
  const parts = words(command, windows);
  if (!parts || parts.length < 2 || parts[0] !== 'node') return null;
  const fold = (p) => {
    const slashed = windows ? p.replaceAll('\\', '/') : p;
    return windows || platform === 'darwin' ? slashed.toLowerCase() : slashed;
  };
  return pluginRoots.some((root) => fold(parts[1]) === fold(`${root}/${script}`)) ? parts.slice(2) : null;
}

function isRunbook(command, pluginRoots, platform) {
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

// The plugin's own folder and, for the managed copy, the plugin folder recorded when Locked was installed:
// the folders a plugin command may be run from.
export function pluginRoots(dir, self, pluginRoot) {
  const roots = [pluginRoot];
  try {
    const managed = dir ?? managedDir();
    if (isInside(managed, self)) {
      const recorded = JSON.parse(fs.readFileSync(path.join(managed, 'wheelhouse', 'installed.json'), 'utf8')).pluginRoot;
      if (typeof recorded === 'string' && path.isAbsolute(recorded)) roots.push(recorded);
    }
  } catch {
    // No record: only the copy's own folder counts.
  }
  return roots;
}

export async function decide(input, { dir, projectOf: find = projectOf, pluginRoot = PLUGIN_ROOT, self = SELF, platform = process.platform } = {}) {
  const cwd = input.cwd;
  const found = find(cwd, { dir });
  const byPath = found ? false : registeredByPath(cwd);
  const inProject = Boolean(found) || byPath === true;
  const sessionEnd = input.hook_event_name === 'SessionEnd';
  if (inProject) {
    if (sessionEnd) {
      clearBypass(input.session_id);
      return undefined;
    }
    if (input.permission_mode === 'bypassPermissions') markBypass(input.session_id);
    else clearBypass(input.session_id);
  }
  if (sessionEnd) return undefined;
  if ((input.tool_name === 'Bash' || input.tool_name === 'PowerShell') && (found?.locked || lockedByPath(cwd, { dir })) && !sandboxOn(cwd)) return answer.deny(SANDBOX_NEEDED);
  if (!stopState().on) return undefined;
  // A folder that cannot be placed is held, not waved through.
  if (!inProject && byPath !== null) return undefined;
  if (READ_TOOLS.includes(input.tool_name) || HALT_TOOLS.includes(input.tool_name)) return undefined;
  if (input.tool_name === 'Bash') {
    const roots = pluginRoots(dir, self, pluginRoot);
    const command = input.tool_input?.command;
    if (isRunbook(command, roots, platform) || isFeatureRead(command, roots, platform) || isWakeRead(command, roots, platform)) return undefined;
  }
  return answer.deny(DENIED);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
