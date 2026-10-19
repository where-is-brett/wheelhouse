// scripts/setup/health.js
// Step 10, the health check (design section 15, rulings R41 and R44): every safety check tried
// for real, then the board. It splits by who can see what.
//
// The helper's part is a long Go-ahead step (healthStep). Its apply, in its own process:
// - pushes a branch, HEALTH_BRANCH, holding one empty commit on the default branch's tip, with
//   the director's own sign-in, and opens a pull request from it through the adapter;
// - asks the merge gate (the helper's /merge, as the foreman would) to merge it with no approval,
//   which must be refused with the pull request left unmerged: any refusal counts (check 31);
// - runs the real stop guard (scripts/hooks/stop-guard.js) as a child, under a scratch Wheelhouse
//   home with STOP on and a scratch project registered there, expecting a Write refused with
//   STOP's own reason and a Read let through, so STOP is tried without the director;
// - checks the installed skills against Wheelhouse's manifest (checkInstalled, the lineage check)
//   and reads the host's protection back;
// - closes the pull request and deletes the branch, each a `host` change recorded before it is
//   made, as the push and the pull request were;
// - records every result in the journal, as step 10's `answer` change ({ health }), and fails the
//   step, naming them, when any check didn't pass, so a fresh card runs it again.
//
// The session's part. The sandbox's denials are seen only from inside it, so the setup session runs
// the trials in its own sandboxed Bash, `node "<root>/scripts/health/trials.js" --pr <n> --project
// <p>`, with the pull request and project `cli.js health` names, and hands the lines it printed to
// `cli.js health`, a reading form the stop guard lets through.
//
// healthCheck joins the two: each check passed or failed, a failed one said plainly with what to
// do, the session's marked "reported by the session" since the helper can't see them itself; then
// the board's health lines. It is green when every check of both parts passed and no health line
// is at the STOP level; a watch line is shown but doesn't hold it. The playbook shows the board.
//
// Once the board is green, and only then, finishSetup does the last thing setup does (ruling R44):
// it starts the foreman, by start.js's own start of the watcher, and gives the front desk's first
// briefing. It is the helper's /setup/health route that runs it, after the session's lines are in:
// the helper's apply finishes before the session's trials run, so it can't know the board is
// green, and the sandboxed session can't start a process in the Wheelhouse home. Never under STOP,
// and never before step 10, which waits for step 8 (Locked).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as realRun, withoutGitVars } from '../lib/run.js';
import { projectForFolder, readProject } from '../lib/projects.js';
import { SETUP_TITLES, SETUP_LABEL } from '../state/card-lines.js';
import { parseTrialLine } from '../lib/trial-lines.js';
import { makeAdapter } from '../host/adapter.js';
import { protectionStatus } from '../host/protection.js';
import { helperClient } from '../host/helper-client.js';
import { checkInstalled, readManifest, claudeHome } from '../lineage/manifest.js';
import { DENIED as STOP_DENIED } from '../hooks/stop-guard.js';
import { TRIAL_MARKER, UNREACHED } from '../health/trials.js';
import { loadBoardInputs } from '../board/inputs.js';
import { renderBoard } from '../board/render.js';
import { briefingIn, reviewOf } from '../hooks/board-context.js';
import { readSeen, markSeen } from '../briefing/seen.js';
import { CONTEXT_CHARS } from '../lib/core-numbers.js';
import { startWatcher } from '../foreman/start.js';
import { projectConfig } from '../watcher/main.js';
import { readJournal, newId } from './journal.js';
import { directorGitEnv, directorGitlabApi, STOPPED } from './host.js';
import { toolsStatus } from './tools.js';

export const HEALTH_STEP = 10;
// The trial's branch: one name, so a retry pushes over its own branch and never makes another.
export const HEALTH_BRANCH = 'wheelhouse/health-check';
export const HEALTH_TITLE = 'Wheelhouse health check (setup closes this)';
// The first merge request fills the helper's mirror of the project, so the helper's part waits
// longer than the session's trials do (MERGE_WAIT_MS in trials.js).
export const HEALTH_MERGE_WAIT_MS = 2 * 60 * 1000;
// How long the stop guard child may take for one answer.
const GUARD_WAIT_MS = 30 * 1000;
// How long the first briefing's reading waits for the helper's answers.
const BRIEFING_WAIT_MS = 1500;
const STOP_GUARD = fileURLToPath(new URL('../hooks/stop-guard.js', import.meta.url));
// The empty commit's author: the trial's own, not the director's, since it never lands.
const TRIAL_AUTHOR = ['-c', 'user.name=Wheelhouse setup', '-c', 'user.email=setup@wheelhouse.invalid'];
const TRIAL_MESSAGE = 'Wheelhouse health check: an empty commit, never merged';
const TRIAL_BODY = 'Setup\'s health check opened this pull request to try the merge gate, which must refuse it. Setup closes it and deletes its branch.';

