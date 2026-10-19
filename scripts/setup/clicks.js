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
//
// What the prompt record needs of this, keeping a click and finding the card it was on, is in
// scripts/lib/setup-clicks.js, so the mod's bridge, which imports the prompt record, reaches
// nothing under scripts/setup/.
import fs from 'node:fs';
import path from 'node:path';
import { computerId } from '../lib/paths.js';
import { readEnrolled, verify } from '../state/signing.js';
import { CLICK_FRESH_MS } from '../lib/setup-numbers.js';
import {
  HASH, RUN_ID, EVENT_ID, clicksDir, usedDir, shownDir, writeWhole, shownCard, readShown,
} from '../lib/setup-clicks.js';

export { clicksDir, keepClick, shownHash } from '../lib/setup-clicks.js';

// A click dated a little after the helper's clock still counts: two clocks on one computer.
const SKEW_MS = 60 * 1000;

// Records the card a run's step showed: the list's full hash and the card, for the folder.
export function noteShown({ runId, folder, step, hash, card, now = () => new Date() }) {
  const shown = shownCard(card);
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step) || !HASH.test(String(hash)) || typeof folder !== 'string' || shown === null) {
    throw new Error('A shown card needs its run, folder, step, the full hash of its list and the card');
  }
  const record = { runId, folder, step, hash, card: shown, at: now().toISOString() };
  writeWhole(path.join(shownDir(), `${runId}-${step}.json`), `${JSON.stringify(record)}\n`);
}

// The list a run's step last showed, or null.
export function shownFor(runId, step) {
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step)) return null;
  const r = readShown(path.join(shownDir(), `${runId}-${step}.json`));
  return r && r.runId === runId && r.step === step ? r : null;
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
