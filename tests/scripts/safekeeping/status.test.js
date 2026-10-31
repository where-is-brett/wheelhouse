// tests/scripts/safekeeping/status.test.js
// What would be lost with this computer (spec 8.2): one test a row of the state table, then the readings, from real repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, commitIn, projectFolderWith, withKeyedHome } from '../../helpers/local-home.js';
import { tempFolder } from '../../helpers/homes.js';
import { homeDir, makeHome } from '../../../scripts/host/local/home.js';
import { chooseBackupFolder, backUp } from '../../../scripts/host/local/backup.js';
import { safekeeping } from '../../../scripts/safekeeping/status.js';
import { readSafekeeping, readStatus, safekeepingTick } from '../../../scripts/safekeeping/readings.js';
import { writeProject } from '../../../scripts/lib/projects.js';

const NOW = new Date(2026, 10, 12, 12, 0, 0);
const ago = (days, hours = 0) => new Date(NOW.getTime() - (days * 24 + hours) * 60 * 60 * 1000).toISOString();
const minutes = (n) => new Date(NOW.getTime() - n * 60 * 1000).toISOString();
const NO_MACHINE = { on: false, last: null };
const local = (backup, timeMachine = NO_MACHINE) => ({ place: 'local', backup: { at: null, behind: 0, oldest: null, failed: false, refused: null, ...backup }, timeMachine, readAt: NOW.toISOString() });
const NOTHING_HERE = { commits: 0, uncommitted: 0, since: null, branches: [] };
const hosted = (over = {}) => ({ place: 'github', reachedAt: minutes(5), triedSince: null, behind: 0, onlyHere: NOTHING_HERE, readAt: NOW.toISOString(), ...over });
const status = (readings, options = {}) => safekeeping(readings, { now: NOW, ...options });
const labels = (got) => got.actions.map((a) => a.label);

test('local, newest merge in the backup', () => {
  const got = status(local({ at: ago(0) }));
  assert.equal(got.line, 'Backed up today, up to date');
  assert.equal(got.level, 'safe');
  assert.deepEqual(got.actions, []);
  assert.equal(got.place, 'local');
  assert.equal(got.readAt, NOW.toISOString());
});

test('local, backup a little behind', () => {
  const got = status(local({ at: ago(2), behind: 1, oldest: ago(1) }));
  assert.equal(got.line, 'Backed up 2 days ago, 1 change since');
  assert.equal(got.level, 'safe');
  assert.deepEqual(labels(got), ['Back up now', 'Choose another folder']);
});

test('local, Time Machine and no date', () => {
  const got = status(local({}, { on: true, last: null }));
  assert.equal(got.line, 'Time Machine is on');
  assert.equal(got.level, 'safe');
});

test('local, a change has gone unbacked-up for 7 days', () => {
  const got = status(local({ at: ago(9), behind: 4, oldest: ago(7) }));
  assert.equal(got.line, 'Last backup 9 days ago, 4 changes since');
  assert.equal(got.level, 'watch');
  assert.deepEqual(labels(got), ['Back up now', 'Choose another folder']);
  assert.equal(status(local({ at: ago(9), behind: 4, oldest: ago(6) })).level, 'safe', 'a day short of it');
  assert.equal(status(local({ at: ago(9), behind: 4, oldest: ago(4) }), { days: 3 }).level, 'watch', 'the project\'s own limit');
});

test('local, no backup, or one on the same disk', () => {
  for (const backup of [{}, { refused: 'That folder is on the same disk as the project', at: ago(1) }]) {
    const got = status(local(backup));
    assert.equal(got.line, 'Only on this computer, no backup');
    assert.equal(got.level, 'watch');
    assert.deepEqual(labels(got), ['Choose a backup folder']);
  }
  assert.match(status(local({ refused: 'That folder is on the same disk as the project' })).detail, /same disk/);
});

test('local, a backup that failed its check', () => {
  const got = status(local({ at: ago(1), behind: 1, oldest: ago(0), failed: true }));
  assert.equal(got.line, 'Your last backup couldn\'t be checked');
  assert.equal(got.level, 'watch');
  assert.deepEqual(labels(got), ['Back up now', 'Choose another folder']);
});

test('hosted, all the same', () => {
  const got = status(hosted());
  assert.equal(got.line, 'On GitHub, up to date, synced 5 minutes ago');
  assert.equal(got.level, 'safe');
  assert.deepEqual(got.actions, []);
});

test('hosted, the host is newer', () => {
  const got = status(hosted({ behind: 2 }));
  assert.equal(got.line, 'On GitHub, your folder is 2 changes behind');
  assert.equal(got.level, 'safe');
  assert.deepEqual(labels(got), ['Bring my folder up to date']);
});

