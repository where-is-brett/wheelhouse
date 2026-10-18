// tests/helpers/git-fixture.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../scripts/lib/run.js';

// A bare repository under the temporary folder, for tests to push to and clone from.
export async function makeBareRemote() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-remote-'));
  const dir = path.join(root, 'remote.git');
  const made = await run('git', ['init', '--bare', dir]);
  if (made.code !== 0) throw new Error('git init --bare failed');
  return { url: dir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// The injected push for tests: plain `git push`, with git's refusal to fast-forward
// mapped to `rejected: 'non-fast-forward'`.
export async function push(dir, branch) {
  const r = await run('git', ['push', 'origin', branch], { cwd: dir, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (r.code === 0) return { ok: true };
  if (/non-fast-forward|fetch first|\[rejected\]/.test(r.stderr)) return { ok: false, rejected: 'non-fast-forward' };
  return { ok: false, rejected: 'other' };
}
