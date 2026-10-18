// tests/scripts/host/helper-profile.test.js
// The director's profile through the helper: its own repository (a bare one here), its
// own branch, its own push rules, and the weekly backup of each project's state into it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper, PUSH_REFUSALS } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { profileDir, stateDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { PROFILE_BRANCH, readProfileViews } from '../../../scripts/profile/store.js';
import { listEvents, makeEvent, confirmationFor, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { confirmLine } from '../../../scripts/state/card-lines.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';

const PROJECT = 'o__p';
const T0 = new Date('2026-10-18T01:00:00.000Z');
const NOT_SET_UP = { ok: false, why: 'The profile isn\'t set up on this computer yet' };

const fakeAdapter = () => ({
  defaultBranch: async () => 'main',
  prState: async () => ({ state: 'closed' }),
  ciState: async () => ({ state: 'pending' }),
  merge: async () => ({ merged: false }),
  openPr: async () => ({ number: 1 }),
  updatePr: async () => ({ number: 1 }),
  issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
});

const profileJson = (url) => ({
  remoteUrl: url, host: 'github', repo: 'o/profile', connection: { host: 'github', mode: 'quick', project: 'o/profile' },
});

// One computer: an enrolled key, a project whose state is on a bare repository, the
// profile's own bare repository named in profile.json (unless `profile` is false), and a helper.
// Two computers share the repositories when the first's are passed to the second.
async function computer({ profile = true, shared } = {}) {
  const home = shortHome();
  const stateRemote = shared?.stateRemote ?? await makeBareRemote({ repo: 'o/p' });
  const profileRemote = shared?.profileRemote ?? await makeBareRemote({ repo: 'o/profile' });
  await as(home, async () => {
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
    writeProject(PROJECT, {
      folder: path.join(home, 'work'), remoteUrl: stateRemote.url, host: 'github', repo: 'o/p',
      connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    if (profile) fs.writeFileSync(path.join(wheelhouseHome(), 'profile.json'), JSON.stringify(profileJson(profileRemote.url)));
  });
  let tick = 0;
  const now = () => new Date(T0.getTime() + 1000 * (tick += 1));
  const helper = await as(home, () => startHelper({
    address: testAddress(home),
    adapterFor: async () => fakeAdapter(),
    envFor: async () => ({ mode: 'quick', env: {} }),
    now,
  }));
  return {
    home, now, profileRemote, stateRemote,
    client: helperClient({ address: helper.address }),
    as: (fn) => as(home, fn),
    close: async () => {
      await helper.close();
      fs.rmSync(home, { recursive: true, force: true });
      if (!shared) {
        stateRemote.cleanup();
        profileRemote.cleanup();
      }
    },
  };
}

const remoteFiles = async (url, folder = '.') => (await run('git', ['ls-tree', '-r', '--name-only', PROFILE_BRANCH, '--', folder], { cwd: url }))
  .stdout.split('\n').filter(Boolean).sort();
const remoteText = async (url, file) => (await run('git', ['show', `${PROFILE_BRANCH}:${file}`], { cwd: url })).stdout;
const putInProfile = (relative, text) => {
  const file = path.join(profileDir(), relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

test('a profile setting is written, confirmed by a click, and shows in the profile views', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      assert.deepEqual(await c.client.profile.clone({}), { ok: true, made: true });
      const wrote = await c.client.profile.write({ kind: 'setting', data: { key: 'briefing', value: 'short', words: 'Keep the briefing short' } });
      assert.equal(wrote.ok, true, JSON.stringify(wrote));
      assert.equal(wrote.pushed, true);
      const setting = listEvents(profileDir(), { report: () => {} }).find((e) => e.id === wrote.id);
      assert.equal(setting.kind, 'setting');
      // Before the click the setting has no effect.
      assert.equal((await c.client.profile.views({})).views.settings.briefing, undefined);

      // The director clicks Confirm on the card that quotes the setting's line.
      const question = `${confirmLine(setting)}?`;
      await decide({
        cwd: '/x', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question, options: [{ label: 'Confirm' }, { label: 'Not now' }] }], answers: { [question]: 'Confirm' } },
        tool_response: { answers: { [question]: 'Confirm' } },
      }, { client: c.client, now: c.now, projectOf: () => ({ project: PROJECT }) });

      const views = await c.client.profile.views({});
      assert.equal(views.ok, true);
      assert.equal(views.views.settings.briefing.value, 'short');
      assert.equal(readProfileViews().settings.briefing.value, 'short');
      // The confirmation is in the profile, not the project's state; the answer is in the state.
      const stateEvents = listEvents(stateDir(PROJECT), { report: () => {} });
      assert.ok(!stateEvents.some((e) => e.kind === 'confirmation'));
      assert.ok(stateEvents.some((e) => e.kind === 'card-answer'));
      assert.equal(fs.readdirSync(path.join(stateDir(PROJECT), '..', 'pending')).filter((n) => n.endsWith('.json')).length, 0);
    });
    const events = await remoteFiles(c.profileRemote.url, 'events');
    assert.ok(events.some((n) => n.includes('_setting_')), 'the setting reached the profile repository');
    assert.ok(events.some((n) => n.includes('_confirmation_')), 'the confirmation reached the profile repository');
    assert.ok(!(await remoteFiles(c.profileRemote.url)).some((n) => n.startsWith('keys/')));
  } finally { await c.close(); }
});

