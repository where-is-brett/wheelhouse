// scripts/decisions/visibility.js
// Whether the project's repository is public, as the helper last read it from the host (the adapter's isPublic), kept at
// projects/<project>/visibility.json as { public, at }. A decision message offers "private" only where the project is public
// (design section 6.6), and a hook has no helper to ask, so the answer is kept where hooks can read it.
//
// Where it isn't known yet, the decision is treated as one on a public project: the director is offered "private", which costs
// a line of text, where leaving it out could put a decision into a public repository without asking.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';

const file = (project) => path.join(stateDir(project), '..', 'visibility.json');

// true or false as last kept, or null when none is kept or it can't be read.
export function readPublic(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(file(project), 'utf8'));
    return typeof kept?.public === 'boolean' ? kept.public : null;
  } catch {
    return null;
  }
}

// Whether a decision on the project is offered "private": any project but one known to be private.
export const canPrivate = (project) => readPublic(project) !== false;

export function writePublic(project, isPublic, { now = () => new Date() } = {}) {
  if (typeof isPublic !== 'boolean') throw new Error('Whether the project is public must be true or false');
  const target = file(project);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ public: isPublic, at: now().toISOString() })}\n`);
  fs.renameSync(temp, target);
}

// When the kept answer was read, as a time in milliseconds, or null.
export function readAt(project) {
  try {
    const at = Date.parse(JSON.parse(fs.readFileSync(file(project), 'utf8'))?.at);
    return Number.isNaN(at) ? null : at;
  } catch {
    return null;
  }
}
