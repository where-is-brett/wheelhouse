// scripts/setup/clicks.js
// The director's clicks on setup cards, and the lists those cards showed. Before a state branch
// exists there is no state to record a click in, so both are kept under
// <wheelhouseHome()>/setup/, out of agents' reach (Task 13 copies the clicks into the state once
// the state branch exists):
//   clicks/        each click as the prompt record signed it: an `action` event `setup`
//                  { step, hash, question, label }
//   clicks-used/   one empty marker per click the helper has used, named by the click's id
//   shown/         the card each run's step last showed: { runId, folder, step, hash, question,
//                  at }, written by the helper when it works out a step's plan and composes its
//                  card; `question` is the card's whole text
// The prompt record reads `shown/` to turn the twelve characters on a card into the full hash
// the click names, and counts a click only on the card's text exactly as the helper composed it,
// so the words the director read are the helper's for that list. The helper reads `clicks/`
// before it applies a step.
import fs from 'node:fs';
import path from 'node:path';
import { computerId, wheelhouseHome } from '../lib/paths.js';
import { readEnrolled, verify } from '../state/signing.js';
import { CLICK_FRESH_MS } from '../lib/setup-numbers.js';

const HASH = /^[0-9a-f]{64}$/;
const RUN_ID = /^run-[0-9a-f]{10}$/;
const EVENT_ID = /^[A-Za-z0-9-]{1,64}$/;
// A click dated a little after the helper's clock still counts: two clocks on one computer.
const SKEW_MS = 60 * 1000;
const caseBlind = process.platform === 'win32' || process.platform === 'darwin';

export const clicksDir = () => path.join(wheelhouseHome(), 'setup', 'clicks');
const usedDir = () => path.join(wheelhouseHome(), 'setup', 'clicks-used');
const shownDir = () => path.join(wheelhouseHome(), 'setup', 'shown');

const keyOf = (p) => {
  const text = p.normalize('NFC');
  return caseBlind ? text.toLowerCase() : text;
};
function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}
// Whether `dir` is `folder` or inside it, by real paths.
function holds(folder, dir) {
  const a = realPath(folder);
  const b = realPath(dir);
  if (a === null || b === null) return false;
  const base = keyOf(a);
  const target = keyOf(b);
  return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

function writeWhole(file, text, { exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (exclusive) {
    fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
    return;
  }
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text, { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// Keeps one signed setup click, under a name of its time, computer and id, never over another.
export function keepClick(event) {
  if (event?.kind !== 'action' || event.data?.action !== 'setup' || !event.sig) throw new Error('Only a signed setup click is kept here');
  if (typeof event.at !== 'string' || !EVENT_ID.test(String(event.id)) || !/^[0-9a-f]{8}$/.test(String(event.computer))) {
    throw new Error('A setup click needs its time, its id and its computer');
  }
  const file = path.join(clicksDir(), `${event.at.replaceAll(':', '-')}_${event.computer}_setup_${event.id}.json`);
  writeWhole(file, `${JSON.stringify(event, null, 2)}\n`, { exclusive: true });
  return file;
}

// Records the card a run's step showed: the list's full hash and the card's text, for the folder.
export function noteShown({ runId, folder, step, hash, question, now = () => new Date() }) {
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step) || !HASH.test(String(hash)) || typeof folder !== 'string'
    || typeof question !== 'string' || question === '') {
    throw new Error('A shown card needs its run, folder, step, the full hash of its list and its text');
  }
  const record = { runId, folder, step, hash, question, at: now().toISOString() };
  writeWhole(path.join(shownDir(), `${runId}-${step}.json`), `${JSON.stringify(record)}\n`);
}

function readShown(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    return r && RUN_ID.test(String(r.runId)) && Number.isInteger(r.step) && HASH.test(String(r.hash)) && typeof r.folder === 'string'
      && typeof r.question === 'string' ? r : null;
  } catch {
    return null;
  }
}

// The list a run's step last showed, or null.
export function shownFor(runId, step) {
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step)) return null;
  const r = readShown(path.join(shownDir(), `${runId}-${step}.json`));
  return r && r.runId === runId && r.step === step ? r : null;
}

// The full hash of the one list shown for `step` in a folder holding `cwd` whose hash starts with
// `h12`, on a card whose text is `question` exactly; null when there is none, or two different ones.
export function shownHash({ cwd, step, h12, question }) {
  if (typeof cwd !== 'string' || !/^[0-9a-f]{12}$/.test(String(h12)) || typeof question !== 'string') return null;
  let names;
  try {
    names = fs.readdirSync(shownDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  const found = new Set(names.map((n) => readShown(path.join(shownDir(), n)))
    .filter((r) => r !== null && r.step === step && r.hash.startsWith(h12) && r.question === question && holds(r.folder, cwd))
    .map((r) => r.hash));
  return found.size === 1 ? [...found][0] : null;
}

// Every setup click kept on this computer; a file that isn't one is passed over.
function keptClicks() {
  let names;
  try {
    names = fs.readdirSync(clicksDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      const event = JSON.parse(fs.readFileSync(path.join(clicksDir(), name), 'utf8'));
      return event && typeof event === 'object' ? [event] : [];
    } catch {
      return [];
    }
  });
}

const used = (event) => fs.existsSync(path.join(usedDir(), String(event.id)));

// The director's clicks that let this step's list go ahead, newest first: a setup action naming
// this step and this full hash, made on this computer, signed by its enrolled key, from the last
// CLICK_FRESH_MS, and not yet used.
export function freshClicks({ step, hash, now = () => new Date() }) {
  const enrolled = readEnrolled();
  const me = computerId();
  const at = now().getTime();
  return keptClicks().filter((e) => {
    const age = at - Date.parse(e.at);
    return e.kind === 'action' && e.data?.action === 'setup' && e.data.step === step && e.data.hash === hash
      && e.computer === me && e.sig?.computer === me && EVENT_ID.test(String(e.id))
      && age <= CLICK_FRESH_MS && age >= -SKEW_MS && !used(e) && verify(e, enrolled);
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// Uses a click, once: a marker named by its id, made exclusively. True when this call used it.
export function useClick(event, now = () => new Date()) {
  if (!EVENT_ID.test(String(event?.id))) return false;
  try {
    writeWhole(path.join(usedDir(), event.id), `${now().toISOString()}\n`, { exclusive: true });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}
