// tests/helpers/git-fixture.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../scripts/lib/run.js';

// A bare repository under the temporary folder, for tests to push to and clone from.
// With `repo` ('owner/name'), it sits at <root>/owner/name.git, so its address names the repository.
export async function makeBareRemote({ repo } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-remote-'));
  const dir = repo ? path.join(root, `${repo}.git`) : path.join(root, 'remote.git');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const made = await run('git', ['init', '--bare', dir]);
  if (made.code !== 0) throw new Error('git init --bare failed');
  return { url: dir, root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// The injected push for tests: plain `git push`, with git's refusal to fast-forward
// mapped to `rejected: 'non-fast-forward'`.
export async function push(dir, branch) {
  const r = await run('git', ['push', 'origin', branch], { cwd: dir, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (r.code === 0) return { ok: true };
  if (/non-fast-forward|fetch first|\[rejected\]/.test(r.stderr)) return { ok: false, rejected: 'non-fast-forward' };
  return { ok: false, rejected: 'other' };
}

// Runs git in `dir` with a fixed author and no prompting; returns its trimmed output or throws.
export async function g(dir, ...args) {
  const r = await run('git', ['-c', 'user.name=T', '-c', 'user.email=t@invalid', ...args], { cwd: dir, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// What a caller adds to let the state and profile git reach a local-path remote (a stand-in host):
// the same transport setup's reaching() asks for.
export const LOCAL_PATHS = { GIT_ALLOW_PROTOCOL: 'https:file' };
