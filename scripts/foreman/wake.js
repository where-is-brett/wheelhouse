// scripts/foreman/wake.js
// The foreman's reading of a wake, and its record of each one (build-loop
// design, sections 8, 11 and 15). The foreman is a fresh session at every
// wake; it reads conclusions, not files, so this works them out:
//   node wake.js read <file>
//     First the two commands exactly as the foreman's allow rules match them
//     (ruling R96), and while STOP or an incident holds, a line saying so
//     (ruling R95). Then one short line per event (its type, its work, the detail that matters
//     and, where the next step is certain, `Next: act …`), the digest counted
//     by type and never listed, then the queue's answer: what may start, which
//     recorded plans may build or must wait and why, what is planning and
//     what is building. Each start names the work's approved document, to
//     read the brief's goal, done lines and appetite from (ruling R84), once
//     its hash is checked against the approval's (R97); an extra plan's start
//     names its title and parent (R99). The rulings in force are listed by id
//     under the starts, for `--ruling`. Every open pull request ready to merge,
//     as the watcher's cursor last saw it, is listed with `act merge`, so a
//     merge held earlier is offered again. While STOP or an incident holds,
//     starts and builds wait, but for bug work during an incident (ruling
//     R101), and so does a merge: under STOP every one, during an incident
//     all but its recorded fix.
//     For each `plan-ready` the plan's files are read, through the brief the
//     foreman recorded only, and checked for clashes against the running
//     features' recorded files and the configuration's hot files; quick and
//     bug work have no plan, so theirs needs nothing. Each `amended` line names
//     its amendment's hash, so several are each applied. A `stuck` feature
//     held on purpose (planned, or paused) says why it waits and needs
//     nothing; any other goes to the director. Work queued again after its
//     feature closed (ruling R102) is offered to start afresh.
//   node wake.js done <file> --acted | --idle
//     Appends `{ at, wake, outcome, events, conflicts, merges }` to
//     projects/<p>/watcher/measures.jsonl, once per wake (the wake's id is its
//     file's name). `conflicts` counts the bundle's `conflict` and `clash`
//     events, `merges` its `merge-ready` events, in its events and its digest.
//   node wake.js measures
//     The idle share and the conflicts per merge (design section 15).
// The project is the one whose folder the command runs in: the foreman runs
// in the project's main checkout. `read` and `done` take only a wake copied
// into that checkout's .wheelhouse/foreman/wakes/.
//
// The command forwards to the host helper (ruling R156, scripts/foreman/forward.js),
// since the foreman's session is sandboxed and this reads the Wheelhouse home: the
// helper runs `main` outside the sandbox, in the main checkout.
//
// Where it reads from. The views are the helper's: asked for afresh, which
// rebuilds them from the private record, or when the helper does not answer, the
// last ones it wrote (as scripts/feature/status.js reads a view), and the
// output says so. The configuration is the default branch's, through the
// helper (ruling R50), never the working copy. A feature's plan is read only
// from its worktree, through the safe readers of scripts/feature/status.js,
// and only from a worktree inside the checkout's .claude/worktrees/.
//
// An answer to the foreman's own question (an id from FOREMAN_QUESTIONS up)
// says so, with the question and the chosen option's words (one whole act
// command, or waiting), for the foreman to act on; any other answer
// wakes its feature's session and needs nothing from the foreman. A director's
// pause is never offered back: only their amendment lifts it.
//
// Which work may build now (ruling R60). nextWork's order holds, but work
// whose session cannot take a slot yet is left out of the count: small and
// feature work that has not started, or has started and is still planning.
// So a recorded plan is never held for pace behind work that has no plan.
// Quick and bug work build as soon as they start, so they stay in. The
// five-hour window is not known until the usage plan supplies it, so it is
// taken as not tight, and nothing is paused for it.
//
// The shared pieces here (ForemanError, the views, the configuration, a
// feature's worktree and plan, the clash and slot answers) are act.js's too.
import fs from 'node:fs';
import path from 'node:path';
import { clashCheck, fileMapOf, nextWork, since } from './queue.js';
import { onNewEngine } from '../engine/lanes.js';
import { PLUGIN_ROOT, foremanCommands } from './tools.js';
import { briefHash, featurePaths } from '../feature/files.js';
import {
  loadFeature, readCapped, readPlan, readPrRecord, safeFeatureFolder,
} from '../feature/status.js';
import { forward } from './forward.js';
import { helperClient } from '../host/helper-client.js';
import { HASH, LANE_APPETITE, PACE, SLUG, questionIdOf } from '../lib/build-loop.js';
import { stateDir, wheelhouseHome } from '../lib/paths.js';
import { projectForFolder, readProject } from '../lib/projects.js';
import { stopState } from '../lib/stop.js';
import { listEvents } from '../state/events.js';
import { routingFrom } from '../routing/in-force.js';
import { projectConfig } from '../watcher/main.js';
import { inWorktreesFolder, plainWorktreePath, recordedBriefs } from '../watcher/sources.js';
import { readCursor } from '../watcher/core.js';
import { readWake, watcherDir, watcherFolder } from '../watcher/waker.js';
import { startedAsScript } from '../lib/started-as-script.js';

// A refusal, said to the foreman as one plain line.
export class ForemanError extends Error {}

// A feature's brief that isn't the one the foreman recorded: `found` and `recorded` are their hashes.
export class TamperedBrief extends ForemanError {
  constructor(found, recorded) {
    super(`its brief reads ${shortHash(found)}, not the ${shortHash(recorded)} recorded`);
    this.found = found;
    this.recorded = recorded;
  }
}

