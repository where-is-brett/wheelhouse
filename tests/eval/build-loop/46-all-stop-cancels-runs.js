// tests/eval/build-loop/46-all-stop-cancels-runs.js
// Scenario 46 (Archon design, sections 12.3 and 18): All stop while one run is under way and another waits for an
// answer. Pass: the running one is cancelled, the waiting one is left paused (Archon cancels only running and pending
// runs), the record names both for the First Mate's Carry on, and nothing starts while All stop is on. Once it is
// lifted and the First Mate queues the cancelled work again, it is run again from the start (a new run), never resumed.
// Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { asking, running } from './engine-recordings.js';

export default {
  id: 46,
  title: 'All stop cancels the running work, leaves the waiting work paused, and the work runs again only from the start',
  engine: {
    recordings: { 'card-46a': running('card-46a'), 'card-46b': asking('card-46b'), 'card-46c': running('card-46c') },
    async play(world) {
      world.put('work', { id: 'card-46a', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [], place: 0 });
      world.put('work', { id: 'card-46b', title: 'The footer', lane: 'quick', visible: false, dependsOn: [], place: 1 });
      await world.tick();
      if (!await until(() => world.records('question').length === 1)) return { pass: false, why: 'the second run never waited for an answer' };
      world.stop();
      const note = await until(() => world.records('note').find((n) => n.data.about === 'all-stop'));
      if (!note) return { pass: false, why: 'All stop left no record of the work it stopped' };
      const [a, b] = world.starts().map((s, i) => `fake-${i + 1}-${s.order.work}`);
      if (!note.data.cancelled.some((c) => JSON.stringify(c).includes(a))) return { pass: false, why: 'the running run wasn\'t cancelled' };
      if (!note.data.paused.some((p) => JSON.stringify(p).includes(b))) return { pass: false, why: 'the waiting run wasn\'t listed as paused' };
      if (world.engine.inspect(b).status !== 'paused') return { pass: false, why: `the waiting run is ${world.engine.inspect(b).status}, not paused` };
      world.put('work', { id: 'card-46c', title: 'The header', lane: 'quick', visible: false, dependsOn: [], place: 2 });
      await world.tick();
      if (world.starts().length !== 2) return { pass: false, why: 'work started under All stop' };
      world.lift();
      // The First Mate's Carry on queues the cancelled work again.
      world.put('work', { id: 'card-46a', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [], place: 0 });
      if (!await until(async () => { await world.tick(); return world.starts().filter((s) => s.order.work === 'card-46a').length === 2; })) return { pass: false, why: 'the cancelled work wasn\'t run again once All stop was lifted' };
      if (world.acts().some((c) => c.action?.resume)) return { pass: false, why: 'a cancelled run was resumed rather than run again' };
      return { pass: true, why: 'running cancelled, waiting left paused, nothing under All stop, and a fresh run after it' };
    },
  },
  variants: { with: {} },
};
