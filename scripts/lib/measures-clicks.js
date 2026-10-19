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
// The pending figures and the shown record count as gone BASELINE_WAIT_MS after they were written.
// It also says what reads as the baseline card (baselineWording, looksLikeBaseline) and what holds
// the figures waiting (holdsFigures), for the card check, the prompt record, the composer and the
// state's own refusal, so none of them depends on one sentence of the card being copied exactly.
// It lives apart from scripts/measures/ so the prompt record, which the mod's bridge imports,
// reaches only what it needs (scripts/mod/validate.js, bridgeImports).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';
import { canonicalJson } from './canonical.js';
import { HASH, EVENT_ID, writeWhole, shownCard } from './setup-clicks.js';
import { BASELINE_WAIT_MS } from './setup-numbers.js';
import { BASELINE_WORDS, BASELINE_HEADER } from '../state/card-lines.js';

// The baseline card's fixed words (scripts/measures/baseline.js composes it from these), each of
// which marks a card as the baseline card wherever it appears.
export const BASELINE_PHRASES = Object.freeze({
  what: 'The first version\'s figures from your private note',
  counted: 'How the note counted:',
  record: 'Keep these figures on this computer as the baseline',
  notNow: 'Record nothing and forget these figures',
});
// An account of how the note counted shorter than this is too common to mark a card by.
const COUNTED_MARK_CHARS = 12;

export const measuresDir = () => path.join(wheelhouseHome(), 'measures');
export const pendingFile = () => path.join(measuresDir(), 'pending.json');
export const shownFile = () => path.join(measuresDir(), 'shown', 'baseline.json');
export const clicksDir = () => path.join(measuresDir(), 'clicks');
export const usedDir = () => path.join(measuresDir(), 'clicks-used');

// Text folded for comparing: compatibility forms, typographic quotes and apostrophes as plain
// ones, invisible characters dropped, white space collapsed, lower case.
export function plainText(text) {
  return String(text ?? '').normalize('NFKC')
    .replace(/[\u00AD\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u02BC\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const MARKS = [BASELINE_WORDS, ...Object.values(BASELINE_PHRASES)].map(plainText);

// Whether text holds any of the baseline card's fixed words (its set line's or its other fixed
// phrases), however their quotes, spaces or case are written. Its header alone is not one.
export function baselineWording(text) {
  const plain = plainText(text);
  return MARKS.some((mark) => plain.includes(mark));
}

// Whether a header is the baseline card's, however its case or spaces are written.
const baselineHeader = (header) => typeof header === 'string' && plainText(header) === plainText(BASELINE_HEADER);

// The money forms a figure counts in: its cents form always (1200.00, 30.00, 4127.35); its whole
// form (1200) only from 1000 up, since a smaller whole sum is too common to mark anything by.
// Each counts after a currency marker ($, US$, USD), and a figure that isn't whole counts in its
// cents form with no marker too. None matches inside a longer number: $30 is not in $30.50 or
// $300, nor $1,200 in $1,200.99.
function moneyIn(plain, n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return false;
  const cents = n.toFixed(2);
  const forms = [cents, ...(Number.isInteger(n) && n >= 1000 ? [String(n)] : [])];
  const tail = '(?![0-9]|\\.[0-9])';
  const marked = forms.some((form) => new RegExp(`(?:\\$|usd)\\s?${form.replace('.', '\\.')}${tail}`).test(plain));
  const bare = !Number.isInteger(n) && new RegExp(`(?<![0-9.])${cents.replace('.', '\\.')}${tail}`).test(plain);
  return marked || bare;
}

// Whether text holds the private note's figures waiting for the director's click, while they are
// in date at `now` (BASELINE_WAIT_MS): the account of how the note counted, when it is long enough
// to mark anything by, or the cost or the cost per merge written as money (moneyIn). Content
// matching is a net for a careless relay while a card is in flight, not a lasting ban: once the
// figures are recorded, cleared or out of date, nothing matches.
export function holdsFigures(text, { now = () => new Date() } = {}) {
  const pending = readPending({ now });
  if (pending === null) return false;
  const plain = plainText(text).replace(/,/g, '');
  const counted = plainText(pending.figures.counted).replace(/,/g, '');
  if (counted.length >= COUNTED_MARK_CHARS && plain.includes(counted)) return true;
  const { usd, merges } = pending.figures;
  if (!Number.isInteger(merges) || merges < 1) return false;
  return moneyIn(plain, usd) || moneyIn(plain, usd / merges);
}

// Whether a card or a record reads as the baseline card: by its fixed words; or by the baseline
// header together with the figures waiting, or with the recorded baseline's account of how the
// note counted. The header alone, or the recorded account alone, is not enough.
export function looksLikeBaseline(text, header, { now = () => new Date() } = {}) {
  if (baselineWording(text)) return true;
  if (!baselineHeader(header)) return false;
  if (holdsFigures(text, { now })) return true;
  const recorded = plainText(recordedCounted()).replace(/,/g, '');
  return recorded.length >= COUNTED_MARK_CHARS && plainText(text).replace(/,/g, '').includes(recorded);
}

// Whether a card or a record carries the private note's figures in any way the net catches: it
// reads as the baseline card, or it holds the figures waiting for the click.
export function carriesFigures(text, header, { now = () => new Date() } = {}) {
  return looksLikeBaseline(text, header, { now }) || holdsFigures(text, { now });
}

// The account of how the note counted of the baseline recorded, or null.
function recordedCounted() {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(measuresDir(), 'baseline.json'), 'utf8'));
    return typeof b?.counted === 'string' ? b.counted : null;
  } catch {
    return null;
  }
}