test('hosted, work only here, under 3 days old', () => {
  const got = status(hosted({ onlyHere: { commits: 3, uncommitted: 0, since: ago(2), branches: ['feature/a'] } }));
  assert.equal(got.line, 'On GitHub, 3 changes only on this computer');
  assert.equal(got.level, 'safe');
  assert.deepEqual(labels(got), ['Keep a copy online']);
});

test('hosted, work only here for 3 days or more', () => {
  const got = status(hosted({ onlyHere: { commits: 2, uncommitted: 1, since: ago(4), branches: ['feature/a'] } }));
  assert.equal(got.line, '3 changes only on this computer, for 4 days');
  assert.equal(got.level, 'watch');
  assert.deepEqual(labels(got), ['Keep a copy online', 'Ask the First Mate to save them']);
  assert.equal(status(hosted({ onlyHere: { commits: 1, uncommitted: 0, since: ago(2), branches: ['a'] } }), { hereDays: 1 }).level, 'watch');
});

test('hosted, host not reached for a day or more', () => {
  const got = status(hosted({ reachedAt: ago(2) }));
  assert.equal(got.line, `Couldn't reach GitHub since ${new Date(ago(2)).toLocaleDateString('en-GB', { weekday: 'long' })}`);
  assert.equal(got.level, 'watch');
  assert.deepEqual(labels(got), ['Try again']);
  assert.equal(status(hosted({ reachedAt: null, triedSince: minutes(10) })).level, 'safe', 'not a day yet');
  assert.equal(status(hosted({ reachedAt: ago(0, 23) })).level, 'safe');
  assert.match(status(hosted({ reachedAt: ago(20) })).line, /since 23 October$/);
});

test('uncommitted changes alone ask the First Mate, and a press never names more than two', () => {
  assert.deepEqual(labels(status(hosted({ onlyHere: { commits: 0, uncommitted: 2, since: ago(0), branches: [] } }))), ['Ask the First Mate to save them']);
  assert.ok(status(hosted({ behind: 1, onlyHere: { commits: 1, uncommitted: 1, since: ago(0), branches: ['a'] } })).actions.length <= 2);
});

test('Time Machine with no date gives no date', () => {
  const got = status(local({}, { on: true, last: null }));
  assert.doesNotMatch(`${got.line} ${got.detail}`, /\d|today|yesterday/);
});

test('Time Machine with a date reads as a backup', () => {
  assert.equal(status(local({}, { on: true, last: ago(1), behind: 0, oldest: null })).line, 'Backed up yesterday, up to date');
  const stale = status(local({}, { on: true, last: ago(9), behind: 2, oldest: ago(8) }));
  assert.equal(stale.line, 'Last backup 9 days ago, 2 changes since');
  assert.equal(stale.level, 'watch');
});

test('a backup that has fallen behind leans on Time Machine with no date, and a failed check still shows', () => {
  assert.equal(status(local({ at: ago(9), behind: 4, oldest: ago(8) }, { on: true, last: null })).line, 'Time Machine is on');
  assert.equal(status(local({ at: ago(1), failed: true }, { on: true, last: null })).level, 'watch');
});

test('a host and a Time Machine reads as hosted', () => {
  assert.equal(status({ ...hosted(), timeMachine: { on: true, last: null } }).line, 'On GitHub, up to date, synced 5 minutes ago');
});

test('a GitLab project reads the same way', () => {
  assert.equal(status(hosted({ place: 'gitlab', behind: 1 })).line, 'On GitLab, your folder is 1 change behind');
  assert.equal(status(hosted({ place: 'gitlab' })).place, 'gitlab');
});

test('the detail says what would be lost, and once that the private record stays here', () => {
  for (const got of [status(local({})), status(local({ at: ago(0) })), status(hosted())]) {
    assert.equal(got.detail.match(/stay on this computer/g).length, 1, got.detail);
  }
  assert.match(status(local({})).detail, /whole project/);
  assert.match(status(local({ at: ago(2), behind: 3, oldest: ago(1) })).detail, /3 changes/);
});

test('it is safe the moment the reading clears', () => {
  assert.equal(status(local({ at: ago(9), behind: 4, oldest: ago(8) })).level, 'watch');
  assert.equal(status(local({ at: ago(0), behind: 0 })).level, 'safe');
  assert.equal(status(hosted({ reachedAt: ago(3) })).level, 'watch');
  assert.equal(status(hosted({ reachedAt: minutes(1) })).level, 'safe');
});

const PROJECT = 'shop';
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).sort();
const refsOf = (dir) => git(dir, ['for-each-ref', '--format=%(refname) %(objectname)']);

