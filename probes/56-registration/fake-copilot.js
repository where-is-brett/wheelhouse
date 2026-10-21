// probes/56-registration/fake-copilot.js
// A stand-in for Copilot CLI, used only by `run.js --dry-run` so the probe's plumbing (the plugin install,
// the hook files, the three folders, the counting and the results file) can be tested where the real
// Copilot can't run. Its rules about where hooks load from are made up and are not evidence of anything:
//   - it installs a plugin by copying the folder into $COPILOT_HOME/installed-plugins/_direct/
//   - it reads a plugin's hooks/hooks.json and com.github.copilot/hooks/hooks.json
//   - it reads $COPILOT_HOME/hooks/*.json always, and the folder's .github/hooks/*.json and
//     .claude/settings.json only with --trust-folder
//   - a .github/hooks file holding disableAllHooks: true turns off the home's and the folder's hooks
// Environment: WHEELHOUSE_FAKE_FAIL=1 makes a prompt run exit 1 without running any hook.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const home = process.env.COPILOT_HOME;
const direct = home ? path.join(home, 'installed-plugins', '_direct') : '';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function manifestName(dir) {
  for (const file of ['plugin.json', path.join('.claude-plugin', 'plugin.json')]) {
    const name = readJson(path.join(dir, file))?.name;
    if (name) return name;
  }
  return path.basename(dir);
}

function installedPlugins() {
  if (!direct || !fs.existsSync(direct)) return [];
  return fs.readdirSync(direct).map((name) => path.join(direct, name));
}

function jsonFiles(dir) {
  try { return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => path.join(dir, name)); } catch { return []; }
}

// The commands a file registers for `event`, in Copilot's flat format or Claude Code's nested one.
function commands(data, event) {
  const flat = data?.hooks?.[event];
  const pascal = event[0].toUpperCase() + event.slice(1);
  const nested = data?.hooks?.[pascal];
  const found = [];
  for (const item of Array.isArray(flat) ? flat : []) found.push(item.bash ?? item.command);
  for (const group of Array.isArray(nested) ? nested : []) for (const hook of group.hooks ?? []) found.push(hook.command);
  return found.filter(Boolean);
}

function runHooks(files, event, input) {
  for (const file of files) {
    for (const command of commands(readJson(file), event)) {
      spawnSync(command, { shell: true, input: JSON.stringify(input), cwd: input.cwd, env: process.env, stdio: ['pipe', 'ignore', 'ignore'] });
    }
  }
}

const [first, second] = args;
if (first === '--version' || first === '-v') {
  console.log('GitHub Copilot CLI 0.0.0-stand-in.');
} else if (first === 'plugin' && second === 'install') {
  const source = path.resolve(args[2]);
  const name = manifestName(source);
  fs.mkdirSync(direct, { recursive: true });
  fs.cpSync(source, path.join(direct, path.basename(source)), { recursive: true });
  console.log(`Plugin "${name}" installed successfully.`);
} else if (first === 'plugin' && second === 'list') {
  console.log(JSON.stringify(installedPlugins().map((dir) => ({ name: manifestName(dir), marketplace: '', version: '0.0.1', enabled: true, source: 'installed' })), null, 2));
} else if (first === 'plugin' && second === 'uninstall') {
  for (const dir of installedPlugins()) if (manifestName(dir) === args[2]) fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Plugin "${args[2]}" uninstalled successfully.`);
} else if (args.includes('-p')) {
  if (process.env.WHEELHOUSE_FAKE_FAIL === '1') {
    console.error('Not signed in. Run copilot login.');
    process.exit(1);
  }
  const cwd = process.cwd();
  const trusted = args.includes('--trust-folder');
  const logDir = args[args.indexOf('--log-dir') + 1];
  const notes = [];
  const note = (text) => notes.push(text);

  const projectHooks = trusted ? [...jsonFiles(path.join(cwd, '.github', 'hooks')), path.join(cwd, '.claude', 'settings.json')] : [];
  const off = jsonFiles(path.join(cwd, '.github', 'hooks')).some((file) => trusted && readJson(file)?.disableAllHooks === true);
  const homeHooks = home ? jsonFiles(path.join(home, 'hooks')) : [];
  const pluginHooks = installedPlugins().flatMap((dir) => [path.join(dir, 'hooks', 'hooks.json'), path.join(dir, 'com.github.copilot', 'hooks', 'hooks.json')]);
  const loaded = [...(off ? [] : [...homeHooks, ...projectHooks]), ...pluginHooks].filter((file) => fs.existsSync(file));
  for (const file of loaded) note(`hook file loaded: ${file}`);
  if (off) note('hooks disabled by disableAllHooks');
  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'process-stand-in.log'), notes.join('\n') + '\n');
  }

  runHooks(loaded, 'sessionStart', { sessionId: 'stand-in', timestamp: Date.now(), cwd, source: 'new' });
  runHooks(loaded, 'preToolUse', { sessionId: 'stand-in', timestamp: Date.now(), cwd, toolName: 'view', toolArgs: { path: path.join(cwd, 'README.md') } });
  console.log(JSON.stringify({ type: 'assistant.message', data: { content: 'done' } }));
  console.log(JSON.stringify({ type: 'result', sessionId: 'stand-in', exitCode: 0, usage: { premiumRequests: 0 } }));
} else {
  console.error(`The stand-in does not know: ${args.join(' ')}`);
  process.exit(2);
}
