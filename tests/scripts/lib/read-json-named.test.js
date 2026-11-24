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

test('a stray comma is named by its place, with no hint', () => {
  const result = readJsonNamed(write('{\n "a": 1,\n}'));
  assert.deepEqual([result.ok, result.line, result.column, result.hint], [false, 3, 1, '']);
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
