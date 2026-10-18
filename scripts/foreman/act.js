// scripts/foreman/act.js
// The foreman's commands (ruling R63), one for each step of its playbook, run
// from the project's main checkout as `node act.js <command> <work> …`:
//
//   start <work> --goal <text> --done <line>… --appetite-sessions <n>
//         --appetite-tokens <n> [--ruling <id>…] [--plan <path>] [--slices <n>]
//       Opens the work's session. In order: the worktree
//       <checkout>/.claude/worktrees/<work> on a branch feature/<work> from the
//       default branch, made with git in the main checkout; `.wheelhouse/` kept
//       out of git through info/exclude; the brief written; a `feature` event
//       `started` recorded with the brief's hash (a first brief is written
//       before its hash is recorded, ruling R41); the session started through
//       the waker (under Shape 2 the waker's START line is passed on).
//   plan-ready <work> [--slice <n>]   records the plan the brief names and its
//       files (`planned`), then the go-ahead (`building`) when it clears.
//   build <work>    the go-ahead for a recorded plan whose wait has cleared.
//   pause <work>, resume <work>
//   question <work> <questionId>      the feature's question, into state.
//   extra-plan <work> <questionId>    the extra plan, queued as work.
//   ask <work> --what … --why … --option "<label>=<says>"… --recommend <label> --level <n>
//       The foreman's own question for the director.
//   amend <work>    applies the director's latest approved amendment.
//   merge <work>    brings the pull request up to date, then merges it.
//   close <work>    records the report and closes the feature.
//
// Every command checks the work id, prints a few short lines, and refuses
// with one plain line and exit code 1. Each may be run again with nothing
// more done (a wake may repeat, ruling R27): it says what is so already.
//
// Writing state. Every event goes through the helper's /state/write with an
// id made here, and that id is recorded in the watcher's handled list
// (scripts/watcher/handled.js) before the write, so the foreman's own
// records never wake it (R64). The list has no lock: the foreman runs these
// commands one at a time. A `feature` event replaces the last one in the
// features view, so each carries the feature's worktree, branch, plan, files
// and slice forward. Only `start` and `amend` carry `brief`: a `building`
// event without it is the session's go-ahead (`build`, ruling R85), and one
// with it records an amendment's hash at the feature's own step.
//
// Which work may build (ruling R60, as wake.js works it out): a plan builds
// when it clashes with no running feature's recorded files or the hot files,
// and nextWork, counting only work that can build now, gives it a slot.
// Small, feature or bug work held for pace or a dependency may still start,
// so its session plans while it waits. A bug has no plan: started while
// held, it builds at once, beyond the pace.
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
  ForemanError, NO_PLAN, PLANS_WHILE_HELD, checkoutOf, clashFor, featureOf, laneOf, loadConfig, loadViews, oneLine, planOf, projectHere,
  queueToStart, slotFor, waitText, whyText, worktreeOf,
} from './wake.js';
import { amendBrief, renderBrief } from '../feature/brief.js';
import { report as reportCheck } from '../feature/cli.js';
import { briefHash, ensureIgnored, featurePaths, parseReport, readQuestions } from '../feature/files.js';
import { readCapped, readPr, safeFeatureFolder, writeWhole } from '../feature/status.js';
import { branchOf } from '../hooks/session-start.js';
import { helperClient } from '../host/helper-client.js';
import { SLUG } from '../lib/build-loop.js';
import { canonicalJson } from '../lib/canonical.js';
import { stateDir } from '../lib/paths.js';
import { run as runProgram, withoutGitVars } from '../lib/run.js';
import { listEvents } from '../state/events.js';
import { readEnrolled, verify } from '../state/signing.js';
import { recordHandled } from '../watcher/handled.js';
import { inWorktreesFolder } from '../watcher/sources.js';
import { makeWaker, sessionFile } from '../watcher/waker.js';

// The first number of the foreman's own question ids.
export const FOREMAN_QUESTIONS = 1000000;

const NULL_FILE = '/dev/null';
const BRIEF_BYTES = 1024 * 1024;
const REPORT_BYTES = 1024 * 1024;
const GIT_MS = 2 * 60 * 1000;
// What each `feature` event carries forward from the one before.
const CARRIED = Object.freeze(['worktree', 'branch', 'session', 'plan', 'files', 'slice']);
const QUESTION_ID = /^q-([a-z0-9-]+)-([0-9]+)$/;
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
    return { label, says: text.slice(at + 1).trim() };
  });
  if (options.length < 2) refuse('Give two or more options, each with --option "<label>=<what it means>"');
  if (new Set(options.map((o) => o.label)).size !== options.length) refuse('Each option needs its own label');
  if (!options.some((o) => o.label === recommendation)) refuse(`--recommend must be the label of one option (${options.map((o) => o.label).join(', ')})`);
  return options;
}

