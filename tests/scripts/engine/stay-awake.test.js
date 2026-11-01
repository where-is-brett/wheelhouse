// tests/scripts/engine/stay-awake.test.js
// Holding the Mac awake (unattended goals design, section 9.1): `caffeinate` tied to the helper's process, with a
// stand-in for spawn, so nothing real runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { stayAwake } from '../../../scripts/engine/stay-awake.js';
import { until } from '../../helpers/until.js';

function fakeSpawn() {
  const calls = [];
  const spawn = (file, args) => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    calls.push({ file, args, child });
    return child;
  };
  return { spawn, calls };
}

test('set(true) twice spawns one caffeinate, tied to the helper', () => {
  const s = fakeSpawn();
  const awake = stayAwake({ platform: 'darwin', spawn: s.spawn, pid: 4242 });
  awake.set(true);
  awake.set(true);
  assert.deepEqual(s.calls.map(({ file, args }) => [file, ...args]), [['caffeinate', '-s', '-w', '4242']]);
});

test('set(false) ends it, and nothing starts it again', async () => {
  const s = fakeSpawn();
  const awake = stayAwake({ platform: 'darwin', spawn: s.spawn, pid: 4242, againMs: 1 });
  awake.set(true);
  awake.set(false);
  assert.equal(s.calls[0].child.killed, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(s.calls.length, 1);
  awake.set(false);
  awake.set(true);
  assert.equal(s.calls.length, 2, 'wanted again, it starts again');
  awake.set(false);
});

test('a child that exits while wanted is spawned again', async () => {
  const s = fakeSpawn();
  const awake = stayAwake({ platform: 'darwin', spawn: s.spawn, pid: 4242, againMs: 1 });
  awake.set(true);
  s.calls[0].child.emit('exit', 1, null);
  await until(() => s.calls.length === 2);
  awake.set(false);
});

test('a child that could not start is tried again no faster than its pause, and set(false) ends the wait', async () => {
  const s = fakeSpawn();
  const awake = stayAwake({ platform: 'darwin', spawn: s.spawn, pid: 4242, againMs: 60 * 60 * 1000 });
  awake.set(true);
  s.calls[0].child.emit('error', new Error('no such program'));
  s.calls[0].child.emit('exit', 1, null);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(s.calls.length, 1, 'one failure, one wait, no spin');
  awake.set(false);
});

test('a spawn that throws is taken as a child that could not start', () => {
  const awake = stayAwake({ platform: 'darwin', spawn: () => { throw new Error('no'); }, pid: 4242, againMs: 60 * 60 * 1000 });
  awake.set(true);
  awake.set(false);
});

test('on any other system nothing spawns', () => {
  for (const platform of ['win32', 'linux']) {
    const s = fakeSpawn();
    const awake = stayAwake({ platform, spawn: s.spawn, pid: 4242 });
    awake.set(true);
    awake.set(false);
    assert.equal(s.calls.length, 0);
  }
});
