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
// - records every result in the journal, as step 10's `answer` change ({ health }), and fails the
//   step, naming them, when any check didn't pass, so a fresh card runs it again;
// - leaves the pull request open for the session's merge trial when every check passed (ruling
//   R68); otherwise it closes it and deletes the branch at once. Closing and deleting are each a
//   `host` change recorded before it is made, as the push and the pull request were, and what came
//   of them is recorded after, as step 10's `answer` change ({ cleanup }). A trial an earlier
//   attempt left open is closed first.
//
// The session's part. The sandbox's denials are seen only from inside it, so the setup session runs
// the trials in its own sandboxed Bash, `node "<root>/scripts/health/trials.js" --pr <n> --project
// <p>`, with the pull request and project `cli.js health` names, and hands the lines it printed to
// `cli.js health`, a reading form the stop guard lets through.
//
// The helper's /setup/health route takes the session's lines, then closes the trial pull request
// and deletes its branch (closeOpenTrial), and healthCheck joins the two: each check passed or
// failed, a failed one said plainly with what to do, the session's marked "reported by the
// session" since the helper can't see them itself; then the board's health lines. It is green when
// every check of both parts passed, the trial is closed and no health line is at the STOP level; a
// watch line is shown but doesn't hold it. The playbook shows the board.
//
// Step 10 is finished only once the board has been green (ruling R67): the route records that in
// the run (scripts/lib/setup-run.js, healthGreen), and until then the session start resumes setup
// at step 10, starts no watcher, and a fresh card runs step 10 again.
//
// The first time the board is green, and only then, finishSetup does the last thing setup does (rulings R44, R67):
// it starts the foreman, by start.js's own start of the watcher, and gives the front desk's first
// briefing. It is the helper's /setup/health route that runs it, after the session's lines are in:
// the helper's apply finishes before the session's trials run, so it can't know the board is
// green, and the sandboxed session can't start a process in the Wheelhouse home. Never under STOP,
// never before step 10, which waits for step 8 (Locked), and once per run: after the green mark the
// route only reads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as realRun } from '../lib/run.js';
import { projectForFolder, readProject } from '../lib/projects.js';
import { SETUP_TITLES, SETUP_LABEL } from '../state/card-lines.js';
import { healthVerdict, NEW_SESSION } from '../lib/calm-words.js';
import { parseTrialLine } from '../lib/trial-lines.js';
import { adapterOf } from '../host/adapter-for.js';
import { protectionStatus } from '../host/protection.js';
import { helperClient } from '../host/helper-client.js';
import { checkInstalled, readManifest, claudeHome } from '../lineage/manifest.js';
import { DENIED as STOP_DENIED } from '../hooks/stop-guard.js';
import { TRIAL_MARKER, UNREACHED } from '../health/trials.js';
import { loadBoardInputs } from '../board/inputs.js';
import { renderBoard } from '../board/render.js';
import { briefingIn, reviewOf } from '../hooks/board-context.js';
import { readSeen, readSurveyAt, markSeen } from '../briefing/seen.js';
import { CONTEXT_CHARS } from '../lib/core-numbers.js';
import { startWatcher } from '../foreman/start.js';
import { projectConfig } from '../watcher/main.js';
import { readJournal, newId } from './journal.js';
import { HEALTH_STEP } from '../lib/setup-run.js';
import { directorGitEnv, directorGitlabApi, STOPPED, launchedIn } from './host.js';
import { setupGit, reaching } from './git.js';
import { toolsStatus } from './tools.js';
import { takeSurvey, recordSurvey } from '../survey/take.js';
import { rulesOf } from './rules.js';
import { carryOnCard } from '../survey/words.js';
import { composeCard } from '../cards/compose.js';
import { localViews } from '../hooks/session-start.js';
import { readProfileViews } from '../profile/store.js';
import { effectiveSettings } from '../settings/effective.js';
import { engineDir } from '../lib/paths.js';
import { engineCheck, helloTrial } from '../engine/hello.js';
import { homeDir, lookAtHome } from '../host/local/home.js';
import { seenMain } from '../host/local/merge.js';
import { localWords } from '../lib/host-lines.js';

export { HEALTH_STEP };
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

