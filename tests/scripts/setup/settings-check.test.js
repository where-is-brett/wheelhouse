// tests/scripts/setup/settings-check.test.js
// The settings files setup can't read are found before the first card and mended with a copy kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { damagedSettings, mendAsk, mend, MEND, MEND_MYSELF } from '../../../scripts/setup/settings-check.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { tempFolder } from '../../helpers/homes.js';

function folderWith(files) {
  const folder = tempFolder('wh-settings-check-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    fs.writeFileSync(path.join(folder, rel), text);
  }
  return folder;
}

test('only a settings file that is there and is not a JSON object counts as damaged', () => {
  const folder = folderWith({
    '.claude/settings.local.json': '{ "env": { "A": "1" }, }',
    '.claude/settings.json': '{"permissions":{}}',
    '.claude/wheelhouse.json': '[1]',
  });
  const found = damagedSettings({ folder, claudeHome: path.join(folder, 'none') });
  assert.deepEqual(found.map((d) => path.basename(d.file)), ['settings.local.json', 'wheelhouse.json']);
  assert.deepEqual(damagedSettings({ folder: tempFolder('wh-settings-none-'), claudeHome: null }), []);
});

test('the card names the file in plain words, offers to mend it and recommends that', () => {
  const folder = folderWith({ '.claude/settings.local.json': 'not json' });
  const { id, card } = mendAsk(damagedSettings({ folder, claudeHome: null }));
  assert.equal(id, 'mend-settings-local');
  assert.match(card.what, /this computer's settings for the project \(\.claude\/settings\.local\.json in this folder\)/);
  assert.doesNotMatch(JSON.stringify(card), /JSON object/);
  assert.deepEqual(card.options.map((o) => o.label), [MEND, MEND_MYSELF]);
  assert.equal(card.recommend, MEND);
  assert.doesNotThrow(() => composeCard({ ...card, kind: 'question', suggest: false }));
});

test('mending keeps the file as it was beside itself and writes what can be read, or nothing', () => {
  const folder = folderWith({ '.claude/settings.local.json': '{\n  // mine\n  "env": { "A": "1", },\n}', '.claude/wheelhouse.json': '{ nope' });
  const done = mend(damagedSettings({ folder, claudeHome: null }));
  const local = path.join(folder, '.claude', 'settings.local.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(local, 'utf8')), { env: { A: '1' } });
  assert.equal(fs.readFileSync(`${local}.broken`, 'utf8'), '{\n  // mine\n  "env": { "A": "1", },\n}');
  assert.deepEqual(done.map((d) => d.kept), [true, false]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'wheelhouse.json'), 'utf8')), {});
  assert.deepEqual(damagedSettings({ folder, claudeHome: null }), []);
  // A second mend keeps the second copy under its own name.
  fs.writeFileSync(local, 'again {');
  mend(damagedSettings({ folder, claudeHome: null }));
  assert.equal(fs.readFileSync(`${local}.broken-2`, 'utf8'), 'again {');
});
