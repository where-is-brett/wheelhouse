// tests/scripts/survey/ready-record.test.js
// The ready record: what the helper made ready for work to start from, kept in Wheelhouse's own
// folder on this computer, read strictly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readReadyRecord, readyRecordFile, writeReadyRecord } from '../../../scripts/survey/ready-record.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { withHome } from '../../helpers/homes.js';

const SHA = 'c'.repeat(40);
const REF = 'refs/wheelhouse/from/add-export';

test('a ready record sits in the project\'s folder in Wheelhouse\'s home and reads back as written', () => withHome(() => {
  const file = readyRecordFile('o__p', 'add-export');
  assert.equal(file, path.join(wheelhouseHome(), 'projects', 'o__p', 'ready', 'add-export.json'));
  assert.equal(readReadyRecord('o__p', 'add-export'), null, 'none yet');
  writeReadyRecord('o__p', 'add-export', { sha: SHA, ref: REF, request: 7, branch: 'their-line' });
  assert.deepEqual(readReadyRecord('o__p', 'add-export'), { sha: SHA, ref: REF, request: 7, branch: 'their-line' });
  // An archive's has no request and no branch of its own.
  writeReadyRecord('o__p', 'add-export', { sha: SHA, ref: REF, request: null, branch: null });
  assert.deepEqual(readReadyRecord('o__p', 'add-export'), { sha: SHA, ref: REF, request: null, branch: null });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['add-export.json'], 'written whole, no temporary file left');
}));

test('a ready record of the wrong shape is never written, and one malformed on disk reads as none', () => withHome(() => {
  const good = { sha: SHA, ref: REF, request: 7, branch: 'their-line' };
  for (const bad of [
    { ...good, sha: 'short' }, { ...good, ref: 'refs/wheelhouse/from/another' }, { ...good, request: 0 }, { ...good, request: '7' },
    { ...good, branch: '' }, { ...good, branch: 3 }, { ...good, extra: 1 }, { sha: SHA, ref: REF },
  ]) assert.throws(() => writeReadyRecord('o__p', 'add-export', bad), /ready record/, JSON.stringify(bad));
  assert.throws(() => readyRecordFile('../x', 'add-export'));
  assert.throws(() => readyRecordFile('o__p', '../x'));

  const file = readyRecordFile('o__p', 'add-export');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const text of ['not json', '[]', JSON.stringify({ ...good, sha: 'short' }), JSON.stringify({ v: 2, work: 'add-export', ...good }), JSON.stringify({ v: 1, work: 'another', ...good })]) {
    fs.writeFileSync(file, text);
    assert.equal(readReadyRecord('o__p', 'add-export'), null, text);
  }
  // A link in the record's place is not followed, even to a record that would read well.
  if (process.platform === 'win32') return;
  const elsewhere = path.join(wheelhouseHome(), 'elsewhere.json');
  writeReadyRecord('o__p', 'add-export', good);
  fs.renameSync(file, elsewhere);
  fs.symlinkSync(elsewhere, file);
  assert.equal(readReadyRecord('o__p', 'add-export'), null);
}));
