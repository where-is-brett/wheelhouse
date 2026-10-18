// tests/scripts/host/keys.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readKey, writeKey } from '../../../scripts/host/keys.js';
import { withHome } from '../../helpers/homes.js';
import { keysDir } from '../../../scripts/lib/paths.js';

test('writeKey keeps a key in keys/<name>.json and readKey reads it back', () => {
  withHome(() => {
    const value = { clientId: 'Iv1.abc', installationId: 42, accessToken: 'ghu_A', accessExpiresAt: null, refreshToken: null, refreshExpiresAt: null };
    writeKey('github-app', value);
    assert.deepEqual(readKey('github-app'), value);
    const file = path.join(keysDir(), 'github-app.json');
    assert.ok(fs.existsSync(file));
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    writeKey('gitlab-project-4242', { kind: 'pasted-token', token: 'glpat-X', expiresAt: null });
    assert.equal(readKey('gitlab-project-4242').kind, 'pasted-token');
    assert.deepEqual(fs.readdirSync(keysDir()).sort(), ['github-app.json', 'gitlab-project-4242.json'], 'no temporary file is left');
  });
});

test('writeKey replaces an existing key', () => {
  withHome(() => {
    writeKey('github-app', { accessToken: 'one' });
    writeKey('github-app', { accessToken: 'two' });
    assert.equal(readKey('github-app').accessToken, 'two');
  });
});

test('readKey returns null when there is no such key', () => {
  withHome(() => {
    assert.equal(readKey('github-app'), null);
  });
});

test('only github-app and gitlab-project-<digits> are allowed', () => {
  withHome(() => {
    for (const name of ['signing', '../github-app', 'gitlab-project-', 'gitlab-project-12a', 'gitlab-project-1/2', 'GITHUB-APP', '', undefined]) {
      assert.throws(() => writeKey(name, {}), /key name/, String(name));
      assert.throws(() => readKey(name), /key name/, String(name));
    }
  });
});

test('a damaged key file is named, and its contents are not repeated', () => {
  withHome(() => {
    fs.mkdirSync(keysDir(), { recursive: true });
    fs.writeFileSync(path.join(keysDir(), 'github-app.json'), '{"accessToken":"ghu_LEAKED"');
    assert.throws(() => readKey('github-app'), (error) => {
      assert.match(error.message, /github-app\.json/);
      assert.doesNotMatch(error.message, /LEAKED/);
      return true;
    });
    fs.writeFileSync(path.join(keysDir(), 'github-app.json'), '"ghu_LEAKED"');
    assert.throws(() => readKey('github-app'), /github-app\.json/);
  });
});

test('writeKey refuses something that is not an object', () => {
  withHome(() => {
    for (const value of [null, 'ghu_X', 5, ['a']]) assert.throws(() => writeKey('github-app', value), /object/);
  });
});
