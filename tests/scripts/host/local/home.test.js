// tests/scripts/host/local/home.test.js
// A project's home (spec 5.1 and 7.3): a full copy of the folder's history that shares nothing with it, and a mark that
// names this computer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, commitIn, projectFolderWith, withKeyedHome } from '../../../helpers/local-home.js';
import { tempFolder } from '../../../helpers/homes.js';
import { homeDir, homeReadable, makeHome, isBranchName } from '../../../../scripts/host/local/home.js';
import { wheelhouseHome } from '../../../../scripts/lib/paths.js';

const PROJECT = 'shop';

test('the home is a full copy and shares no objects', async () => {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith();
    await git(folder, ['switch', '-q', '-c', 'feature/login']);
    const login = await commitIn(folder, 'login.txt');
    await git(folder, ['switch', '-q', 'main']);
    await git(folder, ['gc', '-q']);
    assert.deepEqual(await makeHome({ project: PROJECT, folder }), { made: true });
    const home = homeDir(PROJECT);
    assert.equal(await git(home, ['rev-parse', 'refs/heads/feature/login']), login);
    assert.equal(await git(home, ['rev-parse', 'refs/heads/main']), await git(folder, ['rev-parse', 'main']));
    assert.equal(await git(home, ['rev-parse', '--is-bare-repository']), 'true');
    assert.equal(await git(home, ['remote']), '', 'no way back to the folder');
    await git(home, ['fsck', '--strict']);
    const packs = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.pack')).map((f) => fs.statSync(path.join(dir, f)).ino);
    const ours = packs(path.join(home, 'objects', 'pack'));
    assert.ok(ours.length > 0);
    for (const ino of ours) assert.equal(packs(path.join(folder, '.git', 'objects', 'pack')).includes(ino), false);
    if (process.platform !== 'win32') assert.equal(fs.statSync(home).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(path.dirname(home)).filter((n) => n.startsWith('home-part-')), []);
  });
});

test('a folder that borrows its objects still gives a home of its own', async () => {
  await withKeyedHome(async () => {
    const source = await projectFolderWith();
    const folder = path.join(tempFolder('wh-borrow-'), 'shop');
    await git(path.dirname(folder), ['clone', '-q', '--shared', source, folder]);
    await makeHome({ project: PROJECT, folder });
    const home = homeDir(PROJECT);
    assert.equal(fs.existsSync(path.join(home, 'objects', 'info', 'alternates')), false);
    fs.rmSync(source, { recursive: true });
    await git(home, ['fsck', '--strict']);
    assert.match(await git(home, ['log', '-1', '--format=%s', 'main']), /add a\.txt/);
  });
});

test('the main version is the branch named, not the one the folder is on', async () => {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith();
    await git(folder, ['switch', '-q', '-c', 'work']);
    await makeHome({ project: PROJECT, folder, branch: 'main' });
    assert.equal(await git(homeDir(PROJECT), ['symbolic-ref', 'HEAD']), 'refs/heads/main');
  });
});

test('a failed copy leaves no home, and a second one changes nothing', async () => {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith();
    await assert.rejects(makeHome({ project: PROJECT, folder, branch: 'no-such-branch' }), /could not be copied/);
    assert.equal(fs.existsSync(homeDir(PROJECT)), false);
    await makeHome({ project: PROJECT, folder });
    await commitIn(folder, 'b.txt');
    const held = await git(homeDir(PROJECT), ['rev-parse', 'main']);
    assert.deepEqual(await makeHome({ project: PROJECT, folder }), { made: false });
    assert.equal(await git(homeDir(PROJECT), ['rev-parse', 'main']), held);
  });
});

test('a home copied to another computer reads as not held', async () => {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith();
    assert.equal(homeReadable(PROJECT), false);
    await makeHome({ project: PROJECT, folder });
    assert.equal(homeReadable(PROJECT), true);
    fs.writeFileSync(path.join(wheelhouseHome(), 'computer.json'), `${JSON.stringify({ id: 'feedf00d' })}\n`);
    assert.equal(homeReadable(PROJECT), false);
    await assert.rejects(makeHome({ project: PROJECT, folder }), /another computer/);
  });
});

test('a branch name that could be read as something else is refused', () => {
  for (const name of ['main', 'feature/login', 'release-1.2']) assert.equal(isBranchName(name), true, name);
  for (const name of ['-x', 'a..b', 'a b', 'a^{tree}', 'a/', 'a.lock', '', null]) assert.equal(isBranchName(name), false, String(name));
});
