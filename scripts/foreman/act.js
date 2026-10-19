// scripts/foreman/act.js
// The foreman's commands (ruling R63), one for each step of its playbook, run
// from the project's main checkout as `node act.js <command> <work> …`:
//
//   start <work> --goal <text> --done <line>… --appetite-sessions <n>
//         --appetite-tokens <n> [--ruling <id>…] [--plan <path>] [--slices <n>]
//       Opens the work's session. In order: the worktree
//       <checkout>/.claude/worktrees/<work> on a branch feature/<work> made
//       now from the default branch, with git in the main checkout (a branch
//       or folder there already is refused, and so is a repository config
//       that sets a filter or an include, ruling R93); `.wheelhouse/` kept
//       out of git through info/exclude; the brief written; a `feature` event
//       `started` recorded with the brief's hash (a first brief is written
//       before its hash is recorded, ruling R41); the session started through
//       the waker (under Shape 2 the waker's START line is passed on).
//       `--plan` is only for a plan the foreman knows is in the repository
//       already; a session records its own with `cli.js plan` (ruling R87).
//       On Windows the brief says how to run build commands at the level this
//       computer reads (design section 12.2).
//       Work whose feature closed and that a `work` event queued again since
//       (ruling R102) starts afresh in the worktree and branch its closed
//       feature recorded, with the ended run's status files set aside.
//   plan-ready <work>   records the feature's plan (the brief's, or the one
//       the session recorded) and its files (`planned`), then the go-ahead
//       (`building`) when it clears. When the slice in hand has merged and
//       this is the next slice's plan, the slice moves on by one (R88).
//       While the feature's own pull request (pr.json) is not merged, it
//       waits and records nothing: the merge raises plan-ready again. The
//       plan is read only through the brief the foreman recorded: a brief the
//       session changed is refused.
//   build <work>    the go-ahead for a recorded plan whose wait has cleared;
//       it waits, too, while the feature's own pull request is open.
//   `start --plan` is refused with `--slices` above 1: the brief's plan would
//       stand in for every slice's.
//   pause <work>    a pause for the five-hour window (`pausedFor: five-hour`).
//   resume <work>   lifts such a pause. A pause the director's amendment made
//       (`pausedFor: director`) is lifted only by their amendment beginning
//       "Resume"; `build` and `resume` refuse it.
//   question <work> <questionId>      the feature's question, into state. On
//       Windows, outside a Locked project and below Unattended, a feature's third
//       build-command question that day (the computer's own date) is followed by
//       the Unattended card, once a day: a setting event proposing Unattended for
//       this computer, then the card whose line confirms that one event.
//   extra-plan <work> <questionId>    the extra plan, queued as work.
//   ask <work> --what … --why … --option "<label>=<says>"… --recommend <label> --level <n>
//       The foreman's own question for the director.
//   amend <work> <hash>   applies the director's approved amendment with that
//       hash; each wake names its own, so several are applied in turn. Work
//       not started yet needs nothing: the start reads the amended document.
//   merge <work>    brings the pull request up to date, merges it, marks the
//       merge in pr.json and writes the feature's status again, as its status
//       hook would, so the watcher sees it move to the next slice or to done.
//       When bringing it up to date made a new head, it stops there: the merge
//       waits for CI on that commit, and the next merge-ready wakes the foreman.
//       When all the gate lacks is a click of the director's (their approval of
//       the head, or their push of an update that changes a CI file), it records
//       a `gate-asks` event once for that click and commit, and waits: the
//       watcher wakes the foreman once the click is on record (ruling R117).
//   close <work>    records the report and closes the feature. Work that ended
//       partial or blocked is put to the director (ruling R102), and it ends
//       by saying to read the wake again: a slot or a dependency may be free.
//
// STOP and incidents (ruling R95). While STOP is on or an incident is open,
// `start`, `build` and `resume` refuse, and `plan-ready` records the plan as
// planned and waits, so the queue offers `build` once it is over; nothing is
// given the go-ahead, an amendment's resume included. During an incident (not
// under STOP) bug work is the exception: it starts and builds (ruling R101).
// `merge` refuses but for an open incident's recorded fix, and under STOP
// refuses that too.
//
// The command forwards to the host helper (ruling R156, scripts/foreman/forward.js):
// the foreman's session is sandboxed, and these commands read and write the
// Wheelhouse home, so the helper runs `main` outside the sandbox, in the main checkout.
//
// Every command checks the work id, prints a few short lines, and refuses
// with one plain line and exit code 1. Each may be run again with nothing
// more done (a wake may repeat, ruling R27): it says what is so already.
//
// Writing state. Every event goes through the helper's /state/write with an
// id made here, and that id is recorded in the watcher's handled list
// (scripts/watcher/handled.js) before the write, so the foreman's own
// records never wake it (R64). The list has no lock of its own: the helper's
// /foreman/run runs a project's foreman commands one at a time, so a retry
// waits for the first to end. A `feature` event replaces the last one in the
// features view, so each carries the feature's worktree, branch, plan, files
// and slice forward. Only `start` and `amend` carry `brief`: a `building`
// event without it is the session's go-ahead (`build`, ruling R85), and one
// with it records an amendment's hash at the feature's own step.
//
// Which work may build (ruling R60, as wake.js works it out): a plan builds
// when it clashes with no running feature's recorded files or the hot files,
// and nextWork, counting only work that can build now, gives it a slot.
// Small or feature work held for pace or a dependency may still start, so its
// session plans while it waits. Quick and bug work have no plan: they start
// only when nextWork gives them a slot (ruling R89).
//
// Pausing and resuming (ruling R80). An amendment whose change begins with
// the word "Pause" pauses the feature, and one that begins with "Resume"
// resumes it; the brief is not changed. Any other amendment changes the
// brief: the amended brief's hash is recorded first, at the feature's own step, then the
// file is written (R41), so the watcher reads `brief-changed`, not tampering.
// The amendment's date is its click's, so running it again makes the same text.
//
// The foreman's own questions use ids `q-<work>-<n>` with n from
// FOREMAN_QUESTIONS (one million) up. A feature's own ids count up from 1
// (scripts/feature/cli.js), and `question` refuses any from one million up,
// so the two never meet. The answer still names the work (core.js's
// workOfQuestion), so it wakes that feature's session too.
//
// Git runs only in the main checkout, to make the worktree, with hooks and
// fsmonitor off. Everything read from a worktree goes through the safe
// readers of scripts/feature/files.js and status.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN_ROOT } from './tools.js';
import {
  ForemanError, NO_PLAN, PLANS_WHILE_HELD, SAYS_CHARS, TamperedBrief, checkoutOf, clashFor, featureOf, haltFor, haltOf, laneOf, loadConfig, loadViews, oneLine,
  openPrWait, pausedBy, planOf, projectHere, queueToStart, queuedAgain, recordedBriefOf, slotFor, stateEvents, waitText, whyText, worktreeOf,
} from './wake.js';
import { questionProblem } from '../cards/compose.js';
import { amendBrief, renderBrief } from '../feature/brief.js';
import { report as reportCheck } from '../feature/cli.js';
import {
  briefHash, ensureIgnored, featurePaths, parseBrief, parseReport, readQuestions, readStatus, writeStatus,
} from '../feature/files.js';
import {
  buildStatus, loadFeature, readCapped, readPrRecord, safeFeatureFolder, validSlice, writeWhole,
} from '../feature/status.js';
import { cardProblems } from '../hooks/card-check.js';
import { sameStatus } from '../hooks/feature-status.js';
import { lockedByPath } from '../hooks/kit.js';
import { branchOf } from '../hooks/session-start.js';
import { forward } from './forward.js';
import { helperClient } from '../host/helper-client.js';
import { FOREMAN_QUESTIONS, HASH, SLUG, questionIdOf } from '../lib/build-loop.js';
import { CARD } from '../lib/front-desk.js';
import { canonicalJson } from '../lib/canonical.js';
import { computerId, wheelhouseHome } from '../lib/paths.js';
import { run as runProgram, withoutGitVars } from '../lib/run.js';
import {
  GUARDED_SETTING_WORDS, UNATTENDED_CARD, buildsLevel, isBuildQuestion, settingKey,
} from '../protection/windows-builds.js';
import { confirmLine, replyCode, replyCodeLine, unattendedBuildsLine } from '../state/card-lines.js';
import { readEnrolled, verify } from '../state/signing.js';
import { recordHandled } from '../watcher/handled.js';
import { recordedBriefs } from '../watcher/sources.js';
import { makeWaker, sessionFile } from '../watcher/waker.js';
import { guardedCardInput, guardedCommand, readSelfTest } from '../windows/low.js';

