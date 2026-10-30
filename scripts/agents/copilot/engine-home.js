// scripts/agents/copilot/engine-home.js
// The clean home the Copilot CLI runs from under the build engine (Archon design, section 13), repurposed from the
// session homes of the other-agents design (adapters/copilot/sessions.js): `<engine>/copilot/home/`, named to the CLI
// by COPILOT_HOME (scripts/engine/archon/env.js). It holds Wheelhouse's hook registration, so the guards are the CLI's
// own hooks; the skill copies the plugin carries, by their plain names, since Copilot loads no plugins; and
// config.json with the sign-in keys alone, from the person's own Copilot home. Nothing else is kept but Copilot's own
// state. Check 74 found that Archon looks for a step's skills in the run's worktree and $HOME, not here, so the pack's
// Copilot form writes the same copies into the worktree too (scripts/engine/archon/copilot-pack.js); the copies here
// are for the CLI's own loading, which check 74's fifth item shows when it runs.
//
// Kept beside home.js, which builds the Lean kit for a person's own ~/.copilot/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copilotHome, file as hookFile, registration, writeRegistration } from '../../../adapters/copilot/hooks.js';
import { COPILOT_STATE, signInOf } from '../../../adapters/copilot/sessions.js';
import { copilotCliPaths } from '../../engine/archon/copilot-cli.js';
import { SKILL_COPIES } from '../../lineage/copies.js';
import { engineDir } from '../../lib/paths.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The skills the home holds: every copy the plugin carries, by its plain name.
export const ENGINE_HOME_SKILLS = SKILL_COPIES;

// Throws when any folder from the engine folder down to `dir` is a link or a file, so nothing written or removed
// under `dir` can land outside the engine folder. Folders not made yet are not looked at.
function refuseLinkedPath(engine, dir) {
  const relative = path.relative(engine, dir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${dir} isn't inside the engine folder`);
  let at = engine;
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    at = part === '' ? at : path.join(at, part);
    const stat = fs.lstatSync(at, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${at} must be a folder Wheelhouse made, and it is a link or a file, so nothing is written there`);
  }
}

// A skill folder copied whole; a link anywhere in it refuses the copy.
function copySkill(from, to, name) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`The ${name} skill holds a link, which is never put in the clean home`);
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  walk(from);
  fs.cpSync(from, to, { recursive: true });
}

// Writes the clean home and returns its path. The sign-in is read first, so a computer with none refuses before the
// home is touched; config.json is written last, so a home is never signed in without its guards. `root` is the
// plugin's folder the registration and the skills come from; `node` and `platform` are the registration's.
export function writeEngineHome({ engine = engineDir(), signedInFrom = copilotHome(), node = process.execPath, root = PLUGIN_ROOT, platform = process.platform, skills = ENGINE_HOME_SKILLS } = {}) {
  const home = copilotCliPaths(engine).home;
  const signIn = signInOf(signedInFrom);
  refuseLinkedPath(engine, home);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.chmodSync(home, 0o700);
  refuseLinkedPath(engine, home);
  for (const name of fs.readdirSync(home)) {
    const own = COPILOT_STATE.some((pattern) => pattern.test(name)) && !fs.lstatSync(path.join(home, name)).isSymbolicLink();
    // A link is removed, never followed; Wheelhouse's own parts are written afresh.
    if (!own) fs.rmSync(path.join(home, name), { recursive: true, force: true });
  }
  writeRegistration({ home, node, root, platform });
  for (const name of skills) copySkill(path.join(root, 'skills', name), path.join(home, 'skills', name), name);
  const config = path.join(home, 'config.json');
  const temp = `${config}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(signIn, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, config);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return home;
}

// What is wrong with the clean home, in plain words for the health check, or null: it isn't there, its guards aren't
// Wheelhouse's registration as it would be written now, or it isn't signed in.
export function engineHomeProblem({ engine = engineDir(), node = process.execPath, root = PLUGIN_ROOT, platform = process.platform } = {}) {
  const home = copilotCliPaths(engine).home;
  if (!fs.statSync(home, { throwIfNoEntry: false })?.isDirectory()) return 'Copilot\'s clean home for the build engine isn\'t there, so no Copilot step can start';
  let guards = null;
  try { guards = JSON.parse(fs.readFileSync(hookFile({ home }), 'utf8')); } catch { /* read as missing */ }
  if (JSON.stringify(guards) !== JSON.stringify(registration({ node, root, platform }))) return 'Wheelhouse\'s guards aren\'t registered in Copilot\'s clean home as they should be, so no Copilot step can start';
  try {
    signInOf(home);
  } catch {
    return 'Copilot isn\'t signed in in its clean home, so no Copilot step can start';
  }
  return null;
}
