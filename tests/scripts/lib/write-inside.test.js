// tests/scripts/lib/write-inside.test.js
// The writer that never follows a link: a plain path is written, a link at the file or at a folder on the way is refused and
// nothing is written through it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeInside } from '../../../scripts/lib/write-inside.js';
import { tempFolder } from '../../helpers/homes.js';

test('a file is written, its folders made', () => {
  const root = tempFolder('wh-wi-');
  writeInside(root, '.wheelhouse/work/a.md', 'hello\n');
  assert.equal(fs.readFileSync(path.join(root, '.wheelhouse', 'work', 'a.md'), 'utf8'), 'hello\n');
  writeInside(root, '.wheelhouse/work/a.md', 'again\n');
  assert.equal(fs.readFileSync(path.join(root, '.wheelhouse', 'work', 'a.md'), 'utf8'), 'again\n');
});

test('a link at the file is refused and its target is left alone', () => {
  const root = tempFolder('wh-wi-');
  const target = path.join(tempFolder('wh-wi-out-'), 'zshrc');
  fs.writeFileSync(target, 'mine\n');
  fs.mkdirSync(path.join(root, '.wheelhouse', 'work'), { recursive: true });
  fs.symlinkSync(target, path.join(root, '.wheelhouse', 'work', 'a.md'));
  assert.throws(() => writeInside(root, '.wheelhouse/work/a.md', 'planted\n'));
  assert.equal(fs.readFileSync(target, 'utf8'), 'mine\n');
});

test('a link at a folder on the way is refused and nothing is written through it', () => {
  const root = tempFolder('wh-wi-');
  const outside = tempFolder('wh-wi-out-');
  fs.symlinkSync(outside, path.join(root, '.wheelhouse'));
  assert.throws(() => writeInside(root, '.wheelhouse/work/a.md', 'planted\n'));
  assert.deepEqual(fs.readdirSync(outside), []);
  const other = tempFolder('wh-wi-');
  fs.mkdirSync(path.join(other, '.wheelhouse'));
  fs.symlinkSync(outside, path.join(other, '.wheelhouse', 'work'));
  assert.throws(() => writeInside(other, '.wheelhouse/work/a.md', 'planted\n'));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('a path that climbs out is refused', () => {
  const root = tempFolder('wh-wi-');
  assert.throws(() => writeInside(root, '../x.md', 'x'));
  assert.throws(() => writeInside(root, 'a//b.md', 'x'));
});

test('a file already there is replaced by a new one, never written through', () => {
  const root = tempFolder('wh-wi-');
  const file = writeInside(root, 'a.md', 'one\n');
  const before = fs.statSync(file).ino;
  const link = path.join(root, 'b.md');
  fs.linkSync(file, link);
  writeInside(root, 'a.md', 'two\n');
  assert.equal(fs.readFileSync(link, 'utf8'), 'one\n', 'the other name of the old file is untouched');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n');
  assert.notEqual(fs.statSync(file).ino, before);
});