// ---- What each check is called, expects, and says ----

// The helper's checks. `ok` gives the results that pass; `watch` marks one whose failure is shown
// but doesn't hold the board.
const RERUN = 'Run step 10 again';
export const HELPER_CHECKS = Object.freeze({
  'merge without approval': {
    expected: 'refused',
    passed: 'The merge gate refused to merge a pull request without your approval, and it stayed unmerged',
    failed: 'The merge gate did not refuse a pull request without your approval',
    todo: 'Type stop, so no agent works, and report it to Wheelhouse before going on: nothing may merge without the gate',
    what: 'the merge gate',
  },
  'write under stop': {
    expected: 'refused',
    passed: 'With STOP on, an agent\'s change was refused',
    failed: 'With STOP on, an agent\'s change was not refused',
    todo: 'Reload this project in Claude Desktop so Wheelhouse\'s checks run in it, then run step 10 again',
    what: 'STOP',
  },
  'read under stop': {
    expected: 'allowed',
    passed: 'With STOP on, an agent could still read and report',
    failed: 'With STOP on, an agent could not even read',
    todo: 'Reload this project in Claude Desktop, then run step 10 again',
    what: 'STOP',
  },
  'installed skills': {
    expected: 'match',
    passed: 'The installed skills match Wheelhouse\'s list',
    failed: 'The installed skills don\'t match Wheelhouse\'s list, so agents would be held',
    todo: 'Run step 7 again, which installs them, then step 10',
    what: 'the installed skills',
  },
  'host protection': {
    expected: 'on',
    ok: ['on', 'not offered'],
    passed: 'The host\'s protection of the main branch is on, or your plan doesn\'t offer it and the board says so',
    failed: 'The host\'s protection of the main branch is off',
    todo: 'Run step 7 again, which switches it on with your sign-in, then step 10',
    what: 'the host\'s protection',
  },
  'trial cleaned up': {
    expected: 'closed',
    watch: true,
    passed: 'The trial pull request was closed and its branch deleted',
    failed: 'The trial pull request, or its branch, was left on the host',
    todo: 'Close the pull request named Wheelhouse health check on the host, and delete its branch',
    what: 'closing the trial pull request',
  },
});

// The session's trials (scripts/health/trials.js), by the names it prints.
export const SESSION_CHECKS = Object.freeze({
  'read .env.local': {
    expected: 'refused',
    passed: 'An agent couldn\'t read a .env.local file',
    failed: 'An agent could read a .env.local file',
    todo: 'The sandbox isn\'t on in this session: reload this project in Claude Desktop, then run step 10 again',
    what: 'reading .env.local',
  },
  'read keys folder': {
    expected: 'refused',
    passed: 'An agent couldn\'t read Wheelhouse\'s keys',
    failed: 'An agent could read Wheelhouse\'s keys',
    todo: 'The sandbox isn\'t on in this session: reload this project in Claude Desktop, then run step 10 again',
    what: 'reading the keys folder',
  },
  'reach github.com': {
    expected: 'not reached',
    passed: 'An agent couldn\'t reach the host directly',
    failed: 'An agent could reach the host directly',
    todo: 'The sandbox\'s network limit isn\'t on in this session: reload this project in Claude Desktop, then run step 10 again',
    what: 'reaching the host',
  },
  'run gh': {
    expected: 'refused',
    // A computer with no gh has none for an agent to run.
    ok: ['refused', 'not installed'],
    passed: 'An agent couldn\'t use your GitHub sign-in',
    failed: 'An agent could use your GitHub sign-in',
    todo: 'The sandbox isn\'t on in this session: reload this project in Claude Desktop, then run step 10 again',
    what: 'running gh',
  },
  'helper health': {
    expected: 'reached',
    passed: 'An agent could reach Wheelhouse\'s host helper, as it must',
    failed: 'An agent couldn\'t reach Wheelhouse\'s host helper',
    todo: 'Quit and reopen Claude Desktop, which starts the helper, then run step 10 again',
    what: 'reaching the helper',
  },
  'forged approval recorded': {
    expected: 'refused',
    passed: 'A forged approval was refused',
    failed: 'A forged approval was recorded',
    todo: 'Type stop, so no agent works, and report it to Wheelhouse before going on',
    what: 'recording a forged approval',
  },
  'merge with forged approval': {
    expected: 'refused',
    passed: 'A merge resting on a forged approval was refused',
    failed: 'A merge resting on a forged approval was not refused',
    todo: 'Type stop, so no agent works, and report it to Wheelhouse before going on',
    what: 'merging with a forged approval',
  },
});

