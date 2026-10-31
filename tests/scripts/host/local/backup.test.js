// tests/scripts/host/local/backup.test.js
// A local project's backup (spec 8.1): one file, read back whole before the old one goes, one earlier copy kept, in a place off
// this disk, with nothing of the private record in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, commitIn, projectFolderWith, withKeyedHome } from '../../../helpers/local-home.js';
import { tempFolder } from '../../../helpers/homes.js';
import { gitRoute, homeDir, makeHome } from '../../../../scripts/host/local/home.js';
import {
  backUp, backupDue, backupFile, backupPlace, backupRecord, chooseBackupFolder, earlierFile, pickFolder, readBackup, timeMachine, writeBackup,
} from '../../../../scripts/host/local/backup.js';
import { writeProject } from '../../../../scripts/lib/projects.js';
import { run as realRun } from '../../../../scripts/lib/run.js';

const PROJECT = 'shop';
const NOW = new Date('2026-11-01T10:00:00.000Z');
const now = () => NOW;

// A project with a home, and a folder standing in for a drive: `stat` says it is on another disk.
async function withBackedProject(fn) {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith();
    await makeHome({ project: PROJECT, folder });
    writeProject(PROJECT, { folder, remoteUrl: null, host: 'local', repo: `local/${PROJECT}`, connection: { host: 'local', mode: 'none' } });
    const drive = fs.realpathSync(tempFolder('wh-drive-'));
    const stat = (p) => ({ dev: String(p).startsWith(drive) ? 2 : 1, isDirectory: () => fs.statSync(p).isDirectory() });
    await fn({ folder, drive, stat });
  });
}

const addMerge = async (folder, name) => {
  await commitIn(folder, name);
  await git(folder, ['push', '-q', homeDir(PROJECT), 'main:main']);
};

const failing = (matches, also = async () => {}) => async (file, args, options) => {
  if (file === 'git' && matches(args)) {
    await also(args);
    return { code: 1, stdout: '', stderr: 'no' };
  }
  return realRun(file, args, options);
};
const isVerify = (args) => args.includes('bundle') && args.includes('verify');
const routeBy = (run) => gitRoute({ run });

test('a backup is one file holding the whole history, read back before it counts', async () => {
  await withBackedProject(async ({ folder, drive, stat }) => {
    const got = await writeBackup({ project: PROJECT, folder: drive, now, stat });
    assert.equal(got.written, path.join(drive, 'shop.wheelhouse-backup'));
    assert.equal(got.verifiedAt, NOW.toISOString());
    assert.equal(got.main, await git(folder, ['rev-parse', 'main']));
    assert.deepEqual(fs.readdirSync(drive), ['shop.wheelhouse-backup']);
  });
});

test('a partial write never replaces a good copy', async () => {
  await withBackedProject(async ({ folder, drive, stat }) => {
    await writeBackup({ project: PROJECT, folder: drive, now, stat });
    const good = fs.readFileSync(backupFile(drive, PROJECT));
    await addMerge(folder, 'b.txt');
    // `git bundle verify` reads only the head of the file, so a file cut short has to be caught by reading all of it.
    const cutting = async (file, args, options) => {
      const got = await realRun(file, args, options);
      if (args.includes('bundle') && args.includes('create')) {
        const part = args.find((a) => a.endsWith('.part'));
        fs.truncateSync(part, Math.floor(fs.statSync(part).size / 2));
      }
      return got;
    };
    const got = await writeBackup({ project: PROJECT, folder: drive, git: routeBy(cutting), now, stat });
    assert.equal(got.written, undefined);
    assert.match(got.failed, /checked/);
    assert.ok(fs.readFileSync(backupFile(drive, PROJECT)).equals(good));
    assert.deepEqual(fs.readdirSync(drive), ['shop.wheelhouse-backup'], 'the part is gone');
  });
});

test('a verify that fails keeps the old copy', async () => {
  await withBackedProject(async ({ folder, drive, stat }) => {
    await writeBackup({ project: PROJECT, folder: drive, now, stat });
    const good = fs.readFileSync(backupFile(drive, PROJECT));
    await addMerge(folder, 'b.txt');
    const got = await writeBackup({ project: PROJECT, folder: drive, git: routeBy(failing(isVerify)), now, stat });
    assert.match(got.failed, /checked/);
    assert.ok(fs.readFileSync(backupFile(drive, PROJECT)).equals(good));
  });
});

