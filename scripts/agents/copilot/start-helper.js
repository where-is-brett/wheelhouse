// scripts/agents/copilot/start-helper.js
// Wheelhouse's helper on a computer where Copilot builds and Node.js may run (design sections 6.4 and 8.5; rulings
// P5-16, P5-29, P5-30). It is the one command the front desk asks the person to allow in Copilot's own prompt, run
// in the project's own folder as `"<node>" "<root>/scripts/agents/copilot/start-helper.js" <command>`:
//
//   plan --work-computer yes|no --real-users yes|no [--test <command>]
//        prints the changes install makes, one plain line each, and their hash: the hook file, the sign-in start
//        (none on a work computer), a signing key where this computer has none, the project's registration, its
//        git moved into Wheelhouse's store, and the change card's answers (real users and the test command), so
//        the hash covers them, and a line when the folder's own record leaves STOP on. Adoption's own checks run
//        first, so a folder the store would refuse gets that plain line and no card (ruling P5-58). The chat asks
//        the card with these lines.
//   install --hash <hash> and the same answers
//        on the card's Approve: makes the changes plan listed, refused if they are no longer the ones the card
//        showed (the hash) or while STOP is on. The move into the store and then the registration are made holding
//        the project's lock, so two installs at once never both register, and an adoption refused or failed leaves
//        nothing registered. A STOP the folder's record leaves on is STOP from then on. Then it starts the helper.
//   start
//        starts the helper detached if it isn't answering, and the watcher for each project on an agent whose
//        sessions part is built (none at Lean, so the waker is never made for one); the usage receiver only with
//        such a watcher (design section 6.4: nothing runs in the background at Lean). Prints one plain line:
//        "Wheelhouse's helper is running", or why not.
//   uninstall-plan --remove-state yes|no
//        prints what taking the project off the helper does, one plain line each, and their hash (ruling P5-51),
//        with how many ideas, rulings and designs decided through the helper are written into the record (P5-58);
//        the chat asks the card with them.
//   uninstall --hash <hash> --remove-state yes|no
//        on the card's click, the Lean removal setup's LEAN_FOLDER line points to: what was decided through the
//        helper is written into the record files in one commit on main, the project's git moves back into
//        its folder with the main version checked out, its Lean record goes, the hook file and the sign-in start go
//        when no other project on this computer needs them, and its Wheelhouse state goes only when the director
//        chose it. Refused under STOP, and for a hash that isn't the card's.
//
// Each prints its lines and exits 0, or prints why not and exits 1. Nothing here is run by an agent or a hook
// (design section 8.2: registered by setup, once per computer).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copilotHome, file as hookFile, writeRegistration } from '../../../adapters/copilot/hooks.js';
import identity from '../../../adapters/copilot/identity.js';
import { run as realRun } from '../../lib/run.js';
import { canonicalJson } from '../../lib/canonical.js';
import { computerId, jobFolder, wheelhouseHome } from '../../lib/paths.js';
import { stopState } from '../../lib/stop.js';
import { projectForFolder, readProject, registeredProjects } from '../../lib/projects.js';
import { loginEntry, installLoginStart, removeLoginStart, loginStartRecord } from '../../lib/login-start.js';
import { startedAsScript } from '../../lib/started-as-script.js';
import { readLean, registerLean, registeredLeanProjects, unregisterLean, updateLean } from '../../lean/project.js';
import { releaseProject, writeBackLines, writeBackCount } from '../../lean/release.js';
import { LeanRefusal, adoptProject, checkAdoptable, storeDir, withLocalLock } from '../../lean/store.js';
import { ownKey, makeSigningKey, enrol } from '../../state/signing.js';
import { helperClient } from '../../host/helper-client.js';
import { caEnv } from '../../host/company-ca.js';
import { askHealth, startDetached } from '../../lib/background.js';
import { receiverPort } from '../../telemetry/main.js';
import { projectConfig } from '../../watcher/main.js';
import { startWatcher } from '../../foreman/start.js';
import { agentOfProject, sessionsOfProject } from '../project-agent.js';
import { isPendingPart } from '../contract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// This file, from the Wheelhouse folder: what the sign-in start runs.
export const START_SCRIPT = 'scripts/agents/copilot/start-helper.js';
const AGENT = identity.name;
const LABEL = identity.label;
// How long `start` waits for a helper it started to answer.
export const START_WAIT_MS = 15000;
const POLL_MS = 200;