// Until the usage plan supplies it.
export const FIVE_HOUR_TIGHT = false;

const VIEW_NAMES = ['work', 'features', 'reports', 'questions', 'rulebook', 'incidents'];
const DOCUMENT_BYTES = 1024 * 1024;
const VIEW_BYTES = 8 * 1024 * 1024;
const MEASURES_BYTES = 64 * 1024 * 1024;
const LINE_CHARS = 200;
// The lanes that build as soon as they start: no plan.
export const NO_PLAN = Object.freeze(['quick', 'bug']);
// The lanes whose work, held for pace or a dependency, may still open a session
// to plan (rulings R60, R89). Bug work has no plan: starting it is building.
export const PLANS_WHILE_HELD = Object.freeze(['small', 'feature']);

// Why a paused feature waits: `five-hour` (the foreman's, lifted by `resume`)
// or `director` (lifted only by their amendment). A pause that doesn't say is
// taken as the director's, so the foreman never lifts it by mistake.
export const pausedBy = (f) => (f?.pausedFor === 'five-hour' ? 'five-hour' : 'director');
// The steps at which a feature's recorded files are being changed.
const CHANGING = Object.freeze(['building', 'paused']);

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const refuse = (message) => { throw new ForemanError(message); };

// One line of text at most LINE_CHARS long.
export function oneLine(value, max = LINE_CHARS) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// --- Where things stand ---

// The project whose folder `cwd` is in, or a refusal.
export function projectHere(cwd) {
  let found = null;
  try {
    found = projectForFolder(fs.realpathSync.native(cwd));
  } catch { /* not a folder */ }
  if (!found) refuse("This folder isn't in a Wheelhouse project: run the Bosun's commands from the project's main checkout");
  return found.project;
}

export function checkoutOf(project) {
  const folder = readProject(project)?.folder;
  if (typeof folder !== 'string') refuse("The project's folder isn't known on this computer");
  return folder;
}

function keptViews(project) {
  const base = path.join(wheelhouseHome(), 'projects', project, 'views');
  const views = {};
  for (const name of VIEW_NAMES) {
    const text = readCapped(path.join(base, `${name}.json`), VIEW_BYTES) ?? readCapped(path.join(`${base}.old`, `${name}.json`), VIEW_BYTES);
    try {
      const view = JSON.parse(text ?? 'null');
      if (name === 'rulebook' ? Array.isArray(view) : isPlain(view)) views[name] = view;
    } catch { /* left out */ }
  }
  return Object.keys(views).length > 0 ? views : null;
}

// The views, rebuilt by the helper: `{ views, fresh }`. With `kept`, the last
// ones the helper wrote stand in when it gives none (`fresh` false, `why`).
export async function loadViews(project, client, { kept = false } = {}) {
  let answer;
  try {
    answer = await client.state.views({ project });
  } catch {
    answer = null;
  }
  const why = typeof answer?.refused === 'string' ? answer.refused : 'the helper gave no answer';
  let views = answer?.ok === true && isPlain(answer.views) ? answer.views : null;
  const fresh = views !== null;
  if (views === null && kept) views = keptViews(project);
  if (views === null) refuse(`The views can't be had: ${why}`);
  return {
    views: {
      work: isPlain(views.work) ? views.work : {},
      features: isPlain(views.features) ? views.features : {},
      reports: isPlain(views.reports) ? views.reports : {},
      questions: isPlain(views.questions) ? views.questions : {},
      rulebook: Array.isArray(views.rulebook) ? views.rulebook : [],
      incidents: { open: Array.isArray(views.incidents?.open) ? views.incidents.open.filter(isPlain) : [] },
      // The settings and the proposals not yet confirmed, for the level of build commands on Windows, and the
      // Thoroughness columns ready, for the level in force (scripts/routing/in-force.js).
      settings: isPlain(views.settings) ? views.settings : {},
      columnsReady: isPlain(views.columnsReady) ? views.columnsReady : {},
      unconfirmed: Array.isArray(views.unconfirmed) ? views.unconfirmed.filter(isPlain) : [],
    },
    fresh,
    ...(fresh ? {} : { why }),
  };
}

// The configuration on the default branch, through the helper (ruling R50).
export async function loadConfig(project, client) {
  const read = await projectConfig(project, client);
  if (read.config === null) refuse(`The project's configuration can't be read from its default branch: ${read.why}`);
  return read.config;
}

export const laneOf = (views, work) => views.work?.[work]?.work?.data?.lane ?? null;
export const featureOf = (views, work) => (isPlain(views.features?.[work]?.data) ? views.features[work].data : null);

// Whether `work`'s feature has closed and a `work` event recorded since queued the work
// again (ruling R102): its feature is over, and the work starts afresh.
export function queuedAgain(views, work) {
  return featureOf(views, work)?.step === 'closed' && !since(views.features[work], views.work?.[work]?.work);
}

// The feature as the queue counts it: none when the work was queued again after it closed.
export const currentFeatureOf = (views, work) => (queuedAgain(views, work) ? null : featureOf(views, work));

// The private record's events, leaving out every copy of an id carried twice, as the views do.
export function stateEvents(project) {
  const events = listEvents(stateDir(project), { report: () => {} });
  const counts = new Map();
  for (const e of events) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  return events.filter((e) => counts.get(e.id) === 1);
}

// The brief hash the foreman last recorded for `work`, from the private record (as the watcher
// judges a brief), or null when none is recorded.
export function recordedBriefOf(project, work, events = stateEvents(project)) {
  return recordedBriefs(events).get(work)?.recorded ?? null;
}

