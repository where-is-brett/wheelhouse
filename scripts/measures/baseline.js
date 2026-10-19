// scripts/measures/baseline.js
// The baseline the weekly measures compare Wheelhouse's cost per merged pull request with: the
// first version's, from the director's private note (its own records are gone). The front desk
// passes on the figures the director gives (`cli.js baseline`); the helper's /measures/baseline
// route reads them back on a card, and writes <wheelhouseHome()>/measures/baseline.json only after
// the director's signed click on that card:
//
//   /measures/baseline { usd, merges, from, to, counted } -> { ok, hash, card }
//       checks the figures (refusing them before any card), keeps them in measures/pending.json,
//       composes the card that reads them back (Record these, Not now) and records it as shown
//   /measures/baseline { confirm: hash }                  -> { ok, recorded: true }
//       writes baseline.json from the figures waiting under that hash, only on a fresh, unused
//       click on Record these, signed by this computer's enrolled key, for that hash; then clears
//       the figures waiting and the shown card
//
// Not now is the prompt record's to act on: a click on it, on the card as composed, clears the
// figures waiting and writes nothing. The figures live only in <wheelhouseHome()>/measures/ and in
// the card the director reads: never in a state event, the repository or a log, and no answer
// but the card repeats them. scripts/lib/measures-clicks.js says how the click is kept.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { computerId } from '../lib/paths.js';
import { canonicalJson } from '../lib/canonical.js';
import { CLICK_FRESH_MS } from '../lib/setup-numbers.js';
import { readEnrolled, verify } from '../state/signing.js';
import { composeCard } from '../cards/compose.js';
import { BASELINE_LABEL } from '../state/card-lines.js';
import { EVENT_ID, writeWhole } from '../lib/setup-clicks.js';
import {
  measuresDir, pendingFile, shownFile, clicksDir, usedDir, cardHash, readPending, dropPending,
} from '../lib/measures-clicks.js';

