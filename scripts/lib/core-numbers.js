// scripts/lib/core-numbers.js
// The design's numbers, named once. Anything that needs one imports it from here.

// The least time between two briefings, in hours.
export const BRIEFING_GAP_HOURS = 2;
// How many words a briefing may run to, by the length the director chose.
export const BRIEFING_WORDS = { short: 80, standard: 150, detailed: 300 };
// What counts as an unusual amount of use: a factor over the usual, with enough samples behind it.
export const UNUSUAL = { factor: 3, minSamples: 5, windowDays: 28 };
// How long usage counts are kept, in days: the raw counts and their summaries.
export const KEEP_DAYS = { raw: 14, summaries: 90 };
// The port the local telemetry receiver listens on.
export const TELEMETRY_PORT = 14318;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// The watched sources: the largest download, how many copies to keep, the time limit and the diff cut-off.
export const SOURCES = { maxBytes: 2 * 1024 * 1024, keep: 8, timeoutMs: 20000, diffChars: 2000 };
// The most text one hook adds to a turn.
export const CONTEXT_CHARS = 9000;
// How many days before a retirement the director is told.
export const RETIRE_NOTICE_DAYS = 31;
// How many days a reply code stays good.
export const REPLY_CODE_DAYS = 7;
// How old the cached host facts may be before they are read again.
export const HOST_FACTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// The longest a line from an event may be on the board, the briefing or the front desk's context.
export const LINE_CHARS = 200;
// The longest the board, the briefing and the glance wait on any helper call.
export const HELPER_WAIT_MS = 2000;
// How long the director's click on a card stays good for the host helper: a CI push, a runbook step.
export const CLICK_MS = 10 * 60 * 1000;
