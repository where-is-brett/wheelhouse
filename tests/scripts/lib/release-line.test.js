// tests/scripts/lib/release-line.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingLine, isBriefingLine } from '../../../scripts/lib/release-line.js';
import { briefingLine as fromRelease } from '../../../scripts/lineage/release.js';

test('the release line names its tag, and is told apart from any other line', () => {
  assert.equal(briefingLine('v1.4.0'), 'Wheelhouse v1.4.0 was merged with a review and without your approval: it only moves the pinned kits, and its checks passed.');
  assert.equal(fromRelease, briefingLine);
  for (const ref of ['v1.4.0', 'release-2026.10.20', 'a']) assert.equal(isBriefingLine(briefingLine(ref)), true, ref);
  for (const other of [
    briefingLine(''), briefingLine('v1 and more'), `${briefingLine('v1.4.0')} Extra`, `Note: ${briefingLine('v1.4.0')}`,
    'Pull request #3 merged', '', null, 7,
  ]) assert.equal(isBriefingLine(other), false, String(other));
});