export const NEEDS_CLICK = `recording the baseline needs the director's click on Record these, on its card, from the last ${CLICK_FRESH_MS / 60000} minutes`;
export const NOT_WAITING = 'those are not the figures waiting: give the figures again and show the new card';
const FIGURE_FIELDS = ['usd', 'merges', 'from', 'to', 'counted'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FULL_HASH = /^[0-9a-f]{64}$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// A click dated a little after the helper's clock still counts: two clocks on one computer.
const SKEW_MS = 60 * 1000;

export class BaselineRefusal extends Error {}
const refuse = (message) => { throw new BaselineRefusal(message); };

export const baselineFile = () => path.join(measuresDir(), 'baseline.json');

// Whether `text` is a real calendar date written as 2026-09-01.
function isDate(text) {
  const m = typeof text === 'string' ? DATE.exec(text) : null;
  if (!m) return false;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return day.toISOString().slice(0, 10) === text;
}

// A date in the director's words: 3 August 2026.
function plainDate(text) {
  const [year, month, day] = text.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const dollars = (n) => `US$${n.toFixed(2)}`;

// The baseline from the note's figures: `usd`, what the note says the first version cost over the
// period; `merges`, the pull requests it merged in it; `from` and `to`, the period's first and last
// days (2026-09-01); `counted`, the note's own account of how it counted, kept on one line.
// Refuses a missing figure, a cost or count of zero or less, a count that isn't whole, a date that
// isn't one, and `from` after `to`. A refusal never repeats a figure.
export function noteBaseline({ usd, merges, from, to, counted, now = () => new Date() } = {}) {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) refuse('the cost must be a number of US dollars above zero');
  if (!Number.isInteger(merges) || merges < 1) refuse('the number of merged pull requests must be a whole number above zero');
  if (!isDate(from)) refuse('the first day, from, must be a real date written as 2026-09-01');
  if (!isDate(to)) refuse('the last day, to, must be a real date written as 2026-09-30');
  if (from > to) refuse('the first day comes after the last day');
  const said = typeof counted === 'string' ? counted.replace(/\s+/g, ' ').trim() : '';
  if (said === '') refuse('how the note counted must be said, in the note\'s or the director\'s words');
  return { usdPerMerge: usd / merges, merges, from, to, method: 'note', counted: said, recordedAt: now().toISOString() };
}

// The baseline recorded on this computer, or null when there is none or it can't be read as one.
export function readBaseline() {
  try {
    const b = JSON.parse(fs.readFileSync(baselineFile(), 'utf8'));
    const good = b && typeof b === 'object' && typeof b.usdPerMerge === 'number' && Number.isFinite(b.usdPerMerge) && b.usdPerMerge > 0
      && Number.isInteger(b.merges) && b.merges >= 1 && isDate(b.from) && isDate(b.to) && b.from <= b.to && b.method === 'note'
      && typeof b.counted === 'string' && b.counted !== '' && typeof b.recordedAt === 'string';
    return good ? b : null;
  } catch {
    return null;
  }
}

// The card that reads the figures back in plain words, with Record these and Not now.
export function baselineCard(figures, hash) {
  const perMerge = figures.usd / figures.merges;
  return composeCard({
    kind: 'baseline',
    level: 3,
    what: `The first version's figures from your private note: ${dollars(figures.usd)} for ${figures.merges} merged pull requests, `
      + `from ${plainDate(figures.from)} to ${plainDate(figures.to)}, which is ${dollars(perMerge)} per merge. How the note counted: ${figures.counted}`,
    why: 'Each week Wheelhouse compares its own cost per merged pull request with the first version\'s, and only your note has those figures.',
    options: [
      { label: BASELINE_LABEL, says: 'Keep these figures on this computer as the baseline; they never go into a project\'s records.' },
      { label: 'Not now', says: 'Record nothing and forget these figures.' },
    ],
    recommend: BASELINE_LABEL,
    because: 'these are the figures you gave, so record them if they match your note',
    meanwhile: 'Nothing is recorded, and the weekly measures show no baseline yet.',
    target: { hash },
  }).question;
}

// The figures a request names, as noteBaseline takes them.
function figuresOf(body) {
  if (Object.keys(body).some((k) => !FIGURE_FIELDS.includes(k))) {
    refuse(`a request names the figures only: ${FIGURE_FIELDS.join(', ')}`);
  }
  return Object.fromEntries(FIGURE_FIELDS.map((k) => [k, body[k]]));
}

// Every baseline click kept on this computer; a file that isn't one is passed over.
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

// The director's clicks on Record these for this hash, newest first: made on this computer, signed
// by its enrolled key, from the last CLICK_FRESH_MS, and not yet used.
export function freshClicks({ hash, now = () => new Date() }) {
  const enrolled = readEnrolled();
  const me = computerId();
  const at = now().getTime();
  return keptClicks().filter((e) => {
    const age = at - Date.parse(e.at);
    return e.kind === 'action' && e.data?.action === 'baseline' && e.data.hash === hash && e.data.label === BASELINE_LABEL
      && e.computer === me && e.sig?.computer === me && EVENT_ID.test(String(e.id))
      && age <= CLICK_FRESH_MS && age >= -SKEW_MS && !used(e) && verify(e, enrolled);
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// Uses a click, once: a marker named by its id, made exclusively. True when this call used it.
function useClick(event, now) {
  if (!EVENT_ID.test(String(event?.id))) return false;
  try {
    writeWhole(path.join(usedDir(), event.id), `${now().toISOString()}\n`, { exclusive: true });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

// The route's handler, taking the request's body and giving its answer. A refusal throws
// BaselineRefusal, which the helper sends as { ok: false, refused }. Under STOP a card may still be
// shown, but nothing is recorded.
export function baselineRoutes({ now = () => new Date(), stopped = () => false, stopRefusal = { ok: false, refused: 'STOP is on' } } = {}) {
  function show(body) {
    const given = figuresOf(body);
    // The account of how the note counted, as the baseline keeps it: on one line.
    const figures = { ...given, counted: noteBaseline({ ...given, now }).counted };
    const nonce = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(canonicalJson({ ...figures, nonce })).digest('hex');
    let card;
    try {
      card = baselineCard(figures, hash);
    } catch (error) {
      refuse(`the figures can't be read back on one card: ${error instanceof Error ? error.message : 'it could not be composed'}`);
    }
    writeWhole(pendingFile(), `${JSON.stringify({ figures, nonce, hash, at: now().toISOString() })}\n`);
    writeWhole(shownFile(), `${JSON.stringify({ hash, card: cardHash(card), at: now().toISOString() })}\n`);
    return { ok: true, hash, card };
  }

  function confirm(body) {
    if (Object.keys(body).some((k) => k !== 'confirm')) refuse('a request to record names only the hash on the card');
    if (typeof body.confirm !== 'string' || !FULL_HASH.test(body.confirm)) refuse('give the full hash the card was shown with');
    if (stopped()) return stopRefusal;
    const pending = readPending();
    if (pending === null || pending.hash !== body.confirm) refuse(NOT_WAITING);
    // The figures waiting are checked again, as the click recorded them, before the click is used.
    const baseline = noteBaseline({ ...figuresOf(pending.figures), now });
    const click = freshClicks({ hash: pending.hash, now }).find((e) => useClick(e, now));
    if (!click) refuse(NEEDS_CLICK);
    writeWhole(baselineFile(), `${JSON.stringify(baseline, null, 2)}\n`);
    dropPending(pending.hash);
    return { ok: true, recorded: true };
  }

  return {
    '/measures/baseline': (body) => (Object.hasOwn(body, 'confirm') ? confirm(body) : show(body)),
  };
}
