// tests/e2e/copilot-engine.test.js
// A Copilot project with real users, merged on the build engine (Task B4): the fake engine runs the quick lane, the helper
// is the real one, and GitHub is stood in. The merge permit refuses until the person has approved the head on GitHub, a
// commit after the approval takes it away, and the merge passes with it. The audit report then shows the level and no gaps,
// and one gap after a merge made outside. No GitLab, no Middle or Full tier, and no Copilot call: the switch is set here.
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
import { listEvents, makeEvent, eventPath } from '../../scripts/state/events.js';
import { enrol, makeSigningKey, readEnrolled, sign } from '../../scripts/state/signing.js';
import { fakeEngine, loadRecordings } from '../../scripts/engine/fake.js';
import { workOrder } from '../../scripts/engine/order.js';
import { withTicket } from '../../scripts/engine/ticket.js';
import { buildPack } from '../../scripts/engine/pack-build.js';
import { main as reviewSign } from '../../scripts/engine/review-sign.js';
import { auditReport } from '../../scripts/audit/report.js';
import { makeBareRemote, g } from '../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../helpers/homes.js';
import { writeFiles } from '../helpers/lineage.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran beyond the ones the test noted'));
waitLongerOnTheHelper();

const P = 'o__p';
const COMPUTER = 'abcd1234';
const recordings = { 'quick-lane': loadRecordings(path.join(import.meta.dirname, '..', 'fixtures', 'engine'))['quick-lane'] };

