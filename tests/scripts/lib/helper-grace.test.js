// tests/scripts/lib/helper-grace.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helperGrace } from '../../../scripts/lib/helper-grace.js';

test('the extra time on the helper is a whole number of milliseconds a test sets, and 0 in use', () => {
  assert.equal(helperGrace({}), 0);
  assert.equal(helperGrace({ WHEELHOUSE_HELPER_GRACE_MS: '60000' }), 60000);
  for (const junk of ['', '0', '-5', '1.5', 'soon', '1e3x', ' ']) {
    assert.equal(helperGrace({ WHEELHOUSE_HELPER_GRACE_MS: junk }), 0, JSON.stringify(junk));
  }
  // Never more than ten minutes, however much is asked.
  assert.equal(helperGrace({ WHEELHOUSE_HELPER_GRACE_MS: String(24 * 60 * 60 * 1000) }), 10 * 60 * 1000);
});
