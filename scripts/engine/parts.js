// scripts/engine/parts.js
// What only reads of the build engine's setup parts (Archon design, section 14): whether the engine is wanted on this
// computer, whether it is installed, and the names of the project's own files for it. Setup's writers are in
// scripts/setup/engine-parts.js, which gives these on; the mod's bridge reaches only this file.
import fs from 'node:fs';
import path from 'node:path';
import { engineDir } from '../lib/paths.js';
import { COPILOT_PATCH_MARK, enginePaths, launcherText, PATCH_MARK } from './archon/build.js';

// The engine runs on the Mac only for now (spec 17, step 2); Windows is tried in its own sitting. It builds on GitHub
// only (section 16), so a Mac whose projects are all on GitLab doesn't run it. `hosts` are the hosts of the projects
// on this computer, the one being set up included, with null for one whose host isn't chosen yet, which may be GitHub;
// left out, only the platform counts.
export const engineWanted = ({ platform = process.platform, hosts } = {}) => platform === 'darwin'
  && (!Array.isArray(hosts) || hosts.length === 0 || hosts.some((host) => host !== 'gitlab'));

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

// Whether the engine is in: Wheelhouse's patched build from source, with its launcher and the pinned Bun.
export function engineInstalled(engine = engineDir()) {
  const p = enginePaths(engine);
  return read(p.launcher) === launcherText(engine) && (read(p.provider) ?? '').includes(PATCH_MARK) && (read(p.copilotResolver) ?? '').includes(COPILOT_PATCH_MARK) && fs.existsSync(p.bunBin);
}

// The project's own files for the engine: the merge queue's maintainers policy and Archon's project settings, which
// put its worktrees inside the project folder, under .wheelhouse/ (kept out of git).
export const POLICY_FILE = '.archon/sdlc/policy/maintainers.json';
export const ARCHON_CONFIG_FILE = '.archon/config.yaml';
export const ENGINE_FILES = Object.freeze([POLICY_FILE, ARCHON_CONFIG_FILE]);
export const WORKTREE_PATH = '.wheelhouse/worktrees';

// What is wrong with the broker's launcher (<engine>/broker/bin/gh, setup's step 2), or null. It names the Node.js that
// ran setup and the broker's script in that Wheelhouse's versioned folder, and either can go: a Node.js update, or an
// update of Wheelhouse that removes the old version's folder. Then every gh call of a run's steps would fail.
// With `gone`, only a launcher naming a program that is no longer there counts, as a run's start checks.
export function brokerProblem(engine = engineDir(), { gone = false } = {}) {
  const text = read(path.join(engine, 'broker', 'bin', 'gh'));
  const exec = text === null ? null : /^exec '([^']+)' '([^']+)' "\$@"$/m.exec(text);
  if (!exec) {
    if (gone) return null;
    return text === null
      ? "The broker's launcher isn't in the engine's folder, so a run's steps can't reach the code host; setup's step 2 writes it again"
      : "The broker's launcher isn't the one setup writes; setup's step 2 writes it again";
  }
  const missing = [exec[1], exec[2]].filter((file) => !fs.existsSync(file));
  if (missing.length > 0) return `The broker's launcher names ${missing.join(' and ')}, which ${missing.length === 1 ? 'is' : 'are'} no longer there (Node.js or Wheelhouse was updated), so no run starts until setup's step 2 writes it again`;
  return null;
}

// The fetch mirror's rule (3b): Archon's git reads the project's repository from the helper's mirror in the engine
// folder, so no key reaches Archon. The rule can't go in the project's own git config, which setup's fenced git
// refuses to work in once it holds a url rule (ruling R112), so it goes in the engine folder's list, which every
// Archon command reads into its environment (scripts/engine/archon/env.js): { <project>: <its address> }.
export const mirrorRulesFile = (engine = engineDir()) => path.join(engine, 'mirrors', 'rules.json');
