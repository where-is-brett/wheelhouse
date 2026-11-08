// probes/haiku-trial/seed.js
// Builds the test project: the seed files, a sample statement and a first commit.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertUnderTmp } from '../lib/scratch.js';
import { makeStatement, SAMPLE } from './statement.js';

export const SEED_DIR = fileURLToPath(new URL('./seed/', import.meta.url));

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function makeTestProject({ dir, git: useGit = true, allowAnywhere = false }) {
  if (!allowAnywhere) assertUnderTmp(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(SEED_DIR, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'sample-statement.csv'), makeStatement(SAMPLE).csv, 'utf8');
  if (!useGit) return { dir, sha: null };
  git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['add', '--all']);
  git(dir, [
    '-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid',
    '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '-m', 'Seed the spending tracker',
  ]);
  return { dir, sha: git(dir, ['rev-parse', 'HEAD']) };
}