test('the helper refuses a project setting, a plain note, or an unsigned record on the profile routes', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      const refused = async (answer, pattern) => {
        const got = await answer;
        assert.equal(got.ok, false, JSON.stringify(got));
        assert.match(got.refused, pattern);
      };
      await refused(c.client.profile.write({ kind: 'note', data: { words: 'x' } }), /only a setting/);
      await refused(c.client.profile.write({ kind: 'confirmation', data: { confirms: 'x' } }), /only a setting/);
      await refused(c.client.profile.write({ kind: 'setting', data: { key: 'autonomy', value: 'cautious' } }), /project/);
      await refused(c.client.profile.write({ kind: 'setting', data: { key: 'nonsense', value: 1 } }), /no setting called nonsense/);
      await refused(c.client.profile.write({ kind: 'setting', data: { key: 'briefing', value: 'huge' } }), /briefing can't be huge/);
      assert.equal((await c.client.profile.write({ kind: 'setting', data: { key: 'known:pull-request', value: true } })).ok, true);

      const setting = listEvents(profileDir(), { report: () => {} }).find((e) => e.kind === 'setting');
      // Unsigned.
      const { sig, ...unsigned } = makeEvent({ ...confirmationFor(setting), now: c.now });
      await refused(c.client.profile.record({ event: unsigned }), /not signed/);
      // Signed, but not a confirmation.
      const action = makeEvent({ kind: 'action', data: { action: 'lift-stop', question: 'q', label: 'Lift STOP' }, now: c.now });
      await refused(c.client.profile.record({ event: action }), /only a confirmation/);
      // A signed confirmation of a project's ruling, which is not a profile event.
      const ruling = await c.client.state.write({ project: PROJECT, kind: 'ruling', data: { words: 'Prices in dollars' } });
      const target = listEvents(stateDir(PROJECT), { report: () => {} }).find((e) => e.id === ruling.id);
      await refused(c.client.profile.record({ event: makeEvent({ ...confirmationFor(target), now: c.now }) }), /not a profile event/);
      // A signed confirmation of the profile's setting is taken once.
      const confirmation = makeEvent({ ...confirmationFor(setting), now: c.now });
      assert.equal((await c.client.profile.record({ event: confirmation })).ok, true);
      await refused(c.client.profile.record({ event: confirmation }), /already holds an event with that id/);
    });
    assert.ok(!(await remoteFiles(c.profileRemote.url, 'events')).some((n) => n.includes('_note_')));
  } finally { await c.close(); }
});

