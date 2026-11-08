// probes/haiku-trial/stage-plugin.js
// Stages a copy of this checkout's plugin, without the probes and tests, as a scratch marketplace the trial installs from.
// It installs nothing: the install lines are returned for a run to execute after the director's go.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeScratchMarketplace } from '../lib/marketplace.js';

export const MARKETPLACE_NAME = 'wheelhouse-trial';
export const PLUGIN_NAME = 'wheelhouse';
const EXCLUDED = ['probes', 'tests'];
const IDENTITY = ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', '-c', 'commit.gpgsign=false'];

function must(got, what) {
  if (got?.status !== 0) throw new Error(`${what} failed: ${String(got?.stderr ?? got?.error?.message ?? '').trim()}`);
  return String(got.stdout ?? '').trim();
}

// `run(command, args, options)` is spawnSync-shaped; tests inject it.
export async function stagePlugin({ repo, out, run = spawnSync }) {
  const pluginDir = path.join(out, 'plugin');
  const tarball = path.join(out, 'plugin.tar');
  fs.mkdirSync(pluginDir, { recursive: true });
  must(run('git', ['-C', repo, 'archive', '--format=tar', '-o', tarball, 'HEAD', '--', '.', ...EXCLUDED.map((d) => `:(exclude)${d}`)], { encoding: 'utf8' }), 'git archive');
  must(run('tar', ['-xf', tarball, '-C', pluginDir], { encoding: 'utf8' }), 'tar');
  fs.rmSync(tarball, { force: true });

  // The marketplace pins a plugin source by ref and commit, so the staged copy gets a commit of its own.
  const git = (...args) => must(run('git', ['-C', pluginDir, ...IDENTITY, ...args], { encoding: 'utf8' }), `git ${args[0]}`);
  git('init', '--quiet', '-b', 'main');
  git('add', '--all');
  git('commit', '--quiet', '-m', 'Stage the plugin for the Haiku trial');
  const sha = git('rev-parse', 'HEAD');

  const marketplace = await makeScratchMarketplace({
    name: MARKETPLACE_NAME,
    plugins: [{ name: PLUGIN_NAME, source: { source: 'url', url: pathToFileURL(pluginDir).href, ref: 'main', sha } }],
  });
  return { pluginDir, marketplaceDir: marketplace.dir, marketplaceName: `wheelhouse-probe-${MARKETPLACE_NAME}` };
}

// The lines a run executes after the go. `configDir`, when given, keeps the install out of the director's own configuration.
export function installCommand({ marketplaceDir, configDir, claude = 'claude' }) {
  const prefix = configDir ? ['env', `CLAUDE_CONFIG_DIR=${configDir}`, claude] : [claude];
  return [
    [...prefix, 'plugin', 'marketplace', 'add', marketplaceDir],
    [...prefix, 'plugin', 'install', `${PLUGIN_NAME}@wheelhouse-probe-${MARKETPLACE_NAME}`],
  ];
}
