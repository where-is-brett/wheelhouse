// scripts/foreman/wake.js
// The foreman's reading of a wake, and its record of each one (build-loop
// design, sections 8, 11 and 15). The foreman is a fresh session at every
// wake; it reads conclusions, not files, so this works them out:
//   node wake.js read <file>
//     One short line per event (its type, its work, the detail that matters
//     and, where the next step is certain, `Next: act …`), the digest counted
//     by type and never listed, then the queue's answer: what may start, which
//     recorded plans may build or must wait and why, what is planning and
//     what is building. For each `plan-ready` the plan's files are read and
//     checked for clashes against the running features' recorded files and
//     the configuration's hot files.
//   node wake.js done <file> --acted | --idle
//     Appends `{ at, wake, outcome, events, conflicts, merges }` to
//     projects/<p>/watcher/measures.jsonl, once per wake (the wake's id is its
//     file's name). `conflicts` counts the bundle's `conflict` and `clash`
//     events, `merges` its `merge-ready` events, in its events and its digest.
//   node wake.js measures
//     The idle share and the conflicts per merge (design section 15).
// The project is the one whose folder the command runs in: the foreman runs
// in the project's main checkout.
//
// Where it reads from. The views are the helper's: asked for afresh, which
// rebuilds them from the state clone, or when the helper does not answer, the
// last ones it wrote (as scripts/feature/status.js reads a view), and the
// output says so. The configuration is the default branch's, through the
// helper (ruling R50), never the working copy. A feature's plan is read only
// from its worktree, through the safe readers of scripts/feature/status.js,
// and only from a worktree inside the checkout's .claude/worktrees/.
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
import { pathToFileURL } from 'node:url';
import { clashCheck, fileMapOf, nextWork } from './queue.js';
import { loadFeature, readCapped, readPlan, safeFeatureFolder } from '../feature/status.js';
import { helperClient } from '../host/helper-client.js';
import { PACE } from '../lib/build-loop.js';
import { wheelhouseHome } from '../lib/paths.js';
import { projectForFolder, readProject } from '../lib/projects.js';
import { projectConfig } from '../watcher/main.js';
import { inWorktreesFolder, plainWorktreePath } from '../watcher/sources.js';
import { readWake, watcherDir, watcherFolder } from '../watcher/waker.js';

// A refusal, said to the foreman as one plain line.
export class ForemanError extends Error {}

// Until the usage plan supplies it.
export const FIVE_HOUR_TIGHT = false;

const VIEW_NAMES = ['work', 'features', 'reports', 'questions', 'rulebook'];
const VIEW_BYTES = 8 * 1024 * 1024;
const MEASURES_BYTES = 64 * 1024 * 1024;
const LINE_CHARS = 200;
// The lanes that build as soon as they start: no plan.
export const NO_PLAN = Object.freeze(['quick', 'bug']);
// The lanes whose work, held for pace or a dependency, may still open a session to plan (ruling R60).
export const PLANS_WHILE_HELD = Object.freeze(['small', 'feature', 'bug']);
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
  if (!found) refuse("This folder isn't in a Wheelhouse project: run the foreman's commands from the project's main checkout");
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
// it) and the files its tasks touch.
export function planOf(worktree) {
  let feature;
  try {
    feature = loadFeature(worktree, { ledger: null });
  } catch {
    refuse("the feature's brief can't be read");
  }
  if (feature.plan === null) refuse("the feature's brief names no plan");
  const text = readPlan(worktree, feature.plan);
  if (text === null) refuse(`the plan ${feature.plan} can't be read in its worktree`);
  return { plan: feature.plan, files: fileMapOf(text) };
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
  return !NO_PLAN.includes(laneOf(views, id)) && featureOf(views, id)?.step === 'started';
}

// Small or feature work not started: its session would plan before it builds.
function unstartedWithPlan(views, id) {
  return !NO_PLAN.includes(laneOf(views, id)) && featureOf(views, id) === null;
}

function queueWithout(views, leaveOut, now) {
  const work = Object.fromEntries(Object.entries(views.work).filter(([id]) => !leaveOut(id)));
  return nextWork({ work, features: views.features, reports: views.reports, now, fiveHourTight: FIVE_HOUR_TIGHT });
}

// The queue for starting sessions: nextWork, with work still planning left out.
export function queueToStart(views, { now } = {}) {
  return queueWithout(views, (id) => planning(views, id), now);
}

// The queue for building: nextWork, with work that has no plan yet left out
// (still planning, or small or feature work not started), except `keep`.
export function queueToBuild(views, { now, keep = null } = {}) {
  return queueWithout(views, (id) => id !== keep && (planning(views, id) || unstartedWithPlan(views, id)), now);
}

