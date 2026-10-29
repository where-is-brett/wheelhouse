// tests/e2e/engine-quick.test.js
// The quick lane end to end (Archon design, sections 7.2, 7.5, 9 and 12.4): the quick lane's recording plays through
// the fake engine and the real helper, with the host stood in and gh refused by the guard, which notes each call. The pack's own steps are run as the pack runs
// them, against the helper: the order is fetched by the run's id, the pull request is pushed and opened, each review
// is signed from the engine's record, the broker forwards the pull request's calls and refuses a merge without the
// permit, the preview is copied into the record, the work is handed to the merge queue once approved, and one lesson
// is written.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../helpers/host-stand-ins.js';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { run } from '../../scripts/lib/run.js';
import { engineDir, stateDir } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { listEvents } from '../../scripts/state/events.js';
import { enrol, makeSigningKey } from '../../scripts/state/signing.js';
import { fakeEngine, loadRecordings } from '../../scripts/engine/fake.js';
import { workOrder } from '../../scripts/engine/order.js';
import { withTicket } from '../../scripts/engine/ticket.js';
import { buildPack } from '../../scripts/engine/pack-build.js';
import { makePreview } from '../../scripts/engine/preview.js';
import { main as reviewSign } from '../../scripts/engine/review-sign.js';
import { main as markReady } from '../../scripts/engine/ready.js';
import { main as lessonStep } from '../../scripts/engine/lesson.js';
import { makeBareRemote, g } from '../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../helpers/homes.js';
import { writeFiles } from '../helpers/lineage.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));
waitLongerOnTheHelper();

const P = 'o__p';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const recordings = { 'quick-lane': loadRecordings(path.join(import.meta.dirname, '..', 'fixtures', 'engine'))['quick-lane'] };

