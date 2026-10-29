// tests/eval/build-loop/51-small-lane-runs.js
// Scenario 51 (Archon design, sections 7.2 and 18): approved small work runs on the engine's small lane once the
// project has put that lane on the engine, and not before. Pass: with the engine taking only the quick lane the work
// holds; once the director's setting adds the small lane, one run starts with an order for the small lane that
// carries the project's test command and the routing tiers, and the run ends with its pull request. Played on the
// engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { small, smallWork } from './engine-recordings.js';

export default {
  id: 51,
  title: 'Small work runs on the small lane once the project puts it on the engine',
  engine: {
    recordings: { 'card-51': small('card-51', { tasks: 3, pr: 51 }) },
    async play(world) {
      smallWork(world, { id: 'card-51', title: 'The order history page', lanes: null });
      await world.tick();
      if (world.starts().length !== 0) return { pass: false, why: 'small work started while the engine took only the quick lane' };
      smallWork(world, { id: 'card-51', title: 'The order history page' });
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: `${world.starts().length} runs started for the approved small work` };
      if (world.starts()[0].order.lane !== 'small') return { pass: false, why: 'the engine was asked for another lane' };
      const order = await until(() => world.orders()[0]);
      if (!order) return { pass: false, why: 'the helper kept no work order for the run' };
      if (order.lane !== 'small') return { pass: false, why: `the order is for the ${order.lane} lane` };
      if (typeof order.testCommand !== 'string' || order.testCommand === '') return { pass: false, why: 'the order carries no test command' };
      if (!order.bindings || typeof order.bindings !== 'object') return { pass: false, why: 'the order carries no routing tiers' };
      const ended = await until(async () => { await world.tick(); return world.views().runs?.['card-51']?.find((r) => r.data.state === 'ended'); });
      if (!ended) return { pass: false, why: 'the run didn\'t end' };
      return { pass: true, why: 'held on the quick lane alone, then one small-lane run with its test command and tiers, to its pull request' };
    },
  },
  variants: { with: {} },
};
