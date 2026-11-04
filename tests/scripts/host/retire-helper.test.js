// tests/scripts/host/retire-helper.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOlder } from '../../../scripts/host/retire-helper.js';

test('isOlder compares numbers, and a newer, equal or unreadable version is not older', () => {
  assert.equal(isOlder('0.2.3', '0.2.4'), true);
  assert.equal(isOlder('0.2.9', '0.2.10'), true);
  assert.equal(isOlder('0.2.10', '0.2.9'), false);
  assert.equal(isOlder('0.2.4', '0.2.4'), false);
  assert.equal(isOlder('0.3.0', '0.2.4'), false);
  assert.equal(isOlder('0.2', '0.2.1'), true);
  assert.equal(isOlder('soon', '0.2.4'), false);
  assert.equal(isOlder(undefined, '0.2.4'), false);
  assert.equal(isOlder('0.2.3', null), false);
});

test('isOlder follows full semantic version precedence, a pre-release being below its release', () => {
  assert.equal(isOlder('0.2.6', '0.2.7'), true);
  assert.equal(isOlder('0.3.0-rc.1', '0.3.0'), true);
  assert.equal(isOlder('0.3.0', '0.3.0-rc.1'), false);
  assert.equal(isOlder('0.3.0-rc.1', '0.3.0-rc.2'), true);
  assert.equal(isOlder('v0.2.6', '0.2.7'), true);
  assert.equal(isOlder('0.3.0-rc.1', '0.3.0-rc.1'), false);
});