// Whether `work`'s plan may take a building slot now: `{ ok }` or `{ ok: false, why }`.
export function slotFor(views, work, { now } = {}) {
  const f = featureOf(views, work) ?? { work };
  const features = { ...views.features, [work]: { ...(views.features[work] ?? { key: work }), data: { ...f, step: 'planned' } } };
  const q = queueToBuild({ ...views, features }, { now, keep: work });
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

const short = (h) => (typeof h === 'string' && h !== '' ? h.slice(0, 12) : 'unknown');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// What each event says, and its next step where that is certain.
function eventLine(e, ctx) {
  const d = isPlain(e.detail) ? e.detail : {};
  const head = `- ${e.type}${typeof e.work === 'string' ? ` ${e.work}` : ''}`;
  const said = (text, next) => `${head}: ${oneLine(text)}${next ? `. ${next}` : ''}`;
  const work = e.work;
  switch (e.type) {
    case 'work-ready': return said(`lane ${d.lane ?? 'unknown'}, ready to start; see the queue below`);
    case 'amended': return said(`the director changed it (${short(d.hash)})`, `Next: act amend ${work}`);
    case 'question': return said(e.id, `Next: act question ${work} ${e.id}`);
    case 'extra-plan': return said(e.id, `Next: act extra-plan ${work} ${e.id}`);
    case 'answer': return said(`${d.questionId} answered "${oneLine(d.label, 60)}"`, 'Nothing to do: the watcher wakes its session.');
    case 'merge-ready': return said(`pull request #${e.pr} at ${short(d.head)}`, `Next: act merge ${work}`);
    case 'stuck': return said(`no progress for ${Math.round((Number(d.still) || 0) / 60000)} minutes, at phase ${d.phase ?? 'unknown'}`, 'Ask the director: act ask');
    case 'over-appetite': return said(`${d.tokens} tokens used against an appetite of ${d.appetite}`, 'Ask the director: act ask');
    case 'brief-tampered': return said(`its brief reads ${short(d.found)}, not the ${short(d.recorded)} recorded`, 'Ask the director: act ask');
    case 'clash': return said(`${d.a} and ${d.b} no longer merge cleanly together`);
    case 'stop': return `${head}: STOP is on. Start no more work.`;
    case 'incident': return said(`${d.incident}: ${d.what}`, 'Start no more work; merges are frozen but for its fix.');
    case 'long-gap': return said(`the watcher was off since ${d.since}: read where things stand below`);
    case 'plan-ready': return planReadyLine(head, work, ctx);
    default: return said(JSON.stringify(d) ?? '');
  }
}

function planReadyLine(head, work, ctx) {
  let found;
  try {
    found = planOf(worktreeOf(ctx.project, ctx.views, work));
  } catch (error) {
    if (!(error instanceof ForemanError)) throw error;
    return `${head}: its plan can't be read: ${oneLine(error.message)}. Ask the director: act ask`;
  }
  const clash = clashFor(ctx.views, ctx.config, work, found.files);
  const wait = waitText(clash, slotFor(ctx.views, work, { now: ctx.now }));
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
  const recorded = (id) => featureOf(views, id) !== null;
  const startLine = (id) => `Next: act start ${id} --goal … --done … --appetite-sessions … --appetite-tokens … (from its approved document)`;

  // Work not started: what may open a session now.
  const toStart = queueToStart(views, { now });
  for (const id of toStart.start) {
    if (!recorded(id)) lines.push(`- start ${id} (${laneOf(views, id)}): approved. ${startLine(id)}`);
  }
  for (const { work: id, why } of toStart.hold) {
    if (recorded(id)) continue;
    const lane = laneOf(views, id);
    const opens = ['pace', 'dependency'].includes(why) && PLANS_WHILE_HELD.includes(lane);
    lines.push(`- hold ${id} (${lane}): ${whyText(why)}${opens ? `; it may open a session to plan. ${startLine(id)}` : '.'}`);
  }

  // Recorded plans: which may build now, and why the rest wait.
  const toBuild = queueToBuild(views, { now });
  const held = new Map(toBuild.hold.map((h) => [h.work, h.why]));
  for (const [id, f] of Object.entries(views.features)) {
    const step = f?.data?.step;
    if (step !== 'planned' && step !== 'paused') continue;
    const verb = step === 'paused' ? 'resume' : 'build';
    const clash = clashFor(views, config, id, Array.isArray(f.data.files) ? f.data.files : []);
    const slot = toBuild.start.includes(id) ? { ok: true } : { ok: false, why: held.get(id) ?? 'unknown' };
    const wait = waitText(clash, slot);
    lines.push(wait === null
      ? `- ${verb} ${id}: its plan clears the clash check and a slot is free. Next: act ${verb} ${id}`
      : `- ${verb} ${id}: waits: ${wait}.`);
  }
  for (const id of toBuild.pause) lines.push(`- pause ${id}: the five-hour window is tight. Next: act pause ${id}`);
  const q = toBuild;

  const steps = Object.entries(views.features).filter(([, f]) => isPlain(f?.data));
  const planning = steps.filter(([id, f]) => f.data.step === 'started' && !NO_PLAN.includes(laneOf(views, id))).map(([id]) => id);
  const building = steps.filter(([id, f]) => f.data.step === 'building' || (f.data.step === 'started' && NO_PLAN.includes(laneOf(views, id)))).map(([id]) => id);
  const paused = steps.filter(([, f]) => f.data.step === 'paused').map(([id]) => id);
  if (planning.length > 0) lines.push(`Planning: ${planning.join(', ')}.`);
  lines.push(`Building (${building.length} of ${PACE.building}): ${building.length > 0 ? building.join(', ') : 'none'}.`);
  if (paused.length > 0) lines.push(`Paused: ${paused.join(', ')}.`);
  if (q.pause.length === 0) lines.push('Pause: none. The five-hour window is not known yet, so it is taken as not tight.');
  return lines;
}

// The lines `read` prints for the wake in `file`.
export async function readWakeLines({ file, project, client, now = () => new Date() }) {
  const wake = readWake(file);
  if (wake === null) refuse(`This isn't a wake that can be read: ${oneLine(file, 120)}`);
  if (wake.to !== 'foreman') refuse("This wake is for a feature session, not the foreman");
  const config = await loadConfig(project, client);
  const read = await loadViews(project, client, { kept: true });
  const ctx = { project, config, views: read.views, now };
  const events = Array.isArray(wake.events) ? wake.events.filter(isPlain) : [];
  const digest = Array.isArray(wake.digest) ? wake.digest : [];
  const dropped = Number.isInteger(wake.dropped) && wake.dropped > 0 ? wake.dropped : 0;

  const lines = [`Wake ${path.basename(file, '.json')}, made ${wake.at}: ${plural(events.length, 'event')}.`];
  if (typeof wake.note === 'string' && wake.note !== '') lines.push(oneLine(wake.note, 600));
  if (!read.fresh) lines.push(`The helper gave no views (${oneLine(read.why, 120)}), so these are the last ones it wrote.`);
  lines.push('Events:');
  if (events.length === 0) lines.push('- none');
  for (const e of events) lines.push(eventLine(e, ctx));
  lines.push(digestLine(digest, dropped));
  lines.push('Queue:');
  lines.push(...queueLines(ctx));
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
  const lines = measureLines(project);
  const idle = lines.filter((m) => m.outcome === 'idle').length;
  const num = (x) => (Number.isFinite(x) && x >= 0 ? x : 0);
  const conflicts = lines.reduce((n, m) => n + num(m.conflicts), 0);
  const merges = lines.reduce((n, m) => n + num(m.merges), 0);
  return { idleShare: lines.length === 0 ? 0 : idle / lines.length, conflictsPerMerge: merges === 0 ? 0 : conflicts / merges };
}

// --- The command line ---

const USAGE = 'Commands: read <file>, done <file> --acted|--idle, measures';

export async function main(argv, {
  cwd = process.cwd(), project: given, client = helperClient(), now = () => new Date(),
  out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [command, ...rest] = argv;
    const project = given ?? projectHere(cwd);
    if (command === 'read') {
      if (rest.length !== 1) refuse('Give the wake file: read <file>');
      const { lines } = await readWakeLines({ file: path.resolve(cwd, rest[0]), project, client, now });
      out(`${lines.join('\n')}\n`);
    } else if (command === 'done') {
      const flags = rest.slice(1);
      if (rest.length !== 2 || !['--acted', '--idle'].includes(flags[0])) refuse('Give the wake file and how it went: done <file> --acted, or done <file> --idle');
      const outcome = flags[0].slice(2);
      const { recorded, wake } = recordDone({ file: path.resolve(cwd, rest[0]), project, outcome, now });
      out(recorded ? `Recorded wake ${wake} as ${outcome}.\n` : `Wake ${wake} was recorded already.\n`);
    } else if (command === 'measures') {
      if (rest.length !== 0) refuse('measures takes nothing more');
      const m = measures(project);
      const lines = measureLines(project);
      const idle = lines.filter((x) => x.outcome === 'idle').length;
      out(`Idle wakes: ${idle} of ${lines.length} (${Math.round(m.idleShare * 100)}%). Conflicts per merge: ${Math.round(m.conflictsPerMerge * 100) / 100}.\n`);
    } else {
      refuse(USAGE);
    }
    return 0;
  } catch (error) {
    err(`${error instanceof ForemanError ? oneLine(error.message, 400) : `That did not work: ${oneLine(error instanceof Error ? error.message : 'unknown error', 300)}`}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
