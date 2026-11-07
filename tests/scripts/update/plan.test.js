// tests/scripts/update/plan.test.js
// The plan an update card is made from (update design, section 4), here for a carry-on: the release it moves from is the one the
// project had before the update, never the release this computer runs now (which is the new one once the install is done).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makePlan, partWay } from '../../../scripts/update/plan.js';
import { tempFolder } from '../../helpers/homes.js';

const SHA = 'a'.repeat(40);
const done = (data = {}) => ({ state: 'done', data });
const journal = (steps, folder) => ({ folder, steps: { checks: done({ tag: 'v0.2.7', sha: SHA, from: null, put: 'release' }), installs: done(), ...steps } });
const never = () => { throw new Error('nothing outside is looked at on a carry-on'); };
const carryOn = (j) => makePlan({ from: 'v0.2.7', journal: j, list: never, fetch: never, check: never, kind: never });

test('plan: a carry-on moves from the release the change card names as previous, not the installed one', async () => {
  const got = await carryOn(journal({ change: done({ card: { previous: 'v0.2.6', release: 'v0.2.7', commit: SHA } }) }, tempFolder('wh-jour-')));
  assert.equal(got.plan.carryOn, true);
  assert.equal(got.plan.from, 'v0.2.6');
});

test('plan: with no change card yet, a carry-on moves from the install note\'s previous release', async () => {
  const folder = tempFolder('wh-jour-');
  fs.writeFileSync(path.join(folder, 'install.json'), JSON.stringify({ previous: { ref: 'v0.2.6', sha: SHA } }));
  const got = await carryOn(journal({}, folder));
  assert.equal(got.plan.from, 'v0.2.6');
  assert.equal(partWay(journal({}, folder)).from, 'v0.2.6');
});

test('plan: the release the checks step recorded comes first, and the installed one is the last resort', async () => {
  const recorded = journal({ change: done({ card: { previous: 'v0.2.5', release: 'v0.2.7', commit: SHA } }) }, tempFolder('wh-jour-'));
  recorded.steps.checks = done({ tag: 'v0.2.7', sha: SHA, from: 'v0.2.6', put: 'release' });
  assert.equal((await carryOn(recorded)).plan.from, 'v0.2.6');
  assert.equal((await carryOn(journal({}, tempFolder('wh-jour-')))).plan.from, 'v0.2.7');
});

test('plan: a carry-on carries the account line the way a fresh plan does', async () => {
  const j = journal({}, tempFolder('wh-jour-'));
  const make = (account) => makePlan({ from: 'v0.2.7', journal: j, list: never, fetch: never, check: never, kind: never, account });
  assert.deepEqual((await make(() => ({ ref: 'v0.2.9' }))).plan.account, { from: 'v0.2.9', to: 'v0.2.7' });
  assert.equal((await make(() => ({ ref: 'v0.2.7' }))).plan.account, null, 'already at the target: no line');
  assert.equal((await make(() => null)).plan.account, null, 'no declaration: no line');
  assert.deepEqual((await make(() => ({ refused: 'not ours' }))).lines, ['not ours']);
});
