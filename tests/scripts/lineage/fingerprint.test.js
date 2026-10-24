// tests/scripts/lineage/fingerprint.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fingerprintFile, fingerprintTree } from '../../../scripts/lineage/fingerprint.js';
import { tempFolder } from '../../helpers/homes.js';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const whole = (entries) => sha256(entries.map(([name, content]) => `${name}\0${sha256(content)}\n`).join(''));

function folderWith(files) {
  const dir = tempFolder('wh-fp-');
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, ...name.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

test('the same folder checked out with CRLF and with LF has one fingerprint', () => {
  const lf = folderWith({ 'SKILL.md': 'one\ntwo\n\nthree', 'sub/a.txt': 'x\ny\n' });
  const crlf = folderWith({ 'SKILL.md': 'one\r\ntwo\r\n\r\nthree', 'sub/a.txt': 'x\r\ny\r\n' });
  const cr = folderWith({ 'SKILL.md': 'one\rtwo\r\rthree', 'sub/a.txt': 'x\ry\r' });
  const expected = { hash: whole([['SKILL.md', 'one\ntwo\n\nthree'], ['sub/a.txt', 'x\ny\n']]), files: 2 };
  assert.deepEqual(fingerprintTree(lf), expected);
  assert.deepEqual(fingerprintTree(crlf), expected);
  assert.deepEqual(fingerprintTree(cr), expected);
  // A different text is a different fingerprint.
  assert.notEqual(fingerprintTree(folderWith({ 'SKILL.md': 'one\ntwo\n\nthree!', 'sub/a.txt': 'x\ny\n' })).hash, expected.hash);
  // The same for one file.
  const one = fingerprintFile(path.join(crlf, 'SKILL.md'));
  assert.deepEqual(one, { hash: whole([['SKILL.md', 'one\ntwo\n\nthree']]), files: 1 });
  assert.deepEqual(fingerprintFile(path.join(lf, 'SKILL.md')), one);
});

test('paths are sorted by code point and joined with / on every system', () => {
  // Written in an order that differs from the sorted one; "B" sorts before "a", "-" before "/" before "a", and a
  // character beyond the Basic Multilingual Plane after one inside it.
  const names = ['zz.md', 'a.md', 'B.md', 'dir/a.md', 'dir-b.md', 'dir/sub/deep.md', '\u{1F600}.md', '～.md'];
  const dir = folderWith(Object.fromEntries(names.map((name) => [name, `text of ${name}`])));
  const sorted = ['B.md', 'a.md', 'dir-b.md', 'dir/a.md', 'dir/sub/deep.md', 'zz.md', '～.md', '\u{1F600}.md'];
  assert.deepEqual(fingerprintTree(dir), { hash: whole(sorted.map((name) => [name, `text of ${name}`])), files: sorted.length });
});

test('a link is hashed as its target text and not followed', (t) => {
  const outside = tempFolder('wh-fp-out-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'content of the target');
  const dir = folderWith({ 'real.md': 'real' });
  try {
    fs.symlinkSync('../elsewhere/target.md', path.join(dir, 'link.md'));
    fs.symlinkSync(outside, path.join(dir, 'dirlink'), 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) {
      t.skip(`this system refuses to make links (${error.code})`);
      return;
    }
    throw error;
  }
  assert.deepEqual(fingerprintTree(dir), {
    // A link to a folder is a single entry: its target's files are not walked.
    hash: whole([['dirlink', outside.split(path.sep).join('/')], ['link.md', '../elsewhere/target.md'], ['real.md', 'real']]),
    files: 3,
  });
  assert.deepEqual(fingerprintFile(path.join(dir, 'link.md')), { hash: whole([['link.md', '../elsewhere/target.md']]), files: 1 });
  // The target's content does not matter, nor does its existing.
  fs.rmSync(outside, { recursive: true, force: true });
  assert.equal(fingerprintTree(dir).files, 3);
});

test('a binary file is hashed as it is', () => {
  const binary = Buffer.concat([Buffer.from([0x89, 0x50, 0x00, 0x0d, 0x0a, 0x1a, 0x0a, 0x0d]), Buffer.from('\r\ntext\r\n')]);
  const dir = folderWith({ 'image.png': binary, 'text.md': 'a\r\nb' });
  assert.deepEqual(fingerprintTree(dir), { hash: whole([['image.png', binary], ['text.md', 'a\nb']]), files: 2 });
  assert.deepEqual(fingerprintFile(path.join(dir, 'image.png')).hash, whole([['image.png', binary]]));
});

test('a NUL byte after the first 8 KB does not make a file binary', () => {
  const late = Buffer.concat([Buffer.from('a\r\n'.repeat(3000)), Buffer.from([0]), Buffer.from('b\r\n')]);
  const dir = folderWith({ 'big.txt': late });
  const evened = Buffer.concat([Buffer.from('a\n'.repeat(3000)), Buffer.from([0]), Buffer.from('b\n')]);
  assert.equal(fingerprintTree(dir).hash, whole([['big.txt', evened]]));
});

test('an empty folder and an empty file', () => {
  assert.deepEqual(fingerprintTree(folderWith({})), { hash: sha256(''), files: 0 });
  assert.deepEqual(fingerprintTree(folderWith({ 'empty.md': '' })), { hash: whole([['empty.md', '']]), files: 1 });
});

test('a file name differing only in case is a different path', (t) => {
  const dir = tempFolder('wh-fp-case-');
  fs.writeFileSync(path.join(dir, 'Skill.md'), 'upper');
  try {
    fs.writeFileSync(path.join(dir, 'skill.md'), 'lower', { flag: 'wx' });
  } catch {
    // Case-insensitive file system: only one of the two exists.
    t.skip('this file system treats names that differ only in case as one name');
    return;
  }
  if (fs.readdirSync(dir).length < 2) { t.skip('this file system treats names that differ only in case as one name'); return; }
  assert.equal(fingerprintTree(dir).hash, whole([['Skill.md', 'upper'], ['skill.md', 'lower']]));
});