// The host as the helper's adapter sees it, over the bare repository: pull requests opened from branches it holds.
function standInHost(remoteUrl) {
  const prs = new Map();
  const comments = [];
  const headOf = async (branch) => {
    const found = await run('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: remoteUrl });
    return found.code === 0 ? found.stdout.trim() : null;
  };
  return {
    prs,
    comments,
    defaultBranch: async () => 'main',
    openRequests: async () => [...prs.entries()].filter(([, pr]) => pr.state === 'open').map(([number, pr]) => ({ number, branch: pr.head, fork: false })),
    openPr: async ({ head, base, title, body }) => {
      if (await headOf(head) === null) throw new Error(`the host has no branch ${head}`);
      prs.set(prs.size + 1, { head, base, title, body, state: 'open' });
      return { number: prs.size };
    },
    updatePr: async ({ number }) => ({ number }),
    branchHead: headOf,
    prState: async (number) => ({ number, headSha: await headOf(prs.get(number).head), headRef: prs.get(number).head, baseRef: 'main', mergeable: 'yes', state: 'open', body: '' }),
    previewUrl: async () => 'https://pr-1.preview.example.com',
    verdictComment: async ({ number, id, body }) => { comments.push({ number, id, body }); return { id: id ?? 500 }; },
    ciState: async (sha) => ({ sha, state: 'pending' }),
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

function stubSpawn() {
  return (command, args) => {
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    return child;
  };
}

test('the quick lane runs from its work order to the merge queue and a lesson, through the helper', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const seed = tempFolder('wh-seed-');
  await g(seed, 'init', '-q', '-b', 'main');
  writeFiles(seed, { 'README.md': 'The product.\n', 'src/price.js': 'export const price = (c) => c / 100;\n' });
  await g(seed, 'add', '-A');
  await g(seed, 'commit', '-q', '-m', 'The product');
  await g(seed, 'push', '-q', remote.url, 'HEAD:refs/heads/main');
  const checkout = fs.realpathSync.native(tempFolder('wh-main-'));
  await g(path.dirname(checkout), 'clone', '-q', remote.url, checkout);

  const home = shortHome();
  const host = standInHost(remote.url);
  const frozen = tempFolder('wh-frozen-');
  const engine = fakeEngine({ recordings, artefacts: tempFolder('wh-artefacts-'), source: frozen });
  try {
    await as(home, async () => {
      writeProject(P, { folder: checkout, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      enrol({ ...makeSigningKey(), enrolledAt: '2026-10-30T00:00:00.000Z' });
      // The installed pack, and the copy the engine froze for the run: the same, so its reviews are trusted.
      buildPack({ out: path.join(engineDir(), 'pack') });
      buildPack({ out: path.join(frozen, 'project') });
      const helper = await startHelper({
        run: hostGuard, address: testAddress(home), adapterFor: async () => host, envFor: async () => ({}),
        spawn: stubSpawn(), engineFor: (project) => (project === P ? engine : null),
      });
      try {
        const client = helperClient({ address: helper.address });
        assert.deepEqual(await client.state.clone({ project: P }), { ok: true });
        assert.equal((await client.lock.take({ project: P })).result.taken, true);

        // The order step: the run starts, and its order is the helper's, fetched by the run's id.
        const order = workOrder({ work: { id: 'card-20', lane: 'quick', goal: 'Show prices with two decimals', done: [{ test: 'prices' }], visible: true }, config: { pages: ['/'] } });
        const { runId } = await helper.engine.start({ project: P, order });
        // The run's steps carry its ticket, from its artefacts folder; a call without it gets nothing.
        const art = engine.artefactsOf(runId);
        const steps = withTicket(client, ['--artefacts', art]);
        assert.equal((await steps.engine.order({ runId })).order.goal, 'Show prices with two decimals');
        assert.equal((await client.engine.order({ runId })).ok, false);

        // The build, in the run's worktree on its own branch.
        const worktree = path.join(checkout, '.worktrees', 'wh-card-20');
        await g(checkout, 'worktree', 'add', '-q', '-b', 'wh/card-20', worktree);
        fs.writeFileSync(path.join(worktree, 'src', 'price.js'), 'export const price = (c) => (c / 100).toFixed(2);\n');
        await g(worktree, 'commit', '-q', '-am', 'Show prices with two decimals');
        const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim();
        // The lenses step records the commit the reviews then read, from the worktree.
        engine.setOutput(runId, 'lenses', JSON.stringify({ security: false, design: true, head, clean: true }));

        // The pull-request step: pushed from the worktree and opened, through the helper.
        const opened = await steps.engine.openPr({ runId, cwd: worktree, title: 'Show prices with two decimals', body: 'Prices show two decimals.' });
        assert.deepEqual(opened, { ok: true, branch: 'wh/card-20', pr: 1, head });
        engine.setOutput(runId, 'open-pr', JSON.stringify({ branch: opened.branch, pr: opened.pr, head }));

        // Archon's git reads come from the helper's fetch mirror, which holds the pushed branch; no key is handed out.
        assert.deepEqual(await client.broker.refresh({ cwd: worktree }), { ok: true });
        const mirror = path.join(engineDir(), 'mirrors', `${P}.git`);
        assert.equal((await run('git', ['rev-parse', 'refs/heads/wh/card-20'], { cwd: mirror })).stdout.trim(), head);
        assert.equal((await run('git', ['config', '--get-regexp', 'remote'], { cwd: mirror })).stdout.trim(), '', 'the mirror names no remote and holds no key');
        // Its HEAD names the host's default branch, which Archon reads as the base of a run's worktree.
        assert.match((await run('git', ['ls-remote', '--symref', mirror, 'HEAD'])).stdout, /^ref: refs\/heads\/main\tHEAD$/m);

        // The broker: the pull request's own calls are forwarded; a merge without the permit never is.
        const view = await client.broker.gh({ argv: ['pr', 'view', '1', '--json', 'body'], cwd: worktree });
        assert.doesNotMatch(view.stderr, /broker refused/);
        const edit = await client.broker.gh({ argv: ['pr', 'edit', '1', '--body', 'Prices show two decimals.'], cwd: worktree });
        assert.doesNotMatch(edit.stderr, /broker refused/);
        const merge = await client.broker.gh({ argv: ['pr', 'merge', '1', '--squash', '--match-head-commit', head], cwd: worktree });
        assert.equal(merge.code, 1);
        assert.match(merge.stderr, /refused/);
        // The guard refuses gh and notes each call: the two the broker forwarded, and nothing else. They are taken
        // off its log, which must end empty.
        assert.deepEqual(hostLog.map((line) => line.split(' ').slice(0, 3).join(' ')), ['gh pr view', 'gh pr edit']);
        hostLog.length = 0;

        // The sign step: each lens that ran is signed from the engine's record, and the verdict is posted once.
        const signed = [];
        assert.equal(await reviewSign(['--run', runId, '--artefacts', art], { client, out: (line) => signed.push(line) }), 0);
        assert.deepEqual(JSON.parse(signed.at(-1)), { clean: true });
        assert.equal(host.comments.length, 1);
        assert.match(host.comments[0].body, new RegExp(`Reviewed commit: \`${head}\``));
        // Signed CLEAN, but shown first: the broker still refuses a merge until the director approves.
        const signedMerge = await client.broker.gh({ argv: ['pr', 'merge', '1', '--squash', '--match-head-commit', head], cwd: worktree });
        assert.match(signedMerge.stderr, /director's approval/);

        // The preview step: the pictures go to the run's artefacts, and the helper copies them into the record.
        const out = path.join(engine.artefactsOf(runId), 'preview');
        const made = await makePreview({
          runId, out, cwd: worktree, base: 'main', client: steps, browser: '/chrome',
          picture: async ({ out: file }) => { fs.writeFileSync(file, PNG); return { ok: true }; },
        });
        assert.equal(made.pictures, 2);
        const records = () => listEvents(stateDir(P), { report: () => {} });
        const preview = records().find((e) => e.kind === 'preview');
        assert.equal(preview.data.head, head);
        assert.deepEqual(fs.readdirSync(preview.data.folder).sort(), ['home-1280x800.png', 'home-390x844.png', 'notes.json']);
        assert.ok(!preview.data.folder.startsWith(out), 'the record keeps its own copy, apart from the run\'s artefacts');

        // Shown first: not ready until the director approves.
        const early = [];
        assert.equal(await markReady(['--run', runId, '--artefacts', art], { client, out: (line) => early.push(line) }), 1);
        assert.match(early.join('\n'), /shown first/);
        const ask = engine.watch('0').events.find((e) => e.type === 'ask');
        assert.deepEqual(engine.act(runId, { answer: { ask: ask.id, choice: 'approve' } }), { ok: true });
        assert.equal(await markReady(['--run', runId, '--artefacts', art], { client, out: () => {} }), 0);
        assert.deepEqual(engine.calls.find((c) => c.call === 'handOver').item.pr, 1);

        // The lesson step: one lesson, however often it is asked.
        assert.equal(await lessonStep(['--run', runId, '--artefacts', art], { client, out: () => {} }), 0);
        assert.equal(await lessonStep(['--run', runId, '--artefacts', art], { client, out: () => {} }), 0);
        const lessons = records().filter((e) => e.kind === 'lesson');
        assert.equal(lessons.length, 1);
        assert.equal(lessons[0].data.work, 'card-20');
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
