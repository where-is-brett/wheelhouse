// tests/scripts/decisions/record-file.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordFile, slugOf } from '../../../scripts/decisions/record-file.js';

const decision = {
  question: 'How often should the digest go out?',
  work: 'w-tide-1',
  options: [
    { label: 'Daily', says: 'One email each morning', cost: 'About a day of work', undo: 'Can be undone' },
    { label: 'Weekly', says: 'One email each Monday', cost: 'About a day of work', undo: 'Can be undone' },
    { label: 'Monthly', says: 'One email a month' },
  ],
  recommend: 'Weekly',
};
const at = new Date(2026, 10, 7, 14, 30);

test('the record file has the set format with the path comment', () => {
  const file = recordFile(decision, { at, option: 'Weekly', words: '' });
  assert.equal(file.path, 'docs/decisions/2026-11-07-how-often-should-the-digest-go-out.md');
  assert.equal(file.text, [
    '<!-- docs/decisions/2026-11-07-how-often-should-the-digest-go-out.md -->',
    '# How often should the digest go out?',
    '',
    '- **Date:** 7 November 2026',
    '- **Piece:** w-tide-1',
    '- **Options:** A. One email each morning (About a day of work; Can be undone) · B. One email each Monday (About a day of work; Can be undone) · C. One email a month',
    '- **Recommended:** Weekly',
    '- **Chosen:** Weekly',
    '- **The director\'s words:** none',
    '',
  ].join('\n'));
});

test('the director\'s own words are quoted and a decision with no piece says none', () => {
  const file = recordFile({ ...decision, work: null }, { at, option: '', words: 'weekly, but not on a Monday' });
  assert.match(file.text, /- \*\*Piece:\*\* none\n/);
  assert.match(file.text, /- \*\*Chosen:\*\* own words\n/);
  assert.match(file.text, /- \*\*The director's words:\*\* "weekly, but not on a Monday"\n/);
});

test('the slug comes from the question, at most 50 characters, with no hyphen at either end', () => {
  const slug = slugOf('Should the whole harbour dashboard load its tide tables from the cache or from the live service every time?');
  assert.ok(slug.length <= 50);
  assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(slugOf('  ??  '), 'decision');
});

test('two decisions with the same question on one day get -2', () => {
  const first = recordFile(decision, { at, option: 'Weekly', words: '' });
  const second = recordFile(decision, { at, option: 'Daily', words: '' }, { taken: [first.path] });
  const third = recordFile(decision, { at, option: 'Daily', words: '' }, { taken: new Set([first.path, second.path]) });
  assert.equal(second.path, 'docs/decisions/2026-11-07-how-often-should-the-digest-go-out-2.md');
  assert.equal(third.path, 'docs/decisions/2026-11-07-how-often-should-the-digest-go-out-3.md');
  assert.ok(second.text.startsWith(`<!-- ${second.path} -->\n`));
  // The same question on another day does not collide.
  const next = recordFile(decision, { at: new Date(2026, 10, 8, 9), option: 'Weekly', words: '' }, { taken: [first.path] });
  assert.equal(next.path, 'docs/decisions/2026-11-08-how-often-should-the-digest-go-out.md');
});
