// tests/scripts/host/helper-merge.test.js
// The merge gate's guardrail and approval conditions are worked out by the
// helper from the pull request's changed files (Ruling 15), never taken from
// the caller.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { startHelper, changedPaths } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { matchingBody } from '../../helpers/provenance.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

// A pull request body stamped with what matches the installed manifest, so the gate's provenance condition passes.
const BODY = matchingBody();

const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const UNREADABLE = 'the changed files couldn\'t be read, so this needs the director\'s approval';
// The mirror can't read the pull request, so whether it is up to date is not known.
const UNCHECKED = 'whether the branch is up to date could not be checked';

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// A remote with a default branch holding `base` files, and pull request 7 whose
// head changes things with `change(dir)`. Returns the head's commit.
async function remoteWithPr({ base = { 'README.md': 'x\n' }, change, ref = 'refs/pull/7/head' }) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-work-'));
  await g(work, 'init', '-q', '-b', 'main');
  write(work, base);
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await g(work, 'push', '-q', 'origin', 'main');
  await g(work, 'checkout', '-q', '-b', 'feature');
  await change(work);
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Change');
  const head = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'push', '-q', 'origin', `${head}:${ref}`);
  return { remote, work, head, cleanup: () => { remote.cleanup(); fs.rmSync(work, { recursive: true, force: true }); } };
}

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

function record(kind, data) {
  const event = makeEvent({ kind, data, now: at(1000) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
const reviewed = (head) => record('review', { pr: 7, commit: head, verdict: 'CLEAN' });
const approved = (head) => record('approval', { pr: 7, commit: head });

function fakeAdapter(head, overrides = {}) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: head, mergeable: 'mergeable', state: 'open', body: BODY }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
    ...overrides,
  };
}

// Takes the lock once, then runs each step in turn against one helper: a step
// may record events first, asks for the merge with `body`, and checks the answer.
async function merging(pr, adapter, steps) {
  const home = await project(pr.remote);
  try {
    await as(home, async () => {
      const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}) });
      try {
        const client = helperClient({ address: helper.address });
        for (const step of steps) {
          step.before?.();
          await step.after(await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false, ...step.body }));
        }
      } finally { await helper.close(); }
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('/merge needs the director\'s approval for a guardrail change even when the caller says false', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { '.claude/settings.json': '{}\n', 'src/a.js': 'a\n' }) });
  try {
    const adapter = fakeAdapter(pr.head);
    const caller = { approvalRequired: false, touchesGuardrails: false };
    await merging(pr, adapter, [
      {
        before: () => reviewed(pr.head),
        body: caller,
        async after(answer) {
          assert.equal(answer.ok, false);
          assert.deepEqual(answer.reasons, [`no approval of ${pr.head.slice(0, 7)}`]);
          assert.deepEqual(answer.guardrailPaths, ['.claude/settings.json']);
          assert.deepEqual(answer.criticalAreas, []);
          assert.deepEqual(adapter.merges, []);
        },
      },
      {
        before: () => approved(pr.head),
        body: caller,
        async after(answer) {
          assert.deepEqual(answer, { ok: true, merged: true, sha: pr.head, guardrailPaths: ['.claude/settings.json'], criticalAreas: [] });
          assert.deepEqual(adapter.merges, [{ number: 7, sha: pr.head }]);
        },
      },
    ]);
  } finally { pr.cleanup(); }
});

test('/merge with no guardrail change and no caller flag needs no approval', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { 'src/a.js': 'a\n' }) });
  try {
    const noApproval = [`no approval of ${pr.head.slice(0, 7)}`];
    await merging(pr, fakeAdapter(pr.head), [
      // The caller may raise the conditions, never lower them.
      { before: () => reviewed(pr.head), body: { approvalRequired: true }, after: async (a) => assert.deepEqual(a.reasons, noApproval) },
      { body: { touchesGuardrails: true }, after: async (a) => assert.deepEqual(a.reasons, noApproval) },
      { body: { approvalRequired: false, touchesGuardrails: false, reviewRequired: false },
        after: async (a) => assert.deepEqual(a, { ok: true, merged: true, sha: pr.head, guardrailPaths: [], criticalAreas: [] }) },
    ]);
  } finally { pr.cleanup(); }
});

test('/merge counts a rename out of .claude/ by its old path', async () => {
  const pr = await remoteWithPr({
    base: { '.claude/settings.json': '{}\n', 'README.md': 'x\n' },
    change: (w) => fs.renameSync(path.join(w, '.claude/settings.json'), path.join(w, 'settings-moved.json')),
  });
  try {
    await merging(pr, fakeAdapter(pr.head), [{
      before: () => reviewed(pr.head),
      async after(answer) {
        assert.deepEqual(answer.guardrailPaths, ['.claude/settings.json']);
        assert.deepEqual(answer.reasons, [`no approval of ${pr.head.slice(0, 7)}`]);
      },
    }]);
  } finally { pr.cleanup(); }
});

test('/merge reads the configuration from the default branch, not the pull request', async () => {
  const config = (areas, ci) => `${JSON.stringify({ v: 1, criticalAreas: areas, ciFiles: ci, mcpServers: [], webDomains: [] })}\n`;
  const pr = await remoteWithPr({
    base: { '.claude/wheelhouse.json': config([{ name: 'money', paths: ['src/money/**'], checks: [] }], ['ci/**']) },
    // The pull request's own configuration drops both, and adds a rule of its own.
    change: (w) => write(w, {
      '.claude/wheelhouse.json': config([], ['src/**']),
      'src/money/a.js': 'a\n', 'ci/run.sh': 'x\n', 'src/other.js': 'b\n',
    }),
  });
  try {
    await merging(pr, fakeAdapter(pr.head), [{
      before: () => { reviewed(pr.head); approved(pr.head); },
      async after(answer) {
        assert.equal(answer.ok, true);
        assert.deepEqual(answer.guardrailPaths, ['.claude/wheelhouse.json', 'ci/run.sh']);
        assert.deepEqual(answer.criticalAreas, ['money']);
      },
    }]);
  } finally { pr.cleanup(); }
});

