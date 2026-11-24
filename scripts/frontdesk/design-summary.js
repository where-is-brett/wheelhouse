// scripts/frontdesk/design-summary.js
// The summary at the top of a feature's design: a `## Summary` section of at most 200 words, in plain words, which the
// First Mate posts as its own chat message above the approval card. The rest of the design is for the builders.
import path from 'node:path';

export const SUMMARY_WORDS = 200;

// The `## Summary` section of `text`, heading included, up to the next `## ` heading or Wheelhouse block; null when there is none.
export function summarySection(text) {
  const lines = String(text).replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((l) => /^## Summary\s*$/.test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^(## |```wheelhouse-)/.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join('\n').trim();
}

// The section's words, not counting its heading.
export const summaryWords = (section) => section.split('\n').slice(1).join(' ').split(/\s+/).filter((w) => w !== '').length;

// The section if it is there, has words and is within the limit; otherwise a sentence saying what to fix.
export function checkSummary(text, file) {
  const section = summarySection(text);
  if (section === null || summaryWords(section) === 0) return { problem: `A feature's design starts with a \`## Summary\` section: at most ${SUMMARY_WORDS} words, in plain words, under What you get, What it won't do, How you'll see it and Calls I made for you. Add it to ${file}, then record it again` };
  const words = summaryWords(section);
  if (words > SUMMARY_WORDS) return { problem: `The \`## Summary\` in ${file} runs to ${words} words; keep it to ${SUMMARY_WORDS} or fewer, then record it again` };
  return { section };
}

// What `record work` and `show` print: the section word for word, then the link to the whole design.
export function summaryText(section, file) {
  const link = file.split(path.sep).join('/');
  return `${section}\n\nThe whole design: [${path.posix.basename(link)}](${link})`;
}
