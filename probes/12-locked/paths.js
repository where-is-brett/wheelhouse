// probes/12-locked/paths.js
// Where Claude Code reads the computer-wide settings file on each system.
// Check against https://code.claude.com/docs/en/settings before a run.
import path from 'node:path';

export function managedDir(platform = process.platform) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform === 'win32') return path.win32.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode');
  throw new Error('This probe runs on macOS and Windows only');
}
