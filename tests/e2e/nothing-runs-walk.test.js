// tests/e2e/nothing-runs-walk.test.js
// Seeded walks over what the pieces' own tests leave out: failed runs, refused starts, a merge queue that works and one
// that can't start, and a project with no test command. However it goes, a project where nothing runs has a card (delegated
// decisions plan, invariant 6). A failing piece may have work behind it or stand alone, and may fail of a kind that retries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wayBack, quiet, forever } from '../helpers/way-back.js';
import { redMainIncident } from '../../scripts/engine/fix-main.js';
import { STOP_HERE, KEEP_OFF, LEAVE_IT, LEAVE_RED } from '../../scripts/engine/dispatch-run.js';

const MINUTE = 60 * 1000;
const SEEDS = 40;
const ended = (over) => { const run = quiet(); run[1] = { ...run[1], ...over }; return run; };
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function worldOf(seed) {
  const rand = rng(seed);
  const chance = (p) => rand() < p;
  const ids = ['a', 'b', 'c', 'd'];
  const fault = { why: chance(0.5) ? 'the host\'s branches couldn\'t be fetched' : null };
  const incident = redMainIncident({ id: `seed-${seed}` });
  const failing = chance(0.5) ? 'a' : null;
  const alone = chance(0.5);
  const failure = chance(0.5) ? 'connection' : 'other';
  let pr = 10;
  const recordings = { merge: forever(), [incident.work]: forever() };
  for (const id of ids) recordings[id] = [...(id === failing ? [ended({ outcome: 'failed', failure })] : []), ...[0, 1, 2, 3].map(() => ended({ pr: (pr += 1) }))];
  const w = wayBack({
    recordings, pace: 1 + Math.floor(rand() * 2),
    dispatchExtra: { queueFolder: async () => (fault.why ? { ok: false, refused: fault.why } : { ok: true, folder: 'qf' }), queuePlace: () => 'qf', repoOf: () => ({ host: 'h', path: 'o/r' }) },
  });
  const engineStart = w.engine.start.bind(w.engine);
  w.engine.start = (order) => engineStart(order.lane === 'merge' ? { ...order, recording: 'merge', work: 'merge' } : order);
  if (chance(0.4)) {
    w.config = { routing: {}, testsNotCounting: true };
    if (chance(0.5)) { w.green = false; w.incidents.open = [incident]; }
  }
  ids.forEach((id, place) => w.put(id, { place, files: [chance(0.5) ? 'x.js' : 'y.js'] }));
  if (failing && !alone) w.work.b.work.data.dependsOn = ['a'];
  if (chance(0.3)) w.refuse = () => 'the engine\'s copy of the project couldn\'t be brought up to date, so no run started';
  return { w, rand, chance, fault, ids };
}

// What the helper marks when a finished run's pull request is ready, for the queue to take.
function markReady(w) {
  for (const list of Object.values(w.runs)) {
    const last = list.at(-1)?.data;
    if (last?.state === 'ended' && Number.isInteger(last.pr)) w.ready[last.pr] ??= { head: `h${last.pr}`, runId: last.runId, work: last.work };
  }
}
const openCards = (w) => Object.values(w.questions).filter((q) => !q.answer);
const unfinished = (w) => Object.keys(w.work).filter((id) => !w.reports[id]);
const going = (w) => Object.keys(w.runs).some((work) => w.stateOf(work) === 'started') || (w.engine.queueRuns({ folder: 'qf' }) ?? []).length > 0;
// What leaves work waiting by the director's own choice is no silence.
const chosen = (w) => Object.values(w.questions).some((q) => [KEEP_OFF, LEAVE_IT, LEAVE_RED].includes(q.answer?.label));
const silent = (w) => unfinished(w).length > 0 && !going(w) && openCards(w).length === 0 && !chosen(w);

async function walk(seed) {
  const { w, rand, chance, fault } = worldOf(seed);
  const said = [];
  for (let step = 0; step < 24; step += 1) {
    markReady(w);
    if (chance(0.3)) {
      const card = openCards(w).at(Math.floor(rand() * openCards(w).length));
      if (card) w.answer(card.question.data.work, card.question.data.options.map((o) => o.label).filter((label) => label !== STOP_HERE).at(Math.floor(rand() * 2)) ?? STOP_HERE);
    }
    if (chance(0.15)) w.refuse = w.refuse ? null : () => 'the engine\'s copy of the project couldn\'t be brought up to date, so no run started';
    if (chance(0.15)) fault.why = fault.why ? null : 'the host\'s branches couldn\'t be fetched';
    await w.pass(3 * MINUTE);
  }
  // However it stands now, its faults still on, an hour on it has said so.
  markReady(w);
  await w.pass(60 * MINUTE);
  if (silent(w)) said.push(`seed ${seed}: nothing runs and no card: ${JSON.stringify({ unfinished: unfinished(w), ready: Object.keys(w.ready), refused: Boolean(w.refuse), fault: fault.why, incidents: w.incidents.open.length })}`);
  const starts = new Map();
  for (const s of w.starts) starts.set(s.order.work, (starts.get(s.order.work) ?? 0) + 1);
  for (const [work, count] of starts) if (count > 40) said.push(`seed ${seed}: ${work} started ${count} times`);
  const cards = new Set(w.cards().map((c) => c.id));
  if (cards.size !== w.cards().length) said.push(`seed ${seed}: a card written twice`);
  return said;
}

test('in every walk, a project where nothing runs has a card', async () => {
  const problems = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) problems.push(...await walk(seed));
  assert.deepEqual(problems, []);
});