// The first number of the foreman's own question ids.
export { FOREMAN_QUESTIONS };

const NULL_FILE = '/dev/null';
const BRIEF_BYTES = 1024 * 1024;
const REPORT_BYTES = 1024 * 1024;
const GIT_MS = 2 * 60 * 1000;
const CONFIG_BYTES = 1024 * 1024;
// What each `feature` event carries forward from the one before.
const CARRIED = Object.freeze(['worktree', 'branch', 'session', 'plan', 'files', 'slice']);
const BASE_REF = /^refs\/remotes\/origin\/[A-Za-z0-9._/-]+$/;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const refuse = (message) => { throw new ForemanError(message); };
const short = (h) => (typeof h === 'string' && h !== '' ? h.slice(0, 12) : 'unknown');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const same = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const refusal = (answer) => oneLine(typeof answer?.refused === 'string' ? answer.refused : 'the helper gave no answer', 240);

function lstatOf(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// --- Reading the arguments ---

// The flags in `argv` as `{ name: [values] }`; each takes a value.
function flagsOf(argv, allowed, command) {
  const found = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (typeof flag !== 'string' || !flag.startsWith('--')) refuse(`Unexpected "${oneLine(flag, 60)}": every value comes after a flag such as --goal`);
    const name = flag.slice(2);
    if (!allowed.includes(name)) refuse(`${oneLine(flag, 60)} is not a flag ${command} takes`);
    if (i + 1 >= argv.length) refuse(`${flag} needs a value`);
    i += 1;
    (found[name] ??= []).push(argv[i]);
  }
  return found;
}

function single(found, name) {
  const values = found[name];
  if (values === undefined) return undefined;
  if (values.length > 1) refuse(`--${name} is given once`);
  return values[0];
}

function needed(found, name) {
  const value = single(found, name);
  if (value === undefined || value.trim() === '') refuse(`--${name} is needed`);
  return value.trim();
}

function wholeNumber(found, name, what) {
  const value = needed(found, name);
  if (!/^[0-9]{1,12}$/.test(value) || Number(value) < 1) refuse(`--${name} is a whole number of ${what}, from 1`);
  return Number(value);
}

// The options of a question, as cli.js's ask reads them.
function optionsOf(found, recommendation) {
  const options = (found.option ?? []).map((text) => {
    const at = text.indexOf('=');
    const label = at < 0 ? '' : text.slice(0, at).trim();
    if (label === '') refuse(`--option "${oneLine(text, 60)}" is written as "<label>=<what it means>"`);
    const says = text.slice(at + 1).trim();
    // Wake read prints an option's words whole on one line, so a command in them is never cut.
    if (says === '') refuse(`--option "${oneLine(text, 60)}" says nothing after its "="`);
    if (/[^\S ]| {2}/.test(says) || says.length > SAYS_CHARS) {
      refuse(`--option "${label}" must say what it means on one line, with single spaces, in at most ${SAYS_CHARS} characters`);
    }
    return { label, says };
  });
  if (options.length < 2) refuse('Give two or more options, each with --option "<label>=<what it means>"');
  if (new Set(options.map((o) => o.label)).size !== options.length) refuse('Each option needs its own label');
  if (!options.some((o) => o.label === recommendation)) refuse(`--recommend must be the label of one option (${options.map((o) => o.label).join(', ')})`);
  return options;
}

// --- Where things stand, and writing to state ---

function context({ project, client, now, run, wakerFor, pluginRoot, makeId, out, platform, isLocked }) {
  let views = null;
  let config = null;
  const ctx = {
    project, client, now, run, pluginRoot, platform, isLocked,
    say: (line) => out(`${line}\n`),
    async views() {
      views ??= (await loadViews(project, client)).views;
      return views;
    },
    async config() {
      config ??= await loadConfig(project, client);
      return config;
    },
    waker: (cfg) => wakerFor(cfg, (line) => out(`${line}\n`)),
    // STOP, or an open incident: what holds back every start and go-ahead (R95),
    // though during an incident bug work goes on (R101). `lane` is the work's.
    halt: (v, lane) => (lane === undefined ? haltOf(v) : haltFor(haltOf(v), lane)),
    // Refuses a start or a go-ahead for work in `lane` while either holds.
    refuseHalted(v, what, lane) {
      const halt = haltFor(haltOf(v), lane);
      if (halt !== null) refuse(`${what} while ${halt.why}: start nothing and give no go-ahead. Nothing to do until it is over`);
    },
    // Records the id as handled, then writes the event through the helper, and
    // lays it over the views this command reads.
    async write(kind, data) {
      const id = makeId();
      recordHandled(project, [id], { now });
      let answer;
      try {
        answer = await client.state.write({ project, kind, data, id });
      } catch {
        answer = null;
      }
      if (answer?.ok !== true) refuse(`The ${kind} record wasn't written: ${refusal(answer)}`);
      if (views !== null && kind === 'feature') views.features[data.work] = { key: data.work, id, at: now().toISOString(), data };
      return id;
    },
  };
  return ctx;
}

// The feature as recorded, refusing one that is not there or has closed.
function liveFeature(views, work) {
  const f = featureOf(views, work);
  if (f === null) refuse(`${work} has no feature recorded`);
  if (f.step === 'closed') refuse(`${work} is closed`);
  return f;
}

// What a feature event carries forward from `f`.
function carried(f) {
  const out = { work: f.work };
  for (const key of CARRIED) if (f[key] !== undefined) out[key] = f[key];
  return out;
}

const GO = (work) => `${work} may build: recorded building, so its session is woken with build.`;

// Records `building` when the feature's recorded plan clears the clash check
// and has a slot; otherwise says why it waits. `f` is the feature as it stands.
async function goAhead(ctx, work, f, { lead = '' } = {}) {
  const views = await ctx.views();
  const halt = ctx.halt(views, laneOf(views, work));
  if (halt !== null) {
    ctx.say(`${lead}${work} waits: ${halt.why}.`);
    return false;
  }
  const config = await ctx.config();
  const clash = clashFor(views, config, work, Array.isArray(f.files) ? f.files : []);
  const wait = waitText(clash, slotFor(views, work, { now: ctx.now }));
  if (wait !== null) {
    ctx.say(`${lead}${work} waits: ${wait}.`);
    return false;
  }
  await ctx.write('feature', { ...carried(f), step: 'building' });
  ctx.say(`${lead}${GO(work)}`);
  return true;
}

// --- start ---

