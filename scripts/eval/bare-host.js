// scripts/eval/bare-host.js
// A stand-in for the repository's host in an evaluation run, for the scenarios that watch what a
// session does to the host itself (tests/eval/main/18): a bare repository holding `main` and one
// open pull request at the ref GitHub keeps for it (refs/pull/<n>/head), and a way to read every
// ref it holds before and after the session. It reaches no real host and holds no credential. A
// push or a merge to it shows as a ref that moved or appeared.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from '../lib/run.js';
import { assertUnderTmp } from '../../probes/lib/scratch.js';

async function git(dir, ...args) {
  const result = await run('git', ['-c', 'user.name=Wheelhouse eval', '-c', 'user.email=eval@wheelhouse.invalid', ...args], {
    cwd: dir, input: '', env: { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function write(root, relative, text) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

// Makes the host under `root` (a folder under the temporary folder): `main` with `baseFiles`, and
// pull request `number` holding `prFiles` on top of it. Resolves with { url, head, refs() }: `url`
// is the bare repository's path, `head` the pull request's head commit, and `refs()` every ref it
// holds now and its commit, as { ref: commit }.
export async function startBareHost({ root, number = 1, baseFiles = { 'README.md': 'The product.\n' }, prFiles = {} }) {
  assertUnderTmp(root);
  const bare = path.join(root, 'host.git');
  const work = path.join(root, 'work');
  fs.mkdirSync(work, { recursive: true });
  await git(root, 'init', '--bare', '--quiet', '--initial-branch=main', bare);
  await git(work, 'init', '--quiet', '--initial-branch=main');
  for (const [name, text] of Object.entries(baseFiles)) write(work, name, text);
  await git(work, 'add', '--all');
  await git(work, 'commit', '--quiet', '-m', 'The project so far');
  await git(work, 'push', '--quiet', bare, 'HEAD:refs/heads/main');
  for (const [name, text] of Object.entries(prFiles)) write(work, name, text);
  await git(work, 'add', '--all');
  await git(work, 'commit', '--quiet', '--allow-empty', '-m', 'The pull request');
  await git(work, 'push', '--quiet', bare, `HEAD:refs/pull/${number}/head`);
  const head = await git(work, 'rev-parse', 'HEAD');
  // Read at once, not waited for, so a scenario's pass (which runs at once) can read it.
  const refs = () => {
    const out = execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: bare, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return Object.fromEntries(out.split('\n').filter(Boolean).map((line) => line.split(' ')));
  };
  return { url: bare, head, refs };
}

// The refs that differ between two snapshots ({ ref: commit }): [{ ref, was, now }], a missing side null.
export function movedRefs(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter((ref) => before[ref] !== after[ref])
    .map((ref) => ({ ref, was: before[ref] ?? null, now: after[ref] ?? null }));
}
