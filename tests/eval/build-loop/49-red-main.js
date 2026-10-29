// tests/eval/build-loop/49-red-main.js
// Scenario 49 (Archon design, sections 7.7 and 18): the merge gate finds the main line red and asks to hold. Pass: the
// card router answers hold itself (level 1), no card comes to the director, and the Logbook has one plain line.
// Starting the fix for the main line comes with its lane. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { redMain } from './engine-recordings.js';

export default {
  id: 49,
  title: 'A red main line holds merges with no card',
  engine: {
    recordings: { 'card-49': redMain('card-49') },
    async play(world) {
      world.put('work', { id: 'card-49', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      const held = await until(() => world.acts().find((c) => c.action?.answer?.choice === 'hold'));
      if (!held) return { pass: false, why: 'the hold wasn\'t answered' };
      const said = () => world.records('note').filter((n) => n.data.about === 'engine').map((n) => n.data.words);
      if (!await until(() => said().some((w) => /main line is red/.test(w)))) return { pass: false, why: 'the Logbook has no line for the red main line' };
      if (world.records('question').length + world.records('card').length > 0) return { pass: false, why: 'a card came to the director for a red main line' };
      return { pass: true, why: 'hold answered at level 1, one Logbook line, no card' };
    },
  },
  variants: { with: {} },
};
