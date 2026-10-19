// scripts/setup/clicks.js
// The director's clicks on setup cards, and the lists those cards showed. Before a state branch
// exists there is no state to record a click in, so both are kept under
// <wheelhouseHome()>/setup/, out of agents' reach (Task 13 copies the clicks into the state once
// the state branch exists):
//   clicks/        each click as the prompt record signed it: an `action` event `setup`
//                  { runId, step, hash, question, label }, naming the run the card was shown for
//   clicks-used/   one empty marker per click the helper has used, named by the click's id
//   shown/         the card each run's step last showed: { runId, folder, step, hash, card, at },
//                  written by the helper when it works out a step's plan and composes its card;
//                  `card` is what the director reads: { question, header, options: [{ label,
//                  description }] }
// The prompt record reads `shown/` to turn the twelve characters on a card into the full hash
// the click names, with the run the card was shown for, and counts a click only on the card
// exactly as the helper composed it (its text, header and each option's label and description),
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

// What a card shows the director, in one form: its text, header, and each option's label and
// description; null when it isn't a card.
function shownCard(card) {
  if (!card || typeof card !== 'object' || typeof card.question !== 'string' || card.question === '' || !Array.isArray(card.options)) return null;
  const text = (x) => (typeof x === 'string' ? x : null);
  if (card.options.some((o) => typeof o?.label !== 'string')) return null;
  return { question: card.question, header: text(card.header), options: card.options.map((o) => ({ label: o.label, description: text(o.description) })) };
}

// Records the card a run's step showed: the list's full hash and the card, for the folder.
export function noteShown({ runId, folder, step, hash, card, now = () => new Date() }) {
  const shown = shownCard(card);
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step) || !HASH.test(String(hash)) || typeof folder !== 'string' || shown === null) {
    throw new Error('A shown card needs its run, folder, step, the full hash of its list and the card');
  }
  const record = { runId, folder, step, hash, card: shown, at: now().toISOString() };
  writeWhole(path.join(shownDir(), `${runId}-${step}.json`), `${JSON.stringify(record)}\n`);
}

function readShown(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    return r && RUN_ID.test(String(r.runId)) && Number.isInteger(r.step) && HASH.test(String(r.hash)) && typeof r.folder === 'string'
      && shownCard(r.card) !== null ? r : null;
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

// The card shown for `step` in a folder holding `cwd` whose list's hash starts with `h12`, on a
// card the director saw exactly as shown (`card`, the question AskUserQuestion was given):
// { runId, hash }, the run it was shown for and the list's full hash. Null when there is none, or
// two different lists. When several runs showed that very card (every list that changes nothing
// has one hash), the run of the nearest folder holding `cwd` is taken, as the helper places a
// folder, and of those the card shown last.
export function shownHash({ cwd, step, h12, card }) {
  const asked = shownCard(card);
  if (typeof cwd !== 'string' || !/^[0-9a-f]{12}$/.test(String(h12)) || asked === null) return null;
  const same = JSON.stringify(asked);
  let names;
  try {
    names = fs.readdirSync(shownDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  const found = names.map((n) => readShown(path.join(shownDir(), n)))
    .filter((r) => r !== null && r.step === step && r.hash.startsWith(h12) && JSON.stringify(shownCard(r.card)) === same && holds(r.folder, cwd));
  if (new Set(found.map((r) => r.hash)).size !== 1) return null;
  const depth = (r) => keyOf(realPath(r.folder) ?? '').length;
  const nearest = Math.max(...found.map(depth));
  const chosen = found.filter((r) => depth(r) === nearest).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
  return { runId: chosen.runId, hash: chosen.hash };
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
// this run, this step and this full hash, made on this computer, signed by its enrolled key, from
// the last CLICK_FRESH_MS, and not yet used. A click on another folder's card, though its list has
// the same hash, names another run and is not one of them.
export function freshClicks({ runId, step, hash, now = () => new Date() }) {
  const enrolled = readEnrolled();
  const me = computerId();
  const at = now().getTime();
  return keptClicks().filter((e) => {
    const age = at - Date.parse(e.at);
    return e.kind === 'action' && e.data?.action === 'setup' && RUN_ID.test(String(runId)) && e.data.runId === runId
      && e.data.step === step && e.data.hash === hash
      && e.computer === me && e.sig?.computer === me && EVENT_ID.test(String(e.id))
      && age <= CLICK_FRESH_MS && age >= -SKEW_MS && !used(e) && verify(e, enrolled);
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// Gives a used click back, when the step it was used for could not be started.
export function releaseClick(event) {
  if (!EVENT_ID.test(String(event?.id))) return;
  try {
    fs.rmSync(path.join(usedDir(), event.id), { force: true });
  } catch { /* it stays used, and the director clicks again */ }
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