export const RUNNING = 'Wheelhouse\'s helper is running';
export const NOT_STARTED = `Wheelhouse's helper didn't start within ${START_WAIT_MS / 1000} seconds. Run the start command again; if it still doesn't start, restart the computer and try once more`;
export const CHANGED = 'The changes are no longer the ones the card showed, so nothing was installed. Ask for the plan again, and the card with it';
export const STOP_ON = 'All stop is on, so nothing was changed. Lift All stop first, then try again';
// The plan's line, and install's, when the folder's own record leaves STOP on (ruling P5-58).
export const STOP_CARRIED = 'This folder\'s record says All stop is on, so All stop stays on with the helper: only Lift All stop in Wheelhouse\'s own window lifts it';
const NOT_LEAN = 'This folder isn\'t a Lean project on this computer, so there is nothing to remove';
const USAGE = 'Usage: start-helper.js plan|install --work-computer yes|no --real-users yes|no [--test <command>] [--hash <hash>] | start | uninstall-plan --remove-state yes|no | uninstall --hash <hash> --remove-state yes|no';

export class StartRefusal extends Error {}
const refuse = (line) => { throw new StartRefusal(line); };

// The start command as the person allows it, for the playbook and the front desk.
export function startCommand({ node = process.execPath, root = ROOT, platform = process.platform } = {}) {
  const script = platform === 'win32' ? path.win32.join(root, ...START_SCRIPT.split('/')) : path.posix.join(root, START_SCRIPT);
  return `"${node}" "${script}"`;
}

const realOrNull = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

// The Lean project's name for `folder`: the one it is registered under, or a folder name made from the folder's
// own name, with a number added while that name is another folder's.
function projectNameFor(folder) {
  const found = projectForFolder(folder);
  if (found?.lean === true) return found.project;
  if (found) refuse('This folder is set up with a code host, so it isn\'t installed at Lean');
  const base = path.basename(folder).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'project';
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    const held = readLean(name);
    if (readProject(name) === null && (held === null || realOrNull(held.folder) === folder)) return name;
  }
}

// The answers the change card gives, checked.
function answersOf({ workComputer, realUsers, test }) {
  if (typeof workComputer !== 'boolean') refuse('Say whether this is a work computer: --work-computer yes or no');
  if (typeof realUsers !== 'boolean') refuse('Say whether the product has real users: --real-users yes or no');
  if (test !== null && test !== undefined && (typeof test !== 'string' || test.trim() === '' || /[\r\n\0]/.test(test))) refuse('The test command is one line');
  return { workComputer, realUsers, test: test ?? null };
}

const defaults = (deps) => ({
  run: realRun,
  regRun: realRun,
  userHome: os.homedir(),
  platform: process.platform,
  env: process.env,
  node: process.execPath,
  root: ROOT,
  now: () => new Date(),
  start: () => startAll(),
  makeKey: (make) => make(),
  ...deps,
});

// planInstall({ folder, workComputer, realUsers, test }, deps) -> { project, folder, changes, lines, hash, entry }
export async function planInstall(answers, deps = {}) {
  const d = defaults(deps);
  const { workComputer, realUsers, test } = answersOf(answers);
  const folder = realOrNull(answers.folder ?? process.cwd());
  if (folder === null) refuse('This folder isn\'t there');
  const dotGit = path.join(folder, '.git');
  if (!fs.existsSync(dotGit)) refuse('Run this in the project\'s own folder, where its git is');
  const project = projectNameFor(folder);
  // Adoption's own checks first (ruling P5-58), so no card is asked for a folder the store would refuse.
  const look = await checkAdoptable({ project, folder, run: d.run });
  const hooks = hookFile({ home: copilotHome({ env: d.env, homedir: d.userHome }) });
  const entry = workComputer ? null : loginEntry({ platform: d.platform, node: d.node, root: d.root, script: START_SCRIPT, home: d.userHome });
  const store = storeDir(project);
  const needsKey = ownKey() === null;
  const changes = [
    { change: 'hook-file', path: hooks },
    entry === null ? { change: 'no-sign-in-start', workComputer } : { change: 'sign-in-start', kind: entry.kind, path: entry.path, content: entry.content },
    ...(needsKey ? [{ change: 'signing-key' }] : []),
    { change: 'register', project, folder },
    { change: 'store', path: store },
    { change: 'real-users', value: realUsers },
    { change: 'test', value: test },
    ...(look.stop ? [{ change: 'stop-carried' }] : []),
  ];
  const lines = [
    `Wheelhouse's guards are registered with ${LABEL} in ${hooks}, for every project on this computer`,
    entry === null
      ? (workComputer
        ? 'No start-up entry, as this is a work computer: the helper runs once you allow its start command, and work that needs it waits while it isn\'t running'
        : 'No start-up entry on this system: the helper runs once you allow its start command')
      : `Wheelhouse's helper starts when you sign in to this computer, for you only: ${entry.kind === 'launch-agent' ? entry.path : 'a start-up entry named Wheelhouse helper in your account\'s settings'}`,
    ...(needsKey ? ['A signing key for this computer, so what you confirm in Wheelhouse\'s own window is signed'] : []),
    `This folder, ${folder}, is registered as the Lean project ${project}`,
    `Its git moves into Wheelhouse's own folder, ${store}, and this folder becomes a worktree of it, so only the helper moves the main version`,
    realUsers
      ? 'It has real users, so a merge is approved only in Wheelhouse\'s own window'
      : 'It has no real users yet, so a click in the chat approves a merge',
    test === null
      ? 'No test command is set, so merges go ahead with no tests run, and the record says so'
      : `Before each merge the helper runs \`${test}\` on the approved commit`,
    ...(look.stop ? [STOP_CARRIED] : []),
  ];
  const hash = crypto.createHash('sha256').update(canonicalJson({ folder, project, changes })).digest('hex');
  return { project, folder, changes, lines, hash, entry, store, hooks, needsKey };
}

