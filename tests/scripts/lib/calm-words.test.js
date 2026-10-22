// tests/scripts/lib/calm-words.test.js
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as words from '../../../scripts/lib/calm-words.js';
import { PUT_OFF } from '../../../scripts/lib/front-desk.js';

test('verdict opens with words up to nine and figures after', () => {
  const said = (waiting, broken = 0) => words.verdict({ waiting, broken });
  assert.equal(said(0), 'Nothing needs you. Nothing is broken.');
  assert.equal(said(1), 'One thing needs you. Nothing is broken.');
  assert.equal(said(2), 'Two things need you. Nothing is broken.');
  assert.equal(said(9), 'Nine things need you. Nothing is broken.');
  assert.equal(said(10), '10 things need you. Nothing is broken.');
  assert.equal(said(12), '12 things need you. Nothing is broken.');
  assert.equal(said(0, 1), 'Nothing needs you. One thing is broken.');
  assert.equal(said(2, 1), 'Two things need you. One thing is broken.');
  assert.equal(said(12, 2), '12 things need you. 2 things are broken.');
  assert.equal(said(1, 11), 'One thing needs you. 11 things are broken.');
  assert.equal(words.NOTHING_NEEDS_YOU, 'Nothing needs you.');
});

test('every set word is one line of British English with no exclamation mark', () => {
  const lines = [];
  for (const [name, value] of Object.entries(words)) {
    if (typeof value === 'string') lines.push([name, value]);
  }
  lines.push(
    ['suggestedAt', words.suggestedAt('14:10')], ['typeYourChange', words.typeYourChange(1)],
    ['staleLine', words.staleLine('14:05', '14:02')], ['sinceLine', words.sinceLine('09:10')],
    ['verdict', words.verdict({ waiting: 3, broken: 2 })], ['askedAgo', words.askedAgo(2, 'hour')],
    ['decidedToast', words.decidedToast('Approve', 'It goes live within the hour.')], ['awayToast', words.awayToast('Away until 18:00', true)],
  );
  assert.equal(lines.length, 33, 'every word is held');
  for (const [name, line] of lines) {
    assert.ok(line.trim() === line && line !== '', `${name} is not empty or padded`);
    assert.ok(!/[\r\n]/.test(line), `${name} is one line`);
    assert.ok(!line.includes('!'), `${name} has no exclamation mark`);
    assert.ok(!/\b(color|center|organize|recognize|behavior)\b/i.test(line), `${name} is British English`);
  }
});

test('the set words are the ones the design names', () => {
  assert.equal(words.SUGGEST, 'Suggest a change…');
  assert.ok(words.SUGGEST.endsWith('…'), 'a real ellipsis, not three full stops');
  assert.equal(words.WHY, 'Why?');
  assert.equal(words.HIDE_WHY, 'Hide why');
  assert.equal(words.SHOW_ME, 'Show me');
  assert.equal(words.NOT_NOW, 'Not now');
  assert.equal(words.TO_KNOW_MORE, 'To know more, just ask.');
  assert.equal(words.TO_CHANGE_IT, 'To change it, type what you\'d change.');
  assert.equal(words.WHAT_CHANGED, 'What changed:');
  assert.equal(words.SUGGEST_SAYS, 'Tell me what you\'d change; I\'ll come back with a new proposal.');
  assert.equal(words.WHAT_WOULD_YOU_CHANGE, 'What would you change?');
  assert.equal(words.SENT_TO_FRONT_DESK, 'Sent to the front desk. A new proposal will follow.');
  assert.equal(words.RECORDING, 'Recording…');
  assert.equal(words.NOT_HANDED, 'That didn\'t reach the front desk. Type it in the chat instead.');
  assert.equal(words.SETTING_UP, 'Setup is still running. This pane opens when it finishes.');
  assert.equal(words.NOT_HERE, 'This pane lives in the front desk\'s chat. Type /wheelhouse there.');
  assert.equal(words.SETTINGS_UNDER_STOP, 'Settings can\'t change while STOP is on. Lift STOP first.');
  assert.equal(words.CHANGED_WHILE_READING, 'That card changed while you were reading. Here is the new one.');
  assert.equal(words.STOP_HALTS, 'Halts every builder at once.');
  assert.equal(words.ONLY_YOU_LIFT, 'Only you can lift it.');
});

