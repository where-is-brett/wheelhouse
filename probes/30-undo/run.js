// probes/30-undo/run.js
// Check 30: the undo. Reinstalls a previous release of a plugin from a
// marketplace that pins each release by sha, including after the previous
// release's cached folder has been deleted (standing in for Claude Code's
// 14-day clean-up of orphaned versions).
// Usage: node run.js --go
//
// THIS CHANGES THIS COMPUTER'S PLUGIN LIST while it runs (it adds a scratch
// marketplace and installs, updates and uninstalls one scratch plugin at
// project scope), then puts it back. Run it only once the director has said
// yes. It first copies the four user files it could touch
// (known_marketplaces.json, installed_plugins.json, settings.json and
// .claude.json) to a folder under the temporary folder, and at the end compares
// them with the copies. It undoes only what this run added, also on Ctrl-C or a
// termination signal.
//
// Needs no network: the scratch plugin is a local git repository under the
// temporary folder with two releases (tags v1 and v2, versions 1.0.0 and 2.0.0),
// listed in the scratch marketplace as a `url` source with a file:// address,
// `ref` and `sha`. The versions differ because `claude plugin update` does
// nothing when a plugin's manifest `version` is unchanged (check 24). Needs the
// `claude` command. Flags used were read from `claude plugin <command> --help`
// on Claude Code 2.1.302.
//
// Moving between releases is tried as `claude plugin update` first; if that
// does not leave the wanted commit installed, as uninstall then install. The
// route that worked is recorded for each move.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { makeScratchProject, assertUnderTmp } from '../lib/scratch.js';
import { makeScratchMarketplace } from '../lib/marketplace.js';

if (!process.argv.includes('--go')) {
  console.error('Usage: node run.js --go');
  console.error('This adds a scratch marketplace and installs, updates and uninstalls one scratch plugin at project scope on this computer, then removes them.');
  console.error('Run it only after the director has said yes.');
  process.exit(2);
}

const PLUGIN_NAME = 'undo-probe';
const MARKETPLACE_KEY = 'undo';
const MARKETPLACE_NAME = `wheelhouse-probe-${MARKETPLACE_KEY}`;
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

// The two releases. Their shas are filled in once the plugin repository exists.
const RELEASE_A = { label: 'A', tag: 'v1', version: '1.0.0', sha: null };
const RELEASE_B = { label: 'B', tag: 'v2', version: '2.0.0', sha: null };

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
const PLUGIN_CACHE = path.join(SCRATCH_CACHE, PLUGIN_NAME);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(probeLogDir('30-undo'), `run-${stamp}.jsonl`);
const results = [];
const routes = [];