const passes = (check, result) => (check.ok ?? [check.expected]).includes(result);

// One check's line for the director: passed, or failed with what to do. A check that couldn't be
// tried says so, with what to do.
function checkLine(check, result, { session = false } = {}) {
  const by = session ? ' (reported by the session)' : '';
  if (passes(check, result)) return `Passed: ${check.passed}.${by}`;
  if (result === 'could not run') {
    return `Failed: setup couldn't try ${check.what}. ${session ? 'Run step 10\'s trials again in this session' : RERUN}; if it can't again, check this computer is online and Claude Desktop is open.${by}`;
  }
  return `${check.watch ? 'Watch' : 'Failed'}: ${check.failed} (${check.expected} was expected, ${result} came back). ${check.todo}.${by}`;
}

// ---- The helper's part ----

// The project the step works on: the folder's registered record.
function projectHere(folder) {
  const found = projectForFolder(folder);
  return found === null ? null : { project: found.project, record: found.record };
}

function card(repo) {
  return {
    kind: 'setup',
    level: 3,
    what: `Setup step ${HEALTH_STEP}, ${SETUP_TITLES[HEALTH_STEP]}: setup tries Wheelhouse's safety checks for real on ${repo}. `
      + `It pushes a branch, ${HEALTH_BRANCH}, holding one empty commit, opens a pull request from it, and asks the merge gate to merge it without your approval, which the gate must refuse. `
      + 'It checks STOP halts an agent, the installed skills and the host\'s protection, then closes the pull request and deletes the branch. '
      + 'The session then tries the sandbox\'s checks and shows the board.',
    why: 'A check never tried can\'t be trusted: these show the board is green for real.',
    options: [
      { label: SETUP_LABEL, says: 'Setup runs the checks, then shows the board, with what to do about any that didn\'t pass.' },
      { label: 'Not now', says: 'Setup waits at this step; nothing changes.' },
    ],
    recommend: SETUP_LABEL,
    because: 'it is the last step, and it takes about a minute',
    meanwhile: 'Setup waits at this step; nothing changes.',
  };
}

// Runs git for the trial branch with the director's own sign-in, in `dir`; its output, or a throw.
async function gitIn(run, { gitPath, env, dir }, args) {
  const got = await run(gitPath, args, { cwd: dir, env, baseEnv: withoutGitVars(), timeoutMs: 5 * 60 * 1000 });
  if (got.code !== 0) throw new Error(`git ${args.find((a) => !a.startsWith('-')) ?? ''} failed for the trial branch`);
  return got.stdout.trim();
}

// The merge gate asked to merge the trial pull request with no approval. Any refusal that leaves it
// unmerged counts (check 31): the gate refuses on whichever condition it finds first. The pull
// request is read back, so "unmerged" is the host's word, not the gate's.
export async function mergeTrial({ client, adapter, project, number }) {
  let answer;
  try {
    answer = await client.merge({ project, number, stop: false, bypass: false, approvalRequired: true });
  } catch {
    answer = null;
  }
  let state = 'unknown';
  try {
    state = (await adapter.prState(number))?.state ?? 'unknown';
  } catch { /* unknown */ }
  if (answer?.merged === true || state === 'merged') return 'MERGED (unexpected)';
  if (answer?.ok === true) return 'allowed';
  const said = [answer?.refused, ...(Array.isArray(answer?.reasons) ? answer.reasons : [])].filter((x) => typeof x === 'string').join(' ').toLowerCase();
  if (answer?.ok === false && !UNREACHED.test(said) && state === 'open') return 'refused';
  return 'could not run';
}

