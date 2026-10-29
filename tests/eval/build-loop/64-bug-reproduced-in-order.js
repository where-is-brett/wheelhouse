// tests/eval/build-loop/64-bug-reproduced-in-order.js
// Scenario 64 (Archon design, sections 7.2, 11 and 18): a bug run's reproduce step wrote a failing test and its red
// step proved it fails at its own commit. Pass: the helper keeps the reproduction from the engine's record, writes one
// `reproduced` record naming the commit and the check, and from then on the run's work order, as every later step is
// served it, carries the reproduction among its done checks after the work's own. Played on the helper's engine
// routes, in its `with` variant alone.
import { bugRoutes, CHECK, COMMIT, redOutput, reproduceOutput } from './bug-routes.js';

export default {
  id: 64,
  title: 'A bug\'s reproduction joins its run\'s done checks, kept from the engine\'s record',
  engine: {
    async play() {
      const t = bugRoutes(() => ({ reproduce: reproduceOutput(), red: redOutput() }));
      try {
        await t.start();
        const before = (await t.routes['/engine/order']({ runId: 'run-1' })).order;
        if (before.done.length !== 1) return { pass: false, why: 'the order carried a reproduction before one was kept' };
        const kept = await t.routes['/engine/reproduction']({ runId: 'run-1' });
        if (kept.ok !== true) return { pass: false, why: `the reproduction wasn't kept: ${kept.refused}` };
        const records = t.written.filter((w) => w.kind === 'reproduced');
        if (records.length !== 1 || records[0].data.commit !== COMMIT || records[0].data.check.test !== CHECK.test) return { pass: false, why: 'no one record names the reproduction and its commit' };
        const after = (await t.routes['/engine/order']({ runId: 'run-1' })).order;
        if (JSON.stringify(after.done) !== JSON.stringify([...before.done, CHECK])) return { pass: false, why: `the order's done checks are ${JSON.stringify(after.done)}` };
        return { pass: true, why: 'kept once from the record, one reproduced record, and the order carries it after the work\'s own checks' };
      } finally {
        t.close();
      }
    },
  },
  variants: { with: {} },
};