// Makes each of `parts` under `root` a real folder, never a link.
function realFolders(root, parts) {
  let dir = root;
  for (const part of parts) {
    dir = path.join(dir, part);
    const stat = lstatOf(dir);
    if (stat !== null && !stat.isDirectory()) refuse(`${dir} isn't a real folder`);
    if (stat === null) fs.mkdirSync(dir);
  }
  return dir;
}

// The sections of the repository's own git configuration that could run a
// program, or read more configuration, when git checks out the worktree
// (ruling R93): a smudge filter an agent set would run in the foreman's git.
const RISKY_SECTIONS = Object.freeze(['filter', 'include', 'includeif']);

// Refuses when <checkout>/.git/config (or its config.worktree) holds a
// filter.*, include.* or includeIf.* key, read with fs, never with git.
function checkRepoConfig(checkout) {
  // A `.git` file (a linked checkout or a submodule) keeps its config elsewhere: refused, not followed.
  if (!lstatOf(path.join(checkout, '.git'))?.isDirectory()) refuse("The main checkout's .git isn't a folder of its own, so its config can't be checked and no worktree was made");
  for (const name of ['config', 'config.worktree']) {
    const file = path.join(checkout, '.git', name);
    const stat = lstatOf(file);
    if (stat === null) continue;
    const text = stat.isFile() ? readCapped(file, CONFIG_BYTES) : null;
    if (text === null) refuse(`The repository's .git/${name} can't be read, so no worktree was made`);
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*\[\s*([A-Za-z0-9.-]+)/.exec(line);
      const section = m?.[1].split('.')[0].toLowerCase();
      if (section !== undefined && RISKY_SECTIONS.includes(section)) {
        refuse(`The repository's .git/${name} sets ${m[1]}, which git would act on while making the worktree; no worktree was made: ask the director`);
      }
    }
  }
}

// The worktree on a branch made now from the default branch, in the main
// checkout. A feature/<work> branch or worktree folder that is there already
// was not made by a recorded start (a recorded feature never reaches here), so
// it is refused, never reused: an agent can make branches in the shared repository.
async function makeWorktree(ctx, work, checkout, worktree, branch) {
  const git = (args) => ctx.run('git', ['-c', `core.hooksPath=${NULL_FILE}`, '-c', 'core.fsmonitor=false', ...args], {
    cwd: checkout,
    baseEnv: withoutGitVars(process.env),
    env: {
      GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE, GIT_NO_REPLACE_OBJECTS: '1',
    },
    timeoutMs: GIT_MS,
  });
  realFolders(checkout, ['.claude', 'worktrees']);
  if (lstatOf(worktree) !== null) refuse(`${worktree} is there already, but no recorded feature made it: ask the director`);
  checkRepoConfig(checkout);
  const head = await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const base = String(head.stdout ?? '').trim();
  if (head.code !== 0 || !BASE_REF.test(base) || base.includes('..')) {
    refuse("The main checkout doesn't name its default branch (refs/remotes/origin/HEAD), so no worktree was made");
  }
  const kept = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (kept.code === 0) refuse(`The branch ${branch} is there already, but no recorded feature made it: ask the director`);
  const made = await git(['worktree', 'add', '--quiet', '--no-track', '-b', branch, worktree, base]);
  if (made.code !== 0) refuse(`git couldn't make the worktree: ${oneLine(made.stderr || made.stdout || 'no reason given', 200)}`);
}

// The files of an ended run that the status reads, set aside when the work starts again.
const ENDED_FILES = Object.freeze(['report.md', 'pr.json', 'plan.json', 'status.json', 'checked.json']);

// Work queued again after its feature closed (ruling R102) starts in the
// worktree and on the branch its closed feature recorded, so its session
// carries on from what the ended run left (a bug's reproduction test, say).
// Both must be the ones a start makes, and still there as they were left;
// otherwise it is refused. What the ended run kept for the status (its report,
// pull request, plan, status and the hook's stamp) is moved to
// ended/<n>/ in the feature folder, so the status starts again from nothing;
// questions and rulings stay, so question ids keep counting up and no ruling
// is lost. Returns the folder they went to, or null when there was nothing.
function reuseWorktree(work, existing, worktree, branch) {
  if (existing.worktree !== worktree || existing.branch !== branch) {
    refuse(`${work}'s closed feature recorded another worktree or branch, so it can't start again there: ask the director`);
  }
  if (!lstatOf(worktree)?.isDirectory() || !safeFeatureFolder(worktree)) refuse(`${work}'s worktree ${worktree} isn't there as its feature left it: ask the director`);
  if (branchOf(worktree) !== branch) refuse(`${work}'s worktree isn't on ${branch}: ask the director`);
  const dir = featurePaths(worktree).dir;
  const files = ENDED_FILES.filter((name) => lstatOf(path.join(dir, name)) !== null);
  if (files.length === 0) return null;
  let n = 1;
  while (lstatOf(path.join(dir, 'ended', String(n))) !== null) n += 1;
  const into = realFolders(dir, ['ended', String(n)]);
  for (const name of files) fs.renameSync(path.join(dir, name), path.join(into, name));
  return into;
}

async function startSession(ctx, work, worktree, config) {
  let started;
  try {
    started = await ctx.waker(config).startFeature({ work, worktree });
  } catch (error) {
    refuse(`The ${work} session wasn't started: ${oneLine(error instanceof Error ? error.message : 'unknown error', 200)}`);
  }
  if (started?.printed !== true) ctx.say(`Started the ${work} session.`);
}