// The stop guard's answer to one tool call: 'refused' when it denies with STOP's own reason,
// 'allowed' when it lets the call through, otherwise 'could not run' (a guard that couldn't run
// denies with its own reason, which is no proof STOP holds).
function guardAnswer(got) {
  if (got?.code !== 0) return 'could not run';
  const out = String(got.stdout ?? '').trim();
  if (out === '') return 'allowed';
  try {
    const said = JSON.parse(out)?.hookSpecificOutput;
    if (said?.permissionDecision === 'deny' && said.permissionDecisionReason === STOP_DENIED) return 'refused';
  } catch { /* not an answer */ }
  return 'could not run';
}

// STOP tried with the real stop guard, as a child, under a scratch Wheelhouse home holding STOP and
// a scratch project, so nothing of the director's is touched: a Write must be refused with STOP's
// reason and a Read let through. { write, read }.
export async function stopTrial({ script = STOP_GUARD, run = realRun, nodePath = process.execPath, now = () => new Date() } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-stop-trial-'));
  try {
    const home = path.join(base, 'home');
    const folder = path.join(base, 'project');
    fs.mkdirSync(folder, { recursive: true });
    const real = fs.realpathSync.native(folder);
    const record = {
      folder: real, remoteUrl: 'https://github.com/wheelhouse-trial/stop.git', host: 'github', repo: 'wheelhouse-trial/stop', connection: { mode: 'quick' },
    };
    fs.mkdirSync(path.join(home, 'projects', 'wheelhouse-trial__stop'), { recursive: true });
    fs.writeFileSync(path.join(home, 'projects', 'wheelhouse-trial__stop', 'project.json'), `${JSON.stringify(record)}\n`);
    fs.writeFileSync(path.join(home, 'STOP'), `${JSON.stringify({ by: 'helper', at: now().toISOString() })}\n`);
    fs.writeFileSync(path.join(real, 'README.md'), 'The stop trial.\n');
    const ask = (tool, input) => run(nodePath, [script], {
      cwd: real,
      env: { WHEELHOUSE_HOME: home },
      input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'health-trial', cwd: real, permission_mode: 'default', tool_name: tool, tool_input: input }),
      timeoutMs: GUARD_WAIT_MS,
    }).catch(() => null);
    const write = guardAnswer(await ask('Write', { file_path: path.join(real, 'trial.txt'), content: 'trial\n' }));
    const read = guardAnswer(await ask('Read', { file_path: path.join(real, 'README.md') }));
    return { write, read };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// The installed skills against Wheelhouse's manifest, for the project's folder: 'match' or 'differ'.
function checkPinsNow({ folder }) {
  return checkInstalled({ manifest: readManifest(), projectDir: folder, claudeHome: claudeHome() }).ok ? 'match' : 'differ';
}

// The host's protection, read back with the director's own sign-in: 'on', 'off', or 'not offered'
// on a plan without it.
async function readProtectionNow({ host, repo, run }) {
  const api = host === 'gitlab' ? await directorGitlabApi({ run }) : undefined;
  const read = await protectionStatus({ host, repo, run, api, env: {} });
  if (read.on === true) return 'on';
  return read.available === false ? 'not offered' : 'off';
}

const isDone = (run, n) => typeof run?.steps?.[n]?.doneAt === 'string';

