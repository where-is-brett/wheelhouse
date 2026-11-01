// tests/eval/build-loop/engine-recordings.js
// Recordings for the engine scenarios (42 to 55, 60 to 62, 63 to 69, 70 to 75, 90 to 94, 120 to 134, 170 to 171 and 184 to 185), in the fake engine's
// events: each a run of the quick lane, of the small lane from 51, of fix-main, of the bug lane from 63, or of a
// feature's slices and its own run from 70, that stops where the scenario needs it. Not a scenario file: it has no number.
import fs from 'node:fs';
import path from 'node:path';
import { confirmationFor } from '../../../scripts/state/events.js';
import { SLICES_FENCE } from '../../../scripts/engine/feature.js';
import { briefHash } from '../../../scripts/feature/files.js';

const at = (minute) => new Date(Date.UTC(2026, 9, 29, 9, minute)).toISOString();
const started = (work, lane = 'quick') => ({ type: 'run-started', at: at(0), work, lane, branch: `wh/${work}` });
const step = (minute, id, spend, extra = {}) => ({ type: 'step-finished', at: at(minute), step: id, role: ['implement', 'plan', 'fix', 'reproduce'].includes(id) ? 'implementer' : 'reviewer', provider: 'claude', model: 'mid', minutes: 2, spend, ...extra });
const ended = (minute, outcome = 'completed', pr = null) => ({ type: 'run-ended', at: at(minute), outcome, pr });

// A goal's check run, its one step giving `results`, as the helper's order lists them, with what it read on the main line.
export function goalChecked(goal, results) {
  return [
    { type: 'run-started', at: at(0), work: goal, lane: 'goal-check', branch: null },
    { type: 'step-finished', at: at(1), step: 'checks', role: 'reviewer', provider: 'none', model: 'none', minutes: 1, spend: { tokens: 0, dollars: 0, source: 'reported' }, output: JSON.stringify({ results }) },
    ended(2),
  ];
}

// A run that asks one question of `level`, then finishes once it is answered.
export function asking(work, { level = 3, id = `${work}:ask:1`, topic = null, card = true, answer, line, what = 'How much of the page should change?' } = {}) {
  return [
    started(work),
    step(2, 'implement', { tokens: 40000, dollars: 0.1, source: 'reported' }),
    {
      type: 'ask', at: at(3), id, kind: 'question', level, topic, recommend: 'b', card,
      options: [{ id: 'a', label: 'Keep it small' }, { id: 'b', label: 'Do the whole page' }],
      context: { question: what }, ...(answer ? { answer } : {}), ...(line ? { line } : {}),
    },
    { type: 'ask-resolved', at: at(4), id },
    ended(6),
  ];
}

// A run that spends `tokens` in its first step, then holds before its next ask.
export function spending(work, tokens) {
  return [
    started(work),
    step(2, 'implement', { tokens, dollars: 3, source: 'reported' }),
    { type: 'ask', at: at(3), id: `${work}:ask:1`, kind: 'question', level: 3, recommend: 'b', card: true, options: [{ id: 'a', label: 'Keep it small' }, { id: 'b', label: 'Do the whole page' }], context: { question: 'How much of the page should change?' } },
    { type: 'ask-resolved', at: at(4), id: `${work}:ask:1` },
    ended(6),
  ];
}

// The merge queue's hold on a red main line: one ask, answered at level 1 with no card.
export function redMain(work) {
  return [
    started(work),
    { type: 'ask', at: at(3), id: `${work}:red:1`, kind: 'question', level: 1, recommend: 'hold', answer: 'hold', card: false, opens: 'red-main', suspect: 41, line: 'The main line is red, so the merge queue holds merges until it is green again.', options: [{ id: 'hold', label: 'Hold' }] },
    { type: 'ask-resolved', at: at(4), id: `${work}:red:1` },
    ended(6),
  ];
}

// A run still under way: it has finished its first step, spending `tokens`, and is working on the next.
export function running(work, tokens = 40000) {
  return [started(work), step(2, 'implement', { tokens, dollars: 0.1, source: 'reported' })];
}

