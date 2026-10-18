// probes/24-pinning/run.js
// Check 24: pins Superpowers and Matt Pocock's skills through a scratch
// marketplace of our own, at project scope, and records what Claude Code does.
// Usage: node run.js --go
//
// THIS CHANGES THIS COMPUTER'S PLUGIN LIST while it runs (it adds a scratch
// marketplace and installs two plugins at project scope), then puts it back.
// Run it only once the director has said yes. It first copies the four user
// files it could touch (known_marketplaces.json, installed_plugins.json,
// settings.json and .claude.json) to a folder under the temporary folder, and
// at the end compares them with the copies. It undoes only what this run
// added, also on Ctrl-C or a termination signal.
//
// Needs the network (the two plugins are fetched from GitHub) and the `claude`
// command. Flags used were read from `claude plugin <command> --help` on
// Claude Code 2.1.302.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { makeScratchProject, assertUnderTmp } from '../lib/scratch.js';
import { makeScratchMarketplace } from '../lib/marketplace.js';

const execFileAsync = promisify(execFile);

if (!process.argv.includes('--go')) {
  console.error('Usage: node run.js --go');
  console.error('This adds a scratch marketplace and installs two plugins at project scope on this computer, then removes them.');
  console.error('Run it only after the director has said yes.');
  process.exit(2);
}

// What to pin. Commits and tags are from the upstream repositories (see the
// note, docs/checks/24-pinning.md, "Findings"). Superpowers 7.0.0 is the
// installed release. Matt's skills: c55ee46 is the commit the installed copy
// matches (18 September 2026, a few commits before the v1.3.0 tag); the entry
// names the later tag v1.3.1 as its ref, so the install shows whether `sha`
// beats `ref`.
const SUPERPOWERS = {
  name: 'superpowers',
  repo: 'obra/superpowers',
  ref: 'v7.0.0',
  sha: 'bb92a77741419a4ab5f06e711a283343f1ada0c3',
};
const MATT = {
  name: 'mattpocock-skills',
  repo: 'mattpocock/skills',
  ref: 'v1.3.1',
  sha: 'c55ee46073ed923f86ce59a5eb3b6d895095d1b7',
};
// The later refs the "move the tag" step points the marketplace at, sha unchanged.
const MOVED = { [SUPERPOWERS.name]: 'v6.4.2', [MATT.name]: 'main' };

const MARKETPLACE_KEY = 'pins';
const MARKETPLACE_NAME = `wheelhouse-probe-${MARKETPLACE_KEY}`;
const ANTHROPIC_SUPERPOWERS = 'superpowers@claude-plugins-official';

const home = os.homedir();
// Claude Code keeps its folder at ~/.claude unless CLAUDE_CONFIG_DIR says otherwise.
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const pluginsDir = path.join(configDir, 'plugins');
const USER_FILES = [
  path.join(pluginsDir, 'known_marketplaces.json'),
  path.join(pluginsDir, 'installed_plugins.json'),
  path.join(configDir, 'settings.json'),
  // Claude Code's own state file: beside the config folder, or inside it when one is set.
  process.env.CLAUDE_CONFIG_DIR ? path.join(configDir, '.claude.json') : path.join(home, '.claude.json'),
];
const [KNOWN_FILE, INSTALLED_FILE, USER_SETTINGS_FILE, CLAUDE_STATE_FILE] = USER_FILES;
const SCRATCH_CACHE = path.join(pluginsDir, 'cache', MARKETPLACE_NAME);
const PLUGIN_IDS = [SUPERPOWERS, MATT].map((plugin) => `${plugin.name}@${MARKETPLACE_NAME}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(probeLogDir('24-pinning'), `run-${stamp}.jsonl`);
const results = [];

async function note(step, data) {
  console.log(`[${step}] ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  await appendJsonl(logFile, { step, ...(typeof data === 'string' ? { text: data } : data) });
}

async function check(what, ok, detail) {
  results.push({ what, ok });
  await note(`check: ${what}`, { ok, detail });
}

// Set when a stop signal arrives. Once set, no new command starts except the undo's.
let stopping = false;
let undoing = false;
const inflight = new Set();

// Runs a command and never throws: failures are results to record. The child
// is tracked so a stop signal can wait for it to finish.
function run(file, args, options = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(file, args, { timeout: 300_000, maxBuffer: 20 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      inflight.delete(child);
      if (!error) {
        resolve({ code: 0, stdout, stderr, ms: Date.now() - started, child });
        return;
      }
      resolve({
        code: typeof error.code === 'number' ? error.code : -1,
        stdout: stdout ?? '',
        stderr: stderr || String(error.message),
        ms: Date.now() - started,
        child,
      });
    });
    if (!undoing) inflight.add(child);
    child.finished = new Promise((done) => child.once('close', done));
  });
}

