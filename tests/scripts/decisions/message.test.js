// tests/scripts/decisions/message.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionText, blocksIn } from '../../../scripts/decisions/message.js';

const decision = {
  n: 2,
  question: 'How often should the digest go out?',
  work: 'Weekly digest',
  why: 'It changes what customers receive, so it is yours.',
  options: [
    { label: 'Daily', says: 'One email each morning', cost: 'About a day of work', undo: 'Can be changed later' },
    { label: 'Weekly', says: 'One email each Monday', cost: 'About a day of work', undo: 'Can be changed later' },
    { label: 'Monthly', says: 'One email a month' },
  ],
  recommend: 'Weekly',
  because: 'most people ask for one email a week.',
  meanwhile: 'The piece builds the weekly version and keeps it easy to change.',
};

test('the message has the section 6.2 lines in order', () => {
  const lines = decisionText(decision).split('\n');
  assert.equal(lines[0], 'Decision needed (2): How often should the digest go out?   (holds up: Weekly digest)');
  assert.equal(lines[1], 'It changes what customers receive, so it is yours.');
  assert.equal(lines[2], '');
  assert.match(lines[3], /^A\. Daily\. One email each morning\. About a day of work\. Can be changed later\.$/);
  assert.match(lines[4], /^B\. /);
  assert.match(lines[5], /^C\. Monthly\. One email a month\.$/);
  assert.equal(lines[6], 'Recommended because: most people ask for one email a week.');
  assert.equal(lines[7], '');
  assert.equal(lines[8], 'Meanwhile: The piece builds the weekly version and keeps it easy to change.');
  assert.equal(lines[9], 'Reply 2 A, 2 B, 2 C, "why 2", or "2: your own words".');
  assert.equal(lines.length, 10);
});

test('the recommended option carries "(recommended)"', () => {
  const lines = decisionText(decision).split('\n');
  assert.match(lines[4], /^B\. Weekly \(recommended\)\./);
  assert.equal(lines.filter((l) => l.includes('(recommended)')).length, 1);
});

test('an option with no cost or undo prints neither', () => {
  assert.ok(!decisionText(decision).includes('undefined'));
});

test('blocksIn finds each block from its first line to its Reply line', () => {
  const text = `Here is what I need.\n\n${decisionText(decision)}\n\nAnd another thing.`;
  assert.deepEqual(blocksIn(text), [decisionText(decision)]);
  assert.deepEqual(blocksIn('Nothing to decide.'), []);
});

test('blocksIn finds a block wrapped in Markdown, so it is still held to the printed text', () => {
  const printed = decisionText(decision);
  const lines = printed.split('\n');
  const wrapped = {
    bold: [`**${lines[0]}**`, ...lines.slice(1)].join('\n'),
    heading: [`## ${lines[0]}`, ...lines.slice(1)].join('\n'),
    bullet: [`- ${lines[0]}`, ...lines.slice(1)].join('\n'),
    quote: lines.map((l) => `> ${l}`).join('\n'),
    fence: `\`\`\`\n${printed}\n\`\`\``,
  };
  for (const [name, text] of Object.entries(wrapped)) {
    const found = blocksIn(`Here you are.\n\n${text}\n\nThanks.`);
    assert.equal(found.length, 1, name);
    // Only a fenced block, whose own lines are untouched, equals the printed words.
    assert.equal(found[0] === printed, name === 'fence', name);
  }
  assert.equal(blocksIn(`1. ${printed}`).length, 1);
});
