// tests/eval/build-loop/52-small-task-question.js
// Scenario 52 (Archon design, sections 7.2 and 18): a task of a small-lane run takes its blocked exit. A task can't
// wait inside its block, so the lane asks once every task has settled. Pass: the director gets one card, with the
// lane's options and its recommendation, and the engine is answered only after the director's click. Played on the
// engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { smallBlocked, smallWork } from './engine-recordings.js';

export default {
  id: 52,
  title: 'A small-lane task\'s question comes to the director as one card',
  engine: {
    recordings: { 'card-52': smallBlocked('card-52') },
    async play(world) {
      smallWork(world, { id: 'card-52', title: 'The order history page' });
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: `${world.starts().length} runs started` };
      const card = await until(async () => { await world.tick(); return world.records('question')[0]; });
      if (!card) return { pass: false, why: 'no card came for the task\'s question' };
      await world.tick();
      if (world.records('question').length !== 1) return { pass: false, why: `${world.records('question').length} cards came for one question` };
      const labels = card.data.options.map((o) => o.label);
      if (!labels.includes('Send it back for a fresh run') || !labels.includes('Stop this work')) return { pass: false, why: `the card offers ${labels.join(', ')}` };
      if (card.data.recommendation !== 'Send it back for a fresh run') return { pass: false, why: `the card recommends ${card.data.recommendation}` };
      if (world.acts().some((c) => c.action?.answer)) return { pass: false, why: 'the engine was answered before the director chose' };
      world.answer(card.data, 'Send it back for a fresh run');
      const act = await until(async () => { await world.tick(); return world.acts().find((c) => c.action?.answer); });
      if (!act) return { pass: false, why: 'the director\'s answer didn\'t reach the engine' };
      return { pass: true, why: 'one card with the lane\'s options, answered only on the director\'s click' };
    },
  },
  variants: { with: {} },
};
