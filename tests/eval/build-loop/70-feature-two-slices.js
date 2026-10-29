// tests/eval/build-loop/70-feature-two-slices.js
// Scenario 70 (Archon design, sections 7.2 and 18): a feature of two slices the director approved. Pass: slice 1
// starts in the slice lane behind the design's switch; slice 2 starts only once slice 1's pull request has merged; the
// feature's own run starts once both have, its order listing the slices; it ends on a switch-on approval card naming
// its pull request and head; and its merge ends the work with a merged report. Played on the engine the run names, in
// its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { featureWork, finishRun, mergingHost, sliceRun } from './engine-recordings.js';

const HEAD = '7070707a2b3c4d5e6f708192a3b4c5d6e7f80912';
const merged = new Set();

export default {
  id: 70,
  title: 'A feature of two slices is added slice by slice behind its switch, then switched on with the director\'s approval',
  engine: {
    recordings: { 'card-70': [sliceRun('card-70', { pr: 701 }), sliceRun('card-70', { pr: 702 }), finishRun('card-70', { pr: 703, head: HEAD })] },
    host: () => { merged.clear(); return mergingHost(merged); },
    async play(world) {
      featureWork(world, { id: 'card-70', title: 'Order history' });
      const startsAfter = (n) => until(async () => { await world.tick(); return world.starts().length >= n; });
      if (!await startsAfter(1)) return { pass: false, why: 'the approved feature started nothing' };
      const first = world.orders()[0];
      if (first.lane !== 'slice' || first.slice?.n !== 1 || first.flag?.name !== 'new-orders') return { pass: false, why: `slice 1 started as ${JSON.stringify({ lane: first.lane, slice: first.slice, flag: first.flag })}` };
      await until(() => world.records('run').some((r) => r.data.pr === 701));
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: 'slice 2 started before slice 1 merged' };
      merged.add(701);
      if (!await startsAfter(2)) return { pass: false, why: 'slice 2 didn\'t start once slice 1 merged' };
      if (world.orders()[1]?.slice?.n !== 2) return { pass: false, why: 'the second run isn\'t slice 2' };
      await until(() => world.records('run').some((r) => r.data.pr === 702));
      merged.add(702);
      if (!await startsAfter(3)) return { pass: false, why: 'the feature\'s own run didn\'t start once both slices merged' };
      const finish = world.orders()[2];
      if (finish.lane !== 'feature' || finish.showFirst !== true) return { pass: false, why: 'the feature\'s own run isn\'t in the feature lane, shown first' };
      if (JSON.stringify(finish.feature?.slices?.map((s) => s.pr)) !== '[701,702]') return { pass: false, why: 'the feature\'s order doesn\'t list its merged slices' };
      const card = await until(async () => { await world.tick(); return world.records('card').find((c) => /#703/.test(c.data.question ?? '')); });
      if (!card) return { pass: false, why: 'no switch-on approval card came for the feature\'s pull request' };
      if (!card.data.question.includes(HEAD.slice(0, 12))) return { pass: false, why: 'the switch-on card doesn\'t name the head it approves' };
      if (world.acts().length > 0) return { pass: false, why: 'the engine was answered before the director approved' };
      // The director's signed Approve of the head the card names.
      world.put('approval', { pr: 703, commit: HEAD });
      if (!await until(async () => { await world.tick(); return world.records('run').some((r) => r.data.pr === 703); })) return { pass: false, why: 'the director\'s approval didn\'t reach the feature\'s run' };
      merged.add(703);
      const report = await until(async () => { await world.tick(); return world.records('report').find((r) => r.data.work === 'card-70'); });
      if (report?.data.outcome !== 'merged' || report.data.pr !== 703) return { pass: false, why: 'the feature\'s merge left no merged report' };
      if (world.starts().length !== 3) return { pass: false, why: `${world.starts().length} runs started, not three` };
      return { pass: true, why: 'two slices one after the other behind the switch, then the switch-on approval and a merged report' };
    },
  },
  variants: { with: {} },
};