test('staleLine and suggestedAt say the times as given', () => {
  assert.equal(words.staleLine('14:05', '14:02'), 'Couldn\'t read the latest at 14:05. Showing 14:02\'s.');
  assert.equal(words.staleLine('09:01', '08:59'), 'Couldn\'t read the latest at 09:01. Showing 08:59\'s.');
  assert.equal(words.suggestedAt('14:10'), 'You suggested a change at 14:10. A new proposal is on its way, and nothing goes live meanwhile.');
  assert.equal(words.sinceLine('09:10'), 'Since you were last here at 09:10.');
  assert.equal(words.typeYourChange(1), 'Type your change in the chat, and I\'ll know it\'s about card 1.');
  assert.equal(words.typeYourChange(3), 'Type your change in the chat, and I\'ll know it\'s about card 3.');
});

test('PUT_OFF holds Why? and Suggest a change… and keeps Explain more', () => {
  assert.deepEqual([...PUT_OFF], ['Not now', 'Explain more', 'Show me', 'Why?', 'Suggest a change…']);
  for (const label of [words.WHY, words.SUGGEST, words.SHOW_ME, words.NOT_NOW, 'Explain more']) {
    assert.ok(PUT_OFF.includes(label), `${label} never answers a card`);
  }
});

test('each pane message reads as section 23.7 has it', () => {
  assert.equal(words.RECORDING, 'Recording…');
  assert.equal(words.NOT_HANDED, 'That didn\'t reach the front desk. Type it in the chat instead.');
  assert.equal(words.SETTING_UP, 'Setup is still running. This pane opens when it finishes.');
  assert.equal(words.NOT_HERE, 'This pane lives in the front desk\'s chat. Type /wheelhouse there.');
  assert.equal(words.SETTINGS_UNDER_STOP, 'Settings can\'t change while STOP is on. Lift STOP first.');
  assert.equal(words.staleLine('14:05', '14:02'), 'Couldn\'t read the latest at 14:05. Showing 14:02\'s.');
  assert.equal(words.NOT_RECORDED, 'That wasn\'t recorded. Try again, or type it in the chat.');
});

test('a deciding toast is the label in the past, then what happens where the card says when', () => {
  assert.equal(words.decidedToast('Approve', 'It goes live within the hour.'), 'Approved. It goes live within the hour.');
  assert.equal(words.decidedToast('Approve', 'Nothing is released; the agents carry on with other work.'), 'Approved.');
  assert.equal(words.decidedToast('Confirm', 'that feature waits; the others carry on'), 'Confirmed.');
  assert.equal(words.decidedToast('Confirm', 'The change is in force; it applies by 18:00.'), 'Confirmed. It applies by 18:00.');
  assert.equal(words.decidedToast('Do it', undefined), 'Done.');
  assert.equal(words.decidedToast('Lift STOP', 'Builders start again within the hour.'), 'STOP lifted. Builders start again within the hour.');
  assert.equal(words.awayToast('Away until 18:00', true), 'Away until 18:00. Undo in the pane for a minute.');
  assert.equal(words.awayToast('Here', false), 'Here.');
});

test('no message in the mod or the bridge has an exclamation mark, Oops or Great news', () => {
  const root = path.resolve(import.meta.dirname, '..', '..', '..');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // validate.js is the mod's checker for its maintainers: its source is regular expressions and code patterns, not messages.
      else if (/\.(js|ts|tsx)$/.test(entry.name) && entry.name !== 'validate.js') files.push(full);
    }
  };
  walk(path.join(root, 'hooks'));
  walk(path.join(root, 'scripts', 'mod'));
  assert.ok(files.length > 14, 'the mod and the bridge are read');
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\b(?:oops|great news)\b/i, `${file} has no Oops or Great news`);
    // A quoted string is a message; a "!" in code (not, not-equal) is not inside one. Comments go first.
    let code = text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s\/\/ .*$/gm, '');
    // A template's ${...} is code, so it goes too, innermost first.
    for (let before = ''; before !== code;) {
      before = code;
      code = code.replace(/\$\{(?:[^{}`]|`[^`]*`)*\}/g, '');
    }
    const quotes = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|\$\{[^}]*\}|[^`\\])*)`/g;
    for (const match of code.matchAll(quotes)) {
      const quoted = (match[1] ?? match[2] ?? match[3]).replaceAll('(?!', '');
      // A string with no word in it is a list of characters for code to test, not a message.
      assert.ok(!/[a-z]{3}/i.test(quoted) || !quoted.includes('!'), `${path.relative(root, file)} has an exclamation mark in "${quoted}"`);
    }
  }
});
