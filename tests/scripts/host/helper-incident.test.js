// tests/scripts/host/helper-incident.test.js
// An incident freezes merges, and the work's signed approval says which pull
// requests are shown first (design section 12). The helper reads both from the
// state's views, never from the caller: an incident from its declaration until
// the director's click on End it, a fix only from the director's click on the
// card, and shown-first from the signed approval of the work the branch names.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper, incidentFor, fixOfRun, shownFirstNeeded } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir, oldStateDir } from '../../../scripts/lib/paths.js';
import { openRecord } from '../../../scripts/state/record.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeEvent, eventPath, writeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { prOnHost } from '../../helpers/pr-on-host.js';
import { matchingBody } from '../../helpers/provenance.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

// A pull request body stamped with what matches the installed manifest, so the gate's provenance condition passes.
const BODY = matchingBody();

const T0 = new Date('2026-10-19T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const H1 = '1'.repeat(64);
const short = (sha) => sha.slice(0, 7);
const frozen = (id) => `incident ${id} is open, so only its fix may merge`;
const NONE_FOUND = { guardrailPaths: [], criticalAreas: [] };

// A host whose default branch holds `files`.
async function hostWith(files = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = tempFolder('wh-main-');
  await g(work, 'init', '-q', '-b', 'main');
  for (const [name, text] of Object.entries({ 'README.md': 'The product.\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(work, name)), { recursive: true });
    fs.writeFileSync(path.join(work, name), text);
  }
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'push', '-q', remote.url, 'HEAD:refs/heads/main');
  return remote;
}
const flagConfig = (flagFiles) => ({ '.claude/wheelhouse.json': `${JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], flagFiles })}\n` });

async function project(remote) {
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder: path.join(home, 'work'), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(0) })).taken, true);
  });
  return home;
}

let tick = 0;
function record(kind, data, { unsigned = false } = {}) {
  tick += 1;
  const { sig, ...bare } = makeEvent({ kind, data, now: at(1000 * tick) });
  const event = unsigned ? bare : { ...bare, sig };
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
const reviewed = (number, commit) => record('review', { pr: number, commit, verdict: 'CLEAN' });
const approved = (number, commit) => record('approval', { pr: number, commit });
const declare = (id) => record('incident', { id, what: 'Totals are wrong' });
const click = (data, options) => record('action', { question: 'the card as shown', label: 'Click', ...data }, options);
const fixFor = (incident, pr, options) => click({ action: 'incident-fix', incident, pr, label: 'Merge the fix' }, options);
const lift = (incident) => click({ action: 'lift-incident', incident, label: 'End it' });
// The work, and the director's signed approval of it, as the front desk records them.
function approveWork({ id = 'export-csv', lane, shownFirst }) {
  record('work', { id, title: 'Export', lane, visible: true, dependsOn: [], doc: { path: 'd.md', hash: H1 } });
  click({ action: 'approve-work', work: id, lane, hash: H1, shownFirst, label: 'Approve' });
}

// The adapter for pull requests `prs` ({ number: { headSha, headRef } }) on a stand-in host.
function fakeAdapter(prs) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async (number) => ({ ...prs[number], baseRef: 'main', mergeable: 'mergeable', state: 'open', body: BODY }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
  };
}

async function withHelper(home, adapter, fn, options = {}) {
  return as(home, async () => {
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), ...options });
    try {
      return await fn(helperClient({ address: helper.address }));
    } finally { await helper.close(); }
  });
}
const merge = (client, number = 7, extra = {}) => client.merge({ project: 'o__p', number, stop: false, bypass: false, ...extra });

// A reviewed pull request `number` from `headRef`, with `files` changed, ready to merge.
async function readyPr(home, remote, number, headRef, files) {
  const headSha = await prOnHost(remote.url, { number, files });
  await as(home, () => reviewed(number, headSha));
  return { headSha, headRef };
}

