// tests/scripts/checks/not-counting.test.js
// The state of a project with nothing a check can show (spec 4.5 and ruling 2): when it holds and what ends it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countingEnds, keptCommand, mayStopCounting, notCounting } from '../../../scripts/checks/not-counting.js';
import { dueChecks } from '../../../scripts/checks/queue.js';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const D = 'd'.repeat(64);

test('a project counts unless the newest state says otherwise', () => {
  assert.equal(notCounting([]), false);
  assert.equal(notCounting([{ state: 'not-counting', why: 'director' }]), true);
  assert.equal(notCounting([{ state: 'not-counting', why: 'director' }, { state: 'counting', why: 'passed' }]), false);
});

test('the first pass on the main line ends it', () => {
  assert.equal(countingEnds(true, { commit: SHA, result: 'passed', clean: true }), true);
});

test('a pass on a head doesn\'t end it', () => {
  assert.equal(countingEnds(true, { commit: SHA, result: 'passed' }), false);
});

test('anything but a pass doesn\'t end it, and a project that counts has nothing to end', () => {
  assert.equal(countingEnds(true, { commit: SHA, result: 'not-counted', clean: true }), false);
  assert.equal(countingEnds(false, { commit: SHA, result: 'passed', clean: true }), false);
});

test('once a project has counted, it can\'t stop', () => {
  assert.equal(mayStopCounting([]), true);
  assert.equal(mayStopCounting([{ state: 'not-counting', why: 'nothing-found' }]), true);
  assert.equal(mayStopCounting([{ state: 'counting', why: 'passed' }]), false);
  assert.equal(mayStopCounting([{ state: 'counting', why: 'passed' }, { state: 'not-counting', why: 'director' }]), false);
});

test('the newest command found is the one kept', () => {
  assert.equal(keptCommand([]), null);
  assert.equal(keptCommand([{ testCommand: 'a' }, { testCommand: 'b' }]).testCommand, 'b');
});

test('an open head holding only not-counted is checked again when counting begins', () => {
  const results = [{ commit: SHA, command: D, result: 'not-counted' }];
  assert.deepEqual(dueChecks({ main: null, heads: [SHA], results, digest: D, notCounting: true }), []);
  assert.deepEqual(dueChecks({ main: null, heads: [SHA], results, digest: D, notCounting: false }), [{ commit: SHA, main: false }]);
});

test('a red from before not counting is checked again while it holds, and the newest result is the one that stands', () => {
  const results = [{ commit: OTHER, command: D, result: 'failed', clean: true }];
  assert.deepEqual(dueChecks({ main: OTHER, heads: [], results, digest: D, notCounting: true }), [{ commit: OTHER, main: true }]);
  const then = [...results, { commit: OTHER, command: D, result: 'not-counted', clean: true }];
  assert.deepEqual(dueChecks({ main: OTHER, heads: [], results: then, digest: D, notCounting: true }), []);
  assert.deepEqual(dueChecks({ main: OTHER, heads: [], results: then, digest: D, notCounting: false }), [{ commit: OTHER, main: true }]);
});

test('with no command a not-counted record stands for its null digest', () => {
  assert.deepEqual(dueChecks({ main: SHA, heads: [], results: [{ commit: SHA, command: null, result: 'not-counted', clean: true }], digest: null, notCounting: true }), []);
});
