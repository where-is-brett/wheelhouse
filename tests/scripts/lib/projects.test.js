// tests/scripts/lib/projects.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { namesOf, readProject, writeProject, projectForFolder } from '../../../scripts/lib/projects.js';
import { as, shortHome } from '../../helpers/homes.js';

const CONNECTION = { host: 'github', mode: 'narrow', project: 'Owner/Name' };
const record = (over = {}) => ({
  folder: path.join(os.tmpdir(), 'wh-proj-folder'),
  remoteUrl: 'https://github.com/owner/name.git',
  host: 'github',
  repo: 'Owner/Name',
  connection: CONNECTION,
  ...over,
});

test('a record with host local reads back', async () => {
  await as(shortHome(), async () => {
    const local = record({ host: 'local', repo: 'local/shop', remoteUrl: null, connection: { mode: 'none' } });
    writeProject('shop', local);
    assert.deepEqual(readProject('shop'), local);
    assert.throws(() => writeProject('other', local), /local\/<project>/);
    assert.throws(() => writeProject('shop', { ...local, remoteUrl: 'https://github.com/owner/name.git' }), /no remote address/);
  });
});

test('a github record with a null address is still refused', async () => {
  await as(shortHome(), async () => {
    assert.throws(() => writeProject('shop', record({ remoteUrl: null })), /remote address/);
    assert.throws(() => writeProject('shop', record({ host: 'bitbucket' })), /github, gitlab or local/);
  });
});

test('a project record is written and read back, and none reads as null', async () => {
  const home = shortHome();
  try {
    await as(home, () => {
      assert.equal(readProject('owner__name'), null);
      writeProject('owner__name', record());
      assert.deepEqual(readProject('owner__name'), record());
      assert.ok(fs.existsSync(path.join(home, 'projects', 'owner__name', 'project.json')));
      assert.deepEqual(fs.readdirSync(path.join(home, 'projects', 'owner__name')).filter((n) => n.includes('tmp')), [], 'no temporary file is left');
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('writeProject refuses a remote that does not name the repository', async () => {
  const home = shortHome();
  try {
    await as(home, () => {
      for (const remoteUrl of [
        'https://github.com/owner/other.git', 'git@github.com:elsewhere/name.git', 'ssh://git@github.com/owner/other',
        'https://gitlab.example.com/other/owner/name.git', 'git@gitlab.example.com:other/owner/name.git', 'ssh://git@gitlab.example.com/a/owner/name',
        'file:///elsewhere', 'https://github.com/owner/name-two', 'https://github.com/xowner/name.git', '',
      ]) {
        assert.throws(() => writeProject('owner__name', record({ remoteUrl })), /repository/, remoteUrl);
      }
      assert.equal(readProject('owner__name'), null);
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('writeProject reads the https, ssh and git@host: forms, ignoring case and a .git suffix', async () => {
  const home = shortHome();
  try {
    await as(home, () => {
      for (const remoteUrl of [
        'https://github.com/owner/name', 'https://github.com/OWNER/NAME.git', 'ssh://git@github.com/owner/name.git',
        'git@github.com:owner/name.git', 'git@github.com:Owner/Name', 'https://user@gitlab.example.com:8443/Owner/Name.git/',
        path.join(os.tmpdir(), 'x', 'owner', 'name.git'), `file://${path.join(os.tmpdir(), 'x', 'owner', 'name.git')}`,
      ]) {
        writeProject('owner__name', record({ remoteUrl }));
        assert.equal(readProject('owner__name').remoteUrl, remoteUrl);
      }
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('writeProject refuses a record that is not whole, and a project name that is not a folder name', async () => {
  const home = shortHome();
  try {
    await as(home, () => {
      assert.throws(() => writeProject('owner__name', record({ host: 'bitbucket' })), /host/);
      assert.throws(() => writeProject('owner__name', record({ repo: 'noslash' })), /repository/);
      assert.throws(() => writeProject('owner__name', record({ folder: 'relative/path' })), /folder/);
      assert.throws(() => writeProject('owner__name', record({ connection: null })), /connection/);
      assert.throws(() => writeProject('../escape', record()), /project/);
      assert.equal(readProject('../escape'), null);
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a damaged record reads as null', async () => {
  const home = shortHome();
  try {
    await as(home, () => {
      fs.mkdirSync(path.join(home, 'projects', 'owner__name'), { recursive: true });
      fs.writeFileSync(path.join(home, 'projects', 'owner__name', 'project.json'), '{not json');
      assert.equal(readProject('owner__name'), null);
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('projectForFolder finds the record whose folder contains the given one, by real path', async () => {
  const home = shortHome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-pf-'));
  try {
    const mine = path.join(work, 'mine');
    const inner = path.join(mine, 'src', 'deep');
    const other = path.join(work, 'mine-too');
    const nested = path.join(mine, 'nested');
    for (const d of [inner, other, nested]) fs.mkdirSync(d, { recursive: true });
    await as(home, () => {
      writeProject('owner__name', record({ folder: mine }));
      writeProject('owner__two', record({ folder: nested, repo: 'owner/two', remoteUrl: 'https://github.com/owner/two.git' }));
      writeProject('owner__far', record({ folder: path.join(work, 'far'), repo: 'owner/far', remoteUrl: 'https://github.com/owner/far.git' }));
      assert.equal(projectForFolder(mine).project, 'owner__name');
      assert.equal(projectForFolder(inner).project, 'owner__name');
      assert.deepEqual(projectForFolder(inner).record, record({ folder: mine }));
      assert.equal(projectForFolder(nested).project, 'owner__two', 'the nearest folder wins');
      assert.equal(projectForFolder(other), null, 'a folder that only shares a name prefix is not inside');
      assert.equal(projectForFolder(work), null);
      assert.equal(projectForFolder(path.join(work, 'missing')), null);

      // A link into the folder resolves to the real path.
      const link = path.join(work, 'link');
      fs.symlinkSync(inner, link, 'junction');
      assert.equal(projectForFolder(link).project, 'owner__name');
      // Case differs on macOS and Windows, which do not tell them apart.
      if ((process.platform === 'darwin' || process.platform === 'win32') && fs.existsSync(inner.toUpperCase())) {
        assert.equal(projectForFolder(inner.toUpperCase()).project, 'owner__name');
      }
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('namesOf gives the repository\'s own name and the folder\'s, each once, and nothing for an unknown project', async () => {
  const home = shortHome();
  try {
    await as(home, () => {
      assert.deepEqual(namesOf('owner__name'), []);
      writeProject('owner__name', record());
      assert.deepEqual(namesOf('owner__name'), ['Name', 'wh-proj-folder']);
      writeProject('owner__name', record({ folder: path.join(os.tmpdir(), 'Name') }));
      assert.deepEqual(namesOf('owner__name'), ['Name']);
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