test('an incident is declared while two PRs are ready: neither merges; the fix does', async () => {
  // Scenario 30.
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 7, 'feature/totals', { 'a.txt': 'a\n' });
    const b = await readyPr(home, remote, 8, 'feature/report', { 'b.txt': 'b\n' });
    const adapter = fakeAdapter({ 7: a, 8: b });
    await as(home, () => declare('bad-total'));
    await withHelper(home, adapter, async (client) => {
      for (const number of [7, 8]) {
        const answer = await merge(client, number);
        assert.deepEqual([answer.ok, answer.reasons], [false, [frozen('bad-total')]]);
      }
      assert.deepEqual(adapter.merges, []);
      // The caller's say-so does not name a fix.
      assert.equal((await merge(client, 8, { isFix: true, incident: { open: false } })).ok, false);

      // The director clicks Merge the fix on pull request 8: it goes, and 7 stays frozen.
      await as(home, () => fixFor('bad-total', 8));
      assert.deepEqual(await merge(client, 8), { ok: true, merged: true, sha: b.headSha, ...NONE_FOUND });
      assert.deepEqual((await merge(client, 7)).reasons, [frozen('bad-total')]);
      assert.deepEqual(adapter.merges, [{ number: 8, sha: b.headSha }]);
    });
  } finally { remote.cleanup(); }
});

// An incident kept only in the v0.1.x state clone still freezes the first merge after the upgrade:
// the gate imports the old clone before it reads the record (design section 24.5), with no
// /state/import call from the session start.
test('an incident in the old v0.1.x clone freezes a merge before any import is asked for', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 7, 'feature/totals', { 'a.txt': 'a\n' });
    const adapter = fakeAdapter({ 7: a });
    await as(home, async () => {
      const from = oldStateDir('o__p');
      await openRecord(from, { what: 'a test clone' });
      await writeEvent({ event: makeEvent({ kind: 'incident', data: { id: 'bad-total', what: 'Totals are wrong' }, now: at(500) }), dir: from, now: at(500) });
    });
    await withHelper(home, adapter, async (client) => {
      const answer = await merge(client);
      assert.deepEqual([answer.ok, answer.reasons], [false, [frozen('bad-total')]]);
      assert.deepEqual(adapter.merges, []);
    });
  } finally { remote.cleanup(); }
});

test('an unsigned fix record does not let a PR through', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 7, 'feature/totals', { 'a.txt': 'a\n' });
    const adapter = fakeAdapter({ 7: a });
    await as(home, () => { declare('bad-total'); fixFor('bad-total', 7, { unsigned: true }); });
    await withHelper(home, adapter, async (client) => {
      assert.deepEqual((await merge(client)).reasons, [frozen('bad-total')]);
      assert.deepEqual(adapter.merges, []);
    });
  } finally { remote.cleanup(); }
});

test('the director\'s click on End it lifts the freeze', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 7, 'feature/totals', { 'a.txt': 'a\n' });
    const adapter = fakeAdapter({ 7: a });
    await as(home, () => declare('bad-total'));
    await withHelper(home, adapter, async (client) => {
      assert.deepEqual((await merge(client)).reasons, [frozen('bad-total')]);
      // A plain note that says the incident ended, and an unsigned lift, change nothing.
      await as(home, () => {
        record('note', { text: 'The incident is over' });
        click({ action: 'lift-incident', incident: 'bad-total', label: 'End it' }, { unsigned: true });
      });
      assert.deepEqual((await merge(client)).reasons, [frozen('bad-total')]);
      await as(home, () => lift('bad-total'));
      assert.deepEqual(await merge(client), { ok: true, merged: true, sha: a.headSha, ...NONE_FOUND });
    });
  } finally { remote.cleanup(); }
});

test('with several incidents open, a fix of any of them lets its PR through; any other PR is told an open incident\'s id', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 7, 'feature/totals', { 'a.txt': 'a\n' });
    const b = await readyPr(home, remote, 8, 'feature/report', { 'b.txt': 'b\n' });
    const adapter = fakeAdapter({ 7: a, 8: b });
    await as(home, () => { declare('bad-total'); declare('slow-page'); fixFor('slow-page', 8); });
    await withHelper(home, adapter, async (client) => {
      const refused = await merge(client, 7);
      assert.equal(refused.ok, false);
      assert.match(refused.reasons[0], /^incident (bad-total|slow-page) is open, so only its fix may merge$/);
      assert.equal((await merge(client, 8)).ok, true);
      // The fix of one is still not a way past the other for a PR that fixes neither.
      assert.deepEqual(adapter.merges, [{ number: 8, sha: b.headSha }]);
    });
  } finally { remote.cleanup(); }
});

