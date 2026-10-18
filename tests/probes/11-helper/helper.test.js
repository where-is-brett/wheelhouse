// tests/probes/11-helper/helper.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startHelper } from '../../../probes/11-helper/helper.js';

function get(options) {
  return new Promise((resolve, reject) => {
    http.get(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('the helper answers ping on a port on 127.0.0.1', async () => {
  const helper = await startHelper({ port: 0 });
  try {
    assert.equal(helper.address.host, '127.0.0.1');
    const reply = await get({ host: '127.0.0.1', port: helper.address.port, path: '/ping' });
    assert.equal(reply.status, 200);
    assert.equal(JSON.parse(reply.body).ok, true);
  } finally {
    await helper.close();
  }
});

test('the helper answers ping on a socket file', { skip: process.platform === 'win32' }, async () => {
  const socketPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'helper-')), 'helper.sock');
  const helper = await startHelper({ socketPath });
  try {
    const reply = await get({ socketPath, path: '/ping' });
    assert.equal(JSON.parse(reply.body).ok, true);
  } finally {
    await helper.close();
  }
});

test('the helper answers unknown paths with 404', async () => {
  const helper = await startHelper({ port: 0 });
  try {
    const reply = await get({ host: '127.0.0.1', port: helper.address.port, path: '/push-to-main' });
    assert.equal(reply.status, 404);
  } finally {
    await helper.close();
  }
});
