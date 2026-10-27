// tests/scripts/host/helper-profile.test.js
// The director's settings through the helper (design section 24.2): their own record on this
// computer, with no remote, and the import of a v0.1.x profile clone into it.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { profileDir, profileViewsDir, oldProfileDir, stateDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { readProfileViews } from '../../../scripts/profile/store.js';
import { listEvents, makeEvent, confirmationFor, writeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { openRecord } from '../../../scripts/state/record.js';
import { confirmLine } from '../../../scripts/state/card-lines.js';
import { makeBareRemote } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const PROJECT = 'o__p';
const T0 = new Date('2026-10-18T01:00:00.000Z');

const fakeAdapter = () => ({
  defaultBranch: async () => 'main',
  prState: async () => ({ state: 'closed' }),
  ciState: async () => ({ state: 'pending' }),
  merge: async () => ({ merged: false }),
  openPr: async () => ({ number: 1 }),
  updatePr: async () => ({ number: 1 }),
  issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
});

// One computer: an enrolled key, a project whose repository is a bare one, and a helper. The settings
// need no repository of their own (design section 24.2).
async function computer() {
  const home = shortHome();
  const stateRemote = await makeBareRemote({ repo: 'o/p' });
  await as(home, async () => {
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
    writeProject(PROJECT, {
      folder: path.join(home, 'work'), remoteUrl: stateRemote.url, host: 'github', repo: 'o/p',
      connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
  });
  let tick = 0;
  const now = () => new Date(T0.getTime() + 1000 * (tick += 1));
  const helper = await as(home, () => startHelper({
    run: hostGuard,
    address: testAddress(home),
    adapterFor: async () => fakeAdapter(),
    envFor: async () => ({ mode: 'quick', env: {} }),
    now,
  }));
  return {
    home, now, stateRemote,
    client: helperClient({ address: helper.address }),
    as: (fn) => as(home, fn),
    // Closed inside the home: work still queued then would otherwise reach the real one.
    close: async () => {
      await as(home, () => helper.close());
      fs.rmSync(home, { recursive: true, force: true });
      stateRemote.cleanup();
    },
  };
}

const git = async (dir, args) => (await run('git', args, { cwd: dir })).stdout.trim();
test('a profile setting is written, confirmed by a click, and shows in the profile views', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      assert.deepEqual(await c.client.profile.clone({}), { ok: true });
      const wrote = await c.client.profile.write({ kind: 'setting', data: { key: 'briefing', value: 'short', words: 'Keep the briefing short' } });
      assert.equal(wrote.ok, true, JSON.stringify(wrote));
      assert.equal(wrote.pushed, false);
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
    await c.as(async () => {
      // Kept on this computer: the settings' record has no remote, and every event is committed there.
      assert.equal(profileDir(), path.join(wheelhouseHome(), 'settings'));
      assert.equal(await git(profileDir(), ['remote']), '');
      assert.equal(await git(profileDir(), ['status', '--porcelain']), '');
      const kinds = listEvents(profileDir(), { report: () => {} }).map((e) => e.kind).sort();
      assert.deepEqual(kinds, ['confirmation', 'setting']);
      assert.equal(fs.existsSync(path.join(wheelhouseHome(), 'profile.json')), false, 'no profile repository is named');
    });
  } finally { await c.close(); }
});

test('each profile write, record and sync rewrites the profile views without asking for them', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      const wrote = await c.client.profile.write({ kind: 'setting', data: { key: 'briefing', value: 'short', words: 'Keep the briefing short' } });
      assert.equal(wrote.ok, true, JSON.stringify(wrote));
      assert.deepEqual(readProfileViews().unconfirmed.map((u) => u.id), [wrote.id]);

      const setting = listEvents(profileDir(), { report: () => {} }).find((e) => e.id === wrote.id);
      const question = `${confirmLine(setting)}?`;
      await decide({
        cwd: '/x', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question, options: [{ label: 'Confirm' }, { label: 'Not now' }] }], answers: { [question]: 'Confirm' } },
        tool_response: { answers: { [question]: 'Confirm' } },
      }, { client: c.client, now: c.now, projectOf: () => ({ project: PROJECT }) });
      assert.equal(readProfileViews().settings.briefing.value, 'short');
      assert.deepEqual(readProfileViews().unconfirmed, []);

      // A sync has nothing to bring in.
      assert.deepEqual(await c.client.profile.sync({}), { ok: true, pulled: 0, unpushed: 0 });
      assert.equal(readProfileViews().settings.briefing.value, 'short');
    });
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
      await refused(c.client.profile.record({ event: makeEvent({ ...confirmationFor(target), now: c.now }) }), /not one of your settings/);
      // A signed confirmation of the profile's setting is taken once.
      const confirmation = makeEvent({ ...confirmationFor(setting), now: c.now });
      assert.equal((await c.client.profile.record({ event: confirmation })).ok, true);
      await refused(c.client.profile.record({ event: confirmation }), /already hold an event with that id/);
    });
    await c.as(() => assert.ok(!listEvents(profileDir(), { report: () => {} }).some((e) => e.kind === 'note')));
  } finally { await c.close(); }
});

