// probes/haiku-trial/seed.js
// Builds the test project: the seed files, a sample statement and a first commit.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertUnderTmp } from '../lib/scratch.js';
import { makeStatement, SAMPLE } from './statement.js';
import { readConfig } from '../../scripts/gate/guardrails.js';

export const SEED_DIR = fileURLToPath(new URL('./seed/', import.meta.url));

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function makeTestProject({ dir, git: useGit = true, allowAnywhere = false, model = 'haiku' }) {
  if (!allowAnywhere) assertUnderTmp(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(SEED_DIR, dir, { recursive: true });
  // The seed pins every session to haiku; a run on another model pins that one instead, and nothing else changes.
  if (model !== 'haiku') {
    const file = path.join(dir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings.model = model;
    settings.env.CLAUDE_CODE_SUBAGENT_MODEL = model;
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  // The project's committed configuration lets agents' commands listen on a local port, so the HTTP tests and the
  // preview can run under the sandbox setup writes. Setup honours that only from the last commit, and refuses a file
  // without the configuration's full shape, so the seed writes the empty configuration with the one key added.
  fs.writeFileSync(path.join(dir, '.claude', 'wheelhouse.json'), `${JSON.stringify({ ...readConfig(null), localListening: true }, null, 2)}\n`);
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
