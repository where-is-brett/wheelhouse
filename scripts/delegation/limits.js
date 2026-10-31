// scripts/delegation/limits.js
// The numbers of delegated decisions, in one table.

// Blind cards: one question card in BLIND_EVERY, at most BLIND_A_DAY.
export const BLIND_EVERY = 5;
export const BLIND_A_DAY = 1;
// How many pieces may wait on the director, as a multiple of `pace`.
export const PARKED_TIMES = 2;
// Offers of a rule: at most OFFER_SITTING in a sitting, and not again for OFFER_AGAIN_DAYS.
export const OFFER_SITTING = 1;
export const OFFER_AGAIN_DAYS = 30;
export const RULE_REVIEW_MONTHS = 6;
// The most lines a defect's fix may change and still be small.
export const SMALL_FIX_LINES = 50;
// How long a tick of the seals may run before the next may start, and how often a card's facts are tried before it is
// sealed as unreadable, and its seal before it is given up. A seal given up costs a seal, never a card.
export const SEAL_TICK_MS = 120_000;
export const FACT_TRIES = 3;
export const SEAL_TRIES = 6;
