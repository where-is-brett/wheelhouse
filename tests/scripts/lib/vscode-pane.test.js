// tests/scripts/lib/vscode-pane.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withHome } from '../../helpers/homes.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { markVscodePane, vscodePaneLive, markVscodeHere, takeVscodeHere } from '../../../scripts/lib/vscode-pane.js';

const T = 1_000_000;
const panes = () => path.join(wheelhouseHome(), 'panes');

test('vscodePaneLive is true at 44 seconds and false at 46', () => withHome(() => {
  assert.equal(markVscodePane('p1', { at: T, visible: T, window: 'w' }), true);
  assert.equal(vscodePaneLive('p1', T + 44000), true);
  assert.equal(vscodePaneLive('p1', T + 46000), false);
}));

test('a tick without a recent sighting is not live', () => withHome(() => {
  markVscodePane('p1', { at: T, visible: T - 60000, window: 'w' });
  assert.equal(vscodePaneLive('p1', T + 1000), false);
}));

test('the mark holds the surface and the window', () => withHome(() => {
  markVscodePane('p1', { at: T, visible: T, window: 'abc' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(panes(), 'vscode-p1.mark.json'), 'utf8')), { at: T, visible: T, surface: 'vscode', window: 'abc' });
}));

test('a missing file, a half-written file, a null sighting and an unsafe id are not live and never throw', () => withHome(() => {
  assert.equal(vscodePaneLive('none', T), false);
  fs.mkdirSync(panes(), { recursive: true });
  fs.writeFileSync(path.join(panes(), 'vscode-half.mark.json'), '{');
  assert.equal(vscodePaneLive('half', T), false);
  fs.writeFileSync(path.join(panes(), 'vscode-odd.mark.json'), JSON.stringify({ at: 'x', visible: {} }));
  assert.equal(vscodePaneLive('odd', T), false);
  markVscodePane('p2', { at: T, visible: null, window: 'w' });
  assert.equal(vscodePaneLive('p2', T), false);
  for (const bad of ['../x', '', 'a/b', '..', null, 42, undefined]) {
    assert.equal(vscodePaneLive(bad, T), false);
    assert.equal(markVscodePane(bad, { at: T, visible: T, window: 'w' }), false);
    assert.equal(markVscodeHere(bad, ['c1'], T), false);
    assert.equal(takeVscodeHere(bad, ['c1'], T), false);
  }
  assert.equal(fs.existsSync(path.join(wheelhouseHome(), 'x.json')), false);
}));

test('takeVscodeHere gives true once, then false, and false after 121 seconds', () => withHome(() => {
  assert.equal(markVscodeHere('p1', ['c1', 'c2'], T), true);
  assert.equal(takeVscodeHere('p1', ['c1', 'c2'], T + 1000), true);
  assert.equal(takeVscodeHere('p1', ['c1', 'c2'], T + 2000), false);
  markVscodeHere('p1', ['c3'], T);
  assert.equal(takeVscodeHere('p1', ['c3'], T + 121000), false);
}));

test('a project named like another\'s here file collides with nothing', () => withHome(() => {
  markVscodeHere('p1', ['c1'], T);
  markVscodePane('p1.here', { at: T, visible: T, window: 'w' });
  markVscodePane('p1', { at: T, visible: T, window: 'w' });
  assert.equal(takeVscodeHere('p1', ['c1'], T), true);
  assert.equal(vscodePaneLive('p1.here', T), true);
  assert.equal(takeVscodeHere('p1.here', ['c1'], T), false);
}));

test('takeVscodeHere needs every id, and survives a half-written file', () => withHome(() => {
  markVscodeHere('p1', ['c1'], T);
  assert.equal(takeVscodeHere('p1', ['c1', 'c2'], T), false);
  fs.writeFileSync(path.join(panes(), 'vscode-p1.here.json'), '{"marks":');
  assert.equal(takeVscodeHere('p1', ['c1'], T), false);
  assert.equal(markVscodeHere('p1', [], T), false);
  assert.equal(markVscodeHere('p1', [1], T), false);
}));
