// tests/scripts/engine/reproduction.test.js
// The bug lane's reproduction (Archon design, section 7.2): read from the reproduce step's output as one done check,
// a test or a command, and the test files that hold it; anything else is no reproduction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReproduction, sameReproduction, MOST_FILES, MOST_TEST_FILES, BUG_ROUNDS } from '../../../scripts/engine/reproduction.js';

const output = (fields) => JSON.stringify({ summary: 'Reproduced.', blocked: false, assumptions: [], files: ['test/duration.test.js'], ...fields });

test('the lane\'s limits', () => {
  assert.equal(MOST_FILES, 5);
  assert.equal(MOST_TEST_FILES, 3);
  assert.equal(BUG_ROUNDS, 5);
});

test('a test, or a command that ends 0 once the bug is gone, with the test files that hold it', () => {
  assert.deepEqual(readReproduction(output({ test: 'formats 65 seconds as 1:05' })), { check: { test: 'formats 65 seconds as 1:05' }, files: ['test/duration.test.js'] });
  assert.deepEqual(readReproduction(output({ command: 'node --test test/duration.test.js' })), { check: { command: 'node --test test/duration.test.js', expect: 0 }, files: ['test/duration.test.js'] });
});

test('anything else is no reproduction', () => {
  for (const [why, text] of [
    ['blocked', output({ test: 'x', blocked: true })],
    ['both', output({ test: 'x', command: 'y' })],
    ['neither', output({})],
    ['a test over two lines', output({ test: 'a\nb' })],
    ['a test too long', output({ test: 'x'.repeat(201) })],
    ['a command too long', output({ command: 'x'.repeat(401) })],
    ['no files', output({ test: 'x', files: [] })],
    ['too many files', output({ test: 'x', files: ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js'] })],
    ['product code', output({ test: 'x', files: ['src/duration.js'] })],
    ['out of the tree', output({ test: 'x', files: ['../x.test.js'] })],
    ['absolute', output({ test: 'x', files: ['/abs/x.test.js'] })],
    ['an option', output({ test: 'x', files: ['-x.test.js'] })],
    ['a backslash', output({ test: 'x', files: ['test\\x.test.js'] })],
    ['not JSON', 'not json'],
    ['not a string', undefined],
  ]) assert.equal(readReproduction(text), null, why);
});

test('two reproductions are the same when their checks and files are', () => {
  const a = readReproduction(output({ test: 'x' }));
  assert.equal(sameReproduction(a, readReproduction(output({ test: 'x' }))), true);
  assert.equal(sameReproduction(a.check, { test: 'x' }), true, 'or two checks alone');
  assert.equal(sameReproduction(a, readReproduction(output({ test: 'y' }))), false);
  assert.equal(sameReproduction(a, null), false);
});
