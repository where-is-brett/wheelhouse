// scripts/cards/panel-words.js
// The two lines a session is told about the panel beside the chat, in one place so the hooks and the front desk's card
// commands say them the same way: which cards wait in the panel, and what the director answered there since the
// session's last turn.
import { answeredWords, subjectOf } from './answered.js';

export const PANE_LEAD = 'These cards are in the panel beside the chat: ';
export const SINCE_LEAD = 'Since your last turn, the director answered: ';
export const SINCE_TAIL = 'Before anything else, tell them in one plain line what they answered and where, as a fact. Never ask these cards again.';
// The most cards the since line names; the rest are on the board.
export const SINCE_CARDS = 6;

const plural = (n, one, many) => (n === 1 ? one : many);

// The line for `n` cards held for the panel; `others` says some cards beside them are still to be asked here.
export function paneLine(n, { others = false } = {}) {
  return `${PANE_LEAD}${n}. Say in one line, before anything else, that ${n} ${plural(n, 'card waits', 'cards wait')} in the panel and that you can ask ${plural(n, 'it', 'them')} here instead. Give no card's words, number or id.${others ? ' Ask only the others.' : ''}`;
}

// The line naming each card answered after `from` (a time in ms) anywhere but the chat, oldest first, or null when
// there is none. `outcomes` are { card, decided } as the desk gives them.
export function sinceLine(outcomes, from, at) {
  if (!Array.isArray(outcomes) || !Number.isFinite(from)) return null;
  const fresh = outcomes
    .filter((o) => o?.decided != null && o.decided.where !== 'chat' && Date.parse(o.decided.at) > from)
    .sort((a, b) => Date.parse(a.decided.at) - Date.parse(b.decided.at))
    .slice(0, SINCE_CARDS);
  return fresh.length === 0 ? null : `${SINCE_LEAD}${fresh.map((o) => `${subjectOf(o.card)}: ${answeredWords(o, at)}`).join('; ')}. ${SINCE_TAIL}`;
}