// install({ folder, hash, workComputer, realUsers, test }, deps) -> { ok, lines } after the card's Approve.
export async function install(answers, deps = {}) {
  const d = defaults(deps);
  const plan = await planInstall(answers, d);
  if (typeof answers.hash !== 'string' || answers.hash !== plan.hash) refuse(CHANGED);
  if (stopState().on) refuse(STOP_ON);
  const { project, folder } = plan;
  const { realUsers, test } = answersOf(answers);
  // One install at a time per project: the second waits, then finds the project registered and in the store.
  let adopted;
  await withLocalLock(project, async () => {
    const answers = { test, realUsers, agent: AGENT };
    if (readLean(project) === null) {
      // The git moves into the store first, and the project is registered only then (ruling P5-58): an adoption the
      // store refuses, or one that fails on the way, leaves nothing registered.
      adopted = await adoptProject({
        project,
        folder,
        run: d.run,
        now: d.now,
        register: ({ store, main, copy }) => {
          try {
            registerLean({ project, folder, now: d.now });
          } catch (error) {
            refuse(`The project could not be registered: ${error.message}`);
          }
          updateLean(project, { ...answers, store, main, ...(copy === null ? {} : { copy }) });
        },
      });
    } else {
      updateLean(project, answers);
      adopted = await adoptProject({ project, folder, run: d.run, now: d.now });
    }
    // Made inside the lock, so a second install of this project finds it; an install of another project that made
    // it a moment before is taken as made.
    if (plan.needsKey && ownKey() === null) {
      try {
        const own = d.makeKey(makeSigningKey);
        enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: d.now().toISOString() });
      } catch (error) {
        if (ownKey() === null) throw error;
      }
    }
  }, d.lockWaitMs === undefined ? {} : { waitMs: d.lockWaitMs });
  writeRegistration({ home: copilotHome({ env: d.env, homedir: d.userHome }), node: d.node, root: d.root, platform: d.platform });
  if (plan.entry !== null) await installLoginStart({ entry: plan.entry, run: d.regRun, now: d.now });
  const started = await d.start();
  return { ok: started.ok === true, lines: [`Wheelhouse's helper is installed for ${project}`, ...(adopted.stop ? [STOP_CARRIED] : []), started.line] };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const answerOf = async (promise) => {
  try {
    return await promise;
  } catch {
    return null;
  }
};

// startAll({ client, spawn, pluginRoot, waitMs, pause, env }) -> { ok, line, watchers }
export async function startAll({
  client = null, spawn = nodeSpawn, pluginRoot = ROOT, waitMs = START_WAIT_MS, pause = sleep, env = process.env,
  receiverUp = () => askHealth(receiverPort()),
} = {}) {
  const api = client ?? helperClient({ timeout: 2000 });
  let up = (await answerOf(api.health()))?.ok === true;
  if (!up) {
    try {
      const home = wheelhouseHome();
      fs.mkdirSync(home, { recursive: true });
      // Started in Wheelhouse's own folder, never the project's.
      const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'host', 'helper-main.js')], {
        cwd: jobFolder(), detached: true, windowsHide: true, stdio: 'ignore', env: { ...env, ...caEnv(home) },
      });
      child?.on?.('error', () => {});
      child?.unref?.();
    } catch {
      return { ok: false, line: NOT_STARTED, watchers: [] };
    }
    const until = Date.now() + waitMs;
    while (!up && Date.now() < until) {
      await pause(POLL_MS);
      up = (await answerOf(api.health()))?.ok === true;
    }
  }
  if (!up) return { ok: false, line: NOT_STARTED, watchers: [] };
  // The watcher for each project on a code host whose agent here may start its sessions. A Lean project has no
  // watcher, and one on an agent whose sessions aren't built yet, or whose foreman check refuses (Copilot's sessions
  // while they aren't switched on, ruling P8-1; a configuration they can't run under), is left alone, so no waker
  // is made for it.
  const watchers = [];
  for (const { project } of registeredProjects()) {
    const read = await answerOf(projectConfig(project, api));
    if (!read || read.config === null) continue;
    let sessions;
    try {
      sessions = sessionsOfProject(read.config);
    } catch {
      continue;
    }
    if (isPendingPart(sessions)) continue;
    try {
      sessions.checkForeman(read.config);
    } catch {
      continue;
    }
    try {
      startWatcher(project, { spawn, pluginRoot, env });
      watchers.push(project);
    } catch { /* that project's watcher is started by its own session start */ }
  }
  if (watchers.length > 0 && !(await answerOf(receiverUp()))) startDetached(spawn, path.join(pluginRoot, 'scripts', 'telemetry', 'main.js'));
  return { ok: true, line: RUNNING, watchers };
}

