// tests/scripts/update/panel.test.js
// The update command's own question about the panel, and "Skip for now" kept for this computer, as the old offer's decline was kept:
// within the same minor release it is not asked again, and a later minor asks again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { panelCard, panelDeclined, declinePanel, panelHeld } from '../../../scripts/update/panel.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { withHome } from '../../helpers/homes.js';

test('Not now is remembered as the old offer\'s was: kept per computer, held within a minor release, asked again in a later one', () => withHome(() => {
  assert.equal(panelDeclined(), null);
  assert.equal(panelHeld('0.3.1'), false);
  declinePanel('v0.3.1');
  assert.deepEqual(panelDeclined(), { version: '0.3.1' });
  assert.equal(panelHeld('0.3.4'), true, 'the same minor release');
  assert.equal(panelHeld('0.4.0'), false, 'a later minor asks again');
  assert.throws(() => declinePanel('latest'), /release version/);
  fs.writeFileSync(path.join(wheelhouseHome(), 'panel-declined.json'), '{oops');
  assert.equal(panelDeclined(), null, 'a damaged file holds nothing');
}));

test('the question has the options, a recommendation and what happens meanwhile, and says why it is the director\'s choice', () => {
  const card = panelCard({ to: '0.3.1' });
  assert.deepEqual(card.options.map((o) => o.label), ['Install the panel', 'Skip for now']);
  assert.match(card.question, /It adds software to VS Code on this computer, so it is your choice/);
  assert.match(card.question, /Meanwhile/);
  assert.match(card.options[0].description, /Recommended/);
});
