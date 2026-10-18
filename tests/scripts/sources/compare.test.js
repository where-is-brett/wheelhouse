// tests/scripts/sources/compare.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSource, modelNames, retirements } from '../../../scripts/sources/compare.js';

test('a reordered page is not a change; an added line is', () => {
  const before = 'one\ntwo\nthree';
  assert.deepEqual(compareSource(before, 'three\none\ntwo'), { changed: false, added: [], removed: [], newLinks: [] });
  const added = compareSource(before, 'one\ntwo\nthree\nfour');
  assert.equal(added.changed, true);
  assert.deepEqual(added.added, ['four']);
  assert.deepEqual(added.removed, []);
  const removed = compareSource(before, 'one\nthree');
  assert.deepEqual(removed.removed, ['two']);
  assert.equal(removed.changed, true);
});

test('new links are those in the later copy and not the earlier one', () => {
  const result = compareSource({ text: 'a', links: ['https://x.test/a'] }, { text: 'a', links: ['https://x.test/a', 'https://x.test/b'] });
  assert.deepEqual(result.newLinks, ['https://x.test/b']);
  assert.equal(result.changed, false);
});

test('model names are words of the form claude-… holding a digit', () => {
  const text = 'Use claude-sample-9 or (claude-sample-10), not claude-code. See anthropic.claude-sample-9. Also claude-sample-2-20990101.';
  assert.deepEqual(modelNames(text), ['claude-sample-9', 'claude-sample-10', 'claude-sample-2-20990101']);
  assert.deepEqual(modelNames('nothing here, claude alone, claude-code'), []);
});

test('a retirement is a line naming a model and a date, in any of three forms', () => {
  const text = [
    'claude-sample-9 retires 2026-11-12',
    'claude-sample-8 | Deprecated | 5 January 2027',
    'claude-sample-7 | Active | Not sooner than January 5, 2027',
    'claude-sample-6 | Active | Mar 3 2027',
    'claude-sample-1 | Retired | 3 February 2026',
    'claude-sample-3 has no date',
    'A line with only a date: 2026-12-01',
    'claude-sample-4 | Deprecated | 1 September 2026 | 2 December 2026 | claude-sample-9',
    'claude-sample-5 | 31 February 2027',
  ].join('\n');
  assert.deepEqual(retirements(text, '2026-10-19T09:00:00.000Z'), [
    { model: 'claude-sample-9', date: '2026-11-12' },
    { model: 'claude-sample-8', date: '2027-01-05' },
    { model: 'claude-sample-7', date: '2027-01-05' },
    { model: 'claude-sample-6', date: '2027-03-03' },
    { model: 'claude-sample-4', date: '2026-12-02' },
  ]);
});

test('a model on two lines keeps its earliest date once', () => {
  const text = 'claude-sample-9 | 2027-02-01\nclaude-sample-9 | 2027-01-01\nclaude-sample-9 | 2027-01-01';
  assert.deepEqual(retirements(text, '2026-10-19T00:00:00.000Z'), [{ model: 'claude-sample-9', date: '2027-01-01' }]);
});
