// scripts/delegation/blind.js
// Blind cards (delegated decisions design, section 12): about one question card in five, at most one a day, shows its
// options first with no recommendation, so agreement can be told from going along. The question's own words stay on
// the card: only the recommendation is held back. A blind card is a card of its own, ahead of the answer card, and its
// click answers nothing, so the answer path, its signing and its delivery stay as they are.
import { createHash } from 'node:crypto';
import { BLIND_EVERY } from './limits.js';

// A number in [0, 1) from a question's id, so a card drawn twice falls the same way.
export function rollOf(id) {
  return createHash('sha256').update(String(id)).digest().readUInt32BE(0) / 2 ** 32;
}

// Whether this card goes blind. Never at level 4, on an approval or on a card holding up all work, never on a merge's
// or a trouble card, and at most one a day. `roll` is a number in [0, 1).
export function blindDue({ ask, card, day, lastDay, roll, off = false }) {
  if (off || day === lastDay || card?.level !== 3 || card.approval || card.exempt === true) return false;
  if (ask?.kind === 'trouble' || ask?.mergeQuestion) return false;
  return roll < 1 / BLIND_EVERY;
}

// The options in the order the seed gives, the same each time. The input is left as it was.
export function shuffled(options, seed) {
  const out = [...options];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rollOf(`${seed}:${i}`) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