// The document the work names (its brief, design or report), for the foreman
// to read its goal, done lines and appetite from (ruling R84): `{ path,
// problem }`, the path full (a path in the record is taken from the project's
// main checkout), and the problem null only when the file is the one approved
// (ruling R97): its hash is the approval's, or for work that starts with no
// approval, the one the work event recorded. Null when the work names none.
export function documentOf(project, views, work) {
  const entry = views.work?.[work];
  const doc = entry?.work?.data?.doc;
  if (!isPlain(doc) || typeof doc.path !== 'string' || doc.path.trim() === '') return null;
  let full = doc.path;
  if (!path.isAbsolute(doc.path)) {
    try {
      full = path.join(checkoutOf(project), doc.path);
    } catch (error) {
      if (!(error instanceof ForemanError)) throw error;
    }
  }
  const text = readCapped(full, DOCUMENT_BYTES);
  const approved = typeof entry.approval?.hash === 'string' ? entry.approval.hash : doc.hash;
  let problem = null;
  if (text === null) problem = "can't be read";
  else if (briefHash(text) !== approved) problem = 'is not the one approved: it has changed since';
  return { path: oneLine(full, 300), problem };
}

// What holds back every start and go-ahead (ruling R95): STOP, or an open
// incident. Null when neither holds. `stop` says which; during an incident
// bug work still starts, plans and builds (ruling R101): see haltFor.
export function haltOf(views, { stopped = () => stopState().on } = {}) {
  if (stopped()) return { why: 'All stop is on', fixes: [], stop: true };
  const open = Array.isArray(views?.incidents?.open) ? views.incidents.open.filter(isPlain) : [];
  if (open.length === 0) return null;
  const ids = open.map((i) => oneLine(i.id, 40));
  return {
    why: `${ids.length === 1 ? 'incident' : 'incidents'} ${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} open`,
    fixes: open.flatMap((i) => (Array.isArray(i.fixes) ? i.fixes.filter(Number.isInteger) : [])),
    stop: false,
  };
}

// The lane whose work goes on during an open incident (ruling R101): the
// incident's own fix is recorded as a bug, so it must be able to start.
export const DURING_INCIDENT = 'bug';

// What holds back a start or a go-ahead for work in `lane`: `halt`, except that
// during an open incident (not under STOP) bug work may start, plan and build
// (ruling R101). Merges are never let through here: see mergeWait.
export function haltFor(halt, lane) {
  if (halt === null || halt === undefined) return null;
  return !halt.stop && lane === DURING_INCIDENT ? null : halt;
}

// Why pull request `pr` may not merge while `halt` holds, or null when it may:
// under STOP nothing merges; during an incident, only its recorded fix does.
export function mergeWait(halt, pr) {
  if (halt === null) return null;
  if (halt.stop) return `${halt.why}, and nothing merges while it is`;
  return halt.fixes.includes(pr) ? null : `${halt.why}, and only an incident's fix merges`;
}

// The open pull requests ready to merge as the watcher last saw them, from its
// own cursor: CI green on the head, a clean review, mergeable. `merge-ready` is
// raised once per head, so a merge held by STOP or an incident, or a fix whose
// merge-ready came before its incident-fix click, is offered again from here.
export function readyPrs(project) {
  const prs = readCursor(project).prev?.prs;
  if (!isPlain(prs)) return [];
  return Object.entries(prs)
    .filter(([key, p]) => /^[1-9][0-9]{0,9}$/.test(key) && isPlain(p) && typeof p.work === 'string' && SLUG.test(p.work)
      && p.ci === 'success' && p.review === 'clean' && p.mergeable === 'yes')
    .map(([key, p]) => ({ pr: Number(key), work: p.work, head: p.head }))
    .sort((a, b) => a.pr - b.pr);
}

// The longest an option's words may be (`act ask`), so wake read always prints them whole.
export const SAYS_CHARS = 300;

// The feature's worktree from its record, when it is a feature worktree of the
// project: inside the checkout's .claude/worktrees/, with a real feature folder.
export function worktreeOf(project, views, work) {
  const f = featureOf(views, work);
  if (f === null) refuse(`${work} has no feature recorded`);
  const worktree = f.worktree;
  if (!plainWorktreePath(worktree) || !inWorktreesFolder(checkoutOf(project), worktree) || !safeFeatureFolder(worktree)) {
    refuse(`${work}'s worktree isn't a feature worktree of this project`);
  }
  return worktree;
}

// The plan the feature's brief names (as the status hook's loadFeature finds
// it) and the files its tasks touch. The brief is read only when it is the one
// the foreman recorded (`recorded`, its hash; with none recorded, nothing is
// tampered, as the watcher judges it): a brief the session changed throws
// TamperedBrief, so no plan is ever taken from it.
export function planOf(worktree, { recorded = null } = {}) {
  const brief = readCapped(featurePaths(worktree).brief, DOCUMENT_BYTES);
  if (brief === null) refuse("the feature's brief can't be read");
  const found = briefHash(brief);
  if (recorded !== null && found !== recorded) throw new TamperedBrief(found, recorded);
  let feature;
  try {
    feature = loadFeature(worktree, { ledger: null });
  } catch {
    refuse("the feature's brief can't be read");
  }
  // Read twice: the brief must not have changed between the check and the reading.
  if (briefHash(readCapped(featurePaths(worktree).brief, DOCUMENT_BYTES) ?? '') !== found) refuse("the feature's brief changed while it was read");
  if (feature.plan === null) refuse('no plan is named in its brief or recorded with `plan`');
  const text = readPlan(worktree, feature.plan);
  if (text === null) refuse(`the plan ${feature.plan} can't be read in its worktree`);
  return { plan: feature.plan, files: fileMapOf(text) };
}

