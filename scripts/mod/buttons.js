// scripts/mod/buttons.js
// Which buttons the pane draws under a card, what each does and in what shape: `record` is a press
// the bridge signs as the same click on the card would earn; `turn` hands the front desk a short
// prompt; `why` opens the card's reasons in place; `suggest` opens the box for the director's own
// words. The shape is `filled` for the deciding answer, `outlined`, `small` or `link`. The mod
// decides none of this. A card is judged by the same function the card check
// hook uses, on its whole question, and its parts must build its text, since the pane draws the
// parts and the prompt record signs the text: a card that fails either gets only Why?, which asks
// the front desk, and no button that records anything. The
// Unattended card for build commands on Windows, known by its risk words as the prompt record knows
// it, gets no button at all: only a click on it when the front desk asks it sets the level. Nor
// does a setup card, nor setup's card of the rules found: its step goes ahead only by the
// director's click on the very card setup showed, which only the prompt record counts
// (scripts/setup/clicks.js). Nor does the baseline card, for the same reason
// (scripts/lib/measures-clicks.js); it is never a card event anyway. Nor does a trust card (rulings
// R80, R81, retired with the records kept on this computer): none is handed out now, and a press on
// one asked before trusts nothing. Nor does uninstall's
// card (ruling R90): Wheelhouse is removed from a project only by the director's click on the card the
// helper composed for its list, which only the prompt record counts (scripts/lib/setup-clicks.js).
import { cardProblems } from '../hooks/card-check.js';
import { SIGNED_LABELS } from '../hooks/prompt-record.js';
import { CARD_KINDS, KEEP_AS_IS, PUT_OFF } from '../lib/front-desk.js';
import { SUGGEST, NOT_NOW, SHOW_ME, WHY, SEND_BACK } from '../lib/calm-words.js';
import { textOf } from '../cards/compose.js';
import { setLinesOf, TRUST_LINE, TAKEOVER_LINE, PAIR_LINE, UNINSTALL_LINE } from '../state/card-lines.js';
import { baselineWording } from '../lib/measures-clicks.js';
import { UNATTENDED_CARD } from '../protection/windows-builds.js';
import { heldBackWords, SHOW_THEM } from '../engine/words.js';

// The pane's line for the cards past the day's budget: its words, and the button that pulls them.
export const heldBackRow = (n) => (n > 0 ? { line: heldBackWords(n), button: button(SHOW_THEM, 'pull', 'small') } : null);

export const CANT_ANSWER = 'This card can\'t be answered here: ask the First Mate about it.';
// A setup card's note: setup asks it in its own chat, and that is where it is answered.
export const SETUP_ANSWER = 'This card can\'t be answered here: answer it in the chat where setup asked it.';
// A trust card's note, and a take-over card's: each is answered only in the chat where it was asked.
export const TRUST_ANSWER = 'This card can\'t be answered here: answer it in the chat where it was asked.';
// Uninstall's card's note: it is answered only in the chat where setup's playbook asked it.
export const UNINSTALL_ANSWER = 'This card can\'t be answered here: answer it in the chat where uninstall asked it.';
const ANSWER_LINE = /^Answer question /;
const SETUP_LINE = /^(?:Set up step |Confirm all [1-9][0-9]* rules? as listed, )/;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The kind a card is, one of CARD_KINDS; a card with no kind of its own is a question.
export const kindOf = (card) => (CARD_KINDS.includes(card?.kind) ? card.kind : 'question');

const labelOf = (option) => (typeof option === 'string' ? option : option?.label);

// The labels the card offers, each once, in order.
function optionsOf(card) {
  const given = Array.isArray(card?.options) ? card.options : [];
  return [...new Set(given.map(labelOf).filter((l) => typeof l === 'string' && l !== ''))];
}

// The card as the question the card check judges: its options with what each says.
function questionOf(card, text) {
  const given = Array.isArray(card.options) ? card.options : [];
  const says = Array.isArray(card.descriptions) ? card.descriptions : [];
  return {
    question: text,
    header: card.header,
    options: given.map((o, i) => ({ label: labelOf(o), description: typeof o?.description === 'string' ? o.description : says[i] })),
  };
}

// Whether the card's parts, where it has them, build its text. A card with none has nothing to
// disagree with its text.
function partsBuild(card, text) {
  if (card.parts === undefined || card.parts === null) return true;
  try {
    return isRecord(card.parts) && textOf(card.parts) === text;
  } catch {
    return false;
  }
}

// The option the card recommends: the composer keeps it, and its parts say it again.
function recommendedOf(card) {
  if (typeof card.recommend === 'string') return card.recommend;
  const options = isRecord(card.parts) && Array.isArray(card.parts.options) ? card.parts.options : [];
  return options.find((o) => o?.recommended === true)?.label ?? null;
}

