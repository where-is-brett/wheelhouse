// tests/scripts/host/helper-compact-window.test.js
// The compaction window the director chose reaches the project's protected settings file by a pull request the helper
// makes, whose whole diff is that one key at the signed value, and which merges through the gate once the director
// approves it. The recogniser refuses any other diff.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { listEvents, makeEvent, eventPath, confirmationFor } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { COMPACT_WORK, COMPACT_TITLE, compactBranch, compactChange, changedText } from '../../../scripts/settings/compact-window-pr.js';
import { SETTINGS_FILE } from '../../../scripts/settings/compact-window.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';

import { as, shortHome, testAddress } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const T0 = new Date('2026-10-30T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const LOGIN = 'ann-oneil';
const ADDRESS = 'https://github.com/o/p.git';

function record(kind, data, ms = 1000) {
  const event = makeEvent({ kind, data, now: at(ms) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
  return event;
}
const SETTINGS = { model: 'x', permissions: { deny: ['Bash(gh:*)'] }, autoCompactWindow: 300000 };
// The director's signed choice of a window.
function confirmWindow(value = 320000) {
  const setting = record('setting', { key: 'compactWindow', value });
  record('confirmation', confirmationFor(setting).data, 2000);
}

// The project's remote: main with one commit, set up before v0.2.0, so no .archon/ in it.
async function oldProject() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-work-'));
  await g(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'README.md'), 'x\n');
  fs.mkdirSync(path.join(work, '.claude'));
  fs.writeFileSync(path.join(work, SETTINGS_FILE), `${JSON.stringify(SETTINGS, null, 2)}\n`);
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'push', '-q', remote.url, 'main');
  const base = await g(work, 'rev-parse', 'HEAD');
  return { remote, base, cleanup: () => { remote.cleanup(); fs.rmSync(work, { recursive: true, force: true }); } };
}

// GitHub, stood in for by the bare remote: an opened pull request's head is kept as refs/pull/<n>/head, and a merge
// moves main to it.
function host(remote) {
  const prs = new Map();
  const merges = [];
  const opened = [];
  return {
    merges,
    opened,
    defaultBranch: async () => 'main',
    login: async () => LOGIN,
    openPr: async ({ head, base, title, body }) => {
      const number = 8 + opened.length;
      const sha = await g(remote.url, 'rev-parse', `refs/heads/${head}`);
      await g(remote.url, 'update-ref', `refs/pull/${number}/head`, sha);
      await g(remote.url, 'update-ref', `refs/merge-requests/${number}/head`, sha);
      prs.set(number, { headSha: sha, headRef: head, baseRef: base, state: 'open', mergeable: 'mergeable', body });
      opened.push({ number, head, base, title, body });
      return { number, url: `https://github.com/o/p/pull/${number}` };
    },
    // The head as the branch has it now, as GitHub's pull request follows its branch.
    prState: async (number) => {
      const pr = prs.get(number);
      if (!pr) return null;
      if (pr.state === 'open') {
        pr.headSha = await g(remote.url, 'rev-parse', `refs/heads/${pr.headRef}`);
        await g(remote.url, 'update-ref', `refs/pull/${number}/head`, pr.headSha);
        await g(remote.url, 'update-ref', `refs/merge-requests/${number}/head`, pr.headSha);
      }
      return { ...pr };
    },
    close: (number) => prs.set(number, { ...prs.get(number), state: 'closed' }),
    closePr: async (number) => { prs.set(number, { ...prs.get(number), state: 'closed' }); return { number }; },
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async ({ number, sha }) => {
      merges.push({ number, sha });
      await g(remote.url, 'update-ref', 'refs/heads/main', sha);
      prs.set(number, { ...prs.get(number), state: 'merged' });
      return { merged: true };
    },
  };
}

async function working(fn, kind = 'github') {
  const p = await oldProject();
  const home = shortHome();
  try {
    await as(home, async () => {
      writeProject('o__p', {
        folder: path.join(home, 'work'), remoteUrl: p.remote.url, host: kind, repo: 'o/p', connection: { host: kind, mode: 'quick', project: 'o/p' },
      });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-30T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: p.remote.url });
      assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(0) })).taken, true);
      const adapter = host(p.remote);
      const helper = await startHelper({
        run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), mirrorAddress: () => ADDRESS,
      });
      try {
        const client = helperClient({ address: helper.address });
        await fn({ client, adapter, remote: p.remote, base: p.base });
      } finally { await helper.close(); }
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    p.cleanup();
  }
}

const gateAsks = () => listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'gate-asks');

