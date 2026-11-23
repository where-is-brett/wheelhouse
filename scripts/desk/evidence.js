// scripts/desk/evidence.js
// Whether an act's evidence shows the director made the decision (spec 5.3). Four forms, and only these:
// - `{ form: 'signed', records }`: records made and signed with this computer's key, as the
//   prompt-record hook and the pane make them (earned, keepEarned). Each is checked as the helper's
//   /state/record checks it (checkRecord: signed here, of a kind a caller may send, its id not held),
//   and must be for the act's card and option. A record is an event, or `{ event, target, profile }`
//   as the pane keeps one (a confirmation with the event it confirms, or a record for the settings).
// - `{ form: 'window' }`: the helper's confirm window, which signs after the director's click.
// - `{ form: 'chat-click', proof: 'chat-click' }`: an unsigned click in an agent's chat, for an option
//   that signs nothing on its card (signsOn), as /cards/chat-click accepts it.
// - `{ form: 'client', client, at, sig }`: a paired app's ed25519 signature over
//   canonicalJson({ command, args, at }), within CLIENT_WINDOW_MS of `at`.
import crypto from 'node:crypto';
import { checkRecord, CONFIRMABLE_KINDS } from '../state/events.js';
import { confirmLine } from '../state/card-lines.js';
import { canonicalJson } from '../lib/canonical.js';
import { signsOn } from '../hooks/prompt-record.js';
import { computerId } from '../lib/paths.js';
import { isDecisionCard } from '../decisions/pending.js';

export const CLIENT_WINDOW_MS = 5 * 60 * 1000;
export const EVIDENCE_FORMS = Object.freeze(['signed', 'window', 'chat-click', 'client']);
// The cards a click in the chat may decide, which the helper's own route checks again: a merge card.
const CHAT_DECIDES = /^merge-/;
const CARD_COMMANDS = ['answer', 'suggest', 'not-now'];
// The only commands a paired app's signature carries: card answers (under clientMayAnswer), its watch, and Ask me here.
// pair and unpair take no evidence at all, so they never reach here. Everything else (settings, safekeeping, All stop, Lift
// STOP, a request) is the director's own, in the window or the chat.
export const CLIENT_COMMANDS = Object.freeze([...CARD_COMMANDS, 'watch', 'ask-here']);
// The kinds of card whose click is confirmed in the window: a paired app never decides one, whatever its option's label.
const WINDOW_KINDS = ['lift-stop', 'runbook', 'ci-push', 'pair', 'unpair', 'take-over', 'trust', 'uninstall', 'setup', 'confirm-all', 'baseline', 'usage', 'premium', 'release', 'update-helper', 'update', 'keep-control-files'];
const APPROVAL_SET_LINE = /^Approve pull request #[1-9][0-9]* at commit [0-9a-f]{12}$/;

// Whether a card's data is a plain merge approval, as the composer writes one: kind approval, at level 3, with the approval set
// line. A level-4 approval is a guardrail change or a parked change, which is confirmed in the window. Read from the live card,
// never from its id.
export function isMergeApproval(data) {
  return isPlain(data) && data.kind === 'approval' && data.level === 3 && typeof data.line === 'string' && APPROVAL_SET_LINE.test(data.line);
}

// The signatures an app's acts have used, kept in this process for as long as they could be accepted (CLIENT_WINDOW_MS), so an act
// signed once is taken once. A watch may be signed again with the same words, and is not kept here.
const usedSignatures = new Map();
export const clearUsedSignatures = () => usedSignatures.clear();
function useOnce(sig, nowMs) {
  for (const [key, at] of usedSignatures) if (nowMs - at > CLIENT_WINDOW_MS * 2) usedSignatures.delete(key);
  if (usedSignatures.has(sig)) return false;
  usedSignatures.set(sig, nowMs);
  return true;
}

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
  if (command === 'safekeeping') return event?.kind === 'action' && event.data?.action === 'safekeeping' && event.data?.press === args.action;
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

// The app signs `{ command, args, at, project }`, so an act signed for one project is no act for another.
export function checkClient(command, args, { client, at, sig }, { clients, now, project }) {
  if (typeof project !== 'string' || project === '') return no('A paired app\'s signature names the project it is for');
  const entry = (Array.isArray(clients) ? clients : []).find((c) => c?.id === client);
  if (entry === undefined) return no('That app was never paired with Wheelhouse');
  const atMs = Date.parse(at);
  const nowMs = now().getTime();
  if (!Number.isFinite(atMs) || Math.abs(nowMs - atMs) > CLIENT_WINDOW_MS) return no('That app\'s signature is more than five minutes old');
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(entry.publicKey, 'base64'), format: 'der', type: 'spki' });
    if (typeof sig === 'string' && crypto.verify(null, Buffer.from(canonicalJson({ command, args, at, project })), key, Buffer.from(sig, 'base64'))) {
      return { ok: true, records: [], client: entry.id };
    }
  } catch {
    // Read as a signature that doesn't check.
  }
  return no('That app\'s signature doesn\'t check');
}

