// tests/scripts/update/journal.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openJournal, backup, restore, JOURNAL_SCHEMA } from '../../../scripts/update/journal.js';

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-uj-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  return Promise.resolve(fn(home)).finally(() => {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
}

test('journal: a fresh journal has every step todo', () => withHome((home) => {
  const j = openJournal('proj');
  assert.equal(j.folder, path.join(home, 'update', 'proj'));
  const state = j.read();
  for (const s of ['checks', 'change', 'merged', 'idle', 'backup', 'catalogue', 'installs', 'verify', 'finish', 'done']) {
    assert.equal(state.steps[s].state, 'todo');
  }
}));

test('journal: marks are kept across a reopen', () => withHome(() => {
  openJournal('proj').mark('checks', 'done', { tag: 'v0.2.7' });
  const step = openJournal('proj').read().steps.checks;
  assert.equal(step.state, 'done');
  assert.deepEqual(step.data, { tag: 'v0.2.7' });
}));

test('journal: a step name or state that does not exist is refused', () => withHome(() => {
  const j = openJournal('proj');
  assert.throws(() => j.mark('nonsense', 'done'));
  assert.throws(() => j.mark('checks', 'half'));
}));

test('journal: a project name that could leave the folder is refused', () => withHome(() => {
  assert.throws(() => openJournal('../x'));
}));

test('journal: a second lock is refused while the first is held', () => withHome(() => {
  const first = openJournal('a').lock();
  assert.equal(typeof first, 'function');
  assert.equal(openJournal('b').lock(), null);
  first();
  const again = openJournal('b').lock();
  assert.equal(typeof again, 'function');
  again();
}));

test('journal: a stale lock (dead pid) is taken over', () => withHome((home) => {
  fs.mkdirSync(path.join(home, 'update'), { recursive: true });
  fs.writeFileSync(path.join(home, 'update', 'lock'), JSON.stringify({ pid: 2147483646, startTime: 1, project: 'old' }));
  const release = openJournal('a').lock();
  assert.equal(typeof release, 'function');
  const held = JSON.parse(fs.readFileSync(path.join(home, 'update', 'lock'), 'utf8'));
  assert.equal(held.pid, process.pid);
  assert.equal(held.project, 'a');
  release();
  assert.equal(fs.existsSync(path.join(home, 'update', 'lock')), false);
}));

test('journal: a lock file that cannot be read is taken as held', () => withHome((home) => {
  fs.mkdirSync(path.join(home, 'update'), { recursive: true });
  fs.writeFileSync(path.join(home, 'update', 'lock'), 'not json');
  assert.equal(openJournal('a').lock(), null);
}));

test('journal: release never removes a lock someone else now holds', () => withHome((home) => {
  const release = openJournal('a').lock();
  fs.writeFileSync(path.join(home, 'update', 'lock'), JSON.stringify({ pid: process.pid + 1, startTime: 5, project: 'z' }));
  release();
  assert.equal(fs.existsSync(path.join(home, 'update', 'lock')), true);
}));

test('journal: one written by a newer version is read as newer and never rewritten', () => withHome(() => {
  const j = openJournal('proj');
  fs.mkdirSync(j.folder, { recursive: true });
  const text = JSON.stringify({ schema: JOURNAL_SCHEMA + 1, steps: { checks: { state: 'done' } }, extra: 1 });
  fs.writeFileSync(path.join(j.folder, 'journal.json'), text);
  const state = openJournal('proj').read();
  assert.equal(state.newer, true);
  assert.throws(() => openJournal('proj').mark('checks', 'failed'), /newer/i);
  assert.equal(fs.readFileSync(path.join(j.folder, 'journal.json'), 'utf8'), text);
}));

test('restore puts back each file byte for byte, and removes a file that was not there before', () => withHome((home) => {
  const j = openJournal('proj');
  const a = path.join(home, 'work', 'a.bin');
  const b = path.join(home, 'work', 'sub', 'b.json');
  fs.mkdirSync(path.dirname(a), { recursive: true });
  const bytes = Buffer.from([0, 255, 10, 13, 200]);
  fs.writeFileSync(a, bytes);
  backup(j, [a, b]);
  fs.writeFileSync(a, 'changed');
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.writeFileSync(b, 'new');
  restore(j);
  assert.deepEqual(fs.readFileSync(a), bytes);
  assert.equal(fs.existsSync(b), false);
}));

test('backup: a second backup keeps the first copy of a file', () => withHome((home) => {
  const j = openJournal('proj');
  const a = path.join(home, 'a.txt');
  fs.writeFileSync(a, 'first');
  backup(j, [a]);
  fs.writeFileSync(a, 'second');
  backup(j, [a]);
  restore(j);
  assert.equal(fs.readFileSync(a, 'utf8'), 'first');
}));

test('restore with no backup does nothing', () => withHome(() => {
  assert.doesNotThrow(() => restore(openJournal('proj')));
}));
