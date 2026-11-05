// tests/probes/lib/vscode-click.test.js
// The trial harness's card click: it refuses a call it can't carry out before it touches any window.
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = path.join(ROOT, 'probes', 'lib', 'vscode-click.mjs');

test('it needs a command, and a label to click', () => {
  for (const args of [[], ['click'], ['type', 'Confirm']]) {
    const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(run.status, 2, args.join(' '));
    assert.match(run.stderr, /usage/);
  }
});

test('with no window on the port it says so and presses nothing', () => {
  const run = spawnSync(process.execPath, [script, 'list', '--port', '1'], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
});

test('it sends mouse events only: no typing, no key presses', () => {
  const text = fs.readFileSync(script, 'utf8');
  assert.ok(!/Input\.insertText|dispatchKeyEvent/.test(text));
  assert.match(text, /mousePressed/);
});
