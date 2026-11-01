// scripts/delegation/reader.js
// The reader (delegated decisions design, section 9, guardrail 4): when a run of it may start, where it runs, and what
// counts as its reply. It runs in a folder of its own that holds nothing but its view: an Archon folder project, so no
// git and no worktree, whose step has only Read, Grep and Glob, and in the engine's ordinary mode those ask before they
// read outside the folder, and no one answers in a run (check 87). A reply that isn't whole and in shape is no reading.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { engineDir } from '../lib/paths.js';
import { READER_WORK } from '../state/events.js';
import { READING_MOST_BYTES } from './limits.js';

// The work and the lane a reader's runs and tokens go under: on no piece.
export { READER_WORK };
export const READER_LANE = 'reader';
const READ_STEP = 'read';

const FRAMES = ['sound', 'doubtful'];
const KINDS = ['not-real', 'project-can-answer', 'cant-judge', 'can-see', 'only-director', 'never-delegated'];
const FITS = ['yes', 'no', 'no-rule'];
const LEANS = ['sooner', 'later', 'more-testing', 'less-testing', 'faster', 'safer', 'paid', 'free', 'more-scope', 'less-scope', 'keep', 'remove'];

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';

// A reader may start only with none under way, under `pace` + 2 runs going, and never on a plan's counted requests.
export const mayRead = ({ running, pace, live, counted }) => counted !== true && live === 0 && running < pace + 2;

// The reader's folder for a project. Archon names a folder project's records after the folder, so its name is plain.
export function readerFolderOf(project, engine = engineDir()) {
  return path.join(engine, 'readers', crypto.createHash('sha256').update(String(project)).digest('hex').slice(0, 16));
}

// The folder, made empty: a reader starts with nothing a run before it left.
export function prepareReaderFolder({ project, engine = engineDir() } = {}) {
  const folder = readerFolderOf(project, engine);
  try {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    return { ok: true, folder };
  } catch (error) {
    return { ok: false, refused: error instanceof Error ? error.message : 'the reader\'s folder could not be made' };
  }
}

// The reader's reply, from the engine's own record of its read step, or null for anything missing, oversized,
// unparseable or out of shape. `labels` are the view's: a pick or a tag has to be one of them.
export function readerResult(outputs, labels) {
  const text = outputs?.[READ_STEP];
  if (typeof text !== 'string' || text === '' || Buffer.byteLength(text) > READING_MOST_BYTES) return null;
  let said;
  try { said = JSON.parse(text); } catch { return null; }
  if (!isPlain(said) || !FRAMES.includes(said.frame) || !isText(said.why) || !KINDS.includes(said.kind) || !FITS.includes(said.fits)) return null;
  if (!labels.includes(said.pick) || !Array.isArray(said.tags)) return null;
  const fair = (t) => isPlain(t) && labels.includes(t.label) && Array.isArray(t.leans) && t.leans.every((l) => LEANS.includes(l));
  if (!said.tags.every(fair)) return null;
  const { frame, why, kind, fits, pick, tags } = said;
  return { frame, why, kind, fits, pick, tags: tags.map(({ label, leans }) => ({ label, leans })) };
}
