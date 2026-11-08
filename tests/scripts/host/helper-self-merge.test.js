// tests/scripts/host/helper-self-merge.test.js
// Work that shows nothing users see merges by itself once its checks pass and its review is clean (design section 8 of the director's
// way of working). The helper judges that from the change itself, never from what the caller says; visible, unsure or director-level
// work, and work intake marked visible, waits for the director's approval with its proof note. Self-merge lowers only the approval.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper, changedPaths } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeEvent, eventPath, listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { matchingBody } from '../../helpers/provenance.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const BODY = matchingBody();
const T0 = new Date('2026-11-08T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

async function remoteWithPr({ base = { 'README.md': 'x\n' }, change }) {
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
  await g(work, 'push', '-q', 'origin', `${head}:refs/pull/7/head`);
  return { remote, work, head, cleanup: () => { remote.cleanup(); fs.rmSync(work, { recursive: true, force: true }); } };
}

async function project(remote) {
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder: path.join(home, 'work'), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-08T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(0) })).taken, true);
  });
  return home;
}

function record(kind, data, ms = 1000) {
  const event = makeEvent({ kind, data, now: at(ms) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
// Intake's mark for the work the `feature/x` branch belongs to: visible or not.
const marked = (visible, ms) => record('work', { id: 'x', title: 'X', lane: 'small', visible, dependsOn: [] }, ms);
const reviewed = (head) => record('review', { pr: 7, commit: head, verdict: 'CLEAN' });
const approved = (head) => record('approval', { pr: 7, commit: head });
const selfMerged = () => listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'self-merged');

function fakeAdapter(head, { headRef = 'feature/x', body = BODY } = {}) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: head, headRef, baseRef: 'main', mergeable: 'mergeable', state: 'open', body }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
  };
}

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

const NEEDS = (head) => `no approval of ${head.slice(0, 7)}`;

test('internal-only work merges itself and records self-merged', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { 'src/a.js': 'export const a = 1;\n', 'docs/notes.md': 'notes\n' }) });
  try {
    const adapter = fakeAdapter(pr.head);
    await merging(pr, adapter, [{
      before: () => { marked(false); reviewed(pr.head); },
      async after(answer) {
        assert.equal(answer.ok, true, JSON.stringify(answer));
        assert.deepEqual(adapter.merges, [{ number: 7, sha: pr.head }]);
        const kept = selfMerged();
        assert.equal(kept.length, 1);
        assert.deepEqual({ pr: kept[0].data.pr, commit: kept[0].data.commit, reason: kept[0].data.reason, paths: kept[0].data.paths }, { pr: 7, commit: pr.head, reason: 'internal', paths: 2 });
      },
    }]);
  } finally { pr.cleanup(); }
});

test('internal-only work still needs its signed clean review, and one the caller asked approval for still needs it', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { 'src/a.js': 'export const a = 1;\n' }) });
  try {
    const adapter = fakeAdapter(pr.head);
    await merging(pr, adapter, [
      { before: () => marked(false), body: {}, async after(a) { assert.equal(a.ok, false); assert.match(a.reasons.join(';'), /no CLEAN review/); assert.deepEqual(selfMerged(), []); } },
      { before: () => reviewed(pr.head), body: { approvalRequired: true }, async after(a) { assert.deepEqual(a.reasons, [NEEDS(pr.head)]); assert.deepEqual(selfMerged(), []); } },
    ]);
    assert.deepEqual(adapter.merges, []);
  } finally { pr.cleanup(); }
});

test('visible or unsure work waits for approval with its proof note', async () => {
  for (const file of ['public/site.css', 'src/model.xyz', 'src/tide.js']) {
    const pr = await remoteWithPr({ change: (w) => write(w, { [file]: file.endsWith('.js') ? 'export const m = "Tide chart";\n' : 'x\n' }) });
    try {
      const adapter = fakeAdapter(pr.head);
      await merging(pr, adapter, [
        {
          before: () => reviewed(pr.head),
          async after(answer) {
            assert.equal(answer.ok, false, file);
            assert.deepEqual(answer.reasons, [NEEDS(pr.head)], file);
            assert.deepEqual(answer.needs, { approval: { pr: 7, commit: pr.head } });
            assert.equal(answer.proof, BODY, 'the proof note goes with the wait');
            assert.deepEqual(adapter.merges, []);
          },
        },
        {
          before: () => approved(pr.head),
          async after(answer) {
            assert.equal(answer.ok, true, file);
            assert.deepEqual(selfMerged(), [], 'an approved change did not merge by itself');
          },
        },
      ]);
    } finally { pr.cleanup(); }
  }
});

test('the caller cannot say a change is not visible or skip the diff', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { 'public/site.css': 'a { color: red }\n' }) });
  try {
    const adapter = fakeAdapter(pr.head);
    const lies = {
      approvalRequired: false, visible: false, unsure: false, intakeVisible: false, directorLevel: [], diff: '', paths: ['docs/notes.md'],
      changedPaths: ['docs/notes.md'], batch: true, selfMerge: true, touchesGuardrails: false, reviewRequired: false,
    };
    await merging(pr, adapter, [{
      before: () => reviewed(pr.head),
      body: lies,
      async after(answer) {
        assert.equal(answer.ok, false);
        assert.deepEqual(answer.reasons, [NEEDS(pr.head)]);
        assert.deepEqual(adapter.merges, []);
        assert.deepEqual(selfMerged(), []);
      },
    }]);
  } finally { pr.cleanup(); }
});

