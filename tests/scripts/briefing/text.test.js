// tests/scripts/briefing/text.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingText, briefingParts } from '../../../scripts/briefing/text.js';
import { briefingModel } from '../../../scripts/briefing/model.js';
import { boardModel } from '../../../scripts/board/model.js';
import { BRIEFING_WORDS } from '../../../scripts/lib/core-numbers.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const empty = { first: [], waiting: [], changed: [], progress: [], watch: [], usage: null, raise: [] };

test('the parts come in the design\'s order, with unconfirmed changes first', () => {
  const text = briefingText({
    first: ['A ruling: Never email on Sundays'],
    waiting: ['Choose the sign-up colour', 'Approve the plan'],
    changed: ['Sign-up works on phones'],
    progress: ['1 pull request merged'],
    watch: ['2 records couldn\'t be read'],
    usage: 'Usage this week: 1.2M tokens.',
    raise: [],
  }, { words: BRIEFING_WORDS.standard });
  assert.equal(text, [
    'Not in effect until you confirm:',
    '- A ruling: Never email on Sundays',
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
  assert.equal(briefingText({ ...empty, first: ['A level: copy 2'] }),
    'Not in effect until you confirm:\n- A level: copy 2\n\nNothing else needs you.');
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

test('it says how many things to watch it showed, so only unusual use really shown is marked raised', () => {
  const briefing = {
    ...empty,
    waiting: Array.from({ length: 6 }, (_, i) => `Question number ${i + 1} with a few more words in it`),
    watch: ['Unusual one used 1.2M tokens, against a usual 300K', 'Unusual two used $42, against a usual $10', 'Standing health line about the allowance'],
    raise: ['session:a', 'day:b'],
  };
  const whole = briefingParts(briefing, { words: BRIEFING_WORDS.detailed });
  assert.equal(whole.shownWatch, 3);
  assert.equal(whole.text, briefingText(briefing, { words: BRIEFING_WORDS.detailed }));
  for (const words of [20, 30, 40, 50, 60]) {
    const { text, shownWatch } = briefingParts(briefing, { words });
    const shown = briefing.watch.filter((line) => text.includes(`- ${line}`)).length;
    assert.equal(shownWatch, shown, `${words} words`);
    // The unusual items open `watch`, so the ones shown are always the first of `raise`.
    assert.ok(briefing.watch.slice(0, shownWatch).every((line) => text.includes(line)));
    assert.ok(briefing.raise.slice(0, shownWatch).length <= 2);
  }
  assert.equal(briefingParts(briefing, { words: 20 }).shownWatch < 2, true);
  assert.deepEqual(briefingParts('x'), { text: 'Nothing needs you.', shownWatch: 0 });
  assert.equal(briefingText(briefing, null), briefingText(briefing));
});

test('no input passes the word limit, however long its usage line or one entry', () => {
  // Entries and usage are one line each, so at most LINE_CHARS: single letters give the most words.
  const huge = 'a '.repeat(5000);
  const briefing = { ...empty, waiting: [huge], watch: [huge], usage: `Usage this week: ${huge}` };
  for (const words of [...Object.values(BRIEFING_WORDS), 1, 2, 5, 10]) {
    const { text } = briefingParts(briefing, { words });
    assert.ok(wordCount(text) <= words, `${words}: ${wordCount(text)} words`);
    assert.ok(text.length > 0);
    // Something waits, so the text never says nothing does.
    assert.equal(/Nothing/.test(text), false, `${words}: ${text}`);
  }
  // The usage line alone too long is left out; the cut parts still show.
  assert.equal(briefingText(briefing, { words: BRIEFING_WORDS.short }), 'Waiting on you:\nand 1 more\n\nTo watch:\nand 1 more');
  // A usage line that fits stays, with the parts cut to make room for it.
  const standard = briefingParts(briefing, { words: BRIEFING_WORDS.standard });
  assert.match(standard.text, /^Waiting on you:\nand 1 more\n\nTo watch:\nand 1 more\n\nUsage this week: (a )+a?…$/);
  assert.equal(standard.shownWatch, 0);
  // A limit too small for even the headings sends the director to the board.
  assert.equal(briefingText(briefing, { words: 5 }), 'Ask for the board.');
});

test('with no state, usage or sources it still says nothing needs you', () => {
  const model = boardModel({ now: () => NOW });
  const briefing = briefingModel({ model, usage: null, sources: null, since: null, now: NOW, wasRaised: () => false });
  assert.deepEqual(briefing, empty);
  assert.equal(briefingText(briefing, { words: BRIEFING_WORDS.short }), 'Nothing needs you.');
  for (const odd of [undefined, null, 'x', { waiting: 'x', usage: 7 }]) assert.equal(briefingText(odd), 'Nothing needs you.');
});
