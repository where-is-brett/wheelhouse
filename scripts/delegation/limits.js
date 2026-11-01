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
// A standing brief: the most examples of right and wrong, and the most of it a confirm card can show.
export const BRIEF_EXAMPLES_MOST = 3;
export const BRIEF_WORDS_MOST = 800;
// The most lines a defect's fix may change and still be small.
export const SMALL_FIX_LINES = 50;
// How long a tick of the seals may run before the next may start, and how often a card's facts are tried before it is
// sealed as unreadable, and its seal before it is given up. A seal given up costs a seal, never a card.
export const SEAL_TICK_MS = 120_000;
export const FACT_TRIES = 3;
export const SEAL_TRIES = 6;
// How long a read card may wait for its answer and its reading before it is let go with no score.
export const SCORE_WAIT_DAYS = 30;
// The reader's view: the longest question and label read whole, and the longest cleaned change.
export const QUESTION_MOST = 600;
export const LABEL_MOST = 120;
export const VIEW_MOST_BYTES = 64 * 1024;
// A reader run: how long it may go and what it may spend before it is cancelled, how long the engine may not know it,
// how long its reply may be, and how many cards may wait for one.
export const READER_MS = 10 * 60_000;
export const READER_TOKENS = 100_000;
export const READER_UNKNOWN_MS = 60_000;
export const READING_MOST_BYTES = 16 * 1024;
export const READERS_WAITING_MOST = 20;
// How long a look at a piece's branch may take before a card asks instead. The card router waits for it.
export const REPEAT_READ_MS = 10_000;
