// tests/scripts/frontdesk/design-summary.test.js
// A feature design's `## Summary`: found, counted, checked, and printed with the link to the whole design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSummary, summarySection, summaryText, summaryWords, SUMMARY_WORDS } from '../../../scripts/frontdesk/design-summary.js';

const design = (body) => `# Export\n\n## Summary\n\n${body}\n\n## How it works\n\nFor the builders.\n`;

test('the section runs from its heading to the next ## heading, and no further', () => {
  const text = design('**What you get:** a spreadsheet.');
  assert.equal(summarySection(text), '## Summary\n\n**What you get:** a spreadsheet.');
  assert.equal(summarySection('# Export\n\nNo summary here.\n'), null);
  assert.equal(summarySection('## Summary\r\n\r\nWords.\r\n'), '## Summary\n\nWords.');
});

test('a summary at the limit is accepted, over it is refused, and an empty or missing one is refused', () => {
  const words = (n) => Array.from({ length: n }, () => 'word').join(' ');
  assert.equal(summaryWords(summarySection(design(words(SUMMARY_WORDS)))), SUMMARY_WORDS);
  assert.ok(checkSummary(design(words(SUMMARY_WORDS)), 'd.md').section);
  assert.match(checkSummary(design(words(SUMMARY_WORDS + 1)), 'd.md').problem, /201 words; keep it to 200/);
  assert.match(checkSummary('# Export\n', 'd.md').problem, /starts with a `## Summary` section/);
  assert.match(checkSummary(design(''), 'd.md').problem, /starts with a `## Summary` section/);
});

test('the printed text is the section, then the link to the design file', () => {
  assert.equal(summaryText('## Summary\n\nWords.', '.wheelhouse/work/export-csv.md'), '## Summary\n\nWords.\n\nThe whole design: [export-csv.md](.wheelhouse/work/export-csv.md)');
});
