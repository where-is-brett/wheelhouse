// tests/scripts/state/approved-text.test.js
// The copy of a document's text that is kept when the director approves it, and the whole-file install of a text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { approvedDir, keepApprovedText, approvedText, installText } from '../../../scripts/state/approved-text.js';
import { briefHash } from '../../../scripts/feature/files.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const P = 'owner__name';

test('a kept text is read back by its hash', async () => {
  await withHome(async () => {
    const hash = keepApprovedText(P, 'The design.\n');
    assert.equal(hash, briefHash('The design.\n'));
    assert.equal(approvedText(P, hash), 'The design.\n');
    assert.ok(fs.existsSync(path.join(approvedDir(P), `${hash}.md`)));
  });
});

test('a copy changed on disk, or a hash never kept, gives null', async () => {
  await withHome(async () => {
    const hash = keepApprovedText(P, 'The design.\n');
    fs.writeFileSync(path.join(approvedDir(P), `${hash}.md`), 'Something else.\n');
    assert.equal(approvedText(P, hash), null);
    assert.equal(approvedText(P, briefHash('never kept')), null);
  });
});

test('keeping the same text twice does not throw and leaves the copy as it was', async () => {
  await withHome(async () => {
    const first = keepApprovedText(P, 'Same.\n');
    const second = keepApprovedText(P, 'Same.\n');
    assert.equal(second, first);
    assert.equal(approvedText(P, first), 'Same.\n');
    assert.deepEqual(fs.readdirSync(approvedDir(P)), [`${first}.md`]);
  });
});

test('installText replaces a file whole and leaves no temp file behind', () => {
  const dir = tempFolder('wh-install-');
  const file = path.join(dir, 'x.md');
  fs.writeFileSync(file, 'old text that is longer than the new one\n');
  installText(file, 'new\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new\n');
  assert.deepEqual(fs.readdirSync(dir), ['x.md']);
});
