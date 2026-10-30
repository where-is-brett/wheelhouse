// tests/e2e/engine-small.test.js
// The small lane end to end (Archon design, section 7.2): the small lane's recording plays through the fake engine and
// the real helper, with the host stood in and gh refused by the guard. The lane's own scripts are run as the pack runs
// them, in a real worktree: the plan gate finds no plan, the plan's tasks are listed, each task's done check reads the
// plan, the tree and the task's test through the helper's work order, the tasks close clean, the plan is taken out
// before review and still found in the branch's history, the review round closes, and the reviews are signed from the
// engine's record at the pull request's head.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../helpers/host-stand-ins.js';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { run } from '../../scripts/lib/run.js';
import { engineDir } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { enrol, makeSigningKey } from '../../scripts/state/signing.js';
import { fakeEngine, loadRecordings } from '../../scripts/engine/fake.js';
import { workOrder } from '../../scripts/engine/order.js';
import { withTicket } from '../../scripts/engine/ticket.js';
import { buildPack } from '../../scripts/engine/pack-build.js';
import { PLAN_FILE, main as planFile } from '../../scripts/engine/plan-file.js';
import { main as taskCheck } from '../../scripts/engine/task-check.js';
import { main as taskRecord } from '../../scripts/engine/task-record.js';
import { main as tasksDone } from '../../scripts/engine/tasks-done.js';
import { main as unplan } from '../../scripts/engine/unplan.js';
import { main as reviewRound } from '../../scripts/engine/review-round.js';
import { main as reviewSign } from '../../scripts/engine/review-sign.js';
import { makeBareRemote, g } from '../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../helpers/homes.js';
import { writeFiles } from '../helpers/lineage.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';
import { standInHost, stubSpawn } from '../helpers/engine-e2e.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));
waitLongerOnTheHelper();

const P = 'o__p';
const recordings = { 'small-lane': loadRecordings(path.join(import.meta.dirname, '..', 'fixtures', 'engine'))['small-lane'] };
const CLEAN = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 'Reads well and matches the order.', blocked: false, assumptions: [] });

const said = () => {
  const lines = [];
  return { out: (line) => lines.push(line), last: () => JSON.parse(lines.at(-1)), lines };
};

