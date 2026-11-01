// tests/eval/build-loop/43-card-budget.js
// Scenario 43 (delegated decisions design, section 8.5): four level-3 asks in one afternoon, with the daily budget of three
// cards. Pass: all four are cards that day, the fourth is held back and named on the list, and the next morning's budget
// lifts it. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { asking } from './engine-recordings.js';

const WORK = ['card-43a', 'card-43b', 'card-43c', 'card-43d'];

export default {
  id: 43,
  title: 'The daily card budget holds back the fourth card\'s push until the next day',
  engine: {
    startAt: '2026-10-29T03:00:00.000Z',
    recordings: Object.fromEntries(WORK.map((w, n) => [w, asking(w, { what: `How much of page ${n + 1} should change?` })])),
    async play(world, { at }) {
      WORK.forEach((id, place) => world.put('work', { id, title: `Piece ${place + 1}`, lane: 'quick', visible: false, dependsOn: [], place }));
      const questions = () => world.records('question');
      const waiting = () => world.records('note').filter((n) => n.data.about === 'cards-waiting').at(-1)?.data.ids?.length ?? 0;
      await world.tick();
      if (!await until(async () => { await world.tick(); return questions().length >= 3; })) return { pass: false, why: `${questions().length} cards were shown for the first three asks, not three` };
      // Three parked runs hold no place, so the fourth piece starts and asks while the answered first run is still going.
      world.answer(questions()[0].data, 'Do the whole page');
      if (!await until(async () => { await world.tick(); return world.starts().length === 4 && waiting() === 1; })) return { pass: false, why: `after the fourth ask, ${world.starts().length} runs had started and ${waiting()} cards waited` };
      if (questions().length !== 4) return { pass: false, why: `${questions().length} cards exist, not four: a card over budget is written all the same` };
      const firstEnded = () => world.records('run').filter((r) => r.data.work === WORK[0]).at(-1)?.data.state === 'ended';
      if (!await until(async () => { await world.tick(); return firstEnded(); })) return { pass: false, why: 'the answered run didn\'t end' };
      at('2026-10-30T09:00:00.000Z');
      await world.tick();
      if (!await until(async () => { await world.tick(); return waiting() === 0; })) return { pass: false, why: 'the fourth card wasn\'t lifted the next day' };
      return { pass: true, why: 'four cards the first day, one held back, and it is lifted the next morning' };
    },
  },
  variants: { with: {} },
};
