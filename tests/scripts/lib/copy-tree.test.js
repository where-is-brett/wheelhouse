// tests/scripts/lib/copy-tree.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { copyTree } from '../../../scripts/lib/copy-tree.js';
import { tempFolder } from '../../helpers/homes.js';

const unix = process.platform !== 'win32';

test('copyTree copies a folder into one whose name holds an accented letter, files and folders alike', () => {
  const root = tempFolder('wh-copy zoë ');
  const from = path.join(root, 'from');
  fs.mkdirSync(path.join(from, 'skills', 'één'), { recursive: true });
  fs.writeFileSync(path.join(from, 'skills', 'één', 'SKILL.md'), 'Skill.\n');
  fs.writeFileSync(path.join(from, 'LICENSE'), 'licence\n');
  const to = path.join(root, 'claude config', 'cache', 'kit');
  copyTree(from, to);
  assert.equal(fs.readFileSync(path.join(to, 'skills', 'één', 'SKILL.md'), 'utf8'), 'Skill.\n');
  assert.equal(fs.readFileSync(path.join(to, 'LICENSE'), 'utf8'), 'licence\n');
});

test('copyTree without overwrite refuses a file already there and leaves it as it was', () => {
  const root = tempFolder('wh-copy-');
  const from = path.join(root, 'from');
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, 'a.txt'), 'new\n');
  const to = path.join(root, 'to');
  fs.mkdirSync(to);
  fs.writeFileSync(path.join(to, 'a.txt'), 'old\n');
  assert.throws(() => copyTree(from, to, { overwrite: false }), (error) => error.code === 'EEXIST');
  assert.equal(fs.readFileSync(path.join(to, 'a.txt'), 'utf8'), 'old\n');
  copyTree(from, to);
  assert.equal(fs.readFileSync(path.join(to, 'a.txt'), 'utf8'), 'new\n');
});

// Making a link on Windows needs a privilege the test can't count on.
test('copyTree copies a link as a link with its target text, not what it points at', { skip: !unix && 'links need a privilege on Windows' }, () => {
  const root = tempFolder('wh-copy-');
  const from = path.join(root, 'from');
  fs.mkdirSync(from);
  fs.symlinkSync('../elsewhere.txt', path.join(from, 'link'));
  const to = path.join(root, 'to');
  copyTree(from, to);
  assert.equal(fs.readlinkSync(path.join(to, 'link')), '../elsewhere.txt');
});
