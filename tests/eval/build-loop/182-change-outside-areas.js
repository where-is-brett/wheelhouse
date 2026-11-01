// tests/eval/build-loop/182-change-outside-areas.js
// Scenario 182 (unattended goals design, section 6): a goal's piece changes a file outside the goal's areas. Pass: marking
// it ready hands nothing to the merge queue, one level-3 card comes, the permit refuses the merge behind it, and only Allow
// this once, at that head, marks it ready and hands it over. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { areaQuestion, ALLOW_ONCE } from '../../../scripts/engine/areas.js';
import { running } from './engine-recordings.js';
import { signGoal } from './goal-world.js';

const WORK = 'card-182';
const handOvers = (world) => world.engine.calls.filter((c) => c.call === 'handOver');

export default {
  id: 182,
  title: 'A change outside a goal\'s areas waits for the director',
  engine: {
    startAt: '2026-11-01T09:00:00.000Z',
    place: 'no-ci',
    recordings: { [WORK]: running(WORK) },
    async play(world, { now }) {
      signGoal(world, { id: 'goal-182', work: WORK, title: 'The sale banner', now, areas: { may: ['src/**'], wontTouch: [] } });
      const { pr, head } = await world.lane(WORK, { ready: false });
      const order = world.orders().find((o) => o.work === WORK);
      if (order?.areas?.goal !== 'goal-182') return { pass: false, why: 'the order carries no areas' };
      const marked = await world.markReady(WORK);
      if (marked?.held !== 'areas') return { pass: false, why: `marking it ready read ${JSON.stringify(marked)}` };
      if (handOvers(world).length !== 0) return { pass: false, why: 'the merge queue was handed the change' };
      const id = areaQuestion(WORK, head);
      const card = await until(async () => { await world.tick(); return world.records('question').find((q) => q.data.id === id); });
      if (!card) return { pass: false, why: 'no card came' };
      if (card.data.level !== 3 || !card.data.what.includes('README.md')) return { pass: false, why: 'the card doesn\'t name the file, at level 3' };
      await world.tick();
      if (world.records('question').filter((q) => q.data.id === id).length !== 1) return { pass: false, why: 'the card came twice' };
      const merge = await world.broker(['pr', 'merge', String(pr), '--squash', '--match-head-commit', head]);
      if (merge.code === 0 || !/areas/.test(merge.stderr)) return { pass: false, why: `the permit said ${merge.stderr}` };
      world.answer(card.data, ALLOW_ONCE);
      const handed = await until(async () => { await world.tick(); return handOvers(world).length > 0; });
      if (!handed) return { pass: false, why: 'Allow this once handed nothing to the queue' };
      return { pass: true, why: 'held at mark ready with one card, refused by the permit, and handed over once allowed' };
    },
  },
  variants: { with: {} },
};