test('/merge refuses when the fetched head differs from the head the host reports', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { 'src/a.js': 'a\n' }) });
  try {
    const other = 'f'.repeat(40);
    const adapter = fakeAdapter(other);
    await merging(pr, adapter, [{
      before: () => reviewed(other),
      async after(answer) {
        assert.equal(answer.ok, false);
        // Nor can it be told whether the head is up to date.
        assert.deepEqual(answer.reasons, ['no approval of fffffff', UNCHECKED, UNREADABLE]);
        assert.deepEqual(adapter.merges, []);
      },
    }]);
  } finally { pr.cleanup(); }
});

test('/merge treats unreadable changes or configuration as touching the guardrails', async () => {
  // A malformed configuration on the default branch; and no pull request ref on the host.
  const bad = await remoteWithPr({ base: { '.claude/wheelhouse.json': '{ nope' }, change: (w) => write(w, { 'src/a.js': 'a\n' }) });
  const missing = await remoteWithPr({ change: (w) => write(w, { 'src/a.js': 'a\n' }), ref: 'refs/heads/feature' });
  try {
    for (const pr of [bad, missing]) {
      const adapter = fakeAdapter(pr.head);
      // With no pull request ref, whether the head is up to date can't be told either.
      const behind = pr === missing ? [UNCHECKED] : [];
      await merging(pr, adapter, [
        {
          before: () => reviewed(pr.head),
          async after(answer) {
            assert.equal(answer.ok, false);
            assert.deepEqual(answer.reasons, [`no approval of ${pr.head.slice(0, 7)}`, ...behind, UNREADABLE]);
            assert.deepEqual([answer.guardrailPaths, answer.criticalAreas], [[], []]);
            assert.deepEqual(adapter.merges, []);
          },
        },
        // With the director's approval the merge goes ahead, once the head can be read.
        {
          before: () => approved(pr.head),
          async after(answer) {
            if (pr === missing) assert.deepEqual(answer.reasons, [UNCHECKED, UNREADABLE]);
            else assert.equal(answer.ok, true);
          },
        },
      ]);
    }
  } finally { bad.cleanup(); missing.cleanup(); }
});

test('/merge answers carry the empty findings when it fails before reading the files', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { 'src/a.js': 'a\n' }) });
  try {
    await merging(pr, fakeAdapter(pr.head, { prState: async () => { throw new Error('the host is down'); } }), [{
      async after(answer) { assert.deepEqual(answer, { ok: false, refused: 'the host is down', guardrailPaths: [], criticalAreas: [] }); },
    }, {
      body: { number: 0 },
      async after(answer) { assert.deepEqual([answer.ok, answer.guardrailPaths, answer.criticalAreas], [false, [], []]); },
    }]);
  } finally { pr.cleanup(); }
});

test('changedPaths reads GitLab\'s merge request ref, and finds the paths from the merge base', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { 'docs/a.md': 'a\n', 'dir with space/é.txt': 'b\n' }), ref: 'refs/merge-requests/7/head' });
  const home = await project(pr.remote);
  try {
    // The default branch moves on after the branch was made: its change is not the pull request's.
    await g(pr.work, 'checkout', '-q', 'main');
    write(pr.work, { 'later.txt': 'x\n' });
    await g(pr.work, 'add', '-A');
    await g(pr.work, 'commit', '-q', '-m', 'Later');
    await g(pr.work, 'push', '-q', 'origin', 'main');
    const mirror = path.join(home, 'mirror.git');
    await run('git', ['init', '-q', '--bare', mirror]);
    await run('git', ['config', 'remote.origin.url', pr.remote.url], { cwd: mirror });
    const git = (file, args, options = {}) => run(file, args, { ...options, env: { GIT_TERMINAL_PROMPT: '0' } });
    const found = await changedPaths({ mirror, host: 'gitlab', number: 7, headSha: pr.head, defaultBranch: 'main', run: git });
    assert.deepEqual([...found.paths].sort(), ['dir with space/é.txt', 'docs/a.md']);
    assert.deepEqual(found.config, { ...readConfig(null), plugin: false });
    // Once the default branch holds a plugin manifest, the project is a plugin, whose parts are guardrails.
    write(pr.work, { '.claude-plugin/plugin.json': '{"name":"p"}\n' });
    await g(pr.work, 'add', '-A');
    await g(pr.work, 'commit', '-q', '-m', 'A plugin');
    await g(pr.work, 'push', '-q', 'origin', 'main');
    assert.equal((await changedPaths({ mirror, host: 'gitlab', number: 7, headSha: pr.head, defaultBranch: 'main', run: git })).config.plugin, true);
    await assert.rejects(changedPaths({ mirror, host: 'github', number: 7, headSha: pr.head, defaultBranch: 'main', run: git }), /fetching the pull request failed/);
    await assert.rejects(changedPaths({ mirror, host: 'gitlab', number: 7, headSha: 'a'.repeat(40), defaultBranch: 'main', run: git }), /fetched head is not the head the host reported/);
  } finally { pr.cleanup(); fs.rmSync(home, { recursive: true, force: true }); }
});
