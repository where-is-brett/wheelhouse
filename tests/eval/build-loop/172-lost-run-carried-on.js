// tests/eval/build-loop/172-lost-run-carried-on.js
// Scenario 172 (unattended goals design, section 9.5): quick work whose run lost its process. Pass: the run is cancelled, its
// spend is counted, one fresh run starts on its branch with no card, and a second loss brings a card with Carry on and Stop
// and starts nothing. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';

const WORK = 'card-172';

export default {
  id: 172,
  title: 'A run that lost its process carries on once on its branch',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [WORK]: [running(WORK), running(WORK)] },
    async play(world) {
      world.put('work', { id: WORK, title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] });
      const going = await until(async () => { await world.tick(); return world.starts().length === 1 && world.records('run').some((r) => r.data.state === 'started'); });
      if (!going) return { pass: false, why: 'the run never started' };
      const first = world.records('run').find((r) => r.data.state === 'started').data.runId;
      world.engine.loseOwner(first);
      const second = await until(async () => { await world.tick(); return world.starts().length === 2; });
      if (!second) return { pass: false, why: 'no fresh run started' };
      const { order } = world.starts()[1];
      if (order.branch !== `wh/${WORK}` || order.carryOn !== true) return { pass: false, why: 'the fresh run wasn\'t on its branch' };
      if (world.acts().filter((c) => c.action.cancel).length !== 1) return { pass: false, why: 'the lost run wasn\'t cancelled once' };
      if (!world.records('cost').some((c) => c.data.runId === first)) return { pass: false, why: 'the lost run\'s spend wasn\'t counted' };
      if (world.records('question').some((q) => q.data.work === WORK)) return { pass: false, why: 'a card came for the first loss' };
      const next = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.state === 'started' && r.data.runId !== first); });
      if (!next) return { pass: false, why: 'the fresh run isn\'t on the record' };
      world.engine.loseOwner(next.data.runId);
      const card = await until(async () => { await world.tick(); return world.records('question').find((q) => q.data.work === WORK); });
      if (!card) return { pass: false, why: 'a second loss brought no card' };
      const labels = card.data.options.map((o) => o.label);
      if (!labels.includes('Carry on') || !labels.includes('Stop')) return { pass: false, why: `the card offers ${labels.join(', ')}` };
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.starts().length !== 2) return { pass: false, why: 'a third run started by itself' };
      return { pass: true, why: 'cancelled, carried on once with its spend, and a card on the second loss' };
    },
  },
  variants: { with: {} },
};
