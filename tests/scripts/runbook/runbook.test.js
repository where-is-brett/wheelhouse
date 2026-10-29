// tests/scripts/runbook/runbook.test.js
// The runbook's five steps (design section 12.7), served by the host helper,
// and runbook.js, the only command STOP lets through.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHelper, envForConnection, PUSH_REFUSALS, RESTORE_RETIRED } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { computerId, stateDir } from '../../../scripts/lib/paths.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { setStop, stopState } from '../../../scripts/lib/stop.js';
import { writeKey } from '../../../scripts/host/keys.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { eventPath, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, sign } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { parseArgs, runbook, USAGE } from '../../../scripts/runbook/runbook.js';
import { fakeEngine, loadRecordings } from '../../../scripts/engine/fake.js';
import { EventEmitter } from 'node:events';
import { decide as promptRecord } from '../../../scripts/hooks/prompt-record.js';
import { approvalLine, runbookLine } from '../../../scripts/state/card-lines.js';
import { listEvents } from '../../../scripts/state/events.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { matchingBody } from '../../helpers/provenance.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const NOW = new Date('2026-10-18T12:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NEEDS_CLICK = 'this step needs the director\'s click on its card';
const NO_HARM = 'This project has defined no live harm to contain';
const SELF = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'runbook', 'runbook.js');

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// A host with three releases on main (c1, c2, head) and a side commit that never reached main.
async function scenario({ headFiles = { 'a.txt': '3\n' }, headRemove = [], firstFiles = { 'a.txt': '1\n', 'release.txt': 'one\n' }, fillers = 0, host = 'github', connection } = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-rb-'));
  const s = { remote, home, work };
  await g(work, 'init', '-q', '-b', 'main');
  write(work, firstFiles);
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Release one');
  s.c1 = await g(work, 'rev-parse', 'HEAD');
  write(work, { 'a.txt': '2\n', 'b.txt': 'b\n' });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Release two');
  s.c2 = await g(work, 'rev-parse', 'HEAD');
  for (let i = 0; i < fillers; i += 1) {
    write(work, { 'filler.txt': `${i}\n` });
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', `Filler ${i}`);
  }
  for (const gone of headRemove) fs.rmSync(path.join(work, gone), { force: true });
  write(work, headFiles);
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Release three');
  s.head = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await g(work, 'push', '-q', 'origin', 'main');
  await g(work, 'checkout', '-q', '-b', 'side', s.c1);
  write(work, { 'side.txt': 's\n' });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Side');
  s.side = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'push', '-q', 'origin', 'side');
  await g(work, 'checkout', '-q', 'main');
  await as(home, async () => {
    writeProject('o__p', {
      folder: path.join(home, 'work'), remoteUrl: remote.url, host, repo: 'o/p', connection: connection ?? { host, mode: 'quick', project: 'o/p' },
    });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: () => new Date(NOW.getTime() - HOUR) })).taken, true);
  });
  s.cleanup = () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true }); };
  return s;
}