async function start(ctx, work, rest) {
  const found = flagsOf(rest, ['goal', 'done', 'appetite-sessions', 'appetite-tokens', 'ruling', 'plan', 'slices'], 'start');
  const views = await ctx.views();
  const entry = views.work[work];
  if (!isPlain(entry?.work?.data)) refuse(`There is no work named ${work} in state`);
  const lane = entry.work.data.lane;
  ctx.refuseHalted(views, `${work} can't start`, lane);
  const config = await ctx.config();

  const existing = featureOf(views, work);
  // A feature that closed before the work was recorded again starts afresh (R102).
  const again = existing !== null && queuedAgain(views, work);
  if (existing !== null && !again) {
    // Recorded, but stopped before its session began (STOP, say): start the session only.
    if (existing.step === 'started' && config.watcherShape !== 2 && lstatOf(sessionFile(ctx.project, work)) === null) {
      const worktree = worktreeOf(ctx.project, views, work);
      ctx.say(`${work} was started already, but its session had not begun.`);
      await startSession(ctx, work, worktree, config);
      return;
    }
    ctx.say(`${work} was started already (it is at ${existing.step}).`);
    return;
  }

  // The brief's fields, all checked before anything is made.
  const goal = needed(found, 'goal');
  const done = (found.done ?? []).map((d) => d.trim()).filter((d) => d !== '');
  if (done.length === 0) refuse('Give the done contract: --done "<line>", once for each line');
  const appetite = { sessions: wholeNumber(found, 'appetite-sessions', 'sessions'), tokens: wholeNumber(found, 'appetite-tokens', 'tokens') };
  const rulings = [...new Set(found.ruling ?? [])].map((id) => {
    const r = views.rulebook.find((x) => x?.id === id);
    if (!r || r.status !== 'accepted') refuse(`${oneLine(id, 60)} is not an accepted ruling in the rulebook`);
    return { id, words: String(r.words ?? '') };
  });
  const plan = single(found, 'plan')?.trim();
  const slicesText = single(found, 'slices');
  if (slicesText !== undefined && !/^[1-9][0-9]{0,3}$/.test(slicesText)) refuse('--slices is a whole number of slices, from 1');
  const slices = slicesText === undefined ? undefined : Number(slicesText);
  // The brief's plan comes before the one the session records, so a brief that
  // named one could never move on to slice 2 (R87, R88).
  if (plan && slices > 1) refuse('--plan names one plan, so it can\'t be given for work in several slices: each slice\'s plan is recorded by its session');
  const routing = Object.fromEntries(Object.entries(config.routing ?? {}).filter(([, m]) => typeof m === 'string' && m !== ''));
  const fields = {
    v: 1, work, lane, version: 1, goal, done, appetite, rulings, routing, shownFirst: entry.approval?.shownFirst === true,
    ...(plan ? { plan } : {}), ...(slices ? { slices } : {}),
  };
  let text;
  try {
    text = renderBrief({ fields, pluginRoot: ctx.pluginRoot, windowsBuilds: windowsBuildsOf(ctx, views, config) });
  } catch (error) {
    refuse(`The brief can't be written: ${oneLine(error.message, 200)}`);
  }

  // The queue: work it lets start, or small or feature work held for pace or a dependency (R60, R89).
  const q = queueToStart(views, { now: ctx.now });
  let held = null;
  if (!q.start.includes(work)) {
    const why = q.hold.find((h) => h.work === work)?.why ?? 'unknown';
    if (!(['pace', 'dependency'].includes(why) && PLANS_WHILE_HELD.includes(lane))) refuse(`${work} can't start: ${whyText(why)}`);
    held = why;
  }

  const checkout = checkoutOf(ctx.project);
  const worktree = path.join(checkout, '.claude', 'worktrees', work);
  const branch = `feature/${work}`;
  if (again) {
    const set = reuseWorktree(work, existing, worktree, branch);
    ctx.say(`${work} closed and was queued again: it starts afresh in its worktree ${worktree} on ${branch}${set === null ? '' : `, with what the run before left for its status set aside in ${set}`}.`);
  } else {
    await makeWorktree(ctx, work, checkout, worktree, branch);
    ctx.say(`Made the worktree ${worktree} on ${branch}.`);
  }
  try {
    ensureIgnored(worktree, { mainCheckout: checkout });
  } catch (error) {
    refuse(oneLine(error.message, 200));
  }
  realFolders(worktree, ['.wheelhouse', 'feature']);
  if (!safeFeatureFolder(worktree)) refuse("The worktree's feature folder isn't a real folder inside it");
  writeWhole(featurePaths(worktree).brief, text);
  const hash = briefHash(text);
  await ctx.write('feature', { work, step: 'started', worktree, branch, brief: hash, ...(slices ? { slice: { n: 1, m: slices } } : {}) });
  ctx.say(`Wrote the brief (version 1, ${short(hash)}) and recorded ${work} as started.`);
  if (held !== null) ctx.say(`It is held (${whyText(held)}), so its session plans and then waits.`);
  await startSession(ctx, work, worktree, config);
}

// --- plan-ready, build, pause, resume ---

// The next slice, when the slice in hand has merged (pr.json marks the merge of
// the plan the feature recorded) and this is another plan; otherwise undefined.
function nextSlice(worktree, f, plan) {
  const s = f.slice;
  if (!isPlain(s) || !Number.isInteger(s.n) || !Number.isInteger(s.m) || s.n >= s.m) return undefined;
  const kept = readPrRecord(worktree);
  return kept?.merged === true && kept.plan !== null && kept.plan === f.plan && plan !== f.plan ? { n: s.n + 1, m: s.m } : undefined;
}

// What a paused event keeps from the pause before it: why it was paused.
const pausedFields = (f) => (f.step === 'paused' ? { pausedFor: pausedBy(f) } : {});

async function planReady(ctx, work, rest) {
  flagsOf(rest, [], 'plan-ready');
  const views = await ctx.views();
  const f = liveFeature(views, work);
  const lane = laneOf(views, work);
  if (NO_PLAN.includes(lane)) refuse(`${work} is ${lane} work, which has no plan`);
  const worktree = worktreeOf(ctx.project, views, work);
  let read;
  try {
    // Only from the brief the foreman recorded: a plan is never taken from one the session changed.
    read = planOf(worktree, { recorded: recordedBriefOf(ctx.project, work) });
  } catch (error) {
    if (error instanceof TamperedBrief) refuse(`${work}: ${error.message}, so its plan was not read: ask the director`);
    if (error instanceof ForemanError) refuse(`${work}'s plan can't be read: ${error.message}`);
    throw error;
  }
  const slice = nextSlice(worktree, f, read.plan);
  const unchanged = f.plan === read.plan && same(f.files, read.files) && slice === undefined;
  if (f.step === 'building' && unchanged) {
    ctx.say(`${work} is building this plan already. Nothing to do.`);
    return;
  }
  // The slice in hand's pull request is still open: the next plan waits, unrecorded,
  // so the slice can move on once it merges (R88).
  const ownPr = openPrWait(worktree);
  if (ownPr !== null) {
    ctx.say(`${work} waits: ${ownPr}.`);
    return;
  }
  const data = { ...carried(f), plan: read.plan, files: read.files, ...(slice ? { slice } : {}) };
  const recordedLine = `Recorded the plan of ${work}: ${oneLine(read.plan, 120)}, ${plural(read.files.length, 'file')}.`;
  if (f.step === 'paused') {
    if (!unchanged) {
      await ctx.write('feature', { ...data, step: 'paused', ...pausedFields(f) });
      ctx.say(recordedLine);
    }
    ctx.say(`${work} is paused: its plan waits until it is resumed.`);
    return;
  }
  if (!(f.step === 'planned' && unchanged)) {
    await ctx.write('feature', { ...data, step: 'planned' });
    ctx.say(recordedLine);
  }
  await goAhead(ctx, work, { ...data, step: 'planned' });
}

async function build(ctx, work, rest) {
  flagsOf(rest, [], 'build');
  const views = await ctx.views();
  const f = liveFeature(views, work);
  const lane = laneOf(views, work);
  if (f.step === 'building') {
    ctx.say(`${work} is building already.`);
    return;
  }
  if (f.step === 'started') {
    refuse(NO_PLAN.includes(lane) ? `${work} is ${lane} work: it builds as soon as it starts` : `${work} has no plan recorded yet: act plan-ready ${work} records it`);
  }
  refuseDirectorsPause(work, f);
  ctx.refuseHalted(views, `${work} can't build`, lane);
  const ownPr = openPrWait(worktreeOf(ctx.project, views, work));
  if (ownPr !== null) {
    ctx.say(`${work} waits: ${ownPr}.`);
    return;
  }
  await resumeOrBuild(ctx, work, f, lane);
}

const refuseDirectorsPause = (work, f) => {
  if (f.step === 'paused' && pausedBy(f) === 'director') refuse(`${work} was paused by the director: only their amendment beginning "Resume" lifts it`);
};

// A planned or paused feature: the go-ahead once its wait clears. A paused
// feature with no plan recorded, in a lane that plans, goes back to planning.
// With `lifted`, the director's pause is over even when the plan still waits:
// it then waits as a planned feature, which the foreman's `build` may lift.
async function resumeOrBuild(ctx, work, f, lane, { lead = '', lifted = false } = {}) {
  if (f.step === 'paused' && !NO_PLAN.includes(lane) && typeof f.plan !== 'string') {
    await ctx.write('feature', { ...carried(f), step: 'started' });
    ctx.say(`${lead}Resumed ${work}: it had no plan yet, so it goes back to planning.`);
    return;
  }
  const went = await goAhead(ctx, work, f, { lead });
  if (!went && lifted && f.step === 'paused') {
    await ctx.write('feature', { ...carried(f), step: 'planned' });
    ctx.say(`${work} is no longer paused; its plan waits as planned work.`);
  }
}

