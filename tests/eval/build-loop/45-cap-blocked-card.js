// tests/eval/build-loop/45-cap-blocked-card.js
// Scenario 45 (Archon design, sections 10.2 and 18): a quick run spends past the lane's token cap. Pass: the run is
// stopped, the director gets one card recommending it stays stopped, and Give it more starts it again on its own
// branch, carrying on from what is there, with the cap raised once; nothing starts again without that Yes. Played on
// the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';

export default {
  id: 45,
  title: 'A run that reaches its cap stops and asks before it spends more',
  engine: {
    // A quick run's cap is a million tokens by default; this one has spent 1.2 million on its first step.
    recordings: { 'card-45': running('card-45', 1200000) },
    async play(world) {
      world.put('work', { id: 'card-45', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      const cancelled = () => world.acts().find((c) => c.action?.cancel);
      if (!await until(async () => { await world.tick(); return cancelled(); })) return { pass: false, why: 'the run went on past its token cap' };
      const card = await until(() => world.records('question').find((q) => q.data.options.some((o) => o.label === 'Give it more')));
      if (!card) return { pass: false, why: 'no card came for the reached cap' };
      if (card.data.recommendation !== 'Stop') return { pass: false, why: `the card recommends ${card.data.recommendation}, not staying stopped` };
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: 'the work started again before the director said yes' };
      world.answer(card.data, 'Give it more');
      if (!await until(async () => { await world.tick(); return world.starts().length === 2; })) return { pass: false, why: 'Give it more didn\'t start it again' };
      const again = world.starts()[1].order;
      if (again.carryOn !== true || again.work !== 'card-45') return { pass: false, why: 'the second run didn\'t carry on from the first' };
      return { pass: true, why: 'stopped at the cap, one card, carried on only after Give it more' };
    },
  },
  variants: { with: {} },
};