test('work intake marked visible waits even if the change looks internal', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { 'src/a.js': 'export const a = 1;\n' }) });
  try {
    const adapter = fakeAdapter(pr.head, { headRef: 'feature/w-tide-1' });
    await merging(pr, adapter, [{
      before: () => {
        record('work', { id: 'w-tide-1', title: 'Tides', lane: 'small', visible: true, dependsOn: [] });
        reviewed(pr.head);
      },
      async after(answer) {
        assert.equal(answer.ok, false, JSON.stringify(answer));
        assert.deepEqual(answer.reasons, [NEEDS(pr.head)]);
        assert.deepEqual(selfMerged(), []);
      },
    }]);
  } finally { pr.cleanup(); }
});

test('a missing intake mark counts as visible, a lowered mark does not count, and a branch no work owns waits', async () => {
  const cases = [
    ['no work record for a feature branch', 'feature/x', () => {}],
    ['a mark lowered after it was raised', 'feature/x', () => { marked(true, 1000); marked(false, 2000); }],
    ['a branch that is no work\'s', 'someone/tide-fix', () => {}],
  ];
  for (const [what, headRef, setup] of cases) {
    const pr = await remoteWithPr({ change: (w) => write(w, { 'src/a.js': 'export const a = 1;\n' }) });
    try {
      const adapter = fakeAdapter(pr.head, { headRef });
      await merging(pr, adapter, [{
        before: () => { setup(); reviewed(pr.head); },
        async after(answer) {
          assert.equal(answer.ok, false, `${what}: ${JSON.stringify(answer)}`);
          assert.deepEqual(answer.reasons, [NEEDS(pr.head)], what);
          assert.deepEqual(selfMerged(), [], what);
        },
      }]);
    } finally { pr.cleanup(); }
  }
});

test('a change to development dependencies alone is internal through the helper, and any other change to package.json waits', async () => {
  const pkg = (dev, name = 'harbour-demo') => `${JSON.stringify({ name, dependencies: { 'tide-chart': '^1.0.0' }, devDependencies: { eslint: dev } })}\n`;
  for (const [what, name, ok] of [['development dependencies only', 'harbour-demo', true], ['the name too', 'harbour-demo-2', false]]) {
    const pr = await remoteWithPr({ base: { 'package.json': pkg('^8.0.0') }, change: (w) => write(w, { 'package.json': pkg('^9.0.0', name) }) });
    try {
      const adapter = fakeAdapter(pr.head);
      await merging(pr, adapter, [{
        before: () => { marked(false); reviewed(pr.head); },
        async after(answer) {
          assert.equal(answer.ok, ok, `${what}: ${JSON.stringify(answer)}`);
          assert.equal(selfMerged().length, ok ? 1 : 0, what);
        },
      }]);
    } finally { pr.cleanup(); }
  }
});

test('director-level facts make it wait', async () => {
  const pkg = (v) => `${JSON.stringify({ name: 'harbour-demo', dependencies: { 'tide-chart': v } })}\n`;
  const pr = await remoteWithPr({ base: { 'package.json': pkg('^1.0.0') }, change: (w) => write(w, { 'package.json': pkg('^2.0.0') }) });
  try {
    const adapter = fakeAdapter(pr.head);
    await merging(pr, adapter, [{
      before: () => reviewed(pr.head),
      async after(answer) {
        assert.equal(answer.ok, false);
        assert.deepEqual(answer.reasons, [NEEDS(pr.head)]);
        assert.deepEqual(selfMerged(), []);
      },
    }]);
  } finally { pr.cleanup(); }
});

test('a diff that can\'t be read is no diff: the change waits as unsure', async () => {
  const pr = await remoteWithPr({ change: (w) => write(w, { 'src/a.js': 'export const a = 1;\n' }) });
  try {
    const mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-mirror-'));
    await g(mirror, 'init', '-q', '--bare');
    await g(mirror, 'remote', 'add', 'origin', pr.remote.url);
    const args = { mirror, host: 'github', number: 7, headSha: pr.head, defaultBranch: 'main' };
    const read = await changedPaths({ ...args, run });
    assert.deepEqual(read.paths, ['src/a.js']);
    assert.match(read.diff, /^diff --git a\/src\/a\.js b\/src\/a\.js/m);
    const failing = (file, a, o) => (a.includes('diff') && a.includes('--unified=0') ? Promise.resolve({ code: 1, stdout: '', stderr: 'no' }) : hostGuard(file, a, o));
    const unread = await changedPaths({ ...args, run: failing });
    assert.equal(unread.diff, null);
    assert.deepEqual(unread.paths, ['src/a.js']);
    fs.rmSync(mirror, { recursive: true, force: true });
  } finally { pr.cleanup(); }
});
