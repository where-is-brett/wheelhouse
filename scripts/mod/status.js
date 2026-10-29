// scripts/mod/status.js
// The pane's model, and its keeping as projects/<project>/status.json so what the pane shows can
// be read without the mod. The model is built on the desk's side (scripts/desk/mod-pane.js), which
// the bridge reads through the desk's glance view; it is given here too, for what reads it as it
// was. The file is written whole through a temporary file, so a reader never sees half of it. The
// file functions are named apart from the feature files' readStatus and writeStatus.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';
import { PANE_VERSION } from '../desk/mod-pane.js';

export { paneModel, cardTextOf, hashOf, QUESTION_WAITS, CARD_TO_MAKE } from '../desk/mod-pane.js';

const VERSION = PANE_VERSION;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// projects/<project>/status.json; stateDir refuses a name that is not a folder name.
export function paneStatusFile(project) {
  return path.join(stateDir(project), '..', 'status.json');
}

// Keeps the model as the project's status.json. Throws when it can't be kept.
export function writePaneStatus(project, model) {
  if (!isRecord(model) || model.v !== VERSION) throw new Error('The pane\'s model must be a version 1 model');
  const file = paneStatusFile(project);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(model)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// The model as last kept, or null when there is none, it is damaged or it is of another version.
export function readPaneStatus(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(paneStatusFile(project), 'utf8'));
    return isRecord(kept) && kept.v === VERSION ? kept : null;
  } catch {
    return null;
  }
}