const button = (label, does, shape, more = {}) => ({ label, does, shape, ...more });

// Whether a card is a setup card: of kind setup or confirm-all (the rules found), or carrying
// either's set line.
export function isSetupCard(card) {
  const text = typeof card?.question === 'string' ? card.question : '';
  return card?.kind === 'setup' || card?.kind === 'confirm-all' || setLinesOf(text).some((line) => SETUP_LINE.test(line));
}

// Whether a card is a trust card, a take-over card or the card that pairs an app: of that kind, or carrying its set
// line. Each is answered only by the click on the card itself.
export function isTrustCard(card) {
  const text = typeof card?.question === 'string' ? card.question : '';
  return ['trust', 'take-over', 'pair'].includes(card?.kind) || setLinesOf(text).some((line) => TRUST_LINE.test(line) || TAKEOVER_LINE.test(line) || PAIR_LINE.test(line));
}

// Whether a card is uninstall's: of kind uninstall, or carrying uninstall's set line.
export function isUninstallCard(card) {
  const text = typeof card?.question === 'string' ? card.question : '';
  return card?.kind === 'uninstall' || setLinesOf(text).some((line) => UNINSTALL_LINE.test(line));
}

// cardButtons(card, { preview }) -> { buttons, note }. `card` is a card event's data: { kind,
// question, options, descriptions, parts }. `preview` is the address of the card's preview, or
// null for none: Show me is then a link to it. Each button is { label, does, shape, href?, corner? }.
// Never throws.
export function cardButtons(card, { preview = null } = {}) {
  try {
    return buttonsOf(isRecord(card) ? card : {}, typeof preview === 'string' && preview !== '' ? preview : null);
  } catch {
    return { buttons: [], note: null };
  }
}

function buttonsOf(card, preview) {
  const kind = kindOf(card);
  const text = typeof card.question === 'string' ? card.question : '';
  const offers = optionsOf(card);
  const offered = (label) => offers.includes(label);
  const lines = setLinesOf(text);
  // Why? opens the card's reasons in place; a card with no parts has none to open, so it asks the front desk.
  const why = button(WHY, isRecord(card.parts) ? 'why' : 'turn', 'small');
  const suggest = button(SUGGEST, 'suggest', 'outlined');
  const own = () => offers.filter((label) => !PUT_OFF.includes(label) && label !== KEEP_AS_IS);
  const recommended = recommendedOf(card);
  const answers = (does) => own().map((label) => button(label, does, label === recommended ? 'filled' : 'outlined'));

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
  if (kind === 'question' && lines.length === 0) {
    return {
      buttons: [
        ...answers('turn'),
        ...(offered(SUGGEST) ? [suggest] : []),
        ...(offered(SHOW_ME) ? [button(SHOW_ME, 'turn', 'small')] : []),
        ...(offered(NOT_NOW) ? [button(NOT_NOW, 'turn', 'small', { corner: true })] : []),
        ...(isRecord(card.parts) ? [why] : []),
      ],
      note: null,
    };
  }

  // Anything with a set line is judged by the card check's own tests on its whole question, must
  // carry exactly one set line that matches its kind, since the prompt record signs by that line,
  // and must be built by its parts.
  const line = lines.length === 1 ? lines[0] : null;
  const problems = cardProblems(questionOf(card, text));
  if (line === null || problems.length > 0 || (kind === 'answer') !== ANSWER_LINE.test(line) || kind === 'question' || !partsBuild(card, text)) {
    return { buttons: [button(WHY, 'turn', 'small')], note: CANT_ANSWER };
  }

  const notNow = offered(NOT_NOW) ? [button(NOT_NOW, 'record', 'small', { corner: true })] : [];
  const askToSuggest = offered(SUGGEST) ? [suggest] : [];

  if (kind === 'answer') return { buttons: [...answers('record'), ...askToSuggest, why, ...notNow], note: null };
  // A blind card's click signs nothing: it goes to the front desk, which asks the answer card next.
  if (kind === 'blind') return { buttons: [...answers('turn'), ...askToSuggest, why], note: null };

  const deciding = offers.find((label) => SIGNED_LABELS.includes(label));
  return {
    buttons: [
      ...(deciding === undefined ? [] : [button(deciding, 'record', 'filled')]),
      ...(offered(SEND_BACK) ? [button(SEND_BACK, 'record', 'outlined')] : []),
      ...askToSuggest,
      ...notNow,
      why,
      ...(offered(SHOW_ME) ? [preview === null ? button(SHOW_ME, 'turn', 'small') : button(SHOW_ME, 'turn', 'link', { href: preview })] : []),
      ...(offered(KEEP_AS_IS) ? [button(KEEP_AS_IS, 'record', 'outlined')] : []),
    ],
    note: null,
  };
}
