// tests/eval/build-loop/181-sleep-across-a-run.js
// Scenario 181 (unattended goals design, sections 8 and 9.3): the computer sleeps across a goal's `until` with a run going, and wakes
// an hour and more past it. Pass: the helper records the `slept` span across `until`; on waking the run isn't cancelled, the goal
// winds down and the run has its 60 minutes awake from then; after them it is cancelled and the goal ends `time`. Played on the
// engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';
import { signGoal, longRuns, endingsOf, cancelsOf, tickTimes, startedRuns, walk } from './goal-world.js';

const GOAL = 'goal-181';
const WORK = 'card-181';
const UNTIL = '2026-10-29T09:30:00.000Z';
const WAKES = '2026-10-29T10:45:00.000Z';

export default {
  id: 181,
  title: 'A sleep across until leaves the run its wind-down on waking',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [WORK]: running(WORK, 1000) },
    async play(world, { now, at }) {
      longRuns(world);
      signGoal(world, { id: GOAL, work: WORK, title: 'The sale banner', now, until: UNTIL });
      if (!await until(async () => { await world.tick(); return startedRuns(world, WORK).length > 0; })) return { pass: false, why: 'the piece never started' };
      // The clock jumps over the whole span, as the computer's does asleep: the helper's next beat finds it late.
      at(WAKES);
      await tickTimes(world, 2);
      const span = world.records('slept').find((r) => Date.parse(r.data.from) < Date.parse(UNTIL) && Date.parse(r.data.to) > Date.parse(UNTIL));
      if (!span) return { pass: false, why: 'no slept span was recorded across until' };
      if (cancelsOf(world).length > 0 || endingsOf(world) !== '') return { pass: false, why: 'the run was cancelled, or the goal ended, the moment the computer woke' };
      if (!world.records('note').some((n) => /winding down/.test(n.data.words ?? ''))) return { pass: false, why: 'the goal didn\'t wind down on waking' };
      const early = await walk(world, at, {
        from: WAKES, to: '2026-10-29T11:42:00.000Z',
        each: () => (cancelsOf(world).length > 0 || endingsOf(world) !== '' ? 'the run was cancelled before its 60 minutes awake' : null),
      });
      if (early) return { pass: false, why: early };
      await walk(world, at, { from: '2026-10-29T11:42:00.000Z', to: '2026-10-29T11:49:00.000Z', each: () => (endingsOf(world) !== '' ? 'ended' : null) });
      await tickTimes(world, 3);
      if (endingsOf(world) !== 'time') return { pass: false, why: `the goal's endings read ${endingsOf(world) || 'none'}` };
      if (cancelsOf(world).length !== 1) return { pass: false, why: `${cancelsOf(world).length} runs were cancelled` };
      return { pass: true, why: 'the sleep across until left the run uncancelled on waking, it had its 60 minutes awake, and the goal ended time' };
    },
  },
  variants: { with: {} },
};
