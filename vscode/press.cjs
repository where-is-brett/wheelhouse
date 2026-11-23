// vscode/press.cjs
// What the add-on does with a message from its panel. This is the only way an act reaches the desk from here: the
// panel's buttons post a message, and nothing else (no command, address, chat tool or other message) makes a call
// (scripts/addon/validate.js checks it, and tests/vscode/press.test.js).
//
// A message counts only with the nonce of the panel's latest draw. It must then name one of the acts below and, for
// a card, a card that is waiting now, with the hash the panel drew it with and (for an answer) one of the options
// that card really offers. Everything sent to the desk is built here from the live card and the app's own identity;
// nothing is taken from the page's text. The helper checks all of it again, and refuses what a panel may not decide.
'use strict';

const { sameNonce } = require('./nonce.cjs');
const { cardOf } = require('./model.cjs');

// The acts a message may name. The panel's option buttons post `press`, which is an answer.
const ACTS = ['answer', 'suggest', 'not-now', 'all-stop', 'pull-cards', 'ask-here', 'unpair', 'pair'];
const ALIASES = { press: 'answer' };
const WORDS_CHARS = 4000;
const NOT_NOW = 'Not now';
const CHANGED = 'That changed while you were looking, so nothing was sent. Look at the panel again.';
const IN_WINDOW = 'Answer this one in Wheelhouse\'s window. It can\'t be decided from here.';
const APPROVAL_LINE = /^Approve pull request #[1-9][0-9]* at commit ([0-9a-f]{12})$/;

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (record, key) => (Object.hasOwn(record, key) ? record[key] : undefined);
const text = (x) => (typeof x === 'string' ? x : '');
const dropped = () => ({ ok: false });
const refused = (says) => ({ ok: false, says });

// The live card the message names: by its id, with the hash it was drawn with. Null when it isn't waiting, or has
// changed (its hash is the same sum the drawing gave it).
function liveCard(waiting, id, hash) {
  if (id === '' || hash === '') return null;
  const entry = (Array.isArray(waiting) ? waiting : []).find((c) => isRecord(c) && c.id === id);
  if (entry === undefined) return null;
  const card = cardOf(entry);
  return hash === card.hash ? { entry, card } : null;
}

// What the desk is told for each act, built from the message's few checked fields and the live state.
function build(act, message, { waiting, app }) {
  if (act === 'all-stop') return { args: { by: 'panel' } };
  if (act === 'pull-cards') return { args: {} };
  if (act === 'pair') return isRecord(app) ? { args: { client: { id: app.id, name: app.name, publicKey: app.publicKey } } } : null;
  if (act === 'unpair') return isRecord(app) ? { args: { client: app.id } } : null;
  const id = text(own(message, 'card'));
  const live = liveCard(waiting, id, text(own(message, 'hash')));
  if (live === null) return { says: CHANGED };
  const { entry, card } = live;
  if (act === 'ask-here') return { args: { card: id } };
  const base = { card: id, hash: card.hash };
  if (act === 'not-now') return { args: base };
  if (act === 'suggest') {
    const words = text(own(message, 'words')).slice(0, WORDS_CHARS);
    return words.trim() === '' ? { says: 'A suggestion needs words.' } : { args: { ...base, words } };
  }
  // An answer: one of the options the live card offers, and not on a step the window confirms, a decision, or
  // a deciding option on a card that isn't a merge approval.
  const option = text(own(message, 'option'));
  const offered = card.options.find((o) => o.label === option);
  if (offered === undefined || option === NOT_NOW) return { says: CHANGED };
  if (card.confirmed || card.decision || (offered.signs && !card.merge)) return { says: IN_WINDOW };
  // A merge card's Approve carries the commit the card names, read from the card, never from the page.
  const commit = APPROVAL_LINE.exec(text(entry.data?.line))?.[1];
  return { args: { ...base, option, ...(offered.signs && commit !== undefined ? { commit } : {}) } };
}

function done(act, got) {
  if (got?.update === true) return { ok: false, act, got, says: 'Update Wheelhouse: this panel and the helper speak different versions, so nothing was sent.' };
  if (got?.down === true) return { ok: false, act, got, says: 'Wheelhouse\'s helper isn\'t running, so nothing was sent.' };
  if (got?.ok === true) return { ok: true, act, got, ...(typeof got.says === 'string' && got.says !== '' ? { says: got.says } : {}) };
  return { ok: false, act, got, says: text(got?.refused) || 'Wheelhouse didn\'t take that.' };
}

// press(message, { latestNonce, client, waiting, app }) -> Promise<{ ok, says?, act?, got? }>. Never throws.
//   message      what the panel posted
//   latestNonce  the nonce of the panel's latest draw
//   client       the desk/1 client for this project (`act` signs with the add-on's key)
//   waiting      the cards waiting now, as the desk's `waiting` view gives them ({ id, data })
//   app          this add-on's identity, { id, name, publicKey }
async function press(message, { latestNonce, client, waiting, app } = {}) {
  if (!isRecord(message)) return dropped();
  if (!sameNonce(own(message, 'nonce'), latestNonce)) return dropped();
  const type = text(own(message, 'type'));
  const act = ALIASES[type] ?? type;
  if (!ACTS.includes(act) || typeof client?.act !== 'function') return dropped();
  try {
    const built = build(act, message, { waiting, app });
    if (built === null) return dropped();
    if (built.says !== undefined) return refused(built.says);
    return done(act, await client.act(act, built.args));
  } catch {
    return refused('That didn\'t go through, so nothing was recorded.');
  }
}

// The add-on's own request to pair, made when it starts unpaired. It only asks: the card that comes of it needs the
// director's signed Pair it before anything is decided.
async function askToPair(client, app) {
  const built = build('pair', {}, { app });
  return built === null ? { ok: false } : client.act('pair', built.args);
}

module.exports = { press, askToPair, ACTS, WORDS_CHARS, CHANGED, IN_WINDOW };
