// scripts/update/job.js
// Runs the update's steps in order from the journal. Done steps are skipped, so a job stopped
// part-way carries on at the first step not done and never does a done step twice.

// steps: [{ name, run({ project, target, journal, data }) }]. A step finishes by returning
// nothing, `{ data }` to record something for later steps, or `{ ok: false, line }` to stop.
// A step that throws stops the job with the error's message as its line.
export async function runJob({ project, target, steps, journal }) {
  const release = journal.lock();
  if (!release) {
    return { ok: false, step: null, line: 'An update is already under way on this computer.' };
  }
  try {
    const start = journal.read();
    if (start.newer) {
      return { ok: false, step: null, line: 'This update was started by a newer Wheelhouse. Carry on with the newer Wheelhouse.' };
    }
    const data = {};
    for (const [name, entry] of Object.entries(start.steps)) if (entry.data !== undefined) data[name] = entry.data;
    for (const step of steps) {
      if (journal.read().steps[step.name]?.state === 'done') continue;
      journal.mark(step.name, 'running');
      let result;
      try {
        result = await step.run({ project, target, journal, data });
      } catch (error) {
        const line = error?.message || String(error);
        journal.mark(step.name, 'failed', { line });
        return { ok: false, step: step.name, line };
      }
      if (result && result.ok === false) {
        journal.mark(step.name, 'failed', { line: result.line });
        return { ok: false, step: step.name, line: result.line };
      }
      if (result && result.data !== undefined) data[step.name] = result.data;
      journal.mark(step.name, 'done', result?.data);
    }
    return { ok: true, step: null, line: '' };
  } finally {
    release();
  }
}
