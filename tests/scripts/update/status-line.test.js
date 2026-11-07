// tests/scripts/update/status-line.test.js
// The update's step that takes Wheelhouse's own status line out of a project's local settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeOwnStatusLine, statusLineStep } from '../../../scripts/update/status-line.js';

const ours = { type: 'command', command: '"/n" "/p/scripts/statusline.js"' };
const theirs = { type: 'command', command: 'theirs.sh' };
const folder = (local) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-sl-'));
  fs.mkdirSync(path.join(dir, '.claude'));
  if (local !== undefined) fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify(local));
  return dir;
};
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'));

test('Wheelhouse\'s own status line is removed from the local settings and the rest stays', () => {
  const dir = folder({ statusLine: ours, sandbox: { x: 1 } });
  assert.deepEqual(removeOwnStatusLine(dir), { removed: true });
  assert.deepEqual(read(dir), { sandbox: { x: 1 } });
});

test('the director\'s own status line is left exactly as it is', () => {
  const dir = folder({ statusLine: theirs, sandbox: { x: 1 } });
  const before = fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8');
  assert.deepEqual(removeOwnStatusLine(dir), { removed: false });
  assert.equal(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'), before);
});

test('no file, no status line, or a damaged file: nothing happens and nothing throws', () => {
  assert.deepEqual(removeOwnStatusLine(folder()), { removed: false });
  assert.deepEqual(removeOwnStatusLine(folder({ sandbox: {} })), { removed: false });
  const dir = folder();
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{not json');
  assert.deepEqual(removeOwnStatusLine(dir), { removed: false });
  assert.equal(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'), '{not json');
});

test('the step says a line only when it removed one', async () => {
  const dir = folder({ statusLine: ours });
  const first = await statusLineStep({ folder: dir });
  assert.equal(first.lines.length, 1);
  assert.deepEqual(await statusLineStep({ folder: dir }), { lines: [] });
});