// The director's click on a runbook card, signed here, `ms` before NOW.
function click(step, { sha, ms = MIN, tamper = false } = {}) {
  const data = { action: 'runbook', step, ...(sha ? { sha } : {}), question: 'Run it?', label: 'Run' };
  const event = sign({ v: 1, id: crypto.randomUUID(), at: new Date(NOW.getTime() - ms).toISOString(), computer: computerId(), kind: 'action', data });
  if (tamper) event.data.step = step === 5 ? 4 : step + 1;
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
function record(kind, data, ms = 0) {
  const event = makeEvent({ kind, data, now: () => new Date(NOW.getTime() - ms) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}

function fakeAdapter(overrides = {}) {
  const merges = [];
  const opened = [];
  return {
    merges,
    opened,
    defaultBranch: async () => 'main',
    openPr: async (args) => { opened.push(args); return { number: 7, url: 'https://example.invalid/pull/7' }; },
    prState: async () => ({ headSha: 'f'.repeat(40), headRef: 'x', baseRef: 'main', mergeable: 'yes', state: 'open' }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
    ...overrides,
  };
}

async function viaHelper(s, adapter, fn, extra = {}) {
  await as(s.home, async () => {
    const helper = await startHelper({
      run: hostGuard,
      address: testAddress(s.home), adapterFor: async () => adapter, envFor: async () => ({}), now: () => NOW, ...extra,
    });
    try { await fn(helperClient({ address: helper.address }), helper); } finally { await helper.close(); }
  });
}

const restoreBranch = (sha) => `wheelhouse-restore-${sha.slice(0, 12)}`;
const treeOf = (dir, rev) => g(dir, 'rev-parse', `${rev}^{tree}`);

test('each step but the first is refused without a fresh click on its card', async () => {
  const s = await scenario({ connection: { host: 'github', mode: 'quick', project: 'o/p' } });
  try {
    await viaHelper(s, fakeAdapter(), async (client) => {
      const base = { project: 'o__p' };
      for (const [name, call] of Object.entries({
        cutAccess: () => client.runbook.cutAccess(base),
        restoreMain: () => client.runbook.restoreMain({ ...base, sha: s.c1 }),
        restoreState: () => client.runbook.restoreState(base),
        contain: () => client.runbook.contain(base),
      })) {
        assert.deepEqual(await call(), { ok: false, refused: NEEDS_CLICK }, name);
      }
      // A click for another step, or one that does not verify, is no click.
      await as(s.home, async () => { click(5); click(4, { tamper: true }); });
      assert.equal((await client.runbook.restoreState(base)).refused, NEEDS_CLICK);
      assert.equal(await as(s.home, () => stopState().on), false);
      assert.equal((await client.stop({})).ok, true);
    });
  } finally { s.cleanup(); }
});

test('a click older than ten minutes no longer counts', async () => {
  const s = await scenario();
  try {
    await as(s.home, async () => { click(5, { ms: 11 * MIN }); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      assert.equal((await client.runbook.contain({ project: 'o__p' })).refused, NEEDS_CLICK);
      await as(s.home, async () => { click(5, { ms: 9 * MIN }); });
      assert.equal((await client.runbook.contain({ project: 'o__p' })).ok, true);
    });
  } finally { s.cleanup(); }
});

test('cut-access names the project\'s own installation of the app, on its account (ruling R83)', async () => {
  for (const [connection, id] of [
    [{ host: 'github', mode: 'narrow', project: 'o/p', installationId: 6161 }, 6161],
    [{ host: 'github', mode: 'narrow', project: 'o/p' }, 5151],
  ]) {
    const s = await scenario({ connection });
    try {
      await as(s.home, async () => {
        writeKey('github-app', { clientId: 'Iv1.x', installationId: 4242, installations: { first: 4242, o: 5151 }, accessToken: 'ghu_abcdefghijklmnopqrstuvwxyz0123456789' });
        click(2);
      });
      await viaHelper(s, fakeAdapter(), async (client) => {
        const answer = await client.runbook.cutAccess({ project: 'o__p' });
        assert.equal(answer.ok, true, JSON.stringify(answer));
        assert.equal(answer.url, `https://github.com/settings/installations/${id}`);
      }, { fetch: async () => { throw new Error('no host in tests'); } });
    } finally { s.cleanup(); }
  }
});

test('cut-access on the narrow GitHub connection deletes the key file and names the installation page', async () => {
  const s = await scenario({ connection: { host: 'github', mode: 'narrow', project: 'o/p' } });
  const secret = 'ghu_abcdefghijklmnopqrstuvwxyz0123456789';
  const fetches = [];
  try {
    await as(s.home, async () => {
      writeKey('github-app', { clientId: 'Iv1.x', installationId: 4242, accessToken: secret, refreshToken: 'ghr_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' });
      click(2);
    });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.cutAccess({ project: 'o__p' });
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.equal(answer.url, 'https://github.com/settings/installations/4242');
      assert.match(answer.message, /deleted/i);
      assert.match(answer.message, /suspend or uninstall/i);
      assert.doesNotMatch(JSON.stringify(answer), /ghu_|ghr_/);
    }, { fetch: async (...a) => { fetches.push(a); throw new Error('no host in tests'); } });
    assert.equal(fs.existsSync(path.join(s.home, 'keys', 'github-app.json')), false);
    assert.deepEqual(fetches, []);
  } finally { s.cleanup(); }
});

test('cut-access on the narrow GitLab connection revokes the project key through GitLab, then deletes its file', async () => {
  const s = await scenario({ host: 'gitlab', connection: { host: 'gitlab', mode: 'narrow', project: 'o/p', projectId: 5, baseUrl: 'https://gitlab.example.com' } });
  const token = 'glpat-abcdefghijklmnopqrst1234';
  const file = () => path.join(s.home, 'keys', 'gitlab-project-5.json');
  const calls = [];
  const answers = [204, 500];
  const fetch = async (url, options) => {
    calls.push({ url, method: options.method, header: options.headers['PRIVATE-TOKEN'] });
    const status = answers.shift();
    return { status, text: async () => '' };
  };
  try {
    await as(s.home, async () => {
      writeKey('gitlab-project-5', { kind: 'project-key', token, expiresAt: '2027-01-01' });
      click(2);
    });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const done = await client.runbook.cutAccess({ project: 'o__p' });
      assert.equal(done.ok, true, JSON.stringify(done));
      assert.deepEqual(calls, [{ url: 'https://gitlab.example.com/api/v4/personal_access_tokens/self', method: 'DELETE', header: token }]);
      assert.equal(fs.existsSync(file()), false, 'the file goes after the host call succeeded');
      assert.doesNotMatch(JSON.stringify(done), /glpat/);

      // When GitLab refuses, the file stays and the director is told where to revoke it.
      await as(s.home, async () => { writeKey('gitlab-project-5', { kind: 'project-key', token, expiresAt: '2027-01-01' }); click(2); });
      const failed = await client.runbook.cutAccess({ project: 'o__p' });
      assert.equal(failed.ok, false);
      assert.equal(failed.url, 'https://gitlab.example.com/o/p/-/settings/access_tokens');
      assert.equal(fs.existsSync(file()), true);
      assert.doesNotMatch(JSON.stringify(failed), /glpat/);
    }, { fetch });
  } finally { s.cleanup(); }
});

test('cut-access on the quick connection changes nothing and names the page where only the director can revoke', async () => {
  const s = await scenario();
  try {
    await as(s.home, async () => { click(2); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.cutAccess({ project: 'o__p' });
      assert.equal(answer.ok, true);
      assert.equal(answer.url, 'https://github.com/settings/applications');
      assert.match(answer.message, /only you can/i);
    }, { fetch: async () => { throw new Error('no host in tests'); } });
  } finally { s.cleanup(); }
});

test('restore-main makes a pull request whose files are the chosen commit\'s', async () => {
  const s = await scenario();
  const adapter = fakeAdapter();
  try {
    await as(s.home, async () => { click(3, { sha: s.c1.slice(0, 12) }); });
    await viaHelper(s, adapter, async (client) => {
      const answer = await client.runbook.restoreMain({ project: 'o__p', sha: s.c1 });
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.equal(answer.number, 7);
      assert.equal(answer.branch, restoreBranch(s.c1));
      assert.deepEqual(adapter.opened.map((o) => [o.head, o.base]), [[restoreBranch(s.c1), 'main']]);
      const tip = await g(s.remote.url, 'rev-parse', `refs/heads/${restoreBranch(s.c1)}`);
      assert.equal(await treeOf(s.remote.url, tip), await treeOf(s.remote.url, s.c1));
      assert.equal(await g(s.remote.url, 'rev-parse', `${tip}^`), s.head, 'on top of the default branch\'s head');
      assert.equal(await g(s.remote.url, 'rev-parse', 'refs/heads/main'), s.head, 'main itself is untouched');
    });
  } finally { s.cleanup(); }
});

test('restore-main refuses a commit that is not on the default branch, or is not earlier than its head', async () => {
  const s = await scenario();
  const adapter = fakeAdapter();
  try {
    await as(s.home, async () => {
      for (const sha of [s.side, s.head, s.c2, 'a'.repeat(40)]) click(3, { sha: sha.slice(0, 12) });
    });
    await viaHelper(s, adapter, async (client) => {
      const base = { project: 'o__p' };
      assert.match((await client.runbook.restoreMain({ ...base, sha: s.side })).refused, /not an earlier commit of the default branch/);
      assert.match((await client.runbook.restoreMain({ ...base, sha: s.head })).refused, /not an earlier commit of the default branch/);
      assert.match((await client.runbook.restoreMain({ ...base, sha: 'a'.repeat(40) })).refused, /not an earlier commit of the default branch|not found/);
      assert.match((await client.runbook.restoreMain({ ...base, sha: s.c2.slice(0, 12) })).refused, /full 40-character/);
      // The click names another commit.
      assert.equal((await client.runbook.restoreMain({ ...base, sha: s.c1 })).refused, NEEDS_CLICK);
      assert.deepEqual(adapter.opened, []);
    });
    assert.equal(await g(s.remote.url, 'for-each-ref', 'refs/heads/wheelhouse-restore-*'), '');
  } finally { s.cleanup(); }
});

