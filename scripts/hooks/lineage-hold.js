// scripts/hooks/lineage-hold.js
// While a Wheelhouse project's lineage hold file is there (the session start wrote it because
// the installed upstream skills differ from Wheelhouse's manifest), lets only reading (READ_TOOLS,
// loading a tool's schema with ToolSearch among it), halting work already running, the runbook,
// the lineage check and the front desk's reading commands through, each command with nothing
// chained, piped or redirected but one trailing ` 2>/dev/null` (stop-guard.js, QUIET). Claude
// Code's notification (NOTIFY_TOOLS) and the Claude app's own task-list and wrap-up tools
// (APP_TURN_TOOLS) pass too: they only draw in the app or tell the director, and the tool guard
// still applies its own app-tool check to those two, so the hold adds no pass it doesn't. The check (`node
// <pluginRoot>/scripts/lineage/check.js [projectDir]`) only reads and says what still differs; the
// hold lifts at the next session start whose check matches (ruling R145). As under STOP
// (stop-guard.js), the halting tools and the runbook stay open: each runbook step but STOP itself
// needs the director's signed click, and an incident during a hold must still be contained. The
// front desk's command runs in exactly the forms STOP lets through (isFrontDeskRead, ruling F70):
// `cards` is how the hold's own card reaches the director, and `record`, `card` and `review` stay held.
// A guard: a throw refuses (hooks.json, onFailure block).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer, runAndExit, projectOf } from './kit.js';
import { HALT_TOOLS, NOTIFY_TOOLS, READ_TOOLS, isFrontDeskRead, isRunbook, scriptArguments, pluginRoots } from './stop-guard.js';
import { agentHoldWords, isHeld } from '../lineage/check.js';
import { projectForFolder } from '../lib/projects.js';
import { stateDir } from '../lib/paths.js';
import { startedAsScript } from '../lib/started-as-script.js';

export const HELD = 'Wheelhouse is holding edits and commands: the installed skills differ from its manifest';
export const CHECK_SCRIPT = 'scripts/lineage/check.js';
// The Claude app's own task-list and wrap-up tools, named whole.
export const APP_TURN_TOOLS = ['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up'];

const SELF = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The check command, with at most one argument, and that one never a flag.
function isCheck(command, roots, platform) {
  const args = scriptArguments(command, roots, platform, CHECK_SCRIPT);
  return args !== null && (args.length === 0 || (args.length === 1 && args[0] !== '' && !args[0].startsWith('-')));
}

// Whether any registered project is held: for a folder that cannot be placed.
function anyHeld() {
  let names;
  try {
    names = fs.readdirSync(path.join(stateDir('x'), '..', '..'));
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
  return names.some((name) => {
    try {
      return isHeld(name);
    } catch {
      return false; // not a project folder name
    }
  });
}

// Whether the folder is held. Both the project its repository names and the project its path
// lies in count, so a .git file pointed at another project's repository cannot step out of
// the hold. A folder whose path cannot be placed is held while any project is.
// Gives the held project's name, true for a hold that can't be placed, or false.
function heldAt(cwd, find, dir) {
  const byRepository = find(cwd, { dir })?.project;
  if (byRepository && isHeld(byRepository)) return byRepository;
  let real;
  try {
    real = fs.realpathSync.native(cwd);
  } catch {
    return anyHeld();
  }
  const byPath = projectForFolder(real)?.project;
  return Boolean(byPath) && isHeld(byPath) ? byPath : false;
}

// What the refusal says: an agent's own hold says what holds the work and what lifts it (ruling P8-32); the session
// start's hold, or one that can't be placed, says the hook's own words.
function heldWords(held) {
  let words = null;
  try {
    words = typeof held === 'string' ? agentHoldWords(held) : null;
  } catch { /* the hook's own words */ }
  return words === null ? HELD : `Wheelhouse is holding edits and commands: ${words}`;
}

// The tools that only read, halt or notify come from `deps`, defaulting to Claude Code's, as in stop-guard.js.
export async function decide(input, {
  dir, projectOf: find = projectOf, pluginRoot = PLUGIN_ROOT, self = SELF, platform = process.platform,
  readTools = READ_TOOLS, haltTools = HALT_TOOLS, notifyTools = NOTIFY_TOOLS,
} = {}) {
  const held = heldAt(input.cwd, find, dir);
  if (!held) return undefined;
  const tool = input.tool_name;
  if (readTools.includes(tool) || haltTools.includes(tool) || notifyTools.includes(tool) || APP_TURN_TOOLS.includes(tool)) return undefined;
  if (input.tool_name === 'Bash') {
    const roots = pluginRoots(dir, self, pluginRoot);
    const command = input.tool_input?.command;
    if (isCheck(command, roots, platform) || isRunbook(command, roots, platform) || isFrontDeskRead(command, roots, platform)) return undefined;
  }
  return answer.deny(heldWords(held));
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: true, event: 'PreToolUse' });
}
