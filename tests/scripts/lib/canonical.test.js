// tests/scripts/lib/canonical.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../../../scripts/lib/canonical.js';

test('canonicalJson sorts keys at every level', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":1}');
});

test('canonicalJson keeps array order and sorts keys inside arrays', () => {
  assert.equal(canonicalJson([{ b: 1, a: 2 }, 3, null, 'x']), '[{"a":2,"b":1},3,null,"x"]');
});

test('canonicalJson refuses undefined, functions and non-finite numbers', () => {
  assert.throws(() => canonicalJson(undefined));
  assert.throws(() => canonicalJson({ a: undefined }));
  assert.throws(() => canonicalJson([() => 1]));
  assert.throws(() => canonicalJson({ a: NaN }));
  assert.throws(() => canonicalJson({ a: Infinity }));
  assert.throws(() => canonicalJson({ a: -Infinity }));
});

test('canonicalJson refuses Date, Map, Set and sparse arrays', () => {
  assert.throws(() => canonicalJson(new Date(0)));
  assert.throws(() => canonicalJson({ at: new Date(0) }));
  assert.throws(() => canonicalJson(new Map([['a', 1]])));
  assert.throws(() => canonicalJson(new Set([1])));
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(() => canonicalJson([1, , 3]));
  assert.throws(() => canonicalJson(new Array(2)));
  assert.throws(() => canonicalJson([1, undefined]));
  assert.throws(() => canonicalJson({ a: 1n }));
  assert.equal(canonicalJson(Object.create(null)), '{}');
});
