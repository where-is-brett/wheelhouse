// tests/scripts/lib/session-files.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withHome } from '../../helpers/homes.js';
import { roleFile } from '../../../scripts/lib/role.js';
import {
  LIVE_MS, HERE_MS, HOLD_FOR_PANE, ANY_CARD, markPane, paneLive, markHere, takeHere, markOpen, readOpen, clearOpen,
} from '../../../scripts/lib/session-files.js';

const T = 1_000_000;

test('the numbers are the design\'s', () => {
  assert.equal(LIVE_MS, 45000);
  assert.equal(HERE_MS, 120000);
  assert.equal(HOLD_FOR_PANE, true);
});

test('paneLive is true at 44 seconds and false at 46', () => withHome(() => {
  markPane('s1', { at: T, drawn: T, surface: 'desktop' });
  assert.equal(paneLive('s1', T + 44000), true);
  assert.equal(paneLive('s1', T + 46000), false);
}));

test('paneLive needs the draw to be within the window too, and takes the tick alone while drawn is null', () => withHome(() => {
  markPane('s1', { at: T, drawn: T - 60000, surface: 'desktop' });
  assert.equal(paneLive('s1', T + 1000), false);
  markPane('s1', { at: T, drawn: null, surface: null });
  assert.equal(paneLive('s1', T + 1000), true);
}));

test('paneLive is false for a terminal session, which draws no panel, however fresh its ticks', () => withHome(() => {
  markPane('s1', { at: T, drawn: null, surface: 'terminal' });
  assert.equal(paneLive('s1', T + 1000), false);
  markPane('s1', { at: T, drawn: T, surface: 'terminal' });
  assert.equal(paneLive('s1', T + 1000), false);
}));

test('paneLive is false for a missing file, a half-written file and an unsafe id', () => withHome(() => {
  assert.equal(paneLive('none', T), false);
  const file = path.join(path.dirname(roleFile('s2')), 'pane.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{');
  assert.equal(paneLive('s2', T), false);
  fs.writeFileSync(file, '{"at":"x","drawn":null}');
  assert.equal(paneLive('s2', T), false);
  assert.equal(paneLive('../x', T), false);
  assert.equal(markPane('../x', { at: T, drawn: T, surface: null }), false);
}));

test('takeHere gives true once, then false, and false after 121 seconds', () => withHome(() => {
  markHere('s1', ['a', 'b'], T);
  assert.equal(takeHere('s1', ['a', 'b'], T + 1000), true);
  assert.equal(takeHere('s1', ['a', 'b'], T + 2000), false);
  markHere('s1', ['a'], T);
  assert.equal(takeHere('s1', ['a'], T + 121000), false);
}));

test('takeHere needs every id, and removes only those it took', () => withHome(() => {
  markHere('s1', ['a', 'b'], T);
  assert.equal(takeHere('s1', ['a', 'c'], T + 1000), false);
  assert.equal(takeHere('s1', ['a'], T + 1000), true);
  assert.equal(takeHere('s1', ['b'], T + 1000), true);
  assert.equal(takeHere('s1', ['a'], T + 1000), false);
  assert.equal(takeHere('../x', ['a'], T), false);
  assert.equal(takeHere('s1', [], T), false);
}));

test('marks added later join the ones kept; an old mark is dropped', () => withHome(() => {
  markHere('s1', ['a'], T);
  markHere('s1', ['b'], T + 100000);
  assert.equal(takeHere('s1', ['a'], T + 130000), false);
  assert.equal(takeHere('s1', ['b'], T + 130000), true);
}));

test('readOpen gives the cards and time, and null after clearOpen or for a bad file', () => withHome(() => {
  assert.equal(readOpen('s1'), null);
  markOpen('s1', ['a', 'b'], T);
  assert.deepEqual(readOpen('s1'), { cards: ['a', 'b'], at: T });
  clearOpen('s1');
  assert.equal(readOpen('s1'), null);
  const file = path.join(path.dirname(roleFile('s1')), 'open.json');
  fs.writeFileSync(file, '{"cards":"x"');
  assert.equal(readOpen('s1'), null);
  fs.writeFileSync(file, '{"cards":[1],"at":1}');
  assert.equal(readOpen('s1'), null);
  assert.equal(readOpen('../x'), null);
  clearOpen('../x');
}));

test('here.json that is unreadable reads as absent', () => withHome(() => {
  const file = path.join(path.dirname(roleFile('s1')), 'here.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'nonsense');
  assert.equal(takeHere('s1', ['a'], T), false);
  markHere('s1', ['a'], T);
  assert.equal(takeHere('s1', ['a'], T), true);
}));

test('the mark for every card takes any ids once', () => withHome(() => {
  assert.equal(markHere('s1', [ANY_CARD], T), true);
  assert.equal(takeHere('s1', ['x', 'y'], T + 1000), true);
  assert.equal(takeHere('s1', ['x'], T + 2000), false);
}));
