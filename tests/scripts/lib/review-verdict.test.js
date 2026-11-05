// tests/scripts/lib/review-verdict.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewClear, minorsOf } from '../../../scripts/lib/review-verdict.js';

test('CLEAN clears; FINDINGS clears only with a blocking count of 0 and at least one finding', () => {
  assert.equal(reviewClear({ verdict: 'CLEAN' }), true);
  assert.equal(reviewClear({ verdict: 'FINDINGS', findings: 2, blocking: 0 }), true);
  assert.equal(reviewClear({ verdict: 'FINDINGS', findings: 2, blocking: 1 }), false);
  assert.equal(reviewClear({ verdict: 'FINDINGS', findings: 2 }), false);
  assert.equal(reviewClear({ verdict: 'FINDINGS', findings: 0, blocking: 0 }), false);
  assert.equal(reviewClear({ verdict: 'FINDINGS', findings: 2, blocking: '0' }), false);
  assert.equal(reviewClear({ verdict: 'ISSUES', findings: 2, blocking: 0 }), false);
  assert.equal(reviewClear(null), false);
  assert.equal(minorsOf({ verdict: 'FINDINGS', findings: 4, blocking: 0 }), 4);
  assert.equal(minorsOf({ verdict: 'FINDINGS', findings: 4, blocking: 1 }), 0);
});
