// tests/scripts/update/declined.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { declined, decline } from '../../../scripts/update/declined.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { withHome } from '../../helpers/homes.js';

test('declined: nothing is declined until a release is', () => withHome(() => {
  assert.equal(declined('proj'), null);
}));

test('declined: a declined release is remembered for the project, under its folder', () => withHome(() => {
  decline('proj', 'v0.2.7');
  assert.deepEqual(declined('proj'), { tag: 'v0.2.7' });
  assert.equal(declined('other'), null);
  assert.equal(fs.existsSync(path.join(stateDir('proj'), '..', 'declined.json')), true);
}));

test('declined: declining a later release replaces the earlier one', () => withHome(() => {
  decline('proj', 'v0.2.7');
  decline('proj', 'v0.2.8');
  assert.deepEqual(declined('proj'), { tag: 'v0.2.8' });
}));

test('declined: a damaged file reads as nothing declined', () => withHome(() => {
  decline('proj', 'v0.2.7');
  fs.writeFileSync(path.join(stateDir('proj'), '..', 'declined.json'), '{nope');
  assert.equal(declined('proj'), null);
}));

test('declined: only a plain release tag can be declined', () => withHome(() => {
  assert.throws(() => decline('proj', 'v0.3.0-rc.1'));
  assert.throws(() => decline('proj', '../x'));
  assert.equal(declined('proj'), null);
}));
