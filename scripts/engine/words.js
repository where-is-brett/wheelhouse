// scripts/engine/words.js
// The engine's words turned into the director's (Archon design, sections 2 and 4.1): each step of the pack in plain
// words, and the lines the work view, the Logbook's build tab and the briefing show for runs and their cost. No line
// holds a run id, a step id or the engine's own words; the director never sees them.
import { runningMinutes } from './spend.js';

// The merge queue's question, for a card: its pull request by number and title, as far as they are known.
// The pane's lines about a project's checks (spec 4.3 and 4.8).
export const CHECKING_WORDS = 'Checking on this computer';
export const REPORT_WAITS_WORDS = 'Waiting for you to let Wheelhouse report checks';

export function mergeQuestionWords(pr, title) {
  const line = typeof title === 'string' ? title.trim().split('\n')[0].slice(0, 120) : '';
  const named = Number.isInteger(pr) ? `pull request #${pr}${line ? `, "${line}",` : ''}` : 'this pull request';
  return `The merge queue won't judge ${named} by itself (it changes a schema, permissions or something the rules keep for a person).`;
}

// The card for a pull request the merge queue has left alone. It stays out of the queue until the director approves its
// commit: the queue asks about it again only when handed it again, so nothing here promises a question.
export const parkedWords = (reason) => `${reason} The merge queue has left it and gone on with the others.`;
export const PARKED_CHANGED = 'The change has moved to a newer commit since the last card, so this is the one to look at.';
export const PARKED_WHY = 'Only you can say whether this goes in, at level 3.';
export const PARKED_BECAUSE = 'the merge queue can\'t judge it, so what it does is yours to weigh';
export const PARKED_MEANWHILE = 'Nothing of it is added until you approve this commit, and other work carries on. A new commit needs your approval again.';
export const PARKED_APPROVE_SAYS = 'It approves this commit, and the change goes back to the merge queue to be added.';

// The Logbook's line for a held piece with nothing behind it that could move it: a reservation can outlast every card.
export function noCardBehindWords(title, why, by) {
  const names = by.length < 2 ? by.join('') : `${by.slice(0, -1).join(', ')} and ${by.at(-1)}`;
  const said = why === 'clash' ? `waits for the files ${names} keeps, which nothing lets go by itself` : why === 'dependency' ? `waits on ${names}` : `waits while ${names} stands parked`;
  return `${title} ${said}, and no card stands behind that. It moves on once that work is added${why === 'dependency' ? '' : ' or ended'}.`;
}

// The line for the cards past the day's budget, and the button that shows them.
export const heldBackWords = (n) => `${n} more waiting.`;
export const SHOW_THEM = 'Show them';
// How many pieces a card holds up, beside its title.
export const holdsUpWords = (n) => `holds up ${n} ${n === 1 ? 'piece' : 'pieces'}`;

// The Logbook's line for a piece waiting on the director whose branch can't be read yet.
export const reservedUnreadWords = (title) => `What ${title} has changed so far couldn't be read, so only the files it was expected to touch are kept back for it. It is read again shortly.`;