// The restore branch on the host, as a pull request (number 7) the host can fetch.
async function openedRestore(s, client, sha) {
  const answer = await client.runbook.restoreMain({ project: 'o__p', sha });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const tip = await g(s.remote.url, 'rev-parse', `refs/heads/${restoreBranch(sha)}`);
  await g(s.remote.url, 'update-ref', 'refs/pull/7/head', tip);
  return tip;
}

test('the restore pull request merges under STOP with the director\'s approval and CI; no other does', async () => {
  const s = await scenario();
  const adapter = fakeAdapter();
  try {
    await as(s.home, async () => { click(3, { sha: s.c1.slice(0, 12) }); });
    await viaHelper(s, adapter, async (client) => {
      const tip = await openedRestore(s, client, s.c1);
      adapter.prState = async () => ({ headSha: tip, headRef: restoreBranch(s.c1), baseRef: 'main', mergeable: 'yes', state: 'open' });
      await as(s.home, async () => { setStop({ by: 'runbook', now: () => NOW }); });
      const merge = () => client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });

      const waiting = await merge();
      assert.equal(waiting.ok, false);
      assert.deepEqual(waiting.reasons, [`no approval of ${tip.slice(0, 7)}`], 'no review is asked for; STOP is not in the way');
      await as(s.home, async () => { record('approval', { pr: 7, commit: tip }); });
      assert.deepEqual(await merge(), { ok: true, merged: true, sha: tip, guardrailPaths: [], criticalAreas: [] });
      assert.deepEqual(adapter.merges, [{ number: 7, sha: tip }]);

      // CI still counts.
      adapter.ciState = async (sha) => ({ sha, state: 'failure' });
      assert.deepEqual((await merge()).reasons, [`CI has not passed on ${tip.slice(0, 7)}`]);
      adapter.ciState = async (sha) => ({ sha, state: 'success' });

      // The same head on any other branch name stays stopped; so does the caller's own `stop`.
      adapter.prState = async () => ({ headSha: tip, headRef: 'feature', baseRef: 'main', mergeable: 'yes', state: 'open' });
      assert.ok((await merge()).reasons.includes('All stop is on'));
      adapter.prState = async () => ({ headSha: tip, headRef: restoreBranch(s.c1), baseRef: 'main', mergeable: 'yes', state: 'open' });
      assert.ok((await client.merge({ project: 'o__p', number: 7, stop: true, bypass: false })).reasons.includes('All stop is on'));
      // Through the runbook's own route as well.
      assert.equal((await client.runbook.restoreMerge({ project: 'o__p', number: 7 })).ok, true);
    });
  } finally { s.cleanup(); }
});

test('a restore branch whose tree is not the chosen commit\'s stays stopped', async () => {
  const s = await scenario();
  const adapter = fakeAdapter();
  try {
    await as(s.home, async () => { click(3, { sha: s.c1.slice(0, 12) }); });
    await viaHelper(s, adapter, async (client) => {
      await openedRestore(s, client, s.c1);
      // Someone adds a file to the branch on the host after the restore was opened.
      await g(s.work, 'fetch', '-q', 'origin', `${restoreBranch(s.c1)}`);
      await g(s.work, 'checkout', '-q', '-b', 'tampered', 'FETCH_HEAD');
      write(s.work, { 'extra.txt': 'x\n' });
      await g(s.work, 'add', '-A');
      await g(s.work, 'commit', '-q', '-m', 'Extra');
      const bad = await g(s.work, 'rev-parse', 'HEAD');
      await g(s.work, 'push', '-q', 'origin', `${bad}:refs/pull/7/head`);
      adapter.prState = async () => ({ headSha: bad, headRef: restoreBranch(s.c1), baseRef: 'main', mergeable: 'yes', state: 'open' });
      await as(s.home, async () => { setStop({ by: 'runbook', now: () => NOW }); record('approval', { pr: 7, commit: bad }); });
      const merge = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
      assert.equal(merge.ok, false);
      assert.ok(merge.reasons.includes('All stop is on'), JSON.stringify(merge));
      assert.deepEqual(adapter.merges, []);
    });
  } finally { s.cleanup(); }
});

test('the step 3 click lets a restore merge pass STOP for twenty-four hours, and no longer', async () => {
  const s = await scenario();
  const adapter = fakeAdapter();
  try {
    await as(s.home, async () => { click(3, { sha: s.c1.slice(0, 12), ms: 5 * MIN }); });
    await viaHelper(s, adapter, async (client) => {
      const tip = await openedRestore(s, client, s.c1);
      adapter.prState = async () => ({ headSha: tip, headRef: restoreBranch(s.c1), baseRef: 'main', mergeable: 'yes', state: 'open' });
      await as(s.home, async () => { setStop({ by: 'runbook', now: () => NOW }); record('approval', { pr: 7, commit: tip }); });
      const merge = () => client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
      // Click 5 minutes old: the opening passed above. Replace it by clicks of other ages.
      const clicks = path.join(stateDir('o__p'), 'events');
      await as(s.home, async () => {
        fs.rmSync(clicks, { recursive: true, force: true });
        record('approval', { pr: 7, commit: tip });
        click(3, { sha: s.c1.slice(0, 12), ms: 25 * HOUR });
      });
      assert.ok((await merge()).reasons.includes('All stop is on'), 'twenty-five hours is too long');
      await as(s.home, async () => { click(3, { sha: 'a'.repeat(12), ms: HOUR }); click(3, { sha: s.c1.slice(0, 12), ms: 23 * HOUR, tamper: true }); });
      assert.ok((await merge()).reasons.includes('All stop is on'), 'another commit, or a click that does not verify, does not count');
      await as(s.home, async () => { click(3, { sha: s.c1.slice(0, 12), ms: 23 * HOUR }); });
      assert.equal((await merge()).ok, true);
    });
  } finally { s.cleanup(); }
});

