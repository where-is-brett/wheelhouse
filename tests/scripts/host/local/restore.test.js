// tests/scripts/host/local/restore.test.js
// A project brought back from its backup (spec 8.1): the home is made with this computer's mark, the folder is cloned if it is
// empty, and a damaged backup makes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, commitIn, projectFolderWith, withKeyedHome } from '../../../helpers/local-home.js';
import { tempFolder } from '../../../helpers/homes.js';
import { homeBranch, homeDir, homeReadable, makeHome } from '../../../../scripts/host/local/home.js';
import { backupFile, writeBackup } from '../../../../scripts/host/local/backup.js';
import { backupNamed, projectOfBackup, restoreProject } from '../../../../scripts/host/local/restore.js';
import { writeProject } from '../../../../scripts/lib/projects.js';

const PROJECT = 'shop';
const now = () => new Date('2026-11-01T10:00:00.000Z');

async function backedUp() {
  const folder = await projectFolderWith('trunk');
  await commitIn(folder, 'b.txt');
  await makeHome({ project: PROJECT, folder });
  writeProject(PROJECT, { folder, remoteUrl: null, host: 'local', repo: `local/${PROJECT}`, connection: { host: 'local', mode: 'none' } });
  const drive = fs.realpathSync(tempFolder('wh-drive-'));
  const stat = (p) => ({ dev: String(p).startsWith(drive) ? 2 : 1, isDirectory: () => true });
  await writeBackup({ project: PROJECT, folder: drive, now, stat });
  return { folder, file: backupFile(drive, PROJECT) };
}

const emptyPlace = () => path.join(tempFolder('wh-new-'), 'shop');

test('a restored project reads its home, with the whole history', async () => {
  await withKeyedHome(async () => {
    const { folder, file } = await backedUp();
    const place = emptyPlace();
    fs.mkdirSync(place);
    assert.equal(await restoreProject({ file, folder: place, project: 'shop-back' }), 'shop-back');
    assert.equal(homeReadable('shop-back'), true);
    assert.equal(homeBranch('shop-back'), 'trunk');
    const home = homeDir('shop-back');
    assert.equal(await git(home, ['rev-parse', 'refs/heads/trunk']), await git(folder, ['rev-parse', 'trunk']));
    assert.equal(await git(home, ['rev-list', '--count', 'trunk']), '2');
    assert.equal(await git(home, ['remote']), '', 'no way back to the backup');
    if (process.platform !== 'win32') assert.equal(fs.statSync(home).mode & 0o777, 0o700);
    assert.equal(await git(place, ['rev-parse', 'trunk']), await git(folder, ['rev-parse', 'trunk']));
    assert.equal(await git(place, ['symbolic-ref', '--short', 'HEAD']), 'trunk');
    assert.equal(fs.readFileSync(path.join(place, 'b.txt'), 'utf8'), 'b.txt\n');
  });
});

test('a project is named by its backup, and a folder that isn\'t empty is left alone', async () => {
  await withKeyedHome(async () => {
    const { file } = await backedUp();
    assert.equal(projectOfBackup(file), 'shop');
    const place = emptyPlace();
    fs.mkdirSync(place);
    fs.writeFileSync(path.join(place, 'notes.txt'), 'mine\n');
    await restoreProject({ file, folder: place, project: 'other' });
    assert.equal(homeReadable('other'), true);
    assert.deepEqual(fs.readdirSync(place), ['notes.txt']);
  });
});

test('a damaged backup restores nothing', async () => {
  await withKeyedHome(async () => {
    const { file } = await backedUp();
    const size = fs.statSync(file).size;
    fs.truncateSync(file, size - 40);
    const place = emptyPlace();
    fs.mkdirSync(place);
    await assert.rejects(restoreProject({ file, folder: place, project: 'broken' }), /could not be read/);
    assert.equal(fs.existsSync(homeDir('broken')), false);
    assert.deepEqual(fs.readdirSync(path.dirname(homeDir('broken'))).filter((n) => n.startsWith('home-part-')), []);
    assert.deepEqual(fs.readdirSync(place), []);
  });
});

test('a home already here is never written over', async () => {
  await withKeyedHome(async () => {
    const { file } = await backedUp();
    const place = emptyPlace();
    fs.mkdirSync(place);
    fs.mkdirSync(homeDir('taken'), { recursive: true });
    await assert.rejects(restoreProject({ file, folder: place, project: 'taken' }), /already/);
    await restoreProject({ file, folder: place, project: 'again' });
    await restoreProject({ file, folder: place, project: 'again' });
    assert.equal(homeReadable('again'), true);
  });
});

test('a typed path names a backup, as a file dragged in writes it', () => {
  assert.equal(backupNamed('/Volumes/Spare/shop.wheelhouse-backup'), '/Volumes/Spare/shop.wheelhouse-backup');
  assert.equal(backupNamed('  \'/Volumes/My Drive/shop.wheelhouse-backup\'  '), '/Volumes/My Drive/shop.wheelhouse-backup');
  assert.equal(backupNamed('/Volumes/My\\ Drive/shop.wheelhouse-backup'), '/Volumes/My Drive/shop.wheelhouse-backup');
  assert.equal(backupNamed('where-is-brett/shop'), null);
  assert.equal(backupNamed('shop.wheelhouse-backup'), null, 'a full path only');
  assert.equal(backupNamed(null), null);
});
