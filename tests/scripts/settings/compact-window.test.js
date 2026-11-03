// tests/scripts/settings/compact-window.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosenWindow } from '../../../scripts/settings/compact-window-pr.js';
import { windowRefusal, windowIn, withWindow, windowChange, SETTINGS_FILE } from '../../../scripts/settings/compact-window.js';

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

test('a window outside the catalogue\'s bounds counts as none', () => {
  assert.equal(windowIn({ autoCompactWindow: 150000 }), null);
  assert.equal(windowIn({ autoCompactWindow: 1000001 }), null);
  assert.equal(windowIn({ autoCompactWindow: 200000 }), 200000);
  assert.equal(windowIn({ autoCompactWindow: 1000000 }), 1000000);
});

test('the window the director chose must stay above the point to prepare at', () => {
  const view = (window, prepare) => ({
    compactWindow: { key: 'compactWindow', id: 'w', at: '2026-11-01T00:00:00.000Z', value: window, before: null },
    ...(prepare === undefined ? {} : { compactPrepare: { key: 'compactPrepare', id: 'p', at: '2026-11-01T00:00:00.000Z', value: prepare, before: null } }),
  });
  const now = new Date('2026-11-02T00:00:00.000Z');
  assert.equal(chosenWindow(view(320000), { now }), 320000);
  assert.equal(chosenWindow(view(210000, 250000), { now }), null);
  assert.equal(chosenWindow(view(250000, 250000), { now }), null);
  assert.equal(chosenWindow(view(250000, 200000), { now }), 250000);
  assert.equal(chosenWindow(view(200000, 200000), { now }), null);
  assert.equal(chosenWindow({}, { now }), null);
});