test('restore-state says no backup of the records is kept, and changes nothing', async () => {
  const s = await scenario();
  try {
    await as(s.home, async () => { click(4); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.restoreState({ project: 'o__p' });
      assert.equal(answer.ok, false);
      assert.equal(answer.refused, RESTORE_RETIRED);
    });
  } finally { s.cleanup(); }
});

test('contain runs the configured command from the default branch, or says none is defined', async () => {
  const config = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], runbook: { contain: { describe: 'Withhold the figures', command: ['node', 'contain.js', 'now'] } } };
  const s = await scenario({
    headFiles: {
      '.claude/wheelhouse.json': `${JSON.stringify(config)}\n`,
      'contain.js': 'const fs = require("node:fs"); console.log("args=" + process.argv.slice(2) + " data=" + fs.readFileSync("data.txt", "utf8").trim() + " cwd=" + require("node:path").basename(process.cwd()));\n',
      'data.txt': 'from-main\n',
    },
  });
  const plain = await scenario();
  try {
    await as(s.home, async () => { click(5); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.contain({ project: 'o__p' });
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.match(answer.output, /args=now data=from-main cwd=contain/);
      assert.match(answer.message, /Withhold the figures/);
      assert.equal(fs.existsSync(path.join(s.home, 'projects', 'o__p', 'contain', 'data.txt')), true);
    });
    await as(plain.home, async () => { click(5); });
    await viaHelper(plain, fakeAdapter(), async (client) => {
      const answer = await client.runbook.contain({ project: 'o__p' });
      assert.deepEqual([answer.ok, answer.message], [true, NO_HARM]);
    });
  } finally { s.cleanup(); plain.cleanup(); }
});

test('contain reports a command that fails', async () => {
  const config = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], runbook: { contain: { describe: 'Stop it', command: ['node', '-e', 'process.exit(3)'] } } };
  const s = await scenario({ headFiles: { '.claude/wheelhouse.json': `${JSON.stringify(config)}\n` } });
  try {
    await as(s.home, async () => { click(5); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.contain({ project: 'o__p' });
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /exit code 3/);
    });
  } finally { s.cleanup(); }
});

test('/runbook/candidates lists the last ten merges, newest first, without the head itself', async () => {
  const s = await scenario();
  try {
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.candidates({ project: 'o__p' });
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.deepEqual(answer.candidates.map((c) => [c.sha, c.sha12, c.title]), [
        [s.c2, s.c2.slice(0, 12), 'Release two'],
        [s.c1, s.c1.slice(0, 12), 'Release one'],
      ]);
      assert.match(answer.candidates[0].at, /^\d{4}-\d{2}-\d{2}T/);
    });
  } finally { s.cleanup(); }
});

test('the runbook routes answer under STOP', async () => {
  const s = await scenario();
  try {
    await as(s.home, async () => { for (const step of [2, 3, 4, 5]) click(step, { sha: s.c1.slice(0, 12) }); setStop({ by: 'prompt', now: () => NOW }); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const base = { project: 'o__p' };
      assert.equal((await client.runbook.cutAccess(base)).ok, true);
      assert.equal((await client.runbook.restoreMain({ ...base, sha: s.c1 })).ok, true);
      assert.equal((await client.runbook.contain(base)).ok, true);
      assert.equal((await client.runbook.candidates(base)).ok, true);
      assert.notEqual((await client.runbook.restoreState(base)).refused, 'All stop is on');
      assert.equal((await client.stop({})).ok, true);
      // Other writes stay refused.
      assert.deepEqual(await client.openPr({ ...base, head: 'feature', base: 'main', title: 't', body: 'b' }), { ok: false, refused: 'All stop is on' });
    });
  } finally { s.cleanup(); }
});

test('runbook.js refuses bad arguments with a usage line, before asking the helper', async () => {
  const calls = [];
  const client = { stop: async () => { calls.push('stop'); return { ok: true }; }, runbook: new Proxy({}, { get: (_t, name) => async () => { calls.push(name); return { ok: true, message: 'ok' }; } }) };
  const bad = [
    [], ['0'], ['6'], ['x'], ['1.5'], ['-1'], ['01'], ['2', 'extra'], ['3'], ['3', 'abc'], ['3', 'A'.repeat(12)], ['3', 'a'.repeat(11)],
    ['3', 'a'.repeat(41)], ['3', 'merge'], ['3', 'merge', '0'], ['3', 'merge', '-2'], ['3', 'merge', '1.5'], ['3', 'merge', '7', 'x'],
    ['1', 'merge', '7'], ['4', 'a'.repeat(12)], ['5', 'a'.repeat(40)], ['3', `${'a'.repeat(12)}; rm -rf`],
  ];
  for (const argv of bad) {
    assert.equal(parseArgs(argv).ok, false, JSON.stringify(argv));
    const out = await runbook({ argv, cwd: os.tmpdir(), client });
    assert.equal(out.code, 1, JSON.stringify(argv));
    assert.equal(out.text, USAGE);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(parseArgs(['3', 'a'.repeat(12)]), { ok: true, step: 3, sha: 'a'.repeat(12) });
  assert.deepEqual(parseArgs(['3', 'merge', '7']), { ok: true, step: 3, merge: 7 });
  const spawned = await run('node', [SELF, '9']);
  assert.notEqual(spawned.code, 0);
  assert.match(`${spawned.stdout}${spawned.stderr}`, /Usage/);
});

test('runbook.js asks the helper and prints its plain answer', async () => {
  const s = await scenario();
  try {
    await as(s.home, async () => { click(5); });
    fs.mkdirSync(path.join(s.home, 'work'), { recursive: true });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const out = await as(s.home, () => runbook({ argv: ['5'], cwd: path.join(s.home, 'work'), client }));
      assert.deepEqual(out, { code: 0, text: NO_HARM });
      const refused = await as(s.home, () => runbook({ argv: ['4'], cwd: path.join(s.home, 'work'), client }));
      assert.deepEqual(refused, { code: 1, text: NEEDS_CLICK });
      const lost = await as(s.home, () => runbook({ argv: ['5'], cwd: os.tmpdir(), client }));
      assert.equal(lost.code, 1);
      // Step 1 needs no click.
      assert.equal((await as(s.home, () => runbook({ argv: ['1'], cwd: path.join(s.home, 'work'), client }))).code, 0);
      assert.equal(await as(s.home, () => stopState().on), true, 'the helper set it');
    });
  } finally { s.cleanup(); }
});

