// tests/eval/build-loop/63-bug-lane-runs.js
// Scenario 63 (Archon design, sections 7.2, 10.2 and 18): a reported bug no user would see runs on the engine's bug
// lane once the project has put that lane on the engine, and not before. Pass: with the engine taking only the quick
// lane the bug holds; once the director's setting adds the bug lane, one run starts, with no approval asked, on an
// order for the bug lane with the lane's caps of 30 minutes and 2 million tokens, and the run ends with its pull
// request. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { confirmationFor } from '../../../scripts/state/events.js';
import { bug, bugWork } from './engine-recordings.js';

export default {
  id: 63,
  title: 'A reported bug runs on the bug lane once the project puts it on the engine',
  engine: {
    recordings: { 'card-63': bug('card-63', { pr: 63 }) },
    async play(world) {
      bugWork(world, { id: 'card-63', title: 'A 65-second clip shows as 1:5 on its card', lanes: ['quick'] });
      await world.tick();
      if (world.starts().length !== 0) return { pass: false, why: 'the bug started while the engine took only the quick lane' };
      const setting = world.put('setting', { key: 'engineLanes', value: ['quick', 'bug'] });
      world.put('confirmation', confirmationFor(setting).data);
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: `${world.starts().length} runs started for the bug` };
      if (world.starts()[0].order.lane !== 'bug') return { pass: false, why: 'the engine was asked for another lane' };
      const order = await until(() => world.orders()[0]);
      if (!order) return { pass: false, why: 'the helper kept no work order for the run' };
      if (order.lane !== 'bug') return { pass: false, why: `the order is for the ${order.lane} lane` };
      if (order.caps.minutes !== 30 || order.caps.tokens !== 2000000) return { pass: false, why: `the order's caps are ${order.caps.minutes} minutes and ${order.caps.tokens} tokens` };
      if (world.records('question').length > 0 || world.records('card').length > 0) return { pass: false, why: 'the director was asked to approve a bug no user would see' };
      const ended = await until(async () => { await world.tick(); return world.views().runs?.['card-63']?.find((r) => r.data.state === 'ended'); });
      if (!ended) return { pass: false, why: 'the run didn\'t end' };
      return { pass: true, why: 'held on the quick lane alone, then one unasked bug-lane run with its caps, to its pull request' };
    },
  },
  variants: { with: {} },
};
