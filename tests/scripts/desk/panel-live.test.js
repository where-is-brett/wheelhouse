// tests/scripts/desk/panel-live.test.js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_LIVE_MS, ASK_HERE_MS, markPanel, panelLive, clearPanels, markAskHere, takeAskHere, handedAskHere, passHanded, HANDED_MS } from '../../../scripts/desk/panel-live.js';

beforeEach(() => clearPanels());

const T = Date.parse('2026-11-23T01:00:00.000Z');

test('the spans are the ones the design names', () => {
  assert.equal(PANEL_LIVE_MS, 45000);
  assert.equal(ASK_HERE_MS, 120000);
});

test('a marked panel is live for 45 seconds, then not', () => {
  assert.equal(panelLive('o__p', T), false, 'nothing is marked yet');
  markPanel('o__p', 'vscode-panel', T);
  assert.equal(panelLive('o__p', T), true);
  assert.equal(panelLive('o__p', T + PANEL_LIVE_MS), true);
  assert.equal(panelLive('o__p', T + PANEL_LIVE_MS + 1), false);
  assert.equal(panelLive('o__p', T - 1), false, 'a clock that reads before the mark is no proof');
});

test('a mark is per project, and a later watch renews it', () => {
  markPanel('o__p', 'vscode-panel', T);
  assert.equal(panelLive('o__q', T + 1000), false);
  markPanel('o__p', 'vscode-panel', T + 40000);
  assert.equal(panelLive('o__p', T + 80000), true);
  markPanel('o__p', 'vscode-panel', Number.NaN);
  markPanel('', 'vscode-panel', T);
  assert.equal(panelLive('', T), false);
});

test('an Ask me here mark is taken once, within two minutes, and per project', () => {
  markAskHere('o__p', 'card-1', T);
  markAskHere('o__p', 'card-2', T + 60000);
  markAskHere('o__q', 'card-3', T);
  assert.deepEqual(takeAskHere('o__p', T + 90000).sort(), ['card-1', 'card-2']);
  assert.deepEqual(takeAskHere('o__p', T + 90000), [], 'taken once');
  assert.deepEqual(takeAskHere('o__q', T + ASK_HERE_MS + 1), [], 'a mark older than two minutes is not given');
  assert.deepEqual(takeAskHere('o__none', T), []);
});

test('passHanded gives a handed mark once, only when every card is handed and in time', () => {
  markAskHere('p', 'c1', T);
  markAskHere('p', 'c2', T);
  takeAskHere('p', T + 1000);
  assert.equal(passHanded('p', ['c1', 'c3'], T + 2000), false, 'a card not handed refuses the lot');
  assert.equal(passHanded('p', ['c1'], T + 2000), true);
  assert.equal(passHanded('p', ['c1'], T + 2000), false, 'given once');
  assert.deepEqual(handedAskHere('p', T + 2000).map((m) => m.id), ['c2'], 'the other mark is untouched');
  assert.equal(passHanded('p', ['c2'], T + 1000 + HANDED_MS + 1), false, 'past the cap');
  assert.equal(passHanded('p', [], T), false);
});
