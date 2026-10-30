// tests/eval/build-loop/126-steering.js
// Scenario 126, the build's half of scenario 26 rewritten against the pack (Archon design, sections 7.2, 7.3 and 18;
// build-loop design, section 15). "Make the export CSV, not Excel" while the export builds: the front desk has written
// the changed design and recorded the amendment and its card (scenario 26's own pass, unchanged). Pass: slice 1, under
// way, is left to finish; while the director hasn't clicked the amend card, nothing more of the feature starts, and
// the Logbook says once that its design needs approving again; once they click it, slice 2 starts from the changed
// design. Played on the engine the run names, in its `with` variant alone.
import fs from 'node:fs';
import path from 'node:path';
import { until } from '../../../scripts/eval/engine-world.js';
import { briefHash } from '../../../scripts/feature/files.js';
import { featureDesign, featureWork, mergingHost, sliceRun } from './engine-recordings.js';

const WORK = 'orders-export';
const TITLE = 'Orders export';
const CSV_GOAL = 'Part 2 works, with the export a CSV file';
const merged = new Set();

export default {
  id: 126,
  title: 'A change to a feature while it builds waits for the director\'s click, then the next slice builds the changed design',
  engine: {
    recordings: { [WORK]: [sliceRun(WORK, { pr: 1261 }), sliceRun(WORK, { pr: 1262 })] },
    host: () => { merged.clear(); return mergingHost(merged); },
    async play(world) {
      const { doc } = featureWork(world, { id: WORK, title: TITLE });
      if (!await until(async () => { await world.tick(); return world.starts().length === 1; })) return { pass: false, why: 'slice 1 didn\'t start' };

      // The front desk's part: the changed design written, and the amendment recorded with its hash.
      const changed = featureDesign({ title: TITLE }).replace('The design in words.', 'The design in words: the export is a CSV file, not an Excel workbook.').replace('"goal": "Part 2 works"', `"goal": "${CSV_GOAL}"`);
      fs.writeFileSync(path.join(world.folder, doc), changed);
      const hash = briefHash(changed);
      world.put('amendment', { work: WORK, change: 'The export is a CSV file, not an Excel workbook.', hash });

      await until(() => world.records('run').some((r) => r.data.pr === 1261));
      merged.add(1261);
      const note = await until(async () => { await world.tick(); return world.records('note').find((n) => /approving again/.test(n.data.words ?? '')); });
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.acts().some((c) => c.action?.cancel)) return { pass: false, why: 'slice 1 was cancelled rather than left to finish' };
      if (world.starts().length !== 1) return { pass: false, why: 'slice 2 started before the director clicked the change' };
      if (!note) return { pass: false, why: 'nothing said the changed design waits for the director' };
      if (world.records('note').filter((n) => /approving again/.test(n.data.words ?? '')).length !== 1) return { pass: false, why: 'the note was written more than once' };

      // The director's click on the amend card.
      world.put('action', { action: 'amend', work: WORK, hash, question: 'the card as shown', label: 'Change it' });
      if (!await until(async () => { await world.tick(); return world.starts().length === 2; })) return { pass: false, why: 'slice 2 didn\'t start once the director clicked the change' };
      const second = await until(() => world.orders()[1]);
      if (second?.slice?.n !== 2 || second.goal !== CSV_GOAL) return { pass: false, why: `the next run isn't slice 2 of the changed design: ${JSON.stringify({ slice: second?.slice, goal: second?.goal })}` };
      return { pass: true, why: 'slice 1 finished; nothing more started until the click, with one note; then slice 2 started from the changed design' };
    },
  },
  variants: { with: {} },
};
