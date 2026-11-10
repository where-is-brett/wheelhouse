// probes/haiku-trial/host.js
// The real `io` the runner's command line uses: tmux, gh, the clock, the project's records and the processes a run starts.
// It is built only inside the runner's `main`, so tests and `plan` never reach it. Nothing here is created before a go.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { makeTmux } from './tmux.js';
import { standInAnswers } from './stand-in.js';
import { faults } from './faults.js';
import { checkAll, gatherContext } from './signals.js';
import { scoreAll } from './score/total.js';
import { runFolder, writeRaw, writeSummary } from './results.js';
import { stagePlugin, installedProblem } from './stage-plugin.js';
import { makeTestProject } from './seed.js';
import { applySpareBug } from './spare-bug.js';
import { makeBrowse } from './score/a11y.js';
import { findTranscripts } from './audit.js';
import { liveFeatureSessions } from './sessions.js';
import { readUsage } from './usage.js';
import { listEvents } from '../../scripts/state/events.js';
import { stateDir, engineDir, projectsDir } from '../../scripts/lib/paths.js';
import { readHelperRecord } from '../../scripts/host/helper-record.js';
import { startSeconds } from '../../scripts/update/old-helper.js';
import { processStartTime } from '../../scripts/watcher/waker.js';
import { stopWatcher, stopForeman } from '../../scripts/foreman/start.js';
import { queueFolderOf } from '../../scripts/engine/queue-place.js';
import { typedRepliesOn } from '../../scripts/decisions/answer.js';
import { decisionNumber } from '../../scripts/decisions/pending.js';
import { installDependencies } from './score/run.js';
import { visibleFromChange } from '../../scripts/gate/visible.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IDENTITY = ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', '-c', 'commit.gpgsign=false'];
// The cards a stand-in director answers with a pick. Decisions, undo approvals and lifts are never in this list.
export { PICKED } from './stand-in.js';

// A `gh` call with the test repository's name filled in. Everything but `api` (which carries the repository in its path) and
// `repo` (which names it) is scoped with --repo, so a command run from a Wheelhouse checkout never reads Wheelhouse's own records.
export function ghArgs(args, slug) {
  const [owner = '', name = ''] = String(slug).split('/');
  const filled = args.map((a) => String(a).replaceAll('{owner}/{repo}', slug).replaceAll('{owner}', owner).replaceAll('{repo}', name));
  return filled[0] === 'api' || filled[0] === 'repo' ? filled : [...filled, '--repo', slug];
}

// What the gate reads of a pull request's change: its files and its diff, through `visibleFromChange`, which is pure.
export async function readGateWith({ gh, change }) {
  if (typeof change !== 'string' || change === '') return null;
  const pulls = (await gh(['api', 'repos/{owner}/{repo}/pulls?state=all&per_page=100'])) ?? [];
  const pull = pulls.find((p) => `${p.head?.ref ?? ''} ${p.title ?? ''}`.toLowerCase().includes(change.toLowerCase()));
  if (!pull) return null;
  const files = (await gh(['api', `repos/{owner}/{repo}/pulls/${pull.number}/files?per_page=100`])) ?? [];
  const diff = await gh(['api', `repos/{owner}/{repo}/pulls/${pull.number}`, '-H', 'Accept: application/vnd.github.v3.diff']);
  return visibleFromChange({ paths: files.map((f) => f.filename), diff: typeof diff === 'string' ? diff : undefined });
}

// A process start time as whole seconds, from `ps`'s lstart in either order: month first ("Mon Nov  9 00:36:26 2026") or
// day first ("Mon  9 Nov 00:36:26 2026"), as `ps` prints it under a day-first locale such as en_AU. Wheelhouse's own
// startSeconds now reads both, so this is that, kept under the name the trial's tests use.
export function startOf(text) {
  return startSeconds(text);
}

// Wheelhouse keeps a project's records under its NAME (owner__repo); the runner's processes work in its FOLDER. These two
// guards make a mix-up throw at the host, where the fakes in the runner's tests cannot hide it.
const NAME_SHAPE = /^[A-Za-z0-9._-]+$/;
export function nameOf(project) {
  if (typeof project !== 'string' || !NAME_SHAPE.test(project) || /^\.+$/.test(project)) throw new Error(`Expected the project's name (owner__repo), not "${project}"`);
  return project;
}
export function dirOf(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error(`Expected the project's folder as a full path, not "${dir}"`);
  return dir;
}

