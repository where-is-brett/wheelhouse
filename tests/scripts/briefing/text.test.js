// tests/scripts/briefing/text.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingText, briefingParts } from '../../../scripts/briefing/text.js';
import { briefingModel } from '../../../scripts/briefing/model.js';
import { boardModel } from '../../../scripts/board/model.js';
import { BRIEFING_WORDS } from '../../../scripts/lib/core-numbers.js';
import { verdict } from '../../../scripts/lib/calm-words.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const empty = { first: [], waiting: [], changed: [], progress: [], watch: [], usage: null, raise: [], weekly: 0 };

test('the briefing opens with the verdict, then Since 09:10, about 5 hours', () => {
  const text = briefingText({
    ...empty,
    verdict: 'Two things need you. Nothing is broken.',
    since: 'Since 09:10, about 5 hours',
    waiting: [{ title: 'Choose the sign-up colour' }, { title: 'Approve the plan' }],
  });
  const blocks = text.split('\n\n');
  assert.equal(blocks[0], 'Two things need you. Nothing is broken.');
  assert.equal(blocks[1], 'Since 09:10, about 5 hours');
  assert.match(blocks[2], /^Waiting on you:\n1\. Choose the sign-up colour\n2\. Approve the plan$/);
  // Without a last briefing there is no since line; a briefing with no verdict of its own works one out from what waits.
  assert.equal(briefingText({ ...empty, verdict: 'Nothing needs you. Nothing is broken.' }).split('\n\n')[0], 'Nothing needs you. Nothing is broken.');
  assert.equal(briefingText({ ...empty, waiting: ['One'] }).split('\n\n')[0], 'One thing needs you. Nothing is broken.');
});

test('the parts come in the design\'s order, with unconfirmed changes first, and the foot last', () => {
  const text = briefingText({
    ...empty,
    verdict: 'One thing needs you. Nothing is broken.',
    first: ['A ruling: Never email on Sundays'],
    waiting: [{ title: 'Choose the sign-up colour' }],
    changed: ['Sign-up works on phones'],
    progress: ['1 pull request merged'],
    watch: ['2 records couldn\'t be read'],
    usage: 'Usage this week: 1.2M tokens.',
  }, { words: BRIEFING_WORDS.standard });
  assert.equal(text, [
    'One thing needs you. Nothing is broken.',
    '',
    'Not in effect until you confirm:',
    '- A ruling: Never email on Sundays',
    '',
    'Waiting on you:',
    '1. Choose the sign-up colour',
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
    '',
    'Ask me anything. For the full board, type /wheelhouse:board.',
  ].join('\n'));
  // Entries are plain lines, whatever they were written as.
  const plain = briefingText({ ...empty, waiting: ['[Pick](https://x.test) a\n## colour'], usage: 'Usage this week: 950 tokens.' });
  assert.match(plain, /^1\. Pick a colour$/m);
  // Usage on track says so after the figures.
  assert.match(briefingText({ ...empty, usage: 'Usage this week: 950 tokens.', onTrack: true }), /^Usage this week: 950 tokens\. On track\.$/m);
});

test('waiting items are numbered with their recommendation, an optional one with its time', () => {
  const text = briefingText({
    ...empty,
    waiting: [
      { title: 'Approve the sign-in page', line: 'It changes what users see.', recommendation: 'Approve, because the checks passed.' },
      { title: 'Which photo goes on the home page?', line: 'It sets the first thing visitors see.', recommendation: 'The cafe photo, because it is yours.', optional: 3 },
      { title: 'A card with only a title' },
    ],
  });
  assert.deepEqual(text.split('\n\n')[1].split('\n'), [
    'Waiting on you:',
    '1. Approve the sign-in page  ',
    '   It changes what users see.  ',
    '   I recommend Approve, because the checks passed.',
    '2. Which photo goes on the home page? · optional · 3 min  ',
    '   It sets the first thing visitors see.  ',
    '   I recommend The cafe photo, because it is yours.',
    '3. A card with only a title',
  ]);
  // A tenth entry still has its later lines under its first.
  const ten = briefingText({ ...empty, waiting: Array.from({ length: 10 }, (_, i) => ({ title: `Card ${i + 1}`, recommendation: 'Approve, because it is fine.' })) }, { words: 1000 });
  assert.match(ten, /^10\. Card 10 {2}\n {4}I recommend Approve, because it is fine\.$/m);
});

