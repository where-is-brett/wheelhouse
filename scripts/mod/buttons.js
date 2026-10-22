// scripts/mod/buttons.js
// Which buttons the pane draws under a card, and what each does: `record` is a press the bridge
// signs as the same click on the card would earn; `turn` hands the front desk a short prompt
// (Task 5). The mod decides none of this. A card is judged by the same function the card check
// hook uses, so a card the hook would have refused gets no button that records anything. The
// Unattended card for build commands on Windows, known by its risk words as the prompt record knows
// it, gets no button at all: only a click on it when the front desk asks it sets the level. Nor
// does a setup card, nor setup's card of the rules found: its step goes ahead only by the
// director's click on the very card setup showed, which only the prompt record counts
// (scripts/setup/clicks.js). Nor does the baseline card, for the same reason
// (scripts/lib/measures-clicks.js); it is never a card event anyway. Nor does a trust card (ruling
// R80): another computer is trusted only by the director's click on the card the session start
// composed, which only the prompt record counts (scripts/lib/trust-clicks.js). Nor does uninstall's
// card (ruling R90): Wheelhouse is removed from a project only by the director's click on the card the
// helper composed for its list, which only the prompt record counts (scripts/lib/setup-clicks.js).
import { cardProblems } from '../hooks/card-check.js';
import { SIGNED_LABELS } from '../hooks/prompt-record.js';
import { CARD_KINDS, PUT_OFF } from '../lib/front-desk.js';
import { SUGGEST, NOT_NOW } from '../lib/calm-words.js';
import { setLinesOf, TRUST_LINE, UNINSTALL_LINE } from '../state/card-lines.js';
import { baselineWording } from '../lib/measures-clicks.js';
import { UNATTENDED_CARD } from '../protection/windows-builds.js';

export const CANT_ANSWER = 'This card can\'t be answered here: ask the front desk about it.';
// A setup card's note: setup asks it in its own chat, and that is where it is answered.
export const SETUP_ANSWER = 'This card can\'t be answered here: answer it in the chat where setup asked it.';
// A trust card's note: it is answered only in the chat where it was asked.
export const TRUST_ANSWER = 'This card can\'t be answered here: answer it in the chat where it was asked.';
// Uninstall's card's note: it is answered only in the chat where setup's playbook asked it.
export const UNINSTALL_ANSWER = 'This card can\'t be answered here: answer it in the chat where uninstall asked it.';
const ANSWER_LINE = /^Answer question /;
const SETUP_LINE = /^(?:Set up step |Confirm all [1-9][0-9]* rules? as listed, )/;
// What a card offers to turn to the front desk, apart from its own options.
const TURNS = PUT_OFF.filter((label) => label !== NOT_NOW);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The kind a card is, one of CARD_KINDS; a card with no kind of its own is a question.
export const kindOf = (card) => (CARD_KINDS.includes(card?.kind) ? card.kind : 'question');

// The labels the card offers, each once, in order.
function optionsOf(card) {
  const given = Array.isArray(card?.options) ? card.options : [];
  return [...new Set(given.map((o) => (typeof o === 'string' ? o : o?.label)).filter((l) => typeof l === 'string' && l !== ''))];
}

const button = (label, does) => ({ label, does });

// Whether a card is a setup card: of kind setup or confirm-all (the rules found), or carrying
// either's set line.
export function isSetupCard(card) {
  const text = typeof card?.question === 'string' ? card.question : '';
  return card?.kind === 'setup' || card?.kind === 'confirm-all' || setLinesOf(text).some((line) => SETUP_LINE.test(line));
}

// Whether a card is a trust card: of kind trust, or carrying a trust card's set line.
export function isTrustCard(card) {
  const text = typeof card?.question === 'string' ? card.question : '';
  return card?.kind === 'trust' || setLinesOf(text).some((line) => TRUST_LINE.test(line));
}

// Whether a card is uninstall's: of kind uninstall, or carrying uninstall's set line.
export function isUninstallCard(card) {
  const text = typeof card?.question === 'string' ? card.question : '';
  return card?.kind === 'uninstall' || setLinesOf(text).some((line) => UNINSTALL_LINE.test(line));
}

// cardButtons(card) -> { buttons, note }. `card` is a card event's data: { kind, question,
// options }. Never throws.
export function cardButtons(card) {
  try {
    return buttonsOf(isRecord(card) ? card : {});
  } catch {
    return { buttons: [], note: null };
  }
}

function buttonsOf(card) {
  const kind = kindOf(card);
  const text = typeof card.question === 'string' ? card.question : '';
  const offers = optionsOf(card);
  const offered = (label) => offers.includes(label);
  const lines = setLinesOf(text);

  // The Unattended card, with or without Use Guarded: nothing on it is answered from the pane.
  if (text.includes(UNATTENDED_CARD().risk)) return { buttons: [], note: CANT_ANSWER };
  // A setup card: nothing on it is answered from the pane either, only in setup's chat.
  if (isSetupCard(card)) return { buttons: [], note: SETUP_ANSWER };
  // A trust card: nor is anything on it, only by the click on the card itself.
  if (isTrustCard(card)) return { buttons: [], note: TRUST_ANSWER };
  // Uninstall's card: nor is anything on it, only by the click on the card the helper composed.
  if (isUninstallCard(card)) return { buttons: [], note: UNINSTALL_ANSWER };
  // The baseline card: nor is anything on it, only by the click on the card the helper composed.
  if (card.kind === 'baseline' || baselineWording(text)) return { buttons: [], note: CANT_ANSWER };

  // A card with no set line asks a question the front desk takes up: every option is a turn.
  if (kind === 'question' && lines.length === 0) return { buttons: offers.map((label) => button(label, 'turn')), note: null };

  // Anything with a set line is judged by the card check's own tests, and must carry exactly
  // one that matches its kind, since the prompt record signs by that line.
  const line = lines.length === 1 ? lines[0] : null;
  const problems = cardProblems(text);
  if (line === null || problems.length > 0 || (kind === 'answer') !== ANSWER_LINE.test(line) || kind === 'question') {
    return { buttons: [], note: CANT_ANSWER };
  }

  if (kind === 'answer') {
    const own = offers.filter((label) => !PUT_OFF.includes(label)).map((label) => button(label, 'record'));
    return { buttons: [...own, ...(offered(SUGGEST) ? [button(SUGGEST, 'turn')] : [])], note: null };
  }

  const deciding = offers.find((label) => SIGNED_LABELS.includes(label));
  return {
    buttons: [
      ...(deciding === undefined ? [] : [button(deciding, 'record')]),
      ...(offered(NOT_NOW) ? [button(NOT_NOW, 'record')] : []),
      ...TURNS.filter(offered).map((label) => button(label, 'turn')),
    ],
    note: null,
  };
}
