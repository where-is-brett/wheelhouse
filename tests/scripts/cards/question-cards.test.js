// tests/scripts/cards/question-cards.test.js
// Every question Wheelhouse raises for the director must be one the composer can make a card of, since a question it refuses
// never reaches the director's chat or pane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { questionProblem } from '../../../scripts/cards/compose.js';
import { PUT_OFF } from '../../../scripts/lib/front-desk.js';
import { handMadeCard } from '../../../scripts/host/local/folder.js';
import { moveCard, failedCard, homeCard } from '../../../scripts/host/local/move.js';
import { FIRST_RED_CARD } from '../../../scripts/setup/first-check.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// A question as the build records it: the builder's fields with an id and a work.
const asked = (card) => ({ id: 'q-test-1', work: card.work ?? 'a-piece', ...card });

const BUILDERS = {
  'the hand-made changes question': handMadeCard(),
  'the move question (GitHub)': moveCard('github'),
  'the move question (GitLab)': moveCard('gitlab'),
  'the failed move question, before the record': failedCard('github', 'It stopped.', false),
  'the failed move question, after the record': failedCard('gitlab', 'It stopped.', true),
  'the private copy question': homeCard(),
  'the first red check question': { work: 'first-check', ...FIRST_RED_CARD },
};

for (const [name, card] of Object.entries(BUILDERS)) {
  test(`${name} can be made a card`, () => {
    assert.equal(questionProblem(asked(card)), null);
  });
}

// The builders held in closures (the checks runner, the dispatcher) can't be called here, so their source is read: no
// question that carries a recommendation offers a button that puts a card off.
const escaped = PUT_OFF.map((w) => `['"]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
const PUT_OFF_LABEL = new RegExp(`label: *(?:NOT_NOW|SHOW_ME|WHY|SUGGEST|${escaped.join('|')})`);
function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name))
    : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

test('no question offers Not now, Explain more, Show me, Why? or Suggest a change… as one of its own answers', () => {
  const found = [];
  for (const file of sources(path.join(ROOT, 'scripts'))) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/\brecommendation:/.test(text) || /kind: '(?:setup|start-goal)'/.test(text)) continue;
    if (file.endsWith(path.join('cards', 'compose.js'))) continue;
    text.split('\n').forEach((line, i) => {
      if (PUT_OFF_LABEL.test(line)) found.push(`${path.relative(ROOT, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);
});
