// tests/eval/build-loop/72-feature-all-stop.js
// Scenario 72 (Archon design, sections 7.2, 12.3 and 18): All stop while a feature's second slice is being built.
// Pass: the slice's run is cancelled and nothing of the feature starts while All stop is on; once it is lifted and the
// First Mate's Carry on queues the feature again, slice 2 starts again on its own branch, carrying on, and slice 1,
// already merged, never runs again. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { featureWork, mergingHost, sliceRun } from './engine-recordings.js';

const merged = new Set();

export default {
  id: 72,
  title: 'All stop cancels a feature\'s slice, and Carry on takes up that slice, never one already merged',
  engine: {
    recordings: { 'card-72': [sliceRun('card-72', { pr: 721 }), sliceRun('card-72'), sliceRun('card-72', { pr: 722 })] },
    host: () => { merged.clear(); return mergingHost(merged); },
    async play(world) {
      featureWork(world, { id: 'card-72', title: 'Order history' });
      if (!await until(async () => { await world.tick(); return world.orders().length >= 1; })) return { pass: false, why: 'slice 1 never started' };
      await until(() => world.records('run').some((r) => r.data.pr === 721));
      merged.add(721);
      if (!await until(async () => { await world.tick(); return world.orders().length >= 2; })) return { pass: false, why: 'slice 2 never started' };
      world.stop();
      const note = await until(() => world.records('note').find((n) => n.data.about === 'all-stop'));
      const slice2 = world.records('run').find((r) => r.data.lane === 'slice' && r.data.runId !== world.records('run').find((x) => x.data.pr === 721)?.data.runId)?.data.runId;
      if (!note || !note.data.cancelled.some((c) => JSON.stringify(c).includes(slice2))) return { pass: false, why: 'All stop didn\'t cancel the slice being built' };
      if (world.engine.inspect(slice2).status === 'running') return { pass: false, why: 'the slice is still running under All stop' };
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.starts().length !== 2) return { pass: false, why: 'the feature started a run under All stop' };
      world.lift();
      // The First Mate's Carry on queues the feature again.
      featureWork(world, { id: 'card-72', title: 'Order history' });
      if (!await until(async () => { await world.tick(); return world.orders().length >= 3; })) return { pass: false, why: 'Carry on started nothing once All stop was lifted' };
      if (world.orders()[2].slice?.n !== 2) return { pass: false, why: `Carry on started slice ${world.orders()[2].slice?.n ?? '(none)'}, not slice 2` };
      const second = world.records('run').find((r) => r.data.runId === slice2 && typeof r.data.branch === 'string')?.data ?? {};
      const again = world.starts()[2].order;
      if (again.carryOn !== true || !again.branch || again.branch !== second.branch) return { pass: false, why: `slice 2 didn't carry on on its own branch: ${JSON.stringify({ carryOn: again.carryOn, branch: again.branch, was: second.branch })}` };
      if (world.orders().filter((o) => o.slice?.n === 1).length !== 1) return { pass: false, why: 'slice 1, already merged, ran again' };
      if (world.acts().some((c) => c.action?.resume)) return { pass: false, why: 'the cancelled run was resumed rather than carried on in a new run' };
      return { pass: true, why: 'slice 2 cancelled, nothing under All stop, then carried on on its branch with slice 1 kept' };
    },
  },
  variants: { with: {} },
};
