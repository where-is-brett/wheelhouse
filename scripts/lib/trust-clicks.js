// scripts/lib/trust-clicks.js
// How one of the director's computers comes to trust another's signing key (rulings R79 to R81,
// Review Focus 5). Each computer's setup publishes its public key in the profile as
// enrolments/<computer>.json, { computer, publicKey, at } (scripts/setup/computers.js). A key found
// there is not trusted on sight, since the narrow app's key, or an agent, can write there too: it
// counts here only once the director clicks Trust it on a card naming the computer, the day its key
// was added and the key's fingerprint, and only while the profile's file still says all three.
//
// Under <wheelhouseHome()>:
//   jobs/enrolments.json  { at, enrolments }: when the session start last asked the helper for the
//                         profile's enrolments (/profile/enrolments, at most once an hour, beside
//                         weekly.json), and what the last fetch found
//   trust/                the director's Trust it, as the prompt record signed it: an `action` event
//                         `trust` { computer, at, fingerprint, question, label }, whose question is
//                         the card's set line alone. Never a card-answer in the state (as ruling R53
//                         keeps setup's answers), and never sent to the helper
//
// It lives apart from scripts/setup/ so the hooks reach nothing there (ruling R29): the session
// start offers the cards from here, and the prompt record enrols from here. Only the prompt record
// signs, and only it enrols another computer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { jobsDir, wheelhouseHome } from './paths.js';
import { EVENT_ID, writeWhole } from './setup-clicks.js';
import { TRUST_LABEL, TRUST_LINE, dayOf, trustLine } from '../state/card-lines.js';

// How often the session start asks the helper for the profile's enrolments.
export const ENROLMENTS_EVERY_MS = 60 * 60 * 1000;
// The most enrolments read from the profile, and the largest file read as one.
export const MAX_ENROLMENTS = 50;
export const MAX_ENROLMENT_BYTES = 4096;

export const COMPUTER_ID = /^[0-9a-f]{8}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const trustDir = () => path.join(wheelhouseHome(), 'trust');
export const seenFile = () => path.join(jobsDir(), 'enrolments.json');
// Where a computer's enrolment sits in the profile.
export const enrolmentPath = (computer) => `enrolments/${computer}.json`;
export const ENROLMENT_FILE = /^enrolments\/([0-9a-f]{8})\.json$/;

// The line the session start says when the profile's enrolment for a computer this one already
// trusts holds another key (ruling R80): never offered as Trust it.
export const differentKeyLine = (computer) => `A different key claims your computer ${computer}; nothing was trusted.`;

// A key's fingerprint: the first twelve hex characters of the SHA-256 of the public key (its DER
// bytes), or null when it isn't a base64 key.
export function fingerprint(publicKey) {
  if (typeof publicKey !== 'string' || !BASE64.test(publicKey)) return null;
  return crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 12);
}

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// An enrolment as the profile holds it, given its parsed JSON or its text: { computer, publicKey,
// at }, a computer id, an Ed25519 public key (base64 SPKI DER) and a UTC time. With `computer`, it
// must name that computer (its file's name). Null for anything else.
export function enrolmentOf(value, computer) {
  let found = value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > MAX_ENROLMENT_BYTES) return null;
    try {
      found = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isPlain(found)) return null;
  const { computer: id, publicKey, at } = found;
  if (typeof id !== 'string' || !COMPUTER_ID.test(id) || (computer !== undefined && id !== computer)) return null;
  if (typeof at !== 'string' || !ISO_TIME.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (typeof publicKey !== 'string' || !BASE64.test(publicKey)) return null;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return null;
  } catch {
    return null;
  }
  return { computer: id, publicKey, at };
}

// What the last fetch found, and when the helper was last asked: { at, enrolments }, or null when
// it never was or the record can't be read. Enrolments that can't be read are left out.
export function readSeen() {
  try {
    const r = JSON.parse(fs.readFileSync(seenFile(), 'utf8'));
    if (!isPlain(r) || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at)) || !Array.isArray(r.enrolments)) return null;
    return { at: r.at, enrolments: r.enrolments.slice(0, MAX_ENROLMENTS).map((e) => enrolmentOf(e)).filter((e) => e !== null) };
  } catch {
    return null;
  }
}

