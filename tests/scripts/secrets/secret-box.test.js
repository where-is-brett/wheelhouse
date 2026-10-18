// tests/scripts/secrets/secret-box.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askSecretCommand, storeSecretCommand, storeSecretInput, readSecretCommand, deleteSecretCommand } from '../../../scripts/secrets/secret-box.js';

const box = { title: 'Wheelhouse', prompt: 'Paste the token' };
const where = { service: 'wheelhouse-probe', account: 'host-token' };

test('askSecretCommand opens a hidden dialog on macOS', () => {
  const command = askSecretCommand('darwin', box);
  assert.equal(command.file, 'osascript');
  assert.match(command.args.join(' '), /with hidden answer/);
});

test('askSecretCommand opens a hidden dialog on Windows', () => {
  const command = askSecretCommand('win32', box);
  assert.equal(command.file, 'powershell');
  assert.match(command.args.join(' '), /UseSystemPasswordChar/);
});

test('askSecretCommand passes the wording as data, never inside the script', () => {
  const tricky = { title: 'A "quoted" title', prompt: "It's \"here\"" };
  const mac = askSecretCommand('darwin', tricky);
  const scriptArgs = mac.args.slice(0, mac.args.indexOf('--'));
  assert.ok(!scriptArgs.some((arg) => arg.includes('here')), 'macOS: prompt inside the script');
  assert.deepEqual(mac.args.slice(mac.args.indexOf('--') + 1), [tricky.prompt, tricky.title]);
  const windows = askSecretCommand('win32', tricky);
  assert.ok(!windows.args.some((arg) => arg.includes('here')), 'Windows: prompt inside the script');
});

test('storeSecretCommand never puts the secret in its arguments', () => {
  for (const platform of ['darwin', 'win32']) {
    const command = storeSecretCommand(platform, where);
    assert.equal(command.stdin, true);
    assert.ok(!command.args.some((arg) => arg.includes('S3CRET-probe')), platform);
  }
});

test('storeSecretInput carries the secret on stdin', () => {
  for (const platform of ['darwin', 'win32']) {
    assert.ok(storeSecretInput(platform, where, 'S3CRET-probe').includes('S3CRET-probe'), platform);
  }
});

test('readSecretCommand and deleteSecretCommand name the service and account', () => {
  for (const platform of ['darwin', 'win32']) {
    const joined = [...readSecretCommand(platform, where).args, ...deleteSecretCommand(platform, where).args].join(' ');
    assert.match(joined, /wheelhouse-probe/);
    assert.match(joined, /host-token/);
  }
});

test('an unsupported system is refused', () => {
  assert.throws(() => askSecretCommand('linux', box), /macOS and Windows/);
});
