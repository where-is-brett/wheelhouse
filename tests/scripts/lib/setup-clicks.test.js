// tests/scripts/lib/setup-clicks.test.js
// The one rule for a typed answer on a setup card (rulings R125, R132, R137), in scripts/lib/ so the
// prompt record and the engine judge it alike: the choice handed back is never an answer, and a
// question is not the first time on its question; typed again, any answer counts. A text with no
// letter or digit is handed back (ruling R143).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typedVerdict, handedBack, notAnAnswer } from '../../../scripts/lib/setup-clicks.js';
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
