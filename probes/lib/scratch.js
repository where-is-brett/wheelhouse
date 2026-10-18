// probes/lib/scratch.js
// Throwaway projects for probes, always under the system's temporary folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function tmpRoots() {
  const tmp = path.resolve(os.tmpdir());
  return [tmp, fs.realpathSync(tmp)];
}

export function assertUnderTmp(dir) {
  const resolved = path.resolve(dir);
  const inside = tmpRoots().some((root) => resolved !== root && resolved.startsWith(root + path.sep));
  if (!inside) throw new Error(`Refusing to touch ${resolved}: it is outside the temporary folder`);
}

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

export async function makeScratchProject({ name, settings, files = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wheelhouse-probe-${name}-`));
  assertUnderTmp(dir);
  git(dir, ['init', '--quiet']);
  const all = { ...files };
  if (settings) all[path.join('.claude', 'settings.json')] = JSON.stringify(settings, null, 2) + '\n';
  for (const [relative, content] of Object.entries(all)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  git(dir, ['add', '--all']);
  git(dir, [
    '-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid',
    'commit', '--quiet', '--allow-empty', '-m', 'Scratch project for a probe',
  ]);
  return {
    dir,
    async cleanup() {
      assertUnderTmp(dir);
      await fs.promises.rm(dir, { recursive: true, force: true });
    },
  };
}
