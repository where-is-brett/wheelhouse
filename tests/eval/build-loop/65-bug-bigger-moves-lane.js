// tests/eval/build-loop/65-bug-bigger-moves-lane.js
// Scenario 65 (Archon design, sections 7.2 and 18): a bug's fix proved bigger than a bug's, and the lane took its
// blocked exit with a proposal. Pass: the director gets one card offering a small change, a feature or Stop, and
// recommending the small change; choosing it reaches the engine, starts no second run in the bug lane, and the Logbook
// says the First Mate records the work as a small change. Played on the engine the run names, in its `with` variant
// alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { bugBlocked, bugWork } from './engine-recordings.js';

export default {
  id: 65,
  title: 'A bug that proves bigger than a bug goes back to the First Mate as a small change',
  engine: {
    recordings: { 'card-65': bugBlocked('card-65', 'bigger-than-a-bug', 'The fix for this bug changes 7 files, more than a bug\'s fix should. Should it go on as a small change, with a plan, or as a feature?') },
    async play(world) {
      bugWork(world, { id: 'card-65', title: 'A 65-second clip shows as 1:5 on its card' });
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: `${world.starts().length} runs started` };
      const card = await until(async () => { await world.tick(); return world.records('question')[0]; });
      if (!card) return { pass: false, why: 'no card came for the proposal' };
      const labels = card.data.options.map((o) => o.label);
      if (JSON.stringify(labels.filter((l) => l !== 'Not now')) !== JSON.stringify(['Make it a small change', 'Make it a feature', 'Stop this work'])) return { pass: false, why: `the card offers ${labels.join(', ')}` };
      if (card.data.recommendation !== 'Make it a small change') return { pass: false, why: `the card recommends ${card.data.recommendation}` };
      world.answer(card.data, 'Make it a small change');
      const act = await until(async () => { await world.tick(); return world.acts().find((c) => c.action?.answer); });
      if (!act) return { pass: false, why: 'the director\'s answer didn\'t reach the engine' };
      const note = await until(async () => { await world.tick(); return world.records('note').find((n) => /bigger than a bug/.test(n.data.words)); });
      if (!note || !/records it as a small change/.test(note.data.words)) return { pass: false, why: 'the Logbook doesn\'t say the First Mate records it as a small change' };
      for (let n = 0; n < 3; n += 1) await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: 'the bug lane started the work again' };
      return { pass: true, why: 'one card with the proposal; the small change chosen, the engine told, nothing started again, and the Logbook says so' };
    },
  },
  variants: { with: {} },
};