// The way back: a start refused, the card when it stays refused or can't be told, a Stop on that card, and an answered
// run the engine hasn't carried on.
export const restartRefusedWords = (title, why) => `${title} couldn't go back to work: ${why}. It keeps its turn, and it is tried again shortly.`;
export const restartCardWords = (title, why) => `${title} couldn't go back to work, twice: ${why}. Nothing more of it starts until you say.`;
export const restartUnsureWords = (title) => `Wheelhouse can't tell whether ${title} started again, so it hasn't started it a second time. Nothing more of it starts until you say.`;
const STRANDED_BECAUSE = { clash: 'other work is waiting for its files', dependency: 'other work depends on it', parked: 'other work is waiting on it', place: 'it is still keeping its place in the build' };
export const restartStrandedWords = (title, why) => `${title} has stopped with nothing left to carry it on, and ${STRANDED_BECAUSE[why] ?? STRANDED_BECAUSE.parked}. Nothing more of it starts until you say.`;
export const RESTART_UNSURE_AGAIN = 'It checks whether a run began: one on record goes on, and a stray one is ended before it starts again. If that can\'t be done, you get a new card.';
export const START_ANYWAY = 'Start it anyway';
export const cutOffStoppedWords = (title) => `${title} stops here, as you chose; none of it had started.`;
const named = (by) => (by.length < 2 ? by.join('') : `${by.slice(0, -1).join(', ')} and ${by.at(-1)}`);
export const cutOffWords = (title, by) => `${title} depends on ${named(by)}, which won't be added as things stand, so it can't start by itself. It waits until you say.`;
export const waitsOnItselfWords = (title, by) => `${title} and ${named(by)} wait on each other, so none of them can start by itself. It waits until you say.`;
export const startAnywayWords = (by) => `It takes its turn without ${named(by)}. What it was to build on isn't there, so it may fail or need redoing. This holds for this queueing only: queued again, it waits as before.`;
export const prLeftOpenWords = (pr) => `Pull request #${pr} stays open, and nothing of it is added.`;
export const STOPPED_RESTART_WORDS = (title) => `${title} stays stopped, as you chose; what it has done so far is kept on its branch.`;
// Said after that line, of a run the engine may have started all the same and Wheelhouse couldn't end.
export const ORPHAN_LEFT_WORDS = "A run of it may still be going in the build engine; Wheelhouse couldn't end it.";
export const wakeLateWords = (title) => `Your answer about ${title} went back, but the build engine hasn't carried it on yet; it keeps its place meanwhile.`;

// Each step of the pack (engine/archon/pack/) and of the merge queue, in words a sentence takes.
export const STEP_WORDS = Object.freeze({
  order: 'reading the work order',
  implement: 'building it',
  build: 'building it',
  'implement-blocked': 'stopped, with a question',
  tests: 'running the tests',
  controls: 'checking nothing that steers the agents changed',
  held: 'held for a check',
  stop: 'stopped',
  rework: 'reworking it',
  lenses: 'getting ready for the checks',
  'review-standards': 'checking it against the project\'s standards',
  'review-standards-blocked': 'stopped, with a question about the standards',
  'review-spec': 'checking it does what was asked',
  'review-spec-blocked': 'stopped, with a question about what was asked',
  'review-security': 'checking it is safe',
  'review-security-blocked': 'stopped, with a question about safety',
  'review-design': 'checking how it looks',
  'review-design-blocked': 'stopped, with a question about how it looks',
  'pr-text': 'writing up the change',
  'pr-text-blocked': 'stopped, with a question about the write-up',
  'open-pr': 'putting the change up for checking',
  sign: 'signing the checks',
  'review-held': 'held after the checks',
  preview: 'taking pictures',
  approval: 'waiting for you',
  rejected: 'set aside, as you asked',
  ready: 'getting it ready to add',
  merge: 'adding it to the product',
  lesson: 'noting what it learnt',
  'lesson-blocked': 'noting what it learnt',
  'lesson-record': 'noting what it learnt',
  // The small lane's own steps, and its task block's.
  'plan-gate': 'looking for its plan',
  plan: 'planning it',
  'plan-blocked': 'stopped, with a question about the plan',
  tasks: 'listing the plan\'s tasks',
  each: 'building it, a task at a time',
  gate: 'looking at the next task',
  record: 'noting how the task went',
  'tasks-done': 'checking every task is done',
  'tasks-blocked': 'stopped, with a question about a task',
  repair: 'putting the tests back',
  'repair-blocked': 'stopped, with a question about the tests',
  'tests-again': 'running the tests again',
  'controls-again': 'checking again that nothing that steers the agents changed',
  unplan: 'taking the plan out of the change',
  review: 'checking the whole change',
  fix: 'fixing what the checks found',
  'fix-tests': 'checking the fix left the tests alone',
  'fix-controls': 'checking the fix left the agents\' files alone',
  verdict: 'weighing what the checks found',
  'review-blocked': 'stopped, with a question from the checks',
  // A feature's slices' own steps, and the feature's own run's.
  'task-review': 'checking the task',
  'flag-off': 'checking the feature stays switched off',
  'flag-off-again': 'checking again that the feature stays switched off',
  tester: 'trying it out on the preview',
  'tester-blocked': 'stopped, with a question from trying it out',
  'walk-held': 'held after trying it out',
  switch: 'switching the feature on',
  'switch-on': 'switching the feature on',
  'switch-on-blocked': 'stopped, with a question about switching it on',
  'review-feature': 'checking the whole feature',
  // The bug lane's own steps.
  'reproduce-gate': 'looking for its reproduction',
  reproduce: 'reproducing the bug',
  'reproduce-blocked': 'stopped, with a question about the bug',
  red: 'checking the reproduction fails',
  'red-held': 'stopped: the bug couldn\'t be reproduced',
  reproduced: 'noting the reproduction',
  'keep-held': 'stopped: the reproduction couldn\'t be kept',
  size: 'checking the fix is a bug\'s size',
  'size-blocked': 'stopped: the fix is bigger than a bug',
});