test('a profile push that changes keys/ or an existing event is refused', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      const wrote = await c.client.profile.write({ kind: 'setting', data: { key: 'boardTab', value: 'build' } });
      assert.equal(wrote.pushed, true);
      const dir = profileDir();
      const eventFile = path.relative(dir, listEvents(dir, { report: () => {} }).map((e) => path.join(dir, eventPath(e)))[0]).replaceAll('\\', '/');
      const original = fs.readFileSync(path.join(dir, eventFile), 'utf8');

      // A commit that adds the enrolled keys.
      await g(dir, 'add', '-f', '--', 'keys/enrolled.json');
      await g(dir, 'commit', '-q', '-m', 'keys');
      const keys = await c.client.profile.sync({});
      assert.equal(keys.ok, false);
      assert.equal(keys.refused, PUSH_REFUSALS.profile);
      assert.equal(keys.unpushed, 1);
      await g(dir, 'reset', '-q', '--soft', 'HEAD~1');
      await g(dir, 'rm', '-q', '--cached', '--', 'keys/enrolled.json');
      assert.ok(fs.existsSync(path.join(dir, 'keys', 'enrolled.json')), 'the keys stay on this computer');

      // A commit that changes an event already pushed.
      fs.writeFileSync(path.join(dir, eventFile), original.replace('"build"', '"director"'));
      await g(dir, 'commit', '-q', '-a', '-m', 'edit');
      const edited = await c.client.profile.sync({});
      assert.equal(edited.ok, false);
      assert.equal(edited.refused, PUSH_REFUSALS.profile);
      await g(dir, 'reset', '-q', '--hard', 'HEAD~1');

      // A commit that changes anything else.
      fs.appendFileSync(path.join(dir, 'README.md'), 'more\n');
      await g(dir, 'commit', '-q', '-a', '-m', 'readme');
      assert.equal((await c.client.profile.sync({})).refused, PUSH_REFUSALS.profile);
      await g(dir, 'reset', '-q', '--hard', 'HEAD~1');

      // A bundle changed in place.
      putInProfile('backups/o__p/2026-10-11.bundle', 'kept as it is');
      assert.equal((await c.client.profile.sync({})).ok, true);
      putInProfile('backups/o__p/2026-10-11.bundle', 'changed');
      await g(dir, 'commit', '-q', '-a', '-m', 'bundle changed');
      assert.equal((await c.client.profile.sync({})).refused, PUSH_REFUSALS.profile);
      await g(dir, 'reset', '-q', '--hard', 'HEAD~1');

      // A file under backups/ that is not a bundle.
      putInProfile('backups/o__p/notes.txt', 'not a bundle');
      await g(dir, 'add', '--', 'backups/o__p/notes.txt');
      await g(dir, 'commit', '-q', '-m', 'notes');
      assert.equal((await c.client.profile.sync({})).refused, PUSH_REFUSALS.profile);
      await g(dir, 'reset', '-q', '--hard', 'HEAD~1');

      // A new event file that holds a key: the scan names the profile push.
      const leaky = makeEvent({ kind: 'setting', data: { key: 'briefing', value: `ghp_${'a1'.repeat(18)}` }, now: c.now });
      putInProfile(eventPath(leaky), JSON.stringify(leaky));
      await g(dir, 'add', '--', eventPath(leaky).replaceAll('\\', '/'));
      await g(dir, 'commit', '-q', '-m', 'leaky');
      assert.match((await c.client.profile.sync({})).refused, /^the profile push was refused because events\/.+ matched: /);
      await g(dir, 'reset', '-q', '--hard', 'HEAD~1');

      assert.deepEqual(await c.client.profile.sync({}), { ok: true, pulled: true, unpushed: 0 });
      assert.equal(await remoteText(c.profileRemote.url, eventFile), original);
      assert.equal(await remoteText(c.profileRemote.url, 'backups/o__p/2026-10-11.bundle'), 'kept as it is');
    });
    assert.ok(!(await remoteFiles(c.profileRemote.url)).some((n) => n.startsWith('keys/')));
  } finally { await c.close(); }
});

