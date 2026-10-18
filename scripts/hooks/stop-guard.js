// scripts/hooks/stop-guard.js
// Marks bypass mode for the session on every call, and while STOP is on lets
// only reading, reporting and the runbook through. On SessionEnd it clears the
// session's bypass marker and says nothing.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import { answer, runAndExit, projectOf, registeredByPath, worktreeRoot, lockedByPath, isInside, managedDir } from './kit.js';
import { words } from './shell-words.js';
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

function isRunbook(command, pluginRoots, platform) {
  if (typeof command !== 'string' || CONTROL.test(command) || ODD_SPACE.test(command)) return false;
  const windows = platform === 'win32';
  const parts = words(command, windows);
  if (!parts || parts.length < 3 || parts[0] !== 'node') return false;
  const fold = (p) => {
    const slashed = windows ? p.replaceAll('\\', '/') : p;
    return windows || platform === 'darwin' ? slashed.toLowerCase() : slashed;
  };
  return pluginRoots.some((root) => fold(parts[1]) === fold(`${root}/scripts/runbook/runbook.js`));
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

// The plugin's own folder and, for the managed copy, the plugin folder recorded when Locked was installed.
function runbookRoots(dir, self, pluginRoot) {
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
  if (input.tool_name === 'Bash' && isRunbook(input.tool_input?.command, runbookRoots(dir, self, pluginRoot), platform)) return undefined;
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
