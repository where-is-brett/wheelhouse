// tests/scripts/lib/bypass.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markBypass, clearBypass, bypassActive } from '../../../scripts/lib/bypass.js';

const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const HOUR = 3600000;

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-byp-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('no marker means no bypass', () => {
  withHome(() => assert.equal(bypassActive({ now: at(0) }), false));
});

test('a bypass marker counts for two hours, then not', () => {
  withHome(() => {
    markBypass('sess-1', { now: at(0) });
    assert.equal(bypassActive({ now: at(0) }), true);
    assert.equal(bypassActive({ now: at(2 * HOUR - 1) }), true);
    assert.equal(bypassActive({ now: at(2 * HOUR + 1) }), false);
  });
});

test('any one live marker is enough, and clearing the last ends it', () => {
  withHome(() => {
    markBypass('a', { now: at(0) });
    markBypass('b', { now: at(HOUR) });
    assert.equal(bypassActive({ now: at(2 * HOUR + 1) }), true);
    clearBypass('b');
    assert.equal(bypassActive({ now: at(2 * HOUR + 1) }), false);
    clearBypass('never-marked');
  });
});

test('a session id outside [A-Za-z0-9-] is refused', () => {
  withHome(() => {
    for (const bad of ['', '../x', 'a/b', 'a.b', 'a b', 7, undefined]) {
      assert.throws(() => markBypass(bad, { now: at(0) }), /session id/);
      assert.throws(() => clearBypass(bad), /session id/);
    }
  });
});

test('a marker whose contents cannot be read counts by its file time', () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, 'bypass'), { recursive: true });
    fs.writeFileSync(path.join(home, 'bypass', 'odd'), 'junk');
    assert.equal(bypassActive({ now: () => new Date() }), true);
    assert.equal(bypassActive({ now: () => new Date(Date.now() + 3 * HOUR) }), false);
  });
});

test('a marker is still active at exactly two hours', () => {
  withHome(() => {
    markBypass('sess', { now: at(0) });
    assert.equal(bypassActive({ now: at(2 * HOUR) }), true);
    assert.equal(bypassActive({ now: at(2 * HOUR + 1) }), false);
  });
});

test('a marker dated in the future counts as written now', () => {
  withHome(() => {
    markBypass('sess', { now: at(10 * HOUR) });
    assert.equal(bypassActive({ now: at(0) }), true);
    assert.equal(bypassActive({ now: at(10 * HOUR + 2 * HOUR + 1) }), false); // dated 10h on: two hours past its own date
  });
});

test('entries whose names are not session ids are skipped', () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, 'bypass'), { recursive: true });
    fs.writeFileSync(path.join(home, 'bypass', '.DS_Store'), 'junk');
    assert.equal(bypassActive({ now: () => new Date() }), false);
  });
});

test('a session id is at most 128 characters', () => {
  withHome(() => {
    markBypass('a'.repeat(128), { now: at(0) });
    assert.throws(() => markBypass('a'.repeat(129), { now: at(0) }), /session id/);
  });
});

test('anything but an absent bypass folder counts as active', () => {
  withHome((home) => {
    fs.writeFileSync(path.join(home, 'bypass'), 'a file where the folder should be');
    assert.equal(bypassActive({ now: at(0) }), true);
  });
});