// Step 10. `run` runs git and the host's tools; `adapterFor({ host, repo })` the adapter, with the
// director's own sign-in; `client` the helper's client the merge is asked through; `findGit` the
// git step 2 found; `gitEnvFor({ host, gitPath, platform })` git's environment; `trySTOP`,
// `checkPins({ folder })` and `readProtection({ host, repo })` the other checks. All for tests.
export function healthStep({
  run = realRun,
  adapterFor = ({ host, repo }) => makeAdapter({ host, repo, run, env: {} }),
  client,
  findGit = async ({ platform }) => (await toolsStatus({ platform, run, tools: ['git'] })).git,
  gitEnvFor = directorGitEnv,
  trySTOP = () => stopTrial({ run }),
  checkPins = checkPinsNow,
  readProtection = ({ host, repo }) => readProtectionNow({ host, repo, run }),
} = {}) {
  return {
    n: HEALTH_STEP,
    title: SETUP_TITLES[HEALTH_STEP],
    long: true,
    // The project's files, pins and protection, Locked and the phone first: the checks try them.
    after: [7, 8, 9],
    async plan(ctx) {
      const found = projectHere(ctx.folder);
      if (found === null) return { wait: 30 * 1000, why: `step 3 (${SETUP_TITLES[3]}) has not registered the project yet; the health check comes once it has` };
      const { project, record } = found;
      const changes = [{
        kind: 'host', what: 'health-check', target: `${record.repo}: branch ${HEALTH_BRANCH} and a pull request from it, closed again`,
        project, host: record.host, repo: record.repo, branch: HEALTH_BRANCH,
      }];
      return { changes, card: card(record.repo), director: 'One click, then read the board' };
    },
    async apply(ctx, changes) {
      const platform = ctx.platform ?? process.platform;
      const listed = changes.find((c) => c.what === 'health-check');
      if (!listed) throw new Error('Step 10\'s list names no health check');
      const found = projectHere(ctx.folder);
      if (found === null || found.project !== listed.project) throw new Error('The project step 10\'s card named is not this folder\'s any more');
      const { project, record } = found;
      const halt = () => {
        if (ctx.stopped?.() === true) throw new Error(STOPPED);
      };
      halt();
      const adapter = adapterFor({ host: record.host, repo: record.repo });
      const asker = client ?? helperClient({ timeout: HEALTH_MERGE_WAIT_MS });
      const checks = [];
      const add = (name, result) => checks.push({ name, expected: HELPER_CHECKS[name].expected, result, ok: passes(HELPER_CHECKS[name], result) });
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-health-'));
      let pushed = null;
      let number = null;
      let failure = null;
      let git = null;
      try {
        const located = await findGit({ platform });
        if (!located?.ok || typeof located.path !== 'string') throw new Error('git is not on this computer; step 2 installs it');
        git = { gitPath: located.path, env: gitEnvFor({ host: record.host, gitPath: located.path, platform }), dir: scratch };
        // The empty commit, on the default branch's tip, made in a scratch repository: never in
        // the director's own folder.
        const base = await adapter.defaultBranch();
        await gitIn(run, git, ['init', '-q', '--bare', '.']);
        await gitIn(run, git, ['fetch', '-q', '--depth=1', record.remoteUrl, `refs/heads/${base}`]);
        const parent = await gitIn(run, git, ['rev-parse', 'FETCH_HEAD']);
        const tree = await gitIn(run, git, ['rev-parse', 'FETCH_HEAD^{tree}']);
        const sha = await gitIn(run, git, [...TRIAL_AUTHOR, 'commit-tree', '--no-gpg-sign', tree, '-p', parent, '-m', TRIAL_MESSAGE]);
        halt();
        ctx.record({ id: newId('chg'), kind: 'host', target: `${record.repo} branch ${HEALTH_BRANCH}`, before: null, after: { branch: HEALTH_BRANCH, sha }, project });
        await gitIn(run, git, ['push', '-q', '--force', record.remoteUrl, `${sha}:refs/heads/${HEALTH_BRANCH}`]);
        pushed = sha;
        ({ number } = await adapter.openPr({ head: HEALTH_BRANCH, base, title: HEALTH_TITLE, body: TRIAL_BODY }));
        ctx.record({ id: newId('chg'), kind: 'host', target: `${record.repo} pull request ${number}`, before: null, after: { number, state: 'open', branch: HEALTH_BRANCH }, project });
        halt();
        add('merge without approval', await mergeTrial({ client: asker, adapter, project, number }));
        halt();
        let stop = { write: 'could not run', read: 'could not run' };
        try {
          stop = await trySTOP();
        } catch { /* could not run */ }
        add('write under stop', stop.write);
        add('read under stop', stop.read);
        let pins = 'could not run';
        try {
          pins = await checkPins({ folder: record.folder });
        } catch { /* could not run */ }
        add('installed skills', pins);
        let protection = 'could not run';
        try {
          protection = await readProtection({ host: record.host, repo: record.repo });
        } catch { /* could not run */ }
        add('host protection', protection);
      } catch (error) {
        failure = error;
      } finally {
        // The trial pull request closed and its branch deleted, each recorded first, whatever
        // happened before.
        let clean = true;
        if (number !== null) {
          ctx.record({ id: newId('chg'), kind: 'host', target: `${record.repo} pull request ${number}`, before: { state: 'open' }, after: { state: 'closed' }, project });
          try {
            await adapter.closePr(number);
          } catch {
            clean = false;
          }
        }
        if (pushed !== null) {
          ctx.record({ id: newId('chg'), kind: 'host', target: `${record.repo} branch ${HEALTH_BRANCH}`, before: { branch: HEALTH_BRANCH, sha: pushed }, after: null, project });
          try {
            await gitIn(run, git, ['push', '-q', record.remoteUrl, `:refs/heads/${HEALTH_BRANCH}`]);
          } catch {
            clean = false;
          }
        }
        if (number !== null || pushed !== null) add('trial cleaned up', clean ? 'closed' : 'left open');
        ctx.record({
          id: newId('chg'), kind: 'answer', target: `step ${HEALTH_STEP}`, before: null, after: { health: { project, pr: number, branch: HEALTH_BRANCH, checks } }, project,
        });
        fs.rmSync(scratch, { recursive: true, force: true });
      }
      if (failure !== null) throw failure;
      const failed = checks.filter((c) => !c.ok && !HELPER_CHECKS[c.name].watch);
      if (failed.length > 0) throw new Error(`these checks didn't pass: ${failed.map((c) => c.name).join(', ')}; the board says what to do`);
      return [];
    },
  };
}