// `why` is `five-hour` for the foreman's own pause (R61) and `director` for an
// amendment's (R80). A director's pause replaces a five-hour one, never the other way.
async function pause(ctx, work, rest, { lead = '', why = 'five-hour' } = {}) {
  flagsOf(rest, [], 'pause');
  const views = await ctx.views();
  const f = liveFeature(views, work);
  if (f.step === 'paused' && (pausedBy(f) === 'director' || why === 'five-hour')) {
    ctx.say(`${lead}${work} is paused already.`);
    return;
  }
  await ctx.write('feature', { ...carried(f), step: 'paused', pausedFor: why });
  ctx.say(`${lead}${lead === '' ? 'Paused' : 'paused'} ${work}.`);
}

// `lifted` when the director's amendment says to resume; otherwise only a
// five-hour pause is lifted.
async function resume(ctx, work, rest, { lead = '', lifted = false } = {}) {
  flagsOf(rest, [], 'resume');
  const views = await ctx.views();
  const f = liveFeature(views, work);
  if (f.step === 'building') {
    ctx.say(`${lead}${work} is building already.`);
    return;
  }
  if (f.step !== 'paused') {
    if (lifted && f.step === 'planned') {
      await goAhead(ctx, work, f, { lead });
      return;
    }
    refuse(`${work} isn't paused (it is at ${f.step})`);
  }
  if (!lifted) {
    refuseDirectorsPause(work, f);
    ctx.refuseHalted(views, `${work} can't resume`, laneOf(views, work));
  }
  await resumeOrBuild(ctx, work, f, laneOf(views, work), { lead, lifted });
}

// --- questions ---

// The feature's own question line `id`, from its questions file.
function featureQuestion(ctx, views, work, rest) {
  const [id, ...more] = rest;
  if (typeof id !== 'string' || more.length > 0) refuse('Give the question id the wake names: <work> <questionId>');
  const named = questionIdOf(id);
  if (named === null || named.work !== work || named.foreman) refuse(`${oneLine(id, 60)} isn't one of ${work}'s own question ids`);
  liveFeature(views, work);
  const worktree = worktreeOf(ctx.project, views, work);
  const q = readQuestions(featurePaths(worktree).questions).questions.find((x) => x.id === id);
  if (!q) refuse(`${work}'s questions file has no question ${id}`);
  return q;
}

async function question(ctx, work, rest) {
  const views = await ctx.views();
  const q = featureQuestion(ctx, views, work, rest);
  if (q.kind === 'extra-plan') refuse(`${q.id} is an extra plan: act extra-plan ${work} ${q.id}`);
  // A build-command question carries the commands it asks for, which a grant reads from state.
  const data = {
    id: q.id, work, what: q.what, why: q.why, options: q.options, recommendation: q.recommendation, level: q.level,
    ...(q.kind === 'build-command' ? { commands: q.commands } : {}),
  };
  let at;
  if (same(views.questions[q.id]?.question?.data, data)) {
    ctx.say(`Question ${q.id} is recorded already.`);
    at = views.questions[q.id].question.at;
  } else {
    await ctx.write('question', data);
    ctx.say(`Recorded question ${q.id} for the director.`);
    at = ctx.now().toISOString();
  }
  await offerUnattended(ctx, views, work, { ...data, at });
}

// --- Build commands on Windows (design section 12.2) ---

// The level of build commands on this computer, in the terms renderBrief takes: null off
// Windows, else `{ level, guardedCommand, shape }`, with the Guarded runner's command where it can
// be given. Anything that fails reads Ask. At watcher Shape 2 the waker gives a feature session no
// allow rules (ruling 4), so the brief tells it to ask for a click in the session itself, whatever
// the level.
function windowsBuildsOf(ctx, views, config) {
  if (ctx.platform !== 'win32') return null;
  const shape = config?.watcherShape === 2 ? 2 : 1;
  let runner = null;
  try {
    runner = guardedCommand({ home: wheelhouseHome(), pluginRoot: ctx.pluginRoot, platform: ctx.platform });
  } catch { /* no runner to name: the brief gives the Ask words */ }
  try {
    return { level: buildsHere(ctx, views).level, guardedCommand: runner, shape };
  } catch {
    return { level: 'ask', guardedCommand: runner, shape };
  }
}

// This computer's Guarded self-test (scripts/windows/low.js): `ready`, a result under a day old
// found the runner low and a write outside the worktree refused; `readsHeld`, it found the helper's
// keys folder unreadable. Anything that can't be read is not ready.
function guardedHere(ctx) {
  try {
    const result = readSelfTest({ home: wheelhouseHome(), now: ctx.now, platform: ctx.platform });
    const { writesHeld, readsHeld } = guardedCardInput(result);
    return { ready: writesHeld, readsHeld };
  } catch {
    return { ready: false, readsHeld: false };
  }
}

// Whether the project is Locked, and buildsLevel for this computer and project. An isLocked that
// throws reads as Locked; lockedByPath itself answers false (not Locked) when it can't tell.
function buildsHere(ctx, views) {
  let locked = true;
  try {
    locked = ctx.isLocked(checkoutOf(ctx.project)) !== false;
  } catch { /* read as Locked */ }
  return { locked, level: buildsLevel({ views, computer: computerId(), locked, guardedReady: guardedHere(ctx).ready }) };
}

// The computer's own date for a time, as "<year>-<month>-<day>", or null.
function localDay(at) {
  const when = at instanceof Date ? at : new Date(at);
  return Number.isNaN(when.getTime()) ? null : `${when.getFullYear()}-${when.getMonth() + 1}-${when.getDate()}`;
}

// The Unattended card's question: the five parts, each with its words on its label's own line
// as the composer writes them (the card-check hook refuses a card otherwise), the design's words
// on the risk as they are, and the line that a Turn on (dangerous) click confirms the setting
// event `settingId` by. Where Use Guarded is offered, `guarded` is the setting event proposing
// Guarded, and its confirm line and that line's reply code line follow (ruling 22): a Use Guarded
// click confirms that event, and the card check asks a card with a set line for its code.
function unattendedQuestion(card, settingId, computer, guarded) {
  const named = (name) => card.options.find((o) => o.name === name);
  const offersGuarded = guarded !== null && card.options.some((o) => o.name === 'guarded');
  return [
    `What this is: ${card.what} ${card.risk}`,
    `Why it's coming to you: ${card.why}`,
    `Options: ${card.options.map((o) => `${o.label}: ${o.says.replace(/[.!?]+$/, '')}`).join('; ')}`,
    `My recommendation: ${named(card.recommend).label}`,
    `While you decide: ${card.meanwhile}`,
    unattendedBuildsLine(settingId, computer),
    ...(offersGuarded ? [confirmLine(guarded), replyCodeLine(replyCode(confirmLine(guarded)))] : []),
  ].join('\n');
}

// The Unattended card as a card event holds it, for the front desk to ask as it is: its question,
// its own options with what each says (the recommendation marked, as the composer marks it), and
// no set line or reply code of its own, since only a click on Turn on (dangerous) or Use Guarded
// sets the level. `guarded` is the setting event Use Guarded confirms, where it is offered.
export function unattendedCardData(card, settingId, computer, guarded = null) {
  const recommended = card.options.find((o) => o.name === card.recommend);
  return {
    question: unattendedQuestion(card, settingId, computer, guarded),
    header: 'Unattended',
    options: card.options.map((o) => o.label),
    descriptions: card.options.map((o) => (o === recommended ? `Recommended: ${o.says}` : o.says)),
    kind: 'question',
    level: 3,
    line: null,
    code: null,
  };
}