test('one earlier copy is kept', async () => {
  await withBackedProject(async ({ folder, drive, stat }) => {
    await writeBackup({ project: PROJECT, folder: drive, now, stat });
    const first = fs.readFileSync(backupFile(drive, PROJECT));
    await addMerge(folder, 'b.txt');
    await writeBackup({ project: PROJECT, folder: drive, now, stat });
    const second = fs.readFileSync(backupFile(drive, PROJECT));
    await addMerge(folder, 'c.txt');
    await writeBackup({ project: PROJECT, folder: drive, now, stat });
    assert.ok(fs.readFileSync(earlierFile(drive, PROJECT)).equals(second));
    assert.equal(fs.readFileSync(earlierFile(drive, PROJECT)).equals(first), false);
    assert.equal(fs.readdirSync(drive).length, 2);
  });
});

test('a backup on the same disk is refused', async () => {
  await withBackedProject(async ({ drive }) => {
    const sameDisk = (p) => ({ dev: 1, isDirectory: () => fs.statSync(p).isDirectory() });
    const place = backupPlace({ folder: drive, project: PROJECT, stat: sameDisk });
    assert.equal(place.ok, false);
    assert.match(place.why, /same disk/);
    assert.deepEqual(await writeBackup({ project: PROJECT, folder: drive, now, stat: sameDisk }), { skipped: 'place', why: place.why });
    assert.deepEqual(fs.readdirSync(drive), []);
  });
});

test('a folder a cloud service keeps counts, though it is on the same disk', async () => {
  await withBackedProject(async ({ drive }) => {
    const sameDisk = (p) => ({ dev: 1, isDirectory: () => fs.statSync(p).isDirectory() });
    const home = fs.realpathSync(tempFolder('wh-person-'));
    for (const [where, ok] of [['Library/CloudStorage/Dropbox/Backups', true], ['Library/Mobile Documents/com~apple~CloudDocs', true], ['OneDrive - Acme/x', true], ['Documents/Backups', false]]) {
      fs.mkdirSync(path.join(home, where), { recursive: true });
      assert.equal(backupPlace({ folder: path.join(home, where), project: PROJECT, stat: sameDisk, userHome: home }).ok, ok, where);
    }
    assert.equal(backupPlace({ folder: drive, project: PROJECT, stat: sameDisk, userHome: home }).ok, false);
  });
});

test('a backup inside the project is refused', async () => {
  await withBackedProject(async ({ folder, stat }) => {
    const inside = path.join(folder, 'backups');
    fs.mkdirSync(inside);
    const place = backupPlace({ folder: inside, project: PROJECT, stat: () => ({ dev: 2, isDirectory: () => true }) });
    assert.equal(place.ok, false);
    assert.match(place.why, /inside the project/);
    assert.equal(backupPlace({ folder: folder, project: PROJECT, stat }).ok, false);
  });
});

test('an unplugged drive is no fault, and tries again when it is back', async () => {
  await withBackedProject(async ({ folder, drive, stat }) => {
    assert.deepEqual(chooseBackupFolder({ project: PROJECT, folder: drive, stat }), { ok: true });
    await backUp({ project: PROJECT, now, stat });
    const main = await git(folder, ['rev-parse', 'main']);
    assert.equal(readBackup(PROJECT).main, main);
    assert.equal(backupDue({ project: PROJECT, main, now }), false, 'nothing new');

    await addMerge(folder, 'b.txt');
    const newer = await git(folder, ['rev-parse', 'main']);
    assert.equal(backupDue({ project: PROJECT, main: newer, now }), false, 'once a day while there is anything new');
    const later = () => new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    assert.equal(backupDue({ project: PROJECT, main: newer, now: later }), true);

    const away = `${drive}-away`;
    fs.renameSync(drive, away);
    assert.deepEqual(await backUp({ project: PROJECT, now: later, stat }), { skipped: 'away' });
    assert.equal(readBackup(PROJECT).failedAt, null, 'no fault');
    assert.equal(readBackup(PROJECT).main, main);
    assert.equal(backupDue({ project: PROJECT, main: newer, now: later }), false, 'while it stays away');

    fs.renameSync(away, drive);
    assert.equal(backupDue({ project: PROJECT, main: newer, now: later }), true, 'the moment it is back');
    await backUp({ project: PROJECT, now: later, stat });
    assert.equal(readBackup(PROJECT).main, newer);
  });
});

test('a backup that fails its check is noted, and a good one clears it', async () => {
  await withBackedProject(async ({ drive, stat }) => {
    chooseBackupFolder({ project: PROJECT, folder: drive, stat });
    await backUp({ project: PROJECT, git: routeBy(failing(isVerify)), now, stat });
    assert.equal(readBackup(PROJECT).failedAt, NOW.toISOString());
    assert.equal(readBackup(PROJECT).at, null);
    await backUp({ project: PROJECT, now, stat });
    assert.equal(readBackup(PROJECT).failedAt, null);
    assert.equal(readBackup(PROJECT).at, NOW.toISOString());
    if (process.platform !== 'win32') assert.equal(fs.statSync(backupRecord(PROJECT)).mode & 0o077, 0);
  });
});

