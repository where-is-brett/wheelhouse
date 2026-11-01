// scripts/eval/places.js
// Where a project of scenarios 76 to 81 lives (local checks spec, section 11), for both worlds (engine-world.js and
// archon-world.js): `no-ci`, on a stand-in host with no Actions, whose checks run on this computer; or `git-alone`, in a
// folder with no host, kept in a home here. The project is small and its tests are real, so a real check runs them under
// the sandbox: `page.test.mjs` reads README.md, and fails when the page says OUT_OF_ORDER.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adapterOf } from '../host/adapter-for.js';
import { addFolderRemote } from '../host/local/folder.js';
import { homeDir, makeHome } from '../host/local/home.js';
import { localChanges } from '../host/local/changes.js';
import { keepSeenMain } from '../host/local/merge.js';
import { STATUS_CONTEXT } from '../checks/where.js';
import { readConfig } from '../gate/guardrails.js';
import { run as realRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { engineDir, stateDir } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';

export const PLACES = Object.freeze(['no-ci', 'git-alone']);
export const TEST_COMMAND = 'node --test';
export const OUT_OF_ORDER = 'Out of order';

// The line real and stood-in runs add to README.md (TINY_GOAL).
export const EVAL_LINE = 'Made for the evaluation.';
export const TINY_GOAL = `Add the line '${EVAL_LINE}' to the end of README.md`;

const PAGE_TEST = `// page.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the page is in order', () => {
  assert.doesNotMatch(fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8'), /${OUT_OF_ORDER}/);
});
`;

// The project's files, `more` added: what makes it a project whose tests can be run.
export const placeFiles = (more = {}) => ({
  'README.md': '# p\n\nA page for the evaluation.\n',
  'page.test.mjs': PAGE_TEST,
  '.claude/wheelhouse.json': `${JSON.stringify({ ...readConfig(null), testCommand: TEST_COMMAND }, null, 2)}\n`,
  ...more,
});

export function writeFiles(folder, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(folder, ...name.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// Git on one of the world's own repositories. It made them, here, so their settings need no look.
const worldGit = (cwd, { run = realRun, env = {} } = {}) => safeGit({ run, cwd, env, reach: 'local', look: 'never' });

// The host with no Actions, over the bare repository at `bare`: pull requests from the branches it holds, and the commit
// statuses Wheelhouse posts, which are all that ever reports on a commit. `run` runs git.
export function noActionsHost(bare, { run = realRun } = {}) {
  const prs = new Map();
  const statuses = [];
  const git = (args) => worldGit(bare, { run })(args, { input: '' });
  const headOf = async (branch) => {
    const found = await git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
    return found.code === 0 ? found.stdout.trim() : null;
  };
  const stateOf = (sha) => statuses.filter((s) => s.sha === sha).at(-1)?.state ?? 'pending';
  return {
    statuses,
    defaultBranch: async () => 'main',
    openRequests: async () => [...prs.entries()].map(([number, pr]) => ({ number, branch: pr.head, fork: false })),
    async openPr({ head, base, title, body }) {
      const number = prs.size + 1;
      prs.set(number, { head, base, title, body });
      await git(['update-ref', `refs/pull/${number}/head`, await headOf(head)]);
      return { number };
    },
    updatePr: async ({ number }) => ({ number }),
    branchHead: headOf,
    prState: async (number) => ({ number, headSha: await headOf(prs.get(number)?.head), headRef: prs.get(number)?.head, baseRef: 'main', mergeable: 'yes', state: 'open', body: '' }),
    verdictComment: async ({ id }) => ({ id: id ?? 500 }),
    ciState: async (sha) => ({ sha, state: stateOf(sha) }),
    setStatus: async (post) => { statuses.push(post); return { ok: true }; },
    checkContexts: async (sha) => statuses.filter((s) => s.sha === sha).map((s) => ({ name: STATUS_CONTEXT, state: s.state })),
    requiredChecks: async () => [],
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

// Takes a project in git alone from its folder to its home, as setup's step 3 does, once its record is written and open.
export async function keepHere({ project, folder }) {
  await makeHome({ project, folder });
  await addFolderRemote({ folder, mirror: path.join(engineDir(), 'mirrors', `${project}.git`) });
}

// The helper's adapter for a place: the world's stand-in on a host, and the real local adapter in git alone.
export const placeAdapter = ({ world, run }) => (project, { env, write }) => (readProject(project)?.host === 'local' ? adapterOf(readProject(project), { run, env, write }) : world.host);

const WHO = ['-c', 'user.name=Evaluation', '-c', 'user.email=eval@example.invalid'];

// Git on the world's own repositories, which must go through.
export async function must(args, cwd, { input = '', env = {} } = {}) {
  const got = await worldGit(cwd, { env })(args, { input });
  if (got.code !== 0) throw new Error(`git ${args[0]} failed in the evaluation's project: ${String(got.stderr).trim()}`);
  return String(got.stdout).trim();
}

// What scenarios 76 to 81 ask of a world, the same in both. Adds to `world`, whose project is `project`.
export function placeVerbs(world, { project }) {
  const verdicts = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(stateDir(project), '..', 'engine', 'verdicts.json'), 'utf8'));
    } catch {
      return {};
    }
  };
  return Object.assign(world, {
    // The dispatcher's own file: what it keeps of a change sent back.
    dispatch() {
      try {
        return JSON.parse(fs.readFileSync(path.join(stateDir(project), '..', 'engine', 'dispatch.json'), 'utf8'));
      } catch {
        return {};
      }
    },
    readyOf: (pr) => verdicts().ready?.[pr] ?? null,
    changeOf: (n) => localChanges({ project }).changeOf(n),
    openChanges: () => localChanges({ project }).openChanges(),
    homeMain: () => must(['rev-parse', 'refs/heads/main'], homeDir(project)),
    folderMain: () => must(['rev-parse', 'refs/heads/main'], world.folder),
    // The signed checks on the project's record, oldest first.
    checks: () => world.records('check').map((e) => e.data),
    // A commit on the folder's main branch, as an agent working there would make it.
    async commitInFolder(file, text) {
      fs.writeFileSync(path.join(world.folder, file), text);
      await must(['add', file], world.folder);
      await must([...WHO, 'commit', '-q', '-m', 'A change made in the folder'], world.folder);
      return world.folderMain();
    },
    // A new main version in the home holding README.md with `line` added, kept as the helper's own, as a merge's is: a
    // scenario's way to give the main line a version whose check fails, or the fix that mends it, with no run spent.
    async land(line) {
      const home = homeDir(project);
      const main = await world.homeMain();
      const page = await must(['show', `${main}:README.md`], home);
      const blob = await must(['hash-object', '-w', '--stdin'], home, { input: `${page.split(OUT_OF_ORDER).join('In order')}\n${line}\n` });
      const made = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-index-'));
      const index = path.join(made, 'index');
      try {
        const indexed = { env: { GIT_INDEX_FILE: index } };
        await must(['read-tree', main], home, indexed);
        await must(['update-index', '--add', '--cacheinfo', `100644,${blob},README.md`], home, indexed);
        const tree = await must(['write-tree'], home, indexed);
        const commit = await must([...WHO, 'commit-tree', tree, '-p', main, '-m', 'A new main version'], home);
        await must(['update-ref', 'refs/heads/main', commit, main], home);
        keepSeenMain(project, commit);
        return commit;
      } finally {
        fs.rmSync(made, { recursive: true, force: true });
      }
    },
  });
}
