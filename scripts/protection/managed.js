// scripts/protection/managed.js
// Where Claude Code reads the computer-wide (managed) settings from, and the
// list of Locked projects kept beside them.
// Check against https://code.claude.com/docs/en/settings before a run.
import fs from 'node:fs';
import path from 'node:path';

// Locked runs on macOS. Anywhere else there is no managed folder (null): Windows runs Standard with the Guarded
// build commands.
export function managedDir(platform = process.platform) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  // Wheelhouse is not offered on Linux; the hooks still read the folder there (CI runs on it).
  if (platform === 'linux') return '/etc/claude-code';
  return null;
}

// The main folders of the Locked projects: the JSON array in
// <dir>/wheelhouse/locked-projects.json. Empty when the file is missing or
// does not read as a list of full paths; anything else is dropped. None where there is no managed folder.
export function lockedProjects({ dir = managedDir() } = {}) {
  if (dir === null) return [];
  try {
    const kept = JSON.parse(fs.readFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), 'utf8'));
    return Array.isArray(kept) ? kept.filter((folder) => typeof folder === 'string' && path.isAbsolute(folder)) : [];
  } catch {
    return [];
  }
}
