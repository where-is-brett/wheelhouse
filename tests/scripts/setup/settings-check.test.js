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

test('a comma or comment inside a setting\'s text is kept as it is', () => {
  const folder = folderWith({ '.claude/settings.local.json': '{ "env": { "A": "x,}", "B": "a // b", "C": "/* c */" }, }' });
  mend(damagedSettings({ folder, claudeHome: null }));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'settings.local.json'), 'utf8')), { env: { A: 'x,}', B: 'a // b', C: '/* c */' } });
});

test('a settings file that is a link to a file outside its folder is named but never written through', () => {
  const folder = folderWith({});
  const outside = folderWith({ 'shared.json': '{ "a": 1, }' });
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.symlinkSync(path.join(outside, 'shared.json'), path.join(folder, '.claude', 'settings.local.json'));
  const damaged = damagedSettings({ folder, claudeHome: null });
  assert.equal(damaged.length, 1);
  assert.equal(damaged[0].elsewhere, true);
  const done = mend(damaged);
  assert.equal(done[0].mended, false);
  assert.equal(fs.readFileSync(path.join(outside, 'shared.json'), 'utf8'), '{ "a": 1, }');
  assert.equal(fs.existsSync(path.join(folder, '.claude', 'settings.local.json.broken')), false);
  assert.match(mendAsk(damaged).card.what, /elsewhere/);
});

test('a file that can\'t be written is left as it was, with no copy left beside it', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const folder = folderWith({ '.claude/settings.local.json': '{ "a": 1, }' });
  const file = path.join(folder, '.claude', 'settings.local.json');
  fs.chmodSync(file, 0o400);
  try {
    const done = mend(damagedSettings({ folder, claudeHome: null }));
    assert.equal(done[0].mended, false);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ "a": 1, }');
    assert.equal(fs.existsSync(`${file}.broken`), false);
    // Tried again, it still leaves no copies behind.
    mend(damagedSettings({ folder, claudeHome: null }));
    assert.equal(fs.existsSync(`${file}.broken`), false);
  } finally {
    fs.chmodSync(file, 0o600);
  }
});

test('the copy keeps the file\'s own permissions', { skip: process.platform === 'win32' }, () => {
  const folder = folderWith({ '.claude/settings.local.json': '{ "env": { "TOKEN": "x" }, }' });
  const file = path.join(folder, '.claude', 'settings.local.json');
  fs.chmodSync(file, 0o600);
  mend(damagedSettings({ folder, claudeHome: null }));
  assert.equal(fs.statSync(`${file}.broken`).mode & 0o777, 0o600);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
