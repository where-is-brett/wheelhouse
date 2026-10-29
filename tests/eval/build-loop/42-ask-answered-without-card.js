// tests/eval/build-loop/42-ask-answered-without-card.js
// Scenario 42 (Archon design, section 18): an ask the step marks level 1 is answered by the card router itself, with
// no card. Pass: the engine gets the answer, no question is written, and the Logbook has one plain line. Played on the
// engine the run names (`npm run eval -- 42 --engine fake`), in its `with` variant alone: without Wheelhouse there is
// no card router.
import { until } from '../../../scripts/eval/engine-world.js';
import { asking } from './engine-recordings.js';

const LINE = 'Kept the page\'s wording as it was, as the project\'s rules say.';

export default {
  id: 42,
  title: 'An ask at level 1 is answered without a card',
  engine: {
    recordings: { one: asking('card-42', { level: 1, card: false, answer: 'b', line: LINE }) },
    async play(world) {
      world.put('work', { id: 'card-42', title: 'The page wording', lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: `the dispatcher started ${world.starts().length} runs, not one` };
      const act = await until(() => world.acts().find((c) => c.action?.answer));
      if (!act) return { pass: false, why: 'the engine got no answer' };
      const said = () => world.records('note').filter((n) => n.data.about === 'engine').map((n) => n.data.words);
      if (!await until(() => said().some((w) => w.includes(LINE)))) return { pass: false, why: `the Logbook has no line for it (it has: ${said().join(' | ') || 'nothing'})` };
      const questions = world.records('question');
      if (questions.length > 0) return { pass: false, why: `a card was written: ${questions[0].data.what}` };
      return { pass: true, why: 'answered by the router, no card, one Logbook line' };
    },
  },
  variants: { with: {} },
};