test('+2 marks the parts with something new since the last briefing', () => {
  const text = briefingText({
    ...empty, waiting: ['One', 'Two', 'Three'], changed: ['A', 'B'], progress: ['Building C'], plus: { waiting: 2, changed: 1 },
  });
  assert.match(text, /^Waiting on you \(\+2\):$/m);
  assert.match(text, /^Changed for users \(\+1\):$/m);
  assert.match(text, /^Progress:$/m);
  // Nothing new is no mark.
  assert.match(briefingText({ ...empty, waiting: ['One'], plus: { waiting: 0, changed: 0 } }), /^Waiting on you:$/m);
});

test('an empty part folds into one line, never a heading saying None', () => {
  const text = briefingText({ ...empty, waiting: ['One'], progress: ['Building Search'] });
  assert.equal(text.split('\n\n')[3], '*Nothing changed for users, nothing to watch.*');
  assert.doesNotMatch(text, /Changed for users:|To watch:|\bNone\b/);
  // Everything empty folds all three, and nothing waits.
  const none = briefingText(empty);
  assert.equal(none, 'Nothing needs you. Nothing is broken.\n\n*Nothing changed for users, nothing in progress, nothing to watch.*\n\nAsk me anything. For the full board, type /wheelhouse:board.');
  // With changes to confirm, they are the one part shown; the empty ones still fold.
  const first = briefingText({ ...empty, first: ['A level: copy 2'] });
  assert.match(first, /^Not in effect until you confirm:\n- A level: copy 2$/m);
  assert.doesNotMatch(first, /None/);
});

test('no section label is in capitals', () => {
  const text = briefingText({
    ...empty, first: ['a'], waiting: ['b'], changed: ['c'], progress: ['d'], watch: ['e'], plus: { waiting: 1, changed: 1 },
  });
  const labels = text.split('\n').filter((line) => /^[A-Z][^.]*:$/.test(line) || /^[A-Z][a-z ]+ \(\+\d+\):$/.test(line));
  assert.equal(labels.length, 5);
  for (const label of labels) {
    assert.notEqual(label, label.toUpperCase(), label);
    assert.match(label, /^[A-Z][a-z]/, label);
    assert.doesNotMatch(label.slice(1), /[A-Z]/, label);
  }
});

test('each length keeps within its words, cutting from the end of each part with and N more', () => {
  const many = (what, n) => Array.from({ length: n }, (_, i) => `${what} number ${i + 1} with a few more words`);
  const briefing = {
    ...empty,
    first: many('Unconfirmed setting', 2),
    waiting: many('Question', 10),
    changed: many('Change', 10),
    progress: many('Step', 10),
    watch: many('Warning', 10),
    usage: 'Usage this week: 1.2M tokens, about $84 at API prices, 34% of your weekly allowance.',
  };
  const shownBy = {};
  for (const [name, words] of Object.entries(BRIEFING_WORDS)) {
    const text = briefingText(briefing, { words });
    assert.ok(wordCount(text) <= words, `${name}: ${wordCount(text)} words`);
    const lines = text.split('\n');
    assert.equal(lines[0], '10 things need you. Nothing is broken.');
    assert.equal(lines.at(-1), 'Ask me anything. For the full board, type /wheelhouse:board.');
    assert.equal(lines.at(-3), briefing.usage);
    // Each part keeps its first entries, in order, and says how many more there are.
    for (const [heading, what] of [['Waiting on you:', 'Question'], ['Changed for users:', 'Change'], ['Progress:', 'Step'], ['To watch:', 'Warning']]) {
      const start = lines.indexOf(heading);
      assert.ok(start >= 0, `${name}: ${heading}`);
      const end = lines.indexOf('', start);
      const body = lines.slice(start + 1, end);
      const shown = body.filter((line) => !line.startsWith('and '));
      shown.forEach((line, i) => assert.ok(line.endsWith(`${what} number ${i + 1} with a few more words`), line));
      assert.deepEqual(body.slice(shown.length), [`and ${10 - shown.length} more`]);
      shownBy[name] = (shownBy[name] ?? 0) + shown.length;
    }
  }
  assert.ok(shownBy.short < shownBy.standard && shownBy.standard < shownBy.detailed);

  // A briefing that fits is shown whole.
  const small = { ...empty, waiting: ['One question'], watch: ['One warning'] };
  assert.equal(briefingText(small, { words: BRIEFING_WORDS.short }), [
    'One thing needs you. Nothing is broken.', '', 'Waiting on you:', '1. One question', '', 'To watch:', '- One warning', '',
    '*Nothing changed for users, nothing in progress.*', '', 'Ask me anything. For the full board, type /wheelhouse:board.',
  ].join('\n'));
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
  assert.deepEqual(briefingParts('x'), { text: briefingText(empty), shownWatch: 0 });
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
    assert.equal(/Nothing needs you/.test(text), false, `${words}: ${text}`);
  }
  // The usage line alone too long is left out; the cut parts still show.
  assert.equal(briefingText(briefing, { words: BRIEFING_WORDS.short }), [
    'One thing needs you. Nothing is broken.', '', 'Waiting on you:', 'and 1 more', '', 'To watch:', 'and 1 more', '',
    'Ask me anything. For the full board, type /wheelhouse:board.',
  ].join('\n'));
  // A usage line that fits stays, with the parts cut to make room for it.
  const standard = briefingParts(briefing, { words: BRIEFING_WORDS.standard });
  assert.match(standard.text, /^One thing needs you\. Nothing is broken\.\n\nWaiting on you:\nand 1 more\n\nTo watch:\nand 1 more\n\nUsage this week: (a )+a?…\n\nAsk me anything\./);
  assert.equal(standard.shownWatch, 0);
  // A limit too small for even the headings sends the director to the board.
  assert.equal(briefingText(briefing, { words: 5 }), 'Ask for the board.');
  // With room for the verdict alone, that is what is shown.
  assert.equal(briefingText(briefing, { words: 7 }), 'One thing needs you. Nothing is broken.');
});

