// tests/scripts/lib/settings-card.test.js
// The card that confirms the computer's git settings again: its words hold names of settings and never a value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD } from '../../../scripts/lib/front-desk.js';
import { setLinesOf } from '../../../scripts/state/card-lines.js';
import { settingName, settingNames, settingsChange, settingsCard, settingsLine, SETTINGS_LINE, settingsCardNote } from '../../../scripts/lib/settings-card.js';

const HASH = 'ab12'.repeat(16);

test('a setting is named by its first and last parts, so an address or a sign-in in its section never shows', () => {
  assert.equal(settingName('http.proxy'), 'http.proxy');
  assert.equal(settingName('credential.https://ada:s3cretpass@git.example.org.helper'), 'credential.helper');
  assert.equal(settingName('URL.https://ada:tok@x.example.org/.insteadOf'), 'url.insteadof');
  assert.equal(settingName('include.path'), 'include.path');
  assert.deepEqual(settingNames(['http.proxy', 'credential.helper', 'credential.helper', 'url.https://a.b/.insteadof']), ['credential.helper', 'http.proxy', 'url.insteadof']);
  assert.match(settingName(`x.${'a'.repeat(30)}`), /<long>/);
});

test('the change is what was added and taken away, and none when no names were kept', () => {
  assert.deepEqual(settingsChange({ names: ['a.b', 'c.d'], was: ['a.b', 'e.f'] }), { added: ['c.d'], removed: ['e.f'], changed: [] });
  assert.deepEqual(settingsChange({ names: ['a.b'], was: ['a.b'], changed: ['a.b'] }), { added: [], removed: [], changed: ['a.b'] });
  assert.equal(settingsChange({ names: ['a.b'], was: null }), null);
  assert.match(settingsCard(HASH, settingsChange({ names: ['a.b'], was: ['a.b'], changed: ['http.sslcainfo'] })).question, /value differs: http\.sslcainfo/);
  // Read by another git program than the one that confirmed them: the card says so, in plain words and with no path.
  assert.deepEqual(settingsChange({ names: ['a.b'], was: ['a.b'], otherGit: true }), { added: [], removed: [], changed: [], otherGit: true });
  const other = settingsCard(HASH, settingsChange({ names: ['a.b'], was: ['a.b'], otherGit: true })).question;
  assert.match(other, /another git program than the one they were confirmed with/);
  assert.ok(other.length <= CARD.chars);
  assert.doesNotMatch(settingsCard(HASH, settingsChange({ names: ['a.b'], was: ['a.b'] })).question, /another git program/);
});

test('the card is a question of the First Mate\'s limits, with one line that names the settings by a hash, and says the click is in the window', () => {
  for (const change of [{ added: ['http.proxy'], removed: ['url.insteadof'] }, { added: [], removed: [] }, null]) {
    const card = settingsCard(HASH, change);
    assert.ok(card.question.length <= CARD.chars);
    assert.ok(card.header.length <= CARD.header);
    assert.deepEqual(card.options, ['Confirm', 'Not now']);
    const lines = card.question.split('\n');
    assert.equal(lines.at(-1), settingsLine(HASH));
    assert.equal(SETTINGS_LINE.exec(lines.at(-1))[1], HASH.slice(0, 12));
    assert.equal(card.line, lines.at(-1));
    assert.match(card.question, /never in the chat/);
    assert.deepEqual(setLinesOf(card.question), [], 'it is no set line the prompt record reads, so no chat click signs it');
  }
  assert.match(settingsCard(HASH, { added: ['http.proxy'], removed: ['url.insteadof'] }).question, /Settings added: http\.proxy; taken away: url\.insteadof\./);
  assert.match(settingsCard(HASH, { added: [], removed: [] }).question, /different value/);
  assert.match(settingsCard(HASH, null).question, /can't say which ones changed/);
});

test('a long list of names is cut short, and a value that got into a name is cut to a plain name', () => {
  const many = Array.from({ length: 9 }, (_, i) => `http.n${i}`);
  assert.match(settingsCard(HASH, { added: many, removed: [] }).question, /http\.n0, http\.n1, http\.n2, http\.n3, http\.n4, http\.n5 and 3 more/);
  const odd = settingsCard(HASH, { added: ['http.https://ada:s3cretpass@x.example.org/.proxy'], removed: [] });
  assert.doesNotMatch(odd.question, /s3cretpass|example/);
});

test('the note to the First Mate names the card and the command', () => {
  assert.match(settingsCardNote('c1'), /`confirm c1`/);
});