// A run of visible work that opened pull request `pr` at `head` and waits for the director's approval, with the
// pictures its preview step took.
export function approving(work, { pr, head }) {
  return [
    started(work),
    step(2, 'implement', { tokens: 40000, dollars: 0.1, source: 'reported' }),
    step(4, 'preview', { tokens: 2000, dollars: 0.01, source: 'reported' }),
    {
      type: 'ask', at: at(5), id: `${work}:approval:1`, kind: 'approval', level: 3, recommend: 'approve', card: true, setLine: { pr, head }, preview: 'preview',
      options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Not this' }],
    },
    { type: 'ask-resolved', at: at(6), id: `${work}:approval:1` },
    ended(7, 'completed', pr),
  ];
}

// A small-lane run: the plan step, one build step for each of `tasks` tasks, then each review round's lenses (a round
// after the first opens with its fix step), and the pull request. `tokens` is what the first build step spends.
export function small(work, { tasks = 2, rounds = 1, tokens = 120000, pr = 51 } = {}) {
  const events = [started(work, 'small'), step(1, 'plan', { tokens: 30000, dollars: 0.05, source: 'reported' })];
  for (let n = 1; n <= tasks; n += 1) events.push(step(1 + n, 'implement', { tokens: n === 1 ? tokens : 100000, dollars: 0.2, source: 'reported' }));
  let minute = 2 + tasks;
  for (let round = 1; round <= rounds; round += 1) {
    if (round > 1) events.push(step(minute++, 'fix', { tokens: 50000, dollars: 0.1, source: 'reported' }));
    for (const lens of ['review-standards', 'review-spec']) events.push(step(minute, lens, { tokens: 20000, dollars: 0.05, source: 'reported' }));
    minute += 1;
  }
  events.push(ended(minute + 1, 'completed', pr));
  return events;
}

// A small-lane run whose review still holds once its loop has closed: `rounds` review rounds, its pull request `pr` at
// `head` opened, and the sign step's held card, asking `question` (scenario 120).
export function smallHeld(work, { rounds, question, pr, head }) {
  const events = small(work, { tasks: 1, rounds, pr }).filter((e) => e.type !== 'run-ended');
  const id = `${work}:review-held:1`;
  return [
    ...events,
    {
      type: 'ask', at: at(20), id, kind: 'blocked', level: 3, topic: 'review-findings', recommend: 'rework', card: true, setLine: { pr, head },
      options: [{ id: 'stop', label: 'Stop this work' }, { id: 'rework', label: 'Send it back for a fresh run' }], context: { question },
    },
    { type: 'ask-resolved', at: at(21), id },
    ended(22),
  ];
}

// A small-lane run whose tasks block: a task's builder took the blocked exit, and the lane asks its one question once
// every task has settled.
export function smallBlocked(work) {
  return [
    started(work, 'small'),
    step(1, 'plan', { tokens: 30000, dollars: 0.05, source: 'reported' }),
    step(2, 'implement', { tokens: 90000, dollars: 0.2, source: 'reported' }),
    {
      type: 'ask', at: at(3), id: `${work}:tasks-blocked:1`, kind: 'blocked', level: 3, topic: 'tasks-unfinished', recommend: 'rework', card: true,
      options: [{ id: 'rework', label: 'Send it back for a fresh run' }, { id: 'stop', label: 'Stop this work' }],
      context: { question: "Some of the plan's tasks didn't finish within their rounds." },
    },
    { type: 'ask-resolved', at: at(4), id: `${work}:tasks-blocked:1` },
    ended(6),
  ];
}

// A small-lane run still building its tasks, having spent `tokens` on the first.
export function smallRunning(work, tokens) {
  return [started(work, 'small'), step(1, 'plan', { tokens: 30000, dollars: 0.05, source: 'reported' }), step(2, 'implement', { tokens, dollars: 3, source: 'reported' })];
}

