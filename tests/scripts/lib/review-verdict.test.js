// tests/scripts/lib/review-verdict.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewClear, minorsOf, severityCounts, reviewStep } from '../../../scripts/lib/review-verdict.js';

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

test('severity lines are counted from the lines that start with a severity', () => {
  const text = '- BLOCKER: a\n2. **HIGH** - b\n* [MEDIUM]: c\n- LOW: d\nLOW: not a list line\n  - note about HIGH things\n';
  assert.deepEqual(severityCounts(text), { total: 4, blocking: 2 });
  assert.deepEqual(severityCounts(''), { total: 0, blocking: 0 });
});

test('reviewStep says clean when there are no findings, whatever the round', () => {
  for (const round of [1, 2, 4]) {
    const got = reviewStep({ total: 0, blocking: 0, round, fixRounds: 3 });
    assert.equal(got.step, 'clean');
    assert.equal(got.line, "Clean: the Lookout found nothing. This task's review is done; go on.");
  }
});

test('reviewStep says only minors left at any round, as soon as no finding is BLOCKER or HIGH', () => {
  for (const round of [1, 2, 3, 4, 7]) {
    const got = reviewStep({ total: 2, blocking: 0, round, fixRounds: 3 });
    assert.equal(got.step, 'minors', `round ${round}`);
    assert.equal(got.line, "Only minors left (2): defer each in the ledger as deferred, do not fix them, and stop this task's review loop. Go on.");
  }
});

test('reviewStep asks for a fix round while the rounds last, and stops once they are used', () => {
  assert.deepEqual(reviewStep({ total: 3, blocking: 1, round: 1, fixRounds: 3 }), {
    step: 'fix', line: '1 blocking finding to fix: fix round 1 of 3. Fix them, then have a Lookout review again.',
  });
  assert.equal(reviewStep({ total: 3, blocking: 2, round: 3, fixRounds: 3 }).line, '2 blocking findings to fix: fix round 3 of 3. Fix them, then have a Lookout review again.');
  assert.deepEqual(reviewStep({ total: 3, blocking: 2, round: 4, fixRounds: 3 }), {
    step: 'limit', line: 'Round limit reached: 2 blocking findings are still open after 3 fix rounds. Put them to the director as one question with ask; do not fix them yourself.',
  });
  assert.equal(reviewStep({ total: 1, blocking: 1, round: 9, fixRounds: 3 }).step, 'limit');
  assert.equal(reviewStep({ total: 1, blocking: 1, round: 4, fixRounds: 3 }).line, 'Round limit reached: 1 blocking finding is still open after 3 fix rounds. Put them to the director as one question with ask; do not fix them yourself.');
});
