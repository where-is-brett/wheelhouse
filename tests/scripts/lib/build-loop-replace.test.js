// tests/scripts/lib/build-loop-replace.test.js
// Which question may take the place of which (the foreman's changed feature question), and that the helper's own card
// works and number ranges the rule leans on are the ones the code uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayReplace, SYSTEM_WORKS, FEATURE_QUESTIONS_END, FOREMAN_QUESTIONS } from '../../../scripts/lib/build-loop.js';
import { ENGINE_QUESTIONS } from '../../../scripts/engine/router.js';
import { HAND_MADE_WORK } from '../../../scripts/host/local/folder.js';
import { MOVE_WORK } from '../../../scripts/host/local/move.js';
import { CHECK_CARD_WORK } from '../../../scripts/checks/runner.js';
import { MERGE_WORK } from '../../../scripts/engine/dispatcher.js';

test('the rule\'s works and range are the code\'s own', () => {
  assert.deepEqual([...SYSTEM_WORKS].sort(), [HAND_MADE_WORK, MOVE_WORK, CHECK_CARD_WORK, MERGE_WORK].sort());
  assert.equal(FEATURE_QUESTIONS_END, ENGINE_QUESTIONS);
});

test('only a foreman id of the same work may replace a feature\'s own question', () => {
  const F = FOREMAN_QUESTIONS + 1;
  assert.equal(mayReplace(`q-mine-${F}`, 'q-mine-1'), true);
  assert.equal(mayReplace(`q-mine-${F}`, 'q-mine-499999'), true);
  for (const [id, root] of [
    [`q-mine-${F}`, 'q-mine-500000'], [`q-mine-${F}`, `q-mine-${F + 1}`], [`q-mine-${F}`, 'q-other-1'], ['q-mine-2', 'q-mine-1'],
    [`q-by-hand-${F}`, 'q-by-hand-3'], [`q-move-${F}`, 'q-move-1'], [`q-checks-${F}`, 'q-checks-1'], [`q-merge-queue-${F}`, 'q-merge-queue-1'], ['nonsense', 'q-mine-1'],
  ]) assert.equal(mayReplace(id, root), false, `${root} <- ${id}`);
});