// ---- Joining the two parts ----

// The latest record of step 10's checks in a run: { project, pr, branch, checks }, or null.
export function helperRecord(run) {
  const found = (Array.isArray(run?.changes) ? run.changes : [])
    .filter((c) => c?.step === HEALTH_STEP && c.kind === 'answer' && c.after?.health && Array.isArray(c.after.health.checks)).at(-1);
  return found ? found.after.health : null;
}

// The latest run in this folder, by its real path, or null.
function runIn(folder) {
  return readJournal().runs.filter((r) => r?.folder === folder).at(-1) ?? null;
}

// healthCheck({ folder, reported }) -> { green, lines, board, trials, project }: step 10's checks in
// the helper, the session's trial lines (`reported`, as trials.js printed them), and the board's
// health lines, each said plainly, a failed one with what to do. `trials` names the pull request and
// project the session's trials take, or is null before step 10 has opened one. `run` (the folder's
// run), `load` (loadBoardInputs), `client` (the helper's, for the board) and `now` are for the
// engine and tests.
export async function healthCheck({ folder, reported = [], run, load = loadBoardInputs, client, now = () => new Date() } = {}) {
  const here = run ?? runIn(folder);
  const lines = [];
  let green = true;
  const entry = here?.steps?.[HEALTH_STEP] ?? {};
  const record = helperRecord(here);
  if (!isDone(here, HEALTH_STEP)) {
    green = false;
    lines.push(entry.failed
      ? `Failed: step 10 did not finish: ${entry.failed}. ${RERUN} once each line below is seen to.`
      : 'Not yet: step 10\'s checks haven\'t run. They run once its card is clicked.');
  }
  // The helper's checks: each as recorded, and any not tried named.
  const tried = new Map((record?.checks ?? []).map((c) => [c.name, c.result]));
  for (const [name, check] of Object.entries(HELPER_CHECKS)) {
    if (!tried.has(name)) {
      if (check.watch) continue;
      if (record !== null) {
        green = false;
        lines.push(`Failed: setup couldn't try ${check.what} before step 10 stopped. ${RERUN}.`);
      }
      continue;
    }
    const result = tried.get(name);
    if (!passes(check, result) && !check.watch) green = false;
    lines.push(checkLine(check, result));
  }
  // The session's trials, by name: the last line given for each, and any missing named.
  const given = new Map();
  let unreadable = 0;
  for (const line of Array.isArray(reported) ? reported : []) {
    const parsed = parseTrialLine(line);
    if (parsed && Object.hasOwn(SESSION_CHECKS, parsed.name)) given.set(parsed.name, parsed.result);
    else unreadable += 1;
  }
  for (const [name, check] of Object.entries(SESSION_CHECKS)) {
    if (!given.has(name)) {
      green = false;
      lines.push(`Not reported by the session: ${check.what}. Run step 10's trials in this session and hand in every line.`);
      continue;
    }
    const result = given.get(name);
    if (!passes(check, result)) green = false;
    lines.push(checkLine(check, result, { session: true }));
  }
  if (unreadable > 0) lines.push(`Left out: ${unreadable} ${unreadable === 1 ? 'line' : 'lines'} the session handed in that ${unreadable === 1 ? 'isn\'t a trial\'s' : 'aren\'t trials\''}.`);
  // The board's health lines, and the board itself.
  const found = projectForFolder(folder);
  const inputs = found === null ? { none: 'This folder isn\'t a registered project yet' } : await load({ cwd: found.record.folder, now, client });
  const health = Array.isArray(inputs?.model?.director?.health) ? inputs.model.director.health : null;
  if (health === null) {
    green = false;
    lines.push(`Failed: the board couldn't be read: ${inputs?.none ?? 'its health lines are missing'}. ${RERUN}.`);
  } else {
    for (const line of health) {
      if (line?.level === 'stop') green = false;
      lines.push(`Board: ${line.text}`);
    }
  }
  const board = inputs?.model ? renderBoard(inputs.model) : null;
  const trials = Number.isInteger(record?.pr) ? { pr: record.pr, project: record.project } : null;
  return { green, lines, board, trials, project: found?.project ?? null };
}