test('with no state, usage or sources it still says nothing needs you', () => {
  const model = boardModel({ now: () => NOW });
  const briefing = briefingModel({ model, usage: null, sources: null, since: null, now: NOW, wasRaised: () => false });
  assert.deepEqual(briefing, { ...empty, verdict: 'Nothing needs you. Nothing is broken.', since: '', onTrack: false, plus: { waiting: 0, changed: 0 } });
  const text = briefingText(briefing, { words: BRIEFING_WORDS.short });
  assert.equal(text.split('\n\n')[0], 'Nothing needs you. Nothing is broken.');
  for (const odd of [undefined, null, 'x', { waiting: 'x', usage: 7 }]) assert.equal(briefingText(odd).split('\n\n')[0], 'Nothing needs you. Nothing is broken.');
});

test('the verdict is the same sentence the pane shows', () => {
  const waiting = [{ n: 1, what: 'A', since: null }, { n: 2, what: 'B', since: null }, { n: 3, what: 'C', since: null }];
  const model = boardModel({ now: () => NOW });
  model.director.waiting = waiting;
  model.director.health = [{ level: 'stop', text: 'Incident i1 is open, so nothing merges: x', incident: 'i1' }];
  const briefing = briefingModel({ model, usage: null, sources: null, since: null, now: NOW, wasRaised: () => false });
  assert.equal(briefing.verdict, verdict({ waiting: 3, broken: 1 }));
  assert.equal(briefingText(briefing).split('\n\n')[0], 'Three things need you. One thing is broken.');
});

test('the briefing keeps to its length at each setting, whatever opens it', () => {
  const briefing = {
    ...empty,
    verdict: '12 things need you. 3 things are broken.',
    since: 'Since 09:10, about 5 hours',
    waiting: Array.from({ length: 12 }, (_, i) => ({ title: `Question ${i + 1} about the sign-up page`, line: 'It changes what users see.', recommendation: 'Approve, because it is fine.', optional: 2 })),
    plus: { waiting: 4, changed: 0 },
    usage: 'Usage this week: 1.2M tokens, about $84 at API prices, 34% of your weekly allowance.',
    onTrack: true,
  };
  for (const [name, words] of Object.entries(BRIEFING_WORDS)) {
    const text = briefingText(briefing, { words });
    assert.ok(wordCount(text) <= words, `${name}: ${wordCount(text)} words`);
    assert.equal(text.split('\n\n')[0], '12 things need you. 3 things are broken.');
    assert.match(text, /^Waiting on you \(\+4\):$/m);
  }
});