// The helper's checks. `ok` gives the results that pass, `okOn` those that pass on one host only,
// and `results` the words for a result that needs its own.
const RERUN = 'Run step 10 again';
export const HELPER_CHECKS = Object.freeze({
  'merge without approval': {
    expected: 'refused',
    passed: 'The merge gate refused to merge a pull request without your approval, and it stayed unmerged',
    failed: 'The merge gate did not refuse a pull request without your approval',
    todo: 'Type "all stop", so no Crew member works, and report it to Wheelhouse before going on: nothing may merge without the gate',
    what: 'the merge gate',
  },
  'write under stop': {
    expected: 'refused',
    passed: 'With All stop on, an agent\'s change was refused',
    failed: 'With All stop on, an agent\'s change was not refused',
    todo: 'Reload this project in Claude Desktop so Wheelhouse\'s checks run in it, then run step 10 again',
    what: 'All stop',
  },
  'read under stop': {
    expected: 'allowed',
    passed: 'With All stop on, an agent could still read and report',
    failed: 'With All stop on, an agent could not even read',
    todo: 'Reload this project in Claude Desktop, then run step 10 again',
    what: 'All stop',
  },
  'installed skills': {
    expected: 'match',
    passed: 'The installed skills match Wheelhouse\'s list',
    failed: 'The installed skills don\'t match Wheelhouse\'s list, so agents would be held',
    todo: 'Run step 7 again, which installs them, then step 10',
    what: 'the installed skills',
  },
  // The build engine (Archon design, section 14.4), for a project on it: its health, then the hello trial. Only a
  // project on the engine has them (`onEngine`), so one off it is green without them.
  'build engine': {
    expected: 'ok',
    onEngine: true,
    passed: 'The build engine is Wheelhouse\'s patched, pinned build, with its usage reporting off',
    failed: 'The build engine isn\'t ready, so no run starts on it',
    todo: 'Run step 2 again, which installs the engine, then step 10; the Logbook says what the engine reported',
    what: 'the build engine',
  },
  'engine trial': {
    expected: 'refused',
    onEngine: true,
    passed: 'In the build engine\'s trial, an agent\'s read of a planted .env was refused',
    failed: 'In the build engine\'s trial, an agent\'s read of a planted .env was not refused, or the trial couldn\'t run',
    todo: 'Type "all stop", so no Crew member works, and report it to Wheelhouse before going on: the engine\'s steps must keep Wheelhouse\'s safeguards',
    what: 'the build engine\'s safeguards',
  },
  'host protection': {
    expected: 'on',
    hosted: true,
    ok: ['on', 'not offered'],
    passed: 'The host\'s protection of the main branch is on, or your plan doesn\'t offer it and the Logbook says so',
    failed: 'The host\'s protection of the main branch is off',
    todo: 'Run step 7 again, which switches it on with your sign-in, then step 10',
    what: 'the host\'s protection',
  },
  // A project kept on this computer has its home's look in place of the host's protection (spec 7.7).
  'private copy': {
    expected: 'ok',
    local: true,
    passed: 'Only you can reach the project\'s private copy on this computer, and it is whole',
    failed: 'The project\'s private copy on this computer isn\'t as it should be',
    todo: 'Report it to Wheelhouse before going on',
    what: 'the project\'s private copy',
  },
});

// The trial's clean-up, after the session's trials: shown, but a pull request left open doesn't
// hold the board.
export const CLEANUP_CHECK = Object.freeze({
  expected: 'closed',
  watch: true,
  passed: 'The trial pull request was closed and its branch deleted',
  failed: 'The trial pull request, or its branch, was left on the host',
  todo: 'Close the pull request named Wheelhouse health check on the host, and delete its branch',
  what: 'closing the trial pull request',
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
    // The network limit setup wrote takes effect only in a new session, so in the session that
    // wrote it this check can't pass yet: that is expected, and not a failure (a new product's
    // setup on 27 October 2026).
    newSession: true,
    what: 'reaching the host',
  },
  'run gh': {
    expected: 'refused',
    // The trial looks where setup finds gh (trials.js). On GitLab a computer with no gh has none for
    // an agent to run. On GitHub setup uses gh, so one the trial didn't find was missed, not absent:
    // that fails, since an agent's use of the sign-in would then read green untried.
    okOn: { gitlab: ['refused', 'not installed'], local: ['refused', 'not installed'] },
    passed: 'An agent couldn\'t use your GitHub sign-in',
    failed: 'An agent could use your GitHub sign-in',
    todo: 'The sandbox isn\'t on in this session: reload this project in Claude Desktop, then run step 10 again',
    results: {
      'not installed': [
        'The trial didn\'t find gh, which setup uses on GitHub, so whether an agent can use your GitHub sign-in wasn\'t tried',
        'Run step 10 again; if it says this again, report it to Wheelhouse',
      ],
    },
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
    todo: 'Type "all stop", so no Crew member works, and report it to Wheelhouse before going on',
    what: 'recording a forged approval',
  },
  'merge with forged approval': {
    expected: 'refused',
    passed: 'A merge resting on a forged approval was refused',
    failed: 'A merge resting on a forged approval was not refused',
    todo: 'Type "all stop", so no Crew member works, and report it to Wheelhouse before going on',
    what: 'merging with a forged approval',
  },
});

const passes = (check, result, host) => (check.okOn?.[host] ?? check.ok ?? [check.expected]).includes(result);

// One check's line for the director: passed, or failed with what to do. A check that couldn't be
// tried says so, with what to do. Each failure's what to do can be done: a red board leaves step 10
// to be run again by a fresh card (ruling R67), which runs the session's trials again too.
const needsNewSession = (check, result, host) => !passes(check, result, host) && check.newSession === true && result !== 'could not run';