test('the helper\'s record and settings git never reads the director\'s global config', async () => {
  const scratch = tempFolder('wh-globalcfg-');
  const hooks = path.join(scratch, 'hooks');
  const marker = path.join(scratch, 'marker');
  fs.mkdirSync(hooks);
  // The hooks the clones' commits, checkouts, merges and rebases run. The helper's own pushes and ref
  // updates take the fenced route in Task 3 of the plan, so pre-push and reference-transaction are not here.
  for (const name of ['pre-commit', 'commit-msg', 'post-commit', 'post-checkout', 'post-merge', 'pre-rebase', 'post-rewrite']) {
    fs.writeFileSync(path.join(hooks, name), `#!/bin/sh\necho ${name} >> '${marker}'\n`, { mode: 0o755 });
  }
  const home = path.join(scratch, 'home');
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, '.gitconfig'), `[core]\n\thooksPath = ${hooks.replaceAll('\\', '/')}\n`);
  const c = await computer();
  const keep = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  try {
    await c.as(async () => {
      // The global config is named only after the clones are made, as the director's would be.
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      process.env.XDG_CONFIG_HOME = path.join(home, '.config');
      assert.equal((await c.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'one' } })).ok, true);
      const wrote = await c.client.profile.write({ kind: 'setting', data: { key: 'briefing', value: 'short' } });
      assert.equal(wrote.ok, true, JSON.stringify(wrote));
      assert.equal(fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '', '', 'no hook of the global config ran');
    });
  } finally {
    for (const [k, v] of Object.entries(keep)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    await c.close();
  }
});

test('/profile/import takes the v0.1.x profile clone\'s settings in once, and leaves the clone as it was', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      // A v0.1.x profile clone: a repository with a remote, a setting and its confirmation committed in it.
      const old = oldProfileDir();
      await openRecord(old, { what: 'a v0.1.x profile clone' });
      await run('git', ['remote', 'add', 'origin', 'https://example.invalid/o/profile.git'], { cwd: old });
      const setting = makeEvent({ kind: 'setting', data: { key: 'briefing', value: 'short' }, now: c.now });
      await writeEvent({ event: setting, dir: old, now: c.now });
      await writeEvent({ event: makeEvent({ ...confirmationFor(setting), now: c.now }), dir: old, now: c.now });
      const before = await git(old, ['rev-parse', 'HEAD']);

      const first = await c.client.profile.import({});
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.done, false);
      assert.equal(first.imported, 2);
      assert.equal(readProfileViews().settings.briefing.value, 'short');
      const again = await c.client.profile.import({});
      assert.equal(again.done, true, 'the mark makes it once');
      assert.equal(await git(old, ['rev-parse', 'HEAD']), before, 'the old clone is not changed');
      assert.equal(await git(old, ['remote']), 'origin');
    });
  } finally { await c.close(); }
});

test('/state/import takes the v0.1.x state clone\'s events into the record once', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      const old = path.join(stateDir(PROJECT), '..', 'state');
      await openRecord(old, { what: 'a v0.1.x state clone' });
      await run('git', ['remote', 'add', 'origin', c.stateRemote.url], { cwd: old });
      const note = makeEvent({ kind: 'note', data: { text: 'from v0.1.x' }, now: c.now });
      await writeEvent({ event: note, dir: old, now: c.now });
      const first = await c.client.state.import({ project: PROJECT });
      assert.equal(first.imported, 1, JSON.stringify(first));
      assert.ok(listEvents(stateDir(PROJECT), { report: () => {} }).some((e) => e.id === note.id));
      assert.equal((await c.client.state.import({ project: PROJECT })).done, true);
      const onHost = await run('git', ['--git-dir', c.stateRemote.url, 'branch', '--list']);
      assert.equal(onHost.stdout.trim(), '', 'nothing is pushed');
    });
  } finally { await c.close(); }
});

// A damaged v0.1.x clone (its tree's object gone) can't be imported: the import is marked as failed,
// with why, once, and the state routes go on working rather than throwing on every request.
test('a damaged v0.1.x state clone is marked as failed once, saying why, and the state routes still work', async () => {
  const c = await computer();
  try {
    await c.as(async () => {
      const old = path.join(stateDir(PROJECT), '..', 'state');
      await openRecord(old, { what: 'a v0.1.x state clone' });
      await writeEvent({ event: makeEvent({ kind: 'note', data: { text: 'from v0.1.x' }, now: c.now }), dir: old, now: c.now });
      const tree = (await run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: old })).stdout.trim();
      fs.rmSync(path.join(old, '.git', 'objects', tree.slice(0, 2), tree.slice(2)));
      const first = await c.client.state.import({ project: PROJECT });
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.done, false);
      assert.equal(first.imported, 0);
      assert.match(first.failed, /could not be listed/);
      assert.equal((await c.client.state.import({ project: PROJECT })).done, true, 'said once');
      const wrote = await c.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'after the failed import' } });
      assert.equal(wrote.ok, true, JSON.stringify(wrote));
      assert.equal((await c.client.state.views({ project: PROJECT })).ok, true);
    });
  } finally { await c.close(); }
});
