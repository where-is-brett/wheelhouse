// tests/eval/build-loop/179-goal-stuck.js
// Scenario 179 (unattended goals design, section 8): a goal of two pieces, going together, that each fail with a kind of failure
// that has no retries (`other`). Pass: once both have failed, with nothing merged between, the goal ends `stuck` with one record and
// is never Done, and nothing is cancelled, since none is going. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { failingRun } from './engine-recordings.js';
import { signGoal, setPace, longRuns, endingsOf, cancelsOf, tickTimes } from './goal-world.js';

const GOAL = 'goal-179';
const PIECES = [{ work: 'card-179-a', title: 'The sale banner' }, { work: 'card-179-b', title: 'The sale page' }];
const failed = { failure: 'other', failedAt: 'implement' };

export default {
  id: 179,
  title: 'A goal whose two pieces fail in a row past its retries is stuck',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: Object.fromEntries(PIECES.map(({ work }) => [work, failingRun(work, failed)])),
    async play(world, { now }) {
      longRuns(world);
      setPace(world, 2);
      signGoal(world, { id: GOAL, works: PIECES, now });
      const ended = await until(async () => { await world.tick(); return endingsOf(world); });
      if (!ended) return { pass: false, why: `the goal never ended; ${world.starts().length} runs started` };
      await tickTimes(world, 3);
      if (endingsOf(world) !== 'stuck') return { pass: false, why: `the goal's endings read ${endingsOf(world)}` };
      const failedRuns = world.records('run').filter((r) => r.data.state === 'ended' && r.data.outcome === 'failed').map((r) => r.data.work);
      if (new Set(failedRuns).size !== 2) return { pass: false, why: `${new Set(failedRuns).size} pieces failed, not two` };
      if (world.records('report').length > 0) return { pass: false, why: 'a failed piece was reported' };
      if (cancelsOf(world).length > 0) return { pass: false, why: 'a run was cancelled, with none going' };
      return { pass: true, why: 'two pieces failed in a row past their retries, and the goal ended stuck' };
    },
  },
  variants: { with: {} },
};
