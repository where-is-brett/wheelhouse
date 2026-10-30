// scripts/engine/archon/copilot-skills.js
// The Copilot form of the pack's skills (Archon design, section 7.1; ruling 3 of part 3b). A Claude step names a
// skill with the plugin's prefix (wheelhouse:tdd) and loads it from the plugin; Copilot loads no plugins, and Archon
// finds a Copilot step's skills only in the run's worktree or $HOME (check 74), so the first step of the pack's Copilot
// form (copilot-pack.js) writes the copies its workflow names into the worktree's .agents/skills/, by their plain
// names. Each copy keeps itself out of git with a .gitignore of its own, so nothing commits it and no git file the
// director's own checkout shares is touched; a project's own skill of the same name is kept, never written over.
//   node scripts/engine/archon/copilot-skills.js --names <name>,<name>   (in the run's worktree)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_PREFIX } from '../pack-check.js';
import { SKILL_COPIES } from '../../lineage/copies.js';
import { startedAsScript } from '../../lib/started-as-script.js';
import { runArg } from '../done-check.js';

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills');

// The plain name of a Claude step's skill.
export function plainSkillName(name) {
  if (typeof name !== 'string' || !name.startsWith(SKILL_PREFIX)) throw new Error(`${name} isn't one of Wheelhouse's skills`);
  return name.slice(SKILL_PREFIX.length);
}

// Throws when a folder from `worktree` down to `dir` is a link or a file, so nothing is written outside the worktree.
function refuseLinked(worktree, dir) {
  let at = worktree;
  for (const part of path.relative(worktree, dir).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    const stat = fs.lstatSync(at, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${at} is a link or a file, so no skill is written there`);
  }
}

// Writes the copies `names` (plain names) into `worktree`/.agents/skills/, each folder whole and kept out of git.
// A name whose folder is there already is kept as it is. { written, kept }.
export function writeWorktreeSkills({ worktree, names = [], copies = SKILL_COPIES, from = SKILLS }) {
  for (const name of names) if (!copies.includes(name)) throw new Error(`The skill ${name} matches no copy in the plugin`);
  const into = path.join(worktree, '.agents', 'skills');
  refuseLinked(worktree, into);
  const written = [];
  const kept = [];
  for (const name of names) {
    const target = path.join(into, name);
    if (fs.lstatSync(target, { throwIfNoEntry: false }) !== undefined) {
      kept.push(name);
      continue;
    }
    fs.cpSync(path.join(from, name), target, { recursive: true });
    fs.writeFileSync(path.join(target, '.gitignore'), '*\n');
    written.push(name);
  }
  return { written, kept };
}

// Writes the copies `skills` names (in the Claude form) into `worktree`, and gives their plain names.
export function writeStepSkills({ worktree, skills = [], copies = SKILL_COPIES, from = SKILLS }) {
  const names = skills.map(plainSkillName);
  for (const name of names) if (!copies.includes(name)) throw new Error(`The skill ${name} matches no copy in the plugin`);
  writeWorktreeSkills({ worktree, names, copies, from });
  return names;
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const names = runArg(argv, '--names');
  if (!names) {
    out('usage: node scripts/engine/archon/copilot-skills.js --names <name>,<name>');
    return 2;
  }
  try {
    out(JSON.stringify(writeWorktreeSkills({ worktree: cwd, names: names.split(',').filter(Boolean) })));
    return 0;
  } catch (error) {
    out(error.message);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) process.exitCode = main();
