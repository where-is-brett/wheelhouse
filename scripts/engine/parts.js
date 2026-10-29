// scripts/engine/parts.js
// What only reads of the build engine's setup parts (Archon design, section 14): whether the engine is wanted on this
// computer, whether it is installed, and the names of the project's own files for it. Setup's writers are in
// scripts/setup/engine-parts.js, which gives these on; the mod's bridge reaches only this file.
import fs from 'node:fs';
import { engineDir } from '../lib/paths.js';
import { enginePaths, launcherText, PATCH_MARK } from './archon/build.js';

// The engine runs on the Mac only for now (spec 17, step 2); Windows is tried in its own sitting.
export const engineWanted = ({ platform = process.platform } = {}) => platform === 'darwin';

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

// Whether the engine is in: Wheelhouse's patched build from source, with its launcher and the pinned Bun.
export function engineInstalled(engine = engineDir()) {
  const p = enginePaths(engine);
  return read(p.launcher) === launcherText(engine) && (read(p.provider) ?? '').includes(PATCH_MARK) && fs.existsSync(p.bunBin);
}

// The project's own files for the engine: the merge queue's maintainers policy and Archon's project settings, which
// put its worktrees inside the project folder, under .wheelhouse/ (kept out of git).
export const POLICY_FILE = '.archon/sdlc/policy/maintainers.json';
export const ARCHON_CONFIG_FILE = '.archon/config.yaml';
export const ENGINE_FILES = Object.freeze([POLICY_FILE, ARCHON_CONFIG_FILE]);
export const WORKTREE_PATH = '.wheelhouse/worktrees';
