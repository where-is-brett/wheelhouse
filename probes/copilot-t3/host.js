// probes/copilot-t3/host.js
// The real host of trial stage T3: what touches the world. A throwaway project kept on this computer (local hosting, so no
// GitHub or GitLab), a scratch Wheelhouse home, Copilot's own feature session from the adapter's calls (no model ever passed:
// the plan is `auto-only`), and the helper's local merge. Nothing here runs until `runner.js run`, which spends requests.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sessionsPart } from '../../adapters/copilot/sessions.js';
import { accountOf, monthState, readAccount, readLedger, recordAccount } from '../../scripts/agents/copilot/usage.js';
import { usageDir, projectSlug, stateDir } from '../../scripts/lib/paths.js';
import { enrol, makeSigningKey, readEnrolled } from '../../scripts/state/signing.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { makeHome, projectFolder } from '../../scripts/host/local/home.js';
import { localChanges } from '../../scripts/host/local/changes.js';
import { makeLocalAdapter } from '../../scripts/host/local/adapter.js';
import { startRun } from './session.js';

export const PROJECT_FILES = Object.freeze({
  'README.md': '# Greeter\n\nSays hello. A throwaway project for Wheelhouse trial stage T3.\n',
  'package.json': `${JSON.stringify({ name: 'greeter', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  'src/greeting.js': 'export const greet = (name) => `Hi ${name}`;\n',
});

const GIT_IDENTITY = ['-c', 'user.name=Wheelhouse trial', '-c', 'user.email=trial@wheelhouse.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
const git = (cwd, ...args) => execFileSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The first prompt of the build session: the order's goal, in the words the waker's first prompt uses for a quick piece.
export const buildPrompt = (order) => `${order.goal} This is a quick-lane change: build it, run the tests with \`npm test\`, and commit it on the current branch.`;

export function realHost({ label, ghAccount = readGhAccount, plan = 'auto-only', sessions = sessionsPart({ ready: true, plan }), env = process.env } = {}) {
  // The month's real ledger is read before WHEELHOUSE_HOME is pointed at the trial's own folder.
  const realUsage = usageDir();
  const trial = {};

  const worktreeOf = (work) => path.join(trial.folder, '.claude', 'worktrees', work);
  const call = async (kind, { work, sessionId }) => {
    const config = {};
    const base = { project: trial.project, work, config, plan, env: trialEnv(), worktree: worktreeOf(work), level: 'ask', grants: [], prompt: buildPrompt(trial.order) };
    await sessions.prepare({ project: trial.project, target: `feature-${work}` });
    return kind === 'start' ? sessions.featureStartCall({ ...base, sessionId }) : sessions.featureResumeCall({ ...base, sessionId });
  };
  const trialEnv = () => ({ ...env, WHEELHOUSE_HOME: trial.home });

  // What a later step needs of the stage: where the project and its home are, and the Wheelhouse home the process works in.
  const place = (folder) => {
    trial.home = path.join(folder, 'wheelhouse-home');
    trial.folder = path.join(folder, 'project');
    fs.mkdirSync(trial.home, { recursive: true });
    process.env.WHEELHOUSE_HOME = trial.home;
  };

  return {
    // A resumed attempt that does not run `stage` again: the places come back from the run folder, and nothing is made.
    async attach({ folder, project, order }) {
      if (!fs.existsSync(path.join(folder, 'project', '.git'))) throw new Error('The run folder holds no project to carry on with');
      place(folder);
      trial.project = project;
      trial.order = order;
    },

    async stage({ folder }) {
      place(folder);
      fs.mkdirSync(trial.folder, { recursive: true });
      if (!fs.existsSync(path.join(trial.folder, '.git'))) {
        git(trial.folder, 'init', '--quiet', '-b', 'main');
        for (const [rel, text] of Object.entries(PROJECT_FILES)) {
          fs.mkdirSync(path.dirname(path.join(trial.folder, rel)), { recursive: true });
          fs.writeFileSync(path.join(trial.folder, rel), text);
        }
        fs.writeFileSync(path.join(trial.folder, '.gitignore'), '.claude/worktrees/\nnode_modules/\n');
        git(trial.folder, 'add', '--all');
        git(trial.folder, 'commit', '--quiet', '-m', 'The project so far');
      }
      trial.project = projectSlug('local', `copilot-t3-${label}`);
      writeProject(trial.project, { folder: fs.realpathSync(trial.folder), remoteUrl: null, host: 'local', repo: `local/${trial.project}`, connection: { host: 'local', mode: 'local' } });
      // The trial's own home holds its own signing key, so the records the local merge writes are signed and never the director's.
      if (readEnrolled().length === 0) enrol({ ...makeSigningKey(), enrolledAt: new Date().toISOString() });
      await makeHome({ project: trial.project, folder: trial.folder, branch: 'main' });
      return { project: trial.project };
    },

    // The month's use: the account's own figure when `gh` can read it (it costs no request), else the ledger's count.
    async monthUsed() {
      const now = new Date();
      let account = readAccount({ dir: realUsage });
      let read = false;
      try {
        const fresh = accountOf(await ghAccount(), now);
        // The reading is kept in the trial's own home: the real home is only read.
        if (fresh !== null) { if (trial.home === undefined) throw new Error('no trial home'); recordAccount(fresh, { dir: usageDir() }); account = fresh; read = true; }
      } catch { /* the ledger's count stands */ }
      const lines = readLedger({ dir: realUsage });
      // Neither GitHub's figure, an earlier reading nor a single ledger line: the month is unreadable, not empty.
      if (!read && account === null && lines.length === 0) return null;
      return monthState({ lines, account, now }).used;
    },

    async order(order) {
      trial.order = order;
      const wt = worktreeOf(order.work);
      fs.mkdirSync(path.dirname(wt), { recursive: true });
      if (!fs.existsSync(wt)) git(trial.folder, 'worktree', 'add', '-q', '-b', `feature/${order.work}`, wt, 'main');
    },

    start: async ({ work, sessionId }) => startRun(await call('start', { work, sessionId }), { cwd: worktreeOf(work) }),
    resume: async ({ work, sessionId }) => startRun(await call('resume', { work, sessionId }), { cwd: worktreeOf(work) }),

    // The change is opened from the feature branch's head and merged by the local adapter, as the helper's gate would.
    async merge({ work }) {
      const wt = worktreeOf(work);
      if (git(wt, 'status', '--porcelain') !== '') {
        git(wt, 'add', '--all');
        git(wt, 'commit', '--quiet', '-m', `Quick change: ${work}`);
      }
      const head = git(wt, 'rev-parse', 'HEAD');
      if (head === git(trial.folder, 'rev-parse', 'main')) return { merged: false, reason: 'The session left no commit' };
      // The home takes the branch by its path, as a push to it does.
      git(trial.folder, 'push', '--quiet', path.join(stateDir(trial.project), '..', 'home.git'), `feature/${work}:feature/${work}`);
      const changes = localChanges({ project: trial.project });
      const change = await changes.openChange({ branch: `feature/${work}`, base: 'main', title: trial.order.goal.slice(0, 80), head });
      const got = await makeLocalAdapter({ project: trial.project, folder: trial.folder }).merge({ number: change.n, sha: head });
      return got.merged ? { merged: true, commit: got.commit } : { merged: false, reason: got.reason };
    },
  };
}

function readGhAccount() {
  return JSON.parse(execFileSync('gh', ['api', '/copilot_internal/user'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
}
