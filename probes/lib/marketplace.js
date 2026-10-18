// probes/lib/marketplace.js
// A throwaway plugin marketplace for probes: a git repository under the
// system's temporary folder, listing each plugin as a source pinned by ref and
// commit: a GitHub source from { name, repo, ref, sha }, or any other source
// object (such as a url source with a file:// address) from { name, source }.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { assertUnderTmp } from './scratch.js';

const SHA = /^[0-9a-f]{40}$/;

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

function entryFor({ name, repo, ref, sha, source }) {
  if (name && source) {
    if (!source.ref) throw new Error(`Plugin ${name} needs a ref`);
    if (!SHA.test(source.sha ?? '')) throw new Error(`Plugin ${name} needs a sha of 40 lowercase hex characters`);
    return { name, source };
  }
  if (!name || !repo) throw new Error('A marketplace plugin needs a name and a repo');
  if (!ref) throw new Error(`Plugin ${name} needs a ref`);
  if (!SHA.test(sha ?? '')) throw new Error(`Plugin ${name} needs a sha of 40 lowercase hex characters`);
  return { name, source: { source: 'github', repo, ref, sha } };
}

export async function makeScratchMarketplace({ name, plugins }) {
  const entries = plugins.map(entryFor);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wheelhouse-probe-${name}-`));
  assertUnderTmp(dir);
  git(dir, ['init', '--quiet']);
  const manifest = {
    name: `wheelhouse-probe-${name}`,
    owner: { name: 'Wheelhouse probe' },
    plugins: entries,
  };
  const file = path.join(dir, '.claude-plugin', 'marketplace.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  git(dir, ['add', '--all']);
  git(dir, [
    '-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid',
    'commit', '--quiet', '-m', 'Scratch marketplace for a probe',
  ]);
  const marketplace = {
    dir,
    url: pathToFileURL(dir).href,
    async cleanup() {
      assertUnderTmp(marketplace.dir);
      await fs.promises.rm(marketplace.dir, { recursive: true, force: true });
    },
  };
  return marketplace;
}