test("the runbook's first step cancels every run", async () => {
  const s = await scenario();
  const engine = fakeEngine({ recordings: loadRecordings(path.join(import.meta.dirname, '..', '..', 'fixtures', 'engine')) });
  const { runId } = engine.start({ recording: 'quick-approved', running: true });
  // The wake process is a stand-in that runs nothing; no process is listed, so nothing is ended or waited on.
  const spawn = () => Object.assign(new EventEmitter(), { pid: 7000, kill() { setImmediate(() => this.emit('exit', null, 'SIGTERM')); return true; } });
  const engineStopWith = { list: async () => [], cwds: async () => new Map(), kill: () => assert.fail('nothing to end'), sleep: async () => {} };
  try {
    await viaHelper(s, fakeAdapter(), async (client) => {
      const out = await as(s.home, () => runbook({ argv: ['1'], cwd: path.join(s.home, 'work'), client }));
      assert.equal(out.code, 0);
      assert.match(out.text, /^All stop is on\. Nothing more is written to the host until the director lifts it\.\nAll stop cancelled 1 run of the engine\./);
      assert.deepEqual(await as(s.home, () => stopState()), { on: true, by: 'runbook', at: NOW.toISOString() });
      assert.deepEqual(engine.calls.filter((c) => c.call === 'stopAll').length, 1);
      assert.equal(engine.inspect(runId).status, 'ended');
    }, { engineFor: () => engine, spawn, engineStopWith });
  } finally { s.cleanup(); }
});

// --- fix round 1 ---

const FAKE_KEY = 'ghu_abcdefghijklmnopqrstuvwxyz0123456789';
const AUTH_FAILURE = 'fatal: could not read Username for \'https://github.com\'';

test('after step 2 deleted the narrow key, steps 3 to 5 and reading a pull request carry on with the director\'s own sign-in; writes still need the key', async () => {
  const s = await scenario({ connection: { host: 'github', mode: 'narrow', project: 'o/p' } });
  const noFetch = async () => { throw new Error('no host in tests'); };
  const envFor = envForConnection((project) => readProject(project).connection, { fetch: noFetch, now: () => NOW });
  try {
    await as(s.home, async () => {
      writeKey('github-app', { clientId: 'Iv1.x', installationId: 4242, accessToken: FAKE_KEY, accessExpiresAt: null, refreshToken: null });
      click(2); click(3, { sha: s.c1.slice(0, 12) }); click(5);
    });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const base = { project: 'o__p' };
      assert.equal((await client.prState({ ...base, number: 1 })).ok, true, 'the key works before step 2');
      assert.equal((await client.runbook.cutAccess(base)).ok, true);
      assert.equal((await client.prState({ ...base, number: 1 })).ok, true, 'reading a pull request falls back to the director\'s sign-in');
      assert.match((await client.push({ ...base, dir: s.work, refspec: 'main' })).refused, /no keys/, 'a write still needs the key');
      assert.equal((await client.runbook.candidates(base)).ok, true);
      const restored = await client.runbook.restoreMain({ ...base, sha: s.c1 });
      assert.equal(restored.ok, true, JSON.stringify(restored));
      assert.equal((await client.runbook.contain(base)).ok, true);
    }, { envFor });
  } finally { s.cleanup(); }
});

test('with no sign-in either, a runbook route that needs the host answers with the sign-in refusal', async () => {
  const s = await scenario({ connection: { host: 'github', mode: 'narrow', project: 'o/p' } });
  const noFetch = async () => { throw new Error('no host in tests'); };
  const envFor = envForConnection((project) => readProject(project).connection, { fetch: noFetch, now: () => NOW });
  const failing = async (file, args, options) => (args.includes('fetch') && !options?.env?.GH_TOKEN
    ? { code: 1, stdout: '', stderr: AUTH_FAILURE, timedOut: false }
    : hostGuard(file, args, options));
  try {
    await viaHelper(s, fakeAdapter(), async (client) => {
      assert.deepEqual(await client.runbook.candidates({ project: 'o__p' }), { ok: false, refused: PUSH_REFUSALS.ciSignIn });
    }, { envFor, run: failing });
  } finally { s.cleanup(); }
});

test('a restore that changes a CI file is pushed with the director\'s sign-in on GitHub, and says the merge needs it too', async () => {
  const flow = { '.github/workflows/ci.yml': 'on: push\n' };
  const s = await scenario({ firstFiles: { 'a.txt': '1\n', ...flow }, headRemove: ['.github/workflows/ci.yml'] });
  const plain = await scenario();
  const gl = await scenario({ host: 'gitlab', firstFiles: { 'a.txt': '1\n', '.gitlab-ci.yml': 'a: b\n' }, headRemove: ['.gitlab-ci.yml'] });
  const env = { GH_TOKEN: FAKE_KEY, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x:${FAKE_KEY}`).toString('base64')}` };
  const pushed = async (scene, sceneEnv, key) => {
    const calls = [];
    const recording = async (file, args, options) => { calls.push({ args, env: options?.env }); return hostGuard(file, args, options); };
    let answer;
    await as(scene.home, async () => { click(3, { sha: scene.c1.slice(0, 12) }); });
    await viaHelper(scene, fakeAdapter(), async (client) => { answer = await client.runbook.restoreMain({ project: 'o__p', sha: scene.c1 }); }, { envFor: async () => sceneEnv, run: recording });
    assert.equal(answer.ok, true, JSON.stringify(answer));
    const push = calls.find((c) => c.args.includes('push'));
    return { answer, hasKey: push.env[key] !== undefined };
  };
  try {
    const ci = await pushed(s, env, 'GH_TOKEN');
    assert.equal(ci.hasKey, false, 'the director\'s own sign-in, not the key');
    assert.match(ci.answer.message, /merge will need your own sign-in too/);
    const ordinary = await pushed(plain, env, 'GH_TOKEN');
    assert.equal(ordinary.hasKey, true);
    assert.doesNotMatch(ordinary.answer.message, /own sign-in/);
    const lab = await pushed(gl, { GITLAB_TOKEN: 'glpat-abcdefghijklmnopqrst1234' }, 'GITLAB_TOKEN');
    assert.equal(lab.hasKey, true, 'GitLab keeps the keyed push');
  } finally { s.cleanup(); plain.cleanup(); gl.cleanup(); }
});

