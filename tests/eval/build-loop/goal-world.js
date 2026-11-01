// tests/eval/build-loop/goal-world.js
// A signed goal in a scenario's world: its pieces' work records, its sheet, its baseline and the director's Start, and what the
// ending scenarios read of it. Not a scenario file: it has no number.
import { confirmationFor, dataHash } from '../../../scripts/state/events.js';
import { sheetHash } from '../../../scripts/engine/goal.js';
import { startGoalLine } from '../../../scripts/state/card-lines.js';

// The work record `world.lane` writes, so the sheet's hash is that record's.
const pieceOf = (work, title) => ({ id: work, title, lane: 'quick', visible: false, dependsOn: [] });

// Records the pieces and signs a goal over them, in force from now: { id, hash, sheet }. A goal has one piece, `work`, or
// `works` ([{ work, title }]); it ends `hours` (8 by default) hours from now, or `until`, an ISO instant, and may spend `tokens`.
export function signGoal(world, { id, work, title, works = [{ work, title }], now, areas = { may: ['src/**'], wontTouch: ['tests/**'] }, checkFiles = [], hours = 8, until, tokens = 1000000, stopEarly }) {
  const lines = works.map((piece) => {
    const data = pieceOf(piece.work, piece.title);
    world.put('work', data);
    return { work: piece.work, hash: dataHash(data) };
  });
  const sheet = {
    title: 'The sale banner goes up', done: [{ command: 'npm test', expect: 0 }], checksSay: ['the tests pass'], checkFiles,
    pieces: lines, areas, spend: { tokens }, until: until ?? new Date(now().getTime() + hours * 3600000).toISOString(),
    ...(stopEarly ? { stopEarly } : {}),
  };
  world.put('goal', { id, sheet });
  const hash = sheetHash(sheet);
  // Its baseline, a check that fails today, as the helper signs it.
  world.put('goal-check', { goal: id, hash, when: 'before', head: 'a'.repeat(40), results: [{ check: sheet.done[0], ok: false }], ok: false });
  world.put('action', { action: 'start-goal', goal: id, hash, question: `Goal.\n${startGoalLine(id, hash)}`, label: 'Start' });
  return { id, hash, sheet };
}

// The goal's records of its end, and their endings in order.
export const goalEnds = (world) => world.records('goal-end');
export const endingsOf = (world) => goalEnds(world).map((r) => r.data.ending).join();

// The runs cancelled so far, one for each cancel the engine was asked for.
export const cancelsOf = (world) => world.acts().filter((c) => c.action.cancel);

// Ticks `count` times, so the helper's look at the goal has run that often.
export async function tickTimes(world, count) {
  for (let i = 0; i < count; i += 1) await world.tick();
}

// Moves the world's clock from `from` to `to` (ISO instants) awake, in steps short of the sleep gap, ticking at each; `each(instant)` is
// called after every tick, and a string it returns stops the walk with that word. A single jump of the clock reads as a sleep.
export async function walk(world, at, { from, to, each = () => null, stepMinutes = 2.5 }) {
  const end = Date.parse(to);
  for (let t = Date.parse(from); t < end;) {
    t = Math.min(end, t + stepMinutes * 60000);
    at(new Date(t).toISOString());
    await world.tick();
    const stop = each(new Date(t).toISOString());
    if (typeof stop === 'string') return stop;
  }
  return null;
}

// Sets the pace, how many runs may go at once, as the director's confirmed setting.
export function setPace(world, value) {
  world.put('confirmation', confirmationFor(world.put('setting', { key: 'pace', value })).data);
}

// The runs of `work` that have started, as the run records say.
export const startedRuns = (world, work) => world.records('run').filter((r) => r.data.work === work && r.data.state === 'started');

// Lets a run take as long as the scenario needs, so a lane's own cap in minutes plays no part: the goal's time is what it plays.
export function longRuns(world) {
  const caps = { quick: 100000, small: 100000, slice: 100000, bug: 100000 };
  world.put('confirmation', confirmationFor(world.put('setting', { key: 'capMinutes', value: caps })).data);
}
