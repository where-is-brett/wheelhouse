// tests/scripts/foreman/desktop-findings.test.js
// The one place that holds what part 0's Desktop probe found (builders and settings design, sections 7.3 and 7.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESKTOP_FINDINGS, desktopFindings } from '../../../scripts/foreman/desktop-findings.js';

test('until the probe note lands: no cwd on an offer and no nesting', () => {
  assert.deepEqual(desktopFindings(), { cwdOnOffer: false, nesting: { how: null } });
  assert.equal(Object.isFrozen(DESKTOP_FINDINGS), true);
});

test('what a test hands in overrides each finding on its own', () => {
  assert.equal(desktopFindings({ cwdOnOffer: true }).cwdOnOffer, true);
  assert.equal(desktopFindings({ cwdOnOffer: true }).nesting.how, null);
  assert.equal(desktopFindings({ nesting: { how: 'parent_session' } }).nesting.how, 'parent_session');
  assert.equal(desktopFindings({ nesting: { how: 'parent_session' } }).cwdOnOffer, false);
});

test('a nesting option that is not a plain option name is read as no nesting', () => {
  for (const how of ['parent session', 'a;b', '', 7, '$x', 'x'.repeat(65)]) assert.equal(desktopFindings({ nesting: { how } }).nesting.how, null);
});
