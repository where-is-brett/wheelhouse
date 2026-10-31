// tests/helpers/engine-e2e.js
// What the engine's end-to-end tests stand in for (tests/e2e/engine-*.test.js): the code host as the helper's adapter
// sees it, over a bare repository, and the wake process. And a folder with no host at all, for the tests of git alone.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { adapterOf } from '../../scripts/host/adapter-for.js';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { addFolderRemote } from '../../scripts/host/local/folder.js';
import { homeDir, makeHome } from '../../scripts/host/local/home.js';
import { fakeEngine, loadRecordings } from '../../scripts/engine/fake.js';
import { buildPack } from '../../scripts/engine/pack-build.js';
import { readConfig } from '../../scripts/gate/guardrails.js';
import { run } from '../../scripts/lib/run.js';
import { engineDir } from '../../scripts/lib/paths.js';
import { readProject, writeProject } from '../../scripts/lib/projects.js';
import { enrol, makeSigningKey } from '../../scripts/state/signing.js';
import { g } from './git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from './homes.js';
import { writeFiles } from './lineage.js';
import { guardedRun } from './stood-in.js';

// The host as the helper's adapter sees it, over the bare repository: pull requests opened from branches it holds.
export function standInHost(remoteUrl) {
  const prs = new Map();
  const comments = [];
  const headOf = async (branch) => {
    const found = await run('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: remoteUrl });
    return found.code === 0 ? found.stdout.trim() : null;
  };
  return {
    comments,
    defaultBranch: async () => 'main',
    openRequests: async () => [...prs.entries()].map(([number, pr]) => ({ number, branch: pr.head, fork: false })),
    openPr: async ({ head, base, title, body }) => {
      prs.set(prs.size + 1, { head, base, title, body });
      return { number: prs.size };
    },
    updatePr: async ({ number }) => ({ number }),
    branchHead: headOf,
    prState: async (number) => ({ number, headSha: await headOf(prs.get(number).head), headRef: prs.get(number).head, baseRef: 'main', mergeable: 'yes', state: 'open', body: '' }),
    verdictComment: async ({ number, id, body }) => { comments.push({ number, id, body }); return { id: id ?? 500 }; },
    ciState: async (sha) => ({ sha, state: 'pending' }),
    checkContexts: async () => [{ name: 'ci', state: 'pending' }],
    requiredChecks: async () => [],
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

export function stubSpawn() {
  return () => {
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    return child;
  };
}

export const LOCAL_P = 'shop';
export const LOCAL_COMMAND = 'test -f src/price.js';
const CONFIG = JSON.stringify({ ...readConfig(null), testCommand: LOCAL_COMMAND });
const recordings = { 'quick-lane': loadRecordings(path.join(import.meta.dirname, '..', 'fixtures', 'engine'))['quick-lane'] };

// A project with no host: a real folder and home, the real helper and adapter, and the fake engine. No host tool runs: `fn`
// is given the calls that tried in `tools`. `check` stands in for a check, and `askWindow` for the director at the window.
export async function gitAloneWorld(fn, { check, askWindow } = {}) {
  const folder = fs.realpathSync.native(tempFolder('wh-shop-'));
  await g(folder, 'init', '-q', '-b', 'main');
  writeFiles(folder, { 'README.md': 'The product.\n', 'src/price.js': 'export const price = (c) => c / 100;\n', '.gitignore': '.wheelhouse/\n', '.claude/wheelhouse.json': CONFIG });
  await g(folder, 'add', '-A');
  await g(folder, 'commit', '-q', '-m', 'The product');
  const home = shortHome();
  const frozen = tempFolder('wh-frozen-');
  const engine = fakeEngine({ recordings, artefacts: tempFolder('wh-artefacts-'), source: frozen });
  const tools = [];
  const hostGuard = guardedRun(run, { log: tools });
  const adapterFor = (project, { env, write }) => adapterOf(readProject(project), { run: hostGuard, env, write });
  try {
    await as(home, async () => {
      writeProject(LOCAL_P, { folder, remoteUrl: null, host: 'local', repo: `local/${LOCAL_P}`, connection: { mode: 'none' } });
      enrol({ ...makeSigningKey(), enrolledAt: '2026-11-01T00:00:00.000Z' });
      await makeHome({ project: LOCAL_P, folder });
      const mirror = path.join(engineDir(), 'mirrors', `${LOCAL_P}.git`);
      await addFolderRemote({ folder, mirror });
      buildPack({ out: path.join(engineDir(), 'pack') });
      buildPack({ out: path.join(frozen, 'project') });
      const helper = await startHelper({
        run: hostGuard, address: testAddress(home), adapterFor, envFor: async () => ({}), spawn: stubSpawn(),
        engineFor: (project) => (project === LOCAL_P ? engine : null), ...(check ? { check } : {}), ...(askWindow ? { askWindow } : {}),
      });
      const client = helperClient({ address: helper.address });
      await client.state.clone({ project: LOCAL_P });
      // A branch made beside the folder, as a run's worktree is, with one commit of `text`.
      const worktreeWith = async (branch, text) => {
        const worktree = path.join(folder, '.wheelhouse', 'worktrees', branch.replaceAll('/', '-'));
        if (!fs.existsSync(worktree)) await g(folder, 'worktree', 'add', '-q', '-b', branch, worktree);
        fs.writeFileSync(path.join(worktree, 'src', 'price.js'), text);
        await g(worktree, 'commit', '-q', '-am', 'A change');
        return { worktree, head: (await run('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim() };
      };
      try {
        await fn({ helper, client, engine, folder, home: homeDir(LOCAL_P), mirror, tools, worktreeWith });
      } finally {
        await helper.close();
      }
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