async function note(step, data) {
  console.log(`[${step}] ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  await appendJsonl(logFile, { step, ...(typeof data === 'string' ? { text: data } : data) });
}

async function check(what, ok, detail) {
  results.push({ what, ok });
  await note(`check: ${what}`, { ok, detail });
}

// Set when a stop signal arrives. Once set, no new command starts except the
// undo's own, which say so with { undo: true }.
let stopping = false;
const inflight = new Set();

// Runs a command and never throws: failures are results to record. The child
// is tracked so a stop signal can wait for it to finish.
function run(file, args, options = {}, { track = true } = {}) {
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
    if (track) inflight.add(child);
    child.finished = new Promise((done) => child.once('close', done));
  });
}

// The main flow calls this between steps: once a stop signal has arrived, it stops.
function keepGoing() {
  if (stopping) throw new Error('stopped by a signal');
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

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

async function claude(step, args, cwd, { undo = false } = {}) {
  if (!undo) keepGoing();
  const result = await run('claude', args, { cwd }, { track: !undo });
  await note(step, {
    command: `claude ${args.join(' ')}`,
    code: result.code,
    stdout: result.stdout.slice(0, 20_000),
    stderr: result.stderr.slice(0, 4_000),
    ms: result.ms,
  });
  return result;
}

const GIT_IDENTITY = ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];

function git(dir, args) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// The scratch plugin: a git repository with two releases, tagged v1 and v2.
// Its manifest `version` is different in each, and so is RELEASE.txt, which
// shows which release a cached folder really holds.
function makePluginRepository() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-undo-plugin-'));
  assertUnderTmp(dir);
  git(dir, ['init', '--quiet']);
  for (const release of [RELEASE_A, RELEASE_B]) {
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: PLUGIN_NAME, version: release.version, description: `Scratch plugin for the undo probe, release ${release.label}` }, null, 2) + '\n',
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'RELEASE.txt'), `release ${release.label}\n`, 'utf8');
    fs.mkdirSync(path.join(dir, 'skills', PLUGIN_NAME), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'skills', PLUGIN_NAME, 'SKILL.md'),
      `---\nname: ${PLUGIN_NAME}\ndescription: Scratch skill for the undo probe, release ${release.label}\n---\n\nRelease ${release.label}.\n`,
      'utf8',
    );
    git(dir, ['add', '--all']);
    git(dir, ['commit', '--quiet', '-m', `Release ${release.label}`]);
    git(dir, ['tag', release.tag]);
    release.sha = git(dir, ['rev-parse', 'HEAD']);
  }
  return { dir, url: pathToFileURL(dir).href };
}

function installedEntries() {
  return readJson(INSTALLED_FILE)?.plugins?.[PLUGIN_ID] ?? [];
}

function describeInstall(projectDir) {
  const real = fs.realpathSync(projectDir);
  const entries = installedEntries();
  const entry = entries.find((one) => one.scope === 'project' && [projectDir, real].includes(one.projectPath))
    ?? entries.find((one) => one.scope === 'project')
    ?? entries[0];
  if (!entry) return { installed: false };
  return {
    installed: true,
    entry,
    manifestVersion: readJson(path.join(entry.installPath ?? '', '.claude-plugin', 'plugin.json'))?.version ?? null,
    releaseFile: readText(path.join(entry.installPath ?? '', 'RELEASE.txt')),
  };
}

// Every version folder of the scratch plugin in the cache: whether it carries
// an `.orphaned_at` marker, and which release its RELEASE.txt says it holds.
function cacheState() {
  let names = [];
  try { names = fs.readdirSync(PLUGIN_CACHE); } catch { /* no folder yet */ }
  return Object.fromEntries(names.map((version) => {
    const folder = path.join(PLUGIN_CACHE, version);
    return [version, { orphaned: fs.existsSync(path.join(folder, '.orphaned_at')), release: readText(path.join(folder, 'RELEASE.txt')) }];
  }));
}

// 0. Copies of the user's files, outside the repository.
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-30-backup-'));
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
let pluginRepository;
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
    if (ownsMarketplace && project) {
      await claude(`uninstall ${PLUGIN_ID}`, ['plugin', 'uninstall', PLUGIN_ID, '--scope', 'project'], project.dir, { undo: true });
      await claude('remove marketplace (project scope)', ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--scope', 'project'], project.dir, { undo: true });
      if ((readJson(KNOWN_FILE) ?? {})[MARKETPLACE_NAME]) {
        await claude('remove marketplace (every scope)', ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME], project.dir, { undo: true });
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
    if (pluginRepository) {
      await attempt('clean up the scratch plugin repository', async () => {
        assertUnderTmp(pluginRepository.dir);
        await fs.promises.rm(pluginRepository.dir, { recursive: true, force: true });
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
          if (file === CLAUDE_STATE_FILE) console.error("  Claude Code's own state, so copy it back only if you know the probe changed it:");
          console.error(`  ${copyBackCommand(file)}`);
        }
      }
    });
    if (problems.length) console.error(`Problems while undoing:\n  ${problems.join('\n  ')}`);
    await note('routes used', routes);
    const failed = results.filter((one) => !one.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Log: ${logFile}`);
    if (failed.length) {
      console.log(`Not passed: ${failed.map((one) => one.what).join('; ')}`);
      process.exitCode = 1;
    }
  })();
  return undoPromise;
}

