// tests/scripts/lib/start-lock.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { takeStartLock } from '../../../scripts/lib/start-lock.js';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wh-sl-'));

test('a start lock is exclusive, released, and gives up with the caller\'s own wording', async () => {
  const dir = folder();
  try {
    const file = path.join(dir, 'x.lock');
    const release = await takeStartLock(file, { message: 'Another thing is starting', waitMs: 150 });
    assert.equal(fs.readFileSync(file, 'utf8').trim(), String(process.pid));
    await assert.rejects(takeStartLock(file, { message: 'Another thing is starting', waitMs: 150 }), /Another thing is starting/);
    release();
    assert.equal(fs.existsSync(file), false);
    (await takeStartLock(file, { message: 'x', waitMs: 150 }))();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a lock whose process has gone, or that is older than the staleness, is taken over', async () => {
  const dir = folder();
  try {
    const file = path.join(dir, 'x.lock');
    fs.writeFileSync(file, '2147483646\n');
    (await takeStartLock(file, { message: 'x', waitMs: 500 }))();
    fs.writeFileSync(file, `${process.pid}\n`);
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(file, old, old);
    (await takeStartLock(file, { message: 'x', waitMs: 500, staleMs: 1000 }))();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
