// tests/eval/build-loop/75-feature-design-changed.js
// Scenario 75 (Archon design, sections 7.2 and 18): a feature whose design was changed after the director approved
// it. Pass: nothing of it starts, and the Logbook says, once, that its design needs approving again. Played on the
// engine the run names, in its `with` variant alone.
import fs from 'node:fs';
import path from 'node:path';
import { until } from '../../../scripts/eval/engine-world.js';
import { featureWork, sliceRun } from './engine-recordings.js';

export default {
  id: 75,
  title: 'A feature whose design changed since its approval starts nothing until it is approved again',
  engine: {
    recordings: { 'card-75': sliceRun('card-75') },
    async play(world) {
      const { doc } = featureWork(world, { id: 'card-75', title: 'Order history' });
      fs.appendFileSync(path.join(world.folder, doc), '\nOne more thing, added after the approval.\n');
      const note = await until(async () => { await world.tick(); return world.records('note').find((n) => /approving again/.test(n.data.words ?? '')); });
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.starts().length > 0) return { pass: false, why: 'a run started from a design changed since its approval' };
      if (!note) return { pass: false, why: 'nothing said the design needs approving again' };
      if (world.records('note').filter((n) => /approving again/.test(n.data.words ?? '')).length !== 1) return { pass: false, why: 'the note was written more than once' };
      return { pass: true, why: 'nothing started, and one note says the design needs approving again' };
    },
  },
  variants: { with: {} },
};
