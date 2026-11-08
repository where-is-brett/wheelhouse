// tests/probes/haiku-trial/product.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startProduct, request } from '../../../probes/haiku-trial/product.js';
import { REFERENCE } from './variants.js';

test('startProduct starts the reference app and stops it', async () => {
  const product = await startProduct({ dir: REFERENCE });
  try {
    const res = await request(`${product.url}/`);
    assert.equal(res.status, 200);
  } finally {
    await product.stop();
  }
  assert.throws(() => process.kill(product.pid, 0));
});

test('startProduct rejects within timeoutMs when nothing listens', async () => {
  const marker = `idle-${process.pid}-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-idle-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { start: `node -e "setInterval(()=>{},1000)" ${marker}` } }),
  );
  const timeoutMs = 1500;
  const began = Date.now();
  await assert.rejects(startProduct({ dir, timeoutMs }), /product did not start/);
  assert.ok(Date.now() - began < timeoutMs + 2000);
  for (let i = 0; i < 20 && spawnSync('pgrep', ['-f', marker]).status === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(spawnSync('pgrep', ['-f', marker]).status, 1, 'the idle process is gone');
});

test('request times out without throwing', async () => {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await request(`http://127.0.0.1:${server.address().port}/`, { timeoutMs: 300 });
    assert.equal(res.status, 0);
    assert.equal(res.text, 'timed out');
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
