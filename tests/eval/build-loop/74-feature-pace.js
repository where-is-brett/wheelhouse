// tests/eval/build-loop/74-feature-pace.js
// Scenario 74 (Archon design, sections 7.2, 11 and 18): two approved features and a piece of quick work. Pass: the
// first feature takes the feature lane's one place from its first slice on, the second waits for it, and the quick
// work starts all the same. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { featureWork, mergingHost, running, sliceRun } from './engine-recordings.js';

export default {
  id: 74,
  title: 'A second feature waits for the first, and quick work goes on beside them',
  engine: {
    recordings: { 'card-74a': sliceRun('card-74a'), 'card-74b': sliceRun('card-74b'), 'card-74c': running('card-74c') },
    host: () => mergingHost(new Set()),
    async play(world) {
      featureWork(world, { id: 'card-74a', title: 'Order history', place: 0 });
      featureWork(world, { id: 'card-74b', title: 'Saved addresses', place: 1 });
      world.put('work', { id: 'card-74c', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [], place: 2 });
      if (!await until(async () => { await world.tick(); return world.starts().length >= 2; })) return { pass: false, why: `${world.starts().length} runs started, not the first feature's and the quick work's` };
      for (let i = 0; i < 3; i += 1) await world.tick();
      const works = world.starts().map((s) => s.order.work).sort();
      if (JSON.stringify(works) !== '["card-74a","card-74c"]') return { pass: false, why: `the runs started were for ${works.join(', ')}` };
      return { pass: true, why: 'the first feature and the quick work started; the second feature waits its turn' };
    },
  },
  variants: { with: {} },
};
