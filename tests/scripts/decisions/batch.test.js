// tests/scripts/decisions/batch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchChange } from '../../../scripts/decisions/batch.js';

const base = { options: [{ label: 'A', says: 'Use A' }, { label: 'B', says: 'Use B' }], recommend: 'A' };
const at = new Date(2026, 10, 7, 16, 0);
const item = (question, work, extra = {}) => ({ decision: { question, work, ...base }, answer: { at, option: 'A', words: '', ...extra } });

test('a dropped piece\'s decision goes into the day\'s batch', () => {
  const change = batchChange({ existing: [] }, [
    item('Which provider?', null),
    item('Which colour?', 'w-tide-1'),
    item('Which font?', 'w-tide-2'),
  ], { date: '2026-11-07', dropped: ['w-tide-1'] });
  assert.equal(change.branch, 'wheelhouse/decisions-2026-11-07');
  assert.deepEqual(change.files.map((f) => f.path), [
    'docs/decisions/2026-11-07-which-provider.md',
    'docs/decisions/2026-11-07-which-colour.md',
  ]);
});

test('the batch touches only docs/decisions/', () => {
  const change = batchChange({ existing: ['docs/decisions/2026-11-07-which-provider.md'] }, [
    item('Which provider?', null),
    item('../../etc/passwd?', null),
    item('Keep it quiet?', null, { private: true }),
  ], { date: at });
  assert.equal(change.branch, 'wheelhouse/decisions-2026-11-07');
  assert.ok(change.files.length > 0);
  for (const file of change.files) assert.match(file.path, /^docs\/decisions\/[a-z0-9-]+\.md$/);
  // A name the project already has is not taken, and a private answer is left out.
  assert.ok(change.files.some((f) => f.path === 'docs/decisions/2026-11-07-which-provider-2.md'));
  assert.ok(!change.files.some((f) => /keep-it-quiet/.test(f.path)));
});