// Archon names a step inside a loop after its loop (`review.fix`), and one inside a task block after the fan-out
// instance (`__archon_fan_out__…__gate`); each has its own step's words.
const ownStep = (step) => step.replace(/^__archon_fan_out__.*__/, '').split('.').at(-1);
export const stepWords = (step) => {
  if (typeof step !== 'string') return 'working on it';
  const own = Object.hasOwn(STEP_WORDS, step) ? step : ownStep(step);
  return Object.hasOwn(STEP_WORDS, own) ? STEP_WORDS[own] : 'working on it';
};

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const money = (dollars) => (dollars < 0.005 ? 'less than a cent' : `$${dollars.toFixed(2)}`);
const minutesWords = (n) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
// The first letter of a title made small, for a title inside a sentence.
const inSentence = (title) => (/^[A-Z][a-z]/.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title);

// A run's cost in words: about the figure; at least the known part when a step reported none; not reported when
// none did. Never a smaller figure that looks true.
export function costWords(cost) {
  if (!isPlain(cost)) return null;
  if (typeof cost.dollars === 'number') return cost.dollars < 0.005 ? 'less than a cent' : `about ${money(cost.dollars)}`;
  if (typeof cost.floorDollars === 'number' && cost.floorDollars > 0) return `at least ${money(cost.floorDollars)}`;
  return 'cost not reported';
}

// What a run is doing now: its step's words, or its state's when no step is known.
function doing(run) {
  if (run.state === 'paused') return STEP_WORDS.approval;
  if (run.state === 'ended') return run.outcome === 'cancelled' ? 'stopped' : run.outcome === 'failed' ? 'stopped by a problem' : 'finished';
  return run.step ? stepWords(run.step) : STEP_WORDS.implement;
}

// "The sale banner: checking it does what was asked. 12 minutes so far, about $0.40."
export function runLine(run, cost) {
  const said = cost ? costWords(cost) : null;
  const minutes = Number.isFinite(run.minutes) ? Math.max(0, Math.round(run.minutes)) : null;
  if (minutes === null) return `${run.title}: ${doing(run)}${said ? `, ${said}` : ''}.`;
  const tail = [minutes === null ? null : `${minutesWords(minutes)} so far`, said].filter(Boolean).join(', ');
  return `${run.title}: ${doing(run)}.${tail ? ` ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.` : ''}`;
}

// "Shipped: the sale banner, for about $0.40."
export function shippedLine(run, cost) {
  const said = cost ? costWords(cost) : null;
  return `Shipped: ${inSentence(run.title)}${said ? `, for ${said}` : ''}.`;
}

