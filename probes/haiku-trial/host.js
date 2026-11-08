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
import { faults } from './faults.js';
import { checkAll, gatherContext } from './signals.js';
import { scoreAll } from './score/total.js';
import { runFolder, writeRaw, writeSummary } from './results.js';
import { stagePlugin } from './stage-plugin.js';
import { makeTestProject } from './seed.js';
import { applySpareBug } from './spare-bug.js';
import { makeBrowse } from './score/a11y.js';
import { findTranscripts } from './audit.js';
import { readUsage } from './usage.js';
import { listEvents } from '../../scripts/state/events.js';
import { stateDir, engineDir } from '../../scripts/lib/paths.js';
import { queueFolderOf } from '../../scripts/engine/queue-place.js';
import { typedRepliesOn } from '../../scripts/decisions/answer.js';
import { decisionNumber } from '../../scripts/decisions/pending.js';
import { installDependencies } from './score/run.js';
import { visibleFromChange } from '../../scripts/gate/visible.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IDENTITY = ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', '-c', 'commit.gpgsign=false'];
// The cards a stand-in director answers with a pick. Decisions, undo approvals and lifts are never in this list.
export const PICKED = ['approve-work', 'approval', 'confirm', 'ci-push', 'setup', 'confirm-all', 'baseline', 'trust'];

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

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options });
const text = (got) => String(got.stdout ?? '').trim();

export function buildRealIo(env = process.env) {
  let slug = '';
  const typed = new Set();
  const tmux = makeTmux();

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
    makeProject: async ({ dir }) => makeTestProject({ dir, allowAnywhere: true }),
    git: async (args, options) => git(args, options),
    events: async ({ project }) => listEvents(stateDir(project), { report: () => {} }),

    // A stand-in for the director's click on a plan, approval or confirm card: it types the card's first option.
    async answerCards({ events, session = 'desk' }) {
      const answered = new Set(events.filter((e) => e.kind === 'card-answer').map((e) => e.data?.card));
      let count = 0;
      for (const card of events.filter((e) => e.kind === 'card' && PICKED.includes(e.data?.kind))) {
        if (answered.has(card.id) || typed.has(card.id)) continue;
        const pick = card.data?.options?.[0]?.label;
        if (typeof pick !== 'string') continue;
        typed.add(card.id);
        tmux.type(session, pick);
        count += 1;
      }
      return count;
    },

    async readNtfy({ topic }) {
      try {
        const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=all`);
        return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === 'message')
          .map((m) => ({ at: new Date(m.time * 1000).toISOString(), text: m.message }));
      } catch { return []; }
    },
    async readConfig({ project }) {
      try { return JSON.parse(fs.readFileSync(path.join(project, '.claude', 'wheelhouse.json'), 'utf8')); } catch { return null; }
    },
    async readMain({ project, file }) {
      run('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: project });
      const got = run('git', ['show', `origin/main:${file}`], { cwd: project });
      return got.status === 0 ? got.stdout : null;
    },
    // Row 30: the gate's own reading of P8's change, from its pull request's files and diff.
    readGate: async ({ change }) => readGateWith({ gh, change }),
    // { ok: true, amount } or { ok: false, why }: a read that failed is never taken for a bug still planted.
    async mainParseAmount({ project }) {
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
    typedRepliesOn: async ({ project }) => typedRepliesOn(project),
    nextDecisionNumber: async ({ project }) => decisionNumber(project),
    installDeps: async ({ dir }) => installDependencies(dir),
    findTranscripts: ({ project }) => findTranscripts({ project, engineDir: fs.existsSync(queueFolderOf(project)) ? queueFolderOf(project) : engineDir() }),
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
    async startTunnel({ project }) {
      const app = spawn('npm', ['start'], { cwd: project, detached: true, stdio: 'ignore', env: { ...process.env, PORT: '4173', LEDGER_DB: ':memory:' } });
      const tunnel = spawn('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:4173'], { detached: true, stdio: 'ignore' });
      app.unref();
      tunnel.unref();
      return { productPid: app.pid, tunnelPid: tunnel.pid };
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
