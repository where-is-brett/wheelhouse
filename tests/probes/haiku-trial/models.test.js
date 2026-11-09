// tests/probes/haiku-trial/models.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, DEFAULT_MODEL, parseModel, modelPattern } from '../../../probes/haiku-trial/models.js';

test('the kit runs on haiku or sonnet, haiku by default', () => {
  assert.deepEqual(MODELS, ['haiku', 'sonnet']);
  assert.equal(DEFAULT_MODEL, 'haiku');
  assert.equal(parseModel(undefined), 'haiku');
  assert.equal(parseModel('Sonnet'), 'sonnet');
  assert.throws(() => parseModel('opus'), /--model must be haiku or sonnet/);
  assert.throws(() => parseModel(''), /--model must be haiku or sonnet/);
});

test('the pattern for a model matches its own names only', () => {
  assert.ok(modelPattern('sonnet').test('claude-sonnet-4-5'));
  assert.ok(!modelPattern('sonnet').test('claude-haiku-4-5'));
  assert.ok(modelPattern('haiku').test('claude-haiku-4-5'));
});
