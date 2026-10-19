// scripts/lib/install-numbers.js
// The install plan's numbers, named once. Anything that needs one imports it from here.

// A week switched back for longer than this isn't measured, as with STOP, in milliseconds.
export const SWITCHED_BACK_MS = 24 * 60 * 60 * 1000;
// How many of the newest commits' messages the private-words check reads when there is no remote.
export const PRIVATE_SCAN_COMMITS = 50;
// The longest the install check's own session may run, in milliseconds.
export const CHECK_SESSION_MS = 60 * 1000;
