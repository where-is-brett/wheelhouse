// scripts/hooks/lineage-hold.js
// While a Wheelhouse project's lineage hold file is there (the session start wrote it because
// the installed upstream skills differ from Wheelhouse's manifest), lets only reading and the
// lineage check through: `node <pluginRoot>/scripts/lineage/check.js [projectDir]`, with
// nothing chained, piped or redirected. A guard: a throw refuses (hooks.json, onFailure block).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { answer, runAndExit, projectOf } from './kit.js';
import { READ_TOOLS, scriptArguments, pluginRoots } from './stop-guard.js';
import { isHeld } from '../lineage/check.js';
import { projectForFolder } from '../lib/projects.js';
import { stateDir } from '../lib/paths.js';

export const HELD = 'Wheelhouse is holding edits and commands: the installed skills differ from its manifest';
export const CHECK_SCRIPT = 'scripts/lineage/check.js';

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
function heldAt(cwd, find, dir) {
  const byRepository = find(cwd, { dir })?.project;
  if (byRepository && isHeld(byRepository)) return true;
  let real;
  try {
    real = fs.realpathSync.native(cwd);
  } catch {
    return anyHeld();
  }
  const byPath = projectForFolder(real)?.project;
  return Boolean(byPath) && isHeld(byPath);
}

export async function decide(input, { dir, projectOf: find = projectOf, pluginRoot = PLUGIN_ROOT, self = SELF, platform = process.platform } = {}) {
  if (!heldAt(input.cwd, find, dir)) return undefined;
  if (READ_TOOLS.includes(input.tool_name)) return undefined;
  if (input.tool_name === 'Bash' && isCheck(input.tool_input?.command, pluginRoots(dir, self, pluginRoot), platform)) return undefined;
  return answer.deny(HELD);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAndExit(decide, { failClosed: true, event: 'PreToolUse' });
}
