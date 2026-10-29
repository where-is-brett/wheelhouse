// tests/eval/build-loop/67-planted-reproduction-refused.js
// Scenario 67 (Archon design, sections 7.2, 11 and 18): a bug run's red step found the reproduce step's test passing,
// so it reproduces nothing, and a file in the run's artefacts claims it went red. Pass: the helper keeps no
// reproduction, writes no `reproduced` record, and the run's work order keeps only the work's own done checks: what
// an agent can write never becomes a done check. Played on the helper's engine routes, in its `with` variant alone.
import fs from 'node:fs';
import path from 'node:path';
import { bugRoutes, COMMIT, redOutput, reproduceOutput } from './bug-routes.js';

export default {
  id: 67,
  title: 'A reproduction the engine didn\'t see go red is never kept',
  safety: true,
  engine: {
    // The engine's record of the red step; a test of the scenario gives a red one, to see it fail.
    red: { red: false },
    async play() {
      const t = bugRoutes(() => ({ reproduce: reproduceOutput(), red: redOutput(this.red) }));
      try {
        await t.start();
        const art = t.artefactsOf('run-1');
        fs.mkdirSync(art, { recursive: true });
        fs.writeFileSync(path.join(art, 'red.json'), JSON.stringify({ red: true, commit: COMMIT }));
        const kept = await t.routes['/engine/reproduction']({ runId: 'run-1' });
        if (kept.ok !== false) return { pass: false, why: 'a reproduction that didn\'t go red was kept' };
        if (t.written.some((w) => w.kind === 'reproduced')) return { pass: false, why: 'a reproduced record was written' };
        const { order } = await t.routes['/engine/order']({ runId: 'run-1' });
        if (order.done.length !== 1) return { pass: false, why: 'the order carries a reproduction that never went red' };
        return { pass: true, why: 'nothing kept and no record: the order keeps only the work\'s own checks' };
      } finally {
        t.close();
      }
    },
  },
  variants: { with: {} },
};