// A restore pull request: the default branch moved on after `release`, and the pull request puts
// the release's files back on top, with the director's step 3 click and approval on record.
async function restorePr(remote, home) {
  const work = tempFolder('wh-restore-');
  await g(work, 'init', '-q', '-b', 'main');
  await g(work, 'fetch', '-q', remote.url, 'refs/heads/main');
  await g(work, 'reset', '-q', '--hard', 'FETCH_HEAD');
  const release = await g(work, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(work, 'app.js'), 'bad\n');
  await g(work, 'commit', '-q', '-a', '-m', 'The bad release');
  await g(work, 'push', '-q', remote.url, 'HEAD:refs/heads/main');
  await g(work, 'checkout', '-q', release, '--', '.');
  await g(work, 'commit', '-q', '-m', 'Restore');
  const headSha = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'push', '-q', remote.url, 'HEAD:refs/pull/7/head');
  await as(home, () => {
    click({ action: 'runbook', step: 3, sha: release.slice(0, 12), label: 'Restore' });
    approved(7, headSha);
  });
  return { headSha, headRef: `wheelhouse-restore-${release.slice(0, 12)}` };
}

test('a restore waits behind an open incident unless it is named its fix', async () => {
  const remote = await hostWith({ 'app.js': 'release\n' });
  try {
    const home = await project(remote);
    const restore = await restorePr(remote, home);
    const adapter = fakeAdapter({ 7: restore });
    await as(home, () => declare('bad-total'));
    await withHelper(home, adapter, async (client) => {
      assert.deepEqual((await merge(client)).reasons, [frozen('bad-total')]);
      await as(home, () => fixFor('bad-total', 7));
      assert.deepEqual(await merge(client), { ok: true, merged: true, sha: restore.headSha, ...NONE_FOUND });
    }, { now: at(60 * 1000) });
  } finally { remote.cleanup(); }
});

const DAMAGED = 'the state has damaged events, so an open incident or a shown-first change can\'t be ruled out';

test('a damaged event file refuses an ordinary merge; a restore is not refused for it', async () => {
  const remote = await hostWith({ 'app.js': 'release\n' });
  try {
    const home = await project(remote);
    const restore = await restorePr(remote, home);
    const a = await readyPr(home, remote, 8, 'feature/totals', { 'a.txt': 'a\n' });
    const adapter = fakeAdapter({ 7: restore, 8: a });
    await as(home, () => {
      const folder = path.join(stateDir('o__p'), 'events');
      fs.mkdirSync(folder, { recursive: true });
      // Whatever it held (an incident, a work event, an approval) is lost to the views.
      fs.writeFileSync(path.join(folder, 'damaged.json'), '{ not json');
    });
    await withHelper(home, adapter, async (client) => {
      const refused = await merge(client, 8);
      assert.deepEqual([refused.ok, refused.reasons], [false, [DAMAGED]]);
      assert.deepEqual(await merge(client, 7), { ok: true, merged: true, sha: restore.headSha, ...NONE_FOUND });
      assert.deepEqual(adapter.merges, [{ number: 7, sha: restore.headSha }]);
    }, { now: at(60 * 1000) });
  } finally { remote.cleanup(); }
});

test('a reply-code clash is not damage: it doesn\'t refuse an ordinary merge, while a damaged event file still does', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 7, 'feature/totals', { 'a.txt': 'a\n' });
    const adapter = fakeAdapter({ 7: a });
    // Two live cards with one code and different questions.
    await as(home, () => {
      record('shown', { code: 'K7M2', question: 'First?', options: ['Yes', 'No'] });
      record('shown', { code: 'K7M2', question: 'Second?', options: ['Yes', 'No'] });
    });
    await withHelper(home, adapter, async (client) => {
      assert.deepEqual(await merge(client), { ok: true, merged: true, sha: a.headSha, ...NONE_FOUND });
      assert.deepEqual(adapter.merges, [{ number: 7, sha: a.headSha }]);
    }, { now: at(60 * 1000) });
    // The clash and a damaged event file together: the damage refuses.
    const b = await readyPr(home, remote, 8, 'feature/more', { 'b.txt': 'b\n' });
    const both = fakeAdapter({ 8: b });
    await as(home, () => {
      const folder = path.join(stateDir('o__p'), 'events');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'damaged.json'), '{ not json');
    });
    await withHelper(home, both, async (client) => {
      const refused = await merge(client, 8);
      assert.deepEqual([refused.ok, refused.reasons], [false, [DAMAGED]]);
      assert.deepEqual(both.merges, []);
    }, { now: at(60 * 1000) });
  } finally { remote.cleanup(); }
});

