// tests/scripts/update/board.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projectRef, updateFacts, readLatest, lookForLatest, confirmingLine } from '../../../scripts/update/board.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { decline } from '../../../scripts/update/declined.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function settingsFolder(ref) {
  const folder = tempFolder('wh-ub-');
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), JSON.stringify({
    extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref } } },
  }));
  return folder;
}

test('projectRef: the release the project names, or null', () => {
  assert.equal(projectRef(settingsFolder('v0.2.7')), 'v0.2.7');
  assert.equal(projectRef(tempFolder('wh-ub-')), null);
  assert.equal(projectRef(undefined), null);
});

test('weekly look: it asks once, keeps the answer, and does not ask again within a week', () => withHome(async () => {
  let asked = 0;
  const list = async () => { asked += 1; return [{ tag: 'v0.2.6', sha: 'a'.repeat(40) }, { tag: 'v0.2.7', sha: 'b'.repeat(40) }, { tag: 'v0.3.0-rc.1', sha: 'c'.repeat(40) }]; };
  assert.deepEqual(readLatest({ now: () => NOW }), { tag: null, due: true });
  await lookForLatest({ now: () => NOW, list });
  assert.deepEqual(readLatest({ now: () => NOW }), { tag: 'v0.2.7', due: false });
  await lookForLatest({ now: () => new Date(NOW.getTime() + 6 * DAY), list });
  assert.equal(asked, 1);
  assert.equal(readLatest({ now: () => new Date(NOW.getTime() + 8 * DAY) }).due, true);
  await lookForLatest({ now: () => new Date(NOW.getTime() + 8 * DAY), list });
  assert.equal(asked, 2);
}));

test('weekly look: a look that is slow gives up at its limit and leaves the last answer', () => withHome(async () => {
  await lookForLatest({ now: () => NOW, list: async () => [{ tag: 'v0.2.7', sha: 'b'.repeat(40) }] });
  const later = () => new Date(NOW.getTime() + 8 * DAY);
  const started = Date.now();
  const result = await lookForLatest({ now: later, list: () => new Promise(() => {}), waitMs: 100 });
  assert.ok(Date.now() - started < 1500);
  assert.equal(result, false);
  assert.equal(readLatest({ now: later }).tag, 'v0.2.7');
  // And it does not try again at once.
  let asked = 0;
  await lookForLatest({ now: later, list: async () => { asked += 1; return []; } });
  assert.equal(asked, 0);
}));

test('weekly look: a failed look is not an error', () => withHome(async () => {
  assert.equal(await lookForLatest({ now: () => NOW, list: async () => { throw new Error('offline'); } }), false);
  assert.equal(readLatest({ now: () => NOW }).tag, null);
}));

function journalAt(project, steps) {
  const journal = openJournal(project);
  for (const [name, state, data] of steps) journal.mark(name, state, data);
  return journal;
}

test('facts: a release newer than this one is announced, unless declined or a pre-release', () => withHome(() => {
  const base = { project: 'p', version: 'v0.2.6', now: () => NOW };
  assert.equal(updateFacts({ ...base, latest: 'v0.2.7' }).newer, 'v0.2.7');
  assert.equal(updateFacts({ ...base, latest: 'v0.2.6' }).newer, null);
  assert.equal(updateFacts({ ...base, latest: 'v0.2.5' }).newer, null);
  assert.equal(updateFacts({ ...base, latest: 'v0.3.0-rc.1' }).newer, null);
  assert.equal(updateFacts({ ...base, latest: null }).newer, null);
  decline('p', 'v0.2.7');
  assert.equal(updateFacts({ ...base, latest: 'v0.2.7' }).newer, null);
  assert.equal(updateFacts({ ...base, latest: 'v0.2.8' }).newer, 'v0.2.8');
}));

test('facts: the update date shows while the finished update is under a week old', () => withHome(() => {
  journalAt('p', [['checks', 'done', { tag: 'v0.2.7' }], ['done', 'done']]);
  const doneAt = openJournal('p').read().steps.done.at;
  const at = (days) => () => new Date(Date.parse(doneAt) + days * DAY);
  assert.equal(updateFacts({ project: 'p', version: 'v0.2.7', now: at(2) }).updatedAt, doneAt);
  assert.equal(updateFacts({ project: 'p', version: 'v0.2.7', now: at(8) }).updatedAt, null);
  // A journal for another release says nothing about this one.
  assert.equal(updateFacts({ project: 'p', version: 'v0.2.8', now: at(2) }).updatedAt, null);
}));

test('facts: the three part-way states', () => withHome(() => {
  const j = journalAt('p', [['checks', 'done', { tag: 'v0.2.7' }], ['change', 'done'], ['merged', 'running']]);
  const lock = j.lock();
  const facts = () => updateFacts({ project: 'p', version: 'v0.2.6', now: () => NOW });
  assert.deepEqual(facts().partway, { kind: 'merge', tag: 'v0.2.7' });
  j.mark('merged', 'done');
  j.mark('idle', 'running');
  assert.deepEqual(facts().partway, { kind: 'idle', tag: 'v0.2.7' });
  j.mark('idle', 'done');
  j.mark('backup', 'running');
  assert.equal(facts().partway, null, 'an update that is simply going shows nothing');
  j.mark('catalogue', 'failed', { line: 'no network' });
  assert.deepEqual(facts().partway, { kind: 'stopped', tag: 'v0.2.7' });
  lock();
}));

