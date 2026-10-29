// tests/eval/build-loop/bug-routes.js
// The helper's engine routes for the bug lane's scenarios (64, 67 and 68): the real routes over a stand-in engine whose
// step outputs, the engine's own record, each scenario gives by run. Not a scenario file: it has no number.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';

export const COMMIT = '6464646a2b3c4d5e6f708192a3b4c5d6e7f80912';
export const CHECK = Object.freeze({ test: 'formats 65 seconds as 1:05' });
// The reproduce step's output, and the red step's, as the engine records them.
export const reproduceOutput = (check = CHECK) => JSON.stringify({ summary: 'Reproduced.', blocked: false, assumptions: [], ...check, files: ['test/duration.test.js'] });
export const redOutput = ({ red = true, commit = COMMIT, check = CHECK } = {}) => JSON.stringify({ red, commit, check, line: red ? 'It fails.' : 'It passes.' });

// bugRoutes(outputsOf) -> { routes, written, start(), artefactsOf(runId), close() }. `outputsOf(runId)` gives the engine's
// record of that run's steps.
export function bugRoutes(outputsOf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-bug-routes-'));
  const written = [];
  let next = 0;
  const engine = {
    name: 'archon',
    artefactsOf: (runId) => path.join(dir, 'art', runId),
    start: async () => { next += 1; return { ok: true, runId: `run-${next}`, branch: 'wh/video-length' }; },
    outputs: async (runId) => ({ ...outputsOf(runId) }),
  };
  const made = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async (project, kind, data) => { written.push({ kind, data }); },
  });
  const { routes } = ticketedRoutes(made, engine, 'acme/web');
  const order = workOrder({ work: { id: 'video-length', lane: 'bug', goal: 'A 65-second clip shows as 1:5 on its card', done: [{ command: 'npm test', expect: 0 }] }, config: { testCommand: 'npm test --' } });
  return {
    routes,
    written,
    start: () => routes['/engine/start']({ project: 'p', order }),
    artefactsOf: engine.artefactsOf,
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
