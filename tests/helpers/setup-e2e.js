// tests/helpers/setup-e2e.js
// The world of setup's end-to-end tests (tests/e2e/setup.test.js): a stand-in host shared by the
// director's computers, and each computer with its own scratch homes, a real helper on a socket in
// its own Wheelhouse home, setup's ten real steps (setup-e2e-steps.js) on a fake computer, and the
// director's clicks made by the prompt record's decide, as Claude Code calls it after
// AskUserQuestion. The playbook's commands are scripts/setup/cli.js's own forms, given this helper's
// client.
//
// Nothing real is reached:
//   - the host is a folder of bare repositories; `gh` is a stand-in answering from it (the account,
//     its repositories, a repository made), and the helper's adapter keeps its pull requests in
//     memory: a merge is never made;
//   - `claude` is a stand-in that installs the pinned kits (small copies, with a manifest of their
//     own) into the computer's scratch Claude Code folder (CLAUDE_CONFIG_DIR), as a project-scope
//     install would;
//   - every other program but git and Node.js is refused and noted (`refused`), so a test can show
//     no installer, launchctl, osascript or browser ran;
//   - a long step's own process and uninstall's own process run in this process (run-step.js's
//     runStep and uninstall-run.js's runUninstall, through the helper's `spawn`), on the test's
//     clock, with uninstall's host work, page opening and process stops as stand-ins;
//   - the programs setup must never reach for real are found first on the PATH as stand-ins
//     (shimTools), for the helper's own calls by name, which take no stand-in of the test's;
//   - step 2 fetches gh from a stand-in of its release page, as a computer without gh would;
//   - the foreman's watcher is stood in for by a sleeping child process holding the watcher's lock,
//     so setup's ending finds it running and starts no real one (which could wake a session);
//   - git runs with the global and system config shut out (shutOutGitConfig, and the computer's own
//     `run`), as setup's own git does, so the developer's git config changes nothing (ruling R144).
// Each command and click goes through the hooks Claude Code would call first: the PreToolUse
// guards for the playbook's Bash command, and the card check for each card.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startHelper, envForConnection } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { readProject } from '../../scripts/lib/projects.js';
import { run as realRun } from '../../scripts/lib/run.js';
import { main as cli } from '../../scripts/setup/cli.js';
import { RUN_STEP, NEEDS_CLICK } from '../../scripts/setup/engine.js';
import { runStep } from '../../scripts/setup/run-step.js';
import { runUninstall } from '../../scripts/setup/uninstall-run.js';
import { findRun } from '../../scripts/setup/journal.js';
import { SESSION_CHECKS } from '../../scripts/setup/health.js';
import { PUSH_TEST_WAIT_MS } from '../../scripts/lib/setup-numbers.js';
import { decide as promptRecord } from '../../scripts/hooks/prompt-record.js';
import { decide as sessionStart } from '../../scripts/hooks/session-start.js';
import claudeCodeSheet from '../../adapters/claude-code/tool-sheet.js';
import { decide as stopGuard } from '../../scripts/hooks/stop-guard.js';
import { decide as lineageHold } from '../../scripts/hooks/lineage-hold.js';
import { decide as toolGuard } from '../../scripts/hooks/tool-guard.js';
import { decide as cardCheck } from '../../scripts/hooks/card-check.js';
import { setupCommand } from '../../scripts/protection/settings.js';
import { buildManifest, checkInstalled } from '../../scripts/lineage/manifest.js';
import { lockFile } from '../../scripts/watcher/main.js';
import { g } from './git-fixture.js';
import { shortHome, tempFolder, testAddress } from './homes.js';
import { standInTools } from './host-stand-ins.js';

// Where the computers' worlds are kept for the steps module the helper loads (setup-e2e-steps.js):
// globalThis[WORLDS], a Map from each computer's Wheelhouse home to its world.
export const WORLDS = 'wheelhouseSetupE2e';
export const STEPS_MODULE = fileURLToPath(new URL('./setup-e2e-steps.js', import.meta.url));
// The plugin's own folder, as the playbook names its command.
export const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const UNINSTALL_RUN = fileURLToPath(new URL('../../scripts/setup/uninstall-run.js', import.meta.url));

