// tests/eval/build-loop/91-small-merged-frees-dependent.js
// Scenario 91 (Archon design, sections 7.3 and 18): quick work that depends on a piece of small work. Pass: the quick
// work waits while the small work's pull request is open, and starts once that pull request merged and the small work
// reads merged. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { closingHost, running, small, smallWork } from './engine-recordings.js';

const merged = new Set();

export default {
  id: 91,
  title: 'Work that depends on small work starts once the small work\'s pull request merged',
  engine: {
    recordings: { 'card-91a': small('card-91a', { pr: 911 }), 'card-91b': running('card-91b') },
    host: () => { merged.clear(); return closingHost(merged, new Set()); },
    async play(world) {
      smallWork(world, { id: 'card-91a', title: 'The order history page' });
      world.put('work', { id: 'card-91b', title: 'A link to the order history', lane: 'quick', visible: false, dependsOn: ['card-91a'] });
      const ended = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.pr === 911); });
      if (!ended) return { pass: false, why: 'the small run never ended with its pull request' };
      for (let i = 0; i < 2; i += 1) await world.tick();
      if (world.starts().some((s) => s.order.work === 'card-91b')) return { pass: false, why: 'the dependent work started before the small work merged' };
      merged.add(911);
      const started = await until(async () => { await world.tick(); return world.starts().find((s) => s.order.work === 'card-91b'); });
      if (!started) return { pass: false, why: 'the dependent work never started once the small work merged' };
      const report = world.records('report').find((r) => r.data.work === 'card-91a');
      if (report?.data.outcome !== 'merged') return { pass: false, why: 'the small work has no merged report' };
      return { pass: true, why: 'the dependent work waited, then started once the small work read merged' };
    },
  },
  variants: { with: {} },
};