// Installed before anything is made: the undo cleans up whichever of the
// scratch project, plugin repository and marketplace exist by then.
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

// Points the marketplace's entry at one release (ref and sha) and commits it.
function pointMarketplaceAt(release) {
  const file = path.join(marketplace.dir, '.claude-plugin', 'marketplace.json');
  const manifest = readJson(file);
  manifest.plugins[0].source = { source: 'url', url: pluginRepository.url, ref: release.tag, sha: release.sha };
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  git(marketplace.dir, ['commit', '--quiet', '--all', '-m', `Point at release ${release.label}`]);
}

// Whether the install is the given release: the recorded commit, the manifest
// version, and the files in the folder all say so.
function isRelease(info, release) {
  return Boolean(info.installed
    && info.entry.gitCommitSha === release.sha
    && info.manifestVersion === release.version
    && info.releaseFile === `release ${release.label}`);
}

async function installAt(label, project) {
  const installed = await claude(`${label}: install`, ['plugin', 'install', PLUGIN_ID, '--scope', 'project', '--json'], project.dir);
  await check(`${label}: install ran`, installed.code === 0, installed.stderr.slice(0, 300));
}

// Moves the install to a release by pointing the marketplace at it, refreshing
// the marketplace, then `claude plugin update`; if that does not leave the
// release installed, by uninstalling and installing. Returns the route taken.
async function moveTo(release, label, project) {
  keepGoing();
  pointMarketplaceAt(release);
  await note(`${label}: marketplace pointed at`, { release: release.label, ref: release.tag, sha: release.sha });
  await claude(`${label}: marketplace update`, ['plugin', 'marketplace', 'update', MARKETPLACE_NAME], project.dir);
  await claude(`${label}: plugin update`, ['plugin', 'update', PLUGIN_ID, '--scope', 'project', '--json'], project.dir);
  let info = describeInstall(project.dir);
  await note(`${label}: after plugin update`, { info, cache: cacheState() });
  let route = 'plugin update';
  if (!isRelease(info, release)) {
    route = 'uninstall, then install';
    await note(`${label}: plugin update did not leave release ${release.label} installed`, { route });
    const removed = await claude(`${label}: uninstall`, ['plugin', 'uninstall', PLUGIN_ID, '--scope', 'project', '--json'], project.dir);
    await check(`${label}: uninstall ran`, removed.code === 0, removed.stderr.slice(0, 300));
    await installAt(label, project);
    info = describeInstall(project.dir);
    await note(`${label}: after install`, { info, cache: cacheState() });
  }
  routes.push({ step: label, to: release.label, route });
  await check(`${label}: release ${release.label} is installed at its sha`, isRelease(info, release),
    `recorded ${info.entry?.gitCommitSha}, version ${info.manifestVersion}, file ${info.releaseFile}; wanted ${release.sha}, ${release.version}`);
  return { route, info };
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

  // 1. The scratch project, the plugin's repository and the marketplace, at release A.
  project = await makeScratchProject({ name: 'undo-project' });
  pluginRepository = makePluginRepository();
  marketplace = await makeScratchMarketplace({
    name: MARKETPLACE_KEY,
    plugins: [{ name: PLUGIN_NAME, source: { source: 'url', url: pluginRepository.url, ref: RELEASE_A.tag, sha: RELEASE_A.sha } }],
  });
  await note('scratch', {
    project: project.dir,
    marketplace: marketplace.dir,
    plugin: pluginRepository.dir,
    releaseA: { tag: RELEASE_A.tag, sha: RELEASE_A.sha, version: RELEASE_A.version },
    releaseB: { tag: RELEASE_B.tag, sha: RELEASE_B.sha, version: RELEASE_B.version },
  });

  keepGoing();
  console.log('\nAbout to change this computer\'s plugin list. If this run is stopped and the undo does not finish, run these (your own files are copied in the backup folder above; the run lists what, if anything, differs at the end):');
  console.log(`  (cd "${project.dir}" && claude plugin uninstall ${PLUGIN_ID} --scope project)`);
  console.log(`  (cd "${project.dir}" && claude plugin marketplace remove ${MARKETPLACE_NAME})`);
  console.log(`  rm -rf "${SCRATCH_CACHE}"`);
  console.log('');

  // 2. Add the marketplace at project scope (a folder path: Claude Code's
  // documented "directory" source), then install release A.
  // From here a signal or a half-done add must still be undone: the checks at
  // the start proved the name was not there before.
  ownsMarketplace = true;
  const added = await claude('marketplace add', ['plugin', 'marketplace', 'add', marketplace.dir, '--scope', 'project', '--json'], project.dir);
  await check('marketplace added at project scope', added.code === 0, added.stderr.slice(0, 300));
  if (added.code !== 0) throw new Error('the marketplace could not be added: stopping');
  await note('known_marketplaces entry', (readJson(KNOWN_FILE) ?? {})[MARKETPLACE_NAME] ?? 'no entry');

  await installAt('first install of A', project);
  const first = describeInstall(project.dir);
  await note('installed A', { info: first, cache: cacheState() });
  await check('A: installed at its sha', isRelease(first, RELEASE_A),
    `recorded ${first.entry?.gitCommitSha}, version ${first.manifestVersion}, file ${first.releaseFile}; wanted ${RELEASE_A.sha}`);

  // 3. Move to B; A's folder should then be orphaned.
  await moveTo(RELEASE_B, 'forward to B', project);
  const afterForward = cacheState();
  await note('cache after forward to B', afterForward);
  await check('A is orphaned (its folder carries an .orphaned_at marker)', afterForward[RELEASE_A.version]?.orphaned === true, afterForward);

  // 4. Test 1: back to A with its folder still in the cache.
  const back = await moveTo(RELEASE_A, 'back to A, folder kept', project);
  const afterBack = cacheState();
  await note('cache after back to A', afterBack);
  await check('back to A, folder kept: A is no longer marked orphaned', afterBack[RELEASE_A.version]?.orphaned === false, afterBack);
  await check('back to A, folder kept: B is now the orphaned one', afterBack[RELEASE_B.version]?.orphaned === true, afterBack);
  await note('route for going back with the folder kept', back.route);

  // 5. Test 2: forward to B again, delete A's cached folder (standing in for
  // the 14-day clean-up), then back to A.
  await moveTo(RELEASE_B, 'forward to B again', project);
  keepGoing();
  const folderA = path.join(PLUGIN_CACHE, RELEASE_A.version);
  // Only a version folder inside the scratch marketplace's own cache folder.
  if (path.basename(SCRATCH_CACHE) !== MARKETPLACE_NAME || !folderA.startsWith(SCRATCH_CACHE + path.sep)) {
    throw new Error(`Refusing to delete ${folderA}: it is not inside the scratch marketplace's cache folder`);
  }
  const pointsAtA = installedEntries().some((one) => one.installPath === folderA);
  await check("A's cached folder is not the one the install now uses", !pointsAtA, installedEntries());
  await check("A's cached folder exists before it is deleted", fs.existsSync(folderA), cacheState());
  await fs.promises.rm(folderA, { recursive: true, force: true });
  await note("A's cached folder deleted", { folder: folderA, cache: cacheState() });
  await check("A's cached folder is gone", !fs.existsSync(folderA), cacheState());

  const refetch = await moveTo(RELEASE_A, "back to A, A's folder deleted first", project);
  const afterRefetch = cacheState();
  await note("cache after going back to A with its folder deleted", afterRefetch);
  await check("A's folder is back in the cache", fs.existsSync(folderA), afterRefetch);
  await check("A's folder is not marked orphaned", afterRefetch[RELEASE_A.version]?.orphaned === false, afterRefetch);
  await note("route for going back with A's folder deleted", refetch.route);
} catch (error) {
  results.push({ what: 'the probe ran to the end', ok: false });
  await note('error', { message: String(error.stack ?? error) });
  console.error(`Stopped: ${error.message}`);
} finally {
  await undo();
}
