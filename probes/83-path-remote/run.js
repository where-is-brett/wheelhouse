// probes/83-path-remote/run.js
// Check 83: a lane on a folder whose only remote is a plain path (spec section 5.3, facts A10 and A11). A scratch
// project, with a bare mirror beside it and `worktree.remote` naming the path, runs a workflow of the quick lane's
// shape on the scratch Archon: a bash step writes the order into the run's artefacts, one step on the small model
// changes the code and commits, a bash step runs the done check, and a bash step pushes the branch, as the helper's
// `host.push` will. Then the probe reads what Archon named the project, where the artefacts went and what clean-up
// leaves. A second run with no remote at all is the control. If the path is refused, `https` tries the fallback: a
// made-up https address with an `insteadOf` rule, as hosted projects have.
//
//   node probes/83-path-remote/run.js [path|none|https]...      default: none path
//
// Nothing outside the scratch folder under the temporary folder is written. Archon's home is the scratch one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archonEnv, archonRun, installScratch } from '../lib/archon.js';
import { assertUnderTmp } from '../lib/scratch.js';
import { run, withoutGitVars } from '../../scripts/lib/run.js';

const ROOT = path.join(os.tmpdir(), 'wheelhouse-archon-checks-83');
const claudeBin = path.join(os.homedir(), '.local', 'bin', 'claude');
const GIT_SETTINGS = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=probe', '-c', 'user.email=probe@wheelhouse.invalid'];
const MADE_UP = 'https://home.invalid/check/83.git';

const WORKFLOW = `# .archon/workflows/check-83-quick.yaml
# The quick lane's shape, for check 83.
name: check-83-quick
description: Check 83. One small change on a folder whose only remote is a path.
model: small
effort: low
nodes:
  - id: order
    bash: |
      printf 'Add subtract(a, b) to src/add.js\\n' > "$ARTIFACTS_DIR/order.txt"
      echo "artefacts: $ARTIFACTS_DIR"
      echo "folder: $PWD"
      echo "base: $BASE_BRANCH"
  - id: implement
    depends_on: [order]
    prompt: |
      Read $ARTIFACTS_DIR/order.txt and do what it says, with one test in tests/add.test.js. Then run
      \`git add -A\` and \`git commit -m "Add subtract"\`. Do nothing else: don't push and don't touch other files.
  - id: tests
    depends_on: [implement]
    bash: |
      set -e
      node --test >&2
      [ -z "$(git status --porcelain)" ]
      git log --oneline "$BASE_BRANCH"..HEAD
  - id: push
    depends_on: [tests]
    bash: |
      set -e
      branch=$(git rev-parse --abbrev-ref HEAD)
      git push -q "$(git config --get worktree.probe.remote)" "HEAD:refs/heads/$branch"
      echo "pushed $branch"
`;

const SEED = {
  'src/add.js': "// src/add.js\nexport const add = (a, b) => a + b;\n",
  'tests/add.test.js': "// tests/add.test.js\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.js';\n\ntest('add', () => assert.equal(add(1, 2), 3));\n",
  'package.json': '{ "name": "check-83", "private": true, "type": "module" }\n',
  '.gitignore': '.wheelhouse/\n',
  '.archon/workflows/check-83-quick.yaml': WORKFLOW,
};

const git = async (cwd, ...args) => {
  const got = await run('/usr/bin/git', [...GIT_SETTINGS, ...args], { cwd, baseEnv: withoutGitVars(process.env) });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')}: ${got.stderr || got.stdout}`);
  return got.stdout.trim();
};

function listed(dir, depth = 5, base = dir) {
  if (!fs.existsSync(dir) || depth === 0) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return [path.relative(base, full), ...(e.isDirectory() ? listed(full, depth - 1, base) : [])];
  });
}

