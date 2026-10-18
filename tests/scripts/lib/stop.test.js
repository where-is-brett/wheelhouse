// tests/scripts/lib/stop.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopState, setStop, liftStop } from '../../../scripts/lib/stop.js';
import { stopFile } from '../../../scripts/lib/paths.js';

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-stop-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('STOP is off when nothing is at its path', () => {
  withHome(() => assert.deepEqual(stopState(), { on: false }));
});

test('STOP is on when its path holds a folder or an unreadable file', () => {
  withHome(() => {
    fs.mkdirSync(stopFile());
    assert.equal(stopState().on, true);
    fs.rmSync(stopFile(), { recursive: true });
    fs.writeFileSync(stopFile(), 'not json');
    assert.deepEqual(stopState(), { on: true });
    fs.writeFileSync(stopFile(), '');
    assert.deepEqual(stopState(), { on: true });
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      fs.writeFileSync(stopFile(), JSON.stringify({ by: 'mod', at: '2026-10-18T01:00:00.000Z' }));
      fs.chmodSync(stopFile(), 0o000);
      assert.equal(stopState().on, true);
      fs.chmodSync(stopFile(), 0o600);
    }
  });
});

test('setStop records who set it and when', () => {
  withHome(() => {
    setStop({ by: 'prompt', now: () => new Date('2026-10-18T01:02:03.456Z') });
    assert.deepEqual(stopState(), { on: true, by: 'prompt', at: '2026-10-18T01:02:03.456Z' });
  });
});

test('liftStop removes it, and removes a folder left at its path', () => {
  withHome(() => {
    setStop({ by: 'helper' });
    liftStop();
    assert.deepEqual(stopState(), { on: false });
    fs.mkdirSync(path.join(stopFile(), 'inner'), { recursive: true });
    liftStop();
    assert.deepEqual(stopState(), { on: false });
  });
});

test('setStop leaves STOP on when something already occupies its path', () => {
  withHome(() => {
    fs.mkdirSync(stopFile());
    setStop({ by: 'helper' });
    assert.equal(stopState().on, true);
  });
});

test('setStop refuses a setter it does not know', () => {
  withHome(() => {
    for (const by of ['agent', '', undefined]) assert.throws(() => setStop({ by }), /STOP is set by/);
    assert.deepEqual(stopState(), { on: false });
  });
});
