// probes/29-release/run.js
// Task 29's trial of the undo: what check 30 left open. A scratch marketplace, declared in a
// scratch project's settings at a release tag as Wheelhouse's is, lists a plugin inside itself
// (standing in for Wheelhouse, with the same plugin.json version in both releases) and
// Superpowers as an `https` `url` source pinned by `ref` and `sha`, at v6.4.2 in release r1 and
// v7.0.0 in release r2, whose plugin.json versions differ. It installs r1, moves the project's
// settings to r2 and reinstalls, deletes r1's Superpowers folder from the cache (standing in for
// Claude Code's 14-day clean-up), moves the settings back to r1 and runs the undo's reinstall
// (`reinstall` in scripts/lineage/release.js), then confirms r1's commits from gitCommitSha.
// Usage: node probes/29-release/run.js --go
//
// THIS CHANGES THIS COMPUTER'S PLUGIN LIST while it runs (it adds a scratch marketplace and
// installs, updates and uninstalls two plugins from it at project scope, in a scratch project),
// then puts it back. It never touches the `wheelhouse` or `claude-plugins-official` names or the
// director's own installs. It first copies the four user files it could touch
// (known_marketplaces.json, installed_plugins.json, settings.json and .claude.json) to a folder
// under the temporary folder, and at the end compares them with the copies, as check 30's probe
// does. It undoes only what this run added, also on Ctrl-C or a termination signal.
//
// Needs the `claude` command and the network (Superpowers is fetched from GitHub over https).
// Flags used were read from `claude plugin <command> --help` on Claude Code 2.1.302.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { makeScratchProject, assertUnderTmp } from '../lib/scratch.js';
import { run as realRun } from '../../scripts/lib/run.js';
import { reinstall } from '../../scripts/lineage/release.js';

if (!process.argv.includes('--go')) {
  console.error('Usage: node probes/29-release/run.js --go');
  console.error('This adds a scratch marketplace and installs, updates and uninstalls two plugins from it at project scope on this computer, then removes them.');
  process.exit(2);
}

const MARKETPLACE_NAME = 'wheelhouse-probe-release';
const OWN_PLUGIN = 'release-probe';
const UPSTREAM = 'superpowers';
const PLUGINS = [OWN_PLUGIN, UPSTREAM];
const SUPERPOWERS_URL = 'https://github.com/obra/superpowers.git';
// Superpowers' own releases (git ls-remote, 19 October 2026), whose plugin.json versions differ.
const RELEASES = {
  r1: { ref: 'r1', label: 'one', upstream: { ref: 'v6.4.2', sha: '8ca22dba9a94f28898bbce59f2537ff4d87c747d', version: '6.4.2' }, sha: null },
  r2: { ref: 'r2', label: 'two', upstream: { ref: 'v7.0.0', sha: 'bb92a77741419a4ab5f06e711a283343f1ada0c3', version: '7.0.0' }, sha: null },
};
// The plugin inside the marketplace keeps one version, so `plugin update` cannot move it.
const OWN_VERSION = '1.0.0';

const home = os.homedir();
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const pluginsDir = path.join(configDir, 'plugins');
const USER_FILES = [
  path.join(pluginsDir, 'known_marketplaces.json'),
  path.join(pluginsDir, 'installed_plugins.json'),
  path.join(configDir, 'settings.json'),
  process.env.CLAUDE_CONFIG_DIR ? path.join(configDir, '.claude.json') : path.join(home, '.claude.json'),
];
const [KNOWN_FILE, INSTALLED_FILE, USER_SETTINGS_FILE, CLAUDE_STATE_FILE] = USER_FILES;
const SCRATCH_CACHE = path.join(pluginsDir, 'cache', MARKETPLACE_NAME);
const SCRATCH_CLONE = path.join(pluginsDir, 'marketplaces', MARKETPLACE_NAME);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(probeLogDir('29-release'), `run-${stamp}.jsonl`);
const results = [];

