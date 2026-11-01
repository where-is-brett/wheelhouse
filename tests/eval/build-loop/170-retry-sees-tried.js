// tests/eval/build-loop/170-retry-sees-tried.js
// Scenario 170 (unattended goals design, section 9.2): quick work whose run failed at a step, of a kind that isn't tried
// again. Pass: one card, and its Try again starts a fresh run on the same branch whose order carries a `tried` list with
// that run's step and kind, written by the helper from the record. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { TRY_AGAIN } from '../../../scripts/engine/dispatch-run.js';
import { failingRun, quickRun } from './engine-recordings.js';

export default {
  id: 170,
  title: 'A try after a failed run is told what failed',
  engine: {
    recordings: { 'card-170': [failingRun('card-170', { failure: 'other', failedAt: 'implement' }), quickRun('card-170', { pr: 1701 })] },
    async play(world) {
      world.put('work', { id: 'card-170', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] });
      const card = await until(async () => { await world.tick(); return world.records('question').find((q) => q.data.work === 'card-170'); });
      if (!card) return { pass: false, why: 'the failed run brought no card' };
      if (!card.data.options.some((o) => o.label === TRY_AGAIN)) return { pass: false, why: 'the card has no Try again' };
      world.answer(card.data, TRY_AGAIN);
      const second = await until(async () => { await world.tick(); return world.starts().length === 2; });
      if (!second) return { pass: false, why: 'Try again started no fresh run' };
      const start = world.starts()[1].order;
      if (start.branch !== 'wh/card-170') return { pass: false, why: `the fresh run was on ${start.branch}` };
      const [first, fresh] = world.orders();
      const tried = fresh?.tried ?? [];
      if (tried.length !== 1 || tried[0].run !== first.runId || tried[0].step !== 'implement' || tried[0].failure !== 'other') return { pass: false, why: `the order's tried list was ${JSON.stringify(tried)}` };
      return { pass: true, why: 'one card, and a fresh run on the branch told what failed' };
    },
  },
  variants: { with: {} },
};
