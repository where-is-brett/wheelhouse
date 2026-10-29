// tests/eval/build-loop/engine-recordings.js
// Recordings for the engine scenarios (42 to 54), in the fake engine's events: each a run of the quick lane, or of
// the small lane from 51, that stops where the scenario needs it. Not a scenario file: it has no number.
import { confirmationFor } from '../../../scripts/state/events.js';

const at = (minute) => new Date(Date.UTC(2026, 9, 29, 9, minute)).toISOString();
const started = (work, lane = 'quick') => ({ type: 'run-started', at: at(0), work, lane, branch: `wh/${work}` });
const step = (minute, id, spend, extra = {}) => ({ type: 'step-finished', at: at(minute), step: id, role: ['implement', 'plan', 'fix'].includes(id) ? 'implementer' : 'reviewer', provider: 'claude', model: 'mid', minutes: 2, spend, ...extra });
const ended = (minute, outcome = 'completed', pr = null) => ({ type: 'run-ended', at: at(minute), outcome, pr });

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
    { type: 'ask', at: at(3), id: `${work}:red:1`, kind: 'question', level: 1, recommend: 'hold', answer: 'hold', card: false, line: 'The main line is red, so the merge queue holds merges until it is green again.', options: [{ id: 'hold', label: 'Hold' }] },
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

// A small-lane run whose tasks block: a task's builder took the blocked exit, and the lane asks its one question once
// every task has settled.
export function smallBlocked(work) {
  return [
    started(work, 'small'),
    step(1, 'plan', { tokens: 30000, dollars: 0.05, source: 'reported' }),
    step(2, 'implement', { tokens: 90000, dollars: 0.2, source: 'reported' }),
    {
      type: 'ask', at: at(3), id: `${work}:tasks-blocked:1`, kind: 'question', level: 3, topic: 'tasks-unfinished', recommend: 'rework', card: true,
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