for (const kind of ['github', 'gitlab']) test(`a window the director chose reaches the settings file by an approved ${kind === 'github' ? 'pull' : 'merge'} request`, async () => {
  await working(async ({ client, adapter, remote, base }) => {
    assert.deepEqual(await client.compactWindow({ project: 'o__p' }), { ok: true, step: 'off' });
    confirmWindow(320000);
    const opened = await client.compactWindow({ project: 'o__p' });
    assert.equal(opened.step, 'opened', JSON.stringify(opened));
    assert.deepEqual(adapter.opened.map((o) => [o.number, o.head, o.base, o.title]), [[8, compactBranch(base), 'main', COMPACT_TITLE]]);
    assert.equal(await g(remote.url, 'rev-parse', `${opened.head}^`), base);
    assert.deepEqual(JSON.parse(await g(remote.url, 'show', `${opened.head}:${SETTINGS_FILE}`)), { ...SETTINGS, autoCompactWindow: 320000 });
    assert.deepEqual(await client.compactWindow({ project: 'o__p' }), { ok: true, step: 'approve', pr: 8, head: opened.head });
    assert.deepEqual(gateAsks().map((e) => e.data), [{ work: COMPACT_WORK, pr: 8, ask: 'approval', sha: opened.head }]);
    assert.deepEqual(adapter.merges, []);
    record('approval', { pr: 8, commit: opened.head }, 3000);
    assert.deepEqual(await client.compactWindow({ project: 'o__p' }), { ok: true, step: 'on' });
    assert.deepEqual(adapter.merges, [{ number: 8, sha: opened.head }]);
    assert.equal(adapter.opened.length, 1);
  }, kind);
});

test('the recogniser refuses any other key, any other file and any other value', () => {
  const settings = { model: 'x', autoCompactWindow: 300000 };
  const text = (o) => `${JSON.stringify(o, null, 2)}\n`;
  const files = (over = {}) => ({ [SETTINGS_FILE]: { base: JSON.stringify(settings), head: changedText(JSON.stringify(settings), 320000), headMode: '100644', ...over } });
  const headRef = compactBranch('a'.repeat(40));
  const check = (args) => compactChange({ headRef, paths: [SETTINGS_FILE], files: files(), value: 320000, ...args });
  assert.deepEqual(check({}), { matched: true, ok: true, value: 320000 });
  assert.deepEqual(check({ headRef: 'feature/x' }), { matched: false });
  assert.match(check({ paths: [SETTINGS_FILE, 'src/a.js'] }).why, /more than/);
  assert.match(check({ paths: ['.claude/settings.local.json'] }).why, /more than/);
  assert.match(check({ files: files({ head: text({ ...settings, model: 'y', autoCompactWindow: 320000 }) }) }).why, /more than autoCompactWindow/);
  assert.match(check({ files: files({ head: text({ ...settings, enableAllProjectMcpServers: true, autoCompactWindow: 320000 }) }) }).why, /more than autoCompactWindow/);
  assert.match(check({ files: files({ head: changedText(JSON.stringify(settings), 400000) }) }).why, /other than the one the director chose/);
  assert.match(check({ value: 400000 }).why, /other than the one the director chose/);
  assert.match(check({ value: null }).why, /has not chosen/);
  assert.match(check({ files: files({ headMode: '100755' }) }).why, /plain file/);
  assert.match(check({ files: files({ head: `${JSON.stringify({ ...settings, autoCompactWindow: 320000 })}\n` }) }).why, /isn't the text/);
  assert.match(check({ files: files({ base: null }) }).why, /plain file/);
});

// A project in git alone: the change goes through the local queue, and the director's signed approval is the click.
test('a window the director chose reaches a git-alone project through the local queue once they approve it', async () => {
  const { gitAloneWorld, LOCAL_COMMAND, LOCAL_P } = await import('../../helpers/engine-e2e.js');
  const { commandDigest } = await import('../../../scripts/checks/record.js');
  const digest = commandDigest(LOCAL_COMMAND);
  const check = async ({ commit, main }) => ({ commit, command: digest, result: 'passed', minutes: 0, tail: '', ...(main ? { clean: true } : {}) });
  const put = (kind, data, ms) => {
    const event = makeEvent({ kind, data, now: at(ms) });
    const file = path.join(stateDir(LOCAL_P), eventPath(event));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
    return event;
  };
  await gitAloneWorld(async ({ helper, client, home, folder }) => {
    assert.deepEqual(await client.compactWindow({ project: LOCAL_P }), { ok: true, step: 'off' });
    const setting = put('setting', { key: 'compactWindow', value: 320000 }, 1000);
    put('confirmation', confirmationFor(setting).data, 2000);
    const opened = await client.compactWindow({ project: LOCAL_P });
    assert.equal(opened.step, 'opened', JSON.stringify(opened));
    assert.deepEqual(JSON.parse(await g(home, 'show', `${opened.head}:${SETTINGS_FILE}`)), { ...SETTINGS, autoCompactWindow: 320000 });
    // The checks run on this computer: the main version's and the change's.
    for (let i = 0; i < 4; i += 1) await helper.engine.tick();
    const waiting = await client.compactWindow({ project: LOCAL_P });
    assert.equal(waiting.step, 'approve', JSON.stringify(waiting));
    put('approval', { pr: opened.pr, commit: opened.head }, 3000);
    const done = await client.compactWindow({ project: LOCAL_P });
    assert.equal(done.step, 'on', JSON.stringify(done));
    assert.deepEqual(JSON.parse(await g(home, 'show', `main:${SETTINGS_FILE}`)), { ...SETTINGS, autoCompactWindow: 320000 });
    assert.ok(folder);
  }, { check, files: { [SETTINGS_FILE]: `${JSON.stringify(SETTINGS, null, 2)}\n` } });
});