// What a small-lane scenario seeds: the small lane put on the engine, as the director's confirmed setting, and a piece
// of small work the director approved (the small lane always starts on an approval).
export function smallWork(world, { id, title, visible = false, lanes = ['quick', 'small'] }) {
  if (lanes) {
    const setting = world.put('setting', { key: 'engineLanes', value: lanes });
    world.put('confirmation', confirmationFor(setting).data);
  }
  const hash = id.replace(/\D/g, '').padEnd(64, '5').slice(0, 64);
  world.put('work', { id, title, lane: 'small', visible, dependsOn: [], doc: { path: `docs/work/${id}.md`, hash } });
  world.put('action', { action: 'approve-work', question: `Approve ${id} (small lane) as written`, label: 'Approve', work: id, lane: 'small', hash, shownFirst: visible });
}

// A fix-main run for a red main line: under way after its first step, or ended with `outcome`.
export function fixing(work, outcome = null) {
  const run = [{ ...started(work), lane: 'fix-main' }, step(2, 'implement', { tokens: 30000, dollars: 0.08, source: 'reported' })];
  return outcome ? [...run, ended(8, outcome)] : run;
}

// A slice-lane run of a feature that builds its slice behind the switch and opens pull request `pr` (scenarios 70 to
// 75), or, with no `pr`, is still under way after its first step. `outcome` 'cancelled' ends it as a rejected demo
// does, its pull request open.
export function sliceRun(work, { pr = null, tokens = 60000, outcome = 'completed' } = {}) {
  const run = [started(work, 'slice'), step(2, 'implement', { tokens, dollars: 0.2, source: 'reported' })];
  return pr === null ? run : [...run, ended(6, outcome, pr)];
}

// A quick-lane run that builds its change and ends with pull request `pr` (scenarios 90 and 91).
export function quickRun(work, { pr }) {
  return [started(work), step(2, 'implement', { tokens: 40000, dollars: 0.1, source: 'reported' }), ended(4, 'completed', pr)];
}

// A quick run that fails at `failedAt`, then, resumed, finishes with pull request `pr`, if it is given one.
export function failingRun(work, { failure, failedAt, pr = null }) {
  return [
    started(work), step(2, 'implement', { tokens: 40000, dollars: 0.1, source: 'reported' }),
    { type: 'run-ended', at: at(3), outcome: 'failed', failure, failedAt, branch: null, pr: null },
    ...(pr === null ? [] : [ended(4, 'completed', pr)]),
  ];
}

// The feature's own run: the whole-feature review, the switch turned on, and the director's switch-on approval of
// pull request `pr` at `head`.
export function finishRun(work, { pr, head }) {
  return approving(work, { pr, head }).map((e) => (e.type === 'run-started' ? { ...e, lane: 'feature' } : e));
}

// The design a feature scenario's director approved: its slices block, `count` slices behind one switch.
export function featureDesign({ title, count = 2, demo = 'end' }) {
  const slices = Array.from({ length: count }, (_, i) => ({ title: `Part ${i + 1} of ${title}`, goal: `Part ${i + 1} works`, done: [{ test: `part ${i + 1}` }] }));
  const block = JSON.stringify({ goal: `${title} works`, flag: { name: 'new-orders' }, demo, slices }, null, 2);
  return `# ${title}\n\nThe design in words.\n\n\`\`\`${SLICES_FENCE}\n${block}\n\`\`\`\n`;
}

// What a feature scenario seeds: the feature lane put on the engine, as the director's confirmed setting, the design
// written into the project's checkout, and the feature work with the director's approval of that design.
export function featureWork(world, { id, title, count = 2, demo = 'end', design = featureDesign({ title, count, demo }), place } = {}) {
  const setting = world.put('setting', { key: 'engineLanes', value: ['quick', 'feature'] });
  world.put('confirmation', confirmationFor(setting).data);
  const doc = `docs/designs/${id}.md`;
  fs.mkdirSync(path.join(world.folder, 'docs', 'designs'), { recursive: true });
  fs.writeFileSync(path.join(world.folder, doc), design);
  const hash = briefHash(design);
  world.put('work', { id, title, lane: 'feature', visible: false, dependsOn: [], doc: { path: doc, hash }, ...(place === undefined ? {} : { place }) });
  world.put('action', { action: 'approve-work', question: `Approve ${id} (feature lane) as written`, label: 'Approve', work: id, lane: 'feature', hash, shownFirst: false });
  return { doc, hash };
}