test('facts: a step left running when nothing holds the lock is stopped', () => withHome(() => {
  journalAt('p', [['checks', 'done', { tag: 'v0.2.7' }], ['merged', 'running']]);
  assert.deepEqual(updateFacts({ project: 'p', version: 'v0.2.6', now: () => NOW }).partway, { kind: 'stopped', tag: 'v0.2.7' });
}));

test('facts: a finished update, or none begun, shows no part-way line', () => withHome(() => {
  assert.equal(updateFacts({ project: 'p', version: 'v0.2.6', now: () => NOW }).partway, null);
  journalAt('p', [['checks', 'done', { tag: 'v0.2.7' }], ['done', 'done']]);
  assert.equal(updateFacts({ project: 'p', version: 'v0.2.7', now: () => NOW }).partway, null);
}));

test('facts: a refresh left after the install is its own line, until it is done', () => withHome(() => {
  journalAt('p', [['checks', 'done', { tag: 'v0.2.7' }], ['installs', 'done'], ['verify', 'done'], ['finish', 'failed', { left: "Locked's password refresh" }]]);
  const facts = updateFacts({ project: 'p', version: 'v0.2.7', now: () => NOW });
  assert.deepEqual(facts.refresh, { tag: 'v0.2.7', left: "Locked's password refresh" });
  assert.equal(facts.partway, null);
  openJournal('p').mark('finish', 'done');
  assert.equal(updateFacts({ project: 'p', version: 'v0.2.7', now: () => NOW }).refresh, null);
}));

test('facts: a project naming a release this computer lacks, unless an update is under way', () => withHome(() => {
  const folder = settingsFolder('v0.2.7');
  assert.deepEqual(updateFacts({ project: 'p', folder, version: 'v0.2.6', now: () => NOW }).mismatch, { names: 'v0.2.7', has: 'v0.2.6' });
  assert.equal(updateFacts({ project: 'p', folder, version: 'v0.2.7', now: () => NOW }).mismatch, null);
  assert.equal(updateFacts({ project: 'p', folder, version: 'v0.2.8', now: () => NOW }).mismatch, null);
  const release = openJournal('p').lock();
  assert.equal(updateFacts({ project: 'p', folder, version: 'v0.2.6', now: () => NOW }).mismatch, null);
  release();
}));

test('facts: a helper older than this copy is named', () => withHome(() => {
  assert.equal(updateFacts({ project: 'p', version: 'v0.2.7', helperVersion: '0.2.6', now: () => NOW }).oldHelper, 'v0.2.6');
  assert.equal(updateFacts({ project: 'p', version: 'v0.2.7', helperVersion: '0.2.7', now: () => NOW }).oldHelper, null);
  assert.equal(updateFacts({ project: 'p', version: 'v0.2.7', helperVersion: '0.2.8', now: () => NOW }).oldHelper, null);
}));

test('confirming line: said once, at the first session after done, naming the session and the helper', () => withHome(() => {
  journalAt('p', [['checks', 'done', { tag: 'v0.2.7' }], ['merged', 'done', { approved: true }], ['done', 'done']]);
  const doneAt = openJournal('p').read().steps.done.at;
  const now = () => new Date(Date.parse(doneAt) + 1000);
  assert.equal(confirmingLine({ project: 'p', sessionVersion: '0.2.6', helperVersion: '0.2.7', now }), null, 'an old session says nothing and does not use it up');
  assert.equal(
    confirmingLine({ project: 'p', sessionVersion: '0.2.7', helperVersion: '0.2.7', now }),
    'Wheelhouse v0.2.7 is running (updated today, approved by you); the helper is v0.2.7.',
  );
  assert.equal(confirmingLine({ project: 'p', sessionVersion: '0.2.7', helperVersion: '0.2.7', now }), null);
}));

test('confirming line: the helper still on the old release is named', () => withHome(() => {
  journalAt('p', [['checks', 'done', { tag: 'v0.2.7' }], ['merged', 'done', { approved: true }], ['done', 'done']]);
  const doneAt = new Date(Date.parse(openJournal('p').read().steps.done.at));
  const now = () => new Date(doneAt.getTime() + 3 * DAY);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const on = `${doneAt.getUTCDate()} ${months[doneAt.getUTCMonth()]} ${doneAt.getUTCFullYear()}`;
  assert.equal(
    confirmingLine({ project: 'p', sessionVersion: '0.2.7', helperVersion: '0.2.6', now }),
    `Wheelhouse v0.2.7 is running (updated ${on}, approved by you); the helper is still v0.2.6.`,
  );
}));

test('confirming line: nothing without a finished update', () => withHome(() => {
  assert.equal(confirmingLine({ project: 'p', sessionVersion: '0.2.7', helperVersion: '0.2.7', now: () => NOW }), null);
  journalAt('p', [['checks', 'done', { tag: 'v0.2.7' }], ['installs', 'done']]);
  assert.equal(confirmingLine({ project: 'p', sessionVersion: '0.2.7', helperVersion: '0.2.7', now: () => NOW }), null);
  assert.equal(fs.existsSync(path.join(wheelhouseHome(), 'update', 'p', 'confirmed.json')), false);
}));
