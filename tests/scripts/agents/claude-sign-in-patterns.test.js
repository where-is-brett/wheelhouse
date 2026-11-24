// tests/scripts/agents/claude-sign-in-patterns.test.js
// How Claude Code words a start that couldn't sign in, and that the adapter hands the words to the core's gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import claudeCode from '../../../adapters/claude-code/index.js';
import claudeSessions from '../../../adapters/claude-code/sessions.js';
import { signInPatterns } from '../../../adapters/claude-code/sign-in-patterns.js';
import { checkAdapter } from '../../../scripts/agents/contract.js';
import { classify } from '../../../scripts/lib/sign-in-gate.js';

const kind = (said) => classify(said, { code: 1 }, signInPatterns);

test('the adapter exposes the patterns, and still fits the contract', () => {
  assert.equal(claudeCode.signInPatterns, signInPatterns);
  assert.equal(claudeSessions.signInPatterns, signInPatterns, 'the waker reads them from the sessions part');
  assert.deepEqual(checkAdapter(claudeCode), []);
  assert.deepEqual(Object.keys(signInPatterns).sort(), ['blocked', 'notSignedIn']);
  assert.ok(Object.values(signInPatterns).every((list) => list.every((re) => re instanceof RegExp)));
});

test('"Not logged in · Please run /login" is not-signed-in, and so are an invalid key and an expired token', () => {
  assert.equal(kind('Not logged in · Please run /login'), 'not-signed-in');
  assert.equal(kind('Invalid API key · Please run /login'), 'not-signed-in');
  assert.equal(kind('OAuth token has expired'), 'not-signed-in');
  assert.equal(kind('Error: OAuth token expired'), 'not-signed-in');
});

test('a 403 naming an organisation or a policy is blocked, even when it also asks for a login', () => {
  assert.equal(kind('403 Forbidden: this organization has not allowed it'), 'blocked');
  assert.equal(kind('Your organisation policy blocks this (403). Please run /login'), 'blocked');
});

test('ENOENT is no-program, and anything else is other', () => {
  assert.equal(classify('', { code: null, error: { code: 'ENOENT', message: 'spawn claude ENOENT' } }, signInPatterns), 'no-program');
  assert.equal(kind('Error: tests failed'), 'other');
  assert.equal(kind('The build is forbidden from touching the lockfile'), 'other');
  assert.equal(kind(''), 'other');
});
