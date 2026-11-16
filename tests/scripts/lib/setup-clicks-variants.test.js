// tests/scripts/lib/setup-clicks-variants.test.js
// A question tool that hands back an earlier card, when a new card has the same question and labels,
// still has its answer kept under the card the director was shown last (the newest variant of that
// question in the same run, folder and step), and nowhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askedFor, claimAnswer } from '../../../scripts/lib/setup-clicks.js';
import { noteAsked } from '../../../scripts/setup/clicks.js';
import { as, shortHome, tempFolder } from '../../helpers/homes.js';

const RUN = 'run-0123456789';
const T = (m) => () => new Date(Date.UTC(2026, 10, 16, 1, m));

const card = (question, labels, says) => ({
  question,
  header: 'Question',
  options: labels.map((label) => ({ label, description: `${says} ${label}` })),
});

function withFolder(fn) {
  const home = shortHome();
  const folder = tempFolder('wh-variants ');
  return as(home, () => fn(folder));
}

const ask = (folder, step, id, c, minute, runId = RUN) => noteAsked({ runId, folder, step, id, card: c, now: T(minute) });

test('an echo of the older description card is kept under the newer one', () => withFolder((folder) => {
  const labels = ['Choose the README\'s words', 'Not yet'];
  ask(folder, 4, 'product-before-launch', card('Describe it', labels, 'before'), 1);
  ask(folder, 4, 'product-launched', card('Describe it', labels, 'after'), 2);
  const got = askedFor({ cwd: folder, card: card('Describe it', labels, 'before') });
  assert.equal(got.id, 'product-launched');
  assert.equal(got.card.options[0].description, 'after Choose the README\'s words');
  assert.ok(got.card.options.some((o) => o.label === 'Not yet'));
}));

test('an echo of an older connection card is kept under the newer one', () => withFolder((folder) => {
  const labels = ['Use my git as it is', 'Narrow', 'Quick'];
  ask(folder, 3, 'connection-051b7e9ee1', card('How should agents reach it?', labels, 'narrow advised'), 1);
  ask(folder, 3, 'connection-59275b953b', card('How should agents reach it?', labels, 'as is advised'), 2);
  assert.equal(askedFor({ cwd: folder, card: card('How should agents reach it?', labels, 'narrow advised') }).id, 'connection-59275b953b');
  assert.equal(askedFor({ cwd: folder, card: card('How should agents reach it?', labels, 'as is advised') }).id, 'connection-59275b953b');
}));

test('a label that is not among the newest card\'s options is not on it', () => withFolder((folder) => {
  ask(folder, 3, 'connection-051b7e9ee1', card('How?', ['A', 'B', 'Old only'], 'x'), 1);
  ask(folder, 3, 'connection-59275b953b', card('How?', ['A', 'B', 'Old only'], 'y'), 2);
  const got = askedFor({ cwd: folder, card: card('How?', ['A', 'B', 'Old only'], 'x') });
  assert.equal(got.id, 'connection-59275b953b');
  assert.ok(!got.card.options.some((o) => o.label === 'Missing'));
  // A newer card with other labels is not a variant: the answer stays with the card it read as.
  ask(folder, 3, 'connection-aaaaaaaaaa', card('How?', ['A', 'B'], 'z'), 3);
  assert.equal(askedFor({ cwd: folder, card: card('How?', ['A', 'B', 'Old only'], 'x') }).id, 'connection-59275b953b');
}));

test('a newer card of another run, step, folder or question is never taken', () => withFolder((folder) => {
  const labels = ['A', 'B'];
  ask(folder, 3, 'connection-051b7e9ee1', card('How?', labels, 'x'), 1);
  ask(folder, 4, 'connection-59275b953b', card('How?', labels, 'y'), 2);
  ask(folder, 3, 'connection-59275b953c', card('How else?', labels, 'y'), 3);
  ask(folder, 3, 'connection-59275b953d', card('How?', labels, 'y'), 4, 'run-9999999999');
  ask(folder, 3, 'host', card('How?', labels, 'y'), 5);
  assert.equal(askedFor({ cwd: folder, card: card('How?', labels, 'x') }).id, 'connection-051b7e9ee1');
}));

test('the other variant\'s claim does not refuse an answer to the newer one', () => withFolder((folder) => {
  const labels = ['Choose the README\'s words', 'Not yet'];
  ask(folder, 4, 'product-before-launch', card('Describe it', labels, 'before'), 1);
  ask(folder, 4, 'product-launched', card('Describe it', labels, 'after'), 2);
  const data = (id) => ({ runId: RUN, step: 4, questionId: id, question: 'Describe it' });
  assert.ok(claimAnswer(data('product-before-launch'), T(3), { askedAt: '2026-11-16T01:01:00.000Z' }));
  const got = askedFor({ cwd: folder, card: card('Describe it', labels, 'before') });
  assert.ok(claimAnswer(data(got.id), T(4), { askedAt: got.at }));
}));