test('the restore exception needs no review, with STOP on or off, and says why when a check fails', async () => {
  const s = await scenario();
  const adapter = fakeAdapter();
  try {
    await as(s.home, async () => { click(3, { sha: s.c1.slice(0, 12) }); });
    await viaHelper(s, adapter, async (client) => {
      const tip = await openedRestore(s, client, s.c1);
      const state = (over = {}) => { adapter.prState = async () => ({ headSha: tip, headRef: restoreBranch(s.c1), baseRef: 'main', mergeable: 'yes', state: 'open', ...over }); };
      state();
      const merge = () => client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
      // STOP off: no review is asked for.
      assert.deepEqual((await merge()).reasons, [`no approval of ${tip.slice(0, 7)}`]);
      await as(s.home, async () => { record('approval', { pr: 7, commit: tip }); });
      assert.equal((await merge()).ok, true);

      const says = async (regex) => {
        const answer = await merge();
        assert.equal(answer.ok, false);
        assert.ok(answer.reasons.some((r) => regex.test(r)), JSON.stringify(answer.reasons));
        return answer;
      };
      state({ baseRef: 'develop' });
      await says(/its base is not the default branch/);
      state({ baseRef: undefined });
      await says(/its base is not the default branch/);
      state({ headSha: s.head });
      await says(/its head has moved since the host reported it/);
      state();
      await as(s.home, async () => { fs.rmSync(path.join(stateDir('o__p'), 'events'), { recursive: true, force: true }); record('approval', { pr: 7, commit: tip }); click(3, { sha: s.c1.slice(0, 12), ms: 25 * HOUR }); });
      await says(/no step 3 click from the last 24 hours/);
      // Under STOP the same failure is said, with STOP.
      await as(s.home, async () => { setStop({ by: 'runbook', now: () => NOW }); });
      const stopped = await says(/no step 3 click from the last 24 hours/);
      assert.ok(stopped.reasons.includes('All stop is on'));
    });
  } finally { s.cleanup(); }
});

test('a restore pull request whose files differ from the release says so', async () => {
  const s = await scenario();
  const adapter = fakeAdapter();
  try {
    await as(s.home, async () => { click(3, { sha: s.c1.slice(0, 12) }); });
    await viaHelper(s, adapter, async (client) => {
      await openedRestore(s, client, s.c1);
      await g(s.work, 'fetch', '-q', 'origin', restoreBranch(s.c1));
      await g(s.work, 'checkout', '-q', '-b', 'tampered2', 'FETCH_HEAD');
      write(s.work, { 'extra.txt': 'x\n' });
      await g(s.work, 'add', '-A');
      await g(s.work, 'commit', '-q', '-m', 'Extra');
      const bad = await g(s.work, 'rev-parse', 'HEAD');
      await g(s.work, 'push', '-q', 'origin', `${bad}:refs/pull/7/head`);
      adapter.prState = async () => ({ headSha: bad, headRef: restoreBranch(s.c1), baseRef: 'main', mergeable: 'yes', state: 'open' });
      await as(s.home, async () => { record('approval', { pr: 7, commit: bad }); });
      const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
      assert.ok(answer.reasons.some((r) => /files are not the chosen release's files/.test(r)), JSON.stringify(answer.reasons));
      assert.deepEqual(adapter.merges, []);
    });
    // The helper leaves no copy of the pull request's ref behind in the mirror.
    const left = await g(path.join(s.home, 'projects', 'o__p', 'mirror.git'), 'for-each-ref', 'refs/wheelhouse/pr');
    assert.equal(left, '');
  } finally { s.cleanup(); }
});

test('steps 2, 4 and 5 use each click once', async () => {
  const s = await scenario();
  try {
    await as(s.home, async () => { click(2); click(4); click(5); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const base = { project: 'o__p' };
      assert.equal((await client.runbook.cutAccess(base)).ok, true);
      assert.equal((await client.runbook.cutAccess(base)).refused, NEEDS_CLICK);
      assert.notEqual((await client.runbook.restoreState(base)).refused, NEEDS_CLICK);
      assert.equal((await client.runbook.restoreState(base)).refused, NEEDS_CLICK);
      assert.equal((await client.runbook.contain(base)).ok, true);
      assert.equal((await client.runbook.contain(base)).refused, NEEDS_CLICK);
      await as(s.home, async () => { click(5); });
      assert.equal((await client.runbook.contain(base)).ok, true, 'a new click counts');
    });
    assert.equal(fs.readdirSync(path.join(s.home, 'projects', 'o__p', 'runbook-used')).length, 4);
  } finally { s.cleanup(); }
});

test('restore-main takes only a commit among the last ten merges', async () => {
  const s = await scenario({ fillers: 11 });
  try {
    await as(s.home, async () => { click(3, { sha: s.c1.slice(0, 12) }); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.restoreMain({ project: 'o__p', sha: s.c1 });
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /not among the last ten merges/);
      const listed = (await client.runbook.candidates({ project: 'o__p' })).candidates;
      assert.equal(listed.length, 10);
      assert.equal(listed.some((c) => c.sha === s.c1), false);
    });
  } finally { s.cleanup(); }
});

test('containment output is capped while it runs and any secret in it is masked', async () => {
  const key = `ghp_${'a'.repeat(36)}`;
  const code = `console.log("start"); console.log("token ${key}"); process.stdout.write("x".repeat(300000)); console.log(); console.log("end")`;
  const config = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], runbook: { contain: { describe: 'Noisy', command: ['node', '-e', code] } } };
  const s = await scenario({ headFiles: { '.claude/wheelhouse.json': `${JSON.stringify(config)}\n` } });
  try {
    await as(s.home, async () => { click(5); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.contain({ project: 'o__p' });
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.ok(answer.output.length <= 2200);
      assert.match(answer.output, /end$/);
    });
    // The secret sits early in the output: put it where the tail keeps it.
    const config2 = { ...config, runbook: { contain: { describe: 'Leaky', command: ['node', '-e', `console.log("token ${key}")`] } } };
    await g(s.work, 'checkout', '-q', 'main');
    write(s.work, { '.claude/wheelhouse.json': `${JSON.stringify(config2)}\n` });
    await g(s.work, 'add', '-A');
    await g(s.work, 'commit', '-q', '-m', 'Leaky');
    await g(s.work, 'push', '-q', 'origin', 'main');
    await as(s.home, async () => { click(5); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.contain({ project: 'o__p' });
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.doesNotMatch(JSON.stringify(answer), /ghp_a/);
      assert.match(answer.output, /hidden/);
    });
  } finally { s.cleanup(); }
});