test('the small lane plans, builds and checks each task, takes the plan out and signs its review, through the helper', async () => {
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

        const order = workOrder({ work: { id: 'card-21', lane: 'small', goal: 'Show prices and totals with two decimals', done: [{ test: 'tests/price-check.js' }] }, config: { testCommand: 'node' } });
        const { runId } = await helper.engine.start({ project: P, order });
        const art = engine.artefactsOf(runId);
        fs.mkdirSync(art, { recursive: true });
        const steps = withTicket(client, ['--artefacts', art]);
        assert.equal((await steps.engine.order({ runId })).order.lane, 'small');

        const worktree = path.join(checkout, '.worktrees', 'wh-card-21');
        await g(checkout, 'worktree', 'add', '-q', '-b', 'wh/card-21', worktree);
        const local = { cwd: worktree, run: hostGuard };

        // The plan gate: no plan yet, so the plan step writes one and commits it.
        let s = said();
        assert.equal(await planFile(['--gate', '--base', 'main'], { ...local, out: s.out }), 0);
        assert.deepEqual(s.last(), { planned: false });
        const plan = [
          '# Two decimals', '',
          '- [ ] **Task 1:** Prices show two decimals', '  Test: tests/price-check.js',
          '- [ ] **Task 2:** Totals show two decimals', '',
        ];
        fs.writeFileSync(path.join(worktree, PLAN_FILE), plan.join('\n'));
        await g(worktree, 'add', PLAN_FILE);
        await g(worktree, 'commit', '-q', '-m', 'Plan the work');
        s = said();
        await planFile(['--tasks', '--base', 'main'], { ...local, out: s.out });
        assert.deepEqual(s.last(), ['1', '2']);

        // Task 1: not done until it is ticked, committed and its test passes with the order's test command.
        const check = (n) => taskCheck(['--run', runId, '--artefacts', art, '--base', 'main', '--task', n], { ...local, client, out: () => {} });
        assert.equal(await check('1'), 1);
        writeFiles(worktree, {
          // A plain script, not node --test: under the test runner a nested node --test always ends 0.
          'tests/price-check.js': "import assert from 'node:assert/strict';\nimport { price } from '../src/price.js';\nassert.equal(price(150), '1.50');\n",
          'package.json': '{ "type": "module" }\n',
          [PLAN_FILE]: plan.join('\n').replace('- [ ] **Task 1:**', '- [x] **Task 1:**'),
        });
        assert.equal(await check('1'), 1, 'changes left uncommitted hold the task');
        await g(worktree, 'add', '-A');
        await g(worktree, 'commit', '-q', '-m', 'Test prices for two decimals');
        assert.equal(await check('1'), 1, 'a task whose test fails is not done');
        writeFiles(worktree, { 'src/price.js': 'export const price = (c) => (c / 100).toFixed(2);\n' });
        await g(worktree, 'commit', '-q', '-am', 'Prices show two decimals');
        assert.equal(await check('1'), 0);
        s = said();
        assert.equal(await taskRecord(['--artefacts', art, '--task', '1'], { stdin: JSON.stringify({ summary: 'Done.', blocked: false }), out: s.out }), 0);
        const recorded = s.last();
        assert.equal(recorded.blocked, false);

        // Task 2, which names no test: ticked and committed is done.
        writeFiles(worktree, {
          'src/total.js': "import { price } from './price.js';\nexport const total = (cs) => price(cs.reduce((a, b) => a + b, 0));\n",
          [PLAN_FILE]: fs.readFileSync(path.join(worktree, PLAN_FILE), 'utf8').replace('- [ ] **Task 2:**', '- [x] **Task 2:**'),
        });
        await g(worktree, 'add', '-A');
        await g(worktree, 'commit', '-q', '-m', 'Totals show two decimals');
        assert.equal(await check('2'), 0);
        s = said();
        await planFile(['--gate', '--base', 'main', '--task', '2', '--artefacts', art], { ...local, out: s.out });
        assert.deepEqual(s.last(), { skip: true }, 'a rerun skips a task already done');

        s = said();
        assert.equal(await tasksDone(['--run', runId, '--artefacts', art, '--base', 'main', '--records', JSON.stringify([recorded, { blocked: false, task: '2' }])], { ...local, client, out: s.out }), 0);
        assert.equal(s.last().blocked, false);

        // The plan comes out before review, and a rerun still finds it in the branch's history.
        s = said();
        assert.equal(await unplan(['--base', 'main'], { ...local, out: s.out }), 0);
        assert.deepEqual(s.last(), { removed: true });
        assert.equal(fs.existsSync(path.join(worktree, PLAN_FILE)), false);
        s = said();
        await planFile(['--gate', '--base', 'main'], { ...local, out: s.out });
        assert.deepEqual(s.last(), { planned: true });
        const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim();

        // One review round, clean: the loop closes.
        s = said();
        assert.equal(await reviewRound(['--artefacts', art, '--most', '4', '--standards', CLEAN, '--spec', CLEAN, '--security', '', '--design', '', '--fix', ''], { out: s.out }), 0);
        assert.equal(s.last().done, true);
        assert.equal(s.last().holds, false);

        // The pull request, and the signing from the engine's record at its head.
        engine.setOutput(runId, 'lenses', JSON.stringify({ security: false, design: false, head, clean: true }));
        engine.setOutput(runId, 'review-standards', CLEAN);
        engine.setOutput(runId, 'review-spec', CLEAN);
        const opened = await steps.engine.openPr({ runId, cwd: worktree, title: 'Show prices and totals with two decimals', body: 'Prices and totals show two decimals.' });
        assert.deepEqual(opened, { ok: true, branch: 'wh/card-21', pr: 1, head });
        engine.setOutput(runId, 'open-pr', JSON.stringify({ branch: opened.branch, pr: opened.pr, head }));
        s = said();
        assert.equal(await reviewSign(['--run', runId, '--artefacts', art], { client, out: s.out }), 0);
        assert.deepEqual(s.last(), { clean: true });
        assert.equal(host.comments.length, 1);
        assert.match(host.comments[0].body, new RegExp(`Reviewed commit: \`${head}\``));
        const files = (await run('git', ['ls-tree', '-r', '--name-only', head], { cwd: worktree })).stdout.split('\n');
        assert.ok(!files.includes(PLAN_FILE), 'the pull request\'s head holds no plan');
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