// Why a feature's next plan waits on its own pull request: the one pr.json
// keeps is not merged yet, so building now would go into it. Null when there
// is none or it has merged; the merge's phase change raises plan-ready again.
export function openPrWait(worktree) {
  const kept = readPrRecord(worktree);
  return kept !== null && !kept.merged ? `its pull request #${kept.pr} is still open; the next plan is checked once it merges` : null;
}

// The features whose recorded files are being changed, other than `work`'s.
export function runningFiles(views, work) {
  return Object.entries(views.features)
    .filter(([w, f]) => w !== work && CHANGING.includes(f?.data?.step) && Array.isArray(f.data.files))
    .map(([w, f]) => ({ work: w, files: f.data.files.filter((x) => typeof x === 'string') }));
}

export function clashFor(views, config, work, files) {
  return clashCheck({ files, running: runningFiles(views, work), hotFiles: config.hotFiles });
}

// Small or feature work whose session is planning: it can't take a slot yet.
function planning(views, id) {
  return !NO_PLAN.includes(laneOf(views, id)) && currentFeatureOf(views, id)?.step === 'started';
}

// Small or feature work not started (or queued again after its feature closed):
// its session would plan before it builds.
function unstartedWithPlan(views, id) {
  return !NO_PLAN.includes(laneOf(views, id)) && currentFeatureOf(views, id) === null;
}

// Work the new engine builds is never the old engine's to start (scripts/engine/lanes.js).
function queueWithout(views, leaveOut, now, builderCap) {
  const work = Object.fromEntries(Object.entries(views.work).filter(([id]) => !leaveOut(id) && !onNewEngine(views, id, { now })));
  return nextWork({ work, features: views.features, reports: views.reports, now, fiveHourTight: FIVE_HOUR_TIGHT, builderCap });
}

// The most that build at once beside pace at the Thoroughness level in force for `config` and the views' settings
// (EXTRA's builderCap: one at Lean and Lightest), or null for pace alone. Anything that can't be read is Balanced's.
export function builderCapOf(views, config, now) {
  const cap = routingFrom({ config, views, now }).extra?.builderCap;
  return Number.isInteger(cap) && cap >= 1 ? cap : null;
}

// The queue for starting sessions: nextWork, with work still planning left out.
export function queueToStart(views, { now, builderCap = null } = {}) {
  return queueWithout(views, (id) => planning(views, id), now, builderCap);
}

// The queue for building: nextWork, with work that has no plan yet left out
// (still planning, or small or feature work not started), except `keep`.
export function queueToBuild(views, { now, keep = null, builderCap = null } = {}) {
  return queueWithout(views, (id) => id !== keep && (planning(views, id) || unstartedWithPlan(views, id)), now, builderCap);
}

// Whether `work`'s plan may take a building slot now: `{ ok }` or `{ ok: false, why }`.
export function slotFor(views, work, { now, builderCap = null } = {}) {
  const f = featureOf(views, work) ?? { work };
  const features = { ...views.features, [work]: { ...(views.features[work] ?? { key: work }), data: { ...f, step: 'planned' } } };
  const q = queueToBuild({ ...views, features }, { now, keep: work, builderCap });
  if (q.start.includes(work)) return { ok: true };
  return { ok: false, why: q.hold.find((h) => h.work === work)?.why ?? 'unknown' };
}

const WHY = Object.freeze({
  pace: 'no building slot is free (pace)',
  dependency: 'waits for work it depends on to merge',
  unapproved: 'not approved yet',
  unknown: 'it is not in the queue: its work is not recorded, or has ended',
});
export const whyText = (why) => WHY[why] ?? why;

// Why a plan waits, as one sentence, or null when it may build.
export function waitText(clash, slot) {
  if (!clash.ok) {
    const [c] = clash.clashes;
    const more = clash.clashes.length > 1 ? ` (and ${clash.clashes.length - 1} more)` : '';
    return `its plan touches ${c.file}, which ${c.work} is changing${c.hot ? ' (a hot file)' : ''}${more}`;
  }
  if (!slot.ok) return whyText(slot.why);
  return null;
}

// --- Reading a wake ---

function shortHash(h) {
  return typeof h === 'string' && h !== '' ? h.slice(0, 12) : 'unknown';
}
const short = shortHash;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// What a stuck feature's recorded step says of it: held work (planned, or
// paused) waits on purpose, so there is nothing to ask. Null when its step
// is not one that holds it.
function heldLine(work, ctx) {
  if (ctx.views === null) return null;
  const f = featureOf(ctx.views, work);
  if (f?.step === 'paused') {
    return pausedBy(f) === 'director'
      ? 'it waits: the director paused it, and only their amendment beginning "Resume" lifts it. Nothing to do'
      : 'it waits: paused for the five-hour window; the queue below says when it may resume. Nothing to do';
  }
  if (f?.step !== 'planned') return null;
  let own = null;
  try {
    own = openPrWait(worktreeOf(ctx.project, ctx.views, work));
  } catch (error) {
    if (!(error instanceof ForemanError)) throw error;
  }
  const halt = haltFor(ctx.halt, laneOf(ctx.views, work));
  const wait = own ?? halt?.why ?? (ctx.config === null
    ? null
    : waitText(clashFor(ctx.views, ctx.config, work, Array.isArray(f.files) ? f.files : []), slotFor(ctx.views, work, { now: ctx.now, builderCap: builderCapOf(ctx.views, ctx.config, ctx.now) })));
  return wait === null
    ? 'it is planned work held until it may build; the queue below says whether it may build now. Nothing to do'
    : `it waits: ${wait}. Nothing to do`;
}

