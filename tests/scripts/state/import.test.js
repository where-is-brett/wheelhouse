// tests/scripts/state/import.test.js
// The import from Wheelhouse v0.1.x (design section 24.5): the old state clone's events, or the old
// profile clone's, copied into the private record with their own ids, signed ones verified, held
// ones skipped, nothing pushed and nothing of the old folder changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withHome } from '../../helpers/homes.js';
import { run } from '../../../scripts/lib/run.js';
import { stateDir, oldStateDir } from '../../../scripts/lib/paths.js';
import { openProjectRecord, openRecord } from '../../../scripts/state/record.js';
import { makeEvent, writeEvent, listEvents, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, ownKey, sign } from '../../../scripts/state/signing.js';
import { importEvents } from '../../../scripts/state/import.js';

const T0 = new Date('2026-10-20T01:00:00.000Z');
const git = async (dir, args) => (await run('git', args, { cwd: dir })).stdout.trim();

// An old v0.1.x state clone: a repository with a remote, events committed in it (pushed or not).
async function oldClone(project) {
  const dir = oldStateDir(project);
  await openRecord(dir, { what: 'a test clone' });
  await run('git', ['remote', 'add', 'origin', 'https://example.invalid/shop.git'], { cwd: dir });
  return dir;
}

const note = (text) => makeEvent({ kind: 'note', data: { text }, now: () => T0 });

test('an unpushed event in the old clone is imported with its own id and path', () => withHome(async () => {
  makeSigningKey();
  const from = await oldClone('shop');
  const kept = note('kept from v0.1.x');
  // Committed in the old clone and never pushed: the import reads the clone's commits, not the host.
  await writeEvent({ event: kept, dir: from, now: () => T0 });
  const to = await openProjectRecord('shop');
  const got = await importEvents({ from, to, enrolled: [ownKey()] });
  assert.deepEqual(got, { imported: 1, held: 0, unsigned: 0, unreadable: 0 });
  const [event] = listEvents(to, { report: () => {} });
  assert.equal(event.id, kept.id);
  assert.ok(fs.existsSync(path.join(to, eventPath(kept))));
  assert.equal(await git(to, ['status', '--porcelain']), '', 'the import is committed');
  assert.equal(await git(to, ['remote']), '', 'the record still has no remote');
}));

test('a signed event whose key is not trusted here is skipped, and a trusted one imported', () => withHome(async () => {
  makeSigningKey();
  const from = await oldClone('shop');
  const approval = sign(makeEvent({ kind: 'approval', data: { pr: 3, sha: 'a'.repeat(40) }, now: () => T0 }));
  const forged = { ...sign(makeEvent({ kind: 'approval', data: { pr: 4, sha: 'b'.repeat(40) }, now: () => T0 })) };
  forged.data = { ...forged.data, pr: 5 };
  await writeEvent({ event: approval, dir: from, now: () => T0 });
  await writeEvent({ event: forged, dir: from, now: () => T0 });
  const to = await openProjectRecord('shop');
  const got = await importEvents({ from, to, enrolled: [ownKey()] });
  assert.equal(got.imported, 1);
  assert.equal(got.unsigned, 1);
  assert.deepEqual(listEvents(to, { report: () => {} }).map((e) => e.id), [approval.id]);
}));

test('importing twice adds nothing, and the old folder is left as it was', () => withHome(async () => {
  makeSigningKey();
  const from = await oldClone('shop');
  await writeEvent({ event: note('one'), dir: from, now: () => T0 });
  await writeEvent({ event: note('two'), dir: from, now: () => T0 });
  const before = await git(from, ['rev-parse', 'HEAD']);
  const to = await openProjectRecord('shop');
  assert.equal((await importEvents({ from, to, enrolled: [ownKey()] })).imported, 2);
  const head = await git(to, ['rev-parse', 'HEAD']);
  assert.deepEqual(await importEvents({ from, to, enrolled: [ownKey()] }), { imported: 0, held: 2, unsigned: 0, unreadable: 0 });
  assert.equal(await git(to, ['rev-parse', 'HEAD']), head, 'no commit when nothing is new');
  assert.equal(await git(from, ['rev-parse', 'HEAD']), before);
  assert.equal(await git(from, ['status', '--porcelain']), '');
}));

test('a file planted beside the old clone\'s commits is not imported', () => withHome(async () => {
  makeSigningKey();
  const from = await oldClone('shop');
  const planted = note('never committed');
  const file = path.join(from, eventPath(planted));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(planted)}\n`);
  const to = await openProjectRecord('shop');
  assert.equal((await importEvents({ from, to, enrolled: [ownKey()] })).imported, 0);
}));

test('a Lean record at state/ is imported like any other', () => withHome(async () => {
  makeSigningKey();
  const from = oldStateDir('shop');
  await openRecord(from, { what: 'a Lean record' });
  const lean = note('lean');
  await writeEvent({ event: lean, dir: from, now: () => T0 });
  // v0.1.x named a Lean record's branch as the state branch.
  await run('git', ['branch', '-m', 'wheelhouse-state'], { cwd: from });
  const to = await openProjectRecord('shop');
  assert.equal((await importEvents({ from, to, enrolled: [ownKey()] })).imported, 1);
  assert.deepEqual(listEvents(stateDir('shop'), { report: () => {} }).map((e) => e.id), [lean.id]);
}));
