// tests/eval/build-loop/187-goal-end-now.js
// Scenario 187 (unattended goals design, section 8): the director's End goal now, signed as an `end-goal` note with `now: true`, while
// a run is going. Pass: at once, with no wind-down, the run is cancelled keeping its worktree and the goal ends `end-goal` with one
// record; nothing new starts and no card asks about the run. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';
import { signGoal, setPace, longRuns, endingsOf, cancelsOf, tickTimes, startedRuns } from './goal-world.js';

const GOAL = 'goal-187';
const FIRST = 'card-187-a';
const SECOND = 'card-187-b';

export default {
  id: 187,
  title: 'End goal now cancels the run at once and ends the goal',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [FIRST]: running(FIRST, 1000), [SECOND]: running(SECOND, 1000) },
    async play(world, { now }) {
      longRuns(world);
      setPace(world, 1);
      signGoal(world, { id: GOAL, works: [{ work: FIRST, title: 'The sale banner' }, { work: SECOND, title: 'The sale page' }], now });
      if (!await until(async () => { await world.tick(); return startedRuns(world, FIRST).length > 0; })) return { pass: false, why: 'the first piece never started' };
      await tickTimes(world, 2);
      if (cancelsOf(world).length > 0 || endingsOf(world) !== '') return { pass: false, why: 'the goal ended before the director asked' };
      setPace(world, 2);
      world.put('note', { about: 'end-goal', goal: GOAL, now: true });
      if (!await until(async () => { await world.tick(); return endingsOf(world) !== ''; })) return { pass: false, why: 'the goal never ended' };
      await tickTimes(world, 3);
      if (endingsOf(world) !== 'end-goal') return { pass: false, why: `the goal's endings read ${endingsOf(world)}` };
      if (cancelsOf(world).length !== 1) return { pass: false, why: `${cancelsOf(world).length} runs were cancelled, not the one going` };
      if (world.acts().some((c) => c.action.abandon)) return { pass: false, why: 'the run\'s worktree was given up' };
      if (world.starts().some((s) => s.order.work === SECOND)) return { pass: false, why: 'the second piece started' };
      if (world.records('question').length > 0) return { pass: false, why: 'a card came for the run the goal cancelled' };
      return { pass: true, why: 'End goal now cancelled the run at once, keeping its worktree, and the goal ended end-goal with nothing more started' };
    },
  },
  variants: { with: {} },
};