// What each event says, and its next step where that is certain.
function eventLine(e, ctx) {
  const d = isPlain(e.detail) ? e.detail : {};
  const head = `- ${e.type}${typeof e.work === 'string' ? ` ${e.work}` : ''}`;
  const said = (text, next) => `${head}: ${oneLine(text)}${next ? `. ${next}` : ''}`;
  const work = e.work;
  switch (e.type) {
    case 'work-ready': return said(`lane ${d.lane ?? 'unknown'}, ready to start; see the queue below`);
    // Each amendment by its own hash, so several in one wake are each applied, in order.
    case 'amended': return typeof d.hash === 'string' && HASH.test(d.hash)
      ? said(`the director changed it (${short(d.hash)})`, `Next: act amend ${work} ${d.hash}`)
      : said('the director changed it, but the change\'s hash can\'t be read', 'Ask the director: act ask');
    case 'question': return said(e.id, `Next: act question ${work} ${e.id}`);
    case 'extra-plan': return said(e.id, `Next: act extra-plan ${work} ${e.id}`);
    case 'answer': {
      if (questionIdOf(d.questionId)?.foreman !== true) return said(`${d.questionId} answered "${oneLine(d.label, 60)}"`, 'Nothing to do: the watcher wakes its session.');
      // The option chosen, with what it says to do: one whole act command, or waiting.
      const q = ctx.views?.questions?.[d.questionId]?.question?.data;
      const asked = typeof q?.what === 'string' ? ` ("${oneLine(q.what, 100)}")` : '';
      const says = Array.isArray(q?.options) ? q.options.find((o) => isPlain(o) && o.label === d.label)?.says : undefined;
      const answered = `${head}: the director answered your question ${oneLine(d.questionId, 60)}${asked}: "${oneLine(d.label, 60)}"`;
      if (typeof says !== 'string') return `${answered}, but that option's words can't be read. Ask the director: act ask`;
      return `${answered}, which says: ${oneLine(says, SAYS_CHARS)}. Act on it.`;
    }
    case 'merge-ready': {
      const wait = mergeWait(ctx.halt, e.pr);
      return said(`pull request #${e.pr} at ${short(d.head)}`, wait !== null ? `It waits: ${wait}` : `Next: act merge ${work}`);
    }
    case 'lift-incident': return said(`incident ${d.incident} is over`, 'Pull requests ready to merge are listed in the queue below');
    case 'incident-fix': return said(`pull request #${d.pr} is the fix for incident ${d.incident}`, 'When it is ready to merge, the queue below lists it');
    // The click a merge waited for (ruling R117): the merge goes ahead from the queue.
    case 'approval': return said(`the director approved pull request #${d.pr} at ${short(d.head)}`, 'When it is ready to merge, the queue below lists it');
    case 'ci-push': return said(
      `the director clicked to push ${d.branch} at ${short(d.sha)}, which changes a CI file, for pull request #${d.pr}`,
      'When it is ready to merge, the queue below lists it',
    );
    case 'report': return said('it has ended, and its report is written', `Next: act close ${work}`);
    case 'stuck': {
      const still = `no progress for ${Math.round((Number(d.still) || 0) / 60000)} minutes, at phase ${d.phase ?? 'unknown'}`;
      const held = heldLine(work, ctx);
      return held !== null ? `${head}: ${oneLine(still)}; ${held}.` : said(still, 'Ask the director: act ask');
    }
    case 'over-appetite': return said(`${d.tokens} tokens used against an appetite of ${d.appetite}`, 'Ask the director: act ask');
    case 'brief-tampered': return said(`its brief reads ${short(d.found)}, not the ${short(d.recorded)} recorded`, 'Ask the director: act ask');
    case 'clash': return said(`${d.a} and ${d.b} no longer merge cleanly together`);
    // The event says STOP was turned on; a wake held while it was on may be read after the lift.
    case 'stop': return ctx.halt?.stop === true
      ? `${head}: All stop was turned on, and it is on now. Start no more work.`
      : `${head}: All stop was turned on, but it is off now: read where things stand below.`;
    case 'incident': return said(`${d.incident}: ${d.what}`, 'Start no more work but bug work, which may start and build; merges are frozen but for its fix.');
    case 'long-gap': return said(`the watcher was off since ${d.since}: read where things stand below`);
    case 'plan-ready': return planReadyLine(head, work, ctx);
    default: return said(JSON.stringify(d) ?? '');
  }
}

function planReadyLine(head, work, ctx) {
  if (ctx.views === null || ctx.config === null) return `${head}: its plan is ready, but whether it may build is unknown until ${ctx.unknown}. Nothing can be run for it now`;
  // Quick and bug work have no plan: one its session recorded anyway changes nothing.
  const lane = laneOf(ctx.views, work);
  if (NO_PLAN.includes(lane)) return `${head}: it is ${lane} work, which has no plan and builds as it goes. Nothing to do`;
  let found;
  try {
    found = planOf(worktreeOf(ctx.project, ctx.views, work), { recorded: recordedBriefOf(ctx.project, work) });
  } catch (error) {
    if (error instanceof TamperedBrief) return `${head}: ${error.message}. Ask the director: act ask`;
    if (!(error instanceof ForemanError)) throw error;
    return `${head}: its plan can't be read: ${oneLine(error.message)}. Ask the director: act ask`;
  }
  const clash = clashFor(ctx.views, ctx.config, work, found.files);
  const wait = openPrWait(worktreeOf(ctx.project, ctx.views, work)) ?? haltFor(ctx.halt, lane)?.why ?? waitText(clash, slotFor(ctx.views, work, { now: ctx.now, builderCap: builderCapOf(ctx.views, ctx.config, ctx.now) }));
  const plan = `plan ${oneLine(found.plan, 120)}, ${plural(found.files.length, 'file')}`;
  return `${head}: ${plan}. ${wait === null ? 'It clears the clash check and a slot is free' : `It waits: ${wait}`}. Next: act plan-ready ${work}`;
}

