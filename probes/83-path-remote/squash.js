// probes/83-path-remote/squash.js
// Check 83's second question: clean-up after a squash, which is how the local queue merges (spec 7.4). The run's branch keeps
// commits the main version doesn't hold, and `gh pr list` has nothing to say on a project with no host. A workflow of bash
// steps alone makes a commit in Archon's worktree, so no model runs. Each scene moves the mirror's main version by a squash,
// or not at all, and reads what `archon complete` says, and what `--force` leaves of work that was never merged.
//
//   node probes/83-path-remote/squash.js
//
// Nothing outside the scratch folder under the temporary folder is written. Archon's home is the scratch one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archonEnv, archonRun, installScratch } from '../lib/archon.js';
import { assertUnderTmp } from '../lib/scratch.js';
import { run, withoutGitVars } from '../../scripts/lib/run.js';

const ROOT = path.join(os.tmpdir(), 'wheelhouse-archon-checks-83');
const GIT_SETTINGS = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=probe', '-c', 'user.email=probe@wheelhouse.invalid'];

const WORKFLOW = `# .archon/workflows/check-83-squash.yaml
# One commit in the run's worktree, with no model.
name: check-83-squash
description: Check 83. A commit to clean up after.
nodes:
  - id: commit
    bash: |
      set -e
      printf 'one\\n' > work.txt
      git add -A
      git -c user.name=probe -c user.email=probe@wheelhouse.invalid commit -qm 'The run'\\''s work'
      git rev-parse HEAD
`;
const SEED = {
  'README.md': '# Scratch\n',
  '.gitignore': '.wheelhouse/\n',
  '.archon/config.yaml': 'worktree:\n  path: .wheelhouse/worktrees\n  remote: wheelhouse\n  baseBranch: main\n',
  '.archon/workflows/check-83-squash.yaml': WORKFLOW,
};

const git = async (cwd, ...args) => {
  const got = await run('/usr/bin/git', [...GIT_SETTINGS, ...args], { cwd, baseEnv: withoutGitVars(process.env) });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')}: ${got.stderr || got.stdout}`);
  return got.stdout.trim();
};
const short = (text) => String(text ?? '').replaceAll(ROOT, '<scratch>').replaceAll(os.homedir(), '~');

// A squash of `branch` onto the mirror's main version, as the local queue makes one: its tree on a new commit.
async function squash(mirror, branch) {
  const main = await git(mirror, 'rev-parse', 'refs/heads/main');
  const tree = await git(mirror, 'rev-parse', `refs/heads/${branch}^{tree}`);
  const commit = await git(mirror, 'commit-tree', tree, '-p', main, '-m', 'The squash');
  await git(mirror, 'update-ref', 'refs/heads/main', commit, main);
}

async function scene(name, { squashed, fetched, dirty, untracked, ignored, moreWork, flags }) {
  const place = path.join(ROOT, `squash-${name}-${Date.now().toString(36)}`);
  assertUnderTmp(place);
  const proj = path.join(place, 'project');
  const mirror = path.join(place, 'mirror.git');
  fs.mkdirSync(proj, { recursive: true });
  await git(proj, 'init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(SEED)) {
    fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true });
    fs.writeFileSync(path.join(proj, rel), text);
  }
  await git(proj, 'add', '-A');
  await git(proj, 'commit', '-qm', 'The scratch project');
  await git(place, 'clone', '-q', '--bare', '--no-hardlinks', proj, mirror);
  await git(proj, 'remote', 'add', 'wheelhouse', mirror);
  const env = archonEnv({ home: path.join(ROOT, 'home'), bunDir: path.join(ROOT, 'bun'), nodeDir: path.dirname(process.execPath), baseEnv: withoutGitVars(process.env) });
  const archon = (args) => archonRun(args, { env, cwd: proj, bin: path.join(ROOT, 'bin', 'archon'), timeoutMs: 120000 });
  const branch = `check-83-${name}`;
  const started = await archon(['workflow', 'run', 'check-83-squash', '--branch', branch, '--json', 'go']);
  const tree = path.join(proj, '.wheelhouse', 'worktrees', branch);
  const report = { scene: name, started: started.code, worktree: fs.existsSync(tree) };
  await git(proj, 'push', '-q', 'wheelhouse', `refs/heads/${branch}:refs/heads/${branch}`);
  if (squashed) await squash(mirror, branch);
  if (fetched) await git(proj, 'fetch', '-q', 'wheelhouse');
  if (moreWork) {
    fs.writeFileSync(path.join(tree, 'later.txt'), 'never merged\n');
    await git(tree, 'add', '-A');
    await git(tree, 'commit', '-qm', 'Work after the squash');
  }
  if (dirty) fs.writeFileSync(path.join(tree, 'work.txt'), 'changed, uncommitted\n');
  if (untracked) fs.writeFileSync(path.join(tree, 'new.txt'), 'never committed\n');
  if (ignored) fs.writeFileSync(path.join(tree, '.gitignore'), `${fs.readFileSync(path.join(tree, '.gitignore'), 'utf8')}build.out\n`);
  if (ignored) fs.writeFileSync(path.join(tree, 'build.out'), 'ignored\n');
  const done = await archon(['complete', ...flags, branch]);
  report.complete = { code: done.code, said: short(`${done.stdout}\n${done.stderr}`).slice(-600) };
  report.after = {
    worktree: fs.existsSync(tree),
    branch: await git(proj, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'),
    list: short(await git(proj, 'worktree', 'list')),
    isolation: short((await archon(['isolation', 'list'])).stdout).slice(0, 300),
  };
  return report;
}

if (!fs.existsSync(path.join(ROOT, 'bin', 'archon'))) await installScratch({ root: ROOT, claudeBin: path.join(os.homedir(), '.local', 'bin', 'claude') });
const SCENES = {
  squash: { squashed: true, fetched: true, flags: [] },
  'squash-not-fetched': { squashed: true, fetched: false, flags: [] },
  'squash-force': { squashed: true, fetched: true, flags: ['--force'] },
  'unmerged-force': { squashed: false, fetched: true, flags: ['--force'] },
  'later-work-force': { squashed: true, fetched: true, moreWork: true, flags: ['--force'] },
  'dirty-force': { squashed: true, fetched: true, dirty: true, flags: ['--force'] },
  'untracked-force': { squashed: true, fetched: true, untracked: true, flags: ['--force'] },
};
const asked = process.argv.slice(2);
for (const name of asked.length > 0 ? asked : Object.keys(SCENES)) {
  process.stdout.write(`${JSON.stringify(await scene(name, SCENES[name]), null, 2)}\n`);
}
