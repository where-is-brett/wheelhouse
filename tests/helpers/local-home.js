// tests/helpers/local-home.js
// A project in git alone for the local host's tests: a real folder with history, a signing key, and git outside any route.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from './homes.js';
import { run, withoutGitVars } from '../../scripts/lib/run.js';
import { enrol, makeSigningKey } from '../../scripts/state/signing.js';

const WHO = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };

export async function git(cwd, args) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(process.env), env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...WHO } });
  assert.equal(got.code, 0, got.stderr);
  return got.stdout.trim();
}

// Adds a commit holding `file` to the repository at `cwd`, and gives it.
export async function commitIn(cwd, file, text = `${file}\n`) {
  fs.writeFileSync(path.join(cwd, file), text);
  await git(cwd, ['add', file]);
  await git(cwd, ['commit', '-q', '-m', `add ${file}`]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

// A folder on `branch` with one commit.
export async function projectFolderWith(branch = 'main') {
  const folder = path.join(tempFolder('wh-local-folder-'), 'shop');
  fs.mkdirSync(folder);
  await git(folder, ['init', '-q', '-b', branch]);
  await commitIn(folder, 'a.txt');
  return folder;
}

// Runs `fn` with a Wheelhouse home of its own whose computer has a signing key.
export async function withKeyedHome(fn) {
  const home = path.join(tempFolder('wh-local-home-'), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}
