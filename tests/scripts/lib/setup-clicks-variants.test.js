// tests/scripts/lib/setup-clicks-variants.test.js
// A question tool that hands back an earlier connection card, when a new one has the same question and
// labels, still has its answer kept under the card the director was shown last (the newest variant of
// that question in the same run, folder and step, recording the same), and nowhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { askedFor, claimAnswer, askedDir, shownCard, writeWhole } from '../../../scripts/lib/setup-clicks.js';
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

// The asked records as a run started before the same words were refused on a second card left them: noteAsked now
// refuses a question in another card's words (tests/scripts/lib/setup-clicks.test.js), so they are written as they were.
const ask = (folder, step, id, c, minute, runId = RUN, { typed = false, writes } = {}) => writeWhole(
  path.join(askedDir(), `${runId}-${step}-${id}.json`),
  `${JSON.stringify({ runId, folder, step, id, card: shownCard(c), typed, ...(writes === undefined ? {} : { writes }), at: T(minute)().toISOString() })}\n`,
);

test('a description card is only ever its own card', () => withFolder((folder) => {
  const labels = ['Choose the README\'s words', 'Not yet'];
  ask(folder, 4, 'product-before-launch', card('Describe it', labels, 'before'), 1);
  ask(folder, 4, 'product-launched', card('Describe it', labels, 'after'), 2);
  assert.equal(askedFor({ cwd: folder, card: card('Describe it', labels, 'before') }).id, 'product-before-launch');
}));

test('cards of other questions sharing a stem are only ever their own card', () => withFolder((folder) => {
  ask(folder, 9, 'uninstall-delete-0123456789', card('Delete it?', ['Keep', 'Delete'], 'one'), 1);
  ask(folder, 9, 'uninstall-delete-0123456780', card('Delete it?', ['Keep', 'Delete'], 'two'), 2);
  assert.equal(askedFor({ cwd: folder, card: card('Delete it?', ['Keep', 'Delete'], 'one') }).id, 'uninstall-delete-0123456789');
}));

test('a newer connection card recording anything else is not a variant', () => withFolder((folder) => {
  const labels = ['A', 'B'];
  ask(folder, 3, 'connection-051b7e9ee1', card('How?', labels, 'x'), 1);
  ask(folder, 3, 'connection-59275b953b', card('How?', labels, 'y'), 2, RUN, { typed: true });
  ask(folder, 3, 'connection-59275b953c', card('How?', labels, 'z'), 3, RUN, { writes: [{ kind: 'setting' }] });
  assert.equal(askedFor({ cwd: folder, card: card('How?', labels, 'x') }).id, 'connection-051b7e9ee1');
}));

test('the newest card itself is never moved to an older one', () => withFolder((folder) => {
  const labels = ['A', 'B'];
  ask(folder, 3, 'connection-051b7e9ee1', card('How?', labels, 'x'), 1);
  ask(folder, 3, 'connection-59275b953b', card('How?', labels, 'y'), 2);
  assert.equal(askedFor({ cwd: folder, card: card('How?', labels, 'y') }).id, 'connection-59275b953b');
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
  assert.equal(askedFor({ cwd: folder, card: card('How?', ['A', 'B', 'Old only'], 'x') }).id, 'connection-59275b953b');
  // A newer card with other labels is not a variant: the answer stays with the card it read as.
  ask(folder, 3, 'connection-aaaaaaaaaa', card('How?', ['A', 'B'], 'z'), 3);
  assert.equal(askedFor({ cwd: folder, card: card('How?', ['A', 'B', 'Old only'], 'x') }).id, 'connection-59275b953b');
}));

test('a newer card of another run, step, folder or question is never taken', () => withFolder((folder) => {
  const labels = ['A', 'B'];
  const other = tempFolder('wh-variants-other ');
  ask(other, 3, 'connection-59275b953e', card('How?', labels, 'y'), 6);
  ask(folder, 3, 'connection-051b7e9ee1', card('How?', labels, 'x'), 1);
  ask(folder, 4, 'connection-59275b953b', card('How?', labels, 'y'), 2);
  ask(folder, 3, 'connection-59275b953c', card('How else?', labels, 'y'), 3);
  ask(folder, 3, 'connection-59275b953d', card('How?', labels, 'y'), 4, 'run-9999999999');
  ask(folder, 3, 'host', card('How?', labels, 'y'), 5);
  assert.equal(askedFor({ cwd: folder, card: card('How?', labels, 'x') }).id, 'connection-051b7e9ee1');
}));

test('the other variant\'s claim does not refuse an answer to the newer one, and a second one is refused', () => withFolder((folder) => {
  const labels = ['A', 'B'];
  ask(folder, 3, 'connection-051b7e9ee1', card('How?', labels, 'x'), 1);
  ask(folder, 3, 'connection-59275b953b', card('How?', labels, 'y'), 2);
  const data = (id) => ({ runId: RUN, step: 3, questionId: id, question: 'How?' });
  assert.ok(claimAnswer(data('connection-051b7e9ee1'), T(3), { askedAt: '2026-11-16T01:01:00.000Z' }));
  const got = askedFor({ cwd: folder, card: card('How?', labels, 'x') });
  assert.ok(claimAnswer(data(got.id), T(4), { askedAt: got.at }));
  assert.ok(!claimAnswer(data(got.id), T(5), { askedAt: got.at }));
}));
