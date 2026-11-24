// tests/scripts/lib/ascii-json.test.js
// The model-facing JSON is ASCII only, parses back to the same text, and reads the same after a Windows code-page decode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asciiJson } from '../../../scripts/lib/ascii-json.js';
import { SUGGEST } from '../../../scripts/lib/calm-words.js';

const sample = { label: SUGGEST, dash: 'a – b — c', accent: 'café', emoji: '😀', plain: 'x' };

test('every character is ASCII and the text parses back unchanged', () => {
  const text = asciiJson(sample, 2);
  assert.match(text, /^[\x00-\x7f]*$/);
  assert.deepEqual(JSON.parse(text), sample);
  assert.ok(text.includes('Suggest a change\\u2026'));
});

test('a Windows code-page decode of the bytes reads the same', () => {
  const bytes = Buffer.from(`${asciiJson(sample, 2)}\n`, 'utf8');
  const asCp1252 = new TextDecoder('windows-1252').decode(bytes);
  assert.deepEqual(JSON.parse(asCp1252), sample);
  // The plain UTF-8 form would have broken: the same decode of it doesn't give the label back.
  const broken = new TextDecoder('windows-1252').decode(Buffer.from(JSON.stringify(sample), 'utf8'));
  assert.notEqual(JSON.parse(broken).label, SUGGEST);
});

test('undefined gives an empty string, as JSON.stringify gives undefined', () => {
  assert.equal(asciiJson(undefined), '');
});
