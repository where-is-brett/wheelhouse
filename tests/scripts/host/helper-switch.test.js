// tests/scripts/host/helper-switch.test.js
// The switch to the new engine for a project set up before it (part 3f; Archon design, sections 14.3 and 17): once the
// director confirmed it, the helper opens a pull request adding the engine's files, asks for the director's approval
// through the merge gate's own card, and merges it through its gate. The engine is on for the project only then.
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
import { engineReady, SWITCH_SETTING, SWITCH_WORK, switchBranch } from '../../../scripts/engine/switch.js';
import { switchChange, switchTexts, SWITCH_TITLE } from '../../../scripts/engine/switch-pr.js';
import { ENGINE_FILES, POLICY_FILE, ARCHON_CONFIG_FILE, mirrorRulesFile } from '../../../scripts/setup/engine-parts.js';
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
// The director's click on the switch card: the setting and its signed confirmation.
function confirmSwitch() {
  const setting = record('setting', { key: SWITCH_SETTING.key, value: SWITCH_SETTING.value });
  record('confirmation', confirmationFor(setting).data, 2000);
}

// The project's remote: main with one commit, set up before v0.2.0, so no .archon/ in it.
async function oldProject() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-work-'));
  await g(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'README.md'), 'x\n');
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

async function switching(fn) {
  const p = await oldProject();
  const home = shortHome();
  try {
    await as(home, async () => {
      writeProject('o__p', {
        folder: path.join(home, 'work'), remoteUrl: p.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
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
const engineOn = async (client) => (await client.state.views({ project: 'o__p' })).engineOn;

test('a project set up already gets it by an approved pull request', async () => {
  await switching(async ({ client, adapter, remote, base }) => {
    // Before the director confirms the switch, nothing is opened.
    assert.deepEqual(await client.engineSwitch({ project: 'o__p' }), { ok: true, step: 'off' });
    assert.deepEqual(adapter.opened, []);

    confirmSwitch();
    const opened = await client.engineSwitch({ project: 'o__p' });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.equal(opened.step, 'opened');
    const branch = switchBranch(base);
    assert.deepEqual(adapter.opened.map((o) => [o.number, o.head, o.base, o.title]), [[8, branch, 'main', SWITCH_TITLE]]);
    assert.match(adapter.opened[0].body, new RegExp(`naming ${LOGIN}`));
    // One commit on top of main, adding the two files with the texts a new setup commits.
    assert.equal(await g(remote.url, 'rev-parse', `${opened.head}^`), base);
    const texts = switchTexts(LOGIN);
    for (const file of ENGINE_FILES) assert.equal(`${await g(remote.url, 'show', `${opened.head}:${file}`)}\n`, texts[file]);
    assert.equal(await g(remote.url, 'show', `${opened.head}:${POLICY_FILE}`), `["${LOGIN}"]`);
    // Nothing changes yet: the engine isn't on.
    assert.equal(engineReady('o__p'), false);
    assert.equal(await engineOn(client), false);

    // Next, the gate wants only the director's approval: the click it waits for is recorded, once, for the approval card.
    for (let i = 0; i < 2; i += 1) {
      assert.deepEqual(await client.engineSwitch({ project: 'o__p' }), { ok: true, step: 'approve', pr: 8, head: opened.head });
    }
    assert.deepEqual(gateAsks().map((e) => e.data), [{ work: SWITCH_WORK, pr: 8, ask: 'approval', sha: opened.head }]);
    assert.deepEqual(adapter.merges, []);
    assert.equal(await engineOn(client), false);

    // The director approves: it merges through the gate, and the engine is on for the project from then.
    record('approval', { pr: 8, commit: opened.head }, 3000);
    assert.deepEqual(await client.engineSwitch({ project: 'o__p' }), { ok: true, step: 'on' });
    assert.deepEqual(adapter.merges, [{ number: 8, sha: opened.head }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(mirrorRulesFile(), 'utf8')), { o__p: ADDRESS });
    assert.equal(engineReady('o__p'), true);
    assert.equal(await engineOn(client), true);
    assert.deepEqual(await client.engineSwitch({ project: 'o__p' }), { ok: true, step: 'on' });
    assert.equal(adapter.opened.length, 1);
  });
});

test('a switch merged by hand on the host turns the engine on at the next step', async () => {
  await switching(async ({ client, adapter, remote }) => {
    confirmSwitch();
    const opened = await client.engineSwitch({ project: 'o__p' });
    await g(remote.url, 'update-ref', 'refs/heads/main', opened.head);
    assert.deepEqual(await client.engineSwitch({ project: 'o__p' }), { ok: true, step: 'on' });
    assert.deepEqual(adapter.merges, []);
    assert.equal(engineReady('o__p'), true);
  });
});

test('a switch whose default branch moved on is made again on its new head, and asks the approval for that', async () => {
  await switching(async ({ client, adapter, remote }) => {
    confirmSwitch();
    const opened = await client.engineSwitch({ project: 'o__p' });
    // Other work merges meanwhile.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-other-'));
    try {
      await g(work, 'clone', '-q', remote.url, '.');
      fs.writeFileSync(path.join(work, 'other.txt'), 'o\n');
      await g(work, 'add', '-A');
      await g(work, '-c', 'user.name=x', '-c', 'user.email=x@invalid', 'commit', '-q', '-m', 'Other');
      await g(work, 'push', '-q', 'origin', 'HEAD:main');
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
    // The helper closes its own pull request, behind now, and makes the switch again on the new head.
    const again = await client.engineSwitch({ project: 'o__p' });
    assert.equal(again.step, 'opened', JSON.stringify(again));
    assert.equal((await adapter.prState(opened.pr)).state, 'closed');
    assert.equal(again.pr, opened.pr + 1);
    const main = await g(remote.url, 'rev-parse', 'main');
    assert.equal(await g(remote.url, 'rev-parse', `${again.head}^`), main);
    assert.equal(adapter.opened[1].head, switchBranch(main));
    const head = again.head;
    assert.deepEqual(await client.engineSwitch({ project: 'o__p' }), { ok: true, step: 'approve', pr: again.pr, head });
    record('approval', { pr: again.pr, commit: head }, 3000);
    assert.deepEqual(await client.engineSwitch({ project: 'o__p' }), { ok: true, step: 'on' });
    assert.deepEqual(adapter.merges, [{ number: again.pr, sha: head }]);
  });
});

test('a switch closed on the host stays closed, and the engine off', async () => {
  await switching(async ({ client, adapter }) => {
    confirmSwitch();
    const opened = await client.engineSwitch({ project: 'o__p' });
    adapter.close(opened.pr);
    assert.deepEqual(await client.engineSwitch({ project: 'o__p' }), { ok: true, step: 'closed', pr: opened.pr });
    assert.equal(adapter.opened.length, 1, 'no other is opened in its place');
    assert.equal(engineReady('o__p'), false);
  });
});

test("the switch's pull request changing anything else needs its review, as any other", async () => {
  const texts = switchTexts(LOGIN);
  const files = (over = {}) => Object.fromEntries(ENGINE_FILES.map((f) => [f, { base: null, head: texts[f], headMode: '100644', ...over[f] }]));
  const headRef = switchBranch('a'.repeat(40));
  assert.deepEqual(switchChange({ headRef, paths: [...ENGINE_FILES], files: files() }), { matched: true, ok: true, login: LOGIN });
  assert.deepEqual(switchChange({ headRef: 'feature/x', paths: [...ENGINE_FILES], files: files() }), { matched: false });
  const why = (args) => switchChange({ headRef, paths: [...ENGINE_FILES], files: files(), ...args }).why;
  assert.match(why({ paths: [...ENGINE_FILES, 'src/a.js'] }), /more than the build engine's two files/);
  assert.match(why({ paths: [POLICY_FILE] }), /more than the build engine's two files/);
  assert.match(why({ files: files({ [POLICY_FILE]: { head: '["a","b"]\n' } }) }), /doesn't name one GitHub login/);
  assert.match(why({ files: files({ [ARCHON_CONFIG_FILE]: { head: 'worktree:\n  path: /tmp\n' } }) }), /config\.yaml isn't the text/);
  assert.match(why({ files: files({ [ARCHON_CONFIG_FILE]: { base: 'x\n' } }) }), /config\.yaml isn't the text/);
  assert.match(why({ files: files({ [POLICY_FILE]: { headMode: '100755' } }) }), /maintainers\.json isn't the text/);

  // At the gate: a pull request on a switch's branch that adds anything more, or whose policy names another account than
  // the one the helper posts as, is reviewed, as any other.
  const others = [
    { ...texts, 'src/a.js': 'a\n' },
    switchTexts('someone-else'),
  ];
  for (const files of others) {
    await switching(async ({ client, adapter, remote, base }) => {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-more-'));
      try {
        await g(work, 'clone', '-q', remote.url, '.');
        for (const [file, text] of Object.entries(files)) {
          fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
          fs.writeFileSync(path.join(work, file), text);
        }
        await g(work, 'add', '-A');
        await g(work, '-c', 'user.name=x', '-c', 'user.email=x@invalid', 'commit', '-q', '-m', 'More');
        await g(work, 'push', '-q', 'origin', `HEAD:refs/heads/${switchBranch(base)}`);
      } finally { fs.rmSync(work, { recursive: true, force: true }); }
      const { number } = await adapter.openPr({ head: switchBranch(base), base: 'main', title: 'More', body: '' });
      const head = (await adapter.prState(number)).headSha;
      record('approval', { pr: number, commit: head });
      const answer = await client.merge({ project: 'o__p', number, stop: false, bypass: false });
      assert.equal(answer.ok, false);
      assert.ok(answer.reasons.includes(`no CLEAN review of ${head.slice(0, 7)}`), JSON.stringify(answer.reasons));
      assert.deepEqual(adapter.merges, []);
    });
  }
});
