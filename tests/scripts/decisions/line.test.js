// tests/scripts/decisions/line.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_KINDS, DIRECTOR_KINDS, sideOf } from '../../../scripts/decisions/line.js';

test('each listed kind is on its own side', () => {
  for (const k of DIRECTOR_KINDS) assert.equal(sideOf(k), 'director', k);
  for (const k of AGENT_KINDS) assert.equal(sideOf(k), 'agent', k);
});

test('an unknown kind is the director\'s', () => {
  assert.equal(sideOf('colour-scheme'), 'director');
  assert.equal(sideOf(''), 'director');
  assert.equal(sideOf(undefined), 'director');
  assert.equal(sideOf('Structure'), 'director');
});

test('no kind is on both sides', () => {
  assert.deepEqual(DIRECTOR_KINDS.filter((k) => AGENT_KINDS.includes(k)), []);
});
