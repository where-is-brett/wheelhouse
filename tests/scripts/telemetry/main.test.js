// tests/scripts/telemetry/main.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordsHandler, receiverPort, maintain } from '../../../scripts/telemetry/main.js';

const MAIN = fileURLToPath(new URL('../../../scripts/telemetry/main.js', import.meta.url));
const fixture = fs.readFileSync(new URL('../../fixtures/otlp-metrics.json', import.meta.url), 'utf8');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('Timed out waiting');
    await sleep(25);
  }
}

async function health(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

function start(home, port) {
  fs.mkdirSync(path.join(home, 'usage'), { recursive: true });
  fs.writeFileSync(path.join(home, 'usage', 'receiver.json'), JSON.stringify({ port }));
  const child = spawn(process.execPath, [MAIN], { env: { ...process.env, WHEELHOUSE_HOME: home }, stdio: 'ignore', windowsHide: true });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, exited };
}

test('the receiver hands points on after its answer is on its way, not before', async () => {
  const seen = [];
  const handle = recordsHandler({ addPoints: (points) => seen.push(points), now: () => new Date('2026-10-19T00:00:00Z') });
  handle([{ n: 1 }]);
  handle([{ n: 2 }]);
  assert.equal(seen.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [[{ n: 1 }], [{ n: 2 }]]);
});

test('a write that fails does not stop the next one', async () => {
  const seen = [];
  const handle = recordsHandler({ addPoints: (points) => { if (points[0] === 1) throw new Error('disk'); seen.push(points[0]); } });
  handle([1]);
  handle([2]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [2]);
});

test('the port is the one in usage/receiver.json, or the usual one', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-rp-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    assert.equal(receiverPort(), 14318);
    fs.mkdirSync(path.join(home, 'usage'));
    fs.writeFileSync(path.join(home, 'usage', 'receiver.json'), JSON.stringify({ port: 23456 }));
    assert.equal(receiverPort(), 23456);
    for (const bad of ['{"port":"x"}', '{"port":70000}', '{"port":0}', 'not json', '[]']) {
      fs.writeFileSync(path.join(home, 'usage', 'receiver.json'), bad);
      assert.equal(receiverPort(), 14318, bad);
    }
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the day\'s work summarises yesterday and prunes', () => {
  const calls = [];
  maintain({
    now: new Date('2026-10-19T00:30:00Z'),
    summarise: (date) => calls.push(['summarise', date]),
    prune: ({ now }) => calls.push(['prune', now.toISOString()]),
  });
  assert.deepEqual(calls, [['summarise', '2026-10-18'], ['prune', '2026-10-19T00:30:00.000Z']]);
  // A failure in one does not stop the other, or throw.
  const after = [];
  maintain({ now: new Date('2026-10-19T00:30:00Z'), summarise: () => { throw new Error('x'); }, prune: () => after.push('prune') });
  assert.deepEqual(after, ['prune']);
});

test('the receiver process answers before writing, and a second copy exits', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-rm-'));
  const port = await freePort();
  const first = start(home, port);
  let second;
  try {
    await until(() => health(port));
    const res = await fetch(`http://127.0.0.1:${port}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: fixture });
    assert.equal(res.status, 200);
    // The counts reach the disk after the answer.
    const records = await until(() => {
      const dir = path.join(home, 'usage', 'records');
      try {
        const names = fs.readdirSync(dir);
        return names.length > 0 ? names : null;
      } catch { return null; }
    });
    assert.ok(records.length >= 1);
    assert.ok(fs.existsSync(path.join(home, 'usage', 'series.json')));

    second = start(home, port);
    assert.equal(await second.exited, 0);
    assert.equal(await health(port), true);
    assert.equal(first.child.exitCode, null);
  } finally {
    first.child.kill();
    second?.child.kill();
    await first.exited;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
