// scripts/desk/acts.js
// The desk's acts (spec 5.2), run once checkEvidence has passed their evidence. A card's act names
// the card and the hash of what was shown; one for a card that closed or changed meanwhile is
// refused, not applied, with the line saying which answer counted. Under STOP only the signed
// records are taken, as the helper takes them; plain answers wait.
import crypto from 'node:crypto';
import { cardOutcomes } from '../state/views.js';
import { dataHash } from '../state/events.js';
import { cardTextOf, hashOf } from '../mod/status.js';
import { NOT_NOW, SUGGEST } from '../lib/calm-words.js';
import { composeCard } from '../cards/compose.js';
import { PAIR_LABEL } from '../state/card-lines.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const no = (refused) => ({ ok: false, refused });

// Whether `hash` names the card as it stands: the pane's 12-character hash of its text, the sha256
// of its text (a click in the chat), or the sha256 of its data (a later app).
export function namesCard(hash, data) {
  if (typeof hash !== 'string') return false;
  const text = cardTextOf(data);
  return hash === hashOf(text) || hash === sha256(text) || hash === dataHash(data);
}

// The waiting card `id` and its question, or the refusal saying why it can't be answered: it was
// decided (and which answer counted), it changed since it was shown, or it isn't there.
async function liveCard(source, id, hash) {
  const got = await source.views({ cards: true });
  const waiting = Array.isArray(got?.views?.waiting) ? got.views.waiting : [];
  const card = waiting.find((c) => c?.id === id);
  if (!isPlain(card?.data)) {
    const outcome = cardOutcomes(source.events(), source.enrolled?.() ?? []).find((o) => o.card.id === id);
    if (outcome?.decided) return { refused: `Card ${id} was already answered: "${outcome.decided.label}" counted, so this wasn't recorded` };
    return { refused: `Card ${id} isn't waiting, so this wasn't recorded` };
  }
  if (hash !== undefined && !namesCard(hash, card.data)) return { refused: `Card ${id} changed since it was shown, so no answer to it counted; it is asked again as it stands` };
  return { card, question: typeof card.data.question === 'string' ? card.data.question : cardTextOf(card.data) };
}

async function recordAll(recorder, records) {
  for (const record of records) {
    const got = await recorder.record(record);
    if (got?.ok !== true) return got?.refused ?? 'the record wasn\'t taken';
  }
  return null;
}

// An answer, a suggestion or a Not now on a card, by the evidence's way.
async function onCard(command, args, checked, { source, recorder }) {
  const label = command === 'suggest' ? SUGGEST : command === 'not-now' ? NOT_NOW : args.option;
  // A click in the chat and the confirm window go through the helper's own routes, which find and check the card themselves.
  if (checked.chatClick) {
    const got = await recorder.chatClick({ card: args.card, label, hash: args.hash, proof: 'chat-click', ...(args.commit ? { commit: args.commit } : {}), ...(command === 'suggest' ? { text: args.words } : {}) });
    return got?.ok === true ? { ok: true, changed: ['card-answer'], ...got } : no(got?.refused ?? 'The click wasn\'t recorded');
  }
  if (checked.window) {
    const got = await recorder.confirm({ card: args.card, hash: args.hash });
    return got?.ok === true ? { ok: true, changed: ['confirmed'], ...got } : no(got?.refused ?? 'The window didn\'t confirm it');
  }
  const live = await liveCard(source, args.card, args.hash);
  if (live.refused) return no(live.refused);
  const records = checked.records ?? [];
  const refused = await recordAll(recorder, records);
  if (refused !== null) return no(`That wasn't recorded: ${refused}`);
  const stop = await source.stop?.();
  // Under STOP the signed record closes the card on its own; a plain answer waits.
  if (stop?.on === true) return records.length > 0 ? { ok: true, changed: ['record'] } : no('All stop is on');
  const data = { question: live.question, label, ...(checked.client ? { proof: 'client', by: checked.client } : {}) };
  const got = await recorder.write({ kind: 'card-answer', data });
  if (got?.ok !== true) return no(got?.refused ?? 'The answer wasn\'t written');
  return { ok: true, changed: [...records.map(() => 'record'), 'card-answer'], ...(command === 'suggest' ? { words: args.words } : {}) };
}