// The code host's stand-in for a feature scenario: the pull requests in `merged` read merged, every other open.
export function mergingHost(merged) {
  return { prState: async (pr) => ({ state: merged.has(Number(pr)) ? 'merged' : 'open' }) };
}

// The code host's stand-in where pull requests may also be closed unmerged: those in `merged` read merged, those in
// `closed` closed, every other open (scenarios 90 to 94).
export function closingHost(merged, closed) {
  return { prState: async (pr) => ({ state: merged.has(Number(pr)) ? 'merged' : closed.has(Number(pr)) ? 'closed' : 'open' }) };
}

// A bug-lane run: the reproduce step, the fix, the reviews and the pull request.
export function bug(work, { pr = 63 } = {}) {
  return [
    started(work, 'bug'),
    step(1, 'reproduce', { tokens: 60000, dollars: 0.1, source: 'reported' }),
    step(3, 'implement', { tokens: 120000, dollars: 0.2, source: 'reported' }),
    step(4, 'review-standards', { tokens: 20000, dollars: 0.05, source: 'reported' }),
    step(4, 'review-spec', { tokens: 20000, dollars: 0.05, source: 'reported' }),
    ended(6, 'completed', pr),
  ];
}

// The options of the bug lane's two blocked exits of its own (engine/archon/pack/wheelhouse-bug.yaml).
export const BUG_OPTIONS = Object.freeze({
  'no-reproduction': [{ id: 'rework', label: 'Try to reproduce it again' }, { id: 'stop', label: 'Stop this work' }],
  'bigger-than-a-bug': [{ id: 'small', label: 'Make it a small change' }, { id: 'feature', label: 'Make it a feature' }, { id: 'stop', label: 'Stop this work' }],
});

// A bug-lane run that takes one of its blocked exits: the bug couldn't be reproduced, or its fix proved bigger than a
// bug's.
export function bugBlocked(work, topic, question) {
  const options = BUG_OPTIONS[topic];
  return [
    started(work, 'bug'),
    step(1, 'reproduce', { tokens: 60000, dollars: 0.1, source: 'reported' }),
    {
      type: 'ask', at: at(3), id: `${work}:${topic}:1`, kind: 'blocked', level: 3, topic, recommend: options[0].id, card: true, options, context: { question },
    },
    { type: 'ask-resolved', at: at(4), id: `${work}:${topic}:1` },
    ended(6),
  ];
}

// What a bug-lane scenario seeds: the bug lane put on the engine, as the director's confirmed setting, and a reported
// bug, as intake records it. A bug no user would see starts unapproved; one they would is approved and shown first.
export function bugWork(world, { id, title, visible = false, lanes = ['quick', 'bug'] }) {
  if (lanes) {
    const setting = world.put('setting', { key: 'engineLanes', value: lanes });
    world.put('confirmation', confirmationFor(setting).data);
  }
  const hash = id.replace(/\D/g, '').padEnd(64, '6').slice(0, 64);
  world.put('work', { id, title, lane: 'bug', visible, dependsOn: [], doc: { path: `.wheelhouse/work/${id}.md`, hash } });
  if (visible) world.put('action', { action: 'approve-work', question: `Approve ${id} (bug lane) as written, and show it to me before it merges`, label: 'Approve', work: id, lane: 'bug', hash, shownFirst: true });
}

// The work a real play on Archon gives its runs (scripts/eval/archon-world.js): one line, so a real step costs cents.
export { TINY_GOAL } from '../../../scripts/eval/places.js';
