// tests/scripts/lib/setup-clicks.test.js
// The one rule for a typed answer on a setup card (rulings R125, R132, R137), in scripts/lib/ so the
// prompt record and the engine judge it alike: the choice handed back is never an answer, and a
// question is not the first time on its question; typed again, any answer counts. A text with no
// letter or digit is handed back (ruling R143).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typedVerdict, handedBack, notAnAnswer, cardKey, bareLabel, cardDifferences } from '../../../scripts/lib/setup-clicks.js';
import * as clicks from '../../../scripts/setup/clicks.js';

test('a hand-back is refused every time, a question the first time on its question only (rulings R125, R132)', () => {
  assert.equal(typedVerdict('you decide', []), 'handedBack');
  assert.equal(typedVerdict('You decide.', ['Tide tables?']), 'handedBack', 'even after a question was refused');
  assert.equal(typedVerdict('Tide tables?', []), 'question');
  assert.equal(typedVerdict('Tide tables?', ['you decide']), 'question', 'a hand-back before it is no question');
  assert.equal(typedVerdict('Tide tables?', ['Other words?']), null, 'typed again after a question, it counts');
  assert.equal(typedVerdict('Tide tables for sailors.', []), null);
  assert.equal(handedBack('I don’t know!'), true);
  assert.equal(notAnAnswer('What would you pick?'), true);
});

// Ruling R143: a typed answer with no letter or digit in it is no answer at all, so a bare "?"
// typed twice never becomes the answer (it would be step 4's description, in the glossary).
test('a typed answer with no letter or digit is a hand-back, refused every time (ruling R143)', () => {
  for (const text of ['?', '??', '...', ' ? ', '?!', '-', '…', '👍']) {
    assert.equal(handedBack(text), true, text);
    assert.equal(notAnAnswer(text), true, text);
    assert.equal(typedVerdict(text, []), 'handedBack', text);
    assert.equal(typedVerdict(text, [text]), 'handedBack', `${text} typed again`);
    assert.equal(typedVerdict(text, ['Tide tables?']), 'handedBack', `${text} after a question`);
  }
  // One letter or digit is enough to be an answer, as any other typed text is.
  for (const text of ['A', '7', 'é?', 'Café?']) assert.equal(handedBack(text), false, text);
  assert.equal(typedVerdict('7', []), null);
  assert.equal(typedVerdict('é?', ['?']), 'question', 'a question, the first time on its question');
});

test('the engine judges with the same rule, from scripts/lib/ (ruling R137)', () => {
  assert.equal(clicks.handedBack, handedBack);
  assert.equal(clicks.notAnAnswer, notAnAnswer);
});

const withLabel = (label) => ({ question: 'Q?', header: 'H', options: [{ label, description: 'd' }, { label: 'Not now', description: 'n' }] });

test('cardKey reads a trailing "(Recommended)" on a label as the bare label', () => {
  assert.equal(cardKey(withLabel('Go ahead (Recommended)')), cardKey(withLabel('Go ahead')));
  assert.notEqual(cardKey(withLabel('Go ahead (Recommended) now')), cardKey(withLabel('Go ahead now')));
  assert.equal(bareLabel(' (Recommended)'), ' (Recommended)');
  assert.equal(bareLabel('Go ahead (Recommended)'), 'Go ahead');
  assert.equal(bareLabel('Go ahead (Recommended) now'), 'Go ahead (Recommended) now');
  assert.equal(bareLabel(5), 5);
  assert.notEqual(cardKey(withLabel(' (Recommended)')), cardKey(withLabel('')), 'a label of the suffix alone is kept whole');
});

test('cardDifferences names each part that differs', () => {
  const stored = withLabel('Go ahead');
  assert.deepEqual(cardDifferences(withLabel('Go ahead'), stored), []);
  assert.deepEqual(cardDifferences({ ...stored, question: 'Other?' }, stored), ['its question is not worded as printed']);
  assert.deepEqual(cardDifferences({ ...stored, header: 'Other' }, stored), ['its header is "Other", and the card\'s is "H"']);
  assert.deepEqual(cardDifferences({ ...stored, options: [stored.options[0], { label: 'Not now', description: 'cut' }] }, stored), ['option 2\'s description is not worded as printed']);
  assert.deepEqual(cardDifferences(withLabel('Go ahead (Recommended)'), stored), []);
  assert.deepEqual(cardDifferences({ ...stored, options: [stored.options[0]] }, stored), ['it has 1 options, and the card has 2']);
  assert.deepEqual(cardDifferences(withLabel('Begin'), stored), ['option 1\'s label is "Begin", and the card\'s is "Go ahead"']);
});