// Records don't cross computers (design section 24.3 items 1 and 3): an incident another computer
// declared stays in its own record, and nothing of it reaches the host for this computer to read.
test('an incident recorded on another computer counts for nothing here', async () => {
  const remote = await hostWith();
  const otherHome = shortHome();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 7, 'feature/totals', { 'a.txt': 'a\n' });
    const adapter = fakeAdapter({ 7: a });
    await as(otherHome, async () => {
      writeProject('o__p', {
        folder: path.join(otherHome, 'work'), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
      });
      makeSigningKey();
      await openTestRecord({ project: 'o__p' });
      await writeEvent({ project: 'o__p', event: makeEvent({ kind: 'incident', data: { id: 'bad-total', what: 'Totals are wrong' }, now: at(500) }) });
    });
    assert.notEqual((await realRun('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/wheelhouse-state'], { cwd: remote.url })).code, 0, 'nothing of it reached the host');
    await withHelper(home, adapter, async (client) => {
      assert.deepEqual(await merge(client), { ok: true, merged: true, sha: a.headSha, ...NONE_FOUND });
      assert.deepEqual(adapter.merges, [{ number: 7, sha: a.headSha }]);
    });
  } finally { fs.rmSync(otherHome, { recursive: true, force: true }); remote.cleanup(); }
});