test('old bundles may be removed from backups/ and new ones added', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      assert.equal((await c.client.profile.clone({})).ok, true);
      // Eight weekly bundles, the most the backup keeps.
      const week = (i) => `backups/o__p/${new Date(Date.UTC(2026, 6, 1 + 7 * i)).toISOString().slice(0, 10)}.bundle`;
      for (let i = 0; i < 8; i++) putInProfile(week(i), `week ${i}`);
      assert.deepEqual(await c.client.profile.sync({}), { ok: true, pulled: true, unpushed: 0 });
      assert.deepEqual(await remoteFiles(c.profileRemote.url, 'backups'), [0, 1, 2, 3, 4, 5, 6, 7].map(week));

      // A ninth: the oldest is pruned, as the backup's keep rule does.
      fs.rmSync(path.join(profileDir(), week(0)));
      putInProfile(week(8), 'week 8');
      putInProfile('backups/o__p/notes.txt', 'not a bundle');
      putInProfile('backups/o__p/2026-09-22.bundle.partial', 'half made');

      // Another computer's event lands first: the push goes on top of it, never over it.
      const other = path.join(c.home, 'other-clone');
      await g(c.home, 'clone', '-q', '--branch', PROFILE_BRANCH, c.profileRemote.url, other);
      const theirs = makeEvent({ kind: 'setting', data: { key: 'explanations', value: 'some-terms' }, now: c.now });
      fs.mkdirSync(path.dirname(path.join(other, eventPath(theirs))), { recursive: true });
      fs.writeFileSync(path.join(other, eventPath(theirs)), JSON.stringify(theirs));
      await g(other, 'add', '-A');
      await g(other, 'commit', '-q', '-m', 'theirs');
      await g(other, 'push', '-q', 'origin', PROFILE_BRANCH);

      assert.deepEqual(await c.client.profile.sync({}), { ok: true, pulled: true, unpushed: 0 });
      assert.deepEqual(await remoteFiles(c.profileRemote.url, 'backups'), [1, 2, 3, 4, 5, 6, 7, 8].map(week));
      assert.equal((await remoteFiles(c.profileRemote.url, 'events')).length, 1, 'the other computer\'s event is still there');

      // A bundle missing that the keep rule did not prune is put back, and its removal never pushed.
      fs.rmSync(path.join(profileDir(), week(5)));
      assert.deepEqual(await c.client.profile.sync({}), { ok: true, pulled: true, unpushed: 0 });
      assert.deepEqual(await remoteFiles(c.profileRemote.url, 'backups'), [1, 2, 3, 4, 5, 6, 7, 8].map(week));
      assert.equal(fs.readFileSync(path.join(profileDir(), week(5)), 'utf8'), 'week 5');
    });
  } finally { await c.close(); }
});

test('two computers backing up the same project on the same day both go on writing', async () => {
  const a = await computer();
  const b = await computer({ shared: a });
  const c = await computer({ shared: a });
  try {
    // Both back up before either has pushed, so each makes today's bundle.
    await a.as(async () => assert.equal((await a.client.state.backup({ project: PROJECT })).made, true));
    await b.as(async () => assert.equal((await b.client.state.backup({ project: PROJECT })).made, true));
    // Then both write a profile setting: both are pushed.
    await a.as(async () => {
      const wrote = await a.client.profile.write({ kind: 'setting', data: { key: 'briefing', value: 'short' } });
      assert.equal(wrote.pushed, true, JSON.stringify(wrote));
    });
    await b.as(async () => {
      const wrote = await b.client.profile.write({ kind: 'setting', data: { key: 'boardTab', value: 'build' } });
      assert.equal(wrote.pushed, true, JSON.stringify(wrote));
      assert.deepEqual(await b.client.profile.sync({}), { ok: true, pulled: true, unpushed: 0 });
      assert.equal(await g(profileDir(), 'status', '--porcelain'), '', 'nothing is left stuck on this computer');
    });
    const events = await remoteFiles(a.profileRemote.url, 'events');
    assert.equal(events.filter((n) => n.includes('_setting_')).length, 2);
    assert.deepEqual(await remoteFiles(a.profileRemote.url, 'backups'), ['backups/o__p/2026-10-18.bundle']);
    // A third computer backing up later the same day finds today's bundle in the profile.
    await c.as(async () => {
      assert.deepEqual(await c.client.state.backup({ project: PROJECT }), {
        ok: true, file: 'backups/o__p/2026-10-18.bundle', made: false, why: 'The profile already holds today\'s backup of this project',
      });
    });
  } finally { await c.close(); await b.close(); await a.close(); }
});

