// tests/scripts/setup/own-app.test.js
// The person's own GitHub App: the new-app link filled in from Wheelhouse's manifest, the app read
// back and refused when it asks for more, read again at each code sign-in, the device flow's tick,
// its record in the director's settings on this computer (in force once the director confirms it),
// and its undo. Nothing real is registered or signed in: `gh` and GitHub's sign-in pages are fakes,
// and every home is a scratch folder.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MANIFEST_FILE, NEVER, DEVICE_FLOW_OFF, PROFILE_TARGET, readManifest, newAppUrl, appName, appSlug, readOwnApp, grownPermissions,
  ownAppCode, checkOwnApp, ensureOwnApp, recordOwnApp, putBackOwnApp, helperProfile, appSettingsUrl, ownAppFrom, shadowedOwnApp,
} from '../../../scripts/setup/own-app.js';
import { appFor } from '../../../scripts/setup/host.js';
import { reverseChange } from '../../../scripts/setup/journal.js';
import { checkSetting, definitionOf, OWN_GITHUB_APP_KEY } from '../../../scripts/settings/catalogue.js';
import { writeKey, readKey } from '../../../scripts/host/keys.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { writeSetting } from '../../../scripts/frontdesk/cli.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { profileDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { confirmLine } from '../../../scripts/state/card-lines.js';
import { makeBareRemote } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress, withHome } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const NOW = new Date('2026-10-20T03:00:00.000Z');
const USER = 'a-director';
const OWN = { clientId: 'Iv23li.ownapp0001', slug: 'wheelhouse-a-director', owner: USER };
const WHEELHOUSE = { clientId: 'Iv1.wheelhouse0001', slug: 'wheelhouse-test', owner: 'wheelhouse-org' };
const MANIFEST_PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read' };

// A fake `gh`: the apps GitHub has (by slug), and the director's organisation memberships.
function fakeGh({ apps = {}, memberships = [] } = {}) {
  const calls = [];
  const run = async (file, args = []) => {
    if (path.basename(file).replace(/\.exe$/, '') !== 'gh') throw new Error(`only gh is faked, not ${file}`);
    calls.push([...args]);
    const answer = (stdout, code = 0, stderr = '') => ({ code, stdout, stderr });
    if (args[0] === 'api' && args[1].startsWith('apps/')) {
      const app = apps[args[1].slice('apps/'.length)];
      if (!app) return answer('', 1, 'gh: Not Found (HTTP 404)');
      return answer(JSON.stringify({
        slug: app.slug, client_id: app.clientId, owner: { login: app.owner, type: app.org ? 'Organization' : 'User' }, permissions: app.permissions ?? MANIFEST_PERMISSIONS,
      }));
    }
    if (args[0] === 'api' && args[1].startsWith('user/memberships/orgs')) return answer(JSON.stringify(memberships));
    return answer('', 1, 'unknown command');
  };
  return { run, calls, apps, reads: () => calls.filter((c) => c[1].startsWith('apps/')).length };
}

