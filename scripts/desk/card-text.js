// scripts/desk/card-text.js
// The text a card shows and the short hash that names it (what a card press or an answer to a card carries).
import crypto from 'node:crypto';

// How many characters of the sha256 name a card.
export const CARD_HASH_CHARS = 12;

// The text of a card's data: its question, else its title.
export const cardTextOf = (data) => (typeof data?.question === 'string' ? data.question : typeof data?.title === 'string' ? data.title : '');

// The first CARD_HASH_CHARS characters of the sha256 of a card's text.
export const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, CARD_HASH_CHARS);