// The director's account on the host.
const GH_USER = { login: 'a-director', id: 4242, name: 'A Director' };
const SHA = { superpowers: 'a'.repeat(40), 'mattpocock-skills': 'b'.repeat(40) };
// The install line declares Wheelhouse's marketplace at its release in the user's Claude settings
// (check 37), and switches the plugin on in the product folder's own settings.
const RELEASE = 'v1.4.0';
const INSTALLED = `${JSON.stringify({ enabledPlugins: { 'wheelhouse@wheelhouse': true } }, null, 2)}\n`;

const answer = (stdout, code = 0, stderr = '') => ({ code, stdout, stderr });
const noFetch = async (url) => { throw new Error(`nothing is fetched in this test: ${url}`); };

// ---- The clock both computers and every process here read ----

export function makeClock(start = Date.now()) {
  let t = start;
  return { now: () => new Date(t), tick: (ms = 1000) => { t += ms; } };
}

// ---- git with the developer's own config shut out (ruling R144) ----

// No system config and an empty global one, as setup's own git has (R109): a hooks path, commit
// signing or an insteadOf in the developer's git config never changes what the tests' git does.
export const NO_GIT_CONFIG = Object.freeze({ GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull });

// Shuts the config out for every git this process runs that keeps the GIT_* variables it inherits
// (the tests' own, the fixture's, the code's), until `restore`.
export function shutOutGitConfig() {
  const before = Object.fromEntries(Object.keys(NO_GIT_CONFIG).map((k) => [k, process.env[k]]));
  Object.assign(process.env, NO_GIT_CONFIG);
  return {
    restore: () => {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    },
  };
}

// ---- Programs run by name ----

// The programs no test here may reach for real, each found first on the PATH as a stand-in that
// notes its arguments in `log` and refuses (tests/helpers/host-stand-ins.js), but for `gh pr close`,
// which it takes: the helper's own routes run `gh` by name with no stand-in of the test's to give
// them (the trial pull request's close, scripts/setup/health.js's closeOpenTrial), so this is where
// the host's tool is stood in for them. `answer` gives what read calls print, as standInTools takes
// it (the survey's list of open pull requests, say). `calls()` gives what was run, one line each.
export function shimTools({ answer = {} } = {}) {
  return standInTools({ accept: { gh: [['pr', 'close']] }, answer });
}

// ---- gh's official release, and a computer without gh ----

// GitHub's release pages for gh, as tools.js reads them: the latest tag, its checksums and its
// archives, each archive's bytes a stand-in.
const GH_TAG = 'v2.102.0';
const GH_NAMES = ['gh_2.102.0_macOS_arm64.zip', 'gh_2.102.0_macOS_amd64.zip', 'gh_2.102.0_linux_arm64.tar.gz', 'gh_2.102.0_linux_amd64.tar.gz', 'gh_2.102.0_windows_amd64.zip'];
const archiveBytes = (name) => Buffer.from(`archive ${name}`);
export async function ghRelease(url, init = {}) {
  const base = `https://github.com/cli/cli/releases/download/${GH_TAG}`;
  if (url === 'https://github.com/cli/cli/releases/latest' && init.redirect === 'manual') {
    return new Response(null, { status: 302, headers: { location: `https://github.com/cli/cli/releases/tag/${GH_TAG}` } });
  }
  if (url === `${base}/gh_2.102.0_checksums.txt`) {
    return new Response(GH_NAMES.map((name) => `${crypto.createHash('sha256').update(archiveBytes(name)).digest('hex')}  ${name}`).join('\n'));
  }
  const name = GH_NAMES.find((n) => url === `${base}/${n}`);
  if (name) return new Response(archiveBytes(name));
  throw new Error(`nothing else is fetched in this test: ${url}`);
}