function digestLine(digest, dropped) {
  const counts = new Map();
  for (const e of digest) {
    const type = isPlain(e) && typeof e.type === 'string' ? e.type : 'unknown';
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const older = dropped > 0 ? `, and ${dropped} older ${dropped === 1 ? 'one' : 'ones'} dropped` : '';
  if (digest.length === 0) return dropped > 0 ? `Digest: none kept${older}.` : 'Digest: none.';
  const byType = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([t, n]) => `${t} ${n}`).join(', ');
  return `Digest: ${plural(digest.length, 'event')} (${byType})${older}.`;
}

function queueLines(ctx) {
  const { views, config, now } = ctx;
  const lines = [];
  // Work queued again after its feature closed counts as not started (R102).
  const recorded = (id) => currentFeatureOf(views, id) !== null;
  const flags = '--done … --appetite-sessions … --appetite-tokens …';
  // What to do about work that may open a session: start it from its approved
  // document (R84, R97), or for an extra plan from the part of its parent's
  // document its title names (R99); or wait while STOP or an incident holds
  // (R95), though bug work starts during an incident (R101).
  const startLine = (id) => {
    const halt = haltFor(ctx.halt, laneOf(views, id));
    if (halt !== null) return `It waits: ${halt.why}.`;
    const data = views.work[id].work.data;
    const doc = documentOf(ctx.project, views, id);
    if (doc === null) return 'It names no document to read its goal from. Ask the director: act ask';
    if (doc.problem !== null) return `Its document ${doc.path} ${doc.problem}. Ask the director: act ask`;
    if (typeof data.parent === 'string') {
      return `It is an extra plan of ${data.parent}, titled "${oneLine(data.title, 120)}". Next: act start ${id} --goal '<its title>' ${flags} `
        + `(from the part of ${data.parent}'s approved document, ${doc.path}, that its title names)`;
    }
    // Quick, bug and small work: the lane's appetite, where the document sets none (LANE_APPETITE).
    const own = LANE_APPETITE[data.lane];
    if (own) {
      return `Next: act start ${id} --goal … --done … --appetite-sessions ${own.sessions} --appetite-tokens ${own.tokens} `
        + `(from its approved document, ${doc.path}; the ${data.lane} lane's appetite)`;
    }
    return `Next: act start ${id} --goal … ${flags} (from its approved document, ${doc.path})`;
  };

  // Work not started: what may open a session now.
  const builderCap = builderCapOf(views, config, now);
  const toStart = queueToStart(views, { now, builderCap });
  for (const id of toStart.start) {
    if (!recorded(id)) lines.push(`- start ${id} (${laneOf(views, id)}): approved. ${startLine(id)}`);
  }
  for (const { work: id, why } of toStart.hold) {
    if (recorded(id)) continue;
    const lane = laneOf(views, id);
    const opens = ['pace', 'dependency'].includes(why) && PLANS_WHILE_HELD.includes(lane);
    lines.push(`- hold ${id} (${lane}): ${whyText(why)}${opens ? `; it may open a session to plan. ${startLine(id)}` : '.'}`);
  }
  // The rulings a brief may carry, by id, when there is work to start.
  if (lines.some((line) => line.includes('Next: act start '))) {
    const accepted = (Array.isArray(views.rulebook) ? views.rulebook : []).filter((r) => isPlain(r) && r.status === 'accepted' && typeof r.id === 'string');
    lines.push(`Rulings in force: ${accepted.length > 0 ? `${accepted.length}; give each that applies with --ruling <id>.` : 'none.'}`);
    for (const r of accepted) lines.push(`- ruling ${oneLine(r.id, 80)}: ${oneLine(r.words, 160)}`);
  }

  // Recorded plans: which may build now, and why the rest wait.
  const toBuild = queueToBuild(views, { now, builderCap });
  const held = new Map(toBuild.hold.map((h) => [h.work, h.why]));
  for (const [id, f] of Object.entries(views.features)) {
    const step = f?.data?.step;
    if (step !== 'planned' && step !== 'paused') continue;
    // Only a pause for the five-hour window is the foreman's to lift, and only while the window isn't tight.
    if (step === 'paused' && (pausedBy(f.data) === 'director' || FIVE_HOUR_TIGHT)) continue;
    const verb = step === 'paused' ? 'resume' : 'build';
    const clash = clashFor(views, config, id, Array.isArray(f.data.files) ? f.data.files : []);
    const slot = toBuild.start.includes(id) ? { ok: true } : { ok: false, why: held.get(id) ?? 'unknown' };
    let own = null;
    try {
      own = step === 'planned' ? openPrWait(worktreeOf(ctx.project, views, id)) : null;
    } catch (error) {
      if (!(error instanceof ForemanError)) throw error;
    }
    const wait = own ?? haltFor(ctx.halt, laneOf(views, id))?.why ?? waitText(clash, slot);
    lines.push(wait === null
      ? `- ${verb} ${id}: its plan clears the clash check and a slot is free. Next: act ${verb} ${id}`
      : `- ${verb} ${id}: waits: ${wait}.`);
  }
  for (const id of toBuild.pause) lines.push(`- pause ${id}: the five-hour window is tight. Next: act pause ${id}`);

  // Pull requests ready to merge, but for those this wake's merge-ready lines name.
  const raised = new Set(ctx.events.filter((e) => e.type === 'merge-ready').map((e) => e.pr));
  for (const { pr, work, head } of readyPrs(ctx.project)) {
    if (raised.has(pr)) continue;
    const wait = mergeWait(ctx.halt, pr);
    lines.push(wait === null
      ? `- merge ${work}: pull request #${pr} at ${short(head)} is ready to merge. Next: act merge ${work}`
      : `- merge ${work}: pull request #${pr} is ready to merge, but waits: ${wait}.`);
  }
  const q = toBuild;

  const steps = Object.entries(views.features).filter(([, f]) => isPlain(f?.data));
  const planning = steps.filter(([id, f]) => f.data.step === 'started' && !NO_PLAN.includes(laneOf(views, id))).map(([id]) => id);
  const building = steps.filter(([id, f]) => f.data.step === 'building' || (f.data.step === 'started' && NO_PLAN.includes(laneOf(views, id)))).map(([id]) => id);
  const paused = (why) => steps.filter(([, f]) => f.data.step === 'paused' && pausedBy(f.data) === why).map(([id]) => id);
  if (planning.length > 0) lines.push(`Planning: ${planning.join(', ')}.`);
  lines.push(`Building (${building.length} of ${builderCap === null ? PACE.building : Math.min(PACE.building, builderCap)}): ${building.length > 0 ? building.join(', ') : 'none'}.`);
  if (builderCap !== null) lines.push(`Thoroughness: ${builderCap === 1 ? 'one builds' : `${builderCap} build`} at a time at this level.`);
  if (paused('five-hour').length > 0) lines.push(`Paused for the five-hour window: ${paused('five-hour').join(', ')}.`);
  if (paused('director').length > 0) lines.push(`Paused by the director: ${paused('director').join(', ')}. Only their amendment beginning "Resume" lifts it.`);
  if (q.pause.length === 0) lines.push('Pause: none. The five-hour window is not known yet, so it is taken as not tight.');
  return lines;
}

