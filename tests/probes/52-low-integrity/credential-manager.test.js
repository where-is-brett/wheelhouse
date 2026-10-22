// tests/probes/52-low-integrity/credential-manager.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialManagerLine, VAULT_READ, VAULT_REMOVE, VAULT_STORE, VAULT_TARGET } from '../../../probes/52-low-integrity/run.js';

test('the Credential Manager line is a count, refused (access denied only), or inconclusive', () => {
  assert.equal(credentialManagerLine({ ok: true, stdout: 'length=24\r\n' }), 'read 24 characters');
  assert.equal(credentialManagerLine({ ok: true, stdout: 'error=5\r\n' }), 'refused');
  assert.match(credentialManagerLine({ ok: true, stdout: 'error=1168' }), /^inconclusive: Windows error 1168/);
  assert.match(credentialManagerLine({ ok: false, stdout: '', stderr: 'Add-Type failed' }), /^inconclusive/);
  assert.match(credentialManagerLine(null), /^inconclusive/);
});

test('the trial is a generic credential on one made-up target, with the value by environment and only a length read back', () => {
  assert.equal(VAULT_TARGET, 'wheelhouse-probe-52');
  for (const script of [VAULT_STORE, VAULT_READ, VAULT_REMOVE]) {
    assert.match(script, /Add-Type/);
    assert.match(script, /\$t = 'wheelhouse-probe-52'/);
    assert.match(script, /CredWriteW[\s\S]*CredReadW[\s\S]*CredDeleteW/);
    assert.doesNotMatch(script, /CredEnumerate/);
  }
  assert.match(VAULT_STORE, /\$env:WHEELHOUSE_PROBE_52_VALUE/);
  assert.match(VAULT_STORE, /c\.Type = 1/);
  assert.match(VAULT_READ, /Length\(\$t\)/);
  assert.doesNotMatch(VAULT_READ, /UnicodeToString|PtrToStringUni|CredentialBlob\)/);
});
