// tests/eval/build-loop/90-quick-merged-report.js
// Scenario 90 (Archon design, sections 3.1 and 18): quick work whose pull request the merge queue added. Pass: once the
// code host says the pull request merged, the work has one `merged` report naming it, and the briefing's shipped lines
// name the work; nothing is reported while the pull request is still open. Played on the engine the run names, in its
// `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { shippedLines } from '../../../scripts/engine/words.js';
import { closingHost, quickRun } from './engine-recordings.js';

const merged = new Set();

export default {
  id: 90,
  title: 'Quick work whose pull request merged is reported as shipped',
  engine: {
    recordings: { 'card-90': quickRun('card-90', { pr: 901 }) },
    host: () => { merged.clear(); return closingHost(merged, new Set()); },
    async play(world) {
      world.put('work', { id: 'card-90', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] });
      const ended = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.pr === 901); });
      if (!ended) return { pass: false, why: 'the quick run never ended with its pull request' };
      await world.tick();
      if (world.records('report').length > 0) return { pass: false, why: 'a report was written while the pull request was still open' };
      merged.add(901);
      const report = await until(async () => { await world.tick(); return world.records('report').find((r) => r.data.work === 'card-90'); });
      if (!report) return { pass: false, why: 'no report came once the pull request merged' };
      if (report.data.outcome !== 'merged' || report.data.pr !== 901) return { pass: false, why: `the report reads ${report.data.outcome} for #${report.data.pr}` };
      for (let i = 0; i < 2; i += 1) await world.tick();
      if (world.records('report').length !== 1) return { pass: false, why: 'the report was written more than once' };
      const lines = shippedLines(world.views());
      if (!lines.some((l) => /sale banner/.test(l))) return { pass: false, why: `the briefing's shipped lines were ${JSON.stringify(lines)}` };
      return { pass: true, why: 'one merged report once the pull request merged, and a shipped line in the briefing' };
    },
  },
  variants: { with: {} },
};