// The gate counts only signatures by this computer's own key (design section 24.3 item 1): a fix click
// another enrolled computer signed, even one in this record, does not let the pull request through.
test('a fix click signed by another enrolled computer does not let a PR through; this computer\'s own does', async () => {
  const remote = await hostWith();
  const otherHome = shortHome();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 7, 'feature/totals', { 'a.txt': 'a\n' });
    const adapter = fakeAdapter({ 7: a });
    const other = await as(otherHome, () => {
      const key = makeSigningKey();
      const event = makeEvent({ kind: 'action', data: { question: 'the card as shown', label: 'Merge the fix', action: 'incident-fix', incident: 'bad-total', pr: 7 }, now: at(900) });
      return { key, event };
    });
    await as(home, () => {
      enrol({ computer: other.key.computer, publicKey: other.key.publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
      declare('bad-total');
      const file = path.join(stateDir('o__p'), eventPath(other.event));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(other.event, null, 2)}\n`);
    });
    await withHelper(home, adapter, async (client) => {
      assert.deepEqual((await merge(client)).reasons, [frozen('bad-total')]);
      assert.deepEqual(adapter.merges, []);
      await as(home, () => fixFor('bad-total', 7));
      assert.deepEqual(await merge(client), { ok: true, merged: true, sha: a.headSha, ...NONE_FOUND });
    });
  } finally { fs.rmSync(otherHome, { recursive: true, force: true }); remote.cleanup(); }
});

test('a restore merges under STOP', async () => {
  const remote = await hostWith({ 'app.js': 'release\n' });
  try {
    const home = await project(remote);
    const restore = await restorePr(remote, home);
    const adapter = fakeAdapter({ 7: restore });
    await withHelper(home, adapter, async (client) => {
      await as(home, () => setStop({ by: 'prompt' }));
      assert.deepEqual(await merge(client), { ok: true, merged: true, sha: restore.headSha, ...NONE_FOUND });
      assert.deepEqual(adapter.merges, [{ number: 7, sha: restore.headSha }]);
    }, { now: at(60 * 1000) });
  } finally { remote.cleanup(); }
});

test('a view that is not readable counts as an incident that can\'t be ruled out', () => {
  for (const views of [{}, { incidents: {} }, { incidents: { open: 'yes' } }, { incidents: null }]) {
    assert.deepEqual(incidentFor(views, 7), { open: true, isFix: false });
  }
  assert.deepEqual(incidentFor({ incidents: { open: [] } }, 7), { open: false });
  assert.deepEqual(incidentFor({ incidents: { open: [{ id: 'a' }] } }, 7), { open: true, id: 'a', isFix: false });
});

test('a crafted branch name never names another work', () => {
  const views = { work: { 'export-csv': { approval: { hash: H1, shownFirst: true, lane: 'small' } }, x: { approval: { hash: H1, shownFirst: true, lane: 'small' } } } };
  const needed = (headRef) => shownFirstNeeded({ views, headRef, paths: [], config: { flagFiles: [] } });
  for (const headRef of ['feature/export-csv', 'feature/export-csv/slice-1', 'feature/x']) assert.equal(needed(headRef), true, headRef);
  for (const headRef of ['feature/Export-CSV', 'feature/x/a/b', 'feature/../x', 'feature/', 'feature/export-csv/', 'feature/x\n', 'features/x', 'xfeature/x', `feature/${'x'.repeat(41)}`, 'feature/__proto__', 'feature/constructor', undefined, null]) {
    assert.equal(needed(headRef), false, String(headRef));
  }
});

test('a shown-first small change needs the director\'s approval', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 7, 'feature/tweak', { 'src/a.js': 'a\n' });
    const adapter = fakeAdapter({ 7: a });
    await as(home, () => approveWork({ id: 'tweak', lane: 'small', shownFirst: true }));
    await withHelper(home, adapter, async (client) => {
      const refused = await merge(client, 7, { approvalRequired: false });
      assert.deepEqual([refused.ok, refused.reasons], [false, [`no approval of ${short(a.headSha)}`]]);
      // What is missing, in a form the foreman can wait on (R117).
      assert.deepEqual(refused.needs, { approval: { pr: 7, commit: a.headSha } });
      await as(home, () => approved(7, a.headSha));
      assert.deepEqual(await merge(client, 7), { ok: true, merged: true, sha: a.headSha, ...NONE_FOUND });
    });
  } finally { remote.cleanup(); }
});

test('a branch that names no approved work, or work approved without shown-first, adds nothing', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const quiet = await readyPr(home, remote, 8, 'feature/quiet', { 'b.txt': 'b\n' });
    const other = await readyPr(home, remote, 9, 'fix/thing', { 'c.txt': 'c\n' });
    const unapproved = await readyPr(home, remote, 10, 'feature/waiting', { 'd.txt': 'd\n' });
    const adapter = fakeAdapter({ 8: quiet, 9: other, 10: unapproved });
    await as(home, () => {
      approveWork({ id: 'quiet', lane: 'small', shownFirst: false });
      record('work', { id: 'waiting', title: 'Waiting', lane: 'small', visible: true, dependsOn: [], doc: { path: 'd.md', hash: H1 } });
      // An unsigned approval counts for nothing.
      click({ action: 'approve-work', work: 'waiting', lane: 'small', hash: H1, shownFirst: true, label: 'Approve' }, { unsigned: true });
    });
    await withHelper(home, adapter, async (client) => {
      for (const number of [8, 9, 10]) assert.equal((await merge(client, number)).ok, true, `pull request ${number}`);
    });
  } finally { remote.cleanup(); }
});

test('shown-first is kept once any signed approval of the work said it, whatever its lane or document (R120)', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const seen = await readyPr(home, remote, 7, 'feature/seen', { 'a.txt': 'a\n' });
    const tweak = await readyPr(home, remote, 8, 'feature/tweak', { 'b.txt': 'b\n' });
    const adapter = fakeAdapter({ 7: seen, 8: tweak });
    await as(home, () => {
      // Shown first in another lane than the work's: the approval does not count for the work, but the wish does.
      record('work', { id: 'seen', title: 'Seen', lane: 'small', visible: true, dependsOn: [], doc: { path: 'd.md', hash: H1 } });
      click({ action: 'approve-work', work: 'seen', lane: 'feature', hash: H1, shownFirst: true, label: 'Approve' });
      // Approved small and shown first, then moved to the feature lane with its approval there pending.
      approveWork({ id: 'tweak', lane: 'small', shownFirst: true });
      record('work', { id: 'tweak', title: 'Tweak', lane: 'feature', visible: true, dependsOn: [], doc: { path: 'd.md', hash: H1 } });
    });
    await withHelper(home, adapter, async (client) => {
      for (const [number, pr] of [[7, seen], [8, tweak]]) {
        const refused = await merge(client, number);
        assert.deepEqual([refused.ok, refused.reasons], [false, [`no approval of ${short(pr.headSha)}`]], `pull request ${number}`);
      }
    });
  } finally { remote.cleanup(); }
});

test('a flag-off slice merges without it; the switch-on PR needs it', async () => {
  const remote = await hostWith(flagConfig(['src/flags.js']));
  try {
    const home = await project(remote);
    const slice = await readyPr(home, remote, 7, 'feature/export-csv/slice-1', { 'src/a.js': 'a\n' });
    const whole = await readyPr(home, remote, 8, 'feature/export-csv', { 'src/b.js': 'b\n' });
    const switchOn = await readyPr(home, remote, 9, 'feature/export-csv/switch-on', { 'src/flags.js': 'export const csv = true;\n' });
    const adapter = fakeAdapter({ 7: slice, 8: whole, 9: switchOn });
    await as(home, () => approveWork({ lane: 'feature', shownFirst: true }));
    await withHelper(home, adapter, async (client) => {
      assert.equal((await merge(client, 7)).ok, true);
      assert.equal((await merge(client, 8)).ok, true);
      const refused = await merge(client, 9, { approvalRequired: false });
      assert.deepEqual([refused.ok, refused.reasons], [false, [`no approval of ${short(switchOn.headSha)}`]]);
      await as(home, () => approved(9, switchOn.headSha));
      assert.equal((await merge(client, 9)).ok, true);
      assert.deepEqual(adapter.merges.map((m) => m.number), [7, 8, 9]);
    });
  } finally { remote.cleanup(); }
});

test('shown-first work in a project with no flag files needs approval on every PR', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const first = await readyPr(home, remote, 7, 'feature/export-csv/slice-1', { 'src/a.js': 'a\n' });
    const second = await readyPr(home, remote, 8, 'feature/export-csv/slice-2', { 'src/b.js': 'b\n' });
    const adapter = fakeAdapter({ 7: first, 8: second });
    await as(home, () => approveWork({ lane: 'feature', shownFirst: true }));
    await withHelper(home, adapter, async (client) => {
      for (const [number, pr] of [[7, first], [8, second]]) {
        const refused = await merge(client, number);
        assert.deepEqual([refused.ok, refused.reasons], [false, [`no approval of ${short(pr.headSha)}`]]);
      }
      await as(home, () => { approved(7, first.headSha); approved(8, second.headSha); });
      assert.equal((await merge(client, 7)).ok, true);
      assert.equal((await merge(client, 8)).ok, true);
    });
  } finally { remote.cleanup(); }
});

test('feature work that is not shown first merges without approval, flag files or none', async () => {
  const remote = await hostWith(flagConfig(['src/flags.js']));
  try {
    const home = await project(remote);
    const switchOn = await readyPr(home, remote, 7, 'feature/export-csv', { 'src/flags.js': 'export const csv = true;\n' });
    const adapter = fakeAdapter({ 7: switchOn });
    await as(home, () => approveWork({ lane: 'feature', shownFirst: false }));
    await withHelper(home, adapter, async (client) => {
      assert.equal((await merge(client, 7)).ok, true);
    });
  } finally { remote.cleanup(); }
});

// A red main line's incident (Archon design, section 7.7): its fix is the pull request the helper itself recorded a
// fix-main run opening, for that incident, at that head; nothing a caller says makes a pull request the fix.
const RED = { id: 'red-main-0123456789', what: 'red', at: 'x', fixes: [], kind: 'red-main', suspect: 7, work: 'fix-main-red-main-0123456789' };
const FIX_HEAD = 'f'.repeat(40);
const OPENED = { runId: 'run-9', head: FIX_HEAD, showFirst: false, work: RED.work, level: 1, lane: 'fix-main', incident: RED.id };
const CALL = { runId: 'run-9', pr: 9, head: FIX_HEAD, incident: RED.id };

test('the fix of a red-main incident is the helper\'s own record of the run, at its head', () => {
  const views = { incidents: { open: [RED] } };
  const fix = fixOfRun({ views, opened: OPENED, call: CALL, headSha: FIX_HEAD });
  assert.deepEqual(fix, { incident: RED.id, pr: 9, head: FIX_HEAD });
  assert.deepEqual(incidentFor(views, 9, { fix }), { open: true, id: RED.id, isFix: true });
  // Another pull request is refused while the red-main incident is open, fix or no fix.
  assert.deepEqual(incidentFor(views, 8, { fix }), { open: true, id: RED.id, isFix: false });
  assert.deepEqual(incidentFor(views, 8), { open: true, id: RED.id, isFix: false });
});

test('a fix whose head moved since the run opened it, or that another run opened, is not the fix', () => {
  const views = { incidents: { open: [RED] } };
  assert.equal(fixOfRun({ views, opened: OPENED, call: CALL, headSha: 'e'.repeat(40) }), null, 'the head moved');
  assert.equal(fixOfRun({ views, opened: { ...OPENED, head: 'e'.repeat(40) }, call: CALL, headSha: FIX_HEAD }), null);
  assert.equal(fixOfRun({ views, opened: { ...OPENED, runId: 'run-8' }, call: CALL, headSha: FIX_HEAD }), null, 'another run');
  assert.equal(fixOfRun({ views, opened: { ...OPENED, lane: 'quick' }, call: CALL, headSha: FIX_HEAD }), null, 'not a fix-main run');
  assert.equal(fixOfRun({ views, opened: { ...OPENED, incident: 'red-main-9999999999' }, call: CALL, headSha: FIX_HEAD }), null, 'another incident');
  assert.equal(fixOfRun({ views, opened: null, call: CALL, headSha: FIX_HEAD }), null, 'no run of the helper\'s opened it');
  assert.equal(fixOfRun({ views: { incidents: { open: [] } }, opened: OPENED, call: CALL, headSha: FIX_HEAD }), null, 'the incident is closed');
  assert.equal(fixOfRun({ views: { incidents: { open: [{ ...RED, kind: undefined }] } }, opened: OPENED, call: CALL, headSha: FIX_HEAD }), null, 'the director\'s own incident is fixed only by their click');
  // A fix that names another incident than the open one is no fix of it.
  assert.deepEqual(incidentFor({ incidents: { open: [RED] } }, 9, { fix: { incident: 'bad-total', pr: 9, head: FIX_HEAD } }), { open: true, id: RED.id, isFix: false });
});

test('/merge with a fix in its body is not taken as the fix of a red main line', async () => {
  const remote = await hostWith();
  try {
    const home = await project(remote);
    const a = await readyPr(home, remote, 9, 'wh/fix', { 'a.txt': 'a\n' });
    const adapter = fakeAdapter({ 9: a });
    await as(home, () => record('incident', { id: RED.id, what: 'red', kind: 'red-main', suspect: 7, work: RED.work }));
    await withHelper(home, adapter, async (client) => {
      for (const extra of [{}, { fix: { incident: RED.id, pr: 9, head: a.headSha } }, { fixCall: { runId: 'run-9', pr: 9, head: a.headSha, incident: RED.id } }]) {
        const answer = await merge(client, 9, extra);
        assert.deepEqual([answer.ok, answer.reasons], [false, [frozen(RED.id)]], JSON.stringify(extra));
      }
      assert.deepEqual(adapter.merges, []);
    });
  } finally { remote.cleanup(); }
});

test('while the director\'s own incident is open too, the red-main fix is held like any other pull request', () => {
  const frozen = { id: 'bad-total', what: 'Totals are wrong', at: 'x', fixes: [] };
  for (const open of [[RED, frozen], [frozen, RED]]) {
    const views = { incidents: { open } };
    const fix = fixOfRun({ views, opened: OPENED, call: CALL, headSha: FIX_HEAD });
    assert.equal(incidentFor(views, 9, { fix }).isFix, false, 'only the director\'s click lets a pull request past their incident');
  }
  // The director's named fix still goes through their own incident when only it is open.
  assert.equal(incidentFor({ incidents: { open: [{ ...frozen, fixes: [9] }] } }, 9).isFix, true);
});
