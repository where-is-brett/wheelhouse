// tests/e2e/engine-bug.test.js
// The bug lane end to end (Archon design, sections 7.2 and 11), on the planted bug of the evaluation's project: the
// bug lane's recording plays through the fake engine and the real helper, with the host stood in and gh refused by the
// guard. The lane's own scripts are run as the pack runs them, in a real worktree: the gate finds no reproduction, the
// reproduce step's test is proved red at its own commit and kept from the engine's record, the build check holds
// until the fix makes it pass and refuses a fix that changes it, the fix is a bug's size, and the reviews are signed
// from the engine's record at the pull request's head. A fix across many files is bigger than a bug.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../helpers/host-stand-ins.js';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { engineDir } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { enrol, makeSigningKey } from '../../scripts/state/signing.js';
import { fakeEngine, loadRecordings } from '../../scripts/engine/fake.js';
import { workOrder } from '../../scripts/engine/order.js';
import { withTicket } from '../../scripts/engine/ticket.js';
import { buildPack } from '../../scripts/engine/pack-build.js';
import { main as reproduce } from '../../scripts/engine/reproduce.js';
import { main as bugCheck } from '../../scripts/engine/bug-check.js';
import { main as bugSize } from '../../scripts/engine/bug-size.js';
import { main as reviewSign } from '../../scripts/engine/review-sign.js';
import { makeBareRemote, g } from '../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../helpers/homes.js';
import { writeFiles } from '../helpers/lineage.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';
import { standInHost, stubSpawn } from '../helpers/engine-e2e.js';
import { runOutsideTests } from '../helpers/outside-tests.js';
import { FILES, FIX, REPORT, REPRODUCTION, REPRODUCTION_FILE, REPRODUCTION_NAME, TEST_COMMAND } from '../eval/build-loop/bug-project.js';

const hostLog = [];
const hostGuard = guardedRun(runOutsideTests, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));
waitLongerOnTheHelper();

const P = 'o__p';
const recordings = { 'bug-lane': loadRecordings(path.join(import.meta.dirname, '..', 'fixtures', 'engine'))['bug-lane'] };
const CLEAN = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 'Reads well and mends the bug.', blocked: false, assumptions: [] });
const CHECK = { test: REPRODUCTION_NAME };

const said = () => {
  const lines = [];
  return { out: (line) => lines.push(line), last: () => JSON.parse(lines.at(-1)), lines };
};