test('a profile clone whose start was cut short is finished, and no bundle is removed', async () => {
  for (const stopAfter of ['update-ref', 'reset']) {
    const a = await computer();
    const b = await computer({ shared: a });
    try {
      await a.as(async () => {
        assert.equal((await a.client.profile.clone({})).ok, true);
        putInProfile('backups/o__p/2026-10-04.bundle', 'one');
        putInProfile('backups/o__p/2026-10-11.bundle', 'two');
        assert.equal((await a.client.profile.sync({})).ok, true);
      });
      await b.as(async () => {
        // The first steps of joining the branch, then the start is cut short.
        const dir = profileDir();
        await g(dir, 'init', '-q');
        await g(dir, 'symbolic-ref', 'HEAD', `refs/heads/${PROFILE_BRANCH}`);
        await g(dir, 'remote', 'add', '-t', PROFILE_BRANCH, 'origin', a.profileRemote.url);
        await g(dir, 'fetch', '-q', 'origin');
        await g(dir, 'update-ref', `refs/heads/${PROFILE_BRANCH}`, `refs/remotes/origin/${PROFILE_BRANCH}`);
        if (stopAfter === 'reset') await g(dir, 'reset', '-q');
        assert.deepEqual(await b.client.profile.sync({}), { ok: true, pulled: true, unpushed: 0 }, stopAfter);
        assert.equal(fs.readFileSync(path.join(dir, 'backups', 'o__p', '2026-10-04.bundle'), 'utf8'), 'one');
        assert.equal(await g(dir, 'status', '--porcelain'), '');
      });
      assert.deepEqual(await remoteFiles(a.profileRemote.url, 'backups'), ['backups/o__p/2026-10-04.bundle', 'backups/o__p/2026-10-11.bundle'], stopAfter);
    } finally { await b.close(); await a.close(); }
  }
});

test('/state/backup writes this week\'s bundle once; /profile/sync pushes it', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      assert.equal((await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'kept' } })).ok, true);
      assert.deepEqual(await c.client.state.backup({ project: PROJECT }), { ok: true, file: 'backups/o__p/2026-10-18.bundle', made: true });
      assert.deepEqual(await c.client.state.backup({ project: PROJECT }), {
        ok: true, file: 'backups/o__p/2026-10-18.bundle', made: false, why: 'The profile already holds today\'s backup of this project',
      });
      assert.deepEqual(fs.readdirSync(path.join(profileDir(), 'backups', PROJECT)), ['2026-10-18.bundle']);
      const refused = await c.client.state.backup({ project: '../elsewhere' });
      assert.equal(refused.ok, false);
      assert.deepEqual(await c.client.profile.sync({}), { ok: true, pulled: true, unpushed: 0 });
    });
    assert.deepEqual(await remoteFiles(c.profileRemote.url, 'backups'), ['backups/o__p/2026-10-18.bundle']);
    const copy = path.join(c.home, 'bundle-check');
    await g(c.home, 'clone', '-q', '--branch', PROFILE_BRANCH, c.profileRemote.url, copy);
    assert.equal((await run('git', ['bundle', 'verify', path.join(copy, 'backups', PROJECT, '2026-10-18.bundle')], { cwd: c.stateRemote.url })).code, 0);
  } finally { await c.close(); }
});

test('every profile route says the profile is not set up while there is no remote', async () => {
  const c = await computer({ profile: false });
  try {
    await c.as(async () => {
      const calls = () => [
        c.client.profile.clone({}),
        c.client.profile.write({ kind: 'setting', data: { key: 'briefing', value: 'short' } }),
        c.client.profile.record({ event: {} }),
        c.client.profile.sync({}),
        c.client.profile.views({}),
        c.client.state.backup({ project: PROJECT }),
      ];
      for (const answer of await Promise.all(calls())) assert.deepEqual(answer, NOT_SET_UP);
      fs.writeFileSync(path.join(wheelhouseHome(), 'profile.json'), '{ damaged');
      for (const answer of await Promise.all(calls())) assert.deepEqual(answer, NOT_SET_UP);
      assert.equal(fs.existsSync(path.join(profileDir(), '.git')), false);
      assert.equal(fs.existsSync(path.join(profileDir(), 'backups')), false);
    });
  } finally { await c.close(); }
});