async function hostedWorld(fn) {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith();
    const mirror = path.join(tempFolder('wh-mirror-'), 'm.git');
    await git(path.dirname(mirror), ['clone', '-q', '--bare', folder, mirror]);
    const record = { folder, remoteUrl: 'https://github.com/a/shop.git', host: 'github', repo: 'a/shop', connection: { host: 'github', mode: 'quick' } };
    writeProject(PROJECT, record);
    await fn({ folder, mirror, record, read: (over = {}) => readSafekeeping({ project: PROJECT, record, mirror, host: { reachedAt: minutes(5) }, now: () => NOW, ...over }) });
  });
}

test('a folder level with the host has nothing only here', async () => {
  await hostedWorld(async ({ read }) => {
    const got = await read();
    assert.equal(got.place, 'github');
    assert.deepEqual(got.onlyHere, NOTHING_HERE);
    assert.equal(got.behind, 0);
  });
});

test('commits on any branch, and uncommitted changes, count as only here', async () => {
  await hostedWorld(async ({ folder, read }) => {
    await git(folder, ['switch', '-q', '-c', 'feature/a']);
    await commitIn(folder, 'b.txt');
    await commitIn(folder, 'c.txt');
    await git(folder, ['switch', '-q', 'main']);
    fs.writeFileSync(path.join(folder, 'a.txt'), 'changed\n');
    fs.writeFileSync(path.join(folder, 'new.txt'), 'new\n');
    const { onlyHere } = await read();
    assert.equal(onlyHere.commits, 2);
    assert.equal(onlyHere.uncommitted, 2);
    assert.deepEqual(onlyHere.branches, ['feature/a']);
    assert.equal(typeof onlyHere.since, 'string');
  });
});

test('a running lane is not counted', async () => {
  await hostedWorld(async ({ folder, read }) => {
    await git(folder, ['switch', '-q', '-c', 'wh/lane']);
    await commitIn(folder, 'b.txt');
    await git(folder, ['switch', '-q', 'main']);
    assert.equal((await read()).onlyHere.commits, 1);
    assert.deepEqual((await read({ running: (branch) => branch === 'wh/lane' })).onlyHere, NOTHING_HERE);
  });
});

test('a deleted branch is not counted, nor the record\'s own, nor what the host has under keep/ or a pull request', async () => {
  await hostedWorld(async ({ folder, mirror, read }) => {
    await git(folder, ['switch', '-q', '-c', 'feature/gone']);
    await commitIn(folder, 'b.txt');
    await git(folder, ['switch', '-q', 'main']);
    await git(folder, ['branch', '-q', '-D', 'feature/gone']);
    await git(folder, ['switch', '-q', '--orphan', 'wheelhouse-state']);
    await commitIn(folder, 'event.txt');
    await git(folder, ['switch', '-q', 'main']);
    await git(folder, ['switch', '-q', '-c', 'feature/kept']);
    await commitIn(folder, 'k.txt');
    await git(folder, ['push', '-q', mirror, 'feature/kept:keep/feature/kept']);
    await git(folder, ['switch', '-q', 'main']);
    assert.deepEqual((await read()).onlyHere, NOTHING_HERE);
  });
});

test('a host that moved on reads as the folder behind, counted from where they part', async () => {
  await hostedWorld(async ({ folder, mirror, read }) => {
    const other = path.join(tempFolder('wh-other-'), 'o');
    await git(path.dirname(other), ['clone', '-q', mirror, other]);
    await commitIn(other, 'x.txt');
    await commitIn(other, 'y.txt');
    await git(other, ['push', '-q', 'origin', 'HEAD:main']);
    assert.equal((await read()).behind, 2);
    await commitIn(folder, 'mine.txt');
    const parted = await read();
    assert.equal(parted.behind, 2);
    assert.equal(parted.onlyHere.commits, 1);
  });
});

test('reading writes nothing', async () => {
  await hostedWorld(async ({ folder, mirror, read }) => {
    await commitIn(folder, 'b.txt');
    const before = [await refsOf(folder), await refsOf(mirror), tree(mirror)];
    await read();
    assert.deepEqual([await refsOf(folder), await refsOf(mirror), tree(mirror)], before);
  });
});

test('a project with no mirror yet counts nothing it can\'t compare', async () => {
  await hostedWorld(async ({ folder, read, mirror }) => {
    await commitIn(folder, 'b.txt');
    const got = await read({ mirror: `${mirror}-none` });
    assert.deepEqual(got.onlyHere, NOTHING_HERE);
  });
});

test('a Lean project has no status', async () => {
  assert.equal(await readSafekeeping({ project: PROJECT, record: null }), null);
  await withKeyedHome(async () => {
    assert.equal(await safekeepingTick({ project: PROJECT, record: null, now: () => NOW }), null);
    assert.equal(readStatus(PROJECT), null);
  });
});

