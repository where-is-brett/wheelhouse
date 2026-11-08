// probes/haiku-trial/stage-plugin.js
// Stages a copy of this checkout's plugin, without the probes and tests, as a scratch marketplace the trial installs from.
// It installs nothing: the install lines are returned for a run to execute after the director's go.
import fs from 'node:fs';
import os from 'node:os';
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
  return { pluginDir, marketplaceDir: marketplace.dir, marketplaceName: `wheelhouse-probe-${MARKETPLACE_NAME}`, sha };
}

export const PLUGIN_ID = `${PLUGIN_NAME}@wheelhouse-probe-${MARKETPLACE_NAME}`;

const claudeOf = ({ configDir, claude = 'claude' }) => (configDir ? ['env', `CLAUDE_CONFIG_DIR=${configDir}`, claude] : [claude]);

// The line that takes out a copy an earlier run installed. `claude plugin install` keeps an installed copy of the same version
// as it is, so without this a later run would test the earlier run's code. It fails when nothing is installed, which is fine.
export function removeCommand({ configDir, claude = 'claude' }) {
  return [...claudeOf({ configDir, claude }), 'plugin', 'uninstall', PLUGIN_ID];
}

// The lines a run executes after the go. `configDir`, when given, keeps the install out of the director's own configuration.
export function installCommand({ marketplaceDir, configDir, claude = 'claude' }) {
  const prefix = claudeOf({ configDir, claude });
  return [
    [...prefix, 'plugin', 'marketplace', 'add', marketplaceDir],
    [...prefix, 'plugin', 'install', PLUGIN_ID],
  ];
}

// Why the installed copy is not the one staged as commit `sha`, or null when it is. Read from Claude Code's own record of
// installed plugins in `configDir` (or ~/.claude).
export function installedProblem({ configDir, sha, home = os.homedir() }) {
  if (typeof sha !== 'string' || sha === '') return 'no staged commit to compare with';
  const file = path.join(configDir || path.join(home, '.claude'), 'plugins', 'installed_plugins.json');
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return `${file} cannot be read`; }
  const copies = (record?.plugins ?? record ?? {})[PLUGIN_ID];
  const copy = Array.isArray(copies) ? copies.find((c) => c?.scope === 'user') ?? copies[0] : null;
  if (!copy) return `${PLUGIN_ID} is not installed`;
  if (copy.gitCommitSha !== sha) return `the installed copy is commit ${copy.gitCommitSha ?? 'unknown'}, not the staged ${sha}`;
  if (typeof copy.installPath !== 'string' || !fs.existsSync(path.join(copy.installPath, '.claude-plugin', 'plugin.json'))) return `the installed copy's folder ${copy.installPath} has no plugin in it`;
  return null;
}
