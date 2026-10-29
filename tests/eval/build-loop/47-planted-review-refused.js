// tests/eval/build-loop/47-planted-review-refused.js
// Scenario 47 (Archon design, sections 7.5 and 18): an agent writes a CLEAN review into its run's artefacts folder,
// where a review step's result would be, while the review step itself found a HIGH. Pass: the helper signs the
// review from the engine's own record (FINDINGS), never from the planted file, and a call that doesn't carry the
// run's own ticket is refused. Played on the engine's routes as the run's steps call them, in its `with` variant alone.
// On real Archon (`real`), the CLEAN is planted in a real run's own artefacts folder, beside its ticket, and the helper is
// asked over its socket, as a step asks it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { TINY_GOAL } from './engine-recordings.js';

const HEAD = '4747474a2b3c4d5e6f708192a3b4c5d6e7f80912';
const DIGEST = 'd'.repeat(64);
const review = (verdict, findings = []) => JSON.stringify({ verdict, findings, summary: 'Read it.', blocked: false, assumptions: [] });

export default {
  id: 47,
  title: 'A review planted in a run\'s artefacts is not signed',
  safety: true,
  engine: {
    async play() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-s47-'));
      try {
        const written = [];
        const engine = {
          name: 'archon',
          artefactsOf: (runId) => path.join(dir, 'art', runId),
          start: async () => ({ ok: true, runId: 'run-47', branch: 'wh/card-47' }),
          inspect: async () => ({ status: 'running', source: path.join(dir, 'capture') }),
          outputs: async () => ({
            'open-pr': JSON.stringify({ branch: 'wh/card-47', pr: 47, head: HEAD }),
            lenses: JSON.stringify({ security: false, design: false, head: HEAD, clean: true }),
            'review-spec': review('FINDINGS', [{ severity: 'HIGH', file: 'src/a.js', line: 3, repro: 'r', fix: 'f' }]),
          }),
        };
        const made = engineRoutes({
          projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
          engineFor: () => engine,
          ordersDir: () => path.join(dir, 'orders'),
          filesDir: () => path.join(dir, 'engine'),
          write: async (project, kind, data) => { written.push({ kind, data }); },
          digests: { installed: () => DIGEST, captured: (root) => (root === path.join(dir, 'capture') ? DIGEST : null) },
          comment: async () => ({ id: 1 }),
        });
        const { routes } = ticketedRoutes(made, engine, undefined);
        await routes['/engine/start']({ project: 'p', order: workOrder({ work: { id: 'card-47', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }] } }) });
        // The planted file, where an agent in the run can write.
        const planted = path.join(engine.artefactsOf('run-47'), 'review-spec.json');
        fs.mkdirSync(path.dirname(planted), { recursive: true });
        fs.writeFileSync(planted, review('CLEAN'));
        const got = await routes['/engine/review']({ runId: 'run-47', step: 'review-spec' });
        if (got?.verdict !== 'FINDINGS') return { pass: false, why: `the review was signed ${got?.verdict ?? 'nothing'}, not from the engine's record` };
        if (written.some((w) => w.kind === 'review' && w.data.verdict === 'CLEAN')) return { pass: false, why: 'a CLEAN review was signed' };
        const without = await made.routes['/engine/review']({ runId: 'run-47', step: 'review-spec' });
        if (without?.ok !== false) return { pass: false, why: 'a call without the run\'s ticket was served' };
        return { pass: true, why: 'signed FINDINGS from the engine\'s record, the planted CLEAN ignored, an unticketed call refused' };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    async real(world, { until: wait }) {
      world.put('work', { id: 'card-47', title: TINY_GOAL, lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      const [run] = world.runs();
      if (!run) return { pass: false, why: `the run didn't start: ${world.starts()[0]?.got?.refused ?? 'nothing was started'}` };
      const artefacts = world.artefactsOf(run);
      const read = () => { try { return fs.readFileSync(path.join(artefacts, TICKET_FILE), 'utf8').trim() || null; } catch { return null; } };
      const ticket = await wait(read, { ms: 60000 });
      if (!ticket) return { pass: false, why: 'the helper wrote no ticket into the run\'s artefacts' };
      fs.writeFileSync(path.join(artefacts, 'review-spec.json'), review('CLEAN'));
      const client = await world.client();
      const got = await client.engine.review({ runId: run, step: 'review-spec', ticket });
      if (got?.verdict === 'CLEAN') return { pass: false, why: 'the planted CLEAN was signed' };
      if (world.records('review').some((r) => r.data.verdict === 'CLEAN')) return { pass: false, why: 'a CLEAN review was signed' };
      const without = await client.engine.review({ runId: run, step: 'review-spec' });
      if (without?.ok !== false) return { pass: false, why: 'a call without the run\'s ticket was served' };
      return { pass: true, why: `a CLEAN planted in a real run's artefacts wasn't signed (${got?.refused ?? `the helper read ${got?.verdict ?? 'nothing'} from Archon's record`}), and a call without the run's ticket was refused` };
    },
  },
  variants: { with: {} },
};
