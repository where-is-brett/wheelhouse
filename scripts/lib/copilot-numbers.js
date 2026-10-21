// scripts/lib/copilot-numbers.js
// The numbers of the Copilot design, named once. Anything that needs one imports it from here.

// The hook's `timeoutSec` in Copilot's hook file.
export const GUARD_TIMEOUT_SEC = 120;
// Every guard answers within this, or refuses.
export const GUARD_DEADLINE_MS = 30000;
// The three tiers a project can run at.
export const TIERS = Object.freeze(['lean', 'middle', 'full']);
// The permission levels a session can run at.
export const LEVELS = Object.freeze(['sandbox', 'guarded', 'ask', 'unattended']);
// What a record of a click can name as its proof. `signed-hook` is Claude Code's existing record.
export const PROOFS = Object.freeze(['chat-click', 'hook-click', 'policy-hook', 'window', 'add-on', 'host', 'signed-hook']);
// The kinds of review a record can name.
export const REVIEW_KINDS = Object.freeze(['chat-review', 'clean-session', 'subagent']);
// How many days a session's activity is kept.
export const ACTIVITY_DAYS = 30;
// The steps that need the director's confirmed click.
export const CONFIRMED_STEPS = Object.freeze(['lift-stop', 'guardrail-change', 'unattended', 'runbook-step', 'ci-push']);
// Where Lean keeps its records, inside the project.
export const LEAN_RECORD_DIR = '.wheelhouse/record';
// The board's file, inside the project's Copilot folder.
export const BOARD_FILE = 'wheelhouse/board.md';
// The hook file's name, in the person's Copilot hook folder.
export const HOOK_FILE = 'wheelhouse.json';
// The version of Copilot CLI the probes install.
export const COPILOT_VERSION = '1.0.101';