// The lines `read` prints for the wake in `file`.
export async function readWakeLines({
  file, project, client, now = () => new Date(), pluginRoot = PLUGIN_ROOT, platform = process.platform, stopped = () => stopState().on,
}) {
  const wake = readWake(file);
  if (wake === null) refuse(`This isn't a wake that can be read: ${oneLine(file, 120)}`);
  if (wake.to !== 'foreman') refuse("This wake is for a feature session, not the Bosun");
  // Without the configuration or the views, the events are still read; the queue and clash answers are unknown.
  const missing = [];
  let config = null;
  try {
    config = await loadConfig(project, client);
  } catch (error) {
    if (!(error instanceof ForemanError)) throw error;
    missing.push(oneLine(error.message, 160));
  }
  let read = null;
  try {
    read = await loadViews(project, client, { kept: true });
  } catch (error) {
    if (!(error instanceof ForemanError)) throw error;
    missing.push(oneLine(error.message, 160));
  }
  const unknown = missing.length > 0 ? missing.join('; ').replace(/^./, (c) => c.toLowerCase()) : null;
  const halt = haltOf(read?.views ?? null, { stopped });
  const events = Array.isArray(wake.events) ? wake.events.filter(isPlain) : [];
  const ctx = {
    project, config, views: read?.views ?? null, now, unknown, halt, events,
  };
  const digest = Array.isArray(wake.digest) ? wake.digest : [];
  const dropped = Number.isInteger(wake.dropped) && wake.dropped > 0 ? wake.dropped : 0;

  const lines = [`Wake ${path.basename(file, '.json')}, made ${wake.at}: ${plural(events.length, 'event')}.`];
  // The commands exactly as the foreman's allow rules match them (ruling R96).
  let commands = null;
  try {
    commands = foremanCommands(pluginRoot, { platform });
  } catch (error) {
    lines.push(`The commands can't be given: ${oneLine(error instanceof Error ? error.message : 'unknown error', 200)}.`);
  }
  if (commands !== null) lines.push(`Run wake as: ${commands.wake}`, `Run act as: ${commands.act}`);
  // While STOP or an incident holds, nothing starts or builds (ruling R95),
  // but for bug work during an incident (ruling R101).
  if (halt !== null) {
    const fixes = halt.fixes.length > 0 ? ` but for ${halt.fixes.map((n) => `#${n}`).join(', ')}, its fix` : '';
    const bugs = halt.stop ? '' : ' Bug work still starts and builds, since the incident\'s own fix is recorded as a bug.';
    lines.push(`Hold: ${halt.why}. Start nothing and give no go-ahead: act start, plan-ready, build and resume wait or refuse, and no pull request merges${fixes}.${bugs}`);
  }
  if (typeof wake.note === 'string' && wake.note !== '') lines.push(oneLine(wake.note, 600));
  if (read !== null && !read.fresh) lines.push(`The helper gave no views (${oneLine(read.why, 120)}), so these are the last ones it wrote.`);
  lines.push('Events:');
  if (events.length === 0) lines.push('- none');
  for (const e of events) lines.push(eventLine(e, ctx));
  lines.push(digestLine(digest, dropped));
  lines.push('Queue:');
  if (unknown !== null) lines.push(`- unknown: ${unknown}. Start and build nothing until it can be read.`);
  else lines.push(...queueLines(ctx));
  return { lines };
}

// --- Recording each wake ---