// Which other projects on this computer need the hook file and the sign-in start: the other Lean projects, and the
// projects on a code host that run on this agent here.
function othersNeeding(project) {
  const lean = registeredLeanProjects().filter((p) => p.project !== project).map((p) => p.project);
  let id;
  try {
    id = computerId();
  } catch {
    id = undefined;
  }
  const hosted = registeredProjects().filter((p) => agentOfProject(p.record.folder, { computerId: id }) === AGENT).map((p) => p.project);
  return [...lean, ...hosted];
}

const leanProjectOf = (given) => {
  const folder = realOrNull(given ?? process.cwd());
  const found = folder === null ? null : projectForFolder(folder);
  if (found?.lean !== true) refuse(NOT_LEAN);
  return { folder, project: found.project };
};

// planUninstall({ folder, removeState }, deps) -> { project, folder, changes, lines, hash }: what taking the project
// off the helper does (ruling P5-51), for the card the chat asks before `uninstall`.
export async function planUninstall({ folder: given, removeState } = {}, deps = {}) {
  const d = defaults(deps);
  if (typeof removeState !== 'boolean') refuse('Say whether the project\'s Wheelhouse state goes too: --remove-state yes or no');
  const { folder, project } = leanProjectOf(given);
  const others = othersNeeding(project);
  const hooks = hookFile({ home: copilotHome({ env: d.env, homedir: d.userHome }) });
  const start = loginStartRecord();
  const state = path.join(wheelhouseHome(), 'projects', project);
  // What the director decided through the helper, written back into the record before the git leaves the store
  // (ruling P5-58): the card names how many, and its hash covers each line.
  const main = readLean(project)?.main ?? null;
  const written = main === null ? [] : await writeBackLines({ project, run: d.run, main });
  const changes = [
    { change: 'leave-helper', project },
    { change: 'write-back', lines: written },
    { change: 'git-back', folder },
    others.length > 0 ? { change: 'keep-guards', others } : { change: 'remove-hook-file', path: hooks, start: start === null ? null : start.path },
    { change: removeState ? 'remove-state' : 'keep-state', path: state },
  ];
  const n = others.length;
  const lines = [
    `This project, ${project}, leaves Wheelhouse's helper: its guards, its record and its merges by the helper stop for it`,
    written.length > 0
      ? `What you decided through the helper, ${writeBackCount(written)}, is written into this folder's record files in .wheelhouse/record/, in one commit of its own on the main version, so working with git alone still follows it`
      : 'Nothing decided through the helper needs writing into this folder\'s record files: it holds no ideas, rulings or designs the record files don\'t',
    `Its git moves back into this folder, ${folder}, with the main version checked out, so you work with git alone, as Lean does without the helper`,
    ...(n > 0
      ? [`Wheelhouse's guards stay registered with ${LABEL}, and its sign-in start stays: ${n} other project${n === 1 ? '' : 's'} on this computer use${n === 1 ? 's' : ''} them`]
      : [
        `Wheelhouse's guards are no longer registered with ${LABEL}: ${hooks} is removed`,
        start === null
          ? 'There is no sign-in start to remove'
          : `What starts Wheelhouse's helper when you sign in is removed: ${start.kind === 'launch-agent' ? start.path : 'the start-up entry named Wheelhouse helper'}`,
      ]),
    removeState
      ? `Its Wheelhouse state, ${state}, is removed: what the helper recorded there goes, and the record files in the project stay, with what was written into them`
      : `Its Wheelhouse state stays in ${state}`,
  ];
  const hash = crypto.createHash('sha256').update(canonicalJson({ folder, project, changes })).digest('hex');
  return { project, folder, changes, lines, hash, others, hooks, state, removeState };
}

