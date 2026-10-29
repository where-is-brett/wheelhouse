// scripts/engine/routes.js
// The helper's routes for the build engine's runs (Archon design, sections 7.4, 7.5, 9, 11 and 12.4). Each route is
// `(body) => answer`; the helper serves them under /engine/ and /broker/. They know the engine only through the
// engine interface (contract.js) and the project only through what the helper gives them:
//   projects()            [{ project, folder }]: the registered projects
//   engineFor(project)    the project's engine, or null when it isn't on the new engine
//   ordersDir(project)    the folder of the project's work orders, the helper's own
//   write(project, kind, data)   writes a record in the project's history
//   held()                true while All stop is on: nothing starts
//   now()                 a Date
// A run is found by its id in the projects' order stores: the only runs these routes serve are ones the helper
// started itself, with an order.
import path from 'node:path';
import { checkOrder, orderStore, isRunId } from './order.js';

const NO_ORDER = 'there is no work order for that run';

export function engineRoutes({ projects, engineFor, ordersDir, write, held = () => false, now = () => new Date() } = {}) {
  const storeOf = (project) => orderStore(ordersDir(project));

  // The project and order of a run the helper started, or null.
  function runOf(runId) {
    if (!isRunId(runId)) return null;
    for (const { project, folder } of projects()) {
      const order = storeOf(project).load(runId);
      if (order) return { project, folder, order };
    }
    return null;
  }

  // Starts a run of `order` for `project` and keeps its order under the run's id; writes the run's start in the
  // project's record, which is how the continuation host knows the run is the project's.
  async function start({ project, order, branch, carryOn } = {}) {
    if (held()) return { ok: false, refused: 'All stop is on, so no run starts' };
    const found = projects().find((p) => p.project === project);
    if (!found) return { ok: false, refused: 'that project isn\'t registered on this computer' };
    const engine = engineFor(project);
    if (!engine) return { ok: false, refused: 'that project doesn\'t use the build engine' };
    const problem = checkOrder(order);
    if (problem) return { ok: false, refused: problem };
    const started = await engine.start({ work: order.work, lane: order.lane, branch, carryOn: carryOn === true, project: found.folder, bindings: order.bindings });
    if (!started?.ok) return { ok: false, refused: started?.refused ?? 'the engine didn\'t start the run' };
    storeOf(project).save(started.runId, order);
    const runBranch = started.branch ?? branch;
    await write(project, 'run', { work: order.work, lane: order.lane, engine: engine.name ?? 'engine', runId: started.runId, state: 'started', ...(runBranch ? { branch: runBranch } : {}) });
    return { ok: true, runId: started.runId };
  }

  return {
    runOf,
    routes: {
      '/engine/start': start,
      // The order the helper keeps for the run, and nothing for any other id.
      '/engine/order': async ({ runId } = {}) => {
        const run = runOf(runId);
        return run ? { ok: true, order: run.order } : { ok: false, refused: NO_ORDER };
      },
    },
  };
}

// Where a project's engine files are kept beside its record: `<state>/../engine/`.
export const engineDirOf = (stateFolder) => path.join(stateFolder, '..', 'engine');