const ACTS = {
  answer: (args, checked, deps) => onCard('answer', args, checked, deps),
  suggest: (args, checked, deps) => onCard('suggest', args, checked, deps),
  'not-now': (args, checked, deps) => onCard('not-now', args, checked, deps),
  async request(args, checked, { recorder }) {
    if (typeof args.words !== 'string' || args.words.trim() === '') return no('A request is the director\'s words');
    const got = await recorder.write({ kind: 'request', data: { words: args.words, via: typeof args.via === 'string' ? args.via : 'desk' } });
    return got?.ok === true ? { ok: true, changed: ['request'], id: got.id } : no(got?.refused ?? 'The request wasn\'t written');
  },
  // The setting and its signed confirmation, as writeSetting and the pane's press make them.
  async set(args, checked, { recorder }) {
    const refused = await recordAll(recorder, checked.records ?? []);
    return refused === null ? { ok: true, changed: ['setting'] } : no(`The setting wasn't changed: ${refused}`);
  },
  async 'all-stop'(args, checked, { recorder }) {
    const got = await recorder.setStop({ by: typeof args.by === 'string' ? args.by : 'helper' });
    return got?.ok === false ? no(got.refused ?? 'All stop wasn\'t set') : { ok: true, changed: ['all-stop'] };
  },
  // An app asks to pair: its request is kept, and one card, Pair this app, asks the director. It decides nothing
  // until the director's signed Pair it, which enrols the key (scripts/desk/clients.js).
  async pair(args, checked, { recorder }) {
    const asked = await recorder.askPair(isPlain(args.client) ? args.client : {});
    if (asked?.ok !== true) return no(asked?.refused ?? 'The app\'s request to pair wasn\'t kept');
    const { card } = composeCard({
      kind: 'pair', level: 4, recommend: PAIR_LABEL,
      what: `The app "${asked.name}" (${asked.id}) asks to read Wheelhouse and decide through it, with its key ${asked.fingerprint}.`,
      why: 'An app that is paired can answer cards as you, so only you can pair one, at level 4.',
      because: 'you opened this app yourself and it shows the same key.',
      meanwhile: 'The app can\'t read or decide anything until you pair it.',
      options: [{ label: PAIR_LABEL, says: 'It pairs the app, and it can answer cards as you; one click unpairs it.' }],
      checks: 'It changes no checks: a paired app decides only what you could decide here.',
      target: { client: asked.id, fingerprint: asked.fingerprint },
    });
    const got = await recorder.write({ kind: 'card', data: card });
    return got?.ok === true ? { ok: true, changed: ['card'], card: got.id, fingerprint: asked.fingerprint } : no(got?.refused ?? 'The card wasn\'t written');
  },
  // A button on the Safekeeping row: the signed press goes on the record, and the helper does what it names.
  async safekeeping(args, checked, { recorder }) {
    const refused = await recordAll(recorder, checked.records ?? []);
    if (refused !== null) return no(`That wasn't recorded: ${refused}`);
    if (typeof recorder.safekeeping !== 'function') return no('The helper isn\'t running, so nothing was done');
    const got = await recorder.safekeeping({ action: args.action });
    return got?.ok === true ? { ok: true, changed: ['safekeeping'], ...(got.says ? { says: got.says } : {}), ...(got.submit ? { submit: got.submit } : {}) } : no(got?.refused ?? 'That wasn\'t done');
  },
  // The director's Show them: the cards past the day's budget are named as pulled, and the router lifts them on its
  // next tick, spending none of the budget. With none held back there is nothing to write.
  async 'pull-cards'(args, checked, { source, recorder }) {
    const got = await source.views({});
    const ids = Array.isArray(got?.views?.cardsWaiting?.ids) ? got.views.cardsWaiting.ids : [];
    if (ids.length === 0) return { ok: true, changed: [] };
    const written = await recorder.write({ kind: 'note', data: { about: 'cards-pulled', ids } });
    return written?.ok === true ? { ok: true, changed: ['cards-pulled'] } : no(written?.refused ?? 'The cards weren\'t brought up');
  },
  async 'lift-all-stop'(args, checked, { recorder }) {
    const records = checked.records ?? [];
    if (!records.some((r) => r.event?.kind === 'action' && r.event.data?.action === 'lift-stop')) return no('Lifting All stop needs the director\'s signed Lift All stop');
    const refused = await recordAll(recorder, records);
    if (refused !== null) return no(`All stop is still on: ${refused}`);
    await recorder.liftStop();
    return { ok: true, changed: ['all-stop'] };
  },
};

// runAct(command, args, checked, { source, recorder, now }) -> { ok, changed } | { ok: false, refused }.
export async function runAct(command, args, checked, deps) {
  const act = ACTS[command];
  if (act === undefined) return no(`The desk can't "${command}" yet`);
  return act(isPlain(args) ? args : {}, isPlain(checked) ? checked : { records: [] }, deps);
}

// The actors deskCore takes, one per command.
export const ACTORS = Object.fromEntries(Object.keys(ACTS).map((command) => [command, (args, checked, deps) => runAct(command, args, checked, deps)]));