// Step 2's computer: every tool on the path at a good version but gh, which setup fetches; tar
// unpacks gh's archive as a copy that hands every call to the stand-in gh on the PATH (shimTools),
// or refuses when there is none.
function toolsRunFor(shimDir) {
  const said = (stdout, code = 0) => ({ code, stdout, stderr: '' });
  return async (file, args = [], options = {}) => {
    const name = file.split(/[\\/]/).pop();
    if (name === 'which' || name === 'where') return args[0] === 'gh' ? said('', 1) : said(`/usr/bin/${args[0]}\n`);
    if (name === 'xcode-select' && args[0] === '-p') return said('/Library/Developer/CommandLineTools\n');
    if (name === 'tar' || name === 'tar.exe') {
      const into = path.resolve(options.cwd ?? '.', args[3]);
      fs.mkdirSync(path.join(into, 'gh_x', 'bin'), { recursive: true });
      const hand = shimDir === null ? 'echo "gh is not run in this test" >&2; exit 1' : `exec '${path.join(shimDir, 'gh')}' "$@"`;
      fs.writeFileSync(path.join(into, 'gh_x', 'bin', 'gh'), `#!/bin/sh\n${hand}\n`, { mode: 0o755 });
      return said('');
    }
    if (args[0] === '--version') return said(name === 'node' ? 'v22.3.0\n' : name === 'gh' ? 'gh version 2.102.0 (2026-09-30)\n' : `${name} version 2.40.0\n`);
    return said('');
  };
}

// ---- The stand-in host ----

