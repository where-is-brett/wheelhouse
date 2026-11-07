// tests/scripts/proof/data.test.js
// The data snapshot a project's command prints, and the comparison of two (design section 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, dataSnapshot, parseSnapshot } from '../../../scripts/proof/data.js';

const table = (name, rows, sample = []) => ({ name, rows, sample });
const snap = (...tables) => ({ tables });

test('a snapshot is read from the command\'s output, noise before it passed over', async () => {
  const printed = JSON.stringify(snap(table('boats', 3, [{ key: 'w-tide-1', values: { status: 'new' } }])));
  const got = await dataSnapshot({ command: 'print-data', cwd: '/x', env: { A: '1' }, run: async (args) => {
    assert.deepEqual(args, { command: 'print-data', cwd: '/x', env: { A: '1' } });
    return { code: 0, stdout: `Connecting...\n${printed}\n`, stderr: '' };
  } });
  assert.deepEqual(got, snap(table('boats', 3, [{ key: 'w-tide-1', values: { status: 'new' } }])));
  assert.deepEqual(parseSnapshot(JSON.stringify({ tables: [{ name: 'a', rows: 0 }] })), snap(table('a', 0)));
});

test('a command that fails, or prints something that is not tables, is an error in plain words', async () => {
  await assert.rejects(dataSnapshot({ command: 'x', cwd: '/', run: async () => ({ code: 1, stdout: '', stderr: 'no route to the database' }) }), /failed: no route/);
  await assert.rejects(dataSnapshot({ command: 'x', cwd: '/', run: async () => ({ code: 0, stdout: 'hello', stderr: '' }) }), /did not print the tables/);
  await assert.rejects(dataSnapshot({ command: '', cwd: '/', run: async () => ({}) }), /missing/);
  assert.throws(() => parseSnapshot('{"tables":[{"name":"a","rows":-1}]}'), /row count/);
  assert.throws(() => parseSnapshot('{"tables":[{"name":"a","rows":1},{"name":"a","rows":1}]}'), /twice/);
});

test('counts, changed values and unexpected moves are reported', () => {
  const before = snap(
    table('boats', 3, [{ key: 'w-tide-1', values: { status: 'new', owner: 'x' } }, { key: 'w-tide-2', values: { status: 'new' } }]),
    table('crews', 5, [{ key: 'c1', values: { name: 'a' } }]),
    table('logs', 9),
  );
  const after = snap(
    table('boats', 4, [{ key: 'w-tide-1', values: { status: 'ready', owner: 'x' } }, { key: 'w-tide-2', values: { status: 'new' } }]),
    table('crews', 5, [{ key: 'c1', values: { name: 'b' } }]),
    table('logs', 9),
    table('tides', 1),
  );
  const got = compareSnapshots(before, after, { expect: ['boats'] });
  assert.deepEqual(got.counts, [
    { table: 'boats', before: 3, after: 4 }, { table: 'crews', before: 5, after: 5 },
    { table: 'logs', before: 9, after: 9 }, { table: 'tides', before: null, after: 1 },
  ]);
  assert.deepEqual(got.changed, [
    { table: 'boats', key: 'w-tide-1', column: 'status', before: 'new', after: 'ready' },
    { table: 'crews', key: 'c1', column: 'name', before: 'a', after: 'b' },
  ]);
  // crews moved by value, tides appeared: neither is in expect. boats is, and logs didn't move.
  assert.deepEqual(got.unexpected, ['crews moved, and the change was not expected to touch it', 'tides moved, and the change was not expected to touch it']);
});

test('with no change expected, any move is unexpected, and no move is none', () => {
  const same = snap(table('boats', 3, [{ key: 'k', values: { a: 1 } }]));
  assert.deepEqual(compareSnapshots(same, same).unexpected, []);
  assert.deepEqual(compareSnapshots(same, snap(table('boats', 2, [{ key: 'k', values: { a: 1 } }]))).unexpected, ['boats moved, and no change to the data was expected']);
});
