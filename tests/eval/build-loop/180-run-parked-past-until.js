// tests/eval/build-loop/180-run-parked-past-until.js
// Scenario 180 (unattended goals design, sections 8 and 9.3): a run parked at the provider's usage limit, whose reset falls after the
// goal's `until`. Pass: when `until` passes the parked run is cancelled, keeping its worktree, without waiting out the hour; the goal
// ends `time`; the run never resumes, nothing new starts, and no card asks about it. Played on the engine the run names, in its `with`
// variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { parkedAtLimit } from './engine-recordings.js';
import { signGoal, longRuns, endingsOf, cancelsOf, tickTimes, walk } from './goal-world.js';

const GOAL = 'goal-180';
const WORK = 'card-180';
const UNTIL = '2026-10-29T09:30:00.000Z';
const RESET = '2026-10-29T14:00:00.000Z';

export default {
  id: 180,
  title: 'A run parked at a limit past until is cancelled, and never resumes',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [WORK]: parkedAtLimit(WORK, { resetAt: RESET }) },
    async play(world, { now, at }) {
      longRuns(world);
      signGoal(world, { id: GOAL, work: WORK, title: 'The sale banner', now, until: UNTIL });
      const parked = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.work === WORK && r.data.state === 'paused'); });
      if (!parked) return { pass: false, why: 'the run never parked at its limit' };
      await tickTimes(world, 2);
      if (cancelsOf(world).length > 0 || endingsOf(world) !== '') return { pass: false, why: 'the parked run was cancelled, or the goal ended, before until' };
      const stopped = await walk(world, at, { from: '2026-10-29T09:00:00.000Z', to: '2026-10-29T09:33:00.000Z', each: () => (endingsOf(world) !== '' ? 'ended' : null) });
      if (stopped !== 'ended') return { pass: false, why: 'the goal never ended once until had passed' };
      await tickTimes(world, 3);
      if (endingsOf(world) !== 'time') return { pass: false, why: `the goal's endings read ${endingsOf(world)}` };
      if (cancelsOf(world).length !== 1) return { pass: false, why: `${cancelsOf(world).length} runs were cancelled, not the one parked` };
      if (world.acts().some((c) => c.action.abandon || c.action.answer || c.action.resume)) return { pass: false, why: 'the parked run was given up, answered or resumed' };
      at('2026-10-29T14:05:00.000Z');
      await tickTimes(world, 4);
      if (world.starts().length !== 1 || world.acts().length !== 1) return { pass: false, why: 'something started or woke the run after the reset' };
      if (world.records('question').length > 0) return { pass: false, why: 'a card came for the run the goal cancelled' };
      return { pass: true, why: 'the parked run was cancelled at until, keeping its worktree, the goal ended time, and nothing woke it after its reset' };
    },
  },
  variants: { with: {} },
};