// The evaluation's project on a host stood in by a bare repository, the helper started on it with the fake engine,
// and one bug run started with its worktree: `play(t)` runs the lane's steps.
async function withBugRun(play) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const seed = tempFolder('wh-seed-');
  await g(seed, 'init', '-q', '-b', 'main');
  writeFiles(seed, FILES);
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
        const order = workOrder({ work: { id: 'video-length', lane: 'bug', goal: REPORT.split('\n')[0].replace(/^# /, ''), done: [{ command: 'node --test', expect: 0 }] }, config: { testCommand: TEST_COMMAND } });
        const { runId } = await helper.engine.start({ project: P, order });
        const art = engine.artefactsOf(runId);
        fs.mkdirSync(art, { recursive: true });
        const worktree = path.join(checkout, '.worktrees', 'wh-video-length');
        await g(checkout, 'worktree', 'add', '-q', '-b', 'wh/video-length', worktree);
        const local = { cwd: worktree, run: hostGuard, client };
        const args = ['--run', runId, '--artefacts', art, '--base', 'main'];
        await play({ engine, client, runId, art, worktree, local, args, host, steps: withTicket(client, ['--artefacts', art]) });
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// The reproduce step's work, as its builder does it: the failing test, committed on its own, and its output.
async function reproduceIt({ engine, runId, worktree }) {
  writeFiles(worktree, { [REPRODUCTION_FILE]: REPRODUCTION });
  await g(worktree, 'add', '-A');
  await g(worktree, 'commit', '-q', '-m', 'Reproduce: a 65-second clip shows as 1:5');
  engine.setOutput(runId, 'reproduce', JSON.stringify({ summary: 'The seconds lose their leading zero.', blocked: false, assumptions: [], test: REPRODUCTION_NAME, files: [REPRODUCTION_FILE] }));
}
// A step's exit code, its lines, and its last line read as the JSON a branching step prints (null for a check's line).
async function step(main, argv, local) {
  const s = said();
  const code = await main(argv, { ...local, out: s.out });
  let got = null;
  try { got = s.last(); } catch { got = null; }
  return { code, got, lines: s.lines };
}

test('a planted bug is reproduced red, kept, fixed and its review signed, through the helper', async () => {
  await withBugRun(async (t) => {
    const { engine, runId, worktree, local, args } = t;
    assert.deepEqual((await step(reproduce, ['--gate', ...args], local)).got, { reproduced: false });
    await reproduceIt(t);

    const red = await step(reproduce, ['--red', ...args], local);
    assert.equal(red.got.red, true, red.got.line);
    assert.deepEqual(red.got.check, CHECK);
    engine.setOutput(runId, 'red', JSON.stringify(red.got));
    const kept = await step(reproduce, ['--keep', ...args], local);
    assert.equal(kept.got.kept, true, kept.got.line);
    assert.deepEqual((await t.steps.engine.order({ runId })).order.done.at(-1), CHECK, 'the order carries the reproduction');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t.art, 'order.json'), 'utf8')).done.at(-1), CHECK, 'and so does its copy');
    assert.deepEqual((await step(reproduce, ['--gate', ...args], local)).got, { reproduced: true }, 'a rerun skips the reproduce step');

    const loop = (more = []) => step(bugCheck, [...args, '--most', '5', '--blocked', 'false', ...more], local);
    assert.equal((await loop()).code, 1, 'the bug is still there');
    // A fix that changes the reproduction's test is never done.
    writeFiles(worktree, { [REPRODUCTION_FILE]: REPRODUCTION.replace("'1:05'", "'1:5'") });
    await g(worktree, 'commit', '-q', '-am', 'Expect what the card shows');
    const changed = await loop();
    assert.equal(changed.code, 1);
    assert.ok(changed.lines.some((l) => /reproduction's test changed since it went red/.test(l)), changed.lines.join('\n'));
    await g(worktree, 'revert', '--no-edit', 'HEAD');
    writeFiles(worktree, { 'src/duration.js': FIX });
    await g(worktree, 'commit', '-q', '-am', 'Show a clip\'s seconds with two digits');
    const done = await loop();
    assert.equal(done.code, 0, done.lines.join('\n'));
    const size = await step(bugSize, args, local);
    assert.equal(size.got.blocked, false, size.got.line);

    // The pull request, and the signing from the engine's record at its head.
    const head = (await runOutsideTests('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim();
    engine.setOutput(runId, 'lenses', JSON.stringify({ security: false, design: false, head, clean: true }));
    engine.setOutput(runId, 'review-standards', CLEAN);
    engine.setOutput(runId, 'review-spec', CLEAN);
    const opened = await t.steps.engine.openPr({ runId, cwd: worktree, title: 'Show a clip\'s seconds with two digits', body: 'A 65-second clip shows as 1:05.' });
    assert.deepEqual(opened, { ok: true, branch: 'wh/video-length', pr: 1, head });
    engine.setOutput(runId, 'open-pr', JSON.stringify({ branch: opened.branch, pr: opened.pr, head }));
    assert.deepEqual((await step(reviewSign, ['--run', runId, '--artefacts', t.art], { client: t.client })).got, { clean: true });
    assert.match(t.host.comments[0].body, new RegExp(`Reviewed commit: \`${head}\``));
  });
});

test('a fix across more files than a bug\'s is bigger than a bug', async () => {
  await withBugRun(async (t) => {
    const { engine, runId, worktree, local, args } = t;
    await reproduceIt(t);
    engine.setOutput(runId, 'red', JSON.stringify((await step(reproduce, ['--red', ...args], local)).got));
    assert.equal((await step(reproduce, ['--keep', ...args], local)).got.kept, true);
    const wide = { 'src/duration.js': FIX };
    for (const n of [1, 2, 3, 4, 5]) wide[`src/part-${n}.js`] = `export const part = ${n};\n`;
    writeFiles(worktree, wide);
    await g(worktree, 'add', '-A');
    await g(worktree, 'commit', '-q', '-m', 'A wide fix');
    const size = await step(bugSize, args, local);
    assert.equal(size.got.blocked, true);
    assert.equal(size.got.recommend, 'small');
    assert.match(size.got.question, /changes 6 files/);
  });
});
