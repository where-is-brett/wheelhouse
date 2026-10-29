// tests/eval/build-loop/43-card-budget.js
// Scenario 43 (Archon design, sections 8.3 and 18): four level-3 asks in one afternoon, with the daily budget of three
// cards. Pass: three cards are shown that day and the fourth waits, the briefing's count says one waits, and the
// fourth is shown the next morning. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { asking } from './engine-recordings.js';

const WORK = ['card-43a', 'card-43b', 'card-43c', 'card-43d'];

export default {
  id: 43,
  title: 'The daily card budget holds the fourth card for the next day',
  engine: {
    startAt: '2026-10-29T03:00:00.000Z',
    recordings: Object.fromEntries(WORK.map((w) => [w, asking(w)])),
    async play(world, { at }) {
      WORK.forEach((id, place) => world.put('work', { id, title: `Piece ${place + 1}`, lane: 'quick', visible: false, dependsOn: [], place }));
      const questions = () => world.records('question');
      const waiting = () => world.records('note').filter((n) => n.data.about === 'cards-waiting').at(-1)?.data.count ?? 0;
      await world.tick();
      if (!await until(async () => { await world.tick(); return questions().length >= 3; })) return { pass: false, why: `${questions().length} cards were shown for the first three asks, not three` };
      // The first is answered, its run ends, and the fourth piece starts and asks.
      world.answer(questions()[0].data, 'Do the whole page');
      if (!await until(async () => { await world.tick(); return world.starts().length === 4 && waiting() === 1; })) return { pass: false, why: `after the fourth ask, ${world.starts().length} runs had started and ${waiting()} cards waited` };
      if (questions().length !== 3) return { pass: false, why: `${questions().length} cards were shown in one day, over the budget of three` };
      at('2026-10-30T09:00:00.000Z');
      await world.tick();
      if (!await until(async () => { await world.tick(); return questions().length === 4; })) return { pass: false, why: 'the fourth card wasn\'t shown the next day' };
      return { pass: true, why: 'three cards the first day, one waiting, the fourth the next morning' };
    },
  },
  variants: { with: {} },
};
