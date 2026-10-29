// scripts/engine/fix-main.js
// A red main line (Archon design, section 7.7): the merge queue holds merges while the default branch's checks are
// red, and asks only to hold. The card router answers that itself (level 1); answering it opens a red-main incident,
// which holds all other work. The dispatcher starts one fix-main run for the incident, and the fix merges through the
// helper's own gate (Archon's gate refuses any merge onto a red default branch, the fix's too). The incident ends once
// the main line's checks are green again. These are the rules for that, with no engine or host in them.
import crypto from 'node:crypto';

export const RED_MAIN = 'red-main';
export const FIX_LANE = 'fix-main';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The pull request a merge queue's words name as the suspect ("PR 41", "#41", "pull request 41"), or null.
export function suspectOf(text) {
  if (typeof text !== 'string') return null;
  const found = /(?:#|\bPR\s*#?|\bpull request\s*#?)(\d+)\b/i.exec(text);
  const n = found ? Number(found[1]) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// The incident a red main line's ask opens: its id comes from the ask's, so the same ask seen again is the same
// incident. { id, what, kind, suspect, work }.
export function redMainIncident(ask) {
  const id = `${RED_MAIN}-${crypto.createHash('sha256').update(String(ask?.id)).digest('hex').slice(0, 10)}`;
  const suspect = Number.isInteger(ask?.suspect) && ask.suspect >= 1 ? ask.suspect : null;
  return {
    id,
    what: suspect ? `The main line's checks are red, it seems since pull request #${suspect}.` : 'The main line\'s checks are red.',
    kind: RED_MAIN,
    suspect,
    work: `${FIX_LANE}-${id}`,
  };
}

// The open red-main incident in the views, or null.
export function openRedMain(views) {
  const open = views?.incidents?.open;
  return Array.isArray(open) ? open.find((i) => isPlain(i) && i.kind === RED_MAIN) ?? null : null;
}
