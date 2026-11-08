// tests/scripts/decisions/switch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typedRepliesIn } from '../../../scripts/decisions/switch.js';

const stored = (value, extra = {}) => ({ typedReplies: { key: 'typedReplies', id: 's1', at: '2026-11-08T00:00:00.000Z', value, ...extra } });

test('typed replies are on when the project has never set them', () => {
  assert.equal(typedRepliesIn({}), true);
});

test('typed replies follow the value the project stored', () => {
  assert.equal(typedRepliesIn(stored(true)), true);
  assert.equal(typedRepliesIn(stored(false)), false);
});

test('a settings view that cannot be read counts as off', () => {
  for (const settings of [undefined, null, 'settings', 7, [], [stored(true)]]) {
    assert.equal(typedRepliesIn(settings), false, JSON.stringify(settings));
  }
});

test('a stored typedReplies entry that cannot be read counts as off, not as the default', () => {
  for (const entry of [null, 'on', 1, [], { key: 'typedReplies' }, { key: 'typedReplies', value: 'yes' }, { key: 'typedReplies', value: 1 }]) {
    assert.equal(typedRepliesIn({ typedReplies: entry }), false, JSON.stringify(entry));
  }
});

test('a stored off that has ended gives way to the default', () => {
  assert.equal(typedRepliesIn(stored(false, { until: '2026-01-01T00:00:00.000Z' })), true);
});

test('other settings in the view leave typed replies at the default', () => {
  assert.equal(typedRepliesIn({ bundleApprovals: { key: 'bundleApprovals', id: 's2', at: '2026-11-08T00:00:00.000Z', value: true } }), true);
});