async function scene(name, remote) {
  const place = path.join(ROOT, name);
  assertUnderTmp(place);
  const proj = path.join(place, 'project');
  const mirror = path.join(place, 'mirror.git');
  fs.mkdirSync(proj, { recursive: true });
  await git(proj, 'init', '-q', '-b', 'main');
  const config = ['worktree:', '  path: .wheelhouse/worktrees'];
  if (remote !== 'none') config.push('  remote: wheelhouse', '  baseBranch: main');
  const files = { ...SEED, '.archon/config.yaml': `${config.join('\n')}\n` };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true });
    fs.writeFileSync(path.join(proj, rel), text);
  }
  await git(proj, 'add', '-A');
  await git(proj, 'commit', '-qm', 'The scratch project');
  if (remote !== 'none') {
    await git(place, 'clone', '-q', '--bare', '--no-hardlinks', proj, mirror);
    await git(proj, 'remote', 'add', 'wheelhouse', remote === 'https' ? MADE_UP : mirror);
    if (remote === 'https') await git(proj, 'config', `url.${mirror}.insteadOf`, MADE_UP);
    await git(proj, 'config', 'worktree.probe.remote', 'wheelhouse');
  }
  return { proj, mirror };
}

const short = (text) => String(text ?? '').replaceAll(ROOT, '<scratch>').replaceAll(os.homedir(), '~');

async function lane(name, remote) {
  const { proj, mirror } = await scene(name, remote);
  const env = archonEnv({ home: path.join(ROOT, 'home'), bunDir: path.join(ROOT, 'bun'), claudeBin, nodeDir: path.dirname(process.execPath), baseEnv: withoutGitVars(process.env) });
  const archon = (args, timeoutMs = 600000) => archonRun(args, { env, cwd: proj, bin: path.join(ROOT, 'bin', 'archon'), timeoutMs });
  const report = { scene: name, remote };
  const before = new Set(listed(path.join(ROOT, 'home', 'workspaces')));
  const branch = `check-83-${name}`;
  const started = await archon(['workflow', 'run', 'check-83-quick', '--branch', branch, '--json', 'go']);
  report.run = { code: started.code, stdout: short(started.stdout).slice(-1500), stderr: short(started.stderr).slice(-800) };
  report.runs = short((await archon(['workflow', 'runs', '--json'], 60000)).stdout).slice(0, 1800);
  report.projects = short((await archon(['project', 'list'], 60000)).stdout).slice(0, 800);
  report.isolation = short((await archon(['isolation', 'list'], 60000)).stdout).slice(0, 800);
  report.workspaceAdded = listed(path.join(ROOT, 'home', 'workspaces')).filter((f) => !before.has(f)).slice(0, 40);
  report.worktrees = short(await git(proj, 'worktree', 'list'));
  report.remotes = short(await git(proj, 'remote', '-v'));
  if (remote !== 'none') {
    report.mirrorBranches = await git(mirror, 'for-each-ref', '--format=%(refname:short) %(objectname:short)');
    report.projectBranches = await git(proj, 'for-each-ref', '--format=%(refname:short)', 'refs/heads');
    const completed = await archon(['complete', branch], 120000);
    report.complete = { code: completed.code, said: short(`${completed.stdout}\n${completed.stderr}`).slice(-500) };
    report.beforeMerge = { worktrees: short(await git(proj, 'worktree', 'list')), mirror: await git(mirror, 'for-each-ref', '--format=%(refname:short)') };
    // The merge, as the local queue will make it: the branch's commit lands on the main line the mirror holds.
    await git(mirror, 'update-ref', 'refs/heads/main', `refs/heads/${branch}`);
    await git(proj, 'fetch', '-q', 'wheelhouse');
    const merged = await archon(['complete', branch], 120000);
    report.completeAfterMerge = { code: merged.code, said: short(`${merged.stdout}\n${merged.stderr}`).slice(-300) };
    report.afterComplete = { worktrees: short(await git(proj, 'worktree', 'list')), branches: await git(proj, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'), mirror: await git(mirror, 'for-each-ref', '--format=%(refname:short)'), isolation: short((await archon(['isolation', 'list'], 60000)).stdout).slice(0, 400), left: fs.existsSync(path.join(proj, '.wheelhouse')) ? listed(path.join(proj, '.wheelhouse'), 3) : [] };
  }
  return report;
}

if (!fs.existsSync(path.join(ROOT, 'bin', 'archon'))) await installScratch({ root: ROOT, claudeBin });
const asked = process.argv.slice(2);
for (const remote of asked.length > 0 ? asked : ['none', 'path']) {
  const name = `${remote}-${Date.now().toString(36)}`;
  process.stdout.write(`${JSON.stringify(await lane(name, remote), null, 2)}\n`);
}
