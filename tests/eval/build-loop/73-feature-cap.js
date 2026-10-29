// tests/eval/build-loop/73-feature-cap.js
// Scenario 73 (Archon design, sections 7.2, 10.2 and 18): a feature whose runs have spent the tokens set aside for the
// whole of it (a slice's cap for each slice and one more). Pass: once slice 1 has merged, slice 2 waits and the
// director gets one card; Keep going starts slice 2. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { featureWork, mergingHost, sliceRun } from './engine-recordings.js';
import { KEEP_GOING } from '../../../scripts/engine/dispatch-run.js';

const merged = new Set();

export default {
  id: 73,
  title: 'A feature that has spent what was set aside for it waits for the director before its next slice',
  engine: {
    recordings: { 'card-73': [sliceRun('card-73', { pr: 731, tokens: 9000000 }), sliceRun('card-73')] },
    host: () => { merged.clear(); return mergingHost(merged); },
    async play(world) {
      featureWork(world, { id: 'card-73', title: 'Order history' });
      // What the feature's runs before it was queued again spent, as the helper recorded it: with slice 1's nine
      // million, past the thirty million two slices are given.
      world.put('cost', { work: 'card-73', runId: 'earlier-1', source: 'reported', tokens: 22000000, dollars: 40, premiumRequests: null, minutes: 90, byRole: {} });
      if (!await until(async () => { await world.tick(); return world.orders().length >= 1; })) return { pass: false, why: 'slice 1 never started' };
      await until(() => world.records('run').some((r) => r.data.pr === 731));
      merged.add(731);
      const card = await until(async () => { await world.tick(); return world.records('question').find((q) => q.data.options.some((o) => o.label === KEEP_GOING)); });
      if (!card) return { pass: false, why: 'no card came for the feature\'s spent cap' };
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.orders().length !== 1) return { pass: false, why: 'slice 2 started past the feature\'s cap without the director\'s say' };
      if (world.records('question').filter((q) => q.data.work === 'card-73').length !== 1) return { pass: false, why: 'the cap came to the director as more than one card' };
      world.answer(card.data, KEEP_GOING);
      if (!await until(async () => { await world.tick(); return world.orders().length >= 2; })) return { pass: false, why: 'Keep going didn\'t start slice 2' };
      if (world.orders()[1].slice?.n !== 2) return { pass: false, why: 'Keep going started something other than slice 2' };
      return { pass: true, why: 'one card at the feature\'s cap, and slice 2 only after Keep going' };
    },
  },
  variants: { with: {} },
};
