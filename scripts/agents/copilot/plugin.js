// scripts/agents/copilot/plugin.js
// Installing the Wheelhouse plugin into Copilot CLI (design section 8.3; rulings P8-15, P8-16). The plugin is the
// folder adapters/copilot/plugin/: skills and agents, and no hooks, so Copilot loads nothing of Wheelhouse's that signs
// or guards (check 56). The two functions run `copilot plugin install` and `copilot plugin list` through the `run` they
// are handed, and no setup step calls them yet: no setup path knows a Copilot Middle project until Part 6 Task 6's tier.
//
// `copilot plugin install <local path>` is deprecated (check 56): Copilot says only plugin@marketplace installs will be
// supported in a future release. This one function is where a marketplace route replaces the direct install before then.
//
//   run(file, args, options) -> Promise<{ code, stdout, stderr }>
const PLUGIN_NAME = 'wheelhouse';
const COMMIT = /^[0-9a-f]{40}$/;

// installPlugin({ run, source, tag, commit }) -> { installed, tag, commit, reason? }
//   source is the plugin's folder (a checkout of the release at that tag and commit). A blank tag, or a commit that is not a
//   full hash, is refused before anything runs: an install nobody can trace to a release is not made.
export async function installPlugin({ run, source, tag, commit } = {}) {
  if (typeof run !== 'function') throw new Error('installPlugin needs a run');
  if (typeof source !== 'string' || source === '') return { installed: false, tag, commit, reason: 'No plugin folder was named' };
  if (typeof tag !== 'string' || tag === '') return { installed: false, tag, commit, reason: 'No release tag was named' };
  if (typeof commit !== 'string' || !COMMIT.test(commit)) return { installed: false, tag, commit, reason: 'The release commit is not a full hash' };
  const result = await run('copilot', ['plugin', 'install', source]);
  if (result.code !== 0) return { installed: false, tag, commit, reason: String(result.stderr ?? '').trim() || `copilot plugin install exited ${result.code}` };
  return { installed: true, tag, commit };
}

// pluginInstalled({ run }) -> boolean: whether `copilot plugin list` names the Wheelhouse plugin. Any failure is "not installed".
export async function pluginInstalled({ run } = {}) {
  if (typeof run !== 'function') throw new Error('pluginInstalled needs a run');
  const result = await run('copilot', ['plugin', 'list']);
  if (result.code !== 0) return false;
  return String(result.stdout ?? '').split('\n').some((line) => new RegExp(`(^|[^A-Za-z0-9_-])${PLUGIN_NAME}([^A-Za-z0-9_-]|$)`).test(line));
}