// Removes a .env.local the session's trial left in the folder, only when it holds exactly the
// trial's marker, so the director's own is never touched. Whether one was removed.
export function removeTrialLeftover(folder) {
  const file = path.join(folder, '.env.local');
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size !== Buffer.byteLength(TRIAL_MARKER)) return false;
    if (fs.readFileSync(file, 'utf8') !== TRIAL_MARKER) return false;
    fs.rmSync(file);
    return true;
  } catch {
    return false;
  }
}

// The last thing setup does, once the board is green and shown (ruling R44): the foreman started,
// as start.js starts it, and the front desk's first briefing. { started, briefing }: `started` a
// line saying how the foreman stands; `briefing` the briefing's text, or null when it couldn't be
// put together (the front desk gives one at the next visit). `start(project)` and `brief(project)`
// are for tests.
export async function finishSetup({
  project, client = helperClient({ timeout: BRIEFING_WAIT_MS * 2 }), now = () => new Date(), spawn, load = loadBoardInputs,
  start, brief,
} = {}) {
  let started;
  try {
    started = start ? await start(project) : await startForeman(project, { client, spawn });
  } catch {
    started = 'The foreman couldn\'t be started now; the next session start in this project starts it.';
  }
  let briefing = null;
  try {
    briefing = brief ? await brief(project) : await firstBriefing(project, { client, now, load });
  } catch { /* the front desk briefs at the next visit */ }
  return { started, briefing };
}

// start.js's own start for Shape 1, the watcher (startWatcher), which wakes a foreman when there is
// work. Shape 2's foreman is a session in a terminal, which the helper can't open: the line says so.
async function startForeman(project, { client, spawn }) {
  const read = await projectConfig(project, client);
  if (read.config === null) return `The foreman couldn't be started now (${read.why}); the next session start in this project starts it.`;
  if (read.config.watcherShape === 2) return `This project's foreman runs in a terminal of its own: start it there with start.js ${project}.`;
  const { started } = startWatcher(project, spawn ? { spawn } : {});
  return started ? 'The foreman\'s watcher is started: it wakes a foreman when there is work.' : 'The foreman\'s watcher is running: it wakes a foreman when there is work.';
}

// The front desk's first briefing, as the board-context hook gives one, and kept as given so the
// hook doesn't give the same one again at once.
async function firstBriefing(project, { client, now, load }) {
  const at = now();
  const folder = readProject(project)?.folder;
  if (typeof folder !== 'string') return null;
  const inputs = await load({ cwd: folder, now: () => at, client, waitMs: BRIEFING_WAIT_MS });
  if (!inputs?.model) return null;
  const seen = readSeen(project, { now: at });
  const { model, usage, sources, settings } = inputs;
  const given = briefingIn({
    project, model, usage, sources, settings, since: seen.briefedAt, weeklySince: seen.weeklyAt, review: reviewOf(project, settings, at), at, room: CONTEXT_CHARS,
  });
  markSeen(project, { briefedAt: at, ...(given.weeklyShown ? { weeklyAt: at } : {}) });
  return given.text;
}