async function seedBare(dir, { readme }) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const made = await realRun('git', ['init', '--bare', '-q', '-b', 'main', dir]);
  if (made.code !== 0) throw new Error('git init --bare failed');
  if (!readme) return;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seed-'));
  try {
    await g(work, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(work, 'README.md'), readme);
    await g(work, 'add', 'README.md');
    await g(work, 'commit', '-q', '-m', 'Initial commit');
    await g(work, 'push', '-q', dir, 'main');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// The host: its repositories as bare repositories under `root`, each with a number; the pull
// requests opened on it; and the branches whose protection is on.
export function standInHost({ shims = null } = {}) {
  const root = tempFolder('wh-host ');
  const host = { root, ids: {}, next: 40, prs: new Map(), nextPr: 12, protected: new Set(), shims };
  // A pull request closed by the stand-in `gh` on the PATH (shimTools) is closed here too.
  const closedByName = (number, repo) => shims !== null && shims.calls().includes(`gh pr close ${number} --repo ${repo}`);
  host.url = ({ repo }) => path.join(root, `${repo}.git`);
  host.has = (repo) => fs.existsSync(host.url({ repo }));
  host.idOf = (repo) => (host.ids[repo] ??= ++host.next);
  host.make = async (repo, { readme = null } = {}) => {
    await seedBare(host.url({ repo }), { readme });
    host.idOf(repo);
  };
  // A repository the director already has: `files` ({ path: text }) committed on main.
  host.seed = async (repo, files) => {
    await seedBare(host.url({ repo }), { readme: null });
    host.idOf(repo);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seed-'));
    try {
      await g(work, 'init', '-q', '-b', 'main');
      for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
        fs.writeFileSync(path.join(work, file), text);
      }
      await g(work, 'add', '-A');
      await g(work, 'commit', '-q', '-m', 'The director\'s own work');
      await g(work, 'push', '-q', host.url({ repo }), 'main');
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  };
  // A pull request's or a branch's tip on the host, or null.
  host.tip = async (repo, ref) => {
    const got = await realRun('git', ['rev-parse', '--verify', '-q', ref], { cwd: host.url({ repo }) });
    return got.code === 0 ? got.stdout.trim() : null;
  };
  // The pull requests opened on the host, as [number, { repo, head, base, title, state }].
  host.pulls = () => [...host.prs].map(([number, pr]) => [number, { ...pr, state: closedByName(number, pr.repo) ? 'closed' : pr.state }]);
  // gh and glab's adapter over the host: pull requests kept here, never merged.
  host.adapter = (repo) => ({
    defaultBranch: async () => 'main',
    openPr: async ({ head, base, title }) => {
      const number = host.nextPr++;
      host.prs.set(number, { repo, head, base, title, state: 'open' });
      return { number, url: `https://github.com/${repo}/pull/${number}` };
    },
    prState: async (number) => {
      const pr = host.prs.get(Number(number));
      if (pr && closedByName(number, pr.repo)) pr.state = 'closed';
      return { state: pr?.state ?? 'closed', headSha: pr ? await host.tip(pr.repo, `refs/heads/${pr.head}`) : null, mergeable: 'mergeable', body: '' };
    },
    closePr: async (number) => {
      const pr = host.prs.get(Number(number));
      if (pr) pr.state = 'closed';
      return { number };
    },
    updatePr: async ({ number }) => ({ number }),
    ciState: async (sha) => ({ sha, state: 'pending' }),
    merge: async () => ({ merged: false }),
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  });
  return host;
}

// A small copy of each pinned kit, and the manifest naming them, for the stand-in `claude` to
// install and step 10 to check.
function kits(root) {
  const upstreams = ['superpowers', 'mattpocock-skills'].map((name) => ({
    name, plugin: name, repo: `https://example.invalid/${name}.git`, ref: 'v1.0.0', sha: SHA[name], folders: ['skills/one'], files: ['LICENSE'],
  }));
  const roots = {};
  for (const u of upstreams) {
    roots[u.name] = path.join(root, 'pristine', u.name);
    fs.mkdirSync(path.join(roots[u.name], 'skills', 'one'), { recursive: true });
    fs.writeFileSync(path.join(roots[u.name], 'skills', 'one', 'SKILL.md'), `${u.name}\n`);
    fs.writeFileSync(path.join(roots[u.name], 'LICENSE'), 'licence\n');
  }
  const manifest = buildManifest({ roots, version: '1.4.0', upstreams });
  // The plugin's lineage/manifest.json as the session start's lineage check reads it, naming these.
  fs.mkdirSync(path.join(root, 'plugin', 'lineage'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin', 'lineage', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, roots, lineageRoot: path.join(root, 'plugin') };
}

// ---- One of the director's computers ----

// A computer: a scratch user home with a space and an accent in its name, the Claude Code folder
// in it ("claude config", given as CLAUDE_CONFIG_DIR), the product folder under its Projects as
// the install line leaves it (`name`, holding only .claude/settings.json switching the plugin on),
// and a short Wheelhouse home of its own for the helper's socket. `act(fn)` runs fn as this
// computer: with its Wheelhouse home and Claude Code folder in the environment.
export function makeComputer(host, clock, { name = 'Café Menu' } = {}) {
  const home = shortHome();
  const user = tempFolder('wh-user zoë ');
  const config = path.join(user, 'claude config');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.json'), `${JSON.stringify({
    extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: RELEASE } } },
  }, null, 2)}\n`);
  const made = path.join(user, 'Projects', name);
  fs.mkdirSync(path.join(made, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(made, '.claude', 'settings.json'), INSTALLED);
  const folder = fs.realpathSync.native(made);
  const k = kits(tempFolder('wh-kits-'));
  const managedDir = tempFolder('wh-managed ');
  const session = crypto.randomUUID();
  const c = {
    home, user, config, folder, managedDir, session, manifest: k.manifest, host, clock,
    refused: [], calls: [], children: [], helper: null, client: null, watcher: null,
  };

  // `gh`, `claude` and git as this computer runs them; anything else is refused and noted. Git has
  // the config shut out even where its caller took out the GIT_* variables it inherits, as the
  // helper does for its own calls (ruling R144).
  c.run = async (file, args = [], options = {}) => {
    const tool = path.basename(file).replace(/\.(exe|cmd)$/i, '');
    if (tool === 'git') return realRun(file, args, { ...options, env: { ...options.env, ...NO_GIT_CONFIG } });
    if (file === process.execPath) return realRun(file, args, options);
    c.calls.push([tool, ...args]);
    if (tool === 'gh') return gh(args);
    if (tool === 'claude') return claude(args, options);
    c.refused.push([tool, ...args]);
    return answer('', 1, `${tool} is not run in this test`);
  };
  async function gh(args) {
    if (args[0] === 'auth' && args[1] === 'status') return answer('', 0, 'Logged in to github.com');
    if (args[0] === 'api' && args[1] === 'user') return answer(JSON.stringify(GH_USER));
    if (args[0] === 'api' && args[1].startsWith('user/memberships/orgs')) return answer('[]');
    if (args[0] === 'api' && args[1].startsWith('repos/')) {
      const repo = args[1].slice('repos/'.length);
      return host.has(repo)
        ? answer(JSON.stringify({ full_name: repo, id: host.idOf(repo), default_branch: 'main', private: true }))
        : answer('', 1, 'gh: Not Found (HTTP 404)');
    }
    if (args[0] === 'repo' && args[1] === 'create') {
      if (host.has(args[2])) return answer('', 1, 'GraphQL: Name already exists on this account (createRepository)');
      await host.make(args[2], { readme: args.includes('--add-readme') ? `# ${args[2].split('/').at(-1)}\n` : null });
      return answer(`https://github.com/${args[2]}\n`);
    }
    c.refused.push(['gh', ...args]);
    return answer('', 1, 'unknown command');
  }
  async function claude(args, options) {
    if (!(args[0] === 'plugin' && args[1] === 'install' && args[args.indexOf('--scope') + 1] === 'project')) {
      c.refused.push(['claude', ...args]);
      return answer('', 1, 'unknown command');
    }
    const [plugin, marketplace] = args[2].split('@');
    const into = path.join(config, 'plugins', 'cache', marketplace, plugin);
    fs.cpSync(k.roots[plugin], into, { recursive: true });
    const file = path.join(config, 'plugins', 'installed_plugins.json');
    let record = { version: 2, plugins: {} };
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* the first */ }
    record.plugins[args[2]] = [{ scope: 'project', projectPath: options.cwd, installPath: into, version: '1.0.0', gitCommitSha: SHA[plugin] }];
    fs.writeFileSync(file, JSON.stringify(record));
    // Claude Code switches the plugin on in the project's settings as it installs it.
    const settings = path.join(options.cwd, '.claude', 'settings.json');
    const was = JSON.parse(fs.readFileSync(settings, 'utf8'));
    fs.writeFileSync(settings, JSON.stringify({ ...was, enabledPlugins: { ...was.enabledPlugins, [args[2]]: true } }));
    return answer(`Successfully installed plugin: ${args[2]} (scope: project)\n`);
  }

  // The world setup's steps read (setup-e2e-steps.js).
  const world = {
    run: c.run,
    toolsRun: toolsRunFor(host.shims?.dir ?? null),
    fetch: ghRelease,
    hostUrl: host.url,
    config,
    manifest: k.manifest,
    managedDir,
    adapterFor: ({ repo }) => host.adapter(repo),
    // Protection as switchOnAsDirector gives it, kept on the host.
    switchOn: async ({ repo }) => {
      host.protected.add(repo);
      return { available: true, on: true, line: 'GitHub blocks direct pushes to main.' };
    },
    protectionStatus: async ({ repo }) => ({ available: true, on: host.protected.has(repo), line: 'read' }),
    readProtection: async ({ repo }) => (host.protected.has(repo) ? 'on' : 'off'),
    // The pins step 7 installed, checked against the kits' manifest as step 10 checks them.
    checkPins: ({ folder }) => (checkInstalled({ manifest: k.manifest, projectDir: folder, claudeHome: config }).ok ? 'match' : 'differ'),
  };
  globalThis[WORLDS] ??= new Map();
  globalThis[WORLDS].set(home, world);
  c.world = world;

  // As this computer: its homes in the environment while fn runs.
  c.act = async (fn) => {
    const before = { WHEELHOUSE_HOME: process.env.WHEELHOUSE_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
    process.env.WHEELHOUSE_HOME = home;
    process.env.CLAUDE_CONFIG_DIR = config;
    try {
      return await fn(c);
    } finally {
      for (const [k2, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k2]; else process.env[k2] = v;
      }
    }
  };

  // Uninstall's host work, page opening and stops, as uninstall-run.js's tests stand them in.
  c.uninstallOps = {
    pages: [],
    stops: [],
    findGit: async () => ({ ok: true, path: 'git' }),
    adapterFor: ({ repo }) => host.adapter(repo),
    findOpenPr: async ({ repo, branch }) => {
      const found = [...host.prs].find(([, pr]) => pr.repo === repo && pr.head === branch && pr.state === 'open');
      return found ? { number: found[0], url: `https://github.com/${repo}/pull/${found[0]}` } : null;
    },
    openPage: async (url) => { c.uninstallOps.pages.push(url); },
    stopForeman: async () => { c.uninstallOps.stops.push('foreman'); return { stopped: false, why: 'not running' }; },
    stopWatcher: async () => {
      c.uninstallOps.stops.push('watcher');
      c.stopWatcher();
      return { stopped: true };
    },
    stopReceiver: async () => { c.uninstallOps.stops.push('receiver'); return { stopped: false, why: 'not running' }; },
  };

  // The helper's way of starting a long step's own process, or uninstall's: here, in this process.
  c.spawn = (file, args) => {
    const handlers = {};
    let done;
    if (args[0] === RUN_STEP) done = runStep(args.slice(1), { now: clock.now, exit: () => {}, tickMs: 1000 });
    else if (args[0] === UNINSTALL_RUN) {
      done = runUninstall(args.slice(1), { now: clock.now, exit: () => {}, tickMs: 1000, run: c.run, fetch: noFetch, ops: c.uninstallOps });
    } else throw new Error(`nothing else is started: ${args[0]}`);
    c.children.push(done.then((code) => { handlers.exit?.(code); return code; }));
    return { on: (event, handler) => { handlers[event] = handler; }, unref() {} };
  };
  // Waits for every process started here to end.
  c.settle = async () => {
    while (c.children.length > 0) await Promise.all(c.children.splice(0));
  };

  // A session: the helper started, as the session start's ensureHelper would find it.
  c.start = () => c.act(async () => {
    if (c.helper !== null) return c.helper;
    c.helper = await startHelper({
      address: testAddress(home), adapterFor: async (project) => host.adapter(readProject(project)?.repo ?? ''),
      envFor: envForConnection((project) => readProject(project)?.connection), profileEnvFor: async () => ({ mode: 'quick', env: {} }),
      now: clock.now, run: c.run, fetch: noFetch, setupSteps: STEPS_MODULE, userHome: user, spawn: c.spawn,
      onStop: (close) => { c.helper = null; return close(); },
    });
    c.client = helperClient({ address: c.helper.address });
    return c.helper;
  });
  // Desktop closed: the helper goes, and whatever was in memory with it.
  c.stop = async () => {
    try {
      await c.settle();
    } finally {
      if (c.helper !== null) await c.act(() => c.helper.close());
      c.helper = null;
    }
  };

  // The playbook's command, scripts/setup/cli.js, in the product folder: its answer as JSON when it
  // gives JSON, otherwise its lines; a refusal throws with its words. A long step or uninstall it
  // started has finished when it returns.
  c.cli = (...argv) => c.act(async () => {
    // Claude Code asks the PreToolUse guards first, for the playbook's Bash command as it runs it.
    const command = [setupCommand(PLUGIN_ROOT), ...argv.map((a2) => (/^[A-Za-z0-9]+$/.test(a2) ? a2 : `"${a2}"`))].join(' ');
    const asked = { session_id: session, cwd: folder, hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command } };
    for (const [name, guard] of [['stop-guard', stopGuard], ['lineage-hold', lineageHold], ['tool-guard', (i) => toolGuard(i, { dir: managedDir, home: user })]]) {
      const said = await guard(asked, { dir: managedDir });
      const denied = said?.hookSpecificOutput?.permissionDecision === 'deny';
      if (denied) throw new Error(`cli.js ${argv.join(' ')}: ${name} refused it: ${said.hookSpecificOutput.permissionDecisionReason}`);
    }
    let out = '';
    let err = '';
    const code = await cli(argv, { client: c.client, cwd: folder, out: (t) => { out += t; }, err: (t) => { err += t; } });
    // A process the command started runs to its end while this computer's homes are still the
    // environment's, as its own process's would be.
    await c.settle();
    if (code !== 0) throw new Error(`cli.js ${argv.join(' ')}: ${err.trim()}`);
    try {
      return JSON.parse(out);
    } catch {
      return out.trim().split('\n');
    }
  });

  // The same, when the command may refuse: { ok: true, got } or { ok: false, refused }.
  c.cliTry = async (...argv) => {
    try {
      return { ok: true, got: await c.cli(...argv) };
    } catch (error) {
      return { ok: false, refused: error.message };
    }
  };

  // This folder's setup run as the journal holds it.
  c.setupRun = () => c.act(() => findRun(folder));

  // The director's answer on a card asked with AskUserQuestion, as the prompt record takes it: a
  // label offered, or text typed (Other). Then the clock moves on a second.
  c.click = (card, label) => c.act(async () => {
    // The card check comes first, as Claude Code asks it before AskUserQuestion shows the card.
    const checked = await cardCheck({ session_id: session, cwd: folder, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [card] } }, { dir: managedDir, now: clock.now });
    if (checked?.hookSpecificOutput?.permissionDecision === 'deny') throw new Error(`the card check refused the card: ${checked.hookSpecificOutput.permissionDecisionReason}`);
    await promptRecord({
      session_id: session, cwd: folder, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
      tool_input: { questions: [card], answers: { [card.question]: label } },
      tool_response: { answers: { [card.question]: label } },
    }, { client: c.client, now: clock.now, dir: managedDir });
    clock.tick();
  });

  // A session start in the product folder, as Claude Code calls the hook: its context lines, without the tool
  // sheet and the command line (tests/skills/tool-names.test.js pins those), so setup's own lines read as they are.
  c.sessionStart = () => c.act(async () => {
    const got = await sessionStart({ session_id: session, cwd: folder, hook_event_name: 'SessionStart', source: 'startup' }, {
      client: c.client, now: clock.now, dir: managedDir, spawn: () => { throw new Error('nothing is started by the session start here'); },
      background: async () => null, claudeHome: config, lineageRoot: k.lineageRoot,
    });
    const sheet = new Set(claudeCodeSheet.split('\n'));
    return String(got?.hookSpecificOutput?.additionalContext ?? '').split('\n').filter((l) => l !== '' && !sheet.has(l) && !l.startsWith('The Wheelhouse command is '));
  });

  // The foreman's watcher, stood in for: a sleeping child process holding the watcher's lock.
  c.standInWatcher = (project) => c.act(() => {
    const child = nodeSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore' });
    c.watcher = child;
    fs.mkdirSync(path.dirname(lockFile(project)), { recursive: true });
    fs.writeFileSync(lockFile(project), String(child.pid));
  });
  c.stopWatcher = () => {
    c.watcher?.kill();
    c.watcher = null;
  };

  // Everything this computer started, ended.
  c.cleanup = async () => {
    try {
      await c.stop();
    } finally {
      c.stopWatcher();
      globalThis[WORLDS].delete(home);
    }
  };
  return c;
}

