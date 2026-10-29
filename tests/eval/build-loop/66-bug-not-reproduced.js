// tests/eval/build-loop/66-bug-not-reproduced.js
// Scenario 66 (Archon design, sections 7.2 and 18): a bug that couldn't be reproduced with a failing test. Pass: the
// director gets one blocked card offering to try again or stop, recommending to try again; choosing it starts the bug
// lane again on the same branch, carrying on. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { bug, bugBlocked, bugWork } from './engine-recordings.js';

export default {
  id: 66,
  title: 'A bug that couldn\'t be reproduced comes to the director, and goes again on their word',
  engine: {
    // The first run asks; the second, once the director says to try again, reproduces it and goes on.
    recordings: { 'card-66': [bugBlocked('card-66', 'no-reproduction', 'The bug didn\'t show up: a 65-second clip formats as 1:05 here. Steps to follow would help.'), bug('card-66')] },
    async play(world) {
      bugWork(world, { id: 'card-66', title: 'A 65-second clip shows as 1:5 on its card' });
      await world.tick();
      const card = await until(async () => { await world.tick(); return world.records('question')[0]; });
      if (!card) return { pass: false, why: 'no card came for the bug that wasn\'t reproduced' };
      const labels = card.data.options.map((o) => o.label);
      if (!labels.includes('Try to reproduce it again') || !labels.includes('Stop this work')) return { pass: false, why: `the card offers ${labels.join(', ')}` };
      if (card.data.recommendation !== 'Try to reproduce it again') return { pass: false, why: `the card recommends ${card.data.recommendation}` };
      world.answer(card.data, 'Try to reproduce it again');
      if (!await until(async () => { await world.tick(); return world.starts().length === 2; })) return { pass: false, why: 'trying again didn\'t start the bug lane again' };
      const again = world.starts()[1].order;
      if (again.lane !== 'bug' || again.carryOn !== true || again.branch !== 'wh/card-66') return { pass: false, why: 'the second run didn\'t carry on in the bug lane on its branch' };
      return { pass: true, why: 'one card to try again or stop; trying again carried on in the bug lane on its branch' };
    },
  },
  variants: { with: {} },
};