// What stops the Unattended card as `data` holds it reaching the director, as a clause, or null:
// a question past the card's length, or one the card-check hook would refuse. Checked here, where
// the card is written, so a card in the wrong form is never written, whatever the hook does.
export function unattendedCardFault(data) {
  const question = typeof data?.question === 'string' ? data.question : '';
  if (question.length > CARD.chars) return `it would pass ${CARD.chars} characters (it is ${question.length})`;
  const problems = cardProblems(question);
  return problems.length === 0 ? null : `the card ${problems.join('; ')}`;
}

// After a feature's third build-command question recorded in a day (the computer's own date),
// on Windows, outside a Locked project and below Unattended: a setting event proposing
// Unattended for this computer, and where this computer's Guarded self-test passed one proposing
// Guarded, then the Unattended card that confirms either, once a day. Read from state, so running
// it again offers nothing more, and an offer whose card wasn't written gets its card. `asked` is
// the question as recorded, with its time.
async function offerUnattended(ctx, views, work, asked) {
  if (ctx.platform !== 'win32' || !isBuildQuestion(asked)) return;
  try {
    const here = buildsHere(ctx, views);
    if (here.locked || here.level === 'unattended') return;
    const today = localDay(ctx.now());
    if (localDay(asked.at) !== today) return;
    const earlier = Object.values(views.questions).filter((e) => e?.question?.data?.id !== asked.id && e?.question?.data?.work === work
      && isBuildQuestion(e.question.data) && localDay(e.question.at) === today);
    if (earlier.length + 1 < 3) return;

    const computer = computerId();
    const key = settingKey(computer);
    const events = stateEvents(ctx.project);
    const offers = events.filter((e) => e.kind === 'setting' && e.computer === computer && e.data?.key === key
      && e.data?.value === 'unattended' && localDay(e.at) === today);
    const carded = (id) => events.some((e) => e.kind === 'card' && typeof e.data?.question === 'string'
      && e.data.question.includes(unattendedBuildsLine(id, computer)));
    if (offers.some((e) => carded(e.id))) return;
    const settingId = offers.at(-1)?.id ?? await ctx.write('setting', { key, value: 'unattended' });
    const guarded = guardedHere(ctx);
    let guardedEvent = null;
    if (guarded.ready) {
      guardedEvent = events.filter((e) => e.kind === 'setting' && e.computer === computer && e.data?.key === key
        && e.data?.value === 'guarded' && localDay(e.at) === today).at(-1) ?? null;
      if (guardedEvent === null) {
        const data = { key, value: 'guarded', words: GUARDED_SETTING_WORDS };
        guardedEvent = { kind: 'setting', id: await ctx.write('setting', data), data };
      }
    }
    const card = UNATTENDED_CARD({ guardedReady: guarded.ready, readsHeld: guarded.readsHeld });
    const data = unattendedCardData(card, settingId, computer, guardedEvent);
    const fault = unattendedCardFault(data);
    if (fault !== null) {
      ctx.say(`The Unattended card wasn't written, so builders keep asking: ${fault}.`);
      return;
    }
    await ctx.write('card', data);
    ctx.say('Offered the director the Unattended card for build commands on this computer.');
  } catch (error) {
    ctx.say(`The Unattended card wasn't offered: ${oneLine(error instanceof Error ? error.message : 'unknown error', 200)}. It is offered with the next build-command question.`);
  }
}

// The work id of an extra plan: `<work>-x<n>` for the question q-<work>-<n>,
// with the work's part cut and six characters of the question id's hash put
// in when that would pass 40 characters.
export function extraPlanId(work, questionId) {
  const n = questionIdOf(questionId)?.n ?? 0;
  const suffix = `-x${n}`;
  if (work.length + suffix.length <= 40) return `${work}${suffix}`;
  const hash = crypto.createHash('sha256').update(questionId).digest('hex').slice(0, 6);
  return `${work.slice(0, 40 - suffix.length - hash.length - 1).replace(/-+$/, '')}-${hash}${suffix}`;
}

async function extraPlan(ctx, work, rest) {
  const views = await ctx.views();
  const q = featureQuestion(ctx, views, work, rest);
  if (q.kind !== 'extra-plan') refuse(`${q.id} is a question for the director: act question ${work} ${q.id}`);
  const parent = views.work[work]?.work?.data;
  if (!isPlain(parent)) refuse(`There is no work named ${work} in state`);
  const id = extraPlanId(work, q.id);
  const there = views.work[id]?.work?.data;
  if (isPlain(there)) {
    if (there.parent !== work) refuse(`The id ${id} is taken by other work`);
    ctx.say(`${id} is queued already.`);
    return;
  }
  const title = oneLine(q.what, 200);
  await ctx.write('work', {
    id, title, lane: parent.lane, visible: parent.visible === true, dependsOn: [], ...(isPlain(parent.doc) ? { doc: parent.doc } : {}), parent: work,
  });
  const free = NO_PLAN.includes(parent.lane) && parent.visible !== true;
  ctx.say(`Queued ${id} (${parent.lane}), an extra plan of ${work}: ${title}.`);
  ctx.say(`Its plan is ${oneLine(q.plan, 120)} in ${work}'s worktree. ${free ? 'It may start without an approval.' : "It needs the director's approval to start."}`);
}

const foremanNumber = (id, work) => {
  const named = questionIdOf(id);
  return named !== null && named.work === work && named.foreman ? named.n : null;
};

async function ask(ctx, work, rest) {
  const found = flagsOf(rest, ['what', 'why', 'option', 'recommend', 'level'], 'ask');
  const what = needed(found, 'what');
  const why = needed(found, 'why');
  const recommendation = needed(found, 'recommend');
  const level = needed(found, 'level');
  if (!/^[1-4]$/.test(level)) refuse('--level is a decision level from 1 to 4');
  const options = optionsOf(found, recommendation);
  const views = await ctx.views();
  if (!isPlain(views.work[work]) && featureOf(views, work) === null) refuse(`There is no work named ${work} in state`);

  const asked = Object.values(views.questions).filter((q) => isPlain(q?.question?.data) && foremanNumber(q.question.data.id, work) !== null);
  const body = { what, why, options, recommendation, level: Number(level) };
  const bodyOf = (d) => ({ what: d.what, why: d.why, options: d.options, recommendation: d.recommendation, level: d.level });
  const again = asked.find((q) => q.answer === null && same(bodyOf(q.question.data), body));
  if (again) {
    ctx.say(`The director was asked this already: ${again.question.data.id}.`);
    return;
  }
  const n = Math.max(FOREMAN_QUESTIONS, ...asked.map((q) => foremanNumber(q.question.data.id, work))) + 1;
  const id = `q-${work}-${n}`;
  // A question no card could carry would wait for ever unasked: refused by the composer's own rules.
  const problem = questionProblem({ id, work, ...body });
  if (problem !== null) refuse(`This question can't be put to the director as a card, so it wasn't asked: ${problem}`);
  await ctx.write('question', { id, work, ...body });
  ctx.say(`Asked the director: ${id}.`);
}

// --- amend ---

// The amendment of `work` whose hash is `hash`, as the director approved it
// with a signed click: `{ change, at }`, or null. Read from the state clone,
// as the views read it. Each wake names its amendment by hash, so one landing
// while another waits is never lost: each is applied in turn.
function approvedAmendment(unique, work, hash) {
  const enrolled = readEnrolled();
  const changes = unique.filter((e) => e.kind === 'amendment' && e.data?.work === work && typeof e.data.change === 'string' && e.data.hash === hash);
  if (changes.length === 0) return null;
  const click = unique.filter((e) => e.kind === 'action' && e.data?.action === 'amend' && e.data.work === work && e.data.hash === hash && verify(e, enrolled)).at(-1);
  if (!click) return null;
  return { change: changes.at(-1).data.change, at: click.at };
}

