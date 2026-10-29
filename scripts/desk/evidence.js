// scripts/desk/evidence.js
// Whether an act's evidence shows the director made the decision (spec 5.3). Four forms, and only these:
// - `{ form: 'signed', records }`: records made and signed with this computer's key, as the
//   prompt-record hook and the pane make them (earned, keepEarned). Each is checked as the helper's
//   /state/record checks it (checkRecord: signed here, of a kind a caller may send, its id not held),
//   and must be for the act's card and option. A record is an event, or `{ event, target, profile }`
//   as the pane keeps one (a confirmation with the event it confirms, or a record for the settings).
// - `{ form: 'window' }`: the helper's confirm window, which signs after the director's click.
// - `{ form: 'chat-click', proof: 'chat-click' }`: an unsigned click in an agent's chat, for an option
//   outside SIGNED_LABELS, as /cards/chat-click accepts it.
// - `{ form: 'client', client, at, sig }`: a paired app's ed25519 signature over
//   canonicalJson({ command, args, at }), within CLIENT_WINDOW_MS of `at`.
import crypto from 'node:crypto';
import { checkRecord, CONFIRMABLE_KINDS } from '../state/events.js';
import { confirmLine } from '../state/card-lines.js';
import { canonicalJson } from '../lib/canonical.js';
import { SIGNED_LABELS } from '../hooks/prompt-record.js';
import { computerId } from '../lib/paths.js';

export const CLIENT_WINDOW_MS = 5 * 60 * 1000;
export const EVIDENCE_FORMS = Object.freeze(['signed', 'window', 'chat-click', 'client']);
// The cards a click in the chat may decide, which the helper's own route checks again: a merge
// card, and a guardrail card at Lean.
const CHAT_DECIDES = /^(?:merge|guardrail)-/;
const CARD_COMMANDS = ['answer', 'suggest', 'not-now'];

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const no = (refused) => ({ ok: false, refused });

// A record as `{ event, target, profile }`, whichever way it came.
export function asRecord(record) {
  return isPlain(record) && isPlain(record.event) ? { event: record.event, target: record.target, profile: record.profile === true } : { event: record, target: undefined, profile: false };
}

// The question of the waiting card `id`, or null.
function questionOf(views, id) {
  const card = (Array.isArray(views?.waiting) ? views.waiting : []).find((c) => c?.id === id);
  return typeof card?.data?.question === 'string' ? card.data.question : null;
}

// Whether a signed record is for the card asking `question` and the option chosen: a click's record
// carries the question; a record with a line carries one of the card's lines; a confirmation names
// an event whose confirm line the card carries.
function forCard({ event, target }, question, option, events) {
  const data = isPlain(event?.data) ? event.data : {};
  if (typeof data.label === 'string' && data.label !== '' && option !== undefined && data.label !== option) return false;
  if (typeof data.question === 'string') return data.question === question;
  if (typeof data.line === 'string') return question.includes(data.line);
  if (event?.kind === 'confirmation') {
    const confirmed = target ?? events.find((e) => e.id === data.confirms);
    return CONFIRMABLE_KINDS.includes(confirmed?.kind) && question.includes(confirmLine(confirmed));
  }
  return false;
}

// Whether a signed record is what `command` needs, beyond being for a card.
function fitsCommand(command, args, { event, target }) {
  if (command === 'lift-all-stop') return event?.kind === 'action' && event.data?.action === 'lift-stop';
  if (command === 'set') return event?.kind === 'confirmation' && target?.kind === 'setting' && target.data?.key === args.setting;
  return true;
}

function checkSigned(command, args, records, { enrolled, views, events, computer }) {
  if (!Array.isArray(records) || records.length === 0) return no('Signed evidence carries at least one signed record');
  const question = CARD_COMMANDS.includes(command) ? questionOf(views, args.card) : null;
  if (CARD_COMMANDS.includes(command) && question === null) return no(`Card ${args.card} isn't waiting`);
  const out = [];
  for (const given of records) {
    const record = asRecord(given);
    const held = events.filter((e) => e.id === record.event?.id);
    const refused = checkRecord(record.event, { enrolled, held, computer });
    if (refused !== null) return no(`That record was refused: ${refused}`);
    if (held.length > 0) return no('That record is already held, so it decides nothing again');
    if (question !== null && !forCard(record, question, command === 'answer' ? args.option : undefined, events)) return no(`That record isn't for card ${args.card}`);
    if (!fitsCommand(command, args, record)) return no(`That record isn't what ${command} needs`);
    out.push(record);
  }
  return { ok: true, records: out };
}

function checkClient(command, args, { client, at, sig }, { clients, now }) {
  const entry = (Array.isArray(clients) ? clients : []).find((c) => c?.id === client);
  if (entry === undefined) return no('That app was never paired with Wheelhouse');
  const atMs = Date.parse(at);
  const nowMs = now().getTime();
  if (!Number.isFinite(atMs) || Math.abs(nowMs - atMs) > CLIENT_WINDOW_MS) return no('That app\'s signature is more than five minutes old');
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(entry.publicKey, 'base64'), format: 'der', type: 'spki' });
    if (typeof sig === 'string' && crypto.verify(null, Buffer.from(canonicalJson({ command, args, at })), key, Buffer.from(sig, 'base64'))) {
      return { ok: true, records: [], client: entry.id };
    }
  } catch {
    // Read as a signature that doesn't check.
  }
  return no('That app\'s signature doesn\'t check');
}

// checkEvidence(command, args, evidence, { enrolled, clients, views, events, now, computer })
//   -> { ok, records?, refused? }. Never throws.
export function checkEvidence(command, args, evidence, { enrolled = [], clients = [], views = {}, events = [], now = () => new Date(), computer = computerId() } = {}) {
  try {
    if (!isPlain(evidence) || !EVIDENCE_FORMS.includes(evidence.form)) return no('That evidence isn\'t a form Wheelhouse takes');
    if (evidence.form === 'signed') return checkSigned(command, args, evidence.records, { enrolled, views, events, computer });
    if (evidence.form === 'client') return checkClient(command, args, evidence, { clients, now });
    if (evidence.form === 'window') return command === 'answer' ? { ok: true, records: [], window: true } : no('The confirm window decides an answer only');
    // A click in the chat.
    if (evidence.proof !== 'chat-click') return no('A click in the chat is recorded as chat-click');
    if (!CARD_COMMANDS.includes(command)) return no('A click in the chat answers a card only');
    if (SIGNED_LABELS.includes(args.option) && !CHAT_DECIDES.test(String(args.card))) return no('A click in the chat can\'t decide that card');
    return { ok: true, records: [], chatClick: true };
  } catch (error) {
    return no(`That evidence couldn't be checked: ${error?.message || error}`);
  }
}

// The verifier deskCore takes over a source: the enrolled computers, the paired apps, and the
// waiting cards and events as the source gives them when the act is checked.
export function sourceVerifier(source, { clients = () => [], now = () => new Date() } = {}) {
  return {
    async check(command, args, evidence) {
      const got = await source.views({ cards: true });
      return checkEvidence(command, args, evidence, {
        enrolled: source.enrolled?.() ?? [], clients: clients(), views: got?.views ?? {}, events: source.events?.() ?? [], now,
      });
    },
  };
}