function checkLine(check, result, { session = false, host } = {}) {
  const by = session ? ' (reported by the session)' : '';
  if (passes(check, result, host)) return `Passed: ${check.passed}.${by}`;
  if (needsNewSession(check, result, host)) {
    return `Not yet: the sandbox's limit on ${check.what} starts only in a new session, so this check passes there, as setup expects. ${NEW_SESSION}.${by}`;
  }
  if (result === 'could not run') {
    return `Failed: setup couldn't try ${check.what}. ${RERUN}; if it can't again, check this computer is online and Claude Desktop is open.${by}`;
  }
  const [failed, todo] = check.results?.[result] ?? [check.failed, check.todo];
  return `${check.watch ? 'Watch' : 'Failed'}: ${failed} (${check.expected} was expected, ${result} came back). ${todo}.${by}`;
}

// ---- The helper's part ----

// The project the step works on: the folder's registered record.
function projectHere(folder) {
  const found = projectForFolder(folder);
  return found === null ? null : { project: found.project, record: found.record };
}

function card(repo, local) {
  if (local) {
    return {
      kind: 'setup',
      level: 3,
      what: `Setup step ${HEALTH_STEP}, ${SETUP_TITLES[HEALTH_STEP]}: setup tries Wheelhouse's safety checks for real on this computer. `
        + `It opens a change holding nothing, and asks the merge gate to merge it without your approval, which the gate must refuse. `
        + 'It checks All stop halts an agent, the installed skills and the project\'s private copy. '
        + 'The session then tries the sandbox\'s checks and shows the Logbook; setup then closes the change.',
      why: 'A check never tried can\'t be trusted: these show the Logbook is green for real.',
      options: [
        { label: SETUP_LABEL, says: 'Setup runs the checks, then shows the Logbook, with what to do about any that didn\'t pass.' },
        { label: 'Not now', says: 'Setup waits at this step; nothing changes.' },
      ],
      recommend: SETUP_LABEL,
      because: 'it is the last step, and it takes about a minute',
      meanwhile: 'Setup waits at this step; nothing changes.',
    };
  }
  return {
    kind: 'setup',
    level: 3,
    what: `Setup step ${HEALTH_STEP}, ${SETUP_TITLES[HEALTH_STEP]}: setup tries Wheelhouse's safety checks for real on ${repo}. `
      + `It pushes a branch, ${HEALTH_BRANCH}, holding one empty commit, opens a pull request from it, and asks the merge gate to merge it without your approval, which the gate must refuse. `
      + 'It checks All stop halts an agent, the installed skills and the host\'s protection. '
      + 'The session then tries the sandbox\'s checks, the merge among them, and shows the Logbook; setup then closes the pull request and deletes the branch.',
    why: 'A check never tried can\'t be trusted: these show the Logbook is green for real.',
    options: [
      { label: SETUP_LABEL, says: 'Setup runs the checks, then shows the Logbook, with what to do about any that didn\'t pass.' },
      { label: 'Not now', says: 'Setup waits at this step; nothing changes.' },
    ],
    recommend: SETUP_LABEL,
    because: 'it is the last step, and it takes about a minute',
    meanwhile: 'Setup waits at this step; nothing changes.',
  };
}

// git's subcommand among its arguments: the first that is neither an option nor a `-c` setting's value.
function subcommand(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-c') i += 1;
    else if (!args[i].startsWith('-')) return args[i];
  }
  return '';
}

// Runs git for the trial branch with the director's own sign-in, in `dir`, with git's global and
// system config shut out and a setting of its config not on setup's allowed list refused (rulings
// R109 to R112, scripts/setup/git.js);
// its output, or a throw naming only the subcommand (or the hook).
async function gitIn(run, { gitPath, env, dir }, args) {
  const got = await setupGit({ run, gitPath, env, cwd: dir })(args);
  if (got.code !== 0) throw new Error(`git ${subcommand(args)} failed for the trial branch`);
  return got.stdout.trim();
}

