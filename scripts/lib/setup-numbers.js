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
// How long the director is asked to keep the screen locked for the test push, at most: longer
// than PUSH_TEST_WAIT_MS, so the push goes out while it is still locked (ruling R65).
export const PUSH_TEST_LOCK_MS = 3 * 60 * 1000;
// How long one setup step may run before it is reported as stuck, in milliseconds.
export const STEP_TIMEOUT_MS = 20 * 60 * 1000;
// How setup switches telemetry on for this computer (check 36, ruling R63): 'user-settings', the
// four variables under `env` in the user's Claude settings, or 'launch-env', the same variables in
// the account's launch environment. Both are built (scripts/setup/telemetry.js); this one is used
// until check 36's sitting shows which one Desktop's sessions take.
export const TELEMETRY_ROUTE = 'user-settings';
