// scripts/lib/measures-clicks.js
// The prompt record's side of the baseline card's click (scripts/measures/baseline.js says how the
// baseline is recorded). Everything lives under <wheelhouseHome()>/measures/, never setup/, whose
// clicks are later copied into the state:
//   pending.json   the private note's figures the helper is reading back, until the click
//   shown/         baseline.json, the card the helper composed: { hash, card, at }, where `hash` is
//                  the hash of the figures (with a random nonce, so it can't be worked back to them)
//                  and `card` the SHA-256 of the card exactly as composed, so no figure is in it
//   clicks/        the director's Record these, as the prompt record signed it: an `action` event
//                  `baseline` { hash, question, label }, whose question is the set line alone
//   clicks-used/   one empty marker per click the helper has used, named by the click's id
// It lives apart from scripts/measures/ so the prompt record, which the mod's bridge imports,
// reaches only what it needs (scripts/mod/validate.js, bridgeImports).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';
import { canonicalJson } from './canonical.js';
import { HASH, EVENT_ID, writeWhole, shownCard } from './setup-clicks.js';

export const measuresDir = () => path.join(wheelhouseHome(), 'measures');
export const pendingFile = () => path.join(measuresDir(), 'pending.json');
export const shownFile = () => path.join(measuresDir(), 'shown', 'baseline.json');
export const clicksDir = () => path.join(measuresDir(), 'clicks');
export const usedDir = () => path.join(measuresDir(), 'clicks-used');

// The SHA-256 of what a card shows the director (its text, header, and each option's label and
// description), or null when it isn't a card.
export function cardHash(card) {
  const shown = shownCard(card);
  return shown === null ? null : crypto.createHash('sha256').update(canonicalJson(shown)).digest('hex');
}

// The shown record, or null when there is none or it isn't one.
export function readShown() {
  try {
    const r = JSON.parse(fs.readFileSync(shownFile(), 'utf8'));
    return r && HASH.test(String(r.hash)) && HASH.test(String(r.card)) && typeof r.at === 'string' ? r : null;
  } catch {
    return null;
  }
}

// The full hash of the figures the baseline card read back, when `card` (the question
// AskUserQuestion was given) is the card the helper composed, word for word, and its set line's
// twelve characters `h12` start that hash; otherwise null.
export function shownBaseline({ h12, card }) {
  const shown = readShown();
  const asked = cardHash(card);
  if (shown === null || asked === null || !/^[0-9a-f]{12}$/.test(String(h12))) return null;
  return shown.hash.startsWith(h12) && shown.card === asked ? shown.hash : null;
}

// Keeps one signed baseline click, under a name of its time, computer and id, never over another.
export function keepClick(event) {
  if (event?.kind !== 'action' || event.data?.action !== 'baseline' || !event.sig) throw new Error('Only a signed baseline click is kept here');
  if (typeof event.at !== 'string' || !EVENT_ID.test(String(event.id)) || !/^[0-9a-f]{8}$/.test(String(event.computer))) {
    throw new Error('A baseline click needs its time, its id and its computer');
  }
  const file = path.join(clicksDir(), `${event.at.replaceAll(':', '-')}_${event.computer}_baseline_${event.id}.json`);
  writeWhole(file, `${JSON.stringify(event, null, 2)}\n`, { exclusive: true });
  return file;
}

// The figures waiting for the click, or null: { figures, nonce, hash, at }.
export function readPending() {
  try {
    const r = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'));
    return r && HASH.test(String(r.hash)) && r.figures && typeof r.figures === 'object' ? r : null;
  } catch {
    return null;
  }
}

// Clears the figures waiting and the card that showed them, when they are the ones named by
// `hash` (or whatever is waiting, with no hash). Used on Not now, and once the baseline is written.
export function dropPending(hash) {
  const pending = readPending();
  if (hash !== undefined && pending !== null && pending.hash !== hash) return false;
  fs.rmSync(pendingFile(), { force: true });
  const shown = readShown();
  if (hash === undefined || shown === null || shown.hash === hash) fs.rmSync(shownFile(), { force: true });
  return true;
}