// git for the trial, with the director's own sign-in, in a new scratch repository, to `use`; the
// scratch is removed afterwards. Never the director's own folder.
async function withTrialGit({ run, findGit, gitEnvFor, host, platform, remoteUrl, base }, use) {
  const located = await findGit({ platform });
  if (!located?.ok || typeof located.path !== 'string') throw new Error('git is not on this computer; step 2 installs it');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-health-'));
  try {
    // https only, with a local path too only when the project's address as setup recorded it is one
    // (ruling R111).
    const git = { gitPath: located.path, env: reaching(gitEnvFor({ host, gitPath: located.path, platform, base }), remoteUrl), dir };
    await gitIn(run, git, ['init', '-q', '--bare', '.']);
    return await use(git);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Where the trial's branch goes: the host, or for a project kept on this computer its home, by its path.
const trialPlace = (project, record) => (record.host === 'local' ? homeDir(project) : record.remoteUrl);

const answerChange = (after, project) => ({ id: newId('chg'), kind: 'answer', target: `step ${HEALTH_STEP}`, before: null, after, ...(project ? { project } : {}) });

// Closes the trial pull request and deletes its branch, each recorded (`record`) before it is
// made, then records what came of them: { pr, branch, closed, deleted }, true only where it was
// done. `pr` or `sha` null: nothing of that was made.
async function closeTrial({ project, projectRecord, pr, sha, adapter, gitFor, record }) {
  let closed = pr === null;
  let deleted = sha === null;
  if (pr !== null) {
    record({ id: newId('chg'), kind: 'host', target: `${projectRecord.repo} pull request ${pr}`, before: { state: 'open' }, after: { state: 'closed' }, project });
    try {
      await adapter.closePr(pr);
      closed = true;
    } catch { /* left open: recorded so below */ }
  }
  if (sha !== null) {
    record({ id: newId('chg'), kind: 'host', target: `${projectRecord.repo} branch ${HEALTH_BRANCH}`, before: { branch: HEALTH_BRANCH, sha }, after: null, project });
    try {
      await gitFor((git) => gitIn(git.run, git, ['push', '-q', trialPlace(project, projectRecord), `:refs/heads/${HEALTH_BRANCH}`]));
      deleted = true;
    } catch { /* left there: recorded so below */ }
  }
  const outcome = { pr, branch: HEALTH_BRANCH, closed, deleted };
  record(answerChange({ cleanup: outcome }, project));
  return outcome;
}

// The latest cleanup record for a pull request in a run, or null.
function cleanupOf(run, pr) {
  return (Array.isArray(run?.changes) ? run.changes : [])
    .filter((c) => c?.step === HEALTH_STEP && c.kind === 'answer' && c.after?.cleanup && c.after.cleanup.pr === pr).at(-1)?.after.cleanup ?? null;
}

// The trial the run's last attempt left open for the session's trials (ruling R68):
// { project, pr, branch, sha }, or null when there is none, or it has been cleaned up.
export function openTrial(run) {
  const record = helperRecord(run);
  if (record?.open !== true || !Number.isInteger(record.pr) || cleanupOf(run, record.pr) !== null) return null;
  return { project: record.project, pr: record.pr, branch: record.branch, sha: record.sha ?? null };
}

// Closes the trial `setupRun` left open, if there is one, recording each change with `record`;
// what came of it, or null. The helper's /setup/health route calls it once the session's lines
// are in, and step 10's apply before it opens another. `run`, `adapterFor`, `findGit`,
// `gitEnvFor` and `platform` are as healthStep's.
export async function closeOpenTrial({
  setupRun, record, run = realRun, adapterFor, findGit, gitEnvFor = directorGitEnv, platform = process.platform,
} = {}) {
  const trial = openTrial(setupRun);
  if (trial === null) return null;
  const projectRecord = readProject(trial.project);
  if (projectRecord === null) return null;
  const adapter = (adapterFor ?? (({ host, repo, base, folder }) => adapterOf({ host, repo, folder, connection: { baseUrl: base } }, { run })))({ host: projectRecord.host, repo: projectRecord.repo, base: projectRecord.connection?.baseUrl, folder: projectRecord.folder });
  const finder = findGit ?? (async ({ platform: p }) => (await toolsStatus({ platform: p, run, tools: ['git'] })).git);
  const gitFor = (use) => withTrialGit({ run, findGit: finder, gitEnvFor, host: projectRecord.host, platform, remoteUrl: trialPlace(trial.project, projectRecord), base: projectRecord.connection?.baseUrl }, (git) => use({ ...git, run }));
  return closeTrial({ project: trial.project, projectRecord, pr: trial.pr, sha: trial.sha, adapter, gitFor, record });
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
// The engine's checks for a project whose engine in force is Archon, or null for one on the old engine.
async function engineChecksNow({ project, kits }) {
  const { engineForProject, ENGINE_CONFIG } = await import('../host/helper-main.js');
  const engine = engineForProject()(project);
  if (!engine) return null;
  return engineCheck({
    health: () => engine.health(),
    trial: async () => (kits ? helloTrial({ packDir: path.join(engineDir(), 'pack'), configFile: ENGINE_CONFIG }) : 'not run'),
  });
}

function checkPinsNow({ folder }) {
  return checkInstalled({ manifest: readManifest(), projectDir: folder, claudeHome: claudeHome() }).ok ? 'match' : 'differ';
}

// The host's protection, read back with the director's own sign-in: 'on', 'off', or 'not offered'
// on a plan without it.
async function readProtectionNow({ host, repo, run, realUsers = false, base }) {
  const api = host === 'gitlab' ? await directorGitlabApi({ run, baseUrl: base }) : undefined;
  const read = await protectionStatus({ host, repo, run, api, env: {}, realUsers, director: true });
  if (read.on === true) return 'on';
  return read.available === false ? 'not offered' : 'off';
}

// Whether step 10's apply, the helper's half, has finished: done or not, the board decides that.
const applied = (run) => typeof run?.steps?.[HEALTH_STEP]?.doneAt === 'string';

// Step 10. `run` runs git and the host's tools; `adapterFor({ host, repo, base })` the adapter, with the
// director's own sign-in; `client` the helper's client the merge is asked through; `findGit` the
// git step 2 found; `gitEnvFor({ host, gitPath, platform, base })` git's environment; `trySTOP`,
// `checkPins({ folder })` and `readProtection({ host, repo, realUsers, base })` the other checks. All for tests.
export function healthStep({
  run = realRun,
  adapterFor = ({ host, repo, base, folder }) => adapterOf({ host, repo, folder, connection: { baseUrl: base } }, { run }),
  client,
  findGit = async ({ platform }) => (await toolsStatus({ platform, run, tools: ['git'] })).git,
  gitEnvFor = directorGitEnv,
  trySTOP = () => stopTrial({ run }),
  checkPins = checkPinsNow,
  readProtection = ({ host, repo, realUsers, base }) => readProtectionNow({ host, repo, run, realUsers, base }),
  engineChecks = engineChecksNow,
  lookHome = lookAtHome,
} = {}) {
  return {
    n: HEALTH_STEP,
    title: SETUP_TITLES[HEALTH_STEP],
    long: true,
    // The project's files, pins and protection, and Locked, first: the checks try them. The phone is
    // optional and comes after (design section 15.1), so it is not waited for.
    after: [7, 8],
    async plan(ctx) {
      const found = projectHere(ctx.folder);
      if (found === null) return { wait: 30 * 1000, why: `step 3 (${SETUP_TITLES[3]}) has not registered the project yet; the health check comes once it has` };
      const { project, record } = found;
      // The helper's checks are done and the trial is open: the session's trials come next.
      const setupRun = readJournal().runs.find((r) => r?.id === ctx.runId) ?? null;
      const trial = openTrial(setupRun);
      if (trial !== null) {
        const why = `step 10's own checks are done and its trial pull request, number ${trial.pr}, is open: run cli.js health, then the trials it names in this session's Bash, then cli.js health with every line they printed, and show its Logbook`;
        return { wait: 30 * 1000, why: record.host === 'local' ? localWords(why) : why };
      }
      const local = record.host === 'local';
      const changes = [{
        kind: 'host', what: 'health-check', target: `${record.repo}: branch ${HEALTH_BRANCH} and a ${local ? 'change' : 'pull request'} from it, closed once the session's trials are done`,
        project, host: record.host, repo: record.repo, branch: HEALTH_BRANCH,
      }];
      return { changes, card: card(record.repo, local), director: 'One click, then read the Logbook' };
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
      const adapter = adapterFor({ host: record.host, repo: record.repo, base: record.connection?.baseUrl, folder: record.folder });
      const place = trialPlace(project, record);
      const asker = client ?? helperClient({ timeout: HEALTH_MERGE_WAIT_MS });
      const gitFor = (use) => withTrialGit({ run, findGit, gitEnvFor, host: record.host, platform, remoteUrl: place, base: record.connection?.baseUrl }, (git) => use({ ...git, run }));
      // A trial an earlier attempt left open is closed first: a pull request from the same branch
      // can't be opened twice (ruling R68).
      await closeOpenTrial({ setupRun: readJournal().runs.find((r) => r?.id === ctx.runId) ?? null, record: ctx.record, run, adapterFor, findGit, gitEnvFor, platform });
      halt();
      const checks = [];
      const add = (name, result) => checks.push({ name, expected: HELPER_CHECKS[name].expected, result, ok: passes(HELPER_CHECKS[name], result) });
      let pushed = null;
      let number = null;
      let failure = null;
      try {
        // The empty commit, on the default branch's tip, made in a scratch repository: never in
        // the director's own folder.
        const base = await adapter.defaultBranch();
        await gitFor(async (git) => {
          await gitIn(run, git, ['fetch', '-q', '--depth=1', place, `refs/heads/${base}`]);
          const parent = await gitIn(run, git, ['rev-parse', 'FETCH_HEAD']);
          const tree = await gitIn(run, git, ['rev-parse', 'FETCH_HEAD^{tree}']);
          const sha = await gitIn(run, git, [...TRIAL_AUTHOR, 'commit-tree', '--no-gpg-sign', tree, '-p', parent, '-m', TRIAL_MESSAGE]);
          halt();
          ctx.record({ id: newId('chg'), kind: 'host', target: `${record.repo} branch ${HEALTH_BRANCH}`, before: null, after: { branch: HEALTH_BRANCH, sha }, project });
          await gitIn(run, git, ['push', '-q', '--force', place, `${sha}:refs/heads/${HEALTH_BRANCH}`]);
          pushed = sha;
        });
        // Recorded just before it is opened, as pending, since its number comes only with it;
        // then by its number.
        ctx.record({ id: newId('chg'), kind: 'host', target: `${record.repo} pull request from ${HEALTH_BRANCH}`, before: null, after: { state: 'opening', branch: HEALTH_BRANCH }, project });
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
        // The engine's checks, for a project on it, after the skills: a step whose kits don't match is held, so the
        // trial runs only once they do.
        let engine = null;
        try {
          engine = await engineChecks({ project, kits: pins === 'match' });
        } catch {
          engine = { engine: 'could not run', trial: 'could not run', findings: [] };
        }
        if (engine !== null) {
          add('build engine', engine.engine);
          add('engine trial', engine.trial);
          for (const line of engine.findings ?? []) ctx.say?.(line);
        }
        halt();
        if (record.host === 'local') {
          let look = 'could not run';
          try {
            look = (await lookHome({ project, seen: seenMain(project) })).ok ? 'ok' : 'not as it should be';
          } catch { /* could not run */ }
          add('private copy', look);
        } else {
          let protection = 'could not run';
          try {
            protection = await readProtection({ host: record.host, repo: record.repo, realUsers: launchedIn(project), ...(record.connection?.baseUrl ? { base: record.connection.baseUrl } : {}) });
          } catch { /* could not run */ }
          add('host protection', protection);
        }
      } catch (error) {
        failure = error;
      }
      const failed = checks.filter((c) => !c.ok);
      // Every check passed: the pull request stays open for the session's merge trial, and the
      // health route closes it once the session's lines are in (ruling R68). Otherwise the board is
      // red whatever the session finds, so the trial is cleaned up now. That runs after a STOP
      // halt too: closing setup's own trial pull request and deleting its branch starts no work,
      // it only takes back what this step made.
      const open = failure === null && failed.length === 0 && number !== null;
      ctx.record(answerChange({ health: { project, pr: number, branch: HEALTH_BRANCH, sha: pushed, checks, open } }, project));
      if (!open && (number !== null || pushed !== null)) {
        await closeTrial({ project, projectRecord: record, pr: number, sha: pushed, adapter, gitFor, record: ctx.record });
      }
      if (failure !== null) throw failure;
      if (failed.length > 0) throw new Error(`these checks didn't pass: ${failed.map((c) => c.name).join(', ')}; the Logbook says what to do`);
      return [];
    },
  };
}

// ---- Joining the two parts ----

// The latest record of step 10's checks in a run: { project, pr, branch, sha, checks, open }, or null.
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
  // Every check that holds the board and prints a line, and how many of them passed: the verdict
  // says so, so its figures match the lines shown.
  let total = 0;
  let passed = 0;
  // Checks that only need a new session (SESSION_CHECKS' `newSession`).
  let waiting = 0;
  const count = (ok) => { total += 1; if (ok) passed += 1; };
  const entry = here?.steps?.[HEALTH_STEP] ?? {};
  const record = helperRecord(here);
  if (!applied(here)) {
    count(false);
    green = false;
    lines.push(entry.failed
      ? `Failed: step 10 did not finish: ${entry.failed}. ${RERUN} once each line below is seen to.`
      : 'Not yet: step 10\'s checks haven\'t run. They run once its card is clicked.');
  }
  // Step 10 done with no record of its checks: one line says so, in place of the checks' own.
  if (applied(here) && record === null) {
    count(false);
    green = false;
    lines.push(`Failed: step 10's record of its checks is missing. ${RERUN}.`);
  }
  const found = projectForFolder(folder);
  const host = found?.record.host;
  // The helper's checks: each as recorded, and any not tried named.
  const tried = new Map((record?.checks ?? []).map((c) => [c.name, c.result]));
  for (const [name, check] of Object.entries(HELPER_CHECKS)) {
    if (!tried.has(name)) {
      // With no record, a line above says so for every check, and this one prints nothing. A project off the engine
      // has no engine checks to try.
      if (record !== null && check.onEngine !== true && (host === 'local' ? check.hosted !== true : check.local !== true)) {
        count(false);
        green = false;
        lines.push(`Failed: setup couldn't try ${check.what} before step 10 stopped. ${RERUN}.`);
      }
      continue;
    }
    const result = tried.get(name);
    count(passes(check, result));
    if (!passes(check, result)) green = false;
    lines.push(checkLine(check, result));
  }
  // The trial pull request: still open for the session's trials, or how its clean-up went.
  if (Number.isInteger(record?.pr)) {
    const cleanup = cleanupOf(here, record.pr);
    if (cleanup !== null) lines.push(checkLine(CLEANUP_CHECK, cleanup.closed && cleanup.deleted ? 'closed' : 'left open'));
    else if (record.open === true) {
      count(false);
      green = false;
      lines.push(`Waiting: the trial pull request, number ${record.pr}, is open for this session's trials; it is closed once their lines are in.`);
    }
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
      count(false);
      green = false;
      lines.push(`Not reported by the session: ${check.what}. Run step 10's trials in this session and hand in every line.`);
      continue;
    }
    const result = given.get(name);
    count(passes(check, result, host));
    if (needsNewSession(check, result, host)) waiting += 1;
    if (!passes(check, result, host)) green = false;
    lines.push(checkLine(check, result, { session: true, host }));
  }
  if (unreadable > 0) lines.push(`Left out: ${unreadable} ${unreadable === 1 ? 'line' : 'lines'} the session handed in that ${unreadable === 1 ? 'isn\'t a trial\'s' : 'aren\'t trials\''}.`);
  // The board's health lines, and the board itself.
  const inputs = found === null ? { none: 'This folder isn\'t a registered project yet' } : await load({ cwd: found.record.folder, now, client });
  const health = Array.isArray(inputs?.model?.director?.health) ? inputs.model.director.health : null;
  if (health === null) {
    count(false);
    green = false;
    lines.push(`Failed: the Logbook couldn't be read: ${inputs?.none ?? 'its health lines are missing'}. ${RERUN}.`);
  } else {
    for (const line of health) {
      if (line?.level === 'stop') {
        green = false;
        count(false);
      }
      lines.push(`Logbook: ${line.text}`);
    }
  }
  // One verdict ends the lines.
  const verdict = healthVerdict(passed, total, waiting);
  lines.push(verdict);
  if (host === 'local') lines.splice(0, lines.length, ...lines.map(localWords));
  const board = inputs?.model ? renderBoard(inputs.model) : null;
  const trials = Number.isInteger(record?.pr) ? { pr: record.pr, project: record.project } : null;
  return { green, lines, verdict, board, trials, project: found?.project ?? null };
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

// The last thing setup does, once the board is green and shown (ruling R44): the survey of what
// the project already holds, recorded in its state (design section 15, ruling A1; plan ruling P1:
// after the run's records are copied there, before the first briefing), the foreman started, as
// start.js starts it, and the front desk's first briefing. { started, briefing, card? }: `started` a
// line saying how the foreman stands; `briefing` the briefing's text, or null when it couldn't be
// put together (the front desk gives one at the next visit); `card`, at Autonomy Cautious and
// Balanced when the survey found work in flight, the card asking whether to carry it on (ruling
// A9), recorded as the front desk records a card, as { question, id }: setup's playbook asks it
// right after the briefing. The survey only reads, and never
// stops setup: one that fails, or that the state refuses, is recorded as one that missed the host
// (scripts/survey/take.js). Only the helper records a survey: `writeSurvey(project, data)` is its
// own writer, which the helper hands setup's routes; with none, nothing is recorded.
// `start(project)`, `brief(project)`, `look({ rules })` (the survey taken), `adapterFor(record)` (the
// host's adapter the survey asks) and `autonomy(project, at)` (the Autonomy in force) are for tests. The survey carries the rules step 5 found, as
// `{ words, source }`, in the director's own words where their sessions from before the run hold
// them (plan ruling P7). `surveyDeadlineMs` is the survey's time limit, for tests.
export async function finishSetup({
  project, client = helperClient({ timeout: BRIEFING_WAIT_MS * 2 }), now = () => new Date(), spawn, load = loadBoardInputs,
  start, brief, adapterFor, userHome = os.homedir(), surveyDeadlineMs, autonomy = autonomyOf,
  look = ({ rules }) => takeSurvey({ project, rules, ...(adapterFor ? { adapter: adapterFor } : {}), ...(surveyDeadlineMs ? { deadlineMs: surveyDeadlineMs } : {}) }),
  writeSurvey = async () => ({ ok: false, refused: 'only the helper records a survey' }),
} = {}) {
  // The survey as recorded, { id, data }, for the first briefing to mention.
  let survey = null;
  const write = async (data) => {
    const got = await writeSurvey(project, data);
    if (got?.ok === true && typeof got.id === 'string') survey = { id: got.id, data };
    return got;
  };
  try {
    await recordSurvey({ write, take: () => look({ rules: rulesFound(project, userHome) }) });
  } catch { /* recordSurvey never throws; setup finishes whatever the survey does */ }
  let started;
  try {
    started = start ? await start(project) : await startForeman(project, { client, spawn });
  } catch {
    started = 'The Bosun couldn\'t be started now; the next session start in this project starts it.';
  }
  let briefing = null;
  let card = null;
  try {
    if (brief) briefing = await brief(project);
    else ({ briefing, card } = await firstBriefing(project, { client, now, load, survey, autonomy }));
  } catch { /* the front desk briefs at the next visit */ }
  return { started, briefing, ...(card === null ? {} : { card }) };
}

// The rules of the project's folder as the survey keeps them, those found before its setup run
// began: none when they can't be read.
function rulesFound(project, userHome) {
  try {
    const folder = readProject(project)?.folder;
    if (typeof folder !== 'string') return [];
    const before = runIn(folder)?.startedAt;
    return rulesOf(folder, { userHome, ...(typeof before === 'string' ? { before } : {}) }).map(({ words, source }) => ({ words, source }));
  } catch {
    return [];
  }
}

// start.js's own start for Shape 1, the watcher (startWatcher), which wakes a foreman when there is
// work. Shape 2's foreman is a session in a terminal, which the helper can't open: the line says so.
async function startForeman(project, { client, spawn }) {
  const read = await projectConfig(project, client);
  if (read.config === null) return `The Bosun couldn't be started now (${read.why}); the next session start in this project starts it.`;
  if (read.config.watcherShape === 2) return `This project's Bosun runs in a terminal of its own: start it there with start.js ${project}.`;
  const { started } = startWatcher(project, spawn ? { spawn } : {});
  return started ? 'The Bosun\'s watcher is started: it wakes a Bosun when there is work.' : 'The Bosun\'s watcher is running: it wakes a Bosun when there is work.';
}

// The front desk's first briefing, as the board-context hook gives one, and kept as given so the
// hook doesn't give the same one again at once: { briefing, card }. It mentions the survey once,
// marked as mentioned only when the text showed it (plan ruling P8). Work in flight is asked about
// on the carry-on card at Autonomy Cautious and Balanced, so its line is left out of the briefing,
// and at Trusting its line says Wheelhouse is carrying it on (ruling A9); the card says that line,
// so a survey with no other is marked as mentioned all the same. A card that couldn't be recorded
// leaves the line in, as A2 has it.
async function firstBriefing(project, { client, now, load, survey, autonomy }) {
  const at = now();
  // Read on its own, so board inputs that fail to load can't ask the card at Trusting; an Autonomy
  // that can't be read asks no card, and the briefing says the line instead.
  let level = null;
  try {
    level = autonomy(project, at);
  } catch { /* none read */ }
  const record = readProject(project);
  const folder = record?.folder;
  if (typeof folder !== 'string') return { briefing: null, card: null };
  let inputs = null;
  try {
    inputs = await load({ cwd: folder, now: () => at, client, waitMs: BRIEFING_WAIT_MS });
  } catch { /* no briefing now; the card is still asked */ }
  const host = record.host ?? null;
  const settings = inputs?.settings;
  const carrying = level === 'trusting';
  const card = survey === null || carrying || (level !== 'cautious' && level !== 'balanced') ? null : await askCarryOn(project, { client, folder, survey, host, record });
  if (!inputs?.model) return { briefing: null, card };
  const seen = readSeen(project, { now: at });
  const { model, usage, sources } = inputs;
  const given = briefingIn({
    project, model, usage, sources, settings, since: seen.briefedAt, weeklySince: seen.weeklyAt, review: reviewOf(project, settings, at), at, room: CONTEXT_CHARS,
    survey, surveyAt: readSurveyAt(project), host, carrying, leaveOut: card === null ? [] : ['inFlight'],
    // Locked was just chosen or passed over at setup: its weekly line waits for the next week's first
    // briefing, which this briefing starts the count for.
    holdLocked: true,
  });
  markSeen(project, { briefedAt: at, weeklyAt: at, ...(given.surveyShown ? { surveyAt: given.surveyShown } : {}), ...(given.safekeeping ? { safekeepingLevel: given.safekeeping, safekeepingAt: at } : {}) });
  return { briefing: given.text, card };
}

// The Autonomy in force for the project, as the settings views on this computer give it: the
// project's over the director's own, over the default.
function autonomyOf(project, at) {
  const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const views = localViews(project, ['settings']);
  const profile = readProfileViews();
  const settings = effectiveSettings({
    project: isPlainObject(views?.settings) ? views.settings : {}, profile: isPlainObject(profile?.settings) ? profile.settings : {}, now: at,
  });
  return settings.autonomy?.value ?? null;
}

// The carry-on card for the work in flight the survey found (ruling A9), recorded through the
// helper as the front desk records a card (`card`, then `asked`), as { question, id }; null when
// nothing is in flight or it couldn't be recorded. The project is named as the director knows it:
// its repository's own name.
async function askCarryOn(project, { client, folder, survey, host, record }) {
  try {
    const name = typeof record.repo === 'string' ? record.repo.split('/').at(-1) : path.basename(folder);
    const input = carryOnCard(survey.data, { project: name, host });
    if (input === null) return null;
    const { question, card } = composeCard(input);
    const made = await client.state.write({ cwd: folder, kind: 'card', data: card });
    if (made?.ok !== true || typeof made.id !== 'string') return null;
    // A card not marked as asked is offered again at the next visit, which asks it once more: no harm.
    try {
      await client.state.write({ cwd: folder, kind: 'asked', data: { cards: [made.id] } });
    } catch { /* see above */ }
    return { question, id: made.id };
  } catch {
    return null;
  }
}
