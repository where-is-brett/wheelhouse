// tests/scripts/host/local/changes.test.js
// A local change (spec 7.1): numbers that count up and survive a restart, a place in the home that moves with it, and a
// record only this computer's helper writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, commitIn, projectFolderWith, withKeyedHome } from '../../../helpers/local-home.js';
import { homeDir, makeHome, projectFolder } from '../../../../scripts/host/local/home.js';
import { localChanges } from '../../../../scripts/host/local/changes.js';
import { makeEvent, writeEvent, listEvents } from '../../../../scripts/state/events.js';
import { stateDir } from '../../../../scripts/lib/paths.js';

const PROJECT = 'shop';

// A home with `feature/login` at `head`, one commit on from main.
async function homeWithBranch() {
  const folder = await projectFolderWith();
  await git(folder, ['switch', '-q', '-c', 'feature/login']);
  const head = await commitIn(folder, 'login.txt');
  await git(folder, ['switch', '-q', 'main']);
  await makeHome({ project: PROJECT, folder });
  return { folder, head, changes: localChanges({ project: PROJECT }) };
}
const opening = (head, over = {}) => ({ branch: 'feature/login', base: 'main', title: 'Add a login', body: 'Why it is wanted', head, ...over });

test('numbers count up from 1 and survive a restart', async () => {
  await withKeyedHome(async () => {
    const { head, changes } = await homeWithBranch();
    assert.equal((await changes.openChange(opening(head))).n, 1);
    await changes.closeChange(1);
    assert.equal((await localChanges({ project: PROJECT }).openChange(opening(head))).n, 2);
    await changes.closeChange(2);
    fs.rmSync(path.join(projectFolder(PROJECT), 'next-change'));
    assert.equal((await localChanges({ project: PROJECT }).openChange(opening(head))).n, 3, 'the records stand behind a lost file');
  });
});

test('two changes opened at once take a number each', async () => {
  await withKeyedHome(async () => {
    const { head, changes } = await homeWithBranch();
    const [one, two] = await Promise.all([changes.openChange(opening(head)), changes.openChange(opening(head, { branch: 'feature/other' }))]);
    assert.deepEqual([one.n, two.n].sort(), [1, 2]);
  });
});

test('refs/pull/n/head moves with the change', async () => {
  await withKeyedHome(async () => {
    const { folder, head, changes } = await homeWithBranch();
    await changes.openChange(opening(head));
    assert.equal(await git(homeDir(PROJECT), ['rev-parse', 'refs/pull/1/head']), head);
    await git(folder, ['switch', '-q', 'feature/login']);
    const next = await commitIn(folder, 'more.txt');
    await git(homeDir(PROJECT), ['fetch', '-q', folder, 'feature/login:feature/login']);
    const moved = await changes.updateChange({ n: 1, head: next });
    assert.equal(moved.head, next);
    assert.equal(await git(homeDir(PROJECT), ['rev-parse', 'refs/pull/1/head']), next);
    assert.equal(changes.changeOf(1).title, 'Add a login', 'what wasn\'t given stands');
  });
});

test('a change reads back whole, through to merged, and the newest record wins in one moment', async () => {
  await withKeyedHome(async () => {
    const { head } = await homeWithBranch();
    const still = () => new Date('2026-11-01T01:00:00.000Z');
    const changes = localChanges({ project: PROJECT, now: still });
    await changes.openChange(opening(head));
    assert.equal((await changes.updateChange({ n: 1, title: 'A login page' })).title, 'A login page');
    assert.deepEqual(changes.openChanges().map((c) => c.n), [1]);
    await changes.markMerged({ n: 1, commit: head });
    assert.deepEqual(changes.changeOf(1), {
      n: 1, rev: 3, branch: 'feature/login', base: 'main', title: 'A login page', body: 'Why it is wanted', state: 'merged', head, mergeCommit: head,
    });
    assert.deepEqual(changes.openChanges(), []);
    assert.equal(changes.changeOf(2), null);
    await assert.rejects(changes.closeChange(1), /has ended/);
  });
});

test('a change is refused for a commit the home lacks, a second open change on its branch, or the main version itself', async () => {
  await withKeyedHome(async () => {
    const { head, changes } = await homeWithBranch();
    await assert.rejects(changes.openChange(opening('f'.repeat(40))), /isn't in this project's home/);
    await assert.rejects(changes.openChange(opening(head, { branch: 'main' })), /to itself/);
    await assert.rejects(changes.openChange(opening(head, { branch: '-x' })), /plain names/);
    await changes.openChange(opening(head));
    await assert.rejects(changes.openChange(opening(head)), /open change for feature\/login/);
    await assert.rejects(changes.updateChange({ n: 9, title: 'x' }), /no change 9/);
  });
});

test('a record no one here signed is not a change', async () => {
  await withKeyedHome(async () => {
    const { head, changes } = await homeWithBranch();
    await changes.openChange(opening(head));
    const genuine = makeEvent({ kind: 'change', data: { ...changes.changeOf(1), rev: 2, head: 'a'.repeat(40) } });
    await writeEvent({ project: PROJECT, event: { ...genuine, sig: { ...genuine.sig, value: 'AAAA' } } });
    assert.equal(listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => e.kind === 'change').length, 2);
    assert.equal(changes.changeOf(1).head, head);
  });
});
