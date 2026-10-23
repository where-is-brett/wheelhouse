// adapters/copilot/hooks.js
// How Copilot is told which hooks to run: one file in the person's own hook folder, `<home>/hooks/wheelhouse.json`,
// the home being COPILOT_HOME or ~/.copilot. Check 56 found that folder the one place that runs once per event in
// every folder (main folder, worktree, no .git), trusted or not. Nothing is written into a project
// (`.github/hooks/`, `.github/copilot/settings.json`, `.claude/settings.json`): those load only in a folder Copilot
// trusts, so they would run a second time there and not at all elsewhere.
//
// Each event is registered once, under its camelCase name only (checks 56, 58 and 60: a second spelling runs the
// hook twice, and answers to `UserPromptSubmit` never reached the agent). Every entry starts the one hook entry,
// scripts/agents/copilot/hook-entry.js, with the event as its argument, and gives it GUARD_TIMEOUT_SEC.
//
// The file is written by setup, once per computer (writeRegistration), never by an agent or a hook (design
// section 8.2).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quoteForCmd } from '../../scripts/lib/claude.js';
import { GUARD_TIMEOUT_SEC, HOOK_FILE } from '../../scripts/lib/copilot-numbers.js';

// The events registered (ruling P5-12). `postToolUse` waits for sitting S1 to show ask_user's input, and
// `subagentStop` for a task that uses it.
export const EVENTS = Object.freeze(['sessionStart', 'userPromptSubmitted', 'preToolUse', 'preCompact']);

// The hook entry, from the Wheelhouse folder (ruling P5-11).
export const ENTRY = 'scripts/agents/copilot/hook-entry.js';

// The person's Copilot home: COPILOT_HOME, or ~/.copilot.
export function copilotHome({ env = process.env, homedir = os.homedir() } = {}) {
  const given = env?.COPILOT_HOME;
  return typeof given === 'string' && given !== '' ? given : path.join(homedir, '.copilot');
}

// The hook file's path for a Copilot home.
export function file({ home = copilotHome() } = {}) {
  return path.join(home, 'hooks', HOOK_FILE);
}

const unsafe = (value) => new Error(`The hook registration can't be written safely with this path: ${JSON.stringify(value)}`);

// A path in double quotes for a POSIX shell. Inside them an apostrophe or a space stays literal; a character the
// shell still reads there (`"`, `$`, a backtick, a backslash) or a line break is refused.
function posixQuoted(value) {
  if (/["$`\\\r\n]/.test(value)) throw unsafe(value);
  return `"${value}"`;
}

// A path for cmd.exe's command line (scripts/lib/claude.js), always in double quotes, as the Windows line is
// written whether or not the path holds a space.
function cmdQuoted(value) {
  try {
    quoteForCmd(value);
  } catch {
    throw unsafe(value);
  }
  return `"${value}"`;
}

// A path in PowerShell's literal form: single quotes, an apostrophe doubled. A line break is refused.
function powershellQuoted(value) {
  if (/[\r\n]/.test(value)) throw unsafe(value);
  return `'${value.replaceAll('\'', '\'\'')}'`;
}

function fullPath(value, platform, what) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (typeof value !== 'string' || !p.isAbsolute(value)) throw new Error(`The hook registration needs the full path of ${what}, and was given ${JSON.stringify(value)}`);
  return value;
}

// One event's entry. On Windows: `command` for cmd.exe and `powershell` (ruling P5-13; sitting S2 runs it).
// Elsewhere: `command` and `bash`, the field checks 56 and 58 ran.
function entryFor(event, { node, script, platform }) {
  if (platform === 'win32') {
    return {
      type: 'command',
      command: `${cmdQuoted(node)} ${cmdQuoted(script)} ${event}`,
      powershell: `& ${powershellQuoted(node)} ${powershellQuoted(script)} ${event}`,
      timeoutSec: GUARD_TIMEOUT_SEC,
    };
  }
  const line = `${posixQuoted(node)} ${posixQuoted(script)} ${event}`;
  return { type: 'command', command: line, bash: line, timeoutSec: GUARD_TIMEOUT_SEC };
}

// The hook file's content. `node` is the full path of the Node.js that runs setup (process.execPath), so moving
// Node.js after install needs install again; `root` is the Wheelhouse folder. Each call gives a fresh object.
export function registration({ node = process.execPath, root, platform = process.platform } = {}) {
  fullPath(node, platform, 'Node.js');
  fullPath(root, platform, 'the Wheelhouse folder');
  const script = platform === 'win32' ? path.win32.join(root, ...ENTRY.split('/')) : path.posix.join(root, ENTRY);
  return { version: 1, hooks: Object.fromEntries(EVENTS.map((event) => [event, [entryFor(event, { node, script, platform })]])) };
}

// Writes the registration to the hook file of `home`, replacing any file of that name (Lean's shell guard writes
// the same name, so only one is ever registered). Returns the file's path. Setup's step only.
export function writeRegistration({ home = copilotHome(), node, root, platform } = {}) {
  const target = file({ home });
  const text = `${JSON.stringify(registration({ node, root, platform }), null, 2)}\n`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return target;
}

export default Object.freeze({ registration, file, writeRegistration });