// The waiting card `id`'s data, or null.
function cardOf(views, id) {
  const card = (Array.isArray(views?.waiting) ? views.waiting : []).find((c) => c?.id === id);
  return isPlain(card?.data) ? card.data : null;
}

// What a paired app may decide, never more than a click in the chat: a plain option on any card, and a signing option on a plain
// merge approval only (isMergeApproval, read from the live card the act names). Never a confirmed step, a guardrail change, a
// decision, or any other signing option. An answer names the card's hash, as a click in the chat does, and an option the card
// offers. `decides` is true where the option signs on a merge approval.
function clientMayAnswer(command, args, views) {
  if (!CARD_COMMANDS.includes(command)) return { ok: true, decides: false };
  const card = String(args?.card ?? '');
  const label = command === 'answer' ? args?.option : undefined;
  if (command === 'answer' && (typeof args?.hash !== 'string' || args.hash === '')) return no('An answer names the hash of the card it was shown');
  const data = cardOf(views, card);
  if (command === 'answer' && data !== null && Array.isArray(data.options) && !data.options.includes(label)) return no('That isn\'t one of the options the card offers');
  const asked = typeof data?.question === 'string' ? data.question : card;
  const signs = typeof label === 'string' && signsOn(label, asked);
  if (command === 'answer' && isDecisionCard(data)) return no('A decision is answered in Wheelhouse\'s window or by a typed reply, never from the panel');
  if (signs && WINDOW_KINDS.includes(data?.kind)) return no('That step is confirmed in Wheelhouse\'s window, never from the panel');
  if (signs && data?.kind === 'approval' && !isMergeApproval(data)) return no('That approval is confirmed in Wheelhouse\'s window, never from the panel');
  if (signs && !isMergeApproval(data)) return no('The panel can\'t decide that card: answer it in Wheelhouse\'s window');
  return { ok: true, decides: signs };
}

// The words of the card a click names, by its id in the views, or the name as given: a click in the chat names either.
const askedOn = (views, card) => String(views?.waiting?.find?.((c) => c?.id === card)?.data?.question ?? card);

// checkEvidence(command, args, evidence, { enrolled, clients, views, events, now, computer, project })
//   -> { ok, records?, refused? }. Never throws.
export function checkEvidence(command, args, evidence, { enrolled = [], clients = [], views = {}, events = [], now = () => new Date(), computer = computerId(), project } = {}) {
  try {
    if (!isPlain(evidence) || !EVIDENCE_FORMS.includes(evidence.form)) return no('That evidence isn\'t a form Wheelhouse takes');
    // Only a paired app's panel asks a card here: a signed record, the window or a click in the chat is none of its business.
    if (command === 'ask-here' && evidence.form !== 'client') return no('Only a paired app asks a card here');
    if (evidence.form === 'signed') return checkSigned(command, args, evidence.records, { enrolled, views, events, computer });
    if (evidence.form === 'client') {
      const got = checkClient(command, args, evidence, { clients, now, project });
      if (!got.ok) return got;
      if (!CLIENT_COMMANDS.includes(command)) return no(`A paired app can't ${command}: that is decided in Wheelhouse's window or the chat`);
      const may = clientMayAnswer(command, args, views);
      if (!may.ok) return may;
      // An act's signature is taken once; a watch is signed again each time it is renewed, so it may repeat.
      if (command !== 'watch' && !useOnce(evidence.sig, now().getTime())) return no('That app\'s signature was used already, so it is signed again for each act');
      return { ...got, decides: may.decides };
    }
    if (evidence.form === 'window') return command === 'answer' ? { ok: true, records: [], window: true } : no('The confirm window decides an answer only');
    // A click in the chat.
    if (evidence.proof !== 'chat-click') return no('A click in the chat is recorded as chat-click');
    if (!CARD_COMMANDS.includes(command)) return no('A click in the chat answers a card only');
    if (signsOn(args.option, askedOn(views, args.card)) && !CHAT_DECIDES.test(String(args.card))) return no('A click in the chat can\'t decide that card');
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
        enrolled: source.enrolled?.() ?? [], clients: clients(), views: got?.views ?? {}, events: source.events?.() ?? [], now, project: source.project,
      });
    },
  };
}
