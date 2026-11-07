// scripts/checks/data-run.js
// A data run (scripts/host/helper.js, /data/check) runs the project's read-only data command in a check folder of its own, so
// it takes the same care as a check:
// - it holds the computer-wide check turn, so it never runs beside another check;
// - its folder (the slot of `work`) is named here while it runs, so the runner's sweep of ended work's folders (folder.js,
//   sweepHeads) keeps it;
// - it carries an AbortSignal that All stop ends, as it ends a check.
import { withCheckTurn } from './queue.js';

// The works whose folders are in use, by project, and the controllers All stop ends.
const inUse = new Map();
const controllers = new Set();

// The works of `project` with a data run under way or waiting for its turn: the sweep leaves their folders be.
export function dataWorksInUse(project) {
  return [...(inUse.get(project)?.keys() ?? [])];
}

// Runs `fn({ signal })` for `work` of `project` once it has the turn. `signal` is aborted by All stop (`stopDataRuns`) and when
// `stopped()` says so; `fn` is not started when that is already so. Gives what `fn` gives, or null when it never started.
export async function withDataRun({ project, work, stopped = () => false, turn = withCheckTurn }, fn) {
  const controller = new AbortController();
  controllers.add({ project, controller });
  const mine = inUse.get(project) ?? new Map();
  mine.set(work, (mine.get(work) ?? 0) + 1);
  inUse.set(project, mine);
  const entry = [...controllers].find((c) => c.controller === controller);
  try {
    return await turn(async () => {
      if (controller.signal.aborted || stopped()) return null;
      return fn({ signal: controller.signal });
    });
  } finally {
    controllers.delete(entry);
    const left = (mine.get(work) ?? 1) - 1;
    if (left <= 0) mine.delete(work);
    else mine.set(work, left);
    if (mine.size === 0) inUse.delete(project);
  }
}

// All stop: ends every data run, of `project` or of all projects.
export function stopDataRuns(project) {
  for (const c of controllers) if (project === undefined || c.project === project) c.controller.abort();
}
