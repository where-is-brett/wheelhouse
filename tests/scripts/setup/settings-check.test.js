// tests/scripts/setup/settings-check.test.js
// The settings files setup can't read are found before the first card and mended with a copy kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { damagedSettings, mendAsk, mend, settingsFault, settingsFaultLine, MEND, MEND_MYSELF } from '../../../scripts/setup/settings-check.js';
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

test('a lone backslash in a path is named with its place and the hint, in the card and by settingsFault', () => {
  const folder = folderWith({ '.claude/settings.local.json': '{\n "a": "C:\\Users\\x"\n}' });
  const file = path.join(folder, '.claude', 'settings.local.json');
  assert.deepEqual(settingsFault(file), { file, line: 2, column: 10, hint: 'a single `\\` inside a path must be written `\\\\`, or use `/`' });
  const { card } = mendAsk(damagedSettings({ folder, claudeHome: null }));
  assert.match(card.what, /line 2, column 10: a single `\\` inside a path/);
  assert.equal(settingsFault(path.join(folder, 'none.json')), null);
  assert.match(settingsFaultLine({ folder, claudeHome: null }), /settings\.local\.json can't be read: line 2, column 10\. a single/);
});

test('the fault is read again once the file changes', () => {
  const folder = folderWith({ '.claude/settings.local.json': '{ nope' });
  const file = path.join(folder, '.claude', 'settings.local.json');
  assert.notEqual(settingsFault(file), null);
  fs.writeFileSync(file, '{ "a": "a longer, valid file" }');
  assert.equal(settingsFault(file), null);
});

test('the mend doubles each backslash that is not a valid escape, and keeps a copy (review focus 2)', () => {
  const text = '{\n "a": "C:\\Users\\x",\n "b": "line\\nbreak"\n}';
  const folder = folderWith({ '.claude/settings.local.json': text });
  const local = path.join(folder, '.claude', 'settings.local.json');
  mend(damagedSettings({ folder, claudeHome: null }));
  assert.deepEqual(JSON.parse(fs.readFileSync(local, 'utf8')), { a: 'C:\\Users\\x', b: 'line\nbreak' });
  assert.equal(fs.readFileSync(`${local}.broken`, 'utf8'), text);
});

test('the mend doubles a backslash-u that isn\'t followed by four hex digits, as in C:/users written with backslashes, and keeps a real one', () => {
  const folder = folderWith({ '.claude/settings.local.json': '{"a": "C:\\users\\x", "b": "caf\\u00e9"}' });
  const local = path.join(folder, '.claude', 'settings.local.json');
  mend(damagedSettings({ folder, claudeHome: null }));
  assert.deepEqual(JSON.parse(fs.readFileSync(local, 'utf8')), { a: 'C:\\users\\x', b: 'café' });
});

test('the card and the line never quote the file, only its place', () => {
  const folder = folderWith({ '.claude/settings.local.json': '{"env": {"TOKEN": "sk-secret-1"}, "a": "C:\\x"}' });
  const { card } = mendAsk(damagedSettings({ folder, claudeHome: null }));
  assert.doesNotMatch(JSON.stringify(card), /secret/);
  assert.doesNotMatch(settingsFaultLine({ folder, claudeHome: null }), /secret/);
});