// An entry of "What changed" without its version: the same change on the same day.
const entryKey = (line) => line.replace(/ \(version \d+\):/, ':');
const changeEntries = (text) => {
  const section = /(?:^|\n)# What changed\r?\n([\s\S]*?)(?=\r?\n# |(?![\s\S]))/.exec(text);
  return section ? section[1].split(/\r?\n/).filter((l) => l.startsWith('- ')).map(entryKey) : [];
};

async function amend(ctx, work, rest) {
  const [wanted, ...more] = rest;
  if (typeof wanted !== 'string' || !HASH.test(wanted) || more.length > 0) refuse('Give the amendment\'s hash the wake names: amend <work> <hash>');
  const views = await ctx.views();
  const events = stateEvents(ctx.project);
  const amendment = approvedAmendment(events, work, wanted);
  if (amendment === null) refuse(`There is no amendment ${short(wanted)} of ${work} the director has approved`);
  // Not started yet: the approval carries over to the amended document, which the start reads.
  if ((featureOf(views, work) === null || queuedAgain(views, work)) && isPlain(views.work[work])) {
    ctx.say(`${work} has not started. Nothing to do: the start reads the amended document.`);
    return;
  }
  const f = liveFeature(views, work);
  const word = amendment.change.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  if (word === 'pause') {
    await pause(ctx, work, [], { lead: 'The amendment says to pause: ', why: 'director' });
    return;
  }
  if (word === 'resume') {
    await resume(ctx, work, [], { lead: 'The amendment says to resume: ', lifted: true });
    return;
  }

  const worktree = worktreeOf(ctx.project, views, work);
  const file = featurePaths(worktree).brief;
  const text = readCapped(file, BRIEF_BYTES);
  if (text === null) refuse(`${work}'s brief can't be read`);
  // The brief must be the one the foreman recorded (from state, as the watcher
  // judges it): an amendment never takes in a change the session made. The
  // file may also be the one recorded before, when this amendment's hash was
  // recorded and the file not yet written.
  const recorded = recordedBriefs(events).get(work) ?? { recorded: null, before: null };
  const found = briefHash(text);
  let next;
  try {
    next = amendBrief(text, { change: amendment.change, now: new Date(amendment.at) });
  } catch (error) {
    refuse(`${work}'s brief can't be amended: ${oneLine(error.message, 200)}`);
  }
  const hash = briefHash(next);
  const [entry] = changeEntries(next);
  if (found === recorded.recorded && changeEntries(text).includes(entry)) {
    ctx.say(`${work}'s brief has this amendment already.`);
    return;
  }
  const midway = recorded.recorded === hash && found === recorded.before;
  if (found !== recorded.recorded && !midway) refuse(`${work}'s brief isn't the one recorded, so it was not amended: ask the director`);
  // The hash first, then the file (R41): a repeat after a stop in between records nothing more.
  if (recorded.recorded !== hash) await ctx.write('feature', { ...carried(f), step: f.step, ...pausedFields(f), brief: hash });
  if (!safeFeatureFolder(worktree)) refuse("The worktree's feature folder isn't a real folder inside it");
  writeWhole(file, next);
  ctx.say(`Amended ${work}'s brief to version ${parseBrief(next).fields.version} (${short(hash)}); its session is woken with brief-changed.`);
}

// --- merge and close ---

// The feature's status rebuilt from its files, and written when it changed,
// as the status hook does (scripts/hooks/feature-status.js), with the slice
// and the answered questions from the views this command read. The hook runs
// only in the feature's own session, which sleeps once its pull request is
// open, so after a merge only this moves the status on: to the next slice's
// plan (plan-ready) or to done (report), which the watcher reads.
function writeFeatureStatus(ctx, views, work, worktree) {
  if (!safeFeatureFolder(worktree)) throw new Error("the worktree's feature folder isn't a real folder inside it");
  const answered = new Set(Object.entries(views.questions).filter(([, q]) => isPlain(q?.answer)).map(([id]) => id));
  const slice = validSlice(featureOf(views, work)?.slice);
  const next = buildStatus({
    worktree, now: ctx.now, feature: loadFeature(worktree), answered: () => answered, slice: () => slice,
  });
  const file = featurePaths(worktree).status;
  if (!sameStatus(readStatus(file), next)) writeStatus(file, next);
  return next;
}

const FULL_COMMIT = /^[0-9a-f]{40}$/;

// The director's CI push the update-branch refusal names, when that is all it lacks, or null.
function ciPushNeeded(answer) {
  const c = answer.ciPush;
  return isPlain(c) && typeof c.branch === 'string' && c.branch !== '' && typeof c.sha === 'string' && FULL_COMMIT.test(c.sha) ? c : null;
}

// The director's approval the merge refusal names, when it is the only condition unmet (one
// reason, and the need names this pull request and a full commit), or null: anything else unmet
// is put to the director as before.
function approvalNeeded(answer, pr) {
  const needs = answer.needs;
  if (!isPlain(needs) || Object.keys(needs).length !== 1 || !Array.isArray(answer.reasons) || answer.reasons.length !== 1) return null;
  const a = needs.approval;
  return isPlain(a) && a.pr === pr && typeof a.commit === 'string' && FULL_COMMIT.test(a.commit) ? a : null;
}

// The gate waits for one click of the director's (ruling R117): a `gate-asks` record says which,
// once per pull request, click and commit, for the card that asks for it; the watcher wakes the
// foreman when the click is on record. Nothing is asked here.
async function gateAsks(ctx, data, what) {
  const recorded = stateEvents(ctx.project).some((e) => e.kind === 'gate-asks' && isPlain(e.data)
    && e.data.pr === data.pr && e.data.ask === data.ask && e.data.sha === data.sha);
  if (!recorded) await ctx.write('gate-asks', data);
  ctx.say(`Pull request #${data.pr} for ${data.work} waits for the director's click on #${data.pr} at ${short(data.sha)}: ${what}. Nothing to do.`);
}