test('GitLab cut-access: only a 2xx deletes the file; a 401 says the key no longer works; a refusal tries the key\'s own number', async () => {
  const s = await scenario({ host: 'gitlab', connection: { host: 'gitlab', mode: 'narrow', project: 'o/p', projectId: 5, baseUrl: 'https://gitlab.example.com' } });
  const token = 'glpat-abcdefghijklmnopqrst1234';
  const file = path.join(s.home, 'keys', 'gitlab-project-5.json');
  const calls = [];
  let statuses = [];
  const fetch = async (url, options) => { calls.push(`${options.method} ${new URL(url).pathname}`); return { status: statuses.shift(), text: async () => '' }; };
  const keyed = (extra = {}) => writeKey('gitlab-project-5', { kind: 'project-key', token, expiresAt: '2027-01-01', ...extra });
  try {
    await viaHelper(s, fakeAdapter(), async (client) => {
      const base = { project: 'o__p' };
      await as(s.home, async () => { keyed(); click(2); });
      statuses = [401];
      const dead = await client.runbook.cutAccess(base);
      assert.equal(fs.existsSync(file), true, 'a 401 deletes nothing');
      assert.match(dead.message, /no longer works/);
      assert.doesNotMatch(dead.message, /nothing is left/i);
      assert.equal(dead.url, 'https://gitlab.example.com/o/p/-/settings/access_tokens');

      calls.length = 0;
      await as(s.home, async () => { keyed({ id: 99 }); click(2); });
      statuses = [403, 204];
      const second = await client.runbook.cutAccess(base);
      assert.equal(second.ok, true, JSON.stringify(second));
      assert.deepEqual(calls, ['DELETE /api/v4/personal_access_tokens/self', 'DELETE /api/v4/projects/5/access_tokens/99']);
      assert.equal(fs.existsSync(file), false);

      await as(s.home, async () => { keyed({ kind: 'pasted-token' }); click(2); });
      statuses = [204];
      const pasted = await client.runbook.cutAccess(base);
      assert.equal(pasted.ok, true);
      assert.match(pasted.message, /your own token/);
      assert.equal(pasted.url, 'https://gitlab.example.com/-/user_settings/personal_access_tokens');
    }, { fetch });
  } finally { s.cleanup(); }
});

test('the quick GitLab answer names the applications page and the personal access tokens page', async () => {
  const s = await scenario({ host: 'gitlab', connection: { host: 'gitlab', mode: 'quick', project: 'o/p', baseUrl: 'https://gitlab.example.com' } });
  try {
    await as(s.home, async () => { click(2); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      const answer = await client.runbook.cutAccess({ project: 'o__p' });
      assert.equal(answer.ok, true);
      assert.match(answer.message, /https:\/\/gitlab\.example\.com\/-\/user_settings\/applications/);
      assert.match(answer.message, /https:\/\/gitlab\.example\.com\/-\/user_settings\/personal_access_tokens/);
    });
  } finally { s.cleanup(); }
});

// --- fix round 2 ---

test('a restore pull request that changes a CI file merges with the director\'s own sign-in on GitHub', async () => {
  const flow = { '.github/workflows/ci.yml': 'on: push\n' };
  const ci = await scenario({ firstFiles: { 'a.txt': '1\n', ...flow }, headRemove: ['.github/workflows/ci.yml'] });
  const plain = await scenario();
  const env = { GH_TOKEN: FAKE_KEY };
  const mergeEnvs = async (scene, reason) => {
    const seen = [];
    const base = fakeAdapter();
    await as(scene.home, async () => { click(3, { sha: scene.c1.slice(0, 12) }); });
    let answer;
    await viaHelper(scene, base, async (client) => {
      const tip = await openedRestore(scene, client, scene.c1);
      base.prState = async () => ({ headSha: tip, headRef: restoreBranch(scene.c1), baseRef: 'main', mergeable: 'yes', state: 'open' });
      await as(scene.home, async () => { record('approval', { pr: 7, commit: tip }); });
      answer = await client.runbook.restoreMerge({ project: 'o__p', number: 7 });
    }, {
      envFor: async () => env,
      adapterFor: async (_p, { env: used }) => ({ ...base, merge: async (args) => { seen.push(used.GH_TOKEN); return reason ? { merged: false, reason } : base.merge(args); } }),
    });
    return { answer, seen };
  };
  try {
    const withCi = await mergeEnvs(ci);
    assert.equal(withCi.answer.ok, true, JSON.stringify(withCi.answer));
    assert.deepEqual(withCi.seen, [undefined], 'merged with the director\'s sign-in, not the key');
    const ordinary = await mergeEnvs(plain);
    assert.equal(ordinary.answer.ok, true, JSON.stringify(ordinary.answer));
    assert.deepEqual(ordinary.seen, [FAKE_KEY]);
  } finally { ci.cleanup(); plain.cleanup(); }
  const signedOut = await scenario({ firstFiles: { 'a.txt': '1\n', '.github/workflows/ci.yml': 'on: push\n' }, headRemove: ['.github/workflows/ci.yml'] });
  try {
    const answer = (await mergeEnvs(signedOut, 'gh: authentication required')).answer;
    assert.deepEqual(answer, { ok: false, refused: PUSH_REFUSALS.ciSignIn });
  } finally { signedOut.cleanup(); }
});

test('under STOP, a failing restore check is said even when the gate would otherwise allow the merge', async () => {
  const s = await scenario();
  const adapter = fakeAdapter();
  try {
    await as(s.home, async () => { click(3, { sha: s.c1.slice(0, 12) }); });
    await viaHelper(s, adapter, async (client) => {
      const tip = await openedRestore(s, client, s.c1);
      // A body whose provenance matches, so only the restore check and STOP stand in the way.
      adapter.prState = async () => ({ headSha: tip, headRef: restoreBranch(s.c1), baseRef: 'develop', mergeable: 'yes', state: 'open', body: matchingBody() });
      await as(s.home, async () => {
        record('approval', { pr: 7, commit: tip });
        record('review', { pr: 7, commit: tip, verdict: 'CLEAN' });
        setStop({ by: 'runbook', now: () => NOW });
      });
      const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
      assert.deepEqual(answer.reasons, ['restore pull request: its base is not the default branch', 'All stop is on']);
    });
  } finally { s.cleanup(); }
});

// --- final review ---

