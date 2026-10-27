// tests/scripts/lib/front-desk-model.test.js
// The model the front desk's session runs on, kept by the session start for this computer, and the
// one line the board and the briefing show when it isn't the model setup pinned (design section 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { keepRunningModel, runningModel, modelOfInput, frontDeskModelLine, readFrontDeskModel } from '../../../scripts/lib/front-desk-model.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const T0 = new Date('2026-10-24T01:00:00.000Z');

test('the running model is kept per project and read back, and nothing kept reads as none', () => withHome(async () => {
  assert.equal(runningModel('o__p'), null);
  keepRunningModel('o__p', 'model-small', { now: () => T0 });
  assert.deepEqual(runningModel('o__p'), { model: 'model-small', at: T0.toISOString() });
  assert.equal(runningModel('o__other'), null);
  keepRunningModel('o__p', 'model-top', { now: () => T0 });
  assert.equal(runningModel('o__p').model, 'model-top');
}));

test('the session start\'s input gives its model as a name or as an object with an id; anything else is none', () => {
  assert.equal(modelOfInput({ model: 'model-top' }), 'model-top');
  assert.equal(modelOfInput({ model: { id: 'model-top', display_name: 'Top' } }), 'model-top');
  for (const input of [{}, { model: '' }, { model: 7 }, { model: { name: 'x' } }, { model: '-p' }, null]) assert.equal(modelOfInput(input), null);
});

test('one plain line when the front desk runs on another model than the pin, naming both; none when they match or either is unknown', () => {
  const line = frontDeskModelLine({ running: 'model-small', pinned: 'model-top' });
  assert.match(line, /^The First Mate is running on model-small, not model-top/);
  assert.match(line, /model-top, the model it was set up on/);
  assert.match(line, /Claude's model menu/);
  assert.doesNotMatch(line, /most capable/, 'the pin is no longer always the most capable model');
  // A front desk moved up to a stronger model than the pin, without the director's opt-in at setup, is
  // still off the pin, and says so.
  assert.match(frontDeskModelLine({ running: 'model-strongest', pinned: 'model-top' }), /^The First Mate is running on model-strongest, not model-top/);
  assert.equal(frontDeskModelLine({ running: 'model-top', pinned: 'model-top' }), null);
  assert.equal(frontDeskModelLine({ running: null, pinned: 'model-top' }), null);
  assert.equal(frontDeskModelLine({ running: 'model-small', pinned: null }), null);
  // An alias the director picked that names the pin's family is still another model than the pin.
  assert.notEqual(frontDeskModelLine({ running: 'model', pinned: 'model-top' }), null);
});

test('readFrontDeskModel pairs what was kept with the pin in the main folder\'s configuration', () => withHome(async () => {
  const folder = tempFolder('wh-fdm-');
  fs.mkdirSync(`${folder}/.claude`);
  fs.writeFileSync(`${folder}/.claude/wheelhouse.json`, JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], routing: { frontDesk: 'model-top' } }));
  keepRunningModel('o__p', 'model-small', { now: () => T0 });
  assert.deepEqual(readFrontDeskModel({ project: 'o__p', folder }), { running: 'model-small', pinned: 'model-top' });
  fs.writeFileSync(`${folder}/.claude/wheelhouse.json`, 'not json');
  assert.deepEqual(readFrontDeskModel({ project: 'o__p', folder }), { running: 'model-small', pinned: null });
}));
