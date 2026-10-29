// scripts/engine/archon/copilot-skills.js
// The Copilot form of the pack's skills (Archon design, section 7.1; ruling 3 of part 3b). A Claude step names a
// skill with the plugin's prefix (wheelhouse:tdd) and loads it from the plugin; Copilot loads no plugins, so a Copilot
// step reads the same copy by its plain name from the worktree's .agents/skills/. This is the stub the pack's build
// will call once Copilot steps exist: it writes the copies a step names into a worktree.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_PREFIX } from '../pack-check.js';
import { SKILL_COPIES } from '../../lineage/copies.js';

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills');

// The plain name of a Claude step's skill.
export function plainSkillName(name) {
  if (typeof name !== 'string' || !name.startsWith(SKILL_PREFIX)) throw new Error(`${name} isn't one of Wheelhouse's skills`);
  return name.slice(SKILL_PREFIX.length);
}

// Writes the copies `skills` names (in the Claude form) into `worktree`/.agents/skills/, each folder whole, and gives
// their plain names.
export function writeStepSkills({ worktree, skills = [], copies = SKILL_COPIES, from = SKILLS }) {
  const names = skills.map(plainSkillName);
  for (const name of names) if (!copies.includes(name)) throw new Error(`The skill ${name} matches no copy in the plugin`);
  for (const name of names) fs.cpSync(path.join(from, name), path.join(worktree, '.agents', 'skills', name), { recursive: true });
  return names;
}
