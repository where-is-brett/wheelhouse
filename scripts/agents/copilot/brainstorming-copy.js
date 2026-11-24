// scripts/agents/copilot/brainstorming-copy.js
// Superpowers' brainstorming skill for the First Mate in Copilot's chat. Superpowers ships a plugin for Copilot's CLI, not
// for VS Code's chat, where the First Mate runs; but that chat reads Agent Skills from the person's own Copilot skills folder,
// and brainstorming is a plain skill folder. So setup copies Wheelhouse's kept copy of it (kits.js: fetched at the pinned
// commit and checked against lineage/manifest.json's hash) to `<Copilot home>/skills/wheelhouse-brainstorming/`, once that
// check passes. Only two things change in the copy, both in SKILL.md's front matter: `name` becomes the folder's name, which
// VS Code needs to match, and the description begins "In a Wheelhouse project only:", since the folder is offered in every
// workspace. Every other word and file is upstream's, as kept.
import fs from 'node:fs';
import path from 'node:path';
import { kitSkills, ensureKits } from './kits.js';
import { BRAINSTORMING_SKILL } from './first-mate.js';

export const UPSTREAM_SKILL = 'brainstorming';
export const DESCRIPTION_LEAD = 'In a Wheelhouse project only: ';

// SKILL.md's text with its front matter's `name` and `description` changed as above; throws when it has no front matter or either line.
export function renameBrainstorming(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (m === null) throw new Error('The brainstorming skill has no front matter to rename');
  let named = false;
  let described = false;
  const lines = m[1].split('\n').map((line) => {
    if (/^name:/.test(line)) { named = true; return `name: ${BRAINSTORMING_SKILL}`; }
    const d = /^description:\s*(.*)$/.exec(line);
    if (d === null) return line;
    described = true;
    const raw = d[1].trim();
    const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
    return `description: ${JSON.stringify(`${DESCRIPTION_LEAD}${value}`)}`;
  });
  if (!named || !described) throw new Error('The brainstorming skill\'s front matter has no name or no description');
  return `---\n${lines.join('\n')}\n---\n${text.slice(m[0].length)}`;
}

function filesUnder(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}

// The copy's files, each `{ rel, content }` (the path under the skill's folder, with "/" separators, and its text), made from
// the kept brainstorming folder once every kept folder matches the manifest. Throws, with the lineage hold's record, when one
// doesn't (kitSkills), so a kit that differs is never copied; and gives none when the manifest holds no such skill.
export function brainstormingFiles({ manifest, now } = {}) {
  const skill = kitSkills({ ...(manifest === undefined ? {} : { manifest }), ...(now === undefined ? {} : { now }) }).find((s) => s.name === UPSTREAM_SKILL);
  if (skill === undefined) return [];
  return filesUnder(skill.dir).map((rel) => {
    const text = fs.readFileSync(path.join(skill.dir, ...rel.split('/')), 'utf8').replaceAll('\r\n', '\n');
    return { rel, content: rel === 'SKILL.md' ? renameBrainstorming(text) : text };
  });
}

// What setup plans: the files, or none (and no throw) where the kept copy isn't there or doesn't match, so the First Mate is
// set up without it and the next setup or update tries again.
export function plannedBrainstorming(options) {
  try {
    return brainstormingFiles(options);
  } catch {
    return [];
  }
}

// Fetches the kits that aren't kept yet, as a Copilot session's start does. A fetch that fails, or a kit that differs, leaves
// the copy to the next try.
export async function keepBrainstormingKit(kits) {
  try {
    await ensureKits(kits);
  } catch { /* plannedBrainstorming gives none */ }
}
