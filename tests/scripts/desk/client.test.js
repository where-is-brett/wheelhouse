// tests/scripts/desk/client.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { deskClient, HELPER_NOT_RUNNING } from '../../../scripts/desk/client.js';
import { readView } from '../../../scripts/desk/views.js';
import { fileSource } from '../../../scripts/desk/file-source.js';
import { stopState } from '../../../scripts/lib/stop.js';
import { as, shortHome } from '../../helpers/homes.js';
import { P, now, writeRecord, upClient } from './fixture.js';

// A helper client whose helper isn't running, in its own words, and which is up for the board's health.
const down = {
  ...upClient,
  desk: Object.fromEntries(['read', 'act', 'watch'].map((op) => [op, async () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' })])),
};

function withRecord(fn) {
  const home = shortHome();
  return as(home, async () => fn({ repo: writeRecord(home) }));
}

test('with no helper, read runs in process and gives the same view', () => withRecord(async ({ repo }) => {
  const desk = deskClient({ cwd: repo, client: down, now });
  const got = await desk.read('waiting');
  assert.equal(got.ok, true, got.refused);
  assert.equal(got.local, true);
  const same = await readView('waiting', {}, fileSource(P, { cwd: repo, client: upClient, now }), { now });
  assert.deepEqual(got.lines, same.lines);
  assert.equal((await desk.watch(null)).ok, true);
}));

test('with no helper, all-stop sets STOP', () => withRecord(async ({ repo }) => {
  const got = await deskClient({ cwd: repo, client: down, now }).act('all-stop', { by: 'mod' });
  assert.equal(got.ok, true, got.refused);
  assert.equal(stopState().on, true);
  assert.equal(stopState().by, 'mod');
}));

test('with no helper, answer is refused in plain words', () => withRecord(async ({ repo }) => {
  const got = await deskClient({ cwd: repo, client: down, now }).act('answer', { card: 'c1', option: 'Approve' }, { form: 'signed', records: [] });
  assert.equal(got.ok, false);
  assert.equal(got.refused, HELPER_NOT_RUNNING);
  assert.equal(stopState().on, false);
}));

test('local is never used when the home can\'t be read', () => withRecord(async ({ repo }) => {
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = path.join(shortHome(), 'not-there');
  try {
    const desk = deskClient({ cwd: repo, client: down, now });
    const got = await desk.read('waiting');
    assert.equal(got.ok, false);
    assert.equal(got.local, undefined);
    assert.equal((await desk.act('all-stop', { by: 'mod' })).ok, false);
  } finally {
    process.env.WHEELHOUSE_HOME = before;
  }
  assert.equal(stopState().on, false);
}));

test('a helper that answers is used, and local is off when asked', () => withRecord(async ({ repo }) => {
  const asked = [];
  const up = { desk: { read: async (body) => { asked.push(body); return { ok: true, v: 'desk/1', view: 'waiting', lines: ['from the helper'] }; } } };
  assert.deepEqual((await deskClient({ cwd: repo, client: up }).read('waiting', { answers: true })).lines, ['from the helper']);
  assert.deepEqual(asked, [{ v: 'desk/1', cwd: repo, view: 'waiting', args: { answers: true } }]);
  assert.equal((await deskClient({ cwd: repo, client: down, local: 'never' }).read('waiting')).local, undefined);
}));
