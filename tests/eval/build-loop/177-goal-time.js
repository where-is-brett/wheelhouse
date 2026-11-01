// tests/eval/build-loop/177-goal-time.js
// Scenario 177 (unattended goals design, sections 8 and 9.1): a goal's `until` passes with a run going. Pass: nothing new starts,
// even with the pace raised so a second piece could; the goal winds down and the run is left alone for 60 minutes awake; then it is
// cancelled, keeping its worktree, and the goal ends `time` with one record. Played on the engine the run names, in its `with` variant
// alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';
import { signGoal, setPace, longRuns, endingsOf, cancelsOf, tickTimes, startedRuns, walk } from './goal-world.js';

const GOAL = 'goal-177';
const FIRST = 'card-177-a';
const SECOND = 'card-177-b';
const UNTIL = '2026-10-29T09:30:00.000Z';
const abandoned = (world) => world.acts().filter((c) => c.action.abandon);

export default {
  id: 177,
  title: 'A goal past until winds its run down, then cancels it at 60 minutes',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [FIRST]: running(FIRST, 1000), [SECOND]: running(SECOND, 1000) },
    async play(world, { now, at }) {
      longRuns(world);
      setPace(world, 1);
      signGoal(world, { id: GOAL, works: [{ work: FIRST, title: 'The sale banner' }, { work: SECOND, title: 'The sale page' }], now, until: UNTIL });
      if (!await until(async () => { await world.tick(); return startedRuns(world, FIRST).length > 0; })) return { pass: false, why: 'the first piece never started' };
      // Awake all the while: a jump of the clock would read as the computer asleep.
      setPace(world, 2);
      const early = await walk(world, at, {
        from: '2026-10-29T09:00:00.000Z', to: '2026-10-29T10:29:00.000Z',
        each: () => {
          if (world.starts().some((s) => s.order.work === SECOND)) return 'a piece started after until';
          if (cancelsOf(world).length > 0 || endingsOf(world) !== '') return 'the run was cancelled, or the goal ended, before the 60 minutes were up';
          return null;
        },
      });
      if (early) return { pass: false, why: early };
      const wound = world.records('note').some((n) => /winding down/.test(n.data.words ?? ''));
      if (!wound) return { pass: false, why: 'the goal never said it was winding down' };
      await walk(world, at, { from: '2026-10-29T10:29:00.000Z', to: '2026-10-29T10:33:00.000Z', each: () => (endingsOf(world) !== '' ? 'ended' : null) });
      if (endingsOf(world) === '') return { pass: false, why: 'the goal never ended after its wind-down' };
      await tickTimes(world, 3);
      if (endingsOf(world) !== 'time') return { pass: false, why: `the goal's endings read ${endingsOf(world)}` };
      if (cancelsOf(world).length !== 1) return { pass: false, why: `${cancelsOf(world).length} runs were cancelled` };
      if (abandoned(world).length > 0) return { pass: false, why: 'the run\'s worktree was given up' };
      if (world.starts().some((s) => s.order.work === SECOND)) return { pass: false, why: 'a piece started in the wind-down' };
      return { pass: true, why: 'nothing started past until, the run had its 60 minutes, was then cancelled keeping its worktree, and the goal ended time' };
    },
  },
  variants: { with: {} },
};
