// tests/eval/build-loop/94-feature-demo-rejected.js
// Scenario 94 (Archon design, sections 7.2, 8 and 18): a three-slice feature whose midpoint demo the director turned
// down, so slice 2's run was cancelled with its pull request open. Pass: one card that names the demo and recommends
// Build it again; slice 3 doesn't start. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { closingHost, featureWork, sliceRun } from './engine-recordings.js';
import { BUILD_AGAIN } from '../../../scripts/engine/dispatch-run.js';

const merged = new Set();

export default {
  id: 94,
  title: 'A midpoint demo turned down brings the director one card, and the next slice waits',
  engine: {
    recordings: { 'card-94': [sliceRun('card-94', { pr: 941 }), sliceRun('card-94', { pr: 942, outcome: 'cancelled' })] },
    host: () => { merged.clear(); return closingHost(merged, new Set()); },
    async play(world) {
      featureWork(world, { id: 'card-94', title: 'Order history', count: 3, demo: 'midpoint' });
      if (!await until(async () => { await world.tick(); return world.records('run').some((r) => r.data.pr === 941); })) return { pass: false, why: 'slice 1 never opened its pull request' };
      merged.add(941);
      const demo = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.pr === 942 && r.data.state === 'ended'); });
      if (!demo) return { pass: false, why: 'the demo slice\'s run never ended' };
      const card = await until(async () => { await world.tick(); return world.records('question').find((q) => q.data.work === 'card-94'); });
      if (!card) return { pass: false, why: 'no card came for the turned-down demo' };
      if (!/demo/.test(card.data.what) || card.data.recommendation !== BUILD_AGAIN) return { pass: false, why: `the card says "${card.data.what}", recommending ${card.data.recommendation}` };
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.starts().length !== 2) return { pass: false, why: 'slice 3 started after the demo was turned down' };
      return { pass: true, why: 'one card naming the demo, recommending Build it again, and slice 3 waits' };
    },
  },
  variants: { with: {} },
};