// ---- Following setup, as the playbook does ----

// The session's seven trial lines, each as expected, as scripts/health/trials.js prints them when
// every trial holds (the trials run in the session's sandbox, which a test has no part in).
export const GREEN_LINES = Object.entries(SESSION_CHECKS).map(([name, check]) => `${name}: ${check.expected} / ${check.expected}`);

// Follows setup on computer `c` as the playbook does, from `cli.js resume`'s card each time, until
// step `through` is done or no step is left: a question is answered with `answer(id, plan)`'s
// label or typed text (`plan` carries `unanswered` when it is asked again); a step's Go-ahead card
// is clicked, after apply is shown to refuse it without the click, then applied; step 9's wait is
// waited out on the clock; and step 10's open trial is reported with the session's trial lines.
// Gives what happened, in order: { step, ask, label, unanswered? }, { step, goAhead: hash,
// refusedBefore }, { step, settled: true, said? }, { step, wait }, { step: 10, health }.
export async function follow(c, { answer, through = 10, lines = GREEN_LINES, most = 80 } = {}) {
  const log = [];
  const done = async (n) => typeof (await c.setupRun())?.steps?.[n]?.doneAt === 'string';
  for (let i = 0; i < most; i += 1) {
    const resumed = await c.cli('resume');
    const plan = resumed.plan;
    if (plan === null) return log;
    if (plan.step > through) return log;
    if (plan.ask) {
      const label = answer(plan.ask.id, plan);
      if (label === undefined) throw new Error(`no answer for step ${plan.step}'s question ${plan.ask.id}`);
      log.push({ step: plan.step, ask: plan.ask.id, label, ...(plan.unanswered ? { unanswered: plan.unanswered } : {}) });
      await c.click(plan.ask.card, label);
    } else if (plan.done) {
      log.push({ step: plan.step, settled: true, ...(plan.said ? { said: plan.said } : {}) });
    } else if (plan.wait !== undefined && plan.step === 10 && /trial pull request/.test(plan.why)) {
      const named = await c.cli('health');
      await c.standInWatcher(named.trials.project);
      const health = await c.cli('health', ...lines);
      log.push({ step: 10, health });
      return log;
    } else if (plan.wait !== undefined) {
      log.push({ step: plan.step, wait: plan.why });
      c.clock.tick(plan.step === 9 && plan.waitsFor === undefined ? PUSH_TEST_WAIT_MS : 1000);
    } else {
      const before = await c.cliTry('apply', String(plan.step), plan.hash);
      if (before.ok || !before.refused.includes(NEEDS_CLICK)) throw new Error(`step ${plan.step} was not refused without its click: ${JSON.stringify(before)}`);
      await c.click(plan.card, 'Go ahead');
      await c.cli('apply', String(plan.step), plan.hash);
      log.push({ step: plan.step, goAhead: plan.hash, card: plan.card, refusedBefore: before.refused });
      if (!(await done(plan.step))) throw new Error(`step ${plan.step} did not finish: ${(await c.setupRun())?.steps?.[plan.step]?.failed}`);
    }
    // Step 10 is done once its board has been green, which the health route reads, not its apply.
    if (plan.step === through && through !== 10 && await done(through)) return log;
  }
  throw new Error('setup kept asking');
}

// ---- The home folders, compared ----

// Every file and folder under `root`, by path relative to it, with a file's SHA-256, a link's
// target and a folder as 'folder'; sockets left out.
export function listing(root) {
  const out = {};
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (e.isSymbolicLink()) out[rel] = `link ${fs.readlinkSync(full)}`;
      else if (e.isDirectory()) {
        out[rel] = 'folder';
        walk(full);
      } else if (e.isFile()) out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(root);
  return out;
}

// What changed between two listings: { added, removed, changed }, each a sorted list of paths.
export function differences(before, after) {
  const added = Object.keys(after).filter((p) => !Object.hasOwn(before, p)).sort();
  const removed = Object.keys(before).filter((p) => !Object.hasOwn(after, p)).sort();
  const changed = Object.keys(after).filter((p) => Object.hasOwn(before, p) && before[p] !== after[p]).sort();
  return { added, removed, changed };
}