async function localWorld(fn) {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith();
    await makeHome({ project: PROJECT, folder });
    const record = { folder, remoteUrl: null, host: 'local', repo: `local/${PROJECT}`, connection: { host: 'local', mode: 'none' } };
    writeProject(PROJECT, record);
    const drive = fs.realpathSync(tempFolder('wh-drive-'));
    const stat = (p) => ({ dev: String(p).startsWith(drive) ? 2 : 1, isDirectory: () => true });
    await fn({ folder, record, drive, stat });
  });
}

test('a local project reads its backup, counting merges since', async () => {
  await localWorld(async ({ folder, record, drive, stat }) => {
    const read = () => readSafekeeping({ project: PROJECT, record, now: () => NOW, stat });
    assert.equal((await read()).backup.at, null);
    chooseBackupFolder({ project: PROJECT, folder: drive, stat });
    await backUp({ project: PROJECT, now: () => NOW, stat });
    const level = await read();
    assert.equal(level.backup.at, NOW.toISOString());
    assert.equal(level.backup.behind, 0);
    await commitIn(folder, 'b.txt');
    await git(folder, ['push', '-q', homeDir(PROJECT), 'main:main']);
    const behind = await read();
    assert.equal(behind.backup.behind, 1);
    assert.equal(typeof behind.backup.oldest, 'string');
    assert.equal(safekeeping(behind, { now: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000) }).level, 'watch');
  });
});

test('Time Machine\'s date is measured against the merges after it', async () => {
  await localWorld(async ({ record }) => {
    const got = await readSafekeeping({ project: PROJECT, record, now: () => NOW, machine: { on: true, last: '2000-01-01T00:00:00.000Z' } });
    assert.equal(got.timeMachine.behind, 1);
    assert.equal(typeof got.timeMachine.oldest, 'string');
  });
});

test('the host is read at most once an hour', async () => {
  await hostedWorld(async ({ record, mirror }) => {
    let reads = 0;
    let at = NOW;
    const tick = (over = {}) => safekeepingTick({ project: PROJECT, record, mirror, now: () => at, refresh: async () => { reads += 1; return { ok: true }; }, ...over });
    await tick();
    assert.equal(reads, 1);
    assert.equal(readStatus(PROJECT).line, 'On GitHub, up to date, synced just now');
    at = new Date(NOW.getTime() + 30 * 60 * 1000);
    await tick();
    assert.equal(reads, 1);
    assert.equal(readStatus(PROJECT).line, 'On GitHub, up to date, synced 30 minutes ago');
    await tick({ force: true });
    assert.equal(reads, 2, 'Try again reads it now');
    at = new Date(at.getTime() + 61 * 60 * 1000);
    await tick();
    assert.equal(reads, 3);
  });
});

test('a host that can\'t be reached keeps the last time it was', async () => {
  await hostedWorld(async ({ record, mirror }) => {
    let at = NOW;
    let reached = true;
    const tick = () => safekeepingTick({ project: PROJECT, record, mirror, now: () => at, refresh: async () => ({ ok: reached }) });
    await tick();
    reached = false;
    at = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
    await tick();
    assert.equal(readStatus(PROJECT).level, 'watch');
    assert.match(readStatus(PROJECT).line, /^Couldn't reach GitHub since /);
    reached = true;
    at = new Date(at.getTime() + 2 * 60 * 60 * 1000);
    await tick();
    assert.equal(readStatus(PROJECT).level, 'safe');
  });
});

test('the project\'s settings set the limits', async () => {
  await localWorld(async ({ folder, record }) => {
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    const config = JSON.parse(fs.readFileSync(new URL('../../../.claude/wheelhouse.json', import.meta.url), 'utf8'));
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ ...config, safekeeping: { days: 1 } }));
    const machine = async () => ({ on: true, last: '2000-01-01T00:00:00.000Z' });
    await safekeepingTick({ project: PROJECT, record, now: () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), machine });
    assert.equal(readStatus(PROJECT).level, 'watch');
  });
});

test('a watch never holds a merge or a run', () => {
  const uses = ['scripts/host/local/merge.js', 'scripts/engine/routes.js', 'scripts/engine/gates.js', 'scripts/host/merge-gate.js'].filter((file) => fs.existsSync(file));
  assert.ok(uses.length > 0);
  for (const file of uses) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /safekeeping/i, file);
  const helper = fs.readFileSync('scripts/host/helper.js', 'utf8');
  assert.equal(helper.match(/readStatus\(/g).length, 1, 'the helper reads the status only for the row\'s buttons');
});
