// tests/scripts/addon/allowed.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addonAllowed } from '../../../scripts/addon/allowed.js';

// Stand-ins for the registry, the managed preference and the settings file; nothing real is read.
function world({ reg = {}, defaults = null, files = {}, throws = false } = {}) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    if (throws) throw new Error(`spawn ${file} ENOENT`);
    if (file === 'reg') {
      const hive = args[1].split('\\')[0];
      const value = reg[hive];
      return value === undefined
        ? { code: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.' }
        : { code: 0, stdout: `\r\n${args[1]}\r\n    AllowedExtensions    REG_SZ    ${value}\r\n\r\n`, stderr: '' };
    }
    if (file === 'defaults') {
      return defaults === null ? { code: 1, stdout: '', stderr: 'does not exist' } : { code: 0, stdout: `${defaults}\n`, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  const readFile = async (file) => {
    if (throws) throw new Error('EACCES');
    if (file in files) return files[file];
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  return { run, readFile, calls };
}
const MAC_SETTINGS = '/Users/p/Library/Application Support/Code/User/settings.json';
const WIN_SETTINGS = 'C:\\Users\\p\\AppData\\Roaming\\Code\\User\\settings.json';
const mac = (w) => addonAllowed({ platform: 'darwin', run: w.run, readFile: w.readFile, env: {}, home: '/Users/p', version: '0.2.6' });
const win = (w) => addonAllowed({ platform: 'win32', run: w.run, readFile: w.readFile, env: { APPDATA: 'C:\\Users\\p\\AppData\\Roaming' }, home: 'C:\\Users\\p', version: '0.2.6' });

test('no policy and no setting is "can\'t tell"', async () => {
  assert.equal((await mac(world())).allowed, null);
  assert.equal((await win(world())).allowed, null);
});

test('a policy naming the add-on allows it, one naming others blocks it', async () => {
  assert.equal((await mac(world({ defaults: '{"wheelhouse.wheelhouse": true}' }))).allowed, true);
  assert.equal((await mac(world({ defaults: '{"github": true}' }))).allowed, false);
  assert.equal((await win(world({ reg: { HKLM: '{"github": true}' } }))).allowed, false);
});

test('the publisher alone, "stable" and a version list allow it', async () => {
  assert.equal((await mac(world({ defaults: '{"wheelhouse": "stable"}' }))).allowed, true);
  assert.equal((await mac(world({ defaults: '{"wheelhouse": true}' }))).allowed, true);
  assert.equal((await mac(world({ defaults: '{"wheelhouse.wheelhouse": ["0.2.6"]}' }))).allowed, true);
  assert.equal((await mac(world({ defaults: '{"*": true}' }))).allowed, true);
});

test('an id set to false blocks it even when its publisher is allowed', async () => {
  assert.equal((await mac(world({ defaults: '{"wheelhouse": true, "wheelhouse.wheelhouse": false}' }))).allowed, false);
  assert.equal((await mac(world({ defaults: '{}' }))).allowed, false);
});

test('ids are compared without regard to case', async () => {
  assert.equal((await mac(world({ defaults: '{"Wheelhouse.Wheelhouse": true}' }))).allowed, true);
});

test('a policy that is not JSON, or holds a value that cannot be read, is "can\'t tell"', async () => {
  assert.equal((await mac(world({ defaults: '{oops' }))).allowed, null);
  assert.equal((await win(world({ reg: { HKLM: 'not json' } }))).allowed, null);
  assert.equal((await mac(world({ defaults: '{"wheelhouse.wheelhouse": 7}' }))).allowed, null);
  assert.equal((await mac(world({ defaults: '[1,2]' }))).allowed, null);
});

test('a policy that cannot be parsed does not fall back to a setting that would allow it', async () => {
  const w = world({ defaults: '{oops', files: { [MAC_SETTINGS]: '{"extensions.allowed": {"wheelhouse.wheelhouse": true}}' } });
  assert.equal((await mac(w)).allowed, null);
});

test('a policy wins over the setting', async () => {
  const files = { [MAC_SETTINGS]: '{"extensions.allowed": {"wheelhouse.wheelhouse": true}}' };
  assert.equal((await mac(world({ defaults: '{"wheelhouse.wheelhouse": false}', files }))).allowed, false);
});

test('the user setting is read when no policy is, comments and trailing commas allowed', async () => {
  const text = '{\n  // my list\n  "extensions.allowed": { "github": true, },\n}\n';
  assert.equal((await mac(world({ files: { [MAC_SETTINGS]: text } }))).allowed, false);
  assert.equal((await win(world({ files: { [WIN_SETTINGS]: '{"extensions.allowed": {"wheelhouse": true}}' } }))).allowed, true);
});

test('a settings file with a syntax error is "can\'t tell", never blocked', async () => {
  const got = await mac(world({ files: { [MAC_SETTINGS]: '{"extensions.allowed": {' } }));
  assert.equal(got.allowed, null);
});

test('a settings file with no allow list leaves the answer open, not blocked', async () => {
  const got = await mac(world({ files: { [MAC_SETTINGS]: '{"editor.fontSize": 14}' } }));
  assert.notEqual(got.allowed, false);
});

test('Windows reads the machine policy, then the user policy', async () => {
  const w = world({ reg: { HKCU: '{"wheelhouse.wheelhouse": true}' } });
  assert.equal((await win(w)).allowed, true);
  const hives = w.calls.filter((c) => c[0] === 'reg').map((c) => c[2].split('\\')[0]);
  assert.deepEqual(hives, ['HKLM', 'HKCU']);
  const machine = world({ reg: { HKLM: '{"github": true}', HKCU: '{"wheelhouse.wheelhouse": true}' } });
  assert.equal((await win(machine)).allowed, false);
});

test('a Mac reads the managed preference for VS Code', async () => {
  const w = world({ defaults: '{"wheelhouse": true}' });
  await mac(w);
  const call = w.calls.find((c) => c[0] === 'defaults');
  assert.deepEqual(call.slice(0, 3), ['defaults', 'read', '/Library/Managed Preferences/com.microsoft.VSCode']);
  assert.equal(call[3], 'AllowedExtensions');
});

test('a run or a read that throws is "can\'t tell", and nothing throws', async () => {
  assert.equal((await mac(world({ throws: true }))).allowed, null);
  assert.equal((await win(world({ throws: true }))).allowed, null);
  const got = await mac(world({ throws: true }));
  assert.equal(typeof got.why, 'string');
});

const ver = (w, version, platform = 'darwin') => addonAllowed({ platform, run: w.run, readFile: w.readFile, env: {}, home: '/Users/p', version });

test('a version list that leaves out this version reads as blocked, as VS Code treats it', async () => {
  assert.equal((await ver(world({ defaults: '{"wheelhouse.wheelhouse": ["0.1.0"]}' }), '0.2.6')).allowed, false);
  assert.equal((await ver(world({ defaults: '{"wheelhouse.wheelhouse": ["0.1.0", "0.2.6"]}' }), '0.2.6')).allowed, true);
  assert.equal((await ver(world({ defaults: '{"wheelhouse": ["0.1.0"]}' }), '0.2.6')).allowed, false);
});

test('a version list that names this version only for a platform is "can\'t tell"', async () => {
  assert.equal((await ver(world({ defaults: '{"wheelhouse.wheelhouse": ["0.2.6@win32-x64"]}' }), '0.2.6')).allowed, null);
});

test('a version list when this version is not known is "can\'t tell"', async () => {
  assert.equal((await ver(world({ defaults: '{"wheelhouse.wheelhouse": ["0.1.0"]}' }), null)).allowed, null);
});

test('Linux reads /etc/vscode/policy.json, then the user setting', async () => {
  const policy = (value) => ({ '/etc/vscode/policy.json': JSON.stringify({ AllowedExtensions: value }) });
  assert.equal((await ver(world({ files: policy({ other: true }) }), '0.2.6', 'linux')).allowed, false);
  assert.equal((await ver(world({ files: policy({ wheelhouse: true }) }), '0.2.6', 'linux')).allowed, true);
  // The value may be the JSON as text.
  assert.equal((await ver(world({ files: policy('{"wheelhouse": true}') }), '0.2.6', 'linux')).allowed, true);
  // A policy beats the setting.
  const files = { ...policy({ other: true }), '/Users/p/.config/Code/User/settings.json': '{"extensions.allowed": {"wheelhouse": true}}' };
  assert.equal((await ver(world({ files }), '0.2.6', 'linux')).allowed, false);
  // A policy file that isn't JSON is "can't tell".
  assert.equal((await ver(world({ files: { '/etc/vscode/policy.json': '{oops' } }), '0.2.6', 'linux')).allowed, null);
  // A policy file with no AllowedExtensions leaves the setting to decide.
  const other = { '/etc/vscode/policy.json': '{"UpdateMode": "none"}', '/Users/p/.config/Code/User/settings.json': '{"extensions.allowed": {"wheelhouse": true}}' };
  assert.equal((await ver(world({ files: other }), '0.2.6', 'linux')).allowed, true);
});
