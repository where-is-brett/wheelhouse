// tests/scripts/briefing/text.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingText } from '../../../scripts/briefing/text.js';
import { briefingModel } from '../../../scripts/briefing/model.js';
import { boardModel } from '../../../scripts/board/model.js';
import { BRIEFING_WORDS } from '../../../scripts/lib/core-numbers.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const empty = { first: [], waiting: [], changed: [], progress: [], watch: [], usage: null, raise: [] };

test('the parts come in the design\'s order, with unconfirmed changes first', () => {
  const text = briefingText({
    first: ['A ruling: Never email on Sundays, not yet confirmed by you'],
    waiting: ['Choose the sign-up colour', 'Approve the plan'],
    changed: ['Sign-up works on phones'],
    progress: ['1 pull request merged'],
    watch: ['2 records couldn\'t be read'],
    usage: 'Usage this week: 1.2M tokens.',
    raise: [],
  }, { words: BRIEFING_WORDS.standard });
  assert.equal(text, [
    'Not in effect until you confirm:',
    '- A ruling: Never email on Sundays, not yet confirmed by you',
    '',
    'Waiting on you:',
    '1. Choose the sign-up colour',
    '2. Approve the plan',
    '',
    'Changed for users:',
    '- Sign-up works on phones',
    '',
    'Progress:',
    '- 1 pull request merged',
    '',
    'To watch:',
    '- 2 records couldn\'t be read',
    '',
    'Usage this week: 1.2M tokens.',
  ].join('\n'));
  // Parts with nothing in them are left out; the words come from the briefing as plain lines.
  assert.equal(briefingText({ ...empty, waiting: ['[Pick](https://x.test) a\n## colour'], usage: 'Usage this week: 950 tokens.' }),
    'Waiting on you:\n1. Pick a colour\n\nUsage this week: 950 tokens.');
});

test('nothing waiting says so in one line', () => {
  assert.equal(briefingText(empty), 'Nothing needs you.');
  const text = briefingText({ ...empty, progress: ['Building Search'], usage: 'Usage this week: 34% of your weekly allowance.' });
  assert.equal(text, 'Nothing needs you.\n\nProgress:\n- Building Search\n\nUsage this week: 34% of your weekly allowance.');
  // With changes to confirm, they need the director, so the line says nothing else does.
  assert.equal(briefingText({ ...empty, first: ['A level: copy 2, not yet confirmed by you'] }),
    'Not in effect until you confirm:\n- A level: copy 2, not yet confirmed by you\n\nNothing else needs you.');
});

test('each length keeps within its words, cutting from the end of each part with and N more', () => {
  const many = (what, n) => Array.from({ length: n }, (_, i) => `${what} number ${i + 1} with a few more words`);
  const briefing = {
    first: many('Unconfirmed setting', 2),
    waiting: many('Question', 10),
    changed: many('Change', 10),
    progress: many('Step', 10),
    watch: many('Warning', 10),
    usage: 'Usage this week: 1.2M tokens, about $84 at API prices, 34% of your weekly allowance.',
    raise: [],
  };
  const shownBy = {};
  for (const [name, words] of Object.entries(BRIEFING_WORDS)) {
    const text = briefingText(briefing, { words });
    assert.ok(wordCount(text) <= words, `${name}: ${wordCount(text)} words`);
    const lines = text.split('\n');
    assert.equal(lines[0], 'Not in effect until you confirm:');
    assert.equal(lines.at(-1), briefing.usage);
    // Each part keeps its first entries, in order, and says how many more there are.
    for (const [heading, what, numbered] of [['Waiting on you:', 'Question', true], ['Changed for users:', 'Change'], ['Progress:', 'Step'], ['To watch:', 'Warning']]) {
      const start = lines.indexOf(heading);
      assert.ok(start >= 0, `${name}: ${heading}`);
      const end = lines.indexOf('', start);
      const body = lines.slice(start + 1, end);
      const shown = body.filter((line) => !line.startsWith('and '));
      shown.forEach((line, i) => assert.equal(line, `${numbered ? `${i + 1}.` : '-'} ${what} number ${i + 1} with a few more words`));
      assert.deepEqual(body.slice(shown.length), [`and ${10 - shown.length} more`]);
      shownBy[name] = (shownBy[name] ?? 0) + shown.length;
    }
  }
  assert.ok(shownBy.short < shownBy.standard && shownBy.standard < shownBy.detailed);

  // A briefing that fits is shown whole.
  const small = { ...empty, waiting: ['One question'], watch: ['One warning'] };
  assert.equal(briefingText(small, { words: BRIEFING_WORDS.short }), 'Waiting on you:\n1. One question\n\nTo watch:\n- One warning');
  // A length that can't be read is the standard one.
  assert.equal(briefingText(briefing, { words: 'long' }), briefingText(briefing, { words: BRIEFING_WORDS.standard }));
  assert.equal(briefingText(briefing), briefingText(briefing, { words: BRIEFING_WORDS.standard }));
});

test('with no state, usage or sources it still says nothing needs you', () => {
  const model = boardModel({ now: () => NOW });
  const briefing = briefingModel({ model, usage: null, sources: null, since: null, now: NOW, wasRaised: () => false });
  assert.deepEqual(briefing, empty);
  assert.equal(briefingText(briefing, { words: BRIEFING_WORDS.short }), 'Nothing needs you.');
  for (const odd of [undefined, null, 'x', { waiting: 'x', usage: 7 }]) assert.equal(briefingText(odd), 'Nothing needs you.');
});