// Keeps when the helper was asked, and what it found (or what an earlier fetch found, when it gave
// nothing this time).
export function keepSeen({ at, enrolments }) {
  const list = (Array.isArray(enrolments) ? enrolments : []).slice(0, MAX_ENROLMENTS).map((e) => enrolmentOf(e)).filter((e) => e !== null);
  writeWhole(seenFile(), `${JSON.stringify({ at, enrolments: list }, null, 2)}\n`);
}

// Whether the helper is to be asked again at `now`: never asked, asked an hour ago or more, or
// asked at a time that is later than now (a clock that was wrong).
export function seenDue(now = () => new Date()) {
  const seen = readSeen();
  if (seen === null) return true;
  const age = now().getTime() - Date.parse(seen.at);
  return !(age >= 0 && age < ENROLMENTS_EVERY_MS);
}

// What the enrolments found offer this computer: `offers`, each enrolment of a computer it doesn't
// trust yet, for a trust card; `clashes`, the id of each computer it trusts (in `enrolled`, or this
// computer itself, `own`) whose enrolment holds another key, which is never offered (ruling R80).
export function trustOffers({ enrolments, enrolled, own }) {
  const known = new Map((Array.isArray(enrolled) ? enrolled : []).filter((e) => typeof e?.computer === 'string').map((e) => [e.computer, e.publicKey]));
  if (own && typeof own.computer === 'string') known.set(own.computer, own.publicKey);
  const offers = [];
  const clashes = [];
  for (const e of Array.isArray(enrolments) ? enrolments : []) {
    if (!known.has(e.computer)) offers.push(e);
    else if (known.get(e.computer) !== e.publicKey) clashes.push(e.computer);
  }
  return { offers, clashes };
}

// The composer's input for the trust card of one enrolment (scripts/cards/compose.js).
export function trustCardInput({ computer, at, publicKey }) {
  const day = dayOf(at);
  return {
    kind: 'trust',
    level: 3,
    what: `Your computer ${computer} put its key in your profile on ${day}; trusted here, its records and clicks count on this computer too.`,
    why: 'A key found in your profile isn\'t trusted on sight, since an app\'s key can write there too: only you can say the computer is yours.',
    options: [
      { label: TRUST_LABEL, says: `Records and clicks from computer ${computer} count here from now on.` },
      { label: 'Not now', says: 'Nothing is trusted, and this is asked again at a later session.' },
      { label: 'Explain more' },
    ],
    recommend: TRUST_LABEL,
    because: `you set Wheelhouse up on that computer on ${day}; if you didn't, choose Not now`,
    meanwhile: `Records from computer ${computer} don't count here; everything else carries on.`,
    target: { computer, at, fingerprint: fingerprint(publicKey) },
  };
}

// The enrolment a click on a card carrying `line` would trust: the one the last fetch found whose
// computer, day and key fingerprint are all the line's. Null when there is none, when the computer
// is this one, or when this computer already trusts that id with another key (never replaced on a
// click: ruling R80).
export function trustedBy(line, { seen = readSeen(), enrolled = [], own = null } = {}) {
  const m = TRUST_LINE.exec(typeof line === 'string' ? line : '');
  if (!m || seen === null) return null;
  const [, computer, day, print] = m;
  if (own?.computer === computer) return null;
  const known = (Array.isArray(enrolled) ? enrolled : []).find((e) => e?.computer === computer);
  const found = seen.enrolments.filter((e) => e.computer === computer && dayOf(e.at) === day && fingerprint(e.publicKey) === print
    && trustLine(e.computer, e.at, print) === line);
  if (found.length !== 1) return null;
  if (known !== undefined && known.publicKey !== found[0].publicKey) return null;
  return found[0];
}

// Keeps one signed trust click, under a name of its time, computer and id, never over another.
export function keepTrustClick(event) {
  if (event?.kind !== 'action' || event.data?.action !== 'trust' || !event.sig) throw new Error('Only a signed trust click is kept here');
  if (typeof event.at !== 'string' || !EVENT_ID.test(String(event.id)) || !COMPUTER_ID.test(String(event.computer))) {
    throw new Error('A trust click needs its time, its id and its computer');
  }
  const file = path.join(trustDir(), `${event.at.replaceAll(':', '-')}_${event.computer}_trust_${event.id}.json`);
  writeWhole(file, `${JSON.stringify(event, null, 2)}\n`, { exclusive: true });
  return file;
}
