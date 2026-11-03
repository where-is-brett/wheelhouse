// tests/scripts/secrets/secret-box.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askSecretCommand, storeSecretCommand, storeSecretInput, readSecretCommand, readSecretInput, deleteSecretCommand, storeSecret, readSecret, deleteSecret } from '../../../scripts/secrets/secret-box.js';

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
  assert.throws(() => storeSecretCommand('freebsd', where), /macOS and Windows/);
});

test('on Linux a secret goes through the credential helper under Wheelhouse\'s own protocol, on standard input', async () => {
  const calls = [];
  const runner = async (command, input) => {
    calls.push({ command, input });
    return { code: 0, out: command.args[1] === 'fill' ? 'protocol=wheelhouse\nhost=wheelhouse-probe\nusername=host-token\npassword=S3CRET-probe\n' : '' };
  };
  await storeSecret({ ...where, secret: 'S3CRET-probe' }, 'linux', runner);
  assert.equal(await readSecret(where, 'linux', runner), 'S3CRET-probe');
  await deleteSecret(where, 'linux', runner);
  assert.deepEqual(calls.map((c) => c.command.args[1]), ['approve', 'fill', 'reject']);
  for (const call of calls) {
    assert.ok(!call.command.args.some((arg) => arg.includes('S3CRET')));
    assert.match(call.input, /^protocol=wheelhouse\nhost=wheelhouse-probe\nusername=host-token\n/);
  }
  assert.equal(readSecretInput('darwin', where), '');
});

test('a read gives null when the system has nothing or no helper', async () => {
  assert.equal(await readSecret(where, 'linux', async () => ({ code: 128, out: '' })), null);
  assert.equal(await readSecret(where, 'linux', async () => { throw new Error('spawn git ENOENT'); }), null);
  assert.equal(await readSecret(where, 'darwin', async () => ({ code: 44, out: '' })), null);
  assert.equal(await readSecret(where, 'darwin', async () => ({ code: 0, out: 'abc\n' })), 'abc');
  await deleteSecret(where, 'linux', async () => { throw new Error('spawn git ENOENT'); });
});

test('a delete that fails while the secret is still there is an error; one that finds nothing is not', async () => {
  const locked = async (command) => (command.args[0] === 'delete-generic-password' ? { code: 1, out: '' } : { code: 0, out: 'abc\n' });
  await assert.rejects(deleteSecret(where, 'darwin', locked), /could not be deleted/);
  const absent = async (command) => (command.args[0] === 'delete-generic-password' ? { code: 44, out: '' } : { code: 44, out: '' });
  await deleteSecret(where, 'darwin', absent);
  await assert.rejects(deleteSecret(where, 'darwin', async (command) => { if (command.args[0] === 'delete-generic-password') throw new Error('denied'); return { code: 0, out: 'abc\n' }; }), /could not be deleted/);
});

test('a store that fails or cannot run says so without the secret', async () => {
  await assert.rejects(storeSecret({ ...where, secret: 'S3CRET-probe' }, 'darwin', async () => ({ code: 1, out: '' })), (e) => !e.message.includes('S3CRET'));
  await assert.rejects(storeSecret({ ...where, secret: 'S3CRET-probe' }, 'darwin', async () => { throw new Error('S3CRET-probe'); }), (e) => !e.message.includes('S3CRET'));
  assert.throws(() => storeSecretInput('linux', where, 'a\nb'), /span lines/);
});
