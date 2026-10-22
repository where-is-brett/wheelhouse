// tests/probes/52-low-integrity/credential-manager.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialManagerLine, VAULT_READ, VAULT_STORE } from '../../../probes/52-low-integrity/run.js';

test('the Credential Manager line is a count or the word refused', () => {
  assert.equal(credentialManagerLine({ ok: true, stdout: 'length=24\r\n' }), 'read 24 characters');
  assert.equal(credentialManagerLine({ ok: false, code: 'EXIT', stdout: '', stderr: 'Element not found' }), 'refused');
  assert.equal(credentialManagerLine({ ok: true, stdout: '' }), 'refused');
  assert.equal(credentialManagerLine(null), 'refused');
});

test('the made-up value goes in by environment and the read prints only a length', () => {
  assert.match(VAULT_STORE, /\$env:WHEELHOUSE_PROBE_52_VALUE/);
  assert.match(VAULT_READ, /Password\.Length/);
  assert.doesNotMatch(VAULT_READ, /Write-Output \$c\.Password\b/);
});
