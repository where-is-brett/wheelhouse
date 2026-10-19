// scripts/lib/setup-numbers.js
// The design's numbers for setup, named once. Anything that needs one imports it from here.

// The director's time setup aims for, in minutes, from the pasted line to the green board.
export const TARGET_MINUTES = 15;
// How long a click on a setup card stays good, in milliseconds.
export const CLICK_FRESH_MS = 10 * 60 * 1000;
// The oldest Node.js setup accepts, as [major, minor, patch].
export const NODE_FLOOR = [22, 0, 0];
// How many days usage counts and logs are kept.
export const RETENTION_DAYS = 30;
// How long the test push waits for the host to answer, in milliseconds.
export const PUSH_TEST_WAIT_MS = 2 * 60 * 1000;
// How long one setup step may run before it is reported as stuck, in milliseconds.
export const STEP_TIMEOUT_MS = 20 * 60 * 1000;

// The baseline from the private note (scripts/measures/baseline.js): how long the figures waiting
// for the director's click, and the card that read them back, are kept before they count as gone.
export const BASELINE_WAIT_MS = 24 * 60 * 60 * 1000;
