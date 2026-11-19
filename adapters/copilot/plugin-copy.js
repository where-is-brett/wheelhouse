// adapters/copilot/plugin-copy.js
// Whether a hook script is the plugin copy Copilot installs for itself (under <Copilot home>/installed-plugins, the home
// being COPILOT_HOME or ~/.copilot) while Wheelhouse's own Copilot hook entry is registered and in place
// (<Copilot home>/hooks/wheelhouse.json, written by setup). Copilot runs that copy's hooks as well, in Claude Code's
// form, which they cannot read; the registered entry is the one that answers Copilot. Without the registration the copy
// keeps guarding, and refuses what it cannot read. Claude Code never runs from there. It imports nothing that reaches
// the hook kit; the kit passes its own test for a file inside a folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The Copilot hook entry as a registration's `command` names it, in double quotes (hooks.js), which a path holding an
// apostrophe keeps whole.
const ENTRY = /"([^"]*scripts[\\/]agents[\\/]copilot[\\/]hook-entry\.js)"/g;

export function standsAside(self, { env = process.env, homedir = os.homedir(), isInside }) {
  try {
    const given = env?.COPILOT_HOME;
    const home = typeof given === 'string' && given !== '' ? given : path.join(homedir, '.copilot');
    if (!isInside(path.join(home, 'installed-plugins'), self)) return false;
    const strings = (value) => (typeof value === 'string' ? [value]
      : value !== null && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
    const commands = strings(JSON.parse(fs.readFileSync(path.join(home, 'hooks', 'wheelhouse.json'), 'utf8')));
    return commands.flatMap((command) => [...command.matchAll(ENTRY)]).some(([, entry]) => {
      try {
        return path.isAbsolute(entry) && fs.statSync(entry).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