// uninstall({ folder, hash, removeState }, deps) -> { ok, lines } after the card's click: the project's git goes
// back into its folder and its Lean record goes, so the session start, the board and the guards treat it as Lean
// with git alone; the hook file and the sign-in start go when no other project needs them; the state goes only when
// the director chose it. Refused under STOP, and for a hash that isn't the card's.
export async function uninstall(answers = {}, deps = {}) {
  const d = defaults(deps);
  const plan = await planUninstall(answers, d);
  if (typeof answers.hash !== 'string' || answers.hash !== plan.hash) refuse(CHANGED);
  if (stopState().on) refuse(STOP_ON);
  const { project, folder } = plan;
  await withLocalLock(project, async () => {
    await releaseProject({ project, folder, run: d.run, now: d.now });
    unregisterLean(project);
    if (othersNeeding(project).length === 0) {
      fs.rmSync(plan.hooks, { force: true });
      if (loginStartRecord() !== null) {
        const got = await removeLoginStart({ run: d.regRun, platform: d.platform });
        if (!got.removed) {
          refuse(`The project's git is back in its folder and Wheelhouse's guards are no longer registered, but what starts Wheelhouse's helper when you sign in was not removed: ${got.why}${plan.removeState ? `. The project's Wheelhouse state was left in place too, in ${plan.state}` : ''}`);
        }
      }
    }
  }, d.lockWaitMs === undefined ? {} : { waitMs: d.lockWaitMs });
  // The lock's own file is in the state's folder, so the folder goes once the lock is freed.
  if (plan.removeState) fs.rmSync(plan.state, { recursive: true, force: true });
  return { ok: true, lines: plan.lines };
}

// The command line's flags, each with one value: --work-computer, --real-users and --remove-state take yes or no,
// --hash the card's hash, and --test the test command as one argument. `allowed` names the ones a command takes.
function parseFlags(rest, allowed) {
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [name, value] = [rest[i], rest[i + 1]];
    if (!allowed.includes(name) || value === undefined || Object.hasOwn(flags, name)) refuse(USAGE);
    flags[name] = value;
  }
  const yesNo = (value) => (value === 'yes' ? true : value === 'no' ? false : undefined);
  return {
    workComputer: yesNo(flags['--work-computer']),
    realUsers: yesNo(flags['--real-users']),
    removeState: yesNo(flags['--remove-state']),
    test: flags['--test'] ?? null,
    hash: flags['--hash'],
  };
}
const INSTALL_FLAGS = ['--work-computer', '--real-users', '--test'];

export async function main(argv = process.argv.slice(2), { stdout = process.stdout, cwd = process.cwd(), deps = {} } = {}) {
  const say = (lines) => stdout.write(`${lines.join('\n')}\n`);
  try {
    const [command, ...rest] = argv;
    if (command === 'start') {
      if (rest.length !== 0) refuse(USAGE);
      const got = await startAll(deps.startOptions ?? {});
      say([got.line]);
      return got.ok ? 0 : 1;
    }
    if (command === 'uninstall-plan') {
      const { removeState } = parseFlags(rest, ['--remove-state']);
      const plan = await planUninstall({ folder: cwd, removeState }, deps);
      say([...plan.lines.map((l) => `- ${l}`), `Hash: ${plan.hash}`]);
      return 0;
    }
    if (command === 'uninstall') {
      const { removeState, hash } = parseFlags(rest, ['--remove-state', '--hash']);
      const got = await uninstall({ folder: cwd, removeState, hash }, deps);
      say(got.lines);
      return 0;
    }
    if (command === 'plan') {
      const answers = parseFlags(rest, INSTALL_FLAGS);
      const plan = await planInstall({ folder: cwd, ...answers }, deps);
      say([...plan.lines.map((l) => `- ${l}`), `Hash: ${plan.hash}`]);
      return 0;
    }
    if (command === 'install') {
      const flags = parseFlags(rest, [...INSTALL_FLAGS, '--hash']);
      const got = await install({ folder: cwd, ...flags }, deps);
      say(got.lines);
      return got.ok ? 0 : 1;
    }
    refuse(USAGE);
  } catch (error) {
    say([error instanceof StartRefusal || error instanceof LeanRefusal ? error.message : `That did not work: ${String(error?.message ?? 'no reason given').replace(/\s+/g, ' ')}`]);
    return 1;
  }
  return 1;
}

if (startedAsScript(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
