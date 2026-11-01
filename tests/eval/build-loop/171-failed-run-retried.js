// tests/eval/build-loop/171-failed-run-retried.js
// Scenario 171 (unattended goals design, section 9.2): quick work whose run lost its connection. Pass: nothing happens for
// five minutes, then the same run resumes once, no card is raised, it finishes, and it has one cost record. Played on the
// engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { failingRun } from './engine-recordings.js';

const resumes = (world) => world.acts().filter((c) => c.action.resume);

export default {
  id: 171,
  title: 'A run that lost its connection is resumed after five minutes',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { 'card-171': failingRun('card-171', { failure: 'connection', failedAt: 'tests', pr: 1711 }) },
    async play(world, { at }) {
      world.put('work', { id: 'card-171', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] });
      const failed = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.outcome === 'failed'); });
      if (!failed) return { pass: false, why: 'the run never failed' };
      if (failed.data.failure !== 'connection') return { pass: false, why: `the failure read ${failed.data.failure}` };
      at('2026-10-29T09:04:00.000Z');
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (resumes(world).length !== 0) return { pass: false, why: 'it resumed before its five minutes' };
      at('2026-10-29T09:06:00.000Z');
      const resumed = await until(async () => { await world.tick(); return resumes(world).length > 0; });
      if (!resumed) return { pass: false, why: 'it never resumed' };
      // This leg ends at once, and an ending read so soon after a resume waits for the helper's own look.
      at('2026-10-29T09:10:00.000Z');
      const ended = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.state === 'ended' && r.data.resume === 1); });
      if (!ended) return { pass: false, why: 'the resumed run never ended' };
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (resumes(world).length !== 1) return { pass: false, why: `it resumed ${resumes(world).length} times` };
      if (world.starts().length !== 1) return { pass: false, why: 'a second run started beside it' };
      if (world.records('question').some((q) => q.data.work === 'card-171')) return { pass: false, why: 'a card came for a run that finished' };
      const costs = world.records('cost').filter((c) => c.data.work === 'card-171');
      if (costs.length !== 1) return { pass: false, why: `it has ${costs.length} cost records` };
      return { pass: true, why: 'one resume at five minutes, no card, and one cost at its true end' };
    },
  },
  variants: { with: {} },
};
