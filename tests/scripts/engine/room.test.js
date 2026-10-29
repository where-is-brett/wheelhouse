// tests/scripts/engine/room.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engineRoom, roomCommand, ROOM_HOST, roomLine } from '../../../scripts/engine/room.js';
import { ENGINE_ROOM_PORT } from '../../../scripts/protection/archon.js';
import { archonCommand } from '../../../scripts/engine/archon/cli.js';

// A Node.js folder with no gh beside it (a Linux runner's /usr/bin has one, which the engine's environment swaps out).
const NODE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-room-node-'));

function stubSpawn() {
  const children = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.pid = 5000 + children.length;
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    children.push({ command, args, options, child });
    return child;
  };
  return { spawn, children };
}

test('the engine room binds 127.0.0.1 only and shows on the Logbook', async () => {
  const command = roomCommand({ engine: '/e', home: '/h', nodeDir: NODE_DIR });
  const plain = archonCommand(['serve'], { engine: '/e', home: '/h', nodeDir: NODE_DIR });
  assert.deepEqual(command.args, ['serve']);
  assert.equal(command.command, plain.command);
  assert.equal(command.env.HOST, '127.0.0.1');
  assert.equal(ROOM_HOST, '127.0.0.1');
  assert.equal(command.env.PORT, String(ENGINE_ROOM_PORT));
  // Everything else is the engine's one environment, telemetry off included.
  assert.equal(command.env.ARCHON_TELEMETRY_DISABLED, '1');
  assert.deepEqual({ ...command.env, HOST: undefined, PORT: undefined }, { ...plain.env, HOST: undefined, PORT: undefined });

  let wanted = false;
  const { spawn, children } = stubSpawn();
  const room = engineRoom({ spawn, command: () => command, wanted: () => wanted });
  room.tend();
  assert.equal(children.length, 0, 'off by default');
  assert.equal(room.line(), null);
  wanted = true;
  room.tend();
  room.tend();
  assert.equal(children.length, 1, 'one console, however often it is tended');
  assert.equal(children[0].options.env.HOST, '127.0.0.1');
  assert.equal(room.line(), roomLine());
  assert.match(roomLine(), /127\.0\.0\.1:3090/);
  assert.match(roomLine(), /this computer only/);
  wanted = false;
  room.tend();
  assert.equal(children[0].child.killed, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(room.line(), null);
});

test('the engine room is closed under All stop, and a console that ends is started again while it is on', async () => {
  const { spawn, children } = stubSpawn();
  let held = false;
  const room = engineRoom({ spawn, command: () => roomCommand({ engine: '/e', home: '/h', nodeDir: NODE_DIR }), wanted: () => true, held: () => held });
  room.tend();
  children[0].child.emit('exit', 1, null);
  room.tend();
  assert.equal(children.length, 2);
  held = true;
  room.tend();
  assert.equal(children[1].child.killed, true);
  room.stop();
});

// The engine room's console as a real process of its own, detached as the helper starts it: the helper's close ends it.
test('the engine room ends when the helper closes', { skip: process.platform === 'win32' }, async () => {
  const { openWorld, until } = await import('../../../scripts/eval/engine-world.js');
  const { confirmationFor } = await import('../../../scripts/state/events.js');
  const { spawn: realSpawn } = await import('node:child_process');
  let consolePid = null;
  const spawn = (command, args, options) => {
    if (args?.[0] !== 'serve') return stubSpawn().spawn(command, args, options);
    const child = realSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, env: process.env });
    consolePid = child.pid;
    return child;
  };
  const world = await openWorld({
    spawn,
    adapt: (engine) => Object.assign(engine, { roomCommand: () => ({ command: 'archon', args: ['serve'], env: {} }) }),
    seed: (w) => {
      const setting = w.put('setting', { key: 'engineRoom', value: true, words: 'Engine room: on' });
      w.put('confirmation', confirmationFor(setting).data);
    },
  });
  const alive = () => { try { process.kill(consolePid, 0); return true; } catch { return false; } };
  try {
    assert.ok(await until(() => consolePid !== null && alive()), 'the console started');
  } finally {
    await world.close();
  }
  assert.ok(await until(() => !alive()), 'the console ended with the helper');
});
