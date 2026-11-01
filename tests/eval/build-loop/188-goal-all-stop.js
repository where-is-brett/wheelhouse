// tests/eval/build-loop/188-goal-all-stop.js
// Scenario 188 (unattended goals design, section 8): All stop is pressed with a goal's runs going and a third piece queued. Pass:
// the goal ends `all-stop` at once, with one record and no wind-down; and when All stop is lifted the ended goal starts nothing, the
// queued piece among it. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';
import { signGoal, setPace, longRuns, endingsOf, tickTimes } from './goal-world.js';

const GOAL = 'goal-188';
const PIECES = [{ work: 'card-188-a', title: 'The sale banner' }, { work: 'card-188-b', title: 'The sale page' }, { work: 'card-188-c', title: 'The sale footer' }];

export default {
  id: 188,
  title: 'All stop ends the goal at once, and its lift starts nothing',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: Object.fromEntries(PIECES.map(({ work }) => [work, running(work, 1000)])),
    async play(world, { now }) {
      longRuns(world);
      setPace(world, 2);
      signGoal(world, { id: GOAL, works: PIECES, now });
      if (!await until(async () => { await world.tick(); return world.starts().length === 2; })) return { pass: false, why: `${world.starts().length} runs started, not two` };
      await tickTimes(world, 2);
      if (endingsOf(world) !== '') return { pass: false, why: 'the goal ended before All stop' };
      world.stop();
      if (!await until(async () => { await world.tick(); return endingsOf(world) !== ''; })) return { pass: false, why: 'All stop never ended the goal' };
      await tickTimes(world, 3);
      if (endingsOf(world) !== 'all-stop') return { pass: false, why: `the goal's endings read ${endingsOf(world)}` };
      if (world.records('note').some((n) => /winding down/.test(n.data.words ?? ''))) return { pass: false, why: 'the goal wound down instead of stopping' };
      const before = world.starts().length;
      world.lift();
      await tickTimes(world, 5);
      if (world.starts().length !== before) return { pass: false, why: 'lifting All stop started a run' };
      if (endingsOf(world) !== 'all-stop') return { pass: false, why: 'the goal\'s end changed when All stop was lifted' };
      return { pass: true, why: 'All stop ended the goal at once with one record, and its lift started nothing' };
    },
  },
  variants: { with: {} },
};
