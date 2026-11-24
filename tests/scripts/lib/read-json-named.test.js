// tests/scripts/lib/read-json-named.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonNamed, faultLine, BACKSLASH_HINT } from '../../../scripts/lib/read-json-named.js';
import { tempFolder } from '../../helpers/homes.js';

const write = (text) => {
  const file = path.join(tempFolder('named'), 'x.json');
  fs.writeFileSync(file, text);
  return file;
};

test('a file with a lone backslash in a path is named with its line and column and the Windows hint', () => {
  const file = write('{\n "a": "C:\\Users\\x"\n}');
  const result = readJsonNamed(file);
  assert.equal(result.ok, false);
  assert.equal(result.file, file);
  assert.equal(result.line, 2);
  assert.equal(result.column, 10);
  assert.equal(result.hint, 'a single `\\` inside a path must be written `\\\\`, or use `/`');
  assert.equal(result.hint, BACKSLASH_HINT);
  assert.equal(faultLine(result), `${file} can't be read: line 2, column 10. ${BACKSLASH_HINT}`);
});

test('a stray comma is named by its own place, with a plain fix', () => {
  const result = readJsonNamed(write('{\n "a": 1,\n}'));
  assert.deepEqual([result.ok, result.line, result.column, result.hint], [false, 2, 8, 'take out the comma just before the closing bracket']);
});

test('every fault has its place and a plain fix, wherever JSON.parse gives no place', () => {
  const cases = [
    ['{"a": True}', 1, 7, /true, false, null/],
    ['{\n "a": 1\n "b": 2\n}', 3, 2, /comma is missing/],
    ['{\n "a": 1 // note\n}', 2, 9, /notes starting/],
    ["{'a': 1}", 1, 2, /double quotes/],
    ['{"a": "C:\\users\\x"}', 1, 10, /single `\\` inside a path/],
    ['{"a": [1, 2', 1, 12, /ends too soon/],
    ['{"a": "one\ntwo"}', 1, 11, /runs onto the next line/],
    ['{} x', 1, 4, /more after the last/],
  ];
  for (const [text, line, column, hint] of cases) {
    const result = readJsonNamed(write(text));
    assert.deepEqual([result.ok, result.line, result.column], [false, line, column], text);
    assert.match(result.hint, hint, text);
  }
});

test('nothing of the file\'s text comes back with a fault, not even around the place', () => {
  for (const text of ['{"token": "sk-secret-1", "a": True}', '{"token": "sk-secret-1" "a": 1}', '{"token": "sk-secret-1\\q"}', '{"token": sk-secret-1}']) {
    const file = write(text);
    const result = readJsonNamed(file);
    assert.equal(result.ok, false, text);
    assert.doesNotMatch(JSON.stringify(result), /secret/, text);
    assert.doesNotMatch(faultLine(result), /secret/, text);
  }
});

test('a file that can\'t be opened is named with a plain reason and no made-up place', () => {
  const dir = tempFolder('named');
  const result = readJsonNamed(dir);
  assert.deepEqual([result.ok, result.line, result.column], [false, null, null]);
  assert.equal(faultLine(result), `${dir} can't be read: it is a folder, not a file`);
});

test('a missing file is missing, not a fault, and an unreadable one is never empty (review focus 2)', () => {
  const dir = tempFolder('named');
  assert.deepEqual(readJsonNamed(path.join(dir, 'none.json')), { ok: true, missing: true });
  for (const text of ['{"a": ', '', '{"a" 1}', '{\n "a": "C:\\x"}']) {
    const result = readJsonNamed(write(text));
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
  }
});

test('a file that reads gives its value, past a byte-order mark', () => {
  assert.deepEqual(readJsonNamed(write('﻿{"a": [1]}')), { ok: true, value: { a: [1] } });
});