const titleOf = (views, work) => {
  const title = views?.work?.[work]?.work?.data?.title;
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : work;
};
const records = (views, kind) => (isPlain(views?.[kind]) ? views[kind] : {});
// Each work's runs: the records of each run, in time order, by its id, the latest run last.
function runsOf(views) {
  const out = [];
  for (const [work, list] of Object.entries(records(views, 'runs'))) {
    if (!Array.isArray(list)) continue;
    const byRun = new Map();
    for (const e of list) if (isPlain(e?.data) && typeof e.data.runId === 'string') (byRun.get(e.data.runId) ?? byRun.set(e.data.runId, []).get(e.data.runId)).push(e);
    for (const [runId, list2] of byRun) out.push({ work, runId, records: list2, latest: list2.at(-1) });
  }
  return out.sort((a, b) => String(a.records[0].at).localeCompare(String(b.records[0].at)));
}
const costOf = (views, work, runId) => (records(views, 'costs')[work] ?? []).filter((e) => e?.data?.runId === runId).at(-1)?.data ?? null;

// The work view's lines for runs going now: one a run, in time order.
export function runningLines(views, { now = new Date() } = {}) {
  return runsOf(views).filter((r) => r.latest.data.state !== 'ended').map((r) => runLine({
    title: titleOf(views, r.work), state: r.latest.data.state, step: r.latest.data.step ?? null,
    minutes: runningMinutes(r.records, now),
  }, costOf(views, r.work, r.runId)));
}

// The build tab's lines: a heading, then each run with its cost and its steps in order. None when there are no runs.
export function buildLines(views, { now = new Date() } = {}) {
  const runs = runsOf(views);
  const notes = Array.isArray(views?.engineNotes) ? views.engineNotes.slice(-NOTES_SHOWN).map((e) => `  ${e.data.words}`) : [];
  if (runs.length === 0) return notes.length > 0 ? ['From the build', ...notes] : [];
  const lines = ['Runs'];
  for (const r of runs) {
    const cost = costOf(views, r.work, r.runId);
    const state = r.latest.data;
    lines.push(runLine({ title: titleOf(views, r.work), state: state.state, outcome: state.outcome, step: state.step ?? null, minutes: state.state === 'ended' ? null : runningMinutes(r.records, now) }, cost));
    const steps = isPlain(cost?.byRole) ? [...new Set(Object.keys(cost.byRole).map(stepWords))] : [];
    if (steps.length > 0) lines.push(`  Steps: ${steps.join('; ')}.`);
  }
  return notes.length > 0 ? [...lines, 'From the build', ...notes] : lines;
}

// The build tab shows the latest of the card router's lines.
const NOTES_SHOWN = 5;

// The briefing's lines for the level-2 answers the router gave since `since` (the director hears of each).
export function answeredLines(views, { since = null } = {}) {
  return (Array.isArray(views?.engineNotes) ? views.engineNotes : [])
    .filter((e) => e.data?.level === 2 && (!since || String(e.at) >= since))
    .map((e) => `Answered for you: ${e.data.words}`);
}

// The briefing's shipped lines: each work merged since `since`, with the cost of its runs.
export function shippedLines(views, { since = null } = {}) {
  const reports = records(views, 'reports');
  const lines = [];
  for (const [work, report] of Object.entries(reports)) {
    if (report?.data?.outcome !== 'merged' || (since && String(report.at) < since)) continue;
    const runs = runsOf(views).filter((r) => r.work === work);
    if (runs.length === 0) continue;
    const costs = runs.map((r) => costOf(views, work, r.runId)).filter(Boolean);
    lines.push(shippedLine({ title: titleOf(views, work) }, costs.length ? sumCosts(costs) : null));
  }
  return lines;
}

// Several runs' costs as one: dollars only when every run's are known, the known part as the floor.
function sumCosts(costs) {
  const floor = costs.reduce((n, c) => n + (typeof c.dollars === 'number' ? c.dollars : c.floorDollars ?? 0), 0);
  return { dollars: costs.every((c) => typeof c.dollars === 'number') ? floor : null, floorDollars: floor };
}
