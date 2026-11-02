// tests/scripts/host/retire-helper.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOlder, stopByProcess, helperProcesses } from '../../../scripts/host/retire-helper.js';

test('isOlder compares numbers, and a newer, equal or unreadable version is not older', () => {
  assert.equal(isOlder('0.2.3', '0.2.4'), true);
  assert.equal(isOlder('0.2.9', '0.2.10'), true);
  assert.equal(isOlder('0.2.10', '0.2.9'), false);
  assert.equal(isOlder('0.2.4', '0.2.4'), false);
  assert.equal(isOlder('0.3.0', '0.2.4'), false);
  assert.equal(isOlder('0.2', '0.2.1'), true);
  assert.equal(isOlder('soon', '0.2.4'), false);
  assert.equal(isOlder(undefined, '0.2.4'), false);
  assert.equal(isOlder('0.2.3', null), false);
});

test('stopByProcess ends exactly one helper process, never this one, and nothing when it is unsure', async () => {
  const killed = [];
  const kill = (pid) => killed.push(pid);
  assert.equal(await stopByProcess({ processes: async () => [41], kill, self: 7 }), true);
  assert.deepEqual(killed, [41]);
  assert.equal(await stopByProcess({ processes: async () => [41, 42], kill, self: 7 }), false);
  assert.equal(await stopByProcess({ processes: async () => [7], kill, self: 7 }), false);
  assert.equal(await stopByProcess({ processes: async () => [], kill, self: 7 }), false);
  assert.deepEqual(killed, [41]);
});

test('helperProcesses picks Node processes running the helper script, and no other', async () => {
  const ps = ' 10 /usr/bin/node /x/scripts/host/helper-main.js\n 11 /usr/bin/vim scripts/host/helper-main.js\n 12 /usr/bin/node /x/scripts/watcher/main.js\n';
  assert.deepEqual(await helperProcesses({ platform: 'darwin', run: async () => ({ code: 0, stdout: ps }) }), [10]);
  const json = JSON.stringify([{ ProcessId: 5, CommandLine: 'node.exe C:\\p\\scripts\\host\\helper-main.js' }, { ProcessId: 6, CommandLine: 'node.exe other.js' }]);
  assert.deepEqual(await helperProcesses({ platform: 'win32', run: async () => ({ code: 0, stdout: json }) }), [5]);
  assert.deepEqual(await helperProcesses({ platform: 'darwin', run: async () => { throw new Error('no'); } }), []);
});
