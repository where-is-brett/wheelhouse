// tests/scripts/desk/file-source.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileSource } from '../../../scripts/desk/file-source.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { as, shortHome } from '../../helpers/homes.js';
import { P, now, writeRecord, upClient } from './fixture.js';

function withRecord(fn) {
  const home = shortHome();
  return as(home, async () => {
    const repo = writeRecord(home);
    return fn({ repo, source: fileSource(P, { cwd: repo, client: upClient, now }) });
  });
}

test('views give what the helper\'s /state/views gives, with the events asked for', () => withRecord(async ({ source }) => {
  const plain = await source.views();
  assert.equal(plain.ok, true);
  assert.equal(plain.views.waiting[0].id, 'c1');
  assert.deepEqual(plain.names.includes('name'), true);
  assert.equal(plain.cards, undefined);
  const asked = await source.views({ cards: true, answers: true });
  assert.deepEqual(asked.cards, []);
  assert.deepEqual(asked.answers, []);
}));

test('views say STOP is on', () => withRecord(async ({ source }) => {
  setStop({ by: 'mod' });
  assert.equal((await source.views()).stop, true);
}));

test('the board\'s inputs are the project\'s', () => withRecord(async ({ source }) => {
  const inputs = await source.board({ offline: true });
  assert.equal(inputs.project, P);
  assert.ok(inputs.model);
}));

test('a card that is no approval has no preview', () => withRecord(async ({ source }) => {
  assert.equal(await source.preview('c1'), null);
  assert.equal(await source.preview('missing'), null);
}));

test('the director\'s own settings are read', () => withRecord(async ({ source }) => {
  assert.equal((await source.profile()).settings.explanations.value, 'plain');
}));