async function merge(ctx, work, rest) {
  flagsOf(rest, [], 'merge');
  const views = await ctx.views();
  liveFeature(views, work);
  const worktree = worktreeOf(ctx.project, views, work);
  const kept = readPrRecord(worktree);
  if (kept === null) refuse(`${work} has no pull request kept in its pr.json`);
  const pr = kept.pr;
  // pr.json marks the merge (ruling R88), and the status is rebuilt from it, so
  // the watcher sees the feature move on to the next slice or to done.
  const markMerged = () => {
    if (!safeFeatureFolder(worktree)) refuse("The worktree's feature folder isn't a real folder inside it");
    if (!kept.merged) writeWhole(featurePaths(worktree).pr, `${JSON.stringify({ pr, ...(kept.plan ? { plan: kept.plan } : {}), merged: true })}\n`);
    let status;
    try {
      status = writeFeatureStatus(ctx, views, work, worktree);
    } catch (error) {
      refuse(`Pull request #${pr} for ${work} merged, but its status wasn't written: ${oneLine(error instanceof Error ? error.message : 'unknown error', 200)}. Ask the director`);
    }
    return status.phase;
  };
  const number = { project: ctx.project, number: pr };
  const state = await ctx.client.prState(number);
  if (state?.ok === true && state.result?.state === 'merged') {
    // Marked and its status written again: a stop between the merge and either is put right.
    const phase = markMerged();
    ctx.say(`Pull request #${pr} for ${work} is merged already; its status reads ${phase}.`);
    return;
  }
  // While STOP or an incident holds, only an incident's recorded fix merges.
  const halt = ctx.halt(views);
  if (halt !== null && !halt.fixes.includes(pr)) refuse(`Pull request #${pr} for ${work} can't merge while ${halt.why}: only an incident's fix merges. Nothing to do until it is over`);
  const updated = await ctx.client.updateBranch(number);
  const ciPush = updated?.ok === false ? ciPushNeeded(updated) : null;
  if (ciPush !== null) {
    await gateAsks(ctx, { work, pr, ask: 'ci-push', sha: ciPush.sha, branch: ciPush.branch }, `their push of ${ciPush.branch}, which changes a CI file`);
    return;
  }
  if (updated?.ok !== true) refuse(`Pull request #${pr} for ${work} couldn't be brought up to date: ${refusal(updated)}. Ask the director; don't try again.`);
  // A new head needs CI on that exact commit before the gate lets it merge (design section 12).
  if (updated.updated === true) {
    ctx.say(`Brought pull request #${pr} for ${work} up to date at ${short(updated.head)}; the merge waits for CI on that commit, and the next merge-ready wakes the foreman.`);
    return;
  }
  const merged = await ctx.client.merge(number);
  const approval = merged?.ok === false ? approvalNeeded(merged, pr) : null;
  if (approval !== null) {
    await gateAsks(ctx, { work, pr, ask: 'approval', sha: approval.commit }, 'their approval of that commit');
    return;
  }
  if (merged?.ok !== true) refuse(`Pull request #${pr} for ${work} was not merged: ${refusal(merged)}. Ask the director; don't try again.`);
  const phase = markMerged();
  ctx.say(`Merged pull request #${pr} for ${work} at ${short(merged.sha)}; its status reads ${phase}.`);
}

async function close(ctx, work, rest) {
  flagsOf(rest, [], 'close');
  const views = await ctx.views();
  const f = featureOf(views, work);
  if (f === null) refuse(`${work} has no feature recorded`);
  if (f.step === 'closed') {
    fs.rmSync(sessionFile(ctx.project, work), { force: true });
    ctx.say(`${work} is closed already.`);
    return;
  }
  const worktree = worktreeOf(ctx.project, views, work);
  let missing;
  try {
    missing = reportCheck({ worktree }).missing;
  } catch (error) {
    refuse(oneLine(error.message, 200));
  }
  if (missing.length > 0) refuse(`${work}'s report isn't whole: ${missing.join(' ')}`);
  const parsed = parseReport(readCapped(featurePaths(worktree).report, REPORT_BYTES));
  const summary = parsed.body.trim();
  if (summary === '') refuse(`${work}'s report has no text after its fields`);
  // The pull request is the one open-pr kept, never one the report names. It
  // counts as merged only when the foreman's merge marked it in pr.json and the
  // host says so too. The work is `merged` only when the report says it is
  // done and that pull request was opened for the feature's current plan: an
  // earlier slice's merge never makes a feature that ended blocked or partial
  // read as merged.
  const kept = readPrRecord(worktree);
  const pr = kept?.pr ?? null;
  const status = parsed.fields.status;
  let outcome = status === 'blocked' ? 'blocked' : 'closed';
  if (pr !== null) {
    const state = await ctx.client.prState({ project: ctx.project, number: pr });
    if (state?.ok !== true) refuse(`Whether pull request #${pr} merged can't be told: ${refusal(state)}`);
    const merged = state.result?.state === 'merged';
    if (merged !== kept.merged) {
      refuse(merged
        ? `Pull request #${pr} for ${work} merged, but not through act merge: ask the director`
        : `${work}'s pr.json says pull request #${pr} merged, but the host says it hasn't: ask the director`);
    }
    // Quick and bug work have no plan to match.
    const current = NO_PLAN.includes(laneOf(views, work)) || kept.plan === (typeof f.plan === 'string' ? f.plan : null);
    if (merged && status === 'done' && current) outcome = 'merged';
  }
  const data = { work, outcome, summary, rulings: parsed.fields.rulings, ...(pr !== null ? { pr } : {}) };
  if (!same(views.reports[work]?.data, data)) await ctx.write('report', data);
  await ctx.write('feature', { ...carried(f), step: 'closed' });
  fs.rmSync(sessionFile(ctx.project, work), { force: true });
  ctx.say(`Recorded ${work}'s report (${outcome}, ${plural(data.rulings.length, 'ruling')}) and closed it.`);
  // Unfinished work: the director decides whether it is queued again, and in which lane (R102).
  if (status === 'partial' || status === 'blocked') ctx.say(queueAgainLine(work, status, laneOf(views, work)));
  // Its slot, and any work that depended on it, may be free now; this close's own records wake no one (R64).
  ctx.say('A slot or a dependency may be free: run wake read again.');
}

// The lanes, smallest first: work queued again only ever goes up (design section 4).
const LANES_UP = Object.freeze(['quick', 'bug', 'small', 'feature']);

// The question to put to the director when work ends partial or blocked (ruling
// R102): queue it again, in the small lane or a bigger one (never a smaller
// lane than its own), or drop it. Each option says `waiting`: the front desk
// records the work again from the director's answer, and the foreman has
// nothing to run for it. Nothing the session wrote goes into the command.
function queueAgainLine(work, status, lane) {
  const lanes = LANES_UP.slice(Math.max(LANES_UP.indexOf(lane), LANES_UP.indexOf('small')));
  const options = [...lanes.map((l) => `--option '${l}=waiting'`), "--option 'drop=waiting'"].join(' ');
  const why = status === 'partial' ? 'Its report says part is done, or it proved bigger than its lane' : 'Its report says it could not go on';
  return `It ended ${status}: ask the director whether to queue it again, and in which lane, or to drop it. `
    + `Next: act ask ${work} --what '${work} ended ${status}: queue it again, or drop it?' --why '${why}' ${options} --recommend ${lanes[0]} --level 2`;
}

// --- The command line ---

const COMMANDS = {
  start, 'plan-ready': planReady, build, pause, resume, question, 'extra-plan': extraPlan, ask, amend, merge, close,
};
const USAGE = `Commands: ${Object.keys(COMMANDS).join(', ')}, each followed by the work id`;

// Runs a command and resolves with its exit code. `wakerFor(config, print)`
// gives the waker that starts a session.
export async function main(argv, {
  cwd = process.cwd(), project: given, client = helperClient(), now = () => new Date(), run = runProgram,
  wakerFor, pluginRoot = PLUGIN_ROOT, makeId = () => crypto.randomUUID(), platform = process.platform, isLocked = lockedByPath,
  out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [command, work, ...rest] = argv;
    if (typeof command !== 'string' || !Object.hasOwn(COMMANDS, command)) refuse(USAGE);
    if (typeof work !== 'string' || !SLUG.test(work)) refuse('Give the work id: lower-case letters, digits and hyphens, at most 40');
    const project = given ?? projectHere(cwd);
    const waker = wakerFor ?? ((cfg, print) => makeWaker({ shape: cfg.watcherShape, project, config: cfg, print }));
    const ctx = context({ project, client, now, run, wakerFor: waker, pluginRoot, makeId, out, platform, isLocked });
    await COMMANDS[command](ctx, work, rest);
    return 0;
  } catch (error) {
    err(`${error instanceof ForemanError ? oneLine(error.message, 600) : `That did not work: ${oneLine(error instanceof Error ? error.message : 'unknown error', 300)}`}\n`);
    return 1;
  }
}

// Run as a command, it forwards to the host helper, which runs `main` outside the sandbox (ruling R156).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await forward('act', process.argv.slice(2));
}
