// tests/scripts/lib/kept-request.test.js
// The director's request, kept while setup comes first, so a new session started part-way through setup still has it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keepRequest, keptRequest, clearRequest, MOST_CHARS } from '../../../scripts/lib/kept-request.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

test('the first request is kept as written, once, and cleared when setup is finished', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-kept '));
    assert.equal(keptRequest(folder), null);
    assert.equal(keepRequest(folder, '  I want a tool for tracking tide tables.  '), true);
    assert.equal(keptRequest(folder), 'I want a tool for tracking tide tables.');
    // A later prompt does not replace it.
    assert.equal(keepRequest(folder, 'Something else'), false);
    assert.equal(keptRequest(folder), 'I want a tool for tracking tide tables.');
    // Another folder has its own.
    const other = fs.realpathSync.native(tempFolder('wh-kept '));
    assert.equal(keptRequest(other), null);
    clearRequest(folder);
    assert.equal(keptRequest(folder), null);
  });
});

test('words that only carry setup on, a command and an empty prompt are no request', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-kept '));
    for (const prompt of ['carry on with setup', 'Continue', 'set up Wheelhouse', '/wheelhouse:setup', '', '   ']) {
      assert.equal(keepRequest(folder, prompt), false, JSON.stringify(prompt));
    }
    assert.equal(keptRequest(folder), null);
    const long = 'x'.repeat(MOST_CHARS + 500);
    assert.equal(keepRequest(folder, long), true);
    assert.equal(keptRequest(folder).length, MOST_CHARS);
  });
});

test('a damaged record reads as none and nothing throws', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-kept '));
    keepRequest(folder, 'A request');
    const dir = path.join(process.env.WHEELHOUSE_HOME, 'setup-requests');
    for (const file of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, file), 'not json');
    assert.equal(keptRequest(folder), null);
  });
});
