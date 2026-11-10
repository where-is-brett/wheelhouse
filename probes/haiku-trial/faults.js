// probes/haiku-trial/faults.js
// The trial's faults: a wrong-shaped decision, a director's kind in the log, killed sessions, All stop, undo and lift, and
// the decisions the runner raises itself. Each takes its process list, runner and kill as arguments, so tests start nothing.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUCK_AFTER } from '../../scripts/feature/cli.js';
import { featurePaths, readQuestions } from '../../scripts/feature/files.js';
import fs from 'node:fs';
import { parsePs } from '../../scripts/engine/stop.js';
import { WORKTREE_PATH } from '../../scripts/engine/parts.js';
import { madeFeatureSlug } from '../../scripts/hooks/session-start.js';
import { recordedFeatureSessions } from './sessions.js';

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = (plugin) => path.join(plugin, 'scripts', 'feature', 'cli.js');

// `ps eww` shows each process's environment after its command; the engine's own listing leaves it out.
async function listWithEnv() {
  const got = spawnSync('ps', ['eww', '-A', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' });
  return got.status === 0 ? parsePs(got.stdout) : [];
}

// A process's real working folder. A session Wheelhouse starts gets its folder from the spawn call, which leaves PWD as the
// watcher had it, so the folder is read from the process itself (`lsof -d cwd` works on macOS and Linux).
export async function lsofCwd(pid) {
  const got = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  if (got.status !== 0) return null;
  return String(got.stdout).split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? null;
}

// The NAME=value words `ps eww` prints after a command. A value runs up to the next NAME=, so a path with spaces survives.
const variablesOf = (command) => Object.fromEntries(
  [...String(command).matchAll(/(?:^|\s)([A-Z_][A-Z0-9_]*)=([\s\S]*?)(?=\s[A-Z_][A-Z0-9_]*=|$)/g)].map((m) => [m[1], m[2].trim()]),
);
const isClaudePrint = (command) => /(^|[\s/])claude\s/.test(command) && /\s-p(\s|$)/.test(command);

// The `claude -p` processes, each as { pid, vars }.
async function printSessions(listProcesses) {
  return (await listProcesses()).filter((p) => isClaudePrint(p.command)).map((p) => ({ pid: p.pid, vars: variablesOf(p.command) }));
}

const inside = (folder, dir) => {
  const relative = path.relative(folder, dir);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
// The piece is the whole slug or one hyphen-delimited segment run of it, so p1 never matches p10.
const namesPiece = (slug, piece) => slug === piece || slug.startsWith(`${piece}-`) || slug.endsWith(`-${piece}`) || slug.includes(`-${piece}-`);

// The folders a feature's worktree can be in: Wheelhouse's own engine keeps them under .wheelhouse/worktrees; the front desk's
// feature command makes them under .claude/worktrees, one folder per work.
const WORKTREE_BASES = [WORKTREE_PATH, path.join('.claude', 'worktrees')];
// The work a worktree folder holds: the brief's own work when it matches the branch, else, for the front desk's layout, the
// name of the folder under the worktrees folder.
function workOf(base, cwd) {
  const made = madeFeatureSlug(cwd);
  if (made !== null) return made;
  return base.endsWith(path.join('.claude', 'worktrees')) ? path.relative(base, cwd).split(path.sep)[0] : null;
}

// A feature session is found two ways. By Wheelhouse's own record of it (watcher/running/feature-<work>.json, under the
// project's name): the recorded process, or the `claude -p` it started. Failing that, by a `claude -p` whose working folder
// (read from the process, not from PWD) is a worktree in one of the worktree folders and whose feature slug names the piece.
async function findFeature(project, piece, { listProcesses, cwdOf, name, recorded = recordedFeatureSessions }) {
  const rows = await listProcesses();
  const prints = rows.filter((p) => isClaudePrint(p.command)).map((p) => ({ pid: p.pid, ppid: p.ppid, vars: variablesOf(p.command) }));
  if (typeof name === 'string' && name !== '') {
    for (const r of recorded(name)) {
      if (!namesPiece(r.work, piece)) continue;
      const own = prints.find((p) => p.pid === r.pid) ?? prints.find((p) => p.ppid === r.pid);
      const pid = own?.pid ?? r.pid;
      const cwd = (await cwdOf(pid)) ?? path.join(project, '.claude', 'worktrees', r.work);
      return { pid, vars: own?.vars ?? {}, cwd };
    }
  }
  for (const session of prints) {
    const cwd = await cwdOf(session.pid);
    if (typeof cwd !== 'string') continue;
    for (const rel of WORKTREE_BASES) {
      const base = path.join(project, rel);
      if (!inside(base, cwd)) continue;
      const slug = workOf(base, cwd);
      if (slug !== null && namesPiece(slug, piece)) return { pid: session.pid, vars: session.vars, cwd };
    }
  }
  throw new Error(`No running feature session in ${project} names "${piece}"`);
}

// The variables a stand-in command needs: PATH and HOME (git needs both) and the rest of what the session has, whose
// WHEELHOUSE_* names are what make the feature command act as that session.
export function sessionEnv(vars, base = process.env) {
  const own = Object.fromEntries(Object.entries(vars).filter(([name, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && typeof value === 'string' && value !== ''));
  const kept = {};
  for (const name of ['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR']) if (typeof base[name] === 'string') kept[name] = base[name];
  return { ...kept, ...own };
}

// A feature session's environment and its worktree, read from its process.
export async function featureEnvOf({ project, piece, name, recorded, listProcesses = listWithEnv, cwdOf = lsofCwd }) {
  const { vars, cwd } = await findFeature(project, piece, { listProcesses, cwdOf, name, recorded });
  return { env: sessionEnv(vars), cwd };
}

const feature = (plugin, args, { env, cwd, run }) => run(process.execPath, [CLI(plugin), ...args], { env, cwd, encoding: 'utf8' });
const said = (got) => `${got.stdout ?? ''}${got.stderr ?? ''}`;

const WRONG_SHAPE = [
  'ask', '--what', 'Trial check: is this question the right shape?', '--why', 'The trial is checking that a wrong shape is sent back',
  '--option', 'A=Yes', '--recommend', 'A', '--level', '2',
];

function f1WrongShape({ env, cwd, run = spawnSync, plugin = PLUGIN }) {
  const got = feature(plugin, WRONG_SHAPE, { env, cwd, run });
  return { code: got.status, sentBack: got.status === 2, stdout: said(got) };
}

export const STUCK_WHY = 'Trial check: the question keeps coming back in the wrong shape';

// The same wrong shape again until the session is told to stop and say it is stuck (never more than STUCK_AFTER tries), then
// the plain message the command asks for, which also starts the count of failed tries again.
function f1bStuck({ env, cwd, run = spawnSync, plugin = PLUGIN }) {
  const tries = [];
  for (let i = 0; i < STUCK_AFTER; i += 1) {
    const got = feature(plugin, WRONG_SHAPE, { env, cwd, run });
    const stuck = /stuck --why/.test(said(got));
    tries.push({ code: got.status, stuck });
    if (stuck) {
      const told = feature(plugin, ['stuck', '--why', STUCK_WHY], { env, cwd, run });
      return { tries, stuckAt: tries.length, why: STUCK_WHY, stuckCode: told.status };
    }
  }
  return { tries, stuckAt: null };
}

function f1cDirectorKind({ env, cwd, run = spawnSync, plugin = PLUGIN }) {
  const got = feature(plugin, ['log', '--kind', 'behaviour', '--decided', 'Trial check', '--option', 'A', '--option', 'B', '--why', 'The trial is checking the refusal'], { env, cwd, run });
  return { code: got.status, text: said(got) };
}

async function f3KillFeature({ project, piece, name, recorded, listProcesses = listWithEnv, cwdOf = lsofCwd, kill = process.kill }) {
  const { pid } = await findFeature(project, piece, { listProcesses, cwdOf, name, recorded });
  kill(pid, 'SIGKILL');
  return { pid };
}

async function f3bKillForeman({ listProcesses = listWithEnv, kill = process.kill }) {
  const found = (await printSessions(listProcesses)).find((s) => s.vars.WHEELHOUSE_ROLE === 'foreman');
  if (found === undefined) throw new Error('No running foreman session');
  kill(found.pid, 'SIGKILL');
  return { pid: found.pid };
}

const DESK = 'desk';
const f6AllStop = (tmux, name = DESK) => tmux.type(name, 'all stop');
const undoTyped = (tmux, sha, name = DESK) => tmux.type(name, `undo ${sha}`);
const liftTyped = (tmux, name = DESK) => tmux.type(name, 'lift all stop');

// The flags of a right-shaped decision with two options, each with its cost and whether it can be undone.
const shaped = ({ what, why, options, recommend, because, meanwhile }) => [
  'ask', '--what', what, '--why', why, '--about', 'behaviour', '--level', '3',
  ...options.flatMap(([label, says]) => ['--option', `${label}=${says}`]),
  ...options.flatMap(([label, , cost, undo]) => ['--cost', `${label}=${cost}`, '--undo', `${label}=${undo}`]),
  '--recommend', recommend, '--because', because, '--meanwhile', meanwhile,
];

export const FALLBACK_QUESTION = 'Should moving one transaction also make a rule for that shop?';

const FALLBACK = shaped({
  what: FALLBACK_QUESTION,
  why: 'It changes what the director sees on the next import',
  options: [['Rule', 'Make a rule for that shop', 'An hour of building', 'yes'], ['One only', 'Move just that transaction', 'No extra work', 'yes']],
  recommend: 'One only', because: 'It is the smallest change and the director can ask for rules later', meanwhile: 'I build the parts that do not depend on it',
});

const SECOND = shaped({
  what: 'Trial check: should the export include the category column?',
  why: 'It decides what the director finds in the downloaded file',
  options: [['Include', 'Add the category column', 'A few minutes', 'yes'], ['Leave out', 'Keep the three original columns', 'No extra work', 'yes']],
  recommend: 'Include', because: 'The director can then sort the file by category', meanwhile: 'I build the parts that do not depend on it',
});

// Raises P4's behaviour decision in P4's environment, unless its questions already hold this question.
function decisionFallback({ env, cwd, run = spawnSync, plugin = PLUGIN }) {
  let raised = false;
  try {
    raised = readQuestions(featurePaths(cwd).questions).questions.some((q) => q.what === FALLBACK_QUESTION);
  } catch { /* nothing readable counts as nothing raised */ }
  if (raised) return { raised: false, skipped: true };
  const got = feature(plugin, FALLBACK, { env, cwd, run });
  return { raised: got.status === 0, code: got.status, stdout: said(got) };
}

// A second, right-shaped decision, so that a bare `A` is ambiguous between it and the first.
function secondDecision({ env, cwd, run = spawnSync, plugin = PLUGIN }) {
  const got = feature(plugin, SECOND, { env, cwd, run });
  return { code: got.status, stdout: said(got) };
}

const THIRD = shaped({
  what: 'Trial check: should the month page show a count of transactions?',
  why: 'It decides what the director sees on each month',
  options: [['Show it', 'Add the count beside the grand total', 'A few minutes', 'yes'], ['Leave it', 'Keep the page as it is', 'No extra work', 'yes']],
  recommend: 'Leave it', because: 'The page already shows what the director asked for', meanwhile: 'Nothing waits on it',
});

// The decision the director answers by typing in the chat at the end of the trial (spec section 9 step 7), in P4's environment.
function thirdDecision({ env, cwd, run = spawnSync, plugin = PLUGIN }) {
  const got = feature(plugin, THIRD, { env, cwd, run });
  return { code: got.status, stdout: said(got) };
}

// The review card as a decision: its title, why, options (each with its cost and undo), recommendation, because and meanwhile.
function reviewDecision({ env, cwd, card, run = spawnSync, plugin = PLUGIN }) {
  const got = feature(plugin, shaped({
    what: card.what, why: card.why,
    options: card.options.map((o) => [o.label, o.says, o.cost, o.undo]),
    recommend: card.recommend, because: card.because, meanwhile: card.meanwhile,
  }), { env, cwd, run });
  return { code: got.status, stdout: said(got) };
}

// How many of a session's own tries were sent back, from its questions.jsonl; null when it cannot be read.
function naturalSendBacks({ cwd }) {
  try {
    return fs.readFileSync(featurePaths(cwd).questions, 'utf8').split('\n').filter(Boolean).filter((l) => { try { return JSON.parse(l).sentBack === true; } catch { return false; } }).length;
  } catch (error) { return error.code === 'ENOENT' && fs.existsSync(cwd) ? 0 : null; }
}

export const faults = {
  f1WrongShape, f1bStuck, f1cDirectorKind, f3KillFeature, f3bKillForeman, f6AllStop, undoTyped, liftTyped, decisionFallback, secondDecision,
  thirdDecision, reviewDecision, naturalSendBacks,
};