// --- Where things stand, and writing to state ---

function context({ project, client, now, run, wakerFor, pluginRoot, makeId, out }) {
  let views = null;
  let config = null;
  const ctx = {
    project, client, now, run, pluginRoot,
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

// The worktree on `branch`, made from the default branch in the main checkout,
// or the one made before. Resolves true when it was made now.
async function makeWorktree(ctx, work, checkout, worktree, branch) {
  const git = (args) => ctx.run('git', ['-c', `core.hooksPath=${NULL_FILE}`, '-c', 'core.fsmonitor=false', ...args], {
    cwd: checkout, baseEnv: withoutGitVars(process.env), env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: GIT_MS,
  });
  realFolders(checkout, ['.claude', 'worktrees']);
  const there = lstatOf(worktree);
  if (there !== null) {
    if (there.isDirectory() && inWorktreesFolder(checkout, worktree) && branchOf(worktree) === branch) return false;
    refuse(`${worktree} is there already and isn't ${work}'s worktree on ${branch}`);
  }
  const head = await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const base = String(head.stdout ?? '').trim();
  if (head.code !== 0 || !BASE_REF.test(base) || base.includes('..')) {
    refuse("The main checkout doesn't name its default branch (refs/remotes/origin/HEAD), so no worktree was made");
  }
  const kept = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  const args = kept.code === 0
    ? ['worktree', 'add', '--quiet', worktree, branch]
    : ['worktree', 'add', '--quiet', '--no-track', '-b', branch, worktree, base];
  const made = await git(args);
  if (made.code !== 0) refuse(`git couldn't make the worktree: ${oneLine(made.stderr || made.stdout || 'no reason given', 200)}`);
  return true;
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
  const config = await ctx.config();

  const existing = featureOf(views, work);
  if (existing !== null) {
    // Recorded, but stopped before its session began (STOP, say): start the session only.
    if (existing.step === 'started' && config.watcherShape === 1 && lstatOf(sessionFile(ctx.project, work)) === null) {
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
  const lane = entry.work.data.lane;
  const routing = Object.fromEntries(Object.entries(config.routing ?? {}).filter(([, m]) => typeof m === 'string' && m !== ''));
  const fields = {
    v: 1, work, lane, version: 1, goal, done, appetite, rulings, routing, shownFirst: entry.approval?.shownFirst === true,
    ...(plan ? { plan } : {}), ...(slices ? { slices } : {}),
  };
  let text;
  try {
    text = renderBrief({ fields, pluginRoot: ctx.pluginRoot });
  } catch (error) {
    refuse(`The brief can't be written: ${oneLine(error.message, 200)}`);
  }

  // The queue: work it lets start, or small, feature or bug work held for pace or a dependency (R60).
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
  const made = await makeWorktree(ctx, work, checkout, worktree, branch);
  ctx.say(made ? `Made the worktree ${worktree} on ${branch}.` : `Using the worktree ${worktree} on ${branch}, made before.`);
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

function sliceOf(found, f) {
  const text = single(found, 'slice');
  if (text === undefined) return undefined;
  const m = f.slice?.m;
  if (!/^[1-9][0-9]{0,3}$/.test(text) || !Number.isInteger(m) || Number(text) > m) refuse(`--slice is the slice's number, from 1 to the feature's ${Number.isInteger(m) ? m : 'unknown number of'} slices`);
  return { n: Number(text), m };
}

async function planReady(ctx, work, rest) {
  const found = flagsOf(rest, ['slice'], 'plan-ready');
  const views = await ctx.views();
  const f = liveFeature(views, work);
  const lane = laneOf(views, work);
  if (NO_PLAN.includes(lane)) refuse(`${work} is ${lane} work, which has no plan`);
  const worktree = worktreeOf(ctx.project, views, work);
  let read;
  try {
    read = planOf(worktree);
  } catch (error) {
    if (error instanceof ForemanError) refuse(`${work}'s plan can't be read: ${error.message}`);
    throw error;
  }
  const slice = sliceOf(found, f);
  const unchanged = f.plan === read.plan && same(f.files, read.files) && (slice === undefined || same(f.slice, slice));
  if (f.step === 'building' && unchanged) {
    ctx.say(`${work} is building this plan already.`);
    return;
  }
  const data = { ...carried(f), plan: read.plan, files: read.files, ...(slice ? { slice } : {}) };
  const recordedLine = `Recorded the plan of ${work}: ${oneLine(read.plan, 120)}, ${plural(read.files.length, 'file')}.`;
  if (f.step === 'paused') {
    if (!unchanged) {
      await ctx.write('feature', { ...data, step: 'paused' });
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
  await resumeOrBuild(ctx, work, f, lane);
}

// A planned or paused feature: the go-ahead once its wait clears. A paused
// feature with no plan recorded, in a lane that plans, goes back to planning.
async function resumeOrBuild(ctx, work, f, lane, { lead = '' } = {}) {
  if (f.step === 'paused' && !NO_PLAN.includes(lane) && typeof f.plan !== 'string') {
    await ctx.write('feature', { ...carried(f), step: 'started' });
    ctx.say(`${lead}Resumed ${work}: it had no plan yet, so it goes back to planning.`);
    return;
  }
  await goAhead(ctx, work, f, { lead });
}

async function pause(ctx, work, rest, { lead = '' } = {}) {
  flagsOf(rest, [], 'pause');
  const views = await ctx.views();
  const f = liveFeature(views, work);
  if (f.step === 'paused') {
    ctx.say(`${lead}${work} is paused already.`);
    return;
  }
  await ctx.write('feature', { ...carried(f), step: 'paused' });
  ctx.say(`${lead}${lead === '' ? 'Paused' : 'paused'} ${work}.`);
}

async function resume(ctx, work, rest, { lead = '' } = {}) {
  flagsOf(rest, [], 'resume');
  const views = await ctx.views();
  const f = liveFeature(views, work);
  if (f.step === 'building') {
    ctx.say(`${lead}${work} is building already.`);
    return;
  }
  if (f.step !== 'paused') refuse(`${work} isn't paused (it is at ${f.step})`);
  await resumeOrBuild(ctx, work, f, laneOf(views, work), { lead });
}

// --- questions ---

// The feature's own question line `id`, from its questions file.
function featureQuestion(ctx, views, work, rest) {
  const [id, ...more] = rest;
  if (typeof id !== 'string' || more.length > 0) refuse('Give the question id the wake names: <work> <questionId>');
  const m = QUESTION_ID.exec(id);
  if (m === null || m[1] !== work || Number(m[2]) >= FOREMAN_QUESTIONS) refuse(`${oneLine(id, 60)} isn't one of ${work}'s own question ids`);
  liveFeature(views, work);
  const worktree = worktreeOf(ctx.project, views, work);
  const q = readQuestions(featurePaths(worktree).questions).questions.find((x) => x.id === id);
  if (!q) refuse(`${work}'s questions file has no question ${id}`);
  return q;
}

async function question(ctx, work, rest) {
  const views = await ctx.views();
  const q = featureQuestion(ctx, views, work, rest);
  if (q.kind !== 'question') refuse(`${q.id} is an extra plan: act extra-plan ${work} ${q.id}`);
  const data = {
    id: q.id, work, what: q.what, why: q.why, options: q.options, recommendation: q.recommendation, level: q.level,
  };
  if (same(views.questions[q.id]?.question?.data, data)) {
    ctx.say(`Question ${q.id} is recorded already.`);
    return;
  }
  await ctx.write('question', data);
  ctx.say(`Recorded question ${q.id} for the director.`);
}

// The work id of an extra plan: `<work>-x<n>` for the question q-<work>-<n>,
// with the work's part cut and six characters of the question id's hash put
// in when that would pass 40 characters.
export function extraPlanId(work, questionId) {
  const n = QUESTION_ID.exec(questionId)?.[2] ?? '0';
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
  const m = QUESTION_ID.exec(String(id));
  return m !== null && m[1] === work && Number(m[2]) >= FOREMAN_QUESTIONS ? Number(m[2]) : null;
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
  await ctx.write('question', { id, work, ...body });
  ctx.say(`Asked the director: ${id}.`);
}

// --- amend ---

// The latest amendment of `work` the director approved with a signed click:
// `{ change, at }`, or null. Read from the state clone, as the views read it.
function latestAmendment(project, work) {
  const events = listEvents(stateDir(project), { report: () => {} });
  const counts = new Map();
  for (const e of events) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  const unique = events.filter((e) => counts.get(e.id) === 1);
  const enrolled = readEnrolled();
  const changes = unique.filter((e) => e.kind === 'amendment' && e.data?.work === work && typeof e.data.change === 'string' && typeof e.data.hash === 'string');
  const clicks = unique.filter((e) => e.kind === 'action' && e.data?.action === 'amend' && e.data.work === work
    && changes.some((m) => m.data.hash === e.data.hash) && verify(e, enrolled));
  const click = clicks.at(-1);
  if (!click) return null;
  return { change: changes.filter((m) => m.data.hash === click.data.hash).at(-1).data.change, at: click.at };
}

// An entry of "What changed" without its version: the same change on the same day.
const entryKey = (line) => line.replace(/ \(version \d+\):/, ':');
const changeEntries = (text) => {
  const section = /(?:^|\n)# What changed\r?\n([\s\S]*?)(?=\r?\n# |(?![\s\S]))/.exec(text);
  return section ? section[1].split(/\r?\n/).filter((l) => l.startsWith('- ')).map(entryKey) : [];
};

async function amend(ctx, work, rest) {
  flagsOf(rest, [], 'amend');
  const views = await ctx.views();
  const f = liveFeature(views, work);
  const amendment = latestAmendment(ctx.project, work);
  if (amendment === null) refuse(`There is no amendment of ${work} the director has approved`);
  const word = amendment.change.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  if (word === 'pause') {
    await pause(ctx, work, [], { lead: 'The amendment says to pause: ' });
    return;
  }
  if (word === 'resume') {
    await resume(ctx, work, [], { lead: 'The amendment says to resume: ' });
    return;
  }

  const worktree = worktreeOf(ctx.project, views, work);
  const file = featurePaths(worktree).brief;
  const text = readCapped(file, BRIEF_BYTES);
  if (text === null) refuse(`${work}'s brief can't be read`);
  let next;
  try {
    next = amendBrief(text, { change: amendment.change, now: new Date(amendment.at) });
  } catch (error) {
    refuse(`${work}'s brief can't be amended: ${oneLine(error.message, 200)}`);
  }
  const [entry] = changeEntries(next);
  if (changeEntries(text).includes(entry)) {
    ctx.say(`${work}'s brief has this amendment already.`);
    return;
  }
  const hash = briefHash(next);
  // The hash first, then the file (R41): a repeat after a stop in between records nothing more.
  if (f.brief !== hash) await ctx.write('feature', { ...carried(f), step: f.step, brief: hash });
  if (!safeFeatureFolder(worktree)) refuse("The worktree's feature folder isn't a real folder inside it");
  writeWhole(file, next);
  ctx.say(`Amended ${work}'s brief to version ${JSON.parse(/```json\n([\s\S]*?)\n```/.exec(next)[1]).version} (${short(hash)}); its session is woken with brief-changed.`);
}

// --- merge and close ---

async function merge(ctx, work, rest) {
  flagsOf(rest, [], 'merge');
  const views = await ctx.views();
  liveFeature(views, work);
  const pr = readPr(worktreeOf(ctx.project, views, work));
  if (pr === null) refuse(`${work} has no pull request kept in its pr.json`);
  const number = { project: ctx.project, number: pr };
  const state = await ctx.client.prState(number);
  if (state?.ok === true && state.result?.state === 'merged') {
    ctx.say(`Pull request #${pr} for ${work} is merged already.`);
    return;
  }
  const updated = await ctx.client.updateBranch(number);
  if (updated?.ok !== true) refuse(`Pull request #${pr} for ${work} couldn't be brought up to date: ${refusal(updated)}. Ask the director; don't try again.`);
  const merged = await ctx.client.merge(number);
  if (merged?.ok !== true) refuse(`Pull request #${pr} for ${work} was not merged: ${refusal(merged)}. Ask the director; don't try again.`);
  ctx.say(`Merged pull request #${pr} for ${work} at ${short(merged.sha)}.`);
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
  const pr = parsed.fields.pr ?? readPr(worktree);
  let outcome = parsed.fields.status === 'blocked' ? 'blocked' : 'closed';
  if (Number.isInteger(pr)) {
    const state = await ctx.client.prState({ project: ctx.project, number: pr });
    if (state?.ok !== true) refuse(`Whether pull request #${pr} merged can't be told: ${refusal(state)}`);
    if (state.result?.state === 'merged') outcome = 'merged';
  }
  const data = { work, outcome, summary, rulings: parsed.fields.rulings, ...(Number.isInteger(pr) ? { pr } : {}) };
  if (!same(views.reports[work]?.data, data)) await ctx.write('report', data);
  await ctx.write('feature', { ...carried(f), step: 'closed' });
  fs.rmSync(sessionFile(ctx.project, work), { force: true });
  ctx.say(`Recorded ${work}'s report (${outcome}, ${plural(data.rulings.length, 'ruling')}) and closed it.`);
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
  wakerFor, pluginRoot = PLUGIN_ROOT, makeId = () => crypto.randomUUID(),
  out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [command, work, ...rest] = argv;
    if (typeof command !== 'string' || !Object.hasOwn(COMMANDS, command)) refuse(USAGE);
    if (typeof work !== 'string' || !SLUG.test(work)) refuse('Give the work id: lower-case letters, digits and hyphens, at most 40');
    const project = given ?? projectHere(cwd);
    const waker = wakerFor ?? ((cfg, print) => makeWaker({ shape: cfg.watcherShape, project, config: cfg, print }));
    const ctx = context({ project, client, now, run, wakerFor: waker, pluginRoot, makeId, out });
    await COMMANDS[command](ctx, work, rest);
    return 0;
  } catch (error) {
    err(`${error instanceof ForemanError ? oneLine(error.message, 600) : `That did not work: ${oneLine(error instanceof Error ? error.message : 'unknown error', 300)}`}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