export const measuresFile = (project) => path.join(watcherDir(project), 'measures.jsonl');

function measureLines(project) {
  const file = measuresFile(project);
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch { /* none yet */ }
  if (stat === null) return [];
  const text = readCapped(file, MEASURES_BYTES);
  if (text === null) refuse("The wakes' measures can't be read");
  const lines = [];
  for (const line of text.split('\n')) {
    try {
      const m = JSON.parse(line);
      if (isPlain(m) && typeof m.wake === 'string' && ['acted', 'idle'].includes(m.outcome)) lines.push(m);
    } catch { /* a damaged line */ }
  }
  return lines;
}

const count = (events, types) => events.filter((e) => isPlain(e) && types.includes(e.type)).length;

// Records how the wake in `file` ended, once: `{ recorded, wake }`.
export function recordDone({ file, project, outcome, now = () => new Date() }) {
  if (!['acted', 'idle'].includes(outcome)) refuse('A wake is done --acted or --idle');
  const wake = readWake(file);
  if (wake === null) refuse(`This isn't a wake that can be read: ${oneLine(file, 120)}`);
  if (wake.to !== 'foreman') refuse("This wake is for a feature session, not the Bosun");
  const id = path.basename(file, '.json');
  if (measureLines(project).some((m) => m.wake === id)) return { recorded: false, wake: id };
  const all = [...(Array.isArray(wake.events) ? wake.events : []), ...(Array.isArray(wake.digest) ? wake.digest : [])];
  const line = {
    at: now().toISOString(),
    wake: id,
    outcome,
    events: Array.isArray(wake.events) ? wake.events.length : 0,
    conflicts: count(all, ['conflict', 'clash']),
    merges: count(all, ['merge-ready']),
  };
  watcherFolder(project);
  const target = measuresFile(project);
  let stat = null;
  try {
    stat = fs.lstatSync(target);
  } catch { /* made below */ }
  if (stat !== null && !stat.isFile()) refuse("The wakes' measures can't be written");
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(line)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  return { recorded: true, wake: id };
}

// Design section 15's measures: idle wakes over all wakes, and conflicts over
// merges (each 0 when there is nothing to divide by).
export function measures(project) {
  const { idleShare, conflictsPerMerge } = countMeasures(measureLines(project));
  return { idleShare, conflictsPerMerge };
}

// The measures of the lines read once, with the counts behind them.
function countMeasures(lines) {
  const idle = lines.filter((m) => m.outcome === 'idle').length;
  const num = (x) => (Number.isFinite(x) && x >= 0 ? x : 0);
  const conflicts = lines.reduce((n, m) => n + num(m.conflicts), 0);
  const merges = lines.reduce((n, m) => n + num(m.merges), 0);
  return {
    idleShare: lines.length === 0 ? 0 : idle / lines.length, conflictsPerMerge: merges === 0 ? 0 : conflicts / merges, idle, wakes: lines.length,
  };
}

// --- The command line ---

const USAGE = 'Commands: read <file>, done <file> --acted|--idle, measures';

// The wake `given` names, when it is a file in the main checkout's .wheelhouse/foreman/wakes/
// (where the waker copies the foreman's wakes), by its real path: no argument makes `read` or
// `done` open any other file.
function foremanWake(project, cwd, given) {
  let file = null;
  let dir = null;
  try {
    file = fs.realpathSync.native(path.resolve(cwd, given));
    dir = fs.realpathSync.native(path.join(checkoutOf(project), '.wheelhouse', 'foreman', 'wakes'));
  } catch (error) {
    if (error instanceof ForemanError) throw error;
  }
  if (file === null || dir === null || path.dirname(file) !== dir) refuse(`This isn't a wake copied for the Bosun: ${oneLine(given, 120)}`);
  return file;
}

export async function main(argv, {
  cwd = process.cwd(), project: given, client = helperClient(), now = () => new Date(),
  out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [command, ...rest] = argv;
    const project = given ?? projectHere(cwd);
    if (command === 'read') {
      if (rest.length !== 1) refuse('Give the wake file: read <file>');
      const { lines } = await readWakeLines({ file: foremanWake(project, cwd, rest[0]), project, client, now });
      out(`${lines.join('\n')}\n`);
    } else if (command === 'done') {
      const flags = rest.slice(1);
      if (rest.length !== 2 || !['--acted', '--idle'].includes(flags[0])) refuse('Give the wake file and how it went: done <file> --acted, or done <file> --idle');
      const outcome = flags[0].slice(2);
      const { recorded, wake } = recordDone({ file: foremanWake(project, cwd, rest[0]), project, outcome, now });
      out(recorded ? `Recorded wake ${wake} as ${outcome}.\n` : `Wake ${wake} was recorded already.\n`);
    } else if (command === 'measures') {
      if (rest.length !== 0) refuse('measures takes nothing more');
      const m = countMeasures(measureLines(project));
      out(`Idle wakes: ${m.idle} of ${m.wakes} (${Math.round(m.idleShare * 100)}%). Conflicts per merge: ${Math.round(m.conflictsPerMerge * 100) / 100}.\n`);
    } else {
      refuse(USAGE);
    }
    return 0;
  } catch (error) {
    err(`${error instanceof ForemanError ? oneLine(error.message, 400) : `That did not work: ${oneLine(error instanceof Error ? error.message : 'unknown error', 300)}`}\n`);
    return 1;
  }
}

// Run as a command, it forwards to the host helper, which runs `main` outside the sandbox (ruling R156).
if (startedAsScript(import.meta.url)) {
  process.exitCode = await forward('wake', process.argv.slice(2));
}