test('a folder that can\'t be used is not chosen', async () => {
  await withBackedProject(async ({ folder, stat }) => {
    const got = chooseBackupFolder({ project: PROJECT, folder, stat });
    assert.equal(got.ok, false);
    assert.equal(readBackup(PROJECT).folder, null);
  });
});

test('no private record is in the bundle', async () => {
  await withBackedProject(async ({ folder, drive, stat }) => {
    // A folder that once sat on a host may carry the record's own branches, and the home copies every branch.
    await git(folder, ['switch', '-q', '--orphan', 'wheelhouse-state']);
    const secret = await commitIn(folder, 'secret.txt', 'the director said no\n');
    await git(folder, ['switch', '-q', 'main']);
    await git(folder, ['switch', '-q', '-c', 'feature/open']);
    const open = await commitIn(folder, 'open.txt');
    await git(folder, ['switch', '-q', 'main']);
    await git(folder, ['tag', 'v1']);
    const home = homeDir(PROJECT);
    await git(home, ['fetch', '-q', folder, '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*']);
    fs.mkdirSync(path.join(home, '..', 'state'), { recursive: true });
    fs.writeFileSync(path.join(home, '..', 'state', 'event.json'), '{"said":"private"}\n');

    await writeBackup({ project: PROJECT, folder: drive, now, stat });
    const heads = await git(home, ['bundle', 'list-heads', backupFile(drive, PROJECT)]);
    assert.doesNotMatch(heads, /wheelhouse-/);
    assert.match(heads, /refs\/heads\/feature\/open/);
    assert.match(heads, /refs\/tags\/v1/);
    assert.match(heads, / HEAD$/m);
    const copy = path.join(tempFolder('wh-copy-'), 'c.git');
    await git(path.dirname(copy), ['clone', '-q', '--bare', backupFile(drive, PROJECT), copy]);
    assert.equal(await git(copy, ['rev-parse', 'refs/heads/feature/open']), open);
    const all = await git(copy, ['rev-list', '--all', '--objects']);
    assert.equal(all.includes(secret), false);
    assert.equal(all.includes('secret.txt'), false);
  });
});

test('Time Machine is read from tmutil, with no date where it can\'t be read', async () => {
  const says = (destination, latest) => async (file, args) => {
    assert.match(file, /tmutil$/);
    if (args[0] === 'destinationinfo') return destination;
    return latest;
  };
  const destination = { code: 0, stdout: '====\nName          : Spare\nKind          : Local\nID            : 1\n', stderr: '' };
  const none = { code: 0, stdout: 'tmutil: No destinations configured.\n', stderr: '' };
  const refused = { code: 1, stdout: '', stderr: 'Full Disk Access' };
  assert.deepEqual(await timeMachine({ run: says(none), platform: 'darwin' }), { on: false, last: null });
  assert.deepEqual(await timeMachine({ run: says(destination, refused), platform: 'darwin' }), { on: true, last: null });
  const dated = await timeMachine({ run: says(destination, { code: 0, stdout: '/Volumes/Spare/2026-10-30-101500.backup\n' }), platform: 'darwin' });
  assert.equal(dated.on, true);
  assert.equal(dated.last, new Date(2026, 9, 30, 10, 15, 0).toISOString());
  assert.deepEqual(await timeMachine({ run: async () => { throw new Error('gone'); }, platform: 'darwin' }), { on: false, last: null });
  assert.deepEqual(await timeMachine({ run: says(destination), platform: 'win32' }), { on: false, last: null });
});

test('a folder is picked by the system\'s own window, and a closed window picks none', async () => {
  const picked = await pickFolder({ platform: 'darwin', run: async (file) => { assert.match(file, /osascript$/); return { code: 0, stdout: '/Volumes/Spare/Backups/\n' }; } });
  assert.equal(picked, '/Volumes/Spare/Backups');
  assert.equal(await pickFolder({ platform: 'darwin', run: async () => ({ code: 1, stdout: '', stderr: 'User canceled' }) }), null);
  assert.equal(await pickFolder({ platform: 'linux', run: async () => { throw new Error('not asked'); } }), null);
});

test('a lock a killed try left behind doesn\'t stop the next backup', async () => {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith('trunk');
    await makeHome({ project: 'lock', folder });
    writeProject('lock', { folder, remoteUrl: null, host: 'local', repo: 'local/lock', connection: { host: 'local', mode: 'none' } });
    const drive = fs.realpathSync(tempFolder('wh-drive-'));
    fs.writeFileSync(`${backupFile(drive, 'lock')}.part.lock`, '');
    const got = await writeBackup({ project: 'lock', folder: drive, stat: (p) => ({ dev: String(p).startsWith(drive) ? 2 : 1, isDirectory: () => true }) });
    assert.equal(typeof got.written, 'string', JSON.stringify(got));
  });
});