test('runbook.js never reads the projects folder: it sends its folder and the helper places the project', async () => {
  const s = await scenario();
  const work = path.join(s.home, 'work');
  const projects = [path.join(s.home, 'projects'), path.join(fs.realpathSync(s.home), 'projects')];
  // Inside the sandbox <home>/projects cannot be read: this fs refuses it while runbook.js runs.
  const names = ['readdirSync', 'readFileSync', 'statSync', 'lstatSync', 'existsSync', 'openSync', 'opendirSync'];
  const saved = Object.fromEntries(names.map((n) => [n, fs[n]]));
  let sandboxed = false;
  const denied = (p) => typeof p === 'string' && projects.some((root) => path.resolve(p) === root || path.resolve(p).startsWith(root + path.sep));
  try {
    fs.mkdirSync(work, { recursive: true });
    await as(s.home, async () => { click(2); });
    for (const n of names) {
      fs[n] = function sandboxedFs(p, ...rest) {
        if (sandboxed && denied(p)) throw Object.assign(new Error(`EPERM: operation not permitted, ${n}`), { code: 'EPERM' });
        return saved[n].call(fs, p, ...rest);
      };
    }
    await viaHelper(s, fakeAdapter(), async (client) => {
      const sent = [];
      // The helper is outside the sandbox: while it answers, the folder can be read.
      const outside = (fn) => async (args) => {
        sent.push(args);
        sandboxed = false;
        try { return await fn(args); } finally { sandboxed = true; }
      };
      const asked = { stop: outside(client.stop), runbook: { cutAccess: outside(client.runbook.cutAccess) } };
      sandboxed = true;
      const out = await as(s.home, () => runbook({ argv: ['2'], cwd: work, client: asked }));
      sandboxed = false;
      assert.deepEqual(sent, [{ cwd: work }], 'step 2 reached the helper with the folder');
      assert.equal(out.code, 0, out.text);
      assert.match(out.text, /only you can/i);
    }, { fetch: async () => { throw new Error('no host in tests'); } });
  } finally {
    sandboxed = false;
    Object.assign(fs, saved);
    s.cleanup();
  }
});

test('the helper places a runbook request by its folder, and refuses a folder outside every project', async () => {
  const s = await scenario();
  const work = path.join(s.home, 'work');
  try {
    fs.mkdirSync(path.join(work, 'deeper'), { recursive: true });
    await as(s.home, async () => { click(5); });
    await viaHelper(s, fakeAdapter(), async (client) => {
      assert.equal((await client.runbook.contain({ cwd: path.join(work, 'deeper') })).message, NO_HARM);
      const outside = await client.runbook.contain({ cwd: os.tmpdir() });
      assert.match(outside.refused, /not inside a Wheelhouse project/);
      assert.match((await client.runbook.contain({ cwd: 'work' })).refused, /not inside a Wheelhouse project|full path/);
      assert.match((await client.runbook.contain({ cwd: 7 })).refused, /not inside a Wheelhouse project|full path/);
    });
  } finally { s.cleanup(); }
});

test('on the narrow connection: step 2, step 3 opens the restore, the director approves it on its card, and 3 merge merges it', async () => {
  const s = await scenario({ connection: { host: 'github', mode: 'narrow', project: 'o/p' } });
  const noFetch = async () => { throw new Error('no host in tests'); };
  const envFor = envForConnection((project) => readProject(project).connection, { fetch: noFetch, now: () => NOW });
  const work = path.join(s.home, 'work');
  const noManaged = path.join(s.home, 'no-managed');
  const adapter = fakeAdapter();
  try {
    fs.mkdirSync(work, { recursive: true });
    await g(work, 'init', '-q', '-b', 'main');
    await as(s.home, async () => {
      writeKey('github-app', { clientId: 'Iv1.x', installationId: 4242, accessToken: FAKE_KEY, accessExpiresAt: null, refreshToken: null });
    });
    await viaHelper(s, adapter, async (client) => {
      const inHome = (fn) => as(s.home, fn);
      const step = (...argv) => inHome(() => runbook({ argv, cwd: work, client }));
      // The director's click on a card, in the shape AskUserQuestion's PostToolUse carries it.
      const clickCard = (question, label, offered) => {
        const questions = [{ question, header: 'Runbook', multiSelect: false, options: offered.map((o) => ({ label: o, description: o })) }];
        return inHome(() => promptRecord({
          session_id: 'session-1', transcript_path: path.join(s.home, 'none.jsonl'), cwd: work, hook_event_name: 'PostToolUse',
          tool_name: 'AskUserQuestion', tool_input: { questions, answers: { [question]: label } },
          tool_response: { questions, answers: { [question]: label } }, tool_use_id: 'toolu_1',
        }, { client, now: () => NOW, dir: noManaged }));
      };
      const events = (kind) => listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === kind);

      assert.equal((await step('1')).code, 0);
      await clickCard(`${runbookLine(2)}?`, 'Do it', ['Do it', 'Not now']);
      const cut = await step('2');
      assert.equal(cut.code, 0, cut.text);
      assert.equal(fs.existsSync(path.join(s.home, 'keys', 'github-app.json')), false, 'the narrow key is gone');

      await clickCard(`${runbookLine(3, s.c1)}?`, 'Do it', ['Do it', 'Not now']);
      assert.equal(await inHome(() => events('action').filter((e) => e.data.step === 3).length), 1, 'the step 3 click is recorded after the key has gone');
      const opened = await step('3', s.c1);
      assert.equal(opened.code, 0, opened.text);
      const tip = await g(s.remote.url, 'rev-parse', `refs/heads/${restoreBranch(s.c1)}`);
      await g(s.remote.url, 'update-ref', 'refs/pull/7/head', tip);
      adapter.prState = async () => ({ headSha: tip, headRef: restoreBranch(s.c1), baseRef: 'main', mergeable: 'yes', state: 'open' });

      await clickCard(`${approvalLine(7, tip)}?`, 'Approve', ['Approve', 'Not yet']);
      const approvals = await inHome(() => events('approval'));
      assert.deepEqual(approvals.map((e) => [e.data.pr, e.data.commit]), [[7, tip]], 'the director\'s approval is recorded');

      const merged = await step('3', 'merge', '7');
      assert.equal(merged.code, 0, merged.text);
      assert.deepEqual(adapter.merges, [{ number: 7, sha: tip }]);
    }, { envFor });
  } finally { s.cleanup(); }
});

