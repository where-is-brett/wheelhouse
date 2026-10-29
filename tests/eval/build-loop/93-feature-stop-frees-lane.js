// tests/eval/build-loop/93-feature-stop-frees-lane.js
// Scenario 93 (Archon design, sections 7.3 and 18): two approved features, the first held up by its closed slice.
// Pass: Stop here on the first feature's card ends it with a `closed` report and a Logbook line, and the second
// feature, which waited for the feature lane's one place, starts. Played on the engine the run names, in its `with`
// variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { closingHost, featureWork, sliceRun } from './engine-recordings.js';
import { STOP_HERE } from '../../../scripts/engine/dispatch-run.js';

const closed = new Set();

export default {
  id: 93,
  title: 'Stop here ends a held-up feature and frees the feature lane for the next',
  engine: {
    recordings: { 'card-93a': sliceRun('card-93a', { pr: 931 }), 'card-93b': sliceRun('card-93b') },
    host: () => { closed.clear(); return closingHost(new Set(), closed); },
    async play(world) {
      featureWork(world, { id: 'card-93a', title: 'Order history', place: 0 });
      featureWork(world, { id: 'card-93b', title: 'Saved addresses', place: 1 });
      const ended = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.pr === 931); });
      if (!ended) return { pass: false, why: 'the first feature\'s slice never opened its pull request' };
      if (world.starts().some((s) => s.order.work === 'card-93b')) return { pass: false, why: 'the second feature started beside the first' };
      closed.add(931);
      const card = await until(async () => { await world.tick(); return world.records('question').find((q) => q.data.work === 'card-93a'); });
      if (!card) return { pass: false, why: 'no card came for the closed pull request' };
      world.answer(card.data, STOP_HERE);
      const second = await until(async () => { await world.tick(); return world.starts().find((s) => s.order.work === 'card-93b'); });
      if (!second) return { pass: false, why: 'the second feature never started after Stop here' };
      const report = world.records('report').find((r) => r.data.work === 'card-93a');
      if (report?.data.outcome !== 'closed') return { pass: false, why: 'the first feature has no closed report' };
      if (!world.records('note').some((n) => /Order history stops here/.test(n.data.words ?? ''))) return { pass: false, why: 'the Logbook doesn\'t say the feature stopped' };
      return { pass: true, why: 'Stop here closed the first feature, with a Logbook line, and the second took its place' };
    },
  },
  variants: { with: {} },
};