// How long a card the stand-in acted on is left before it is tried again.
const RETRY_MS = 90 * 1000;

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options });
const text = (got) => String(got.stdout ?? '').trim();

export function buildRealIo(env = process.env, label) {
  let slug = '';
  const acted = new Map();
  const tmux = makeTmux({ label });

  const gh = async (args) => {
    const full = ghArgs(args, slug);
    const got = run('gh', full);
    if (got.status !== 0) {
      if (full[0] !== 'api') throw new Error(String(got.stderr || got.error?.message || `exit ${got.status}`).trim());
      return null;
    }
    try { return JSON.parse(got.stdout); } catch { return text(got); }
  };

  const git = (args, { cwd }) => {
    const got = run('git', args, { cwd });
    if (got.status !== 0) throw new Error(`git ${args[0]} failed: ${String(got.stderr).trim()}`);
    return text(got);
  };

  const host = {
    useRepo(value) { slug = value; },
    stage: ({ out }) => stagePlugin({ repo: REPO_ROOT, out }),
    exec: (argv, { cwd } = {}) => run(argv[0], argv.slice(1), { cwd }),
    installedProblem: async ({ configDir, pluginDir }) => installedProblem({ configDir, pluginDir }),
    makeProject: async ({ dir, model }) => makeTestProject({ dir, allowAnywhere: true, model }),
    git: async (args, options) => git(args, options),
    events: async ({ project }) => listEvents(stateDir(nameOf(project)), { report: () => {} }),
    hasCommand: async (name) => !run(name, ['--version']).error,

    // The stand-in director's answer to each open card (approvals, confirms and the builds' decisions, except those of
    // the work in `skipWork`): the recommended option, chosen in the picker the front desk shows or typed as a reply.
    async answerCards({ events, session = 'desk', skipWork = [] }) {
      const pane = tmux.capture(session);
      // A card acted on is left alone for a while, then tried again if it is still open: a press can land before the
      // picker is ready.
      const now = Date.now();
      const recent = new Set([...acted].filter(([, at]) => now - at < RETRY_MS).map(([card]) => card));
      const actions = standInAnswers({ events, pane, done: recent, skipWork: new Set(skipWork) });
      for (const action of actions) {
        if (action.card) acted.set(action.card, now);
        if (action.keys) tmux.keys(session, ...action.keys);
        else tmux.type(session, action.type);
      }
      return actions.length;
    },

    async readNtfy({ topic }) {
      try {
        const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=all`);
        return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === 'message')
          .map((m) => ({ at: new Date(m.time * 1000).toISOString(), text: m.message }));
      } catch { return []; }
    },
    async readConfig({ dir }) {
      dirOf(dir);
      try { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'wheelhouse.json'), 'utf8')); } catch { return null; }
    },
    async readMain({ dir, file }) {
      run('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: dirOf(dir) });
      const got = run('git', ['show', `origin/main:${file}`], { cwd: dir });
      return got.status === 0 ? got.stdout : null;
    },
    // Row 30: the gate's own reading of P8's change, from its pull request's files and diff.
    readGate: async ({ change }) => readGateWith({ gh, change }),
    // { ok: true, amount } or { ok: false, why }: a read that failed is never taken for a bug still planted.
    async mainParseAmount({ dir: project }) {
      dirOf(project);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-main-'));
      try {
        const fetched = run('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: project });
        if (fetched.status !== 0) return { ok: false, why: `git fetch failed: ${String(fetched.stderr).trim()}` };
        const got = run('git', ['show', 'origin/main:src/lib/money.js'], { cwd: project });
        if (got.status !== 0) return { ok: false, why: 'src/lib/money.js is not on origin/main' };
        const file = path.join(dir, 'money.mjs');
        fs.writeFileSync(file, got.stdout);
        const value = (await import(pathToFileURL(file).href)).parseAmount('(40.00)');
        return typeof value === 'number' ? { ok: true, amount: value } : { ok: false, why: 'parseAmount did not return a number' };
      } catch (error) { return { ok: false, why: error.message }; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    },
    // The director's own words to the front desk; the front desk runs the matching command.
    async setDigest({ at }) {
      tmux.type('desk', `Send me the daily digest at ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} today.`);
      return { ok: true };
    },
    typedRepliesOn: async ({ project }) => typedRepliesOn(nameOf(project)),
    nextDecisionNumber: async ({ project }) => decisionNumber(nameOf(project)),
    installDeps: async ({ dir }) => installDependencies(dir),
    // Transcripts are under the trial's own Claude config folder when there is one (not ~/.claude); the engine's queue folder is
    // keyed by the project's name, the transcripts' working folders by the project's folder.
    findTranscripts: ({ project, dir }) => {
      nameOf(project);
      return findTranscripts({
        project: dirOf(dir),
        claudeHome: env.HAIKU_TRIAL_CONFIG_DIR || undefined,
        engineDir: fs.existsSync(queueFolderOf(project)) ? queueFolderOf(project) : engineDir(),
      });
    },
    readUsage,
    async cloneMain({ url, dir, branch }) {
      git(['clone', '--quiet', url, dir], { cwd: os.tmpdir() });
      if (branch) git(['checkout', '-b', branch], { cwd: dir });
      return dir;
    },
    async commitAndPush({ dir, branch, message }) {
      git(['add', '--all'], { cwd: dir });
      git([...IDENTITY, 'commit', '--quiet', '-m', message], { cwd: dir });
      git(['push', '-u', 'origin', branch], { cwd: dir });
    },
    applySpareBug,
    makeBrowse,

    // Option 2 of section 5.5: the app, and a Cloudflare quick tunnel to it, both left running until `restore`.
    async startTunnel({ dir }) {
      if (run('cloudflared', ['--version']).error) throw new Error('cloudflared is not installed, so the tunnel preview cannot start');
      if (!fs.existsSync(path.join(dirOf(dir), 'package.json'))) throw new Error(`the tunnel preview has no product to serve: ${dir} has no package.json yet`);
      // A start that fails is reported as the step's error; unheard, it would end the runner.
      const started = (child, what) => new Promise((resolve, reject) => {
        child.once('spawn', () => resolve(child));
        child.once('error', (error) => reject(new Error(`the tunnel preview's ${what} did not start: ${error.message}`)));
      });
      const app = await started(spawn('npm', ['start'], { cwd: dir, detached: true, stdio: 'ignore', env: { ...process.env, PORT: '4173', LEDGER_DB: ':memory:' } }), 'product');
      const tunnel = await started(spawn('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:4173'], { detached: true, stdio: 'ignore' }), 'tunnel');
      app.unref();
      tunnel.unref();
      return { productPid: app.pid, tunnelPid: tunnel.pid };
    },

    // `restore`: stops the trial's own helper, watchers and foremen, which live under the trial's Wheelhouse home (the caller
    // has set WHEELHOUSE_HOME to it). The helper is stopped only while it is still the process its record names.
    // While a feature session is still running, none of it is stopped (the session needs the helper to open its pull request
    // and the watcher to see it through) unless `force`; what is kept is said.
    async stopWheelhouse({ force = false, live = liveFeatureSessions } = {}) {
      const stopped = [];
      const running = force ? [] : live();
      if (running.length > 0) {
        const works = running.map((s) => s.work).join(', ');
        return { stopped, kept: [`helper, watchers and foremen: ${running.length} feature session${running.length === 1 ? ' is' : 's are'} still running (${works}); run restore again once they have finished, or restore --force to stop them now`] };
      }
      let names = [];
      try { names = fs.readdirSync(projectsDir()); } catch { /* no projects yet */ }
      for (const name of names.filter((n) => NAME_SHAPE.test(n))) {
        for (const [what, stop] of [['watcher', stopWatcher], ['foreman', stopForeman]]) {
          const got = await stop(name).catch(() => ({ stopped: false }));
          if (got.stopped === true) stopped.push(`${what} ${name}`);
        }
      }
      const record = readHelperRecord();
      if (record && record.pid !== process.pid) {
        const wanted = startOf(record.startTime);
        const now = wanted === null ? null : startOf(await processStartTime(record.pid));
        if (wanted !== null && now === wanted) {
          try { process.kill(record.pid, 'SIGTERM'); stopped.push(`helper pid ${record.pid}`); } catch { /* already gone */ }
        }
      }
      return { stopped, kept: [] };
    },
  };

  return {
    tmux, gh, host, faults,
    clock: { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    signals: { checkAll, gatherContext },
    score: { scoreAll },
    results: { runFolder, writeRaw, writeSummary },
    kill: (pid, signal) => process.kill(pid, signal),
    log: (line) => console.error(line),
    async ask(question) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try { return (await rl.question(`${question}\n> `)).trim(); } finally { rl.close(); }
    },
  };
}
