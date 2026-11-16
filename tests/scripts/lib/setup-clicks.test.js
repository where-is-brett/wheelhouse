// tests/scripts/lib/setup-clicks.test.js
// The one rule for a typed answer on a setup card (rulings R125, R132, R137), in scripts/lib/ so the
// prompt record and the engine judge it alike: the choice handed back is never an answer, and a
// question is not the first time on its question; typed again, any answer counts. A text with no
// letter or digit is handed back (ruling R143).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { typedVerdict, handedBack, notAnAnswer, cardKey, bareLabel, cardDifferences, shownByCard } from '../../../scripts/lib/setup-clicks.js';
import * as clicks from '../../../scripts/setup/clicks.js';
import { as, shortHome } from '../../helpers/homes.js';

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

// The Desktop app shows a card whose question text an earlier card had as that earlier card, with its answer. So no
// question goes out in words the run has already asked on another card; only the same card asked again under its own id.
test('noteAsked refuses a question in the words of a different card asked earlier in the run', async () => {
  const runId = 'run-0123456789';
  const folder = '/projects/Cafe Menu';
  const card = (question, labels = ['Narrow', 'Quick']) => ({
    question, header: 'Question', multiSelect: false, options: labels.map((label) => ({ label, description: `${label}, as described.` })),
  });
  const asked = 'How should Wheelhouse\'s agents reach Cafe-Menu?';
  await as(shortHome(), async () => {
    clicks.noteAsked({ runId, folder, step: 3, id: 'connection-a', card: card(asked) });
    // The same card under its own id, asked again: it goes out.
    clicks.noteAsked({ runId, folder, step: 3, id: 'connection-a', card: card(asked) });
    // Other options under the same question, at another id or step, or at the same id: refused, curly apostrophe or not.
    assert.throws(() => clicks.noteAsked({ runId, folder, step: 3, id: 'connection-b', card: card(asked, ['Narrow', 'Use my git as it is']) }), /in the words of 3\.connection-a/);
    assert.throws(() => clicks.noteAsked({ runId, folder, step: 3, id: 'connection-b', card: card(asked) }), /a card asked again needs its own words/);
    assert.throws(() => clicks.noteAsked({ runId, folder, step: 2, id: 'connection-a', card: card(asked) }));
    assert.throws(() => clicks.noteAsked({ runId, folder, step: 3, id: 'connection-a', card: card(asked.replace('\'', '’'), ['Narrow']) }));
    // A card asked again with a reason line opening its question is a question of its own, and goes out.
    clicks.noteAsked({ runId, folder, step: 3, id: 'connection-b', card: card(`Quick can't be had here, so choose again. ${asked}`, ['Narrow', 'Use my git as it is']) });
    // Another run may ask in the same words.
    clicks.noteAsked({ runId: 'run-abcdefabcd', folder, step: 3, id: 'connection-c', card: card(asked) });
  });
});

// A setup card sent without its line of hash is matched to the shown card by its whole words, in a folder holding the
// session's: the run, step and list come from that record, never from the click. Where the very card was shown for two
// different lists or steps, the click names no one list, and nothing is taken.
test('shownByCard finds the one shown card with the same words, and refuses where those words name two lists', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-shown-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-elsewhere-'));
  const card = (text) => ({ question: text, header: 'Setup', options: [{ label: 'Set it up', description: 'Setup does each thing listed.' }, { label: 'Not now', description: 'Nothing is made yet.' }] });
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  try {
    await as(shortHome(), async () => {
      clicks.noteShown({ runId: 'run-0123456789', folder, step: 3, hash: a, card: card('Setup step 3: the project.') });
      // The card the director saw, labelled "(Recommended)" by the session, matches.
      const seen = card('Setup step 3: the project.');
      seen.options[0].label = 'Set it up (Recommended)';
      assert.deepEqual(shownByCard({ cwd: folder, card: seen }), { runId: 'run-0123456789', step: 3, hash: a });
      // Other words, or a folder that does not hold the session's, match nothing.
      assert.equal(shownByCard({ cwd: folder, card: card('Setup step 3: another project.') }), null);
      assert.equal(shownByCard({ cwd: elsewhere, card: seen }), null);
      assert.equal(shownByCard({ cwd: folder, card: { question: '' } }), null);
      // The same words shown for another list in this folder: the click could be on either, so it is refused.
      clicks.noteShown({ runId: 'run-abcdefabcd', folder, step: 3, hash: b, card: card('Setup step 3: the project.') });
      assert.equal(shownByCard({ cwd: folder, card: seen }), null);
    });
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
