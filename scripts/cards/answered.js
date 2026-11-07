// scripts/cards/answered.js
// Where and when a card was answered, in words every part of Wheelhouse shares. It reads the answers the state
// holds and imports nothing, so the state and the hooks can both use it.

// What the hidden line noting a press in a panel starts with, kept here so the hook can look for it
// without loading any panel code.
export const NOTE_LEAD = 'Wheelhouse pane: the director ';

export const WHERE = Object.freeze(['panel', 'chat', 'reply']);

const PLACE_WORDS = { panel: 'in the panel', chat: 'in the chat', reply: 'by reply code' };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const two = (n) => String(n).padStart(2, '0');

// A time as the director reads it, on this computer's clock: "at 14:05", or "on 28 October at 14:05" on another day.
export function whenSaid(iso, now) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'earlier';
  const clock = `at ${two(at.getHours())}:${two(at.getMinutes())}`;
  return at.toDateString() === now.toDateString() ? clock : `on ${at.getDate()} ${MONTH_NAMES[at.getMonth()]} ${clock}`;
}

export const askOf = (card) => String(card.data?.question ?? '').split('\n')[0];

// The answer that decided a card, in the director's words: its label, or for a signed record that carries none, the
// option it stands for.
export const countedOf = ({ card, decided }) => decided.label ?? ({ approval: 'Approve', confirm: 'Confirm', 'ci-push': 'Push it' }[card.data?.kind] ?? 'an answer');

// What a card is about: the first line of what it says it is, else its question's first line.
export function subjectOf(card) {
  const what = card?.data?.parts?.what;
  const line = typeof what === 'string' ? what.split('\n')[0].trim() : '';
  return line !== '' ? line : askOf(card);
}

const VERBS = { Approve: 'approved', Confirm: 'confirmed', 'Push it': 'pushed' };

// "approved in the panel at 10:34", "answered Not now in the chat at 09:02", "approved on 3 November at 18:10".
// With no place recorded, the place is left out.
export function answeredWords({ card, decided }, now) {
  const counted = countedOf({ card, decided });
  const verb = VERBS[counted] ?? `answered ${counted}`;
  const place = PLACE_WORDS[decided.where];
  return [verb, place, whenSaid(decided.at, now)].filter(Boolean).join(' ');
}
