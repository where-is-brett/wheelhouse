// tests/helpers/checks-world.js
// A hosted project with no CI, for the tests of checks on this computer: the real helper and fake engine, a bare repository
// as the host, the statuses the host would hold, and a check that is the real one on the Mac and a stand-in elsewhere.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { commandDigest } from '../../scripts/checks/record.js';
import { STATUS_CONTEXT } from '../../scripts/checks/where.js';
import { fakeEngine, loadRecordings } from '../../scripts/engine/fake.js';
import { buildPack } from '../../scripts/engine/pack-build.js';
import { withTicket } from '../../scripts/engine/ticket.js';
import { main as reviewSign } from '../../scripts/engine/review-sign.js';
import { readConfig } from '../../scripts/gate/guardrails.js';
import { run } from '../../scripts/lib/run.js';
import { engineDir } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { enrol, makeSigningKey } from '../../scripts/state/signing.js';
import { makeBareRemote, g } from './git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from './homes.js';
import { writeFiles } from './lineage.js';
import { stubSpawn, standInHost } from './engine-e2e.js';
import { guardedRun } from './stood-in.js';
import { until } from './until.js';

export const P = 'o__p';
export const COMMAND = '! grep -q broken src/price.js';
const CONFIG = JSON.stringify({ ...readConfig(null), testCommand: COMMAND });
const recordings = { 'quick-lane': loadRecordings(path.join(import.meta.dirname, '..', 'fixtures', 'engine'))['quick-lane'] };

// The stand-in check reads the commit as the real one would see it.
const standInCheck = (remote) => async ({ commit, main }) => {
  const text = await run('git', ['show', `${commit}:src/price.js`], { cwd: remote });
  return { commit, command: commandDigest(COMMAND), result: /broken/.test(text.stdout) ? 'failed' : 'passed', minutes: 0, tail: 'the tests said so', ...(main ? { clean: true } : {}) };
};

// checksWorld(fn, { files, host }) gives `fn` the world: the helper, its client, the host's stand-in, and the steps a run takes.
export async function checksWorld(fn, { files = {}, host: more = {}, check } = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const seed = tempFolder('wh-seed-');
  await g(seed, 'init', '-q', '-b', 'main');
  writeFiles(seed, { 'README.md': 'The product.\n', 'src/price.js': 'export const price = (c) => c / 100;\n', '.claude/wheelhouse.json': CONFIG, ...files });
  await g(seed, 'add', '-A');
  await g(seed, 'commit', '-q', '-m', 'The product');
  await g(seed, 'push', '-q', remote.url, 'HEAD:refs/heads/main');
  const checkout = fs.realpathSync.native(tempFolder('wh-main-'));
  await g(path.dirname(checkout), 'clone', '-q', remote.url, checkout);

  const home = shortHome();
  const frozen = tempFolder('wh-frozen-');
  const engine = fakeEngine({ recordings, artefacts: tempFolder('wh-artefacts-'), source: frozen });
  const statuses = [];
  // The host's own tools never run: the guard refuses them and notes what the broker forwarded.
  const forwarded = [];
  const merged = [];
  const stand = standInHost(remote.url);
  const contextsOf = (sha) => statuses.filter((s) => s.sha === sha).map((s) => ({ name: STATUS_CONTEXT, state: s.state }));
  const host = {
    ...stand,
    setStatus: async (post) => { statuses.push(post); return { ok: true }; },
    checkContexts: async (sha) => contextsOf(sha),
    ...more,
  };
  try {
    await as(home, async () => {
      writeProject(P, { folder: checkout, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      enrol({ ...makeSigningKey(), enrolledAt: '2026-10-30T00:00:00.000Z' });
      buildPack({ out: path.join(engineDir(), 'pack') });
      buildPack({ out: path.join(frozen, 'project') });
      const given = check ?? (process.platform === 'darwin' ? {} : { check: standInCheck(remote.url) });
      const helper = await startHelper({
        run: guardedRun(run, { log: forwarded }), address: testAddress(home), adapterFor: async () => host, envFor: async () => ({}), spawn: stubSpawn(),
        engineFor: (project) => (project === P ? engine : null), ...given,
      });
      const client = helperClient({ address: helper.address });
      await client.state.clone({ project: P });
      await client.lock.take({ project: P });

      // Commits `text` as the run's change and takes it through the run's pull-request step.
      const open = async (runId, branch, text) => {
        const worktree = path.join(checkout, '.worktrees', branch.replaceAll('/', '-'));
        if (!fs.existsSync(worktree)) await g(checkout, 'worktree', 'add', '-q', '-b', branch, worktree);
        fs.writeFileSync(path.join(worktree, 'src', 'price.js'), text);
        await g(worktree, 'commit', '-q', '-am', 'A change');
        const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim();
        engine.setOutput(runId, 'lenses', JSON.stringify({ security: false, design: false, head, clean: true }));
        const art = engine.artefactsOf(runId);
        const opened = await withTicket(client, ['--artefacts', art]).engine.openPr({ runId, cwd: worktree, title: 'A change', body: 'A change.' });
        assert.equal(opened.ok, true, opened.refused);
        await run('git', ['update-ref', `refs/pull/${opened.pr}/head`, head], { cwd: remote.url });
        engine.setOutput(runId, 'open-pr', JSON.stringify({ branch: opened.branch, pr: opened.pr, head }));
        return { ...opened, worktree, art };
      };
      const sign = (runId, art) => reviewSign(['--run', runId, '--artefacts', art], { client, out: () => {} });
      const merge = (pr, head, worktree) => client.broker.gh({ argv: ['pr', 'merge', String(pr), '--squash', '--match-head-commit', head], cwd: worktree });
      // Ticks until a commit has the state, so a check that takes its time on a busy computer is waited for.
      const reported = (sha, state) => until(async () => {
        await helper.engine.tick();
        return statuses.some((s) => s.sha === sha && s.state === state);
      }, { what: `a ${state} status on ${sha.slice(0, 7)}`, within: 30000 });
      try {
        await fn({ helper, client, host, stand, engine, statuses, merged, forwarded, remote, checkout, open, sign, merge, reported });
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
