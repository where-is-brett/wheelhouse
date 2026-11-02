// tests/scripts/settings/compact-window.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { windowRefusal, windowIn, windowOf, nearLimit, withWindow, windowChange, SETTINGS_FILE } from '../../../scripts/settings/compact-window.js';

test('a window at or below the prepare point is refused in plain words', () => {
  assert.match(windowRefusal({ window: 200000, prepare: 200000 }), /has to be larger than the point to prepare at/);
  assert.match(windowRefusal({ window: 250000, prepare: 280000 }), /250,000/);
  assert.equal(windowRefusal({ window: 320000, prepare: 200000 }), null);
  assert.equal(windowRefusal(), null);
});

test('the change touches only autoCompactWindow', () => {
  const settings = { model: 'x', permissions: { deny: ['Bash(gh:*)'] }, autoCompactWindow: 300000 };
  const change = windowChange({ settings, window: 320000, prepare: 200000 });
  assert.equal(change.file, SETTINGS_FILE);
  assert.deepEqual(JSON.parse(change.text), { ...settings, autoCompactWindow: 320000 });
  assert.match(change.title, /320,000/);
  assert.equal(windowChange({ settings, window: 300000, prepare: 200000 }), null);
  assert.throws(() => windowChange({ settings, window: 150000, prepare: 100000 }), /can't be 150000/);
  assert.throws(() => windowChange({ settings, window: 210000, prepare: 250000 }), /larger than/);
  assert.deepEqual(withWindow(undefined, 400000), { autoCompactWindow: 400000 });
});

test('the window and the near-limit point are read from the project\'s settings', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-window-'));
  try {
    assert.equal(windowOf(folder), null);
    assert.equal(nearLimit(folder, 360000), 360000);
    fs.mkdirSync(path.join(folder, '.claude'));
    fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), '{ not json');
    assert.equal(nearLimit(folder, 360000), 360000);
    fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 320000 }));
    assert.equal(windowOf(folder), 320000);
    assert.equal(nearLimit(folder, 360000), 380000);
    assert.equal(windowIn({ autoCompactWindow: '320000' }), null);
    assert.equal(nearLimit(null, 360000), 360000);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
