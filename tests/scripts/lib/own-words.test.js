// tests/scripts/lib/own-words.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownWords } from '../../../scripts/lib/own-words.js';

const B = '<system-reminder>\nLinked sessions now: x\n</system-reminder>';

// The same table runs against the mod's copy in tests/mod/messages.test.ts.
const CASES = [
  ['stop', 'stop'],
  ['  K7QD Approve ', '  K7QD Approve '],
  ['', ''],
  [`${B}\n\nstop`, 'stop'],
  [`${B}\nstop`, 'stop'],
  [`${B}\n\n\n\nstop`, 'stop'],
  [`${B}\n\n${B}\n\nstop`, 'stop'],
  [`${B}\n${B}\nstop`, 'stop'],
  [B, ''],
  [`${B}\n\n`, ''],
  [`<system-reminder>\n</system-reminder>\nstop`, 'stop'],
  [`${B}\n\nstop\n<system-reminder>\nmore\n</system-reminder>`, null],
  [`${B}\nT8E3 Confirm\n<system-reminder>\nmore\n</system-reminder>\n\nhello`, null],
  [`${B}\n\nstop </system-reminder>`, null],
  [`${B}\n\n<system-reminder>`, null],
  // A block is read past only whole and only at the start.
  [`hello\n${B}`, `hello\n${B}`],
  [`<system-reminder> inline </system-reminder>\nstop`, '<system-reminder> inline </system-reminder>\nstop'],
  [`<system-reminder>\nunclosed\nstop`, '<system-reminder>\nunclosed\nstop'],
];

test('ownWords reads past whole leading reminder blocks and nothing else', () => {
  for (const [text, want] of CASES) assert.equal(ownWords(text), want, JSON.stringify(text));
});
