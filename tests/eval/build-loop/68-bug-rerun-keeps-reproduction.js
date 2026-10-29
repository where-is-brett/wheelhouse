// tests/eval/build-loop/68-bug-rerun-keeps-reproduction.js
// Scenario 68 (Archon design, sections 7.2, 10.2 and 18): a bug run kept its reproduction, then the work was sent
// back, and its fresh run on the same branch gave another. Pass: the fresh run gets the first reproduction back, the
// helper writes no second `reproduced` record, and the fresh run's order carries the first reproduction: a rerun never
// trades its check for an easier one. Played on the helper's engine routes, in its `with` variant alone.
import { bugRoutes, CHECK, COMMIT, redOutput, reproduceOutput } from './bug-routes.js';

const EASIER = { test: 'formats 70 seconds as 1:10' };

export default {
  id: 68,
  title: 'A bug\'s fresh run keeps the reproduction its first run kept',
  engine: {
    async play() {
      const t = bugRoutes((runId) => (runId === 'run-1'
        ? { reproduce: reproduceOutput(), red: redOutput() }
        : { reproduce: reproduceOutput(EASIER), red: redOutput({ commit: 'f'.repeat(40), check: EASIER }) }));
      try {
        await t.start();
        if ((await t.routes['/engine/reproduction']({ runId: 'run-1' })).ok !== true) return { pass: false, why: 'the first run\'s reproduction wasn\'t kept' };
        await t.start();
        const again = await t.routes['/engine/reproduction']({ runId: 'run-2' });
        if (again.ok !== true || again.check.test !== CHECK.test || again.commit !== COMMIT) return { pass: false, why: `the fresh run kept ${JSON.stringify(again)}` };
        if (t.written.filter((w) => w.kind === 'reproduced').length !== 1) return { pass: false, why: 'a second reproduced record was written' };
        const { order } = await t.routes['/engine/order']({ runId: 'run-2' });
        if (order.done.at(-1)?.test !== CHECK.test) return { pass: false, why: 'the fresh run\'s order doesn\'t carry the first reproduction' };
        return { pass: true, why: 'the fresh run got the first reproduction back, with one record, and its order carries it' };
      } finally {
        t.close();
      }
    },
  },
  variants: { with: {} },
};
