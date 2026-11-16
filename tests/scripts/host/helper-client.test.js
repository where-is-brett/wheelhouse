// tests/scripts/host/helper-client.test.js
// The client's answer when the helper cannot be reached: a sandbox that refuses the socket is told apart from a
// helper that is not running, and both keep the words callers match on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { helperClient, SANDBOXED } from '../../../scripts/host/helper-client.js';

test('a socket nothing listens on is a helper that is not running', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-client-'));
  try {
    const got = await helperClient({ address: path.join(dir, 'helper.sock') }).health();
    assert.equal(got.ok, false);
    assert.equal(got.refused, 'the host helper could not be reached: is it running?');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A sandbox's refusal comes as EPERM; a socket its user may not open gives EACCES the same way, which a test can make.
test('a socket the command may not open is the sandbox, and says to run the command outside it', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-client-'));
  const address = path.join(dir, 'helper.sock');
  const server = net.createServer((s) => s.end());
  await new Promise((resolve) => server.listen(address, resolve));
  try {
    fs.chmodSync(address, 0o000);
    const got = await helperClient({ address }).health();
    assert.equal(got.ok, false);
    assert.equal(got.refused, SANDBOXED);
    assert.match(got.refused, /could not be reached/);
    assert.match(got.refused, /outside the sandbox/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