// Whether a record written at `at` is still kept at `now`.
const kept = (at, now) => {
  const age = now().getTime() - Date.parse(at);
  return Number.isFinite(age) && age <= BASELINE_WAIT_MS;
};

// The SHA-256 of what a card shows the director (its text, header, and each option's label and
// description), or null when it isn't a card.
export function cardHash(card) {
  const shown = shownCard(card);
  return shown === null ? null : crypto.createHash('sha256').update(canonicalJson(shown)).digest('hex');
}

// The shown record, or null when there is none, it isn't one, or it is older than BASELINE_WAIT_MS
// (any age, with `any`).
export function readShown({ now = () => new Date(), any = false } = {}) {
  try {
    const r = JSON.parse(fs.readFileSync(shownFile(), 'utf8'));
    return r && HASH.test(String(r.hash)) && HASH.test(String(r.card)) && typeof r.at === 'string' && (any || kept(r.at, now)) ? r : null;
  } catch {
    return null;
  }
}

// The full hash of the figures the baseline card read back, when `card` (the question
// AskUserQuestion was given) is the card the helper composed, word for word, and its set line's
// twelve characters `h12` start that hash; otherwise null.
export function shownBaseline({ h12, card, now = () => new Date() }) {
  const shown = readShown({ now });
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

// The figures waiting for the click, or null: { figures, nonce, hash, at }. Null too when they are
// older than BASELINE_WAIT_MS (any age, with `any`).
export function readPending({ now = () => new Date(), any = false } = {}) {
  try {
    const r = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'));
    return r && HASH.test(String(r.hash)) && r.figures && typeof r.figures === 'object' && typeof r.at === 'string'
      && (any || kept(r.at, now)) ? r : null;
  } catch {
    return null;
  }
}

// Clears the figures waiting and the card that showed them, when they are the ones named by
// `hash` (or whatever is waiting, with no hash). Used on Not now, and once the baseline is written.
export function dropPending(hash) {
  const pending = readPending({ any: true });
  if (hash !== undefined && pending !== null && pending.hash !== hash) return false;
  fs.rmSync(pendingFile(), { force: true });
  const shown = readShown({ any: true });
  if (hash === undefined || shown === null || shown.hash === hash) fs.rmSync(shownFile(), { force: true });
  return true;
}

// Removes the figures waiting and the shown record once they are older than BASELINE_WAIT_MS, or
// can't be read as one.
export function sweepStale(now = () => new Date()) {
  if (readPending({ now }) === null) fs.rmSync(pendingFile(), { force: true });
  if (readShown({ now }) === null) fs.rmSync(shownFile(), { force: true });
}
