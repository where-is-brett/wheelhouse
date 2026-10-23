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
// How long a Copilot hook waits for the helper's /health before it takes the helper as not running (ruling P5-22).
export const HELPER_PROBE_MS = 2000;
// Whether check 59 (C6) has shown a hook can see ask_user's answer, so a click a hook saw can be recorded as
// `hook-click`. Until it has, a chat click is recorded as `chat-click`, the agent's own account (ruling P5-12).
export const C6_PASSED = false;
// Whether Copilot's signed review, in a clean session the helper starts (check 66's route b), is switched on. It is
// false until three real runs in a row pass the clean check on COPILOT_VERSION and are recorded in check 66's note
// (ruling P7-20); until then the gate counts no review on Copilot, and refuses with NO_CLEAN_REVIEW. Read only by
// adapters/copilot/review.js.
export const REVIEW_SESSION_READY = false;
// Whether the watcher's background Copilot sessions (the foreman's wakes and the builders) are switched on. It is
// false until their held first real runs pass and are recorded in checks 61 and 63: a guard seen firing in a session
// started this way, a resume in the same home, the foreman's quoted shell rule, and the loop's tools under the rules
// (ruling P8-1). Until then Copilot's checkForeman and checkFeature refuse, so no watcher starts one and the helper's
// sign-in start makes no watcher for a Copilot project. It moves only by a commit of its own. Read only by
// adapters/copilot/sessions.js.
export const BACKGROUND_SESSIONS_READY = false;
