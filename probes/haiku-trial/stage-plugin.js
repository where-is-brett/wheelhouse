// probes/haiku-trial/stage-plugin.js
// Stages a copy of this checkout's plugin, without this kit (probes/haiku-trial, which holds the held-back checks) and the tests,
// as the marketplace the trial installs from. The copy
// carries the checkout's own .claude-plugin/marketplace.json, named `wheelhouse`, so the trial installs `wheelhouse@wheelhouse`
// and setup finds its pinned plugins (`superpowers@wheelhouse`) as a director's install does: setup's step 1 writes
// `wheelhouse@wheelhouse` into the project's settings and installs the pins from that marketplace.
// It installs nothing: the install lines are returned for a run to execute after the director's go.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const MARKETPLACE_NAME = 'wheelhouse';
export const PLUGIN_NAME = 'wheelhouse';
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
// What earlier kits installed, from a scratch marketplace of their own. Taken out too, so two copies are never on at once.
export const OLD_PLUGIN_IDS = Object.freeze(['wheelhouse@wheelhouse-probe-wheelhouse-trial']);
// The rest of probes/ stays: the helper imports probes/lib/scratch.js (through scripts/eval/harness.js), and a copy without it
// has a helper that cannot start.
const EXCLUDED = ['probes/haiku-trial', 'tests'];
const IDENTITY = ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', '-c', 'commit.gpgsign=false'];

function must(got, what) {
  if (got?.status !== 0) throw new Error(`${what} failed: ${String(got?.stderr ?? got?.error?.message ?? '').trim()}`);
  return String(got.stdout ?? '').trim();
}

// `run(command, args, options)` is spawnSync-shaped; tests inject it.
export async function stagePlugin({ repo, out, run = spawnSync }) {
  const pluginDir = path.join(out, 'plugin');
  const tarball = path.join(out, 'plugin.tar');
  // A folder left by an earlier stage would mix its files into this one.
  if (fs.existsSync(pluginDir) && fs.readdirSync(pluginDir).length > 0) throw new Error(`${pluginDir} is not empty: stage into a new run folder`);
  fs.mkdirSync(pluginDir, { recursive: true });
  must(run('git', ['-C', repo, 'archive', '--format=tar', '-o', tarball, 'HEAD', '--', '.', ...EXCLUDED.map((d) => `:(exclude)${d}`)], { encoding: 'utf8' }), 'git archive');
  must(run('tar', ['-xf', tarball, '-C', pluginDir], { encoding: 'utf8' }), 'tar');
  fs.rmSync(tarball, { force: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'marketplace.json'), 'utf8'));
  if (manifest.name !== MARKETPLACE_NAME || !manifest.plugins?.some((p) => p.name === PLUGIN_NAME)) throw new Error(`the staged marketplace is not ${PLUGIN_ID}`);

  // A marketplace folder is read as a git repository, so the staged copy gets a commit of its own.
  const git = (...args) => must(run('git', ['-C', pluginDir, ...IDENTITY, ...args], { encoding: 'utf8' }), `git ${args[0]}`);
  git('init', '--quiet', '-b', 'main');
  git('add', '--all');
  git('commit', '--quiet', '-m', 'Stage the plugin for the Haiku trial');
  const sha = git('rev-parse', 'HEAD');
  return { pluginDir, marketplaceDir: pluginDir, marketplaceName: MARKETPLACE_NAME, sha };
}

const claudeOf = ({ configDir, claude = 'claude' }) => (configDir ? ['env', `CLAUDE_CONFIG_DIR=${configDir}`, claude] : [claude]);

// The lines that take out a copy an earlier run installed. `claude plugin install` keeps an installed copy of the same version
// as it is, so without them a later run would test the earlier run's code. Each fails when nothing is installed, which is fine.
export function removeCommands({ configDir, claude = 'claude' }) {
  return [PLUGIN_ID, ...OLD_PLUGIN_IDS].map((id) => [...claudeOf({ configDir, claude }), 'plugin', 'uninstall', id]);
}

// The lines a run executes after the go. `configDir`, when given, keeps the install out of the director's own configuration.
export function installCommand({ marketplaceDir, configDir, claude = 'claude' }) {
  const prefix = claudeOf({ configDir, claude });
  return [
    [...prefix, 'plugin', 'marketplace', 'add', marketplaceDir],
    [...prefix, 'plugin', 'install', PLUGIN_ID],
  ];
}

// Why the installed copy is not the one staged in `pluginDir`, or null when it is. The copy is found in Claude Code's record of
// installed plugins in `configDir` (or ~/.claude), and every file the stage committed must be in it, byte for byte. A plugin
// from a `./` source may record no commit, so its files are compared, not its commit.
export function installedProblem({ configDir, pluginDir, home = os.homedir(), run = spawnSync }) {
  if (typeof pluginDir !== 'string' || !fs.existsSync(pluginDir)) return 'no staged copy to compare with';
  const file = path.join(configDir || path.join(home, '.claude'), 'plugins', 'installed_plugins.json');
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return `${file} cannot be read`; }
  const copies = (record?.plugins ?? record ?? {})[PLUGIN_ID];
  const copy = Array.isArray(copies) ? copies.find((c) => c?.scope === 'user') ?? copies[0] : null;
  if (!copy) return `${PLUGIN_ID} is not installed`;
  if (typeof copy.installPath !== 'string' || !fs.existsSync(copy.installPath)) return `the installed copy's folder ${copy.installPath} is missing`;
  let files;
  try { files = must(run('git', ['-C', pluginDir, 'ls-files', '-z'], { encoding: 'utf8' }), 'git ls-files').split('\0').filter(Boolean); } catch (error) { return error.message; }
  if (files.length === 0) return 'the staged copy lists no files';
  const different = files.filter((f) => {
    try { return !fs.readFileSync(path.join(copy.installPath, f)).equals(fs.readFileSync(path.join(pluginDir, f))); } catch { return true; }
  });
  if (different.length > 0) return `${different.length} of ${files.length} staged files differ in the installed copy, such as ${different[0]}`;
  return null;
}
