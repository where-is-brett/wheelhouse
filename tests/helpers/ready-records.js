// tests/helpers/ready-records.js
// The records a level's readiness run leaves in an evaluations folder, made with stand-ins: a trial's file as
// runScenario writes it, and a run record naming each trial with the hash of its file, as run.js keeps them.
import fs from 'node:fs';
import path from 'node:path';
import { BAR, fileHash, levelRouting } from '../../scripts/eval/ready.js';

export const PINS = Object.freeze({ mostCapable: 'model-top', midSized: 'model-mid' });
const DATE = '2026-10-25';

// A passing trial's record at `level` on `pins`, its session started on the column's feature model.
export function trialRecord({ id, leg, trial, level, pins = PINS, pass = true }) {
  const feature = levelRouting({ level, pins }).roles.feature;
  return {
    id, ...(leg ? { leg } : {}), title: `Scenario ${id}`, variant: 'with', trial, date: DATE, level, pins: { ...pins },
    pass, why: pass ? 'stand-in pass' : 'stand-in fail', handled: true, exitCode: 0, usage: { input: 1, output: 1 }, mainSessionUsage: { input: 1, output: 1 },
    model: feature.model, effort: feature.effort, fallback: feature.fallback, models: [feature.model], subagents: [], finalText: 'Done.',
    events: [
      { type: 'system', subtype: 'init', model: feature.model },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Done.', modelUsage: { [feature.model]: {} } },
    ],
  };
}

// One run of the bar (or of `only` its scenarios) at `level`, `trials` trials each from trial `from`, its run record
// stamped `at` and made on the plugin's commit `commit` (null for a run record that names none). `fail`, `skip` and `unhandled` say, by scenario and trial, which trials failed, were never run, or
// were not handled; `record` may change a trial's record as written (a forgery the run record doesn't know of).
export function barRun(evals, {
  level, pins = PINS, at = '2026-10-25T08:00:00.000Z', only = BAR, from = 1, trials = 3, commit = 'abc123def456',
  fail = () => false, skip = () => false, unhandled = () => false, record = (r) => r,
}) {
  const runs = [];
  for (const scenario of only) {
    for (let trial = from; trial < from + trials; trial += 1) {
      if (skip(scenario, trial)) continue;
      const failed = fail(scenario, trial);
      const notHandled = unhandled(scenario, trial);
      const pass = !failed && !notHandled;
      const id = Number(scenario.split('-')[0]);
      const written = record({ ...trialRecord({ id, trial, level, pins, pass }), ...(notHandled ? { handled: false, why: 'did not finish' } : {}) }, scenario, trial);
      const file = path.join(evals, DATE, `${scenario}-with-${trial}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const text = `${JSON.stringify(written, null, 2)}\n`;
      fs.writeFileSync(file, text);
      runs.push({
        id, suite: 'build-loop', title: `Scenario ${id}`, safety: false, variant: 'with', trial, round: 'first', level, pins: { ...pins },
        pass, handled: !notHandled, why: failed ? 'stand-in fail' : notHandled ? 'did not finish' : 'stand-in pass', usage: { input: 1, output: 1 }, file, sha256: fileHash(text),
      });
    }
  }
  const runFile = path.join(evals, 'runs', `${at.replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(runFile), { recursive: true });
  fs.writeFileSync(runFile, `${JSON.stringify({ v: 1, at, date: DATE, how: 'ids', ...(commit === null ? {} : { commit }), level, pins: { ...pins }, runs }, null, 2)}\n`);
  return runFile;
}
