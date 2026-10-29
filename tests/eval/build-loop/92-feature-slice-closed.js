// tests/eval/build-loop/92-feature-slice-closed.js
// Scenario 92 (Archon design, sections 7.2, 8 and 18): a feature whose first slice's pull request someone closed on the
// code host without adding it. Pass: the director gets one card that says so, with Build it again and Stop here,
// recommending Stop here; nothing more of the feature starts meanwhile; Build it again carries slice 1 on from its
// branch. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { closingHost, featureWork, sliceRun } from './engine-recordings.js';
import { BUILD_AGAIN, STOP_HERE } from '../../../scripts/engine/dispatch-run.js';

const merged = new Set();
const closed = new Set();

export default {
  id: 92,
  title: 'A slice\'s pull request closed unmerged brings the director one card, and Build it again carries the slice on',
  engine: {
    recordings: { 'card-92': [sliceRun('card-92', { pr: 921 }), sliceRun('card-92')] },
    host: () => { merged.clear(); closed.clear(); return closingHost(merged, closed); },
    async play(world) {
      featureWork(world, { id: 'card-92', title: 'Order history' });
      const ended = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.pr === 921); });
      if (!ended) return { pass: false, why: 'slice 1 never opened its pull request' };
      closed.add(921);
      const card = await until(async () => { await world.tick(); return world.records('question').find((q) => q.data.work === 'card-92'); });
      if (!card) return { pass: false, why: 'no card came for the closed pull request' };
      const labels = card.data.options.map((o) => o.label);
      if (JSON.stringify(labels) !== JSON.stringify([BUILD_AGAIN, STOP_HERE]) || card.data.recommendation !== STOP_HERE) return { pass: false, why: `the card offers ${labels.join(', ')}, recommending ${card.data.recommendation}` };
      if (!/#921/.test(card.data.what)) return { pass: false, why: 'the card doesn\'t name the pull request' };
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: 'the feature started a run while the card waited' };
      if (world.records('question').filter((q) => q.data.work === 'card-92').length !== 1) return { pass: false, why: 'more than one card came' };
      world.answer(card.data, BUILD_AGAIN);
      if (!await until(async () => { await world.tick(); return world.starts().length >= 2; })) return { pass: false, why: 'Build it again started nothing' };
      const again = world.starts()[1].order;
      const slice = (await until(() => world.orders()[1]))?.slice?.n;
      if (slice !== 1 || again.carryOn !== true || again.branch !== ended.data.branch) {
        return { pass: false, why: `Build it again started ${JSON.stringify({ slice, carryOn: again.carryOn, branch: again.branch })}` };
      }
      return { pass: true, why: 'one card for the closed pull request, nothing meanwhile, then slice 1 carried on from its branch' };
    },
  },
  variants: { with: {} },
};
