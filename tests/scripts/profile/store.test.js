// tests/scripts/profile/store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROFILE_BRANCH, PROFILE_HOLDS_KEYS, profileRemote, ensureProfileClone, writeProfileViews, readProfileViews,
} from '../../../scripts/profile/store.js';
import { profileDir, profileViewsDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { makeEvent, eventPath, confirmationFor } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { as, shortHome } from '../../helpers/homes.js';

const NOW = new Date('2026-10-18T05:00:00.000Z');
const remoteFor = (url) => ({
  remoteUrl: url, host: 'github', repo: 'o/profile', connection: { host: 'github', mode: 'quick', project: 'o/profile' },
});
const writeProfileJson = (value) => fs.writeFileSync(path.join(wheelhouseHome(), 'profile.json'), typeof value === 'string' ? value : JSON.stringify(value));
const put = (relative, text) => {
  const file = path.join(profileDir(), relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const read = (relative) => fs.readFileSync(path.join(profileDir(), relative), 'utf8');
const remoteFiles = async (url) => (await run('git', ['ls-tree', '-r', '--name-only', PROFILE_BRANCH], { cwd: url }))
  .stdout.split('\n').filter(Boolean).sort();

test('profileRemote is null while profile.json is missing or damaged', async () => {
  await as(shortHome(), async () => {
    assert.equal(profileRemote(), null);
    const damaged = [
      '{',
      '[]',
      'null',
      JSON.stringify({ host: 'github' }),
      JSON.stringify({ ...remoteFor('/r/profile.git'), remoteUrl: '' }),
      JSON.stringify(remoteFor('https://someone:secret@github.com/o/profile.git')),
      JSON.stringify(remoteFor('https://ghs_STANDINTOKEN0123456789@github.com/o/profile.git')),
      JSON.stringify(remoteFor('ssh://git:secret@github.com/o/profile.git')),
      JSON.stringify({ ...remoteFor('/r/profile.git'), connection: null }),
      JSON.stringify({ ...remoteFor('/r/profile.git'), repo: 7 }),
    ];
    for (const text of damaged) {
      writeProfileJson(text);
      assert.equal(profileRemote(), null, text);
    }
    for (const url of ['/somewhere/o/profile.git', 'https://github.com/o/profile.git', 'git@github.com:o/profile.git', 'ssh://git@github.com/o/profile.git']) {
      writeProfileJson(remoteFor(url));
      assert.deepEqual(profileRemote(), remoteFor(url), url);
    }
  });
});

test('the clone is made in place, keeps keys and backups, and never commits keys', async () => {
  const remote = await makeBareRemote({ repo: 'o/profile' });
  try {
    // The first computer: keys and a backup are there before the clone, and the remote is empty.
    await as(shortHome(), async () => {
      put('keys/enrolled.json', '{"first":true}\n');
      put('backups/o__p/2026-10-11.bundle', 'first bundle');
      assert.deepEqual(await ensureProfileClone({ remote: remoteFor(remote.url), env: {} }), { made: true });
      assert.equal(read('keys/enrolled.json'), '{"first":true}\n');
      assert.equal(read('backups/o__p/2026-10-11.bundle'), 'first bundle');
      assert.deepEqual(await remoteFiles(remote.url), ['README.md'], 'the branch starts with its first commit alone');
      const exclude = fs.readFileSync(path.join(profileDir(), '.git', 'info', 'exclude'), 'utf8');
      assert.match(exclude, /^\/keys\/$/m);
      assert.equal((await run('git', ['check-ignore', '-q', 'keys/enrolled.json'], { cwd: profileDir() })).code, 0);
      // Even adding everything leaves keys/ out.
      await g(profileDir(), 'add', '-A');
      assert.deepEqual((await g(profileDir(), 'diff', '--cached', '--name-only')).split('\n'), ['backups/o__p/2026-10-11.bundle']);
      await g(profileDir(), 'commit', '-q', '-m', 'Back up');
      await g(profileDir(), 'push', '-q', 'origin', PROFILE_BRANCH);
      // A second call finds the clone and keeps it.
      assert.deepEqual(await ensureProfileClone({ remote: remoteFor(remote.url), env: {} }), { made: false });
      assert.equal((await g(profileDir(), 'symbolic-ref', '--short', 'HEAD')), PROFILE_BRANCH);
    });
    assert.deepEqual(await remoteFiles(remote.url), ['README.md', 'backups/o__p/2026-10-11.bundle']);

    // A second computer, with its own keys and a backup of its own, joins the branch in place.
    await as(shortHome(), async () => {
      put('keys/enrolled.json', '{"second":true}\n');
      put('backups/o__p/2026-10-12.bundle', 'second bundle');
      // The same day's bundle of the same project, made here too: the branch's is taken.
      put('backups/o__p/2026-10-11.bundle', 'second, same day');
      assert.deepEqual(await ensureProfileClone({ remote: remoteFor(remote.url), env: {} }), { made: true });
      assert.equal(read('keys/enrolled.json'), '{"second":true}\n');
      assert.equal(read('backups/o__p/2026-10-12.bundle'), 'second bundle');
      assert.equal(read('backups/o__p/2026-10-11.bundle'), 'first bundle', 'the remote\'s files are checked out');
      assert.ok(fs.existsSync(path.join(profileDir(), 'README.md')));
      assert.equal(await g(profileDir(), 'symbolic-ref', '--short', 'HEAD'), PROFILE_BRANCH);
      assert.equal(await g(profileDir(), 'status', '--porcelain', '-uall'), '?? backups/o__p/2026-10-12.bundle');
      assert.equal(await g(profileDir(), 'rev-parse', 'HEAD'), await g(profileDir(), 'rev-parse', `refs/remotes/origin/${PROFILE_BRANCH}`));
    });
  } finally { remote.cleanup(); }
});

test('a profile folder holding a clone of another repository is left alone', async () => {
  const remote = await makeBareRemote({ repo: 'o/profile' });
  const other = await makeBareRemote({ repo: 'o/other' });
  try {
    await as(shortHome(), async () => {
      await ensureProfileClone({ remote: remoteFor(other.url), env: {} });
      put('keys/enrolled.json', '{}\n');
      await assert.rejects(ensureProfileClone({ remote: remoteFor(remote.url), env: {} }), /another repository/);
      assert.ok(fs.existsSync(path.join(profileDir(), 'keys', 'enrolled.json')));
    });
  } finally { remote.cleanup(); other.cleanup(); }
});

test('the profile views are built from the profile\'s events and read back', async () => {
  await as(shortHome(), async () => {
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
    assert.equal(readProfileViews(), null);
    const setting = makeEvent({ kind: 'setting', data: { key: 'briefing', value: 'short' }, now: () => NOW });
    const unconfirmed = makeEvent({ kind: 'setting', data: { key: 'boardTab', value: 'build' }, now: () => NOW });
    const confirmation = makeEvent({ ...confirmationFor(setting), now: () => NOW });
    for (const e of [setting, unconfirmed, confirmation]) put(eventPath(e), JSON.stringify(e));
    const views = await writeProfileViews({ now: () => NOW });
    assert.equal(views.settings.briefing.value, 'short');
    assert.equal(views.settings.boardTab, undefined);
    assert.equal(views.unconfirmed.length, 1);
    assert.ok(fs.existsSync(path.join(profileViewsDir(), 'settings.json')));
    assert.deepEqual(readProfileViews(), JSON.parse(JSON.stringify(views)));
    fs.writeFileSync(path.join(profileViewsDir(), 'settings.json'), '{');
    assert.equal(readProfileViews(), null, 'a damaged view reads as none');
  });
});

test('a computer joining a profile whose branch holds keys/ refuses it, in any case, taking nothing in (ruling R105)', async () => {
  for (const folder of ['keys', 'Keys']) {
    const remote = await makeBareRemote({ repo: 'o/profile' });
    const outside = fs.mkdtempSync(path.join(shortHome(), 'outside-'));
    try {
      await g(outside, 'init', '-q', '-b', PROFILE_BRANCH);
      fs.mkdirSync(path.join(outside, folder));
      fs.writeFileSync(path.join(outside, folder, 'enrolled.json'), '[]\n');
      fs.writeFileSync(path.join(outside, 'README.md'), 'profile\n');
      await g(outside, 'add', '-f', '.');
      await g(outside, 'commit', '-q', '-m', 'planted');
      await g(outside, 'push', '-q', remote.url, PROFILE_BRANCH);
      await as(shortHome(), async () => {
        writeProfileJson(remoteFor(remote.url));
        await assert.rejects(ensureProfileClone({ remote: profileRemote() }), { message: PROFILE_HOLDS_KEYS }, folder);
        assert.equal(fs.existsSync(path.join(profileDir(), 'README.md')), false, folder);
        assert.equal((await run('git', ['rev-parse', '--verify', '-q', `refs/heads/${PROFILE_BRANCH}`], { cwd: profileDir() })).code !== 0, true, folder);
      });
    } finally {
      remote.cleanup();
    }
  }
});
