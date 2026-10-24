// scripts/lib/front-desk-model.js
// The model the front desk's session runs on, and the line that says when it isn't the one setup
// pinned (design section 8). The front desk is meant to run on the model the evaluation passed on:
// on a smaller one it follows the director's rulings less closely (docs/evals/front-desk.md,
// scenarios 1 and 16), and the strongest costs more. Setup pins it in the project's routing table
// and starts the front desk's sessions on it, but the director can still pick another in Claude's
// model menu, and that choice stands. So the session start keeps, for this computer, the model the
// front desk's session started on, and the board and the briefing show one plain line while it
// differs from the pin. It blocks nothing.
import fs from 'node:fs';
import path from 'node:path';
import { projectsDir } from './paths.js';
import { isModelName, readConfig } from '../gate/guardrails.js';

const fileOf = (project) => path.join(projectsDir(), project, 'front-desk-model.json');

// The model a SessionStart hook's input names: Claude Code gives it as a name, or as an object
// with its id. Null when it gives none that could be a model's name.
export function modelOfInput(input) {
  const given = input?.model;
  const name = typeof given === 'string' ? given : given?.id;
  return isModelName(name) ? name : null;
}

// Keeps `model` as the one the front desk's session runs on in `project`, on this computer.
export function keepRunningModel(project, model, { now = () => new Date() } = {}) {
  const file = fileOf(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ model, at: now().toISOString() })}\n`);
  fs.renameSync(temp, file);
}

// What keepRunningModel kept for `project`, { model, at }, or null.
export function runningModel(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(fileOf(project), 'utf8'));
    return isModelName(kept?.model) ? { model: kept.model, at: typeof kept.at === 'string' ? kept.at : null } : null;
  } catch {
    return null;
  }
}

// The model the front desk last ran on in `project` and the one the configuration in its main
// folder (`folder`) pins, each null when it isn't known.
export function readFrontDeskModel({ project, folder }) {
  let pinned = null;
  try {
    const config = readConfig(fs.readFileSync(path.join(folder, '.claude', 'wheelhouse.json'), 'utf8'));
    if (isModelName(config.routing?.frontDesk)) pinned = config.routing.frontDesk;
  } catch { /* no pin known */ }
  return { running: runningModel(project)?.model ?? null, pinned };
}

// How the line for a front desk on another model starts: the briefing gives it once a week.
export const FRONT_DESK_MODEL_LEAD = 'The front desk is running on ';

// The line for a front desk running on another model than the pin, or null.
export function frontDeskModelLine({ running, pinned } = {}) {
  if (!running || !pinned || running === pinned) return null;
  return `${FRONT_DESK_MODEL_LEAD}${running}, not ${pinned}, the model it was set up on: pick ${pinned} again in Claude's model menu, unless you meant to change it`;
}
