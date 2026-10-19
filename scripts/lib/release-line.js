// scripts/lib/release-line.js
// The briefing's line for a Wheelhouse release the gate merged without the director's approval
// (rulings R148, F73). It is kept apart from scripts/lineage/release.js so the hooks that show it
// load nothing more, and it is shown as written: its words are the ruling's, not the glossary's.
const BEFORE = 'Wheelhouse ';
const AFTER = ' was merged with a review and without your approval: it only moves the pinned kits, and its checks passed.';

export const briefingLine = (ref) => `${BEFORE}${ref}${AFTER}`;

// Whether `text` is briefingLine's line, for any one-word tag.
export function isBriefingLine(text) {
  if (typeof text !== 'string' || !text.startsWith(BEFORE) || !text.endsWith(AFTER)) return false;
  return /^\S+$/.test(text.slice(BEFORE.length, text.length - AFTER.length));
}
