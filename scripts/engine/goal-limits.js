// scripts/engine/goal-limits.js
// The numbers an unattended goal is held to, in one table (unattended goals plan, choice 6). A leaf: it imports nothing,
// so the state's shapes and the engine's rules can both read it.
//   MAX_PIECES: the most work a goal lists. MAX_HOURS: how far ahead its `until` may be.
//   WIND_DOWN_MINUTES: how long a goal that has stopped starting work waits for its last runs. STUCK_MINUTES: how long
//   with nothing finished before it is called stuck. FAILED_IN_A_ROW and REDS_TO_STOP: the sheet's early stop, when it names none.
//   SHARE_OF_WHAT_IS_LEFT: the share of what is left of the week's allowance a sheet spends, by default.
//   READING_FRESH_MINUTES: how old an allowance reading may be and still be used.
export const MAX_PIECES = 12;
export const MAX_HOURS = 24;
export const WIND_DOWN_MINUTES = 60;
export const STUCK_MINUTES = 60;
export const FAILED_IN_A_ROW = 2;
export const REDS_TO_STOP = 2;
export const SHARE_OF_WHAT_IS_LEFT = 1 / 3;
export const READING_FRESH_MINUTES = 30;

// How a goal ends: its `goal-end` record names one.
export const GOAL_ENDINGS = Object.freeze(['done', 'waiting-for-you', 'check-failed', 'time', 'spend', 'stuck', 'end-goal', 'all-stop']);
