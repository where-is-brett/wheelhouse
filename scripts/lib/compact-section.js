// scripts/lib/compact-section.js
// Wheelhouse's own "Compact instructions" section of a project's CLAUDE.md: its wording, its earlier wordings and the edits that
// bring a file to the current one. It imports nothing that writes settings, so the bridge and the helper can both read it.
import crypto from 'node:crypto';

export const COMPACT_HEADING = '## Compact instructions';
// What the summary of a compaction keeps (design section 10). The session start after a
// compaction reloads Wheelhouse's own records, so these are what only the conversation holds.
export const COMPACT_SECTION = `${COMPACT_HEADING}

When this conversation is summarised, keep:
- what the director asked for and decided, in their own words where they gave them;
- the work in hand: the step being done, what is finished and what is not;
- each card shown to the director, and whether it was answered;
- whether All stop is on;
- the pull requests and branches in play, by number and name;
- the ids of the cards, runs and goal pieces in play;
- the session note's path, if one was written.

Leave out file contents and command output that can be read again. Wheelhouse's records hold the rulebook, the levels, the waiting list and the status, and the session start after a compaction gives them back.
`;
// The section's earlier wordings, by the hash of their text (SHA-256, trimmed, line ends as \n). A project whose
// section still matches one exactly is brought up to COMPACT_SECTION; an edited section is left as the director has it.
export const EARLIER_COMPACT_HASHES = Object.freeze([
  '262378b54935486b0e2f24f9a918d44828968d95b292865301353b1c4c1bc800',
  '8a1fbab63343f98a17e20d403038890133a4aa1f432c78d337ad8bb3fbaa7119',
]);
export const sectionHash = (text) => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex');
// The section in a file: from its heading to the next heading or the end.
function sectionIn(text) {
  const lines = text.split(/(?<=\n)/);
  const start = lines.findIndex((l) => /^##?\s*Compact instructions\s*$/i.test(l.replace(/\r?\n$/, '')));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { before: lines.slice(0, start).join(''), body: lines.slice(start, end).join(''), after: lines.slice(end).join('') };
}
// The file's text with an earlier wording of the section swapped for the current one; null when there is none to swap.
export function withCurrentSection(text) {
  if (text === null) return null;
  const found = sectionIn(text);
  if (found === null || !EARLIER_COMPACT_HASHES.includes(sectionHash(found.body))) return null;
  return `${found.before}${COMPACT_SECTION}${found.after === '' ? '' : `\n${found.after}`}`;
}

export const withSection = (text) => {
  if (text === null || text === '') return COMPACT_SECTION;
  return `${text}${text.endsWith('\n') ? '' : '\n'}\n${COMPACT_SECTION}`;
};
export const hasSection = (text) => text !== null && /^##?\s*Compact instructions\s*$/im.test(text);
// What a CLAUDE.md holds once Wheelhouse has written its own section into `text`: the section brought to the current wording,
// or added where there is none. A section the director has edited is left as it is, so it comes back unchanged.
export const withOwnSection = (text) => (hasSection(text) ? (withCurrentSection(text) ?? text) : withSection(text));