// The main flow calls this between steps: once a stop signal has arrived, it stops.
function keepGoing() {
  if (stopping && !undoing) throw new Error('stopped by a signal');
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* not JSON */ }
  // `--json` commands may print other lines first; the result is the last line.
  const lines = String(text).trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch { /* try the line above */ }
  }
  return null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function claude(step, args, cwd) {
  keepGoing();
  const result = await run('claude', args, { cwd });
  await note(step, {
    command: `claude ${args.join(' ')}`,
    code: result.code,
    stdout: result.stdout.slice(0, 20_000),
    stderr: result.stderr.slice(0, 4_000),
    ms: result.ms,
  });
  return result;
}

function installedEntries(id) {
  return readJson(INSTALLED_FILE)?.plugins?.[id] ?? [];
}

function describeInstall(id, projectDir) {
  const real = fs.realpathSync(projectDir);
  const entries = installedEntries(id);
  const entry = entries.find((one) => one.scope === 'project' && [projectDir, real].includes(one.projectPath))
    ?? entries.find((one) => one.scope === 'project')
    ?? entries[0];
  if (!entry) return { id, installed: false };
  const manifest = readJson(path.join(entry.installPath ?? '', '.claude-plugin', 'plugin.json'));
  let folderHead = null;
  try {
    folderHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: entry.installPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* the cached copy has no git data: expected */ }
  return {
    id,
    installed: true,
    entry,
    manifestVersion: manifest?.version ?? null,
    folderHead,
    folderHasGit: fs.existsSync(path.join(entry.installPath ?? '', '.git')),
  };
}

function settingsPath(projectDir) {
  return path.join(projectDir, '.claude', 'settings.json');
}

// 0. Copies of the user's files, outside the repository.
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-24-backup-'));
assertUnderTmp(backupDir);
const backed = {};
for (const file of USER_FILES) {
  const copy = path.join(backupDir, path.basename(file));
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, copy);
    backed[file] = copy;
  } else {
    backed[file] = null;
  }
}

// The command that puts one file back as it was.
function copyBackCommand(file) {
  return backed[file] ? `cp "${backed[file]}" "${file}"` : `rm -f "${file}"`;
}

console.log(`Copies of your plugin files are in: ${backupDir}`);
console.log(`The log is: ${logFile}`);
await note('backup', { backupDir, files: backed });

// State this run created. The undo touches only what is marked here.
let project;
let marketplace;
let ownsMarketplace = false;
let undoPromise = null;
const problems = [];

async function attempt(what, work) {
  try {
    await work();
  } catch (error) {
    problems.push(`${what}: ${error.message}`);
    results.push({ what: `${what} (undo)`, ok: false });
    await note(`error: ${what}`, { message: String(error.stack ?? error) });
  }
}