// GitHub as the helper's adapter sees it, over the bare repository, with the pull request's reviews kept by the test.
function standInGithub(remoteUrl) {
  const prs = new Map();
  const given = [];
  const headOf = async (branch) => {
    const found = await run('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: remoteUrl });
    return found.code === 0 ? found.stdout.trim() : null;
  };
  return {
    prs,
    given,
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
    previewUrl: async () => null,
    verdictComment: async ({ id }) => ({ id: id ?? 500 }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    checkContexts: async () => [{ name: 'ci', state: 'success' }],
    requiredChecks: async () => ['ci'],
    reviews: async () => given,
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

function stubSpawn() {
  return () => {
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    return child;
  };
}

test('a Copilot project with real users merges on the engine only with the person\'s approval on GitHub', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const seed = tempFolder('wh-seed-');
  await g(seed, 'init', '-q', '-b', 'main');
  writeFiles(seed, {
    'README.md': 'The product.\n',
    // CI runs on the host, so the project's checks are the host's.
    '.github/workflows/ci.yml': 'name: ci\non: [pull_request]\njobs: {}\n',
    'src/price.js': 'export const price = (c) => c / 100;\n',
    '.claude/wheelhouse.json': `${JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], agents: { [COMPUTER]: 'copilot' } })}\n`,
  });
  await g(seed, 'add', '-A');
  await g(seed, 'commit', '-q', '-m', 'The product');
  await g(seed, 'push', '-q', remote.url, 'HEAD:refs/heads/main');
  const checkout = fs.realpathSync.native(tempFolder('wh-main-'));
  await g(path.dirname(checkout), 'clone', '-q', remote.url, checkout);

  const home = shortHome();
  fs.writeFileSync(path.join(home, 'computer.json'), JSON.stringify({ id: COMPUTER }));
  const host = standInGithub(remote.url);
  const frozen = tempFolder('wh-frozen-');
  const engine = fakeEngine({ recordings, artefacts: tempFolder('wh-artefacts-'), source: frozen });
  try {
    await as(home, async () => {
      // Real users: the project's working copy says it is launched.
      fs.mkdirSync(path.join(checkout, '.claude'), { recursive: true });
      const config = JSON.parse(fs.readFileSync(path.join(checkout, '.claude', 'wheelhouse.json'), 'utf8'));
      fs.writeFileSync(path.join(checkout, '.claude', 'wheelhouse.json'), `${JSON.stringify({ ...config, launched: true })}\n`);
      writeProject(P, { folder: checkout, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      enrol({ ...makeSigningKey(), enrolledAt: '2026-11-01T00:00:00.000Z' });
      buildPack({ out: path.join(engineDir(), 'pack') });
      buildPack({ out: path.join(frozen, 'project') });
      const helper = await startHelper({
        run: hostGuard, address: testAddress(home), adapterFor: async () => host, envFor: async () => ({}),
        spawn: stubSpawn(), engineFor: (project) => (project === P ? engine : null),
        // The switch for GitHub's route, set by this test alone; and the review kind a Copilot project counts, which is
        // off until its own sitting.
        approvalReady: () => true,
        reviewModules: (agent) => (agent === 'copilot' ? { kinds: () => ['clean-session'] } : null),
      });
      try {
        const client = helperClient({ address: helper.address });
        assert.deepEqual(await client.state.clone({ project: P }), { ok: true });
        assert.equal((await client.lock.take({ project: P })).result.taken, true);

        // The run: ordered, built in its worktree, its pull request opened, its review signed from the engine's record.
        const order = workOrder({ work: { id: 'card-30', lane: 'quick', goal: 'Show prices with two decimals', done: [{ test: 'prices' }], visible: false }, config: { pages: [] } });
        const { runId } = await helper.engine.start({ project: P, order });
        const art = engine.artefactsOf(runId);
        const steps = withTicket(client, ['--artefacts', art]);
        const worktree = path.join(checkout, '.worktrees', 'wh-card-30');
        await g(checkout, 'worktree', 'add', '-q', '-b', 'wh/card-30', worktree);
        fs.writeFileSync(path.join(worktree, 'src', 'price.js'), 'export const price = (c) => (c / 100).toFixed(2);\n');
        await g(worktree, 'commit', '-q', '-am', 'Show prices with two decimals');
        const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim();
        engine.setOutput(runId, 'lenses', JSON.stringify({ security: false, design: true, head, clean: true }));
        const opened = await steps.engine.openPr({ runId, cwd: worktree, title: 'Show prices with two decimals', body: 'Prices show two decimals.' });
        assert.equal(opened.pr, 1);
        engine.setOutput(runId, 'open-pr', JSON.stringify({ branch: opened.branch, pr: opened.pr, head }));
        assert.equal(await reviewSign(['--run', runId, '--artefacts', art], { client, out: () => {} }), 0);
        hostLog.length = 0;

        // The director's own signed approval of the head, which a merge of this work needs on every host.
        const folder = stateDir(P);
        const write = (kind, data) => {
          const event = sign(makeEvent({ kind, data, now: () => new Date('2026-11-02T02:00:00.000Z') }));
          const file = path.join(folder, eventPath(event));
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
        };
        write('approval', { pr: 1, commit: head, proof: 'window' });
        const merge = (sha) => client.broker.gh({ argv: ['pr', 'merge', '1', '--squash', '--match-head-commit', sha], cwd: worktree });
        const reached = () => hostLog.splice(0).map((line) => line.split(' ').slice(0, 3).join(' '));

        // The review and the director's approval are signed, but the person hasn't approved on GitHub.
        const refused = await merge(head);
        assert.equal(refused.code, 1);
        assert.match(refused.stderr, /the director's approval on GitHub of .* isn't there/);
        assert.deepEqual(reached(), [], 'the refused merge never reached gh');

        // The person's own review of the head is what counts: the bot's and a stranger's do not.
        host.given.push({ login: 'wheelhouse-helper[bot]', type: 'Bot', state: 'APPROVED', commit: head, at: '2026-11-02T01:00:00Z' });
        host.given.push({ login: 'stranger', type: 'User', state: 'APPROVED', commit: head, at: '2026-11-02T01:01:00Z' });
        assert.match((await merge(head)).stderr, /approval on GitHub/);
        host.given.push({ login: 'o', type: 'User', state: 'APPROVED', commit: head, at: '2026-11-02T01:05:00Z' });

        // A commit added after the approval takes it away: the approval was of another head.
        const later = 'f'.repeat(40);
        const stale = await merge(later);
        assert.equal(stale.code, 1);
        assert.deepEqual(reached(), []);

        // With the approval of the head, the permit passes and the call goes to gh (which the guard notes and refuses).
        const passed = await merge(head);
        assert.doesNotMatch(passed.stderr, /approval on GitHub of/);
        assert.deepEqual(reached(), ['gh pr merge'], 'only the passing merge reached gh');

        // The audit report: the level and the approval recorded, no gap; then a merge made outside the record, one gap.
        const records = listEvents(stateDir(P), { report: () => {} });
        assert.ok(records.some((e) => e.kind === 'review' && e.data.commit === head));
        write('level', { level: 'guarded', pr: 1 });
        const events = listEvents(folder, { report: () => {} });
        const merged = (number, sha) => ({ number, title: `Change ${number}`, url: null, mergedAt: '2026-11-02T03:00:00.000Z', mergedBy: 'o', author: 'wh-bot', target: 'main', sha, mergeCommit: null });
        const history = (requests) => ({
          async mergedRequests() { return requests; },
          async pipelinesFor() { return [{ id: 1, status: 'success', source: 'push', ref: 'refs/heads/main', sha: null }]; },
          async protectionEvents() { return { source: 'audit-events', events: [] }; },
          async prState() { return { state: 'merged' }; },
        });
        const args = { events, since: '2026-11-01T00:00:00.000Z', now: '2026-11-03T00:00:00.000Z', enrolled: readEnrolled() };
        const clean = await auditReport({ ...args, host: history([merged(1, head)]) });
        assert.deepEqual(clean.gaps, []);
        assert.equal(clean.rows.length, 1);
        assert.equal(clean.rows[0].level, 'guarded', 'the row shows the level');
        const outside = 'e'.repeat(40);
        const gapped = await auditReport({ ...args, host: history([merged(1, head), merged(2, outside)]) });
        assert.deepEqual(gapped.gaps.map((x) => x.kind), ['no-approval']);
        assert.equal(gapped.gaps[0].pr, 2);
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
