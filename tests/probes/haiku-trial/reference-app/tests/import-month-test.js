// tests/probes/haiku-trial/reference-app/tests/import-month-test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let child;
let base;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), LEDGER_DB: ':memory:' };
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
  child = spawn(process.execPath, ['src/server.js'], { cwd: root, env, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`${base}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('the app did not start');
});

after(() => child?.kill());

test('an imported statement shows up in its month, refunds taking away', async () => {
  const csv = 'Date,Description,Amount\r\n05/09/2026,Quillon Books,50.00\r\n06/09/2026,Quillon Books REFUND,(40.00)\r\n';
  const data = new FormData();
  data.append('statement', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
  const imported = await fetch(`${base}/import`, { method: 'POST', body: data });
  assert.match(await imported.text(), /Added 2, skipped 0/);
  const month = await (await fetch(`${base}/month?m=2026-09`)).text();
  assert.match(month, /data-category="shopping" data-total="10\.00"/);
  assert.match(month, /data-category="all" data-total="10\.00"/);
});