// The undo: runs once, from the end of the run or from Ctrl-C / a termination signal.
function undo() {
  undoPromise ??= (async () => {
    undoing = true;
    if (ownsMarketplace && project) {
      for (const id of PLUGIN_IDS) {
        await claude(`uninstall ${id}`, ['plugin', 'uninstall', id, '--scope', 'project'], project.dir);
      }
      await claude('remove marketplace (project scope)', ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--scope', 'project'], project.dir);
      if ((readJson(KNOWN_FILE) ?? {})[MARKETPLACE_NAME]) {
        await claude('remove marketplace (every scope)', ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME], project.dir);
      }
    }
    // Uninstall leaves the old version folders to age out; take away only the
    // folder named for the scratch marketplace, and only if this run added it.
    if (ownsMarketplace && path.basename(SCRATCH_CACHE) === MARKETPLACE_NAME && fs.existsSync(SCRATCH_CACHE)) {
      await attempt('remove the scratch cache folder', async () => {
        await fs.promises.rm(SCRATCH_CACHE, { recursive: true, force: true });
        await note('removed scratch cache folder', SCRATCH_CACHE);
      });
    }
    if (marketplace) await attempt('clean up the scratch marketplace', () => marketplace.cleanup());
    if (project) await attempt('clean up the scratch project', () => project.cleanup());

    // Compare the user's files with the copies.
    await attempt('compare your files with the copies', async () => {
      const differences = [];
      for (const file of USER_FILES) {
        const copy = backed[file];
        const now = fs.existsSync(file) ? fs.readFileSync(file) : null;
        const was = copy ? fs.readFileSync(copy) : null;
        const same = (now === null && was === null) || (now !== null && was !== null && now.equals(was));
        if (!same) differences.push(file);
        await note(`file compared: ${file}`, { same });
      }
      await check('your plugin files are as before', differences.length === 0, differences);
      if (differences.length) {
        console.error(`These differ from the copies in ${backupDir}. Only the ones that differ are listed; nothing is copied back for you:`);
        for (const file of differences) {
          const own = file === CLAUDE_STATE_FILE ? "  # Claude Code's own state: copy back only if you know the probe changed it" : '';
          console.error(`  ${copyBackCommand(file)}${own}`);
        }
      }
    });
    if (problems.length) console.error(`Problems while undoing:\n  ${problems.join('\n  ')}`);
    const failed = results.filter((one) => !one.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Log: ${logFile}`);
    if (failed.length) {
      console.log(`Not passed: ${failed.map((one) => one.what).join('; ')}`);
      process.exitCode = 1;
    }
  })();
  return undoPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.error(`\n${signal}: stopping, then undoing what this run added.`);
    stopping = true;
    // Wait for the command in flight (the terminal's Ctrl-C has usually
    // reached it already); ask it to stop if not. The undo's own commands
    // start after this and are not in the list.
    const pending = [...inflight];
    for (const child of pending) child.kill('SIGTERM');
    await Promise.all(pending.map((child) => child.finished ?? Promise.resolve()));
    try {
      await undo();
    } catch (error) {
      console.error(`The undo failed: ${error.message}`);
    }
    process.exit(signal === 'SIGTERM' ? 143 : 130);
  });
}

try {
  // Refuse to start if anything of ours could already be there: then the undo
  // could remove something this run did not make.
  for (const file of [KNOWN_FILE, USER_SETTINGS_FILE]) {
    if (fs.existsSync(file) && readJson(file) === null) throw new Error(`${file} exists but does not parse as JSON: stopping so nothing is overwritten`);
  }
  if ((readJson(KNOWN_FILE) ?? {})[MARKETPLACE_NAME]) throw new Error(`${MARKETPLACE_NAME} is already registered: stopping so nothing is overwritten`);
  if (readJson(USER_SETTINGS_FILE)?.extraKnownMarketplaces?.[MARKETPLACE_NAME]) throw new Error(`${MARKETPLACE_NAME} is already in your user settings: stopping so nothing is overwritten`);
  if (fs.existsSync(SCRATCH_CACHE)) throw new Error(`${SCRATCH_CACHE} already exists: stopping so nothing is overwritten`);

  const version = await claude('version', ['--version'], process.cwd());
  await note('claude version', version.stdout.trim());
  const before = await claude('list before', ['plugin', 'list', '--json'], process.cwd());
  await note('baseline ids', { ids: JSON.stringify(parseJson(before.stdout))?.match(/"[^"]+@[^"]+"/g) ?? [] });

  // 1. The scratch project and marketplace.
  project = await makeScratchProject({ name: 'pinning-project' });
  marketplace = await makeScratchMarketplace({ name: MARKETPLACE_KEY, plugins: [SUPERPOWERS, MATT] });
  await note('scratch', { project: project.dir, marketplace: marketplace.dir, marketplaceUrl: marketplace.url });

  keepGoing();
  console.log('\nAbout to change this computer\'s plugin list. If this run is stopped and the undo does not finish, run these (your own files are copied in the backup folder above; the run lists what, if anything, differs at the end):');
  for (const id of PLUGIN_IDS) console.log(`  (cd "${project.dir}" && claude plugin uninstall ${id} --scope project)`);
  console.log(`  (cd "${project.dir}" && claude plugin marketplace remove ${MARKETPLACE_NAME})`);
  console.log(`  rm -rf "${SCRATCH_CACHE}"`);
  console.log('');

  // 2. Add the marketplace at project scope (a folder path: Claude Code's
  // documented "directory" source).
  // From here a signal or a half-done add must still be undone: the checks at
  // the start proved the name was not there before.
  ownsMarketplace = true;
  const added = await claude('marketplace add', ['plugin', 'marketplace', 'add', marketplace.dir, '--scope', 'project', '--json'], project.dir);
  await check('marketplace added at project scope', added.code === 0, added.stderr.slice(0, 300));
  if (added.code !== 0) throw new Error('the marketplace could not be added: stopping');
  await note('project settings after add', readJson(settingsPath(project.dir)) ?? 'no project settings file');
  await note('known_marketplaces entry', (readJson(KNOWN_FILE) ?? {})[MARKETPLACE_NAME] ?? 'no entry');

  // 3. Install both at project scope; read what was installed.
  const ids = [SUPERPOWERS, MATT].map((plugin) => ({ plugin, id: `${plugin.name}@${MARKETPLACE_NAME}` }));
  for (const { id } of ids) {
    const installed = await claude(`install ${id}`, ['plugin', 'install', id, '--scope', 'project', '--json'], project.dir);
    await check(`${id} installed`, installed.code === 0, installed.stderr.slice(0, 300));
  }
  const first = {};
  for (const { plugin, id } of ids) {
    const info = describeInstall(id, project.dir);
    first[id] = info;
    await note(`installed ${id}`, info);
    await check(`${id}: installed commit is the pinned sha`, info.entry?.gitCommitSha === plugin.sha, `recorded ${info.entry?.gitCommitSha}, pinned ${plugin.sha}`);
  }
  await note('project settings after install', readJson(settingsPath(project.dir)) ?? 'no project settings file');

  // 4. The marketplace's auto-update setting: as recorded, then set off by name.
  const recorded = (readJson(KNOWN_FILE) ?? {})[MARKETPLACE_NAME];
  const declared = readJson(settingsPath(project.dir))?.extraKnownMarketplaces?.[MARKETPLACE_NAME];
  await note('auto-update as recorded', { knownMarketplacesAutoUpdate: recorded?.autoUpdate ?? '(not set)', projectSettingsAutoUpdate: declared?.autoUpdate ?? '(not set)' });
  keepGoing();
  const settings = readJson(settingsPath(project.dir)) ?? {};
  settings.extraKnownMarketplaces = settings.extraKnownMarketplaces ?? {};
  settings.extraKnownMarketplaces[MARKETPLACE_NAME] = { ...(settings.extraKnownMarketplaces[MARKETPLACE_NAME] ?? {}), autoUpdate: false };
  fs.writeFileSync(settingsPath(project.dir), JSON.stringify(settings, null, 2) + '\n', 'utf8');
  await claude('marketplaces after autoUpdate false', ['plugin', 'marketplace', 'list', '--json'], project.dir);

  // 5. Switch off Anthropic's copy of Superpowers and the synced copies, in
  // this project's settings, and see what `claude plugin list` shows here.
  const listing = await claude('list with everything on', ['plugin', 'list', '--json'], project.dir);
  const allIds = JSON.stringify(parseJson(listing.stdout) ?? listing.stdout).match(/[A-Za-z0-9._-]+@[A-Za-z0-9._-]+/g) ?? [];
  const synced = [...new Set(allIds)].filter((id) => /@synced$/.test(id) && /^(superpowers|mattpocock-skills)@/.test(id));
  await note('synced copies found', synced);
  const off = { [ANTHROPIC_SUPERPOWERS]: false, ...Object.fromEntries(synced.map((id) => [id, false])) };
  keepGoing();
  const withOff = readJson(settingsPath(project.dir)) ?? {};
  withOff.enabledPlugins = { ...(withOff.enabledPlugins ?? {}), ...off };
  fs.writeFileSync(settingsPath(project.dir), JSON.stringify(withOff, null, 2) + '\n', 'utf8');
  await note('project settings with enabledPlugins', withOff);
  await claude('list in the project, copies off', ['plugin', 'list', '--json'], project.dir);
  await claude('list in the project, copies off (text)', ['plugin', 'list'], project.dir);

  // 6. Move the refs on, keep the sha, update, and see if anything moved.
  keepGoing();
  const file = path.join(marketplace.dir, '.claude-plugin', 'marketplace.json');
  const manifest = readJson(file);
  for (const entry of manifest.plugins) entry.source.ref = MOVED[entry.name];
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const gitArgs = ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid'];
  execFileSync('git', [...gitArgs, 'commit', '--quiet', '--all', '-m', 'Move the refs, keep the shas'], { cwd: marketplace.dir, stdio: 'ignore' });
  await note('refs moved', { to: MOVED, shasKept: true });
  await claude('marketplace update', ['plugin', 'marketplace', 'update', MARKETPLACE_NAME], project.dir);
  for (const { plugin, id } of ids) {
    await claude(`update ${id}`, ['plugin', 'update', id, '--scope', 'project', '--json'], project.dir);
    const after = describeInstall(id, project.dir);
    await note(`after update ${id}`, after);
    await check(
      `${id}: installed commit and folder did not move`,
      after.entry?.gitCommitSha === plugin.sha && after.entry?.installPath === first[id].entry?.installPath,
      `commit ${after.entry?.gitCommitSha}, folder ${after.entry?.installPath}`,
    );
  }
} catch (error) {
  results.push({ what: 'the probe ran to the end', ok: false });
  await note('error', { message: String(error.stack ?? error) });
  console.error(`Stopped: ${error.message}`);
} finally {
  await undo();
}
