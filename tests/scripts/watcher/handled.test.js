// tests/scripts/watcher/handled.test.js
// The ids the foreman wrote while handling a wake (rulings R48, R64): its act
// command records them, and the watcher reads them so they go to the digest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { recordHandled, readHandled, handledFile, HANDLED_CAP, ID_MAX } from '../../../scripts/watcher/handled.js';
import { LOOKBACK_MS } from '../../../scripts/watcher/sources.js';
import { withHome } from '../../helpers/homes.js';

const unix = process.platform !== 'win32';
const P = 'o__p';
const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const at = (ms) => () => new Date(T0 + ms);
const DAY = 24 * 60 * 60 * 1000;

test('the ids written are read back, each once', () => withHome(() => {
  assert.deepEqual(readHandled(P, { now: at(0) }), new Set(), 'no file reads as none');
  recordHandled(P, ['ev-1', 'ev-2'], { now: at(0) });
  recordHandled(P, ['ev-2', 'ev-3'], { now: at(1000) });
  assert.deepEqual(readHandled(P, { now: at(2000) }), new Set(['ev-1', 'ev-2', 'ev-3']));
  const kept = JSON.parse(fs.readFileSync(handledFile(P), 'utf8'));
  assert.deepEqual(kept.entries.map((e) => e.id), ['ev-1', 'ev-2', 'ev-3'], 'an id written again is kept once, at its latest');
  assert.equal(kept.entries[1].at, new Date(T0 + 1000).toISOString());
  assert.equal(path.dirname(handledFile(P)).endsWith(`${path.sep}watcher`), true);

  // Nothing to record writes nothing new; ids that are not text are refused.
  recordHandled(P, [], { now: at(3000) });
  assert.deepEqual(readHandled(P, { now: at(3000) }), new Set(['ev-1', 'ev-2', 'ev-3']));
  assert.throws(() => recordHandled(P, ['ok', ''], { now: at(0) }), /handled/);
  assert.throws(() => recordHandled(P, [7], { now: at(0) }), /handled/);
  assert.throws(() => recordHandled(P, 'ev-1', { now: at(0) }), /handled/);
}));

test('an id longer than ID_MAX is refused, so a full list always fits the file\'s cap', () => withHome(() => {
  assert.throws(() => recordHandled(P, ['x'.repeat(ID_MAX + 1)], { now: at(0) }), /handled/);
  // A full list of the longest ids is written and read back whole.
  const long = Array.from({ length: HANDLED_CAP }, (_, i) => `${String(i).padStart(6, '0')}${'x'.repeat(ID_MAX - 6)}`);
  recordHandled(P, long, { now: at(0) });
  assert.equal(readHandled(P, { now: at(0) }).size, HANDLED_CAP);
  // One planted in the file past the cap is left out on reading, not the whole file.
  const kept = JSON.parse(fs.readFileSync(handledFile(P), 'utf8'));
  kept.entries.push({ id: 'y'.repeat(ID_MAX + 1), at: new Date(T0).toISOString() });
  fs.writeFileSync(handledFile(P), JSON.stringify(kept));
  assert.equal(readHandled(P, { now: at(0) }).size, HANDLED_CAP);
}));

test('ids older than the look-back are dropped, and the list is bounded', () => withHome(() => {
  recordHandled(P, ['old'], { now: at(0) });
  recordHandled(P, ['recent'], { now: at(LOOKBACK_MS - DAY) });
  // Read within the look-back of both: both are there.
  assert.deepEqual(readHandled(P, { now: at(LOOKBACK_MS - DAY) }), new Set(['old', 'recent']));
  // Past the look-back of the first: it is gone from the reading, and from the file at the next write.
  assert.deepEqual(readHandled(P, { now: at(LOOKBACK_MS + 1) }), new Set(['recent']));
  recordHandled(P, ['newest'], { now: at(LOOKBACK_MS + 1) });
  const kept = JSON.parse(fs.readFileSync(handledFile(P), 'utf8'));
  assert.deepEqual(kept.entries.map((e) => e.id), ['recent', 'newest']);

  // Only the newest HANDLED_CAP are kept.
  const many = Array.from({ length: HANDLED_CAP + 10 }, (_, i) => `ev-${i}`);
  recordHandled(P, many, { now: at(LOOKBACK_MS + 2) });
  const read = readHandled(P, { now: at(LOOKBACK_MS + 2) });
  assert.equal(read.size, HANDLED_CAP);
  assert.equal(read.has(`ev-${HANDLED_CAP + 9}`), true);
  assert.equal(read.has('ev-9'), false);
  assert.equal(read.has('recent'), false);
}));

test('a damaged or missing file reads as empty, and a write starts again from nothing', () => withHome(() => {
  fs.mkdirSync(path.dirname(handledFile(P)), { recursive: true });
  for (const damaged of ['not json', '[]', '{"entries": 3}', '{"entries": [{"id": 4, "at": "x"}]}', '']) {
    fs.writeFileSync(handledFile(P), damaged);
    assert.deepEqual(readHandled(P, { now: at(0) }), new Set(), damaged);
  }
  // Entries that are not right are left out, the rest are read.
  fs.writeFileSync(handledFile(P), JSON.stringify({ entries: [{ id: 'good', at: new Date(T0).toISOString() }, { id: 'no-time' }, 'text'] }));
  assert.deepEqual(readHandled(P, { now: at(0) }), new Set(['good']));

  fs.writeFileSync(handledFile(P), 'not json');
  recordHandled(P, ['ev-1'], { now: at(0) });
  assert.deepEqual(readHandled(P, { now: at(0) }), new Set(['ev-1']));

  // A folder in its place reads as empty, and is never written through.
  fs.rmSync(handledFile(P));
  fs.mkdirSync(handledFile(P));
  assert.deepEqual(readHandled(P, { now: at(0) }), new Set());
  assert.throws(() => recordHandled(P, ['ev-2'], { now: at(0) }));
  fs.rmSync(handledFile(P), { recursive: true });

  // A project name that is not a folder name reads as empty rather than stopping the watcher.
  assert.deepEqual(readHandled('../x', { now: at(0) }), new Set());
}));

test('a link in the file\'s place is not followed', { skip: !unix }, () => withHome((home) => {
  fs.mkdirSync(path.dirname(handledFile(P)), { recursive: true });
  const elsewhere = path.join(home, 'elsewhere.json');
  fs.writeFileSync(elsewhere, JSON.stringify({ entries: [{ id: 'planted', at: new Date(T0).toISOString() }] }));
  fs.symlinkSync(elsewhere, handledFile(P));
  assert.deepEqual(readHandled(P, { now: at(0) }), new Set());
  assert.throws(() => recordHandled(P, ['ev-1'], { now: at(0) }));
  assert.match(fs.readFileSync(elsewhere, 'utf8'), /planted/);
}));