// GitHub's device sign-in, answering `disabled` times that device flow is off (first as a refusal
// in a 200, then as a 400), then with a code.
function deviceFlow({ disabled = 0 } = {}) {
  let asked = 0;
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = async (url) => {
    if (url !== 'https://github.com/login/device/code') return reply(404, {});
    asked += 1;
    if (asked <= disabled) return reply(asked % 2 === 1 ? 200 : 400, { error: 'device_flow_disabled', error_description: 'Device Flow must be explicitly enabled for this App' });
    return reply(200, { device_code: 'dev-1', user_code: 'WXYZ-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 });
  };
  return { fetch, asked: () => asked };
}

// A clock the waits move on.
function clock(start = NOW) {
  let at = start.getTime();
  return { now: () => new Date(at), sleep: async (ms) => { at += ms; } };
}

// The profile as a helper's routes give it, held in memory: `accept` stands for the director's
// Confirm of the latest write.
function memoryProfile(settings = {}) {
  const writes = [];
  const state = { settings: { ...settings }, unconfirmed: [] };
  return {
    writes,
    state,
    write: async ({ kind, data }) => {
      writes.push({ kind, data });
      state.unconfirmed.push({ kind, id: `ev-${writes.length}`, key: data.key, data });
      return { ok: true, id: `ev-${writes.length}`, pushed: true };
    },
    views: async () => structuredClone(state),
    accept() {
      const last = state.unconfirmed.pop();
      state.settings[last.key] = { key: last.key, id: last.id, value: last.data.value };
    },
  };
}

// ---- The new-app link and the manifest ----

test('the new-app link carries every manifest field, for an account and for an organisation', () => {
  const manifest = readManifest();
  const name = appName(USER);
  const mine = new URL(newAppUrl({ manifest, owner: { kind: 'user' }, name }));
  assert.equal(`${mine.origin}${mine.pathname}`, 'https://github.com/settings/apps/new');
  const theirs = new URL(newAppUrl({ manifest, owner: { kind: 'org', login: 'acme' }, name: appName('acme') }));
  assert.equal(`${theirs.origin}${theirs.pathname}`, 'https://github.com/organizations/acme/settings/apps/new');
  for (const [url, named] of [[mine, `Wheelhouse ${USER}`], [theirs, 'Wheelhouse acme']]) {
    assert.equal(url.searchParams.get('name'), named);
    assert.equal(url.searchParams.get('description'), manifest.description);
    assert.equal(url.searchParams.get('url'), manifest.url);
    assert.equal(url.searchParams.get('webhook_active'), 'false');
    for (const [key, level] of Object.entries(manifest.default_permissions)) assert.equal(url.searchParams.get(key), level, key);
    const filled = [...url.searchParams.keys()].sort();
    assert.deepEqual(filled, ['description', 'name', 'public', 'url', 'webhook_active', ...Object.keys(manifest.default_permissions)].sort());
  }
  // The name is GitHub's longest at most, and gives the address name setup looks it up by.
  assert.equal(appName('a-very-long-organisation-name-indeed').length, 34);
  assert.equal(appSlug(appName(USER)), 'wheelhouse-a-director');
  assert.equal(appSlug('Wheelhouse Zoë_Co'), 'wheelhouse-zo-co');
  assert.throws(() => newAppUrl({ manifest, owner: { kind: 'org', login: 'acme/../x' }, name }), /letters, digits and dashes/);
  // Check 20's link is built from the same manifest.
  const probe = fs.readFileSync(new URL('../../../probes/20-github-app/register.js', import.meta.url), 'utf8');
  assert.match(probe, /newAppUrl\(/);
  assert.match(probe, /readManifest\(\)/);
});

test('their own app is registered with public=false, whatever the manifest says', () => {
  const manifest = readManifest();
  assert.equal(manifest.public, true, 'Wheelhouse\'s own app is public, so every user can install it');
  for (const pub of [true, false, undefined, 'true']) {
    const url = new URL(newAppUrl({ manifest: { ...manifest, public: pub }, owner: { kind: 'user' }, name: 'Wheelhouse x' }));
    assert.equal(url.searchParams.get('public'), 'false');
    assert.equal(url.searchParams.getAll('public').length, 1);
  }
});

test('the manifest asks for no Workflows, Administration or Secrets', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  assert.deepEqual(manifest.default_permissions, MANIFEST_PERMISSIONS);
  assert.equal(manifest.webhook_active, false);
  for (const key of ['workflows', 'administration', 'secrets']) {
    assert.ok(NEVER.includes(key));
    assert.ok(!Object.hasOwn(manifest.default_permissions, key), key);
  }
  for (const key of ['name', 'description', 'url']) assert.equal(typeof manifest[key], 'string', key);
  // A manifest that did ask for one gives no link at all.
  assert.throws(
    () => newAppUrl({ manifest: { ...manifest, default_permissions: { ...MANIFEST_PERMISSIONS, workflows: 'write' } }, owner: { kind: 'user' }, name: 'Wheelhouse x' }),
    /asks for Workflows, which Wheelhouse's app is never given/,
  );
});

// ---- Reading the app back ----

test('an app asking for more than the manifest is refused and named', async () => {
  const gh = fakeGh({
    apps: {
      [OWN.slug]: { ...OWN, permissions: { ...MANIFEST_PERMISSIONS, workflows: 'write', administration: 'read', secrets: 'read', actions: 'read', issues: 'admin' } },
      narrower: { ...OWN, slug: 'narrower', permissions: { contents: 'read', metadata: 'read' } },
    },
  });
  await assert.rejects(readOwnApp({ slug: OWN.slug, run: gh.run }), (error) => {
    assert.match(error.message, /^Your GitHub App wheelhouse-a-director asks for more than Wheelhouse's: /);
    for (const named of ['Issues (admin)', 'Workflows (write)', 'Administration (read)', 'Secrets (read)', 'Actions (read)']) assert.ok(error.message.includes(named), named);
    assert.ok(!error.message.includes('Contents'), 'what did not grow is not named');
    return true;
  });
  // Fewer than the manifest's is fine.
  const read = await readOwnApp({ slug: 'narrower', run: gh.run });
  assert.deepEqual({ clientId: read.clientId, slug: read.slug, owner: read.owner, ownerKind: read.ownerKind }, { clientId: OWN.clientId, slug: 'narrower', owner: USER, ownerKind: 'user' });
  assert.deepEqual(grownPermissions(MANIFEST_PERMISSIONS), []);
  await assert.rejects(readOwnApp({ slug: 'nobody-has-this', run: gh.run }), { code: 'not-found' });
  // An app found by its name is refused before anything is recorded, and the step stops there.
  await assert.rejects(ensureOwnApp({ account: USER, user: USER, run: gh.run }), /asks for more than Wheelhouse's/);
});

test('their own app is read again at each code sign-in, and a sign-in is refused once its permissions grew', async () => {
  const gh = fakeGh({ apps: { [OWN.slug]: { ...OWN } } });
  const flow = deviceFlow();
  const code = await ownAppCode({ app: OWN, account: USER, run: gh.run, fetch: flow.fetch });
  assert.equal(code.userCode, 'WXYZ-1234');
  assert.equal(gh.reads(), 1, 'read before the code');
  // On GitHub, the app's owner widens it.
  gh.apps[OWN.slug].permissions = { ...MANIFEST_PERMISSIONS, workflows: 'write' };
  await assert.rejects(ownAppCode({ app: OWN, account: USER, run: gh.run, fetch: flow.fetch }), /asks for more than Wheelhouse's: Workflows \(write\)/);
  assert.equal(gh.reads(), 2, 'read again at the second sign-in');
  assert.equal(flow.asked(), 1, 'no code is asked for once it grew');
  // An app whose client ID is not the one recorded is not signed in to either.
  gh.apps[OWN.slug] = { ...OWN, clientId: 'Iv23li.another0001' };
  await assert.rejects(ownAppCode({ app: OWN, account: USER, run: gh.run, fetch: flow.fetch }), /another client ID than the one recorded/);
  assert.equal(flow.asked(), 1);
});

test('device flow switched off is said with the page to tick, and asked again', async () => {
  for (const org of [false, true]) {
    const owner = org ? 'acme' : USER;
    const app = { ...OWN, owner, slug: org ? 'wheelhouse-acme' : OWN.slug };
    const gh = fakeGh({ apps: { [app.slug]: { ...app, org } } });
    const flow = deviceFlow({ disabled: 2 });
    const lines = [];
    const opened = [];
    const time = clock();
    const code = await ownAppCode({
      app, account: owner, run: gh.run, fetch: flow.fetch, say: (line) => lines.push(line), open: async (url) => { opened.push(url); }, sleep: time.sleep, now: time.now,
    });
    assert.equal(code.userCode, 'WXYZ-1234');
    assert.deepEqual(lines, [DEVICE_FLOW_OFF]);
    assert.match(lines[0], /^Tick Enable Device Flow on your app's page/);
    assert.deepEqual(opened, [org ? 'https://github.com/organizations/acme/settings/apps/wheelhouse-acme' : 'https://github.com/settings/apps/wheelhouse-a-director']);
    assert.equal(opened[0], appSettingsUrl({ slug: app.slug, owner, ownerKind: org ? 'org' : 'user' }));
    assert.equal(flow.asked(), 3, 'asked again until it was ticked');
  }
  // Never ticked: the step stops, plainly, after its wait; STOP stops it sooner.
  const gh = fakeGh({ apps: { [OWN.slug]: { ...OWN } } });
  const time = clock();
  await assert.rejects(
    ownAppCode({ app: OWN, account: USER, run: gh.run, fetch: deviceFlow({ disabled: Infinity }).fetch, sleep: time.sleep, now: time.now }),
    /Enable Device Flow was not ticked on your app's page after 8 minutes/,
  );
  await assert.rejects(
    ownAppCode({ app: OWN, account: USER, run: gh.run, fetch: deviceFlow({ disabled: Infinity }).fetch, halt: () => { throw new Error('STOP came on'); } }),
    /STOP came on/,
  );
  // Another refusal is not taken for the tick.
  const refused = async () => ({ ok: true, status: 200, json: async () => ({ error: 'unauthorized_client' }) });
  await assert.rejects(ownAppCode({ app: OWN, account: USER, run: gh.run, fetch: refused }), /unauthorized_client/);
});

// ---- The profile's record ----

// One computer with an enrolled key, a project, the profile on a shared bare repository, and a helper.
async function computer({ shared } = {}) {
  const home = shortHome();
  const stateRemote = shared?.stateRemote ?? await makeBareRemote({ repo: 'o/p' });
  const profileRemote = shared?.profileRemote ?? await makeBareRemote({ repo: `${USER}/wheelhouse-profile` });
  await as(home, async () => {
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
    writeProject('o__p', {
      folder: path.join(home, 'work'), remoteUrl: stateRemote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    fs.writeFileSync(path.join(wheelhouseHome(), 'profile.json'), JSON.stringify({
      remoteUrl: profileRemote.url, host: 'github', repo: `${USER}/wheelhouse-profile`, connection: { host: 'github', mode: 'quick', project: `${USER}/wheelhouse-profile` },
    }));
  });
  let tick = 0;
  const now = () => new Date(NOW.getTime() + 1000 * (tick += 1));
  const helper = await as(home, () => startHelper({
    run: hostGuard,
    address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({ mode: 'quick', env: {} }), now,
  }));
  return {
    now, stateRemote, profileRemote,
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

function appFile() {
  const file = path.join(tempFolder('wh-app-'), 'app.json');
  fs.writeFileSync(file, JSON.stringify(WHEELHOUSE));
  return file;
}

test('their own app\'s client ID wins over Wheelhouse\'s, and stays in the settings on this computer', async () => {
  const first = await computer();
  const registered = appFile();
  try {
    await first.as(async () => {
      assert.equal((await first.client.profile.clone({})).ok, true);
      const recorded = [];
      const change = await recordOwnApp(OWN, { record: (c) => recorded.push(c), profile: helperProfile(first.client) });
      assert.deepEqual(recorded, [change], 'recorded just before it was written');
      assert.deepEqual([change.kind, change.target, change.before, change.after], ['host', PROFILE_TARGET, null, OWN]);
      // Recorded again: nothing more is written while it waits for the director's Confirm.
      assert.equal(await recordOwnApp(OWN, { profile: helperProfile(first.client) }), null);
      const setting = listEvents(profileDir(), { report: () => {} }).filter((e) => e.data?.key === OWN_GITHUB_APP_KEY);
      assert.equal(setting.length, 1);
      assert.equal(setting[0].data.words, 'Your own GitHub App: wheelhouse-a-director, on a-director');
      // Unconfirmed, it counts for nothing: Wheelhouse's app is used.
      assert.deepEqual(appFor({ appFile: registered }), { ...WHEELHOUSE, own: false });

      // The director clicks Confirm on the card that quotes the setting's line: the profile's own route.
      const question = `A change to your settings, as you asked: ${setting[0].data.words}\n${confirmLine(setting[0])}?`;
      await decide({
        cwd: '/x', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question, options: [{ label: 'Confirm' }, { label: 'Not now' }] }], answers: { [question]: 'Confirm' } },
        tool_response: { answers: { [question]: 'Confirm' } },
      }, { client: first.client, now: first.now, projectOf: () => ({ project: 'o__p' }) });
      assert.deepEqual(appFor({ appFile: registered }), { ...OWN, own: true }, 'their own app wins over Wheelhouse\'s');
      assert.equal(await recordOwnApp(OWN, { profile: helperProfile(first.client) }), null, 'already recorded');
    });
    // Another computer keeps its own settings: nothing of this one's reaches it.
    const second = await computer();
    try {
      await second.as(async () => {
        assert.deepEqual(appFor({ appFile: registered }), { ...WHEELHOUSE, own: false });
      });
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
  }
});

test('only setup records their own app: the catalogue checks its shape, and the front desk may not write it', async () => {
  assert.equal(definitionOf(OWN_GITHUB_APP_KEY).home, 'profile');
  assert.doesNotThrow(() => checkSetting(OWN_GITHUB_APP_KEY, OWN));
  assert.doesNotThrow(() => checkSetting(OWN_GITHUB_APP_KEY, null));
  assert.throws(() => checkSetting(OWN_GITHUB_APP_KEY, { ...OWN, privateKey: 'x' }), /own-github-app can't be/);
  assert.throws(() => checkSetting(OWN_GITHUB_APP_KEY, { ...OWN, slug: 'bad slug' }), /own-github-app can't be/);
  assert.throws(() => checkSetting(OWN_GITHUB_APP_KEY, { clientId: OWN.clientId, slug: OWN.slug }), /own-github-app can't be/);
  const nothing = { profile: { write: async () => { throw new Error('written'); } }, state: { write: async () => { throw new Error('written'); } } };
  await assert.rejects(writeSetting({ client: nothing, cwd: '/x', data: { key: OWN_GITHUB_APP_KEY, value: OWN } }), /recorded only by setup/);
  // An entry the views hold unconfirmed, or can't read, is no app.
  assert.equal(appFor({ views: () => ({ settings: {}, unconfirmed: [{ kind: 'setting', key: OWN_GITHUB_APP_KEY, data: { value: OWN } }] }) }), null);
  assert.equal(appFor({ views: () => { throw new Error('unreadable'); } }), null);
  assert.equal(appFor({ views: () => ({ settings: { [OWN_GITHUB_APP_KEY]: { value: { ...OWN, slug: 'bad slug' } } } }) }), null);
  assert.equal(appFor({ views: () => ({ settings: { [OWN_GITHUB_APP_KEY]: { value: null } } }) }), null, 'put back to none');
});

test('uninstall puts back the profile\'s own-github-app key, and leaves the keys file\'s github-app entry to its own undo', async () => {
  await withHome(async () => {
    const profile = memoryProfile();
    const change = await recordOwnApp(OWN, { profile });
    const keyChange = { id: 'chg-key', step: 3, kind: 'host', target: 'key github-app', before: null, after: { key: 'github-app', clientId: OWN.clientId, app: OWN.slug } };
    writeKey('github-app', { clientId: OWN.clientId, accessToken: 'ghu_accesskeyfortests0001', installationId: 77 });
    profile.accept();
    // The journal's own reverse leaves both to their own step.
    assert.deepEqual(reverseChange({ ...change, step: 3 }), { put: false, why: 'put back by its own step' });
    assert.deepEqual(reverseChange(keyChange), { put: false, why: 'put back by its own step' });
    const put = await putBackOwnApp(change, { profile });
    assert.equal(put.put, true);
    assert.deepEqual(profile.writes.at(-1), { kind: 'setting', data: { key: OWN_GITHUB_APP_KEY, value: null, words: 'Your own GitHub App: none' } });
    assert.deepEqual(readKey('github-app'), { clientId: OWN.clientId, accessToken: 'ghu_accesskeyfortests0001', installationId: 77 }, 'the keys file is the keys change\'s to undo');
    // An app the director recorded since setup is left as it is.
    profile.accept();
    const theirs = { ...OWN, clientId: 'Iv23li.theirs0001', slug: 'their-app' };
    profile.state.settings[OWN_GITHUB_APP_KEY] = { key: OWN_GITHUB_APP_KEY, value: theirs };
    const writes = profile.writes.length;
    assert.deepEqual(await putBackOwnApp(change, { profile }), { put: false, why: 'changed since setup' });
    assert.equal(profile.writes.length, writes);
    // An app recorded over an earlier one puts the earlier one back.
    const over = await recordOwnApp(OWN, { profile });
    assert.deepEqual(over.before, theirs);
    profile.accept();
    await putBackOwnApp(over, { profile });
    assert.deepEqual(profile.writes.at(-1).data.value, theirs);
  });
});

test('a record never confirmed is put back so that a later Confirm of its card never brings it into effect', async () => {
  await withHome(async () => {
    const profile = memoryProfile();
    const change = await recordOwnApp(OWN, { profile });
    // Uninstall comes before the director confirmed setup's record: the put back is a newer proposal.
    const put = await putBackOwnApp(change, { profile });
    assert.equal(put.put, true);
    assert.deepEqual(profile.writes.map((x) => x.data.value), [OWN, null]);
    // The director clicks Confirm on setup's old card later: the newer put back still waits, so no app counts.
    const [old, back] = profile.state.unconfirmed;
    profile.state.unconfirmed = [back];
    profile.state.settings[OWN_GITHUB_APP_KEY] = { key: OWN_GITHUB_APP_KEY, id: old.id, value: OWN };
    assert.equal(ownAppFrom(await profile.views()), null);
    // Confirming the put back leaves none.
    profile.accept();
    assert.equal(ownAppFrom(await profile.views()), null);
    assert.equal(profile.state.settings[OWN_GITHUB_APP_KEY].value, null);
    // While any newer proposal waits, a confirmed app counts for nothing: a proposal only takes trust away.
    assert.equal(ownAppFrom({ settings: { [OWN_GITHUB_APP_KEY]: { value: OWN } }, unconfirmed: [] }).slug, OWN.slug);
    assert.equal(ownAppFrom({ settings: { [OWN_GITHUB_APP_KEY]: { value: OWN } }, unconfirmed: [{ kind: 'setting', key: OWN_GITHUB_APP_KEY, data: { value: OWN } }] }), null);
  });
});

test('a change waiting no longer hides the confirmed app for good: setup proposes it again, and Confirm restores it (ruling R84)', async () => {
  await withHome(async () => {
    const profile = memoryProfile();
    await recordOwnApp(OWN, { profile });
    profile.accept();
    assert.equal(await recordOwnApp(OWN, { profile }), null, 'confirmed with nothing waiting: nothing written');
    assert.equal(shadowedOwnApp(await profile.views()), null);
    // A stray writer proposes another app: the confirmed one counts for nothing while it waits.
    const stray = { clientId: 'Iv23li.stray0001', slug: 'helpful-app', owner: 'mallory' };
    profile.state.unconfirmed.push({ kind: 'setting', id: 'ev-stray', key: OWN_GITHUB_APP_KEY, data: { key: OWN_GITHUB_APP_KEY, value: stray } });
    assert.equal(ownAppFrom(await profile.views()), null);
    assert.deepEqual(shadowedOwnApp(await profile.views()), { accepted: OWN, waiting: stray });
    // Setup writes the accepted app again, as a newer proposal, recorded first.
    const recorded = [];
    const again = await recordOwnApp(OWN, { profile, record: (c) => recorded.push(c) });
    assert.deepEqual([again.kind, again.target, again.before, again.after], ['host', 'profile own-github-app', OWN, OWN]);
    assert.deepEqual(recorded, [again]);
    assert.deepEqual(profile.writes.at(-1).data.value, OWN);
    assert.deepEqual(shadowedOwnApp(await profile.views()), { accepted: OWN, waiting: OWN });
    // Already the newest change waiting: not written again.
    const writes = profile.writes.length;
    assert.equal(await recordOwnApp(OWN, { profile }), null);
    assert.equal(profile.writes.length, writes);
    // The director's Confirm of it: the views list nothing older as waiting, and the app counts again.
    profile.accept();
    profile.state.unconfirmed = profile.state.unconfirmed.filter((u) => u.key !== OWN_GITHUB_APP_KEY);
    assert.deepEqual(ownAppFrom(await profile.views()), OWN);
    // A put back to none waiting names no app.
    profile.state.unconfirmed.push({ kind: 'setting', id: 'ev-none', key: OWN_GITHUB_APP_KEY, data: { key: OWN_GITHUB_APP_KEY, value: null } });
    assert.deepEqual(shadowedOwnApp(await profile.views()), { accepted: OWN, waiting: null });
    // Nothing accepted: no app is hidden, whatever waits.
    assert.equal(shadowedOwnApp({ settings: {}, unconfirmed: [{ kind: 'setting', key: OWN_GITHUB_APP_KEY, data: { value: OWN } }] }), null);
  });
});

test('the change is recorded before the profile is written', async () => {
  const profile = memoryProfile();
  const seen = [];
  await recordOwnApp(OWN, { profile, record: () => { seen.push(profile.writes.length); } });
  assert.deepEqual(seen, [0], 'nothing was written when the change was recorded');
  assert.equal(profile.writes.length, 1);
  // A write that fails leaves the change recorded, so the journal shows what was tried.
  const failing = { ...memoryProfile(), write: async () => ({ ok: false, why: 'the helper could not be reached' }) };
  const recorded = [];
  await assert.rejects(recordOwnApp(OWN, { profile: failing, record: (c) => recorded.push(c) }), /could not be recorded in your settings on this computer: the helper could not be reached/);
  assert.equal(recorded.length, 1);
});

test('a recorded app is held to GitHub\'s owner: the record\'s and the project\'s account, before any code', async () => {
  // A writer records its own app, which asks for no more than the manifest, naming the director as owner.
  const theirs = { clientId: 'Iv23li.mallory0001', slug: 'helpful-app', owner: 'mallory' };
  const gh = fakeGh({ apps: { [theirs.slug]: { ...theirs } } });
  const flow = deviceFlow();
  const lying = { ...theirs, owner: USER };
  await assert.rejects(ownAppCode({ app: lying, account: USER, run: gh.run, fetch: flow.fetch }), /GitHub says the app helpful-app belongs to mallory, not a-director as recorded/);
  await assert.rejects(checkOwnApp({ app: lying, account: USER, run: gh.run }), /belongs to mallory/);
  // A true record on another account than the project's is refused too (ruling R57).
  await assert.rejects(checkOwnApp({ app: theirs, account: USER, run: gh.run }), /belongs to mallory, not a-director/);
  assert.equal(flow.asked(), 0, 'no code was asked for');
  // The app found by its name on the project's account belongs to someone else: refused, not used.
  const squatted = fakeGh({ apps: { [OWN.slug]: { ...OWN, owner: 'mallory' } } });
  await assert.rejects(ensureOwnApp({ account: USER, user: USER, run: squatted.run }), /The GitHub App wheelhouse-a-director belongs to mallory, not a-director, so setup has not used it/);
  // A client ID that is not a GitHub App's is refused when the app is read, before any keys are made.
  const odd = fakeGh({ apps: { [OWN.slug]: { ...OWN, clientId: 'not-a-client-id' } } });
  await assert.rejects(readOwnApp({ slug: OWN.slug, run: odd.run }), /a client ID setup can't read/);
});

test('the app the profile records is held to the project\'s account too: one GitHub says is another\'s is refused, not used', async () => {
  // The record names the director's account and the client ID GitHub gives, but GitHub says the
  // app belongs to someone else now.
  const kept = { clientId: 'Iv23li.keptapp0001', slug: 'kept-app', owner: USER };
  const gh = fakeGh({ apps: { [kept.slug]: { ...kept, owner: 'mallory' }, [OWN.slug]: { ...OWN } } });
  await assert.rejects(ensureOwnApp({ account: USER, user: USER, recorded: kept, run: gh.run }), /The GitHub App kept-app belongs to mallory, not a-director, so setup has not used it/);
  // GitHub's owner the account's: it is used, with no page opened.
  const ours = fakeGh({ apps: { [kept.slug]: { ...kept } } });
  const opened = [];
  assert.equal((await ensureOwnApp({ account: USER, user: USER, recorded: kept, run: ours.run, open: async (u) => { opened.push(u); } })).slug, kept.slug);
  assert.deepEqual(opened, []);
});

test('an organisation\'s app found by its name is refused plainly to a member who is not an owner', async () => {
  const acme = { clientId: 'Iv23li.acmeapp0001', slug: 'wheelhouse-acme', owner: 'acme', org: true };
  const opened = [];
  const time = clock();
  for (const recorded of [null, { clientId: acme.clientId, slug: acme.slug, owner: 'acme' }]) {
    const gh = fakeGh({ apps: { [acme.slug]: acme }, memberships: [{ role: 'member', state: 'active', organization: { login: 'acme' } }] });
    await assert.rejects(
      ensureOwnApp({ account: 'acme', user: USER, recorded, run: gh.run, open: async (u) => { opened.push(u); }, sleep: time.sleep, now: time.now }),
      /Only an owner of acme on GitHub can make or install a GitHub App there/,
    );
  }
  assert.deepEqual(opened, []);
  assert.equal(time.now().getTime(), NOW.getTime(), 'no wait');
  const owner = fakeGh({ apps: { [acme.slug]: acme }, memberships: [{ role: 'admin', state: 'active', organization: { login: 'acme' } }] });
  assert.equal((await ensureOwnApp({ account: 'acme', user: USER, run: owner.run })).clientId, acme.clientId);
});
