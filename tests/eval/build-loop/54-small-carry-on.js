// tests/eval/build-loop/54-small-carry-on.js
// Scenario 54 (Archon design, sections 7.2, 10.2 and 18): a small-lane run spends past the lane's token cap while it
// builds its tasks. Pass: the run is stopped and the director gets one card; Give it more starts the small lane again
// on the same branch, carrying on, so the plan and the tasks already committed there are kept and the plan step
// isn't run again. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { smallRunning, smallWork } from './engine-recordings.js';

export default {
  id: 54,
  title: 'A small-lane run that reaches its cap carries on from its plan',
  engine: {
    // The small lane's cap is four million tokens; this run's first task has spent 4.2 million.
    recordings: { 'card-54': smallRunning('card-54', 4200000) },
    async play(world) {
      smallWork(world, { id: 'card-54', title: 'The order history page' });
      await world.tick();
      const cancelled = () => world.acts().find((c) => c.action?.cancel);
      if (!await until(async () => { await world.tick(); return cancelled(); })) return { pass: false, why: 'the run went on past the small lane\'s cap' };
      const card = await until(() => world.records('question').find((q) => q.data.options.some((o) => o.label === 'Give it more')));
      if (!card) return { pass: false, why: 'no card came for the reached cap' };
      world.answer(card.data, 'Give it more');
      if (!await until(async () => { await world.tick(); return world.starts().length === 2; })) return { pass: false, why: 'Give it more didn\'t start it again' };
      const again = world.starts()[1].order;
      if (again.lane !== 'small' || again.carryOn !== true) return { pass: false, why: 'the second run didn\'t carry on in the small lane' };
      const { branch } = again;
      if (branch !== 'wh/card-54') return { pass: false, why: `the second run is on ${branch ?? 'no branch'}, not the first run's` };
      return { pass: true, why: 'stopped at the small lane\'s cap, carried on on its own branch after Give it more' };
    },
  },
  variants: { with: {} },
};
