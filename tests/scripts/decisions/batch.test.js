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

test('the change names the cards it took, in the order of its files, with an empty work id as no piece', () => {
  const change = batchChange({ existing: [] }, [
    { id: 'c-1', ...item('Which provider?', null) },
    { id: 'c-2', ...item('Which colour?', 'w-tide-1') },
    { id: 'c-3', ...item('Which font?', '') },
    { id: 'c-4', ...item('Which map?', '  ') },
    { id: 'c-5', ...item('Keep it quiet?', undefined, { private: true }) },
    { id: 'c-6', ...item('Which logo?', 'w-tide-2') },
  ], { date: '2026-11-07', dropped: ['w-tide-2'] });
  assert.deepEqual(change.ids, ['c-1', 'c-3', 'c-4', 'c-6']);
  assert.equal(change.files.length, change.ids.length);
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
