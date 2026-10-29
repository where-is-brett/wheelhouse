// tests/eval/build-loop/71-feature-midpoint-demo.js
// Scenario 71 (Archon design, sections 7.2 and 18): a feature of three slices whose director chose a midpoint demo.
// Pass: slice 2, half way rounded up, is the demo and the one slice shown first; slices 1 and 3 merge behind the
// switch without being shown. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { featureWork, mergingHost, sliceRun } from './engine-recordings.js';

const merged = new Set();

export default {
  id: 71,
  title: 'A feature\'s midpoint demo shows the director the middle slice, and only that one',
  engine: {
    recordings: { 'card-71': [sliceRun('card-71', { pr: 711 }), sliceRun('card-71', { pr: 712 }), sliceRun('card-71', { pr: 713 })] },
    host: () => { merged.clear(); return mergingHost(merged); },
    async play(world) {
      featureWork(world, { id: 'card-71', title: 'Order history', count: 3, demo: 'midpoint' });
      for (const [n, pr] of [[1, 711], [2, 712], [3, 713]]) {
        if (!await until(async () => { await world.tick(); return world.orders().length >= n; })) return { pass: false, why: `slice ${n} never started` };
        await until(() => world.records('run').some((r) => r.data.pr === pr));
        merged.add(pr);
      }
      const shown = world.orders().map((o) => [o.slice?.n, o.demo === true, o.showFirst === true]);
      if (JSON.stringify(shown) !== '[[1,false,false],[2,true,true],[3,false,false]]') return { pass: false, why: `the slices' demo and shown-first were ${JSON.stringify(shown)}` };
      return { pass: true, why: 'slice 2 of 3 is the demo and the only slice shown first' };
    },
  },
  variants: { with: {} },
};