async function note(step, data) {
  console.log(`[${step}] ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  await appendJsonl(logFile, { step, ...(typeof data === 'string' ? { text: data } : data) });
}

async function check(what, ok, detail) {
  results.push({ what, ok });
  await note(`check: ${what}`, { ok, detail });
}

let stopping = false;
function keepGoing() {
  if (stopping) throw new Error('stopped by a signal');
}

// Every command, the reinstall's included, goes through here, and is logged.
async function logged(file, args, options = {}) {
  const result = await realRun(file, args, { timeoutMs: 600_000, ...options });
  await note(`ran ${file} ${args.slice(0, 4).join(' ')}`, {
    command: `${file} ${args.join(' ')}`, cwd: options.cwd, code: result.code,
    stdout: String(result.stdout).slice(0, 8_000), stderr: String(result.stderr).slice(0, 2_000),
  });
  return result;
}

async function claude(args, cwd, { undo = false } = {}) {
  if (!undo) keepGoing();
  return logged('claude', args, { cwd });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const GIT_IDENTITY = ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];
function git(dir, args) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// The scratch marketplace: a git repository with two releases, tagged r1 and r2, each listing
// the plugin inside it and Superpowers at that release's tag and commit.
function makeMarketplace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-release-marketplace-'));
  assertUnderTmp(dir);
  git(dir, ['init', '--quiet']);
  for (const release of [RELEASES.r1, RELEASES.r2]) {
    const write = (relative, text) => {
      fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
      fs.writeFileSync(path.join(dir, relative), text, 'utf8');
    };
    write('.claude-plugin/marketplace.json', `${JSON.stringify({
      name: MARKETPLACE_NAME,
      owner: { name: 'Wheelhouse probe' },
      plugins: [
        { name: OWN_PLUGIN, source: './plugin', description: 'Scratch plugin standing in for Wheelhouse' },
        { name: UPSTREAM, source: { source: 'url', url: SUPERPOWERS_URL, ref: release.upstream.ref, sha: release.upstream.sha } },
      ],
    }, null, 2)}\n`);
    write('plugin/.claude-plugin/plugin.json', `${JSON.stringify({ name: OWN_PLUGIN, version: OWN_VERSION, description: 'Scratch plugin for the release probe' }, null, 2)}\n`);
    write('plugin/RELEASE.txt', `release ${release.label}\n`);
    git(dir, ['add', '--all']);
    git(dir, ['commit', '--quiet', '-m', `Release ${release.ref}`]);
    git(dir, ['tag', release.ref]);
    release.sha = git(dir, ['rev-parse', 'HEAD']);
  }
  return { dir, url: pathToFileURL(dir).href };
}

function installs(projectDir) {
  const real = fs.realpathSync(projectDir);
  const record = readJson(INSTALLED_FILE)?.plugins ?? {};
  return Object.fromEntries(PLUGINS.map((plugin) => {
    const entry = (record[`${plugin}@${MARKETPLACE_NAME}`] ?? []).find((one) => one.scope === 'project' && [projectDir, real].includes(one.projectPath)) ?? null;
    const manifest = entry ? readJson(path.join(entry.installPath, '.claude-plugin', 'plugin.json')) : null;
    return [plugin, entry && { sha: entry.gitCommitSha, version: entry.version, installPath: entry.installPath, manifestVersion: manifest?.version ?? null }];
  }));
}

// 0. Copies of the user's files, outside the repository.
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-29-backup-'));
assertUnderTmp(backupDir);
const backed = {};
for (const file of USER_FILES) {
  const copy = path.join(backupDir, path.basename(file));
  if (fs.existsSync(file)) { fs.copyFileSync(file, copy); backed[file] = copy; } else backed[file] = null;
}
const copyBackCommand = (file) => (backed[file] ? `cp "${backed[file]}" "${file}"` : `rm -f "${file}"`);
console.log(`Copies of your plugin files are in: ${backupDir}`);
console.log(`The log is: ${logFile}`);
await note('backup', { backupDir, files: backed });

let project;
let marketplace;
let ownsMarketplace = false;
let undoPromise = null;
const problems = [];

async function attempt(what, work) {
  try { await work(); } catch (error) {
    problems.push(`${what}: ${error.message}`);
    results.push({ what: `${what} (undo)`, ok: false });
    await note(`error: ${what}`, { message: String(error.stack ?? error) });
  }
}

// Removes a folder only when its last part is the scratch marketplace's name.
async function removeScratchFolder(dir) {
  if (path.basename(dir) !== MARKETPLACE_NAME || !fs.existsSync(dir)) return;
  await fs.promises.rm(dir, { recursive: true, force: true });
  await note('removed scratch folder', dir);
}

function undoTrial() {
  undoPromise ??= (async () => {
    if (ownsMarketplace && project) {
      for (const plugin of PLUGINS) {
        await claude(['plugin', 'uninstall', `${plugin}@${MARKETPLACE_NAME}`, '--scope', 'project'], project.dir, { undo: true });
      }
      await claude(['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--scope', 'project'], project.dir, { undo: true });
      if ((readJson(KNOWN_FILE) ?? {})[MARKETPLACE_NAME]) {
        await claude(['plugin', 'marketplace', 'remove', MARKETPLACE_NAME], project.dir, { undo: true });
      }
      await attempt('remove the scratch cache folder', () => removeScratchFolder(SCRATCH_CACHE));
      await attempt('remove the scratch marketplace clone', () => removeScratchFolder(SCRATCH_CLONE));
    }
    if (marketplace) {
      await attempt('clean up the scratch marketplace', async () => {
        assertUnderTmp(marketplace.dir);
        await fs.promises.rm(marketplace.dir, { recursive: true, force: true });
      });
    }
    if (project) await attempt('clean up the scratch project', () => project.cleanup());
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
          if (file === CLAUDE_STATE_FILE) console.error("  Claude Code's own state, so copy it back only if you know the probe changed it:");
          console.error(`  ${copyBackCommand(file)}`);
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
    try { await undoTrial(); } catch (error) { console.error(`The undo failed: ${error.message}`); }
    process.exit(signal === 'SIGTERM' ? 143 : 130);
  });
}

const settingsFile = () => path.join(project.dir, '.claude', 'settings.json');
// How the marketplace was declared: 'settings' (a git source at a ref, in the project's
// settings) or 'folder' (a folder source, held at a release's commit by a checkout).
let mode = null;

// Moves the project's settings to `release`, as the merged pull request would: only the scratch
// marketplace's ref changes.
async function pointSettingsAt(release) {
  if (mode === 'folder') {
    git(marketplace.dir, ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', release.ref]);
    await note(`marketplace folder checked out at ${release.ref}`, { head: git(marketplace.dir, ['rev-parse', 'HEAD']) });
    return;
  }
  const settings = readJson(settingsFile());
  const source = settings?.extraKnownMarketplaces?.[MARKETPLACE_NAME]?.source;
  if (!source || typeof source !== 'object') throw new Error('the project\'s settings declare no scratch marketplace to move');
  if (typeof source.ref === 'string') source.ref = release.ref;
  else if (typeof source.url === 'string' && source.url.includes('#')) source.url = source.url.replace(/#.*$/, `#${release.ref}`);
  else source.ref = release.ref;
  fs.writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`);
  await note(`settings pointed at ${release.ref}`, { source });
}

function knownEntry() {
  return (readJson(KNOWN_FILE) ?? {})[MARKETPLACE_NAME] ?? null;
}

// The undo's reinstall, against the scratch marketplace, through the logged runner.
async function reinstallTo(release, label) {
  keepGoing();
  const before = fs.readFileSync(settingsFile(), 'utf8');
  const done = await reinstall({ projectDir: project.dir, release: { ref: release.ref, sha: release.sha }, run: logged, marketplace: MARKETPLACE_NAME, claudeHome: configDir });
  await note(`${label}: reinstall said`, { ok: done.ok, line: done.line, installed: done.installed, putBack: done.putBack, known: knownEntry() });
  await check(`${label}: the project's settings are as the release has them afterwards`, fs.readFileSync(settingsFile(), 'utf8') === before);
  return done;
}

function expectRelease(info, release) {
  return info[OWN_PLUGIN]?.sha === release.sha
    && info[UPSTREAM]?.sha === release.upstream.sha
    && info[UPSTREAM]?.manifestVersion === release.upstream.version
    && fs.existsSync(path.join(info[OWN_PLUGIN]?.installPath ?? '/nonexistent', 'RELEASE.txt'))
    && fs.readFileSync(path.join(info[OWN_PLUGIN].installPath, 'RELEASE.txt'), 'utf8').trim() === `release ${release.label}`;
}

try {
  if (knownEntry()) throw new Error(`${MARKETPLACE_NAME} is already registered: stopping so nothing is overwritten`);
  if (readJson(USER_SETTINGS_FILE)?.extraKnownMarketplaces?.[MARKETPLACE_NAME]) throw new Error(`${MARKETPLACE_NAME} is in your user settings: stopping`);
  for (const dir of [SCRATCH_CACHE, SCRATCH_CLONE]) if (fs.existsSync(dir)) throw new Error(`${dir} already exists: stopping so nothing is overwritten`);
  await note('claude version', (await claude(['--version'], process.cwd())).stdout.trim());

  project = await makeScratchProject({ name: 'release-project' });
  marketplace = makeMarketplace();
  await note('scratch', { project: project.dir, marketplace: marketplace.dir, r1: RELEASES.r1, r2: RELEASES.r2 });

  console.log('\nAbout to change this computer\'s plugin list. If this run is stopped and the undo does not finish, run these:');
  for (const plugin of PLUGINS) console.log(`  (cd "${project.dir}" && claude plugin uninstall ${plugin}@${MARKETPLACE_NAME} --scope project)`);
  console.log(`  (cd "${project.dir}" && claude plugin marketplace remove ${MARKETPLACE_NAME})`);
  console.log(`  rm -rf "${SCRATCH_CACHE}" "${SCRATCH_CLONE}"\n`);

  // 1. Declare the marketplace in the project's settings at release r1, as a git source, as
  // Wheelhouse's own is declared at a tag. `claude plugin marketplace add` refuses a file://
  // address (seen on the first run), so the declaration is written into the settings and the
  // command line is asked to fetch it. If it does not, the marketplace is added as a folder held
  // at r1's commit instead, and a move between releases is a checkout of the other tag there.
  ownsMarketplace = true;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), `${JSON.stringify({ extraKnownMarketplaces: { [MARKETPLACE_NAME]: { source: { source: 'git', url: marketplace.url, ref: RELEASES.r1.ref }, autoUpdate: false } } }, null, 2)}\n`);
  await claude(['plugin', 'marketplace', 'update', MARKETPLACE_NAME, '--json'], project.dir);
  await claude(['plugin', 'marketplace', 'list', '--json'], project.dir);
  await note('after declaring it in the settings', { known: knownEntry() });
  if (knownEntry()) {
    mode = 'settings';
  } else {
    mode = 'folder';
    fs.writeFileSync(settingsFile(), '{}\n');
    git(marketplace.dir, ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', RELEASES.r1.ref]);
    const added = await claude(['plugin', 'marketplace', 'add', marketplace.dir, '--scope', 'project', '--json'], project.dir);
    await check('the marketplace is added at project scope, as a folder at r1', added.code === 0, added.stderr.slice(0, 300));
    if (added.code !== 0) throw new Error('the marketplace could not be added: stopping');
  }
  await note('marketplace declared', { mode, projectSettings: readJson(settingsFile()), known: knownEntry() });

  // 2. Install r1.
  for (const plugin of PLUGINS) {
    const done = await claude(['plugin', 'install', `${plugin}@${MARKETPLACE_NAME}`, '--scope', 'project', '--json'], project.dir);
    await check(`${plugin} installs at r1`, done.code === 0, done.stderr.slice(0, 300));
  }
  const first = installs(project.dir);
  await note('installed r1', first);
  await check('r1 is installed at its commits (gitCommitSha)', expectRelease(first, RELEASES.r1), first);

  // 3. Move the settings to r2 and reinstall.
  await pointSettingsAt(RELEASES.r2);
  const forward = await reinstallTo(RELEASES.r2, 'forward to r2');
  const second = installs(project.dir);
  await note('installed r2', second);
  await check('forward to r2: the reinstall says r2 is installed', forward.ok === true, forward.line);
  await check('forward to r2: r2 is installed at its commits (gitCommitSha)', expectRelease(second, RELEASES.r2), second);

  // 4. Delete r1's Superpowers folder, standing in for the 14-day clean-up.
  const folder = first[UPSTREAM]?.installPath;
  const expected = path.join(SCRATCH_CACHE, UPSTREAM, RELEASES.r1.upstream.version);
  if (!folder || path.resolve(folder) !== path.resolve(expected)) throw new Error(`r1's Superpowers folder was recorded as ${folder}, not ${expected}: stopping before anything is deleted`);
  if (!fs.existsSync(folder)) throw new Error(`${folder} is gone already: stopping, as a fetch again could not be shown`);
  if (installs(project.dir)[UPSTREAM]?.installPath === folder) throw new Error('r1\'s folder is the one in use: stopping');
  const realCache = fs.realpathSync(SCRATCH_CACHE);
  if (!fs.realpathSync(folder).startsWith(realCache + path.sep)) throw new Error(`Refusing to delete ${folder}: it is not inside the scratch cache folder`);
  await note('r1 folder before deleting', { folder, orphanedAt: fs.existsSync(path.join(folder, '.orphaned_at')) });
  await fs.promises.rm(folder, { recursive: true, force: true });
  await check('r1\'s Superpowers folder is deleted', !fs.existsSync(folder));

  // 5. The undo: the settings back at r1 (the merged pull request), then the reinstall.
  await pointSettingsAt(RELEASES.r1);
  const back = await reinstallTo(RELEASES.r1, 'undo to r1');
  const third = installs(project.dir);
  await note('installed after the undo', third);
  await check('undo to r1: the reinstall says r1 is installed', back.ok === true, back.line);
  await check('undo to r1: r1 is installed at its commits (gitCommitSha)', expectRelease(third, RELEASES.r1), third);
  await check('undo to r1: r1\'s Superpowers folder is fetched again', fs.existsSync(folder) && readJson(path.join(folder, '.claude-plugin', 'plugin.json'))?.version === RELEASES.r1.upstream.version);
  await note('routes', { forward: forward.installed, back: back.installed });
  // Superpowers' two releases differ in plugin.json version, so `plugin update` moves it; the
  // plugin inside the marketplace keeps one version, so only uninstall then install does.
  const route = (done, plugin) => done.installed.find((one) => one.plugin === plugin)?.route;
  for (const [label, done] of [['forward to r2', forward], ['undo to r1', back]]) {
    await check(`${label}: Superpowers moved by plugin update`, route(done, UPSTREAM) === 'update', done.installed);
    await check(`${label}: the plugin with one version moved by uninstall, then install`, route(done, OWN_PLUGIN) === 'uninstall, then install', done.installed);
  }
} catch (error) {
  results.push({ what: 'the probe ran to the end', ok: false });
  await note('error', { message: String(error.stack ?? error) });
  console.error(`Stopped: ${error.message}`);
} finally {
  await undoTrial();
}
